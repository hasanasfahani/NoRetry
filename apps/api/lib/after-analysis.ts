import {
  AcceptanceChecklistItemSchema,
  AfterConfidenceSchema,
  AfterDecisionSchema,
  ArtifactContextSchema,
  ConfidenceTrendSchema,
  DeepCriterionVerificationSchema,
  AfterPipelineResponseSchema,
  IntentExtractionOutputSchema,
  NextPromptOutputSchema,
  ReviewContractSchema,
  Stage1OutputSchema,
  Stage2OutputSchema,
  VerdictOutputSchema,
  buildResponseExcerpts,
  compressGoal,
  type AfterPipelineRequest,
  type ArtifactContext,
  type ArtifactRecord,
  type ArtifactType,
  type AttemptIntent,
  type DeepCriterionEvidenceType,
  type ReviewContract,
  type ReviewCriterion,
  type ReviewCriterionLayer,
  type ReviewCriterionSource
} from "@prompt-optimizer/shared"
import * as z from "zod"
import { trimForBudget } from "./cost-control"
import { callDeepSeekJson } from "./deepseek"
import { callKimiJson } from "./kimi"

const AFTER_STAGE_SOFT_DEADLINE_MS = 8000
const AFTER_DEEP_STAGE_SOFT_DEADLINE_MS = 16000
const EVIDENCE_EXCERPT_LIMIT = 320
const MAX_REVIEW_CRITERIA = 6
const CRITERION_LABEL_MAX = 240
const ARTIFACT_LABEL_MAX = 120
const WHY_BULLET_MAX = 220
const CONFIDENCE_REASON_MAX = 180
const NEXT_ACTION_MAX = 180

const EvidenceTargetingSchema = z.object({
  selected_candidate_ids: z.array(z.string()).max(4).default([]),
  risk_flags: z.array(z.string()).max(4).default([]),
  inspection_goal: z.string().max(180).default("")
})

const DetailInspectionSchema = z.object({
  supported_claims: z.array(z.string()).max(4).default([]),
  contradictions: z.array(z.string()).max(4).default([]),
  unresolved_risks: z.array(z.string()).max(4).default([]),
  evidence_strength: z.enum(["weak", "moderate", "strong"]).default("weak"),
  inspection_depth: z.enum(["summary_only", "targeted_text", "targeted_code"]).default("summary_only")
})

type EvidenceCandidate = {
  id: string
  type: "code" | "claim" | "file" | "constraint" | "paragraph"
  label: string
  excerpt: string
}

type CriterionSeed = {
  label: string
  source: ReviewCriterionSource
  layer: ReviewCriterionLayer
}

type ChecklistItem = z.infer<typeof AcceptanceChecklistItemSchema>

type DomObservation = {
  probeId: string
  target: string
  observed: boolean
  confidence: number
  details: string
  content: string
}

type NormalizedArtifactBundle = {
  mode: ArtifactContext["mode"]
  surface?: ArtifactContext["surface"]
  checkedArtifactTypes: ArtifactType[]
  responseTexts: string[]
  responseCodeBlocks: string[]
  changedFileLabels: string[]
  outputSnippets: string[]
  errorSummaries: string[]
  buildOrTestTexts: string[]
  runtimeSignals: string[]
  domObservations: DomObservation[]
  extensionEvents: Array<{
    eventType: string
    status: string
    detail: string
    route: string
    content: string
  }>
  popupSnapshots: Array<{
    statusText: string
    retryCount: number
    lastIntent: string
    visibleText: string
    authStateText: string
    usageText: string
    strengthenVisible: boolean
    hostHint: string
  }>
}

type CriterionEvidencePolicy = {
  primary: DeepCriterionEvidenceType[]
  fallbackIfPrimaryUnavailable?: DeepCriterionEvidenceType[]
}

type DeepArtifactEvaluation = {
  checklist: ChecklistItem[]
  stage2: ReturnType<typeof Stage2OutputSchema.parse>
  detailInspection: ReturnType<typeof DetailInspectionSchema.parse>
  verifications: z.infer<typeof DeepCriterionVerificationSchema>[]
  checkedArtifactTypes: ArtifactType[]
  contradictionCount: number
}

const REVIEW_SOURCE_ORDER: ReviewCriterionSource[] = [
  "submitted_prompt",
  "definition_of_done",
  "user_intent",
  "constraint",
  "validation"
]

function dedupe(items: string[], limit = 6) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, limit)
}

function conciseGoal(goal: string, limit = 140) {
  const trimmed = goal.trim()
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit - 1).trimEnd()}…`
}

function limitText(value: string, limit: number) {
  if (value.length <= limit) return value
  return `${value.slice(0, limit - 1).trimEnd()}…`
}

function normalizeForMatch(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s-]+/g, " ").replace(/\s+/g, " ").trim()
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "your",
  "have",
  "will",
  "into",
  "about",
  "after",
  "before",
  "then",
  "when",
  "what",
  "where",
  "which",
  "they",
  "them",
  "their",
  "because",
  "should",
  "could",
  "would",
  "there",
  "please",
  "just",
  "only",
  "keep",
  "focus",
  "tell",
  "exactly"
])

function extractMeaningfulTokens(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token))
}

function extractSectionLines(source: string, headings: string[]) {
  if (!source.trim()) return []

  const requestedHeadings = headings.map((heading) => heading.toLowerCase())
  const commonContextHeadings = new Set([
    "project overview",
    "architecture",
    "constraints",
    "relevant files",
    "current state",
    "repeated bugs",
    "fix attempts",
    "ai drift patterns",
    "user intent to preserve",
    "definition of done"
  ])
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const results: string[] = []
  let capture = false

  for (const line of lines) {
    const normalized = line.toLowerCase()
    const headingText = normalized.replace(/^#{1,6}\s*/, "").replace(/[:\s]+$/g, "").trim()
    const isMarkdownHeading = /^#{1,6}\s*/.test(line)
    const isPlainSectionHeading =
      commonContextHeadings.has(headingText) &&
      !/^[-*•]\s+/.test(line)
    const isHeading = isMarkdownHeading || isPlainSectionHeading

    if (isHeading) {
      capture = requestedHeadings.some((heading) => headingText.includes(heading))
      continue
    }

    if (capture && (commonContextHeadings.has(headingText) || /^[A-Z][A-Za-z ]+:\s*$/.test(line))) {
      capture = false
    }

    if (!capture) continue

    const cleaned = line.replace(/^[-*•]\s*/, "").trim()
    if (cleaned) results.push(cleaned)
  }

  return dedupe(results, 10)
}

function extractPrefixedLine(source: string, prefixes: string[]) {
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    const normalized = line.toLowerCase()
    const prefix = prefixes.find((candidate) => normalized.startsWith(candidate))
    if (!prefix) continue
    const value = line.slice(prefix.length).replace(/^[:\-\s]+/, "").trim()
    if (value) return value
  }

  return ""
}

function hasWeakGoal(goal: string) {
  const normalized = normalizeForMatch(goal)
  const goalTokens = extractMeaningfulTokens(goal)

  return (
    !normalized ||
    normalized === "the user s latest request" ||
    normalized === "solve the requested task" ||
    /^solve\s+(the|this|that)\b/.test(normalized) ||
    /^fix(\s+it)?$/.test(normalized) ||
    goalTokens.length < 4
  )
}

function mergeIntentWithProjectMemory(
  intent: AttemptIntent,
  projectContext: string,
  currentState: string,
  options?: {
    aggressive?: boolean
    forceIncludeAllContext?: boolean
  }
): AttemptIntent {
  const aggressive = options?.aggressive ?? false
  const forceIncludeAllContext = options?.forceIncludeAllContext ?? false
  const currentGoalHint =
    extractPrefixedLine(currentState, ["working on", "current goal", "goal", "what i am working on"]) ||
    extractPrefixedLine(projectContext, ["user-facing goal", "definition of done", "goal"])

  const definitionOfDone = filterContextLinesForIntent(
    extractSectionLines(projectContext, ["definition of done"]).concat(
      extractSectionLines(currentState, ["definition of done"])
    ),
    intent,
    forceIncludeAllContext
  )

  const userIntentToPreserve = filterContextLinesForIntent(
    extractSectionLines(projectContext, ["user intent to preserve"]).concat(
      extractSectionLines(currentState, ["user intent to preserve"])
    ),
    intent,
    forceIncludeAllContext
  )
  const constraintsFromContext = filterContextLinesForIntent(
    extractSectionLines(projectContext, ["constraints"]).concat(extractSectionLines(currentState, ["constraints"])),
    intent,
    forceIncludeAllContext
  )
    .filter(
      (line) => /must|non-negotiable|do not|keep|without|visible|works|survive|no /i.test(line)
    )

  const weakGoal = hasWeakGoal(intent.goal)
  const weakCriteria =
    intent.acceptance_criteria.length === 0 ||
    intent.acceptance_criteria.every((criterion) => hasGenericAcceptanceCriterion(criterion))

  const mergedGoal = weakGoal && currentGoalHint ? currentGoalHint : intent.goal
  const mergedConstraints =
    aggressive || intent.constraints.length === 0
      ? dedupe([...intent.constraints, ...constraintsFromContext], 6)
      : intent.constraints

  const contextCriteria = dedupe([...definitionOfDone, ...userIntentToPreserve], 6).filter((item) =>
    extractMeaningfulTokens(item).length >= 3
  )

  const mergedAcceptance = weakCriteria
    ? dedupe([...contextCriteria, ...intent.acceptance_criteria], 6)
    : aggressive
      ? dedupe([...intent.acceptance_criteria, ...contextCriteria], 6)
      : intent.acceptance_criteria

  return {
    ...intent,
    goal: mergedGoal,
    constraints: mergedConstraints,
    acceptance_criteria: mergedAcceptance.length ? mergedAcceptance : intent.acceptance_criteria
  }
}

function hasGoalEvidence(goal: string, responseSummary: AfterPipelineRequest["response_summary"]) {
  const goalTokens = extractMeaningfulTokens(goal)
  if (!goalTokens.length) return true

  const haystack = [
    responseSummary.first_excerpt,
    responseSummary.last_excerpt,
    ...responseSummary.key_paragraphs,
    ...responseSummary.mentioned_files
  ]
    .join(" ")
    .toLowerCase()

  const matched = goalTokens.filter((token) => haystack.includes(token))
  return matched.length >= Math.min(2, goalTokens.length)
}

function responseFocusSnippet(responseSummary: AfterPipelineRequest["response_summary"]) {
  const candidates = [
    ...responseSummary.key_paragraphs,
    responseSummary.first_excerpt,
    responseSummary.last_excerpt
  ]
    .map((value) => normalizeWhitespace(value))
    .filter(Boolean)

  const snippet =
    candidates.find((value) => !looksLikeCode(value)) ||
    candidates.find((value) => /[a-z]{3,}\s+[a-z]{3,}/i.test(value)) ||
    candidates[0]
  return conciseGoal(snippet || "the visible answer")
}

function summarizeChangedFiles(changedFiles: string[]) {
  const normalized = dedupe(
    changedFiles
      .map((item) => normalizeWhitespace(item))
      .filter(Boolean)
      .map((item) => limitText(item, 80)),
    3
  )

  return normalized
}

function summarizeVisibleAnswer(responseSummary: AfterPipelineRequest["response_summary"]) {
  const snippet = responseFocusSnippet(responseSummary)
  const compact = snippet.replace(/\s+/g, " ").trim()
  if (!compact) return "The answer stayed on the visible topic."

  const sentenceLike = /[.!?]/.test(compact)
  if (sentenceLike || compact.length > 90) return compact

  return `The answer appears focused on: ${compact}`
}

function summarizeChangeClaims(responseSummary: AfterPipelineRequest["response_summary"]) {
  return dedupe(
    responseSummary.change_claims
      .map((claim) => normalizeWhitespace(claim))
      .filter(Boolean)
      .map((claim) => limitText(claim, 140)),
    3
  )
}

function summarizeValidationSignals(responseSummary: AfterPipelineRequest["response_summary"]) {
  return dedupe(
    responseSummary.validation_signals
      .map((signal) => normalizeWhitespace(signal))
      .filter(Boolean)
      .map((signal) => limitText(signal, 140)),
    3
  )
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function looksLikeCode(value: string) {
  const compact = value.trim()
  return (
    compact.startsWith("```") ||
    /var\s+\w+\s*=|const\s+\w+\s*=|function\s+\w+\s*\(|=>|<\/?[a-z][^>]*>|[{};]{2,}/i.test(compact)
  )
}

function normalizeCriterionLabel(value: string) {
  const normalized = value
    .replace(/^prove the answer solved this goal:\s*/i, "")
    .replace(/\(already implemented\)/gi, "")
    .replace(/\s+/g, " ")
    .trim()

  if (!normalized || /^solve:\s*$/i.test(normalized)) {
    return "Solve the requested task"
  }

  return limitText(normalized, CRITERION_LABEL_MAX)
}

function isGenericDisplayCriterion(value: string) {
  const normalized = normalizeForMatch(normalizeCriterionLabel(value))
  return (
    !normalized ||
    normalized === "solve the requested task" ||
    normalized === "solve the user s latest request" ||
    normalized === "the user s latest request" ||
    /^solve\b/.test(normalized)
  )
}

function canonicalAcceptanceCriteria(
  intent: AttemptIntent,
  baselineCriteria: string[] = [],
  reviewContract?: ReviewContract | null
) {
  const contractCriteria = (reviewContract?.criteria ?? [])
    .map((criterion) => normalizeCriterionLabel(criterion.label))
    .filter(Boolean)

  if (contractCriteria.some((item) => !isGenericDisplayCriterion(item))) {
    return dedupe(contractCriteria, 8)
  }

  const preferredBaseline = dedupe(
    baselineCriteria
      .map((item) => normalizeCriterionLabel(item))
      .filter(Boolean),
    8
  )

  if (preferredBaseline.some((item) => !isGenericDisplayCriterion(item))) {
    return preferredBaseline
  }

  const fromIntent = dedupe(
    intent.acceptance_criteria
      .map((item) => normalizeCriterionLabel(item))
      .filter(Boolean),
    8
  )

  if (fromIntent.some((item) => !isGenericDisplayCriterion(item))) {
    return fromIntent
  }

  return fromIntent.length ? fromIntent : [normalizeCriterionLabel(`Solve: ${intent.goal}`)]
}

function summarizeChecklistLabels(labels: string[], limit = 2) {
  return labels
    .slice(0, limit)
    .map((label) => conciseGoal(label, 90))
    .join(" • ")
}

function classifyCriterionLayer(label: string): ReviewCriterionLayer {
  return /\b(console errors?|devtools errors?|no errors?|spa navigation|re-appears|survive|works end-to-end|usage|auth state|popup)\b/i.test(
    label
  )
    ? "validation"
    : "core"
}

function normalizeCriterionSeed(label: string, source: ReviewCriterionSource): CriterionSeed | null {
  const normalizedLabel = normalizeCriterionLabel(label)
  if (!normalizedLabel || isGenericDisplayCriterion(normalizedLabel)) return null

  const layer = source === "validation" ? "validation" : classifyCriterionLayer(normalizedLabel)
  return {
    label: normalizedLabel,
    source,
    layer
  }
}

function isBroadCompositeCriterion(label: string) {
  const andCount = (label.match(/\band\b/gi) ?? []).length
  return label.length > 120 || extractMeaningfulTokens(label).length > 18 || andCount >= 2
}

function criterionMatchScore(candidateLabel: string, contractLabel: string) {
  const normalizedCandidate = normalizeForMatch(normalizeCriterionLabel(candidateLabel))
  const normalizedContract = normalizeForMatch(normalizeCriterionLabel(contractLabel))

  if (!normalizedCandidate || !normalizedContract) return 0
  if (normalizedCandidate === normalizedContract) return 100

  const candidateTokens = extractMeaningfulTokens(normalizedCandidate)
  const contractTokens = extractMeaningfulTokens(normalizedContract)
  if (!candidateTokens.length || !contractTokens.length) return 0

  const overlap = candidateTokens.filter((token) => contractTokens.includes(token))
  if (!overlap.length) return 0

  const candidateRatio = overlap.length / candidateTokens.length
  const contractRatio = overlap.length / contractTokens.length

  if ((normalizedCandidate.includes(normalizedContract) || normalizedContract.includes(normalizedCandidate)) && overlap.length >= 2) {
    return 90
  }

  if (candidateRatio >= 0.75 || contractRatio >= 0.75) return 80
  if (candidateRatio >= 0.6 && overlap.length >= 2) return 70
  if (contractRatio >= 0.6 && overlap.length >= 2) return 65

  return overlap.length >= 3 ? 55 : 0
}

function buildIntentReferencePool(intent: AttemptIntent) {
  return dedupe(
    [intent.goal, ...intent.acceptance_criteria, ...intent.constraints]
      .flatMap((value) =>
        value
          .split(/(?<=[.!?])\s+|\n+|;\s+/)
          .map((item) => normalizeCriterionLabel(item))
          .filter((item) => extractMeaningfulTokens(item).length >= 3)
      ),
    18
  )
}

function intentNeedsContextRescue(intent: AttemptIntent) {
  const normalizedGoal = normalizeForMatch(intent.goal)
  const singleCriterion = intent.acceptance_criteria.length === 1 ? normalizeForMatch(intent.acceptance_criteria[0]) : ""
  const looksLikeMetaReviewPrompt =
    /^(did|does|is|was|were|has|have|can|could|should)\b/.test(normalizedGoal) ||
    /\b(fully fix|really fix|actually fix|fully solve|fully resolve|work now|fixed now|resolved now)\b/.test(
      normalizedGoal
    ) ||
    (!!singleCriterion &&
      singleCriterion === normalizedGoal &&
      /\b(fix|fixed|resolve|resolved|work|working|flow|issue|problem|bug)\b/.test(singleCriterion))

  return (
    hasWeakGoal(intent.goal) ||
    looksLikeMetaReviewPrompt ||
    intent.acceptance_criteria.length === 0 ||
    intent.acceptance_criteria.every((criterion) => hasGenericAcceptanceCriterion(criterion))
  )
}

function filterContextLinesForIntent(lines: string[], intent: AttemptIntent, forceIncludeAllContext = false) {
  const normalizedLines = dedupe(lines, 10).filter((line) => extractMeaningfulTokens(line).length >= 3)
  if (!normalizedLines.length) return []
  if (forceIncludeAllContext || intentNeedsContextRescue(intent)) return normalizedLines

  const references = buildIntentReferencePool(intent)
  if (!references.length) return []

  return normalizedLines.filter((line) =>
    references.some((reference) => criterionMatchScore(line, reference) >= 55)
  )
}

function mapCriteriaToReviewContract(labels: string[], reviewContract: ReviewContract) {
  const results: string[] = []

  for (const rawLabel of labels) {
    const normalizedLabel = normalizeCriterionLabel(rawLabel)
    if (!normalizedLabel || isGenericDisplayCriterion(normalizedLabel)) continue

    const exactMatch = reviewContract.criteria.find(
      (criterion) => normalizeForMatch(criterion.label) === normalizeForMatch(normalizedLabel)
    )
    if (exactMatch) {
      results.push(exactMatch.label)
      continue
    }

    const bestMatch = reviewContract.criteria
      .map((criterion) => ({
        criterion,
        score: criterionMatchScore(normalizedLabel, criterion.label)
      }))
      .sort((left, right) => right.score - left.score || left.criterion.priority - right.criterion.priority)[0]

    if (bestMatch && bestMatch.score >= 65) {
      results.push(bestMatch.criterion.label)
    }
  }

  return dedupe(results, MAX_REVIEW_CRITERIA)
}

function normalizeStage2AgainstReviewContract(
  stage2: ReturnType<typeof Stage2OutputSchema.parse>,
  reviewContract: ReviewContract
) {
  const addressedCriteria = mapCriteriaToReviewContract(stage2.addressed_criteria, reviewContract)
  const missingCriteria = mapCriteriaToReviewContract(stage2.missing_criteria, reviewContract).filter(
    (label) => !addressedCriteria.includes(label)
  )
  const problemFit =
    !addressedCriteria.length && stage2.problem_fit === "wrong_direction"
      ? "wrong_direction"
      : missingCriteria.length
        ? "partial"
        : addressedCriteria.length
          ? "correct"
          : stage2.problem_fit

  return Stage2OutputSchema.parse({
    ...stage2,
    problem_fit: problemFit,
    addressed_criteria: addressedCriteria,
    missing_criteria: missingCriteria,
    analysis_notes: dedupe(
      stage2.analysis_notes.filter((note) => {
        const normalized = note.trim().toLowerCase()
        if (!missingCriteria.length) {
          return (
            normalized.length > 18 &&
            !normalized.includes("the user's latest request") &&
            !normalized.includes("solve the requested task") &&
            !normalized.includes("could not directly verify") &&
            !normalized.includes("still does not clearly show") &&
            !normalized.includes("remain unverified")
          )
        }

        return (
          normalized.length > 18 &&
          !normalized.includes("the user's latest request") &&
          !normalized.includes("solve the requested task")
        )
      }),
      4
    )
  })
}

function buildReviewContract(
  intent: AttemptIntent,
  projectContext: string,
  currentState: string,
  baselineContract: ReviewContract | null | undefined,
  targetSignature: string,
  options?: {
    forceIncludeAllContext?: boolean
  }
): ReviewContract {
  if (baselineContract?.criteria?.length) {
    return ReviewContractSchema.parse({
      ...baselineContract,
      target_signature: targetSignature || baselineContract.target_signature || "",
      goal: baselineContract.goal || intent.goal,
      criteria: baselineContract.criteria.slice(0, MAX_REVIEW_CRITERIA)
    })
  }

  const forceIncludeAllContext = options?.forceIncludeAllContext ?? false

  const definitionOfDone = filterContextLinesForIntent(
    extractSectionLines(projectContext, ["definition of done"]).concat(
      extractSectionLines(currentState, ["definition of done"])
    ),
    intent,
    forceIncludeAllContext
  )
  const userIntentToPreserve = filterContextLinesForIntent(
    extractSectionLines(projectContext, ["user intent to preserve"]).concat(
      extractSectionLines(currentState, ["user intent to preserve"])
    ),
    intent,
    forceIncludeAllContext
  )
  const validationCriteria = filterContextLinesForIntent(
    extractSectionLines(projectContext, ["constraints"]).concat(extractSectionLines(currentState, ["constraints"])),
    intent,
    forceIncludeAllContext
  )
    .filter((line) =>
      /\b(console errors?|no errors?|spa navigation|re-appears|survive|works end-to-end|popup|usage|auth state)\b/i.test(
        line
      )
    )

  const seedBuckets: Record<ReviewCriterionSource, CriterionSeed[]> = {
    submitted_prompt:
      definitionOfDone.length >= 3
        ? []
        : intent.acceptance_criteria
            .map((label) => normalizeCriterionSeed(label, "submitted_prompt"))
            .filter((item) => {
              if (!item) return false
              const hasStructuredProjectCriteria = definitionOfDone.length > 0 || userIntentToPreserve.length > 0
              return !hasStructuredProjectCriteria || !isBroadCompositeCriterion(item.label)
            })
            .filter((item): item is CriterionSeed => Boolean(item)),
    definition_of_done: definitionOfDone
      .map((label) => normalizeCriterionSeed(label, "definition_of_done"))
      .filter((item): item is CriterionSeed => Boolean(item)),
    user_intent:
      definitionOfDone.length >= 3
        ? []
        : userIntentToPreserve
            .map((label) => normalizeCriterionSeed(label, "user_intent"))
            .filter((item): item is CriterionSeed => Boolean(item)),
    constraint: intent.constraints
      .map((label) => normalizeCriterionSeed(label, "constraint"))
      .filter((item): item is CriterionSeed => Boolean(item)),
    validation: validationCriteria
      .map((label) => normalizeCriterionSeed(label, "validation"))
      .filter((item): item is CriterionSeed => Boolean(item))
  }

  const uniqueSeeds: CriterionSeed[] = []
  for (const source of REVIEW_SOURCE_ORDER) {
    for (const seed of seedBuckets[source]) {
      const isAlreadyRepresented = uniqueSeeds.some(
        (existing) =>
          normalizeForMatch(existing.label) === normalizeForMatch(seed.label) ||
          criterionMatchScore(existing.label, seed.label) >= 65
      )
      if (isAlreadyRepresented) continue
      uniqueSeeds.push(seed)
    }
  }

  const orderedSeeds = [
    ...uniqueSeeds.filter((seed) => seed.layer === "core"),
    ...uniqueSeeds.filter((seed) => seed.layer === "validation")
  ].slice(0, MAX_REVIEW_CRITERIA)

  const fallbackSeed = normalizeCriterionSeed(`Solve: ${intent.goal}`, "submitted_prompt")
  const finalSeeds = orderedSeeds.length ? orderedSeeds : fallbackSeed ? [fallbackSeed] : []

  return ReviewContractSchema.parse({
    version: "v1",
    target_signature: targetSignature,
    goal: intent.goal,
    criteria: finalSeeds.map((seed, index) => ({
      id: `criterion-${index + 1}`,
      label: seed.label,
      source: seed.source,
      layer: seed.layer,
      priority: index + 1
    }))
  })
}

function reviewQualityContract(deepAnalysisRequested: boolean) {
  return deepAnalysisRequested
    ? "Use the exact acceptance criteria provided. Do not replace them with generic placeholders like 'solve the user's latest request'. Deep review should resolve each criterion into a binary outcome whenever the visible evidence is sufficient."
    : "Use the exact acceptance criteria provided. Do not replace them with generic placeholders like 'solve the user's latest request'. If one criterion is still unclear, name that concrete criterion directly."
}

function responseIsMostlyCode(responseText: string) {
  const stripped = normalizeWhitespace(
    responseText
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
  )
  return stripped.length < 80
}

function hasAllSignals(haystack: string, patterns: RegExp[]) {
  return patterns.every((pattern) => pattern.test(haystack))
}

function criterionSatisfiedFromText(
  criterion: string,
  haystack: string,
  validationHaystack: string,
  responseSummary: AfterPipelineRequest["response_summary"]
) {
  const normalizedCriterion = normalizeForMatch(criterion)

  if (!haystack) return false
  if (criterionExplicitlyUnproven(criterion, responseSummary)) return false

  if (/return only/i.test(criterion) && /html|code block|markdown code block/i.test(criterion)) {
    return responseSummary.has_code_blocks
  }

  if (/no explanations/i.test(criterion)) {
    return responseSummary.has_code_blocks && responseIsMostlyCode(responseSummary.response_text)
  }

  if (/red\/yellow\/green button|strength button/i.test(criterion) && /textarea|chat textarea|prompt area/i.test(criterion)) {
    return hasAllSignals(haystack, [
      /\b(button|badge|icon|launcher|trigger|chip)\b/i,
      /\b(visible|appear(?:s|ed)?|show(?:s|ed)? up|render(?:s|ed)?|display(?:s|ed)?)\b/i,
      /\b(textarea|chat|prompt|composer|input|editor)\b/i
    ])
  }

  if (/opens the optimize panel|llm-generated questions|strength badge/i.test(criterion)) {
    return (
      hasAllSignals(haystack, [
        /\b(click(?:ing)?|tap(?:ping)?|press(?:ing|ed)?|select(?:ing|ed)?)\b/i,
        /\b(open(?:s|ed)?|show(?:s|ed)?|launch(?:es|ed)?|bring(?:s|ing)? up)\b/i,
        /\b(panel|popup|optimi[sz]e|optimizer|drawer|sheet|modal|popover)\b/i
      ]) &&
      /\b(question(?:s)?|follow(?:-| )?ups?|clarification(?:s)?|badge|strength)\b/i.test(haystack)
    )
  }

  if (/answer questions and receive a generated improved prompt with acceptance criteria/i.test(criterion)) {
    return hasAllSignals(haystack, [
      /\b(answer(?:ed|ing)?|reply(?:ing)?|respond(?:ing)?)\b/i,
      /\b(question(?:s)?|follow(?:-| )?ups?|clarification(?:s)?)\b/i,
      /\b(receiv(?:e|es|ed|ing)|get(?:s|ting)?|generate(?:d|s|ing)?|return(?:s|ed)?|give(?:s|n)?|show(?:s|ed)?)\b/i,
      /\b(improved prompt|rewritten prompt|refined prompt|updated prompt|new prompt)\b/i,
      /\b(acceptance criteria|criteria)\b/i
    ])
  }

  if (/replace button injects|text visibly updates|injects the improved prompt/i.test(criterion)) {
    return hasAllSignals(haystack, [
      /\b(replace(?: button)?)\b/i,
      /\b(inject(?:s|ed|ing)?|insert(?:s|ed|ing)?|write(?:s|n)?(?: [a-z0-9\s]{0,40})? back|put(?:s|ting)?(?: [a-z0-9\s]{0,40})? back|paste(?:s|d|ing)?|copy(?:ies|ied|ing)?)\b/i,
      /\b(textarea|composer|input|prompt text|chat box|editor)\b/i,
      /\b(update(?:s|d|ing)?|change(?:s|d|ing)?|visible text|text visibly update(?:s|d)?|text change(?:s|d)?)\b/i
    ])
  }

  if (/popup opens|auth state|usage|strengthen tab works end-to-end/i.test(criterion)) {
    return (
      hasAllSignals(haystack, [
        /\b(popup|extension icon|extension popup)\b/i,
        /\b(open(?:s|ed)?|show(?:s|ed)?|visible)\b/i,
        /\b(auth state|sign(?:ed)?(?:-| )in(?:-| )state|signed(?:-| )in|login state)\b/i,
        /\b(usage|quota|credits|meter)\b/i,
        /\b(strengthen(?: tab| flow)?|end(?:-| )to(?:-| )end|works|completes)\b/i
      ]) ||
      hasAllSignals(haystack, [
        /\b(popup|extension popup)\b/i,
        /\b(sign(?:ed)?(?:-| )in|auth|login)\b/i,
        /\b(usage|quota|credits|meter)\b/i,
        /\b(strengthen|end(?:-| )to(?:-| )end|works|completes)\b/i
      ])
    )
  }

  if (/no chrome devtools errors|no console errors|devtools errors/i.test(criterion)) {
    return (
      /\b(no|zero)\b[\w\s-]{0,40}\b(devtools|console)\s+errors?\b/i.test(haystack) ||
      /\bno\s+errors?\b/i.test(validationHaystack)
    )
  }

  if (/spa navigation|re-appears|survive/i.test(criterion)) {
    return hasAllSignals(haystack, [
      /\b(spa navigation|soft navigation|navigation)\b/i,
      /\b(survive(?:s|d)?|re-appears?|stays visible)\b/i
    ])
  }

  const tokens = extractMeaningfulTokens(normalizedCriterion).filter(
    (token) =>
      !["return", "only", "complete", "updated", "html", "block", "markdown", "already", "implemented"].includes(token)
  )

  if (!tokens.length) return false

  const matched = tokens.filter((token) => haystack.includes(token))
  return matched.length >= Math.min(2, tokens.length) || matched.length / tokens.length >= 0.66
}

function criterionExplicitlyUnproven(criterion: string, responseSummary: AfterPipelineRequest["response_summary"]) {
  const normalizedCriterion = normalizeForMatch(criterion)
  const uncertaintyPatterns = [
    /did not fully verify/i,
    /not fully verify/i,
    /did not verify/i,
    /not yet verify/i,
    /still needs follow up/i,
    /still needs follow-up/i,
    /could not confirm/i,
    /not confirmed/i,
    /unconfirmed/i,
    /unproven/i,
    /still needs proof/i
  ]

  const uncertaintySentences = responseSummary.response_text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((sentence) => uncertaintyPatterns.some((pattern) => pattern.test(sentence)))

  const uncertainty = normalizeForMatch(
    [...uncertaintySentences, ...responseSummary.uncertainty_signals, ...responseSummary.failure_signals].join(" ")
  )

  if (!uncertaintyPatterns.some((pattern) => pattern.test(uncertainty))) {
    return false
  }

  if (/answer questions|generated improved prompt|acceptance criteria/i.test(criterion)) {
    return /\b(question-answering|answer questions?|improved prompt|acceptance criteria)\b/i.test(uncertainty)
  }

  if (/replace button|injects the improved prompt|text visibly updates/i.test(criterion)) {
    return /\b(replace button|inject(?:s|ed)?|textarea|text visibly updates?)\b/i.test(uncertainty)
  }

  if (/popup opens|auth state|usage|strengthen tab/i.test(criterion)) {
    return /\b(popup|auth state|usage|strengthen tab)\b/i.test(uncertainty)
  }

  const tokens = extractMeaningfulTokens(normalizedCriterion).filter((token) => token.length >= 4)
  const matchedTokens = tokens.filter((token) => uncertainty.includes(token))
  return matchedTokens.length >= Math.min(2, tokens.length)
}

function quickCriterionSatisfied(criterion: string, responseSummary: AfterPipelineRequest["response_summary"]) {
  const haystack = normalizeForMatch(responseSummary.response_text)
  const validationHaystack = normalizeForMatch(
    [
      ...responseSummary.validation_signals,
      ...responseSummary.success_signals,
      ...responseSummary.change_claims,
      ...responseSummary.mentioned_files
    ].join(" ")
  )

  return criterionSatisfiedFromText(criterion, haystack, validationHaystack, responseSummary)
}

function extractCodeBlocks(rawResponse: string) {
  const matches = [...rawResponse.matchAll(/```[\s\S]*?```/g)]
  return matches
    .map((match) => normalizeWhitespace(match[0]))
    .filter(Boolean)
    .map((block) => limitText(block, EVIDENCE_EXCERPT_LIMIT))
}

function extractParagraphs(rawResponse: string) {
  return rawResponse
    .split(/\n{2,}/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean)
}

function extractClaimSentences(rawResponse: string) {
  return rawResponse
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normalizeWhitespace(sentence))
    .filter((sentence) => /\b(i fixed|i updated|i changed|this should|this now|i implemented|the issue was|i added|i removed)\b/i.test(sentence))
}

function candidateMatchesIntent(candidate: string, intent: AttemptIntent) {
  const haystack = candidate.toLowerCase()
  const goalTokens = extractMeaningfulTokens(intent.goal).slice(0, 6)
  const constraintTokens = intent.constraints.flatMap((item) => extractMeaningfulTokens(item)).slice(0, 6)
  const criteriaTokens = intent.acceptance_criteria.flatMap((item) => extractMeaningfulTokens(item)).slice(0, 8)
  return [...goalTokens, ...constraintTokens, ...criteriaTokens].some((token) => haystack.includes(token))
}

function buildEvidenceCandidates(
  rawResponse: string,
  intent: AttemptIntent,
  responseSummary: AfterPipelineRequest["response_summary"],
  changedFiles: string[] = [],
  errorSummary = ""
) {
  const candidates: EvidenceCandidate[] = []
  const seen = new Set<string>()

  const addCandidate = (candidate: EvidenceCandidate) => {
    const key = `${candidate.type}:${candidate.excerpt}`
    if (!candidate.excerpt || seen.has(key)) return
    seen.add(key)
    candidates.push(candidate)
  }

  extractClaimSentences(rawResponse)
    .slice(0, 4)
    .forEach((sentence, index) =>
      addCandidate({
        id: `claim-${index + 1}`,
        type: "claim",
        label: `Claim sentence ${index + 1}`,
        excerpt: limitText(sentence, EVIDENCE_EXCERPT_LIMIT)
      })
    )

  responseSummary.change_claims.slice(0, 3).forEach((claim, index) =>
    addCandidate({
      id: `change-claim-${index + 1}`,
      type: "claim",
      label: `Claimed change ${index + 1}`,
      excerpt: limitText(claim, EVIDENCE_EXCERPT_LIMIT)
    })
  )

  extractCodeBlocks(rawResponse)
    .slice(0, 3)
    .forEach((block, index) =>
      addCandidate({
        id: `code-${index + 1}`,
        type: "code",
        label: `Code block ${index + 1}`,
        excerpt: block
      })
    )

  const paragraphs = extractParagraphs(rawResponse)
  const paragraphsBySignal = paragraphs.filter(
    (paragraph) =>
      candidateMatchesIntent(paragraph, intent) ||
      /\b(file|component|function|handler|render|style|popup|button|error|fix|updated|changed)\b/i.test(paragraph)
  )

  paragraphsBySignal.slice(0, 4).forEach((paragraph, index) =>
    addCandidate({
      id: `paragraph-${index + 1}`,
      type: "paragraph",
      label: `Relevant paragraph ${index + 1}`,
      excerpt: limitText(paragraph, EVIDENCE_EXCERPT_LIMIT)
    })
  )

  responseSummary.mentioned_files.slice(0, 4).forEach((file, index) =>
    addCandidate({
      id: `file-${index + 1}`,
      type: "file",
      label: `Mentioned file ${index + 1}`,
      excerpt: file
    })
  )

  changedFiles.slice(0, 3).forEach((file, index) =>
    addCandidate({
      id: `changed-file-${index + 1}`,
      type: "file",
      label: `Changed file hint ${index + 1}`,
      excerpt: file
    })
  )

  if (errorSummary) {
    addCandidate({
      id: "error-summary",
      type: "constraint",
      label: "Visible error summary",
      excerpt: limitText(errorSummary, EVIDENCE_EXCERPT_LIMIT)
    })
  }

  intent.constraints
    .filter((constraint) => constraintMentioned(constraint, responseSummary) || candidateMatchesIntent(constraint, intent))
    .slice(0, 2)
    .forEach((constraint, index) =>
      addCandidate({
        id: `constraint-${index + 1}`,
        type: "constraint",
        label: `Constraint reference ${index + 1}`,
        excerpt: limitText(constraint, EVIDENCE_EXCERPT_LIMIT)
      })
    )

  return candidates.slice(0, 8)
}

function deepCriterionSatisfiedFromEvidence(
  criterion: string,
  evidenceText: string,
  responseSummary: AfterPipelineRequest["response_summary"]
) {
  const haystack = normalizeForMatch(evidenceText)
  const validationHaystack = normalizeForMatch(
    [evidenceText, ...responseSummary.validation_signals, ...responseSummary.success_signals].join(" ")
  )

  return criterionSatisfiedFromText(criterion, haystack, validationHaystack, responseSummary)
}

function buildFrozenDeepStage2FromEvidence(
  reviewContract: ReviewContract,
  intent: AttemptIntent,
  stage1: ReturnType<typeof Stage1OutputSchema.parse>,
  selectedEvidence: EvidenceCandidate[],
  responseSummary: AfterPipelineRequest["response_summary"]
) {
  const evidenceText = selectedEvidence.map((candidate) => candidate.excerpt).join(" ")
  const addressedCriteria = reviewContract.criteria
    .filter((criterion) => deepCriterionSatisfiedFromEvidence(criterion.label, evidenceText, responseSummary))
    .map((criterion) => criterion.label)
  const missingCriteria = reviewContract.criteria
    .filter((criterion) => !addressedCriteria.includes(criterion.label))
    .map((criterion) => criterion.label)

  return Stage2OutputSchema.parse({
    addressed_criteria: addressedCriteria,
    missing_criteria: missingCriteria,
    constraint_risks: [],
    problem_fit:
      !addressedCriteria.length && !hasGoalEvidence(intent.goal, responseSummary)
        ? "wrong_direction"
        : missingCriteria.length
          ? "partial"
          : "correct",
    analysis_notes: dedupe(
      [
        selectedEvidence.length ? `Deep review inspected ${selectedEvidence.length} targeted evidence excerpt${selectedEvidence.length > 1 ? "s" : ""}.` : "",
        addressedCriteria.length ? `Direct support found for: ${summarizeChecklistLabels(addressedCriteria)}.` : "",
        missingCriteria.length ? `Deep review still could not directly verify: ${missingCriteria[0]}.` : "",
        stage1.response_mode === "uncertain" ? "The assistant still sounded uncertain in the visible answer." : ""
      ],
      4
    )
  })
}

function shouldInspectDetails(intent: AttemptIntent, responseSummary: AfterPipelineRequest["response_summary"], stage1: ReturnType<typeof Stage1OutputSchema.parse>) {
  const hasStrictIntent = intent.constraints.length > 0 || intent.acceptance_criteria.length > 1
  const codeHeavyTask = isCodeHeavyTask(intent)

  return (
    codeHeavyTask ||
    responseSummary.has_code_blocks ||
    responseSummary.mentioned_files.length > 0 ||
    responseSummary.change_claims.length > 0 ||
    responseSummary.validation_signals.length > 0 ||
    responseSummary.success_signals.length > 0 ||
    hasStrictIntent ||
    stage1.response_mode === "uncertain"
  )
}

function isCodeHeavyTask(intent: AttemptIntent) {
  return (
    intent.task_type === "debug" ||
    intent.task_type === "build" ||
    intent.task_type === "refactor" ||
    intent.task_type === "create_ui"
  )
}

function sanitizeEvidenceTargeting(value: unknown) {
  const parsed = EvidenceTargetingSchema.safeParse(value)
  if (parsed.success) return parsed.data

  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  const selectedIds = Array.isArray(candidate.selected_candidate_ids)
    ? candidate.selected_candidate_ids.filter((item): item is string => typeof item === "string").slice(0, 4)
    : []
  const riskFlags = Array.isArray(candidate.risk_flags)
    ? candidate.risk_flags.filter((item): item is string => typeof item === "string").slice(0, 4)
    : []
  const inspectionGoal =
    typeof candidate.inspection_goal === "string"
      ? limitText(candidate.inspection_goal.trim(), 180)
      : ""

  return EvidenceTargetingSchema.parse({
    selected_candidate_ids: selectedIds,
    risk_flags: riskFlags,
    inspection_goal: inspectionGoal
  })
}

function buildFrozenDeepEvidenceTargeting(
  reviewContract: ReviewContract,
  candidates: EvidenceCandidate[],
  responseSummary: AfterPipelineRequest["response_summary"],
  baselineChecklist: Array<z.infer<typeof AcceptanceChecklistItemSchema>> = []
) {
  const baselineStatusByLabel = new Map(
    baselineChecklist.map((item) => [normalizeForMatch(item.label), item.status])
  )
  const prioritizedCandidates = candidates
    .map((candidate) => ({
      candidate,
      score: reviewContract.criteria.reduce((score, criterion) => {
        const matchScore = criterionMatchScore(candidate.excerpt, criterion.label)
        if (matchScore < 55) return score

        const previousStatus = baselineStatusByLabel.get(normalizeForMatch(criterion.label))
        const unresolvedBoost = previousStatus === "not_sure" || previousStatus === "missed" ? 30 : 0
        const validationBoost = criterion.layer === "validation" ? 15 : 0
        const typeBoost =
          candidate.type === "paragraph" ? 18 : candidate.type === "claim" ? 12 : candidate.type === "code" ? 10 : 0

        return score + matchScore + unresolvedBoost + validationBoost + typeBoost
      }, 0)
    }))
    .sort((left, right) => right.score - left.score)

  const selectedCandidates = prioritizedCandidates.some((item) => item.score > 0)
    ? prioritizedCandidates.map((item) => item.candidate)
    : candidates

  return EvidenceTargetingSchema.parse({
    selected_candidate_ids: selectedCandidates.slice(0, 4).map((candidate) => candidate.id),
    risk_flags: dedupe(
      [
        responseSummary.success_signals.length ? "success_claim_needs_evidence" : "",
        responseSummary.validation_signals.length ? "validation_claim_needs_evidence" : "",
        responseSummary.uncertainty_signals.length ? "uncertainty_visible_in_answer" : ""
      ],
      4
    ),
    inspection_goal: limitText(
      `Verify the frozen checklist with direct answer evidence: ${reviewContract.criteria
        .map((item) => item.label)
        .slice(0, 2)
        .join(" | ")}`,
      180
    )
  })
}

function normalizeArtifactContext(artifactContext: AfterPipelineRequest["artifact_context"] | undefined): NormalizedArtifactBundle {
  const parsed = ArtifactContextSchema.safeParse(artifactContext)
  const context: ArtifactContext = parsed.success
    ? parsed.data
    : ArtifactContextSchema.parse({ mode: "none", artifacts: [] })
  const domObservations: DomObservation[] = []
  const responseTexts: string[] = []
  const responseCodeBlocks: string[] = []
  const changedFileLabels: string[] = []
  const outputSnippets: string[] = []
  const errorSummaries: string[] = []
  const buildOrTestTexts: string[] = []
  const runtimeSignals: string[] = []
  const extensionEvents: NormalizedArtifactBundle["extensionEvents"] = []
  const popupSnapshots: NormalizedArtifactBundle["popupSnapshots"] = []

  for (const artifact of context.artifacts) {
    const content = normalizeWhitespace(artifact.content)
    if (!content) continue

    if (artifact.type === "response_text") {
      responseTexts.push(content)
      continue
    }

    if (artifact.type === "response_code_blocks") {
      responseCodeBlocks.push(content)
      continue
    }

    if (artifact.type === "changed_file_labels") {
      changedFileLabels.push(
        ...content
          .split(/\r?\n|,\s*/)
          .map((item) => normalizeWhitespace(item))
          .filter(Boolean)
      )
      continue
    }

    if (artifact.type === "visible_output_snippet") {
      outputSnippets.push(content)
      continue
    }

    if (artifact.type === "visible_error_summary") {
      errorSummaries.push(content)
      continue
    }

    if (artifact.type === "visible_build_or_test_text") {
      buildOrTestTexts.push(content)
      continue
    }

    if (artifact.type === "visible_runtime_signals") {
      runtimeSignals.push(content)
      continue
    }

    if (artifact.type === "dom_observations") {
      const probeId =
        typeof artifact.metadata.probe_id === "string" ? artifact.metadata.probe_id : artifact.source || "dom_probe"
      const target = typeof artifact.metadata.target === "string" ? artifact.metadata.target : artifact.surface_scope || "dom"
      const observed = artifact.metadata.observed === true
      const confidence =
        typeof artifact.metadata.confidence === "number"
          ? Math.max(0, Math.min(1, artifact.metadata.confidence))
          : observed
            ? 0.7
            : 0.35
      const details =
        typeof artifact.metadata.details === "string" ? normalizeWhitespace(artifact.metadata.details) : content

      domObservations.push({
        probeId,
        target,
        observed,
        confidence,
        details,
        content
      })
      continue
    }

    if (artifact.type === "extension_event_trace") {
      extensionEvents.push({
        eventType: typeof artifact.metadata.event_type === "string" ? artifact.metadata.event_type : artifact.source,
        status: typeof artifact.metadata.status === "string" ? artifact.metadata.status : "observed",
        detail: content,
        route: typeof artifact.metadata.route === "string" ? artifact.metadata.route : "",
        content
      })
      continue
    }

    if (artifact.type === "popup_state_snapshot") {
      popupSnapshots.push({
        statusText: typeof artifact.metadata.status_text === "string" ? artifact.metadata.status_text : "",
        retryCount: typeof artifact.metadata.retry_count === "number" ? artifact.metadata.retry_count : 0,
        lastIntent: typeof artifact.metadata.last_intent === "string" ? artifact.metadata.last_intent : "",
        visibleText: content,
        authStateText: typeof artifact.metadata.auth_state_text === "string" ? artifact.metadata.auth_state_text : "",
        usageText: typeof artifact.metadata.usage_text === "string" ? artifact.metadata.usage_text : "",
        strengthenVisible: artifact.metadata.strengthen_visible === true,
        hostHint: typeof artifact.metadata.host_hint === "string" ? artifact.metadata.host_hint : ""
      })
    }
  }

  return {
    mode: context.mode,
    surface: context.surface,
    checkedArtifactTypes: dedupe(context.artifacts.map((artifact) => artifact.type), 8) as ArtifactType[],
    responseTexts: dedupe(responseTexts, 6),
    responseCodeBlocks: dedupe(responseCodeBlocks, 6),
    changedFileLabels: dedupe(changedFileLabels, 8),
    outputSnippets: dedupe(outputSnippets, 4),
    errorSummaries: dedupe(errorSummaries, 4),
    buildOrTestTexts: dedupe(buildOrTestTexts, 4),
    runtimeSignals: dedupe(runtimeSignals, 4),
    domObservations,
    extensionEvents,
    popupSnapshots
  }
}

function evidencePolicyForCriterion(label: string): CriterionEvidencePolicy {
  if (/red\/yellow\/green button|strength button/i.test(label) && /textarea|chat textarea|prompt area/i.test(label)) {
    return { primary: ["dom_ui_state"] }
  }

  if (/opens the optimize panel|llm-generated questions|strength badge/i.test(label)) {
    return { primary: ["dom_ui_state"] }
  }

  if (/answer questions and receive a generated improved prompt with acceptance criteria/i.test(label)) {
    return {
      primary: ["interaction_trace", "dom_ui_state"],
      fallbackIfPrimaryUnavailable: ["response_claim"]
    }
  }

  if (/replace button injects|text visibly updates|injects the improved prompt/i.test(label)) {
    return { primary: ["interaction_trace", "dom_ui_state"] }
  }

  if (/popup opens|auth state|usage|strengthen tab works end-to-end/i.test(label)) {
    return { primary: ["popup_state", "dom_ui_state"] }
  }

  if (/no chrome devtools errors|no console errors|devtools errors/i.test(label)) {
    return { primary: ["runtime_error_state"] }
  }

  if (/spa navigation|re-appears|survive/i.test(label)) {
    return { primary: ["interaction_trace", "dom_ui_state", "runtime_error_state"] }
  }

  if (/dist|rebuild|build|typecheck|test|documented|automated/i.test(label)) {
    return { primary: ["build_or_test_output", "changed_files"] }
  }

  return {
    primary: ["response_claim"],
    fallbackIfPrimaryUnavailable: ["response_code", "changed_files", "interaction_trace"]
  }
}

function hasEvidenceTypeAvailable(bundle: NormalizedArtifactBundle, evidenceType: DeepCriterionEvidenceType) {
  if (evidenceType === "response_claim") {
    return bundle.responseTexts.length > 0 || bundle.outputSnippets.length > 0
  }

  if (evidenceType === "response_code") {
    return bundle.responseCodeBlocks.length > 0
  }

  if (evidenceType === "changed_files") {
    return bundle.changedFileLabels.length > 0
  }

  if (evidenceType === "runtime_error_state") {
    return bundle.runtimeSignals.length > 0 || bundle.errorSummaries.length > 0
  }

  if (evidenceType === "build_or_test_output") {
    return bundle.buildOrTestTexts.length > 0 || bundle.outputSnippets.length > 0
  }

  if (evidenceType === "interaction_trace") {
    return bundle.extensionEvents.length > 0
  }

  if (evidenceType === "popup_state") {
    return bundle.popupSnapshots.length > 0
  }

  return bundle.domObservations.length > 0
}

function domObservationsForCriterion(label: string, bundle: NormalizedArtifactBundle) {
  const probeIds: string[] = []

  if (/red\/yellow\/green button|strength button/i.test(label) && /textarea|chat textarea|prompt area/i.test(label)) {
    probeIds.push("prompt_textarea_found", "launcher_near_textarea")
  } else if (/opens the optimize panel|llm-generated questions|strength badge/i.test(label)) {
    probeIds.push("optimize_panel_visible", "strength_badge_visible", "question_ui_visible")
  } else if (/answer questions and receive a generated improved prompt with acceptance criteria/i.test(label)) {
    probeIds.push("question_ui_visible", "improved_prompt_visible_in_textarea")
  } else if (/replace button injects|text visibly updates|injects the improved prompt/i.test(label)) {
    probeIds.push("replace_button_visible", "improved_prompt_visible_in_textarea")
  } else if (/popup opens|auth state|usage|strengthen tab works end-to-end/i.test(label)) {
    probeIds.push("popup_visible", "auth_state_visible", "usage_visible", "strengthen_flow_visible")
  } else if (/spa navigation|re-appears|survive/i.test(label)) {
    probeIds.push("spa_navigation_signal_visible", "launcher_near_textarea")
  }

  if (!probeIds.length) return []

  return probeIds
    .map((probeId) => bundle.domObservations.find((observation) => observation.probeId === probeId))
    .filter((observation): observation is DomObservation => Boolean(observation))
}

function responseClaimText(bundle: NormalizedArtifactBundle, responseSummary: AfterPipelineRequest["response_summary"]) {
  return normalizeWhitespace(
    [
      ...bundle.responseTexts,
      ...bundle.outputSnippets,
      responseSummary.response_text,
      ...responseSummary.change_claims,
      ...responseSummary.success_signals,
      ...responseSummary.validation_signals
    ].join(" ")
  )
}

function runtimeEvidenceText(bundle: NormalizedArtifactBundle) {
  return normalizeWhitespace(
    [
      ...bundle.runtimeSignals,
      ...bundle.errorSummaries,
      ...bundle.extensionEvents
        .filter((event) => event.eventType === "runtime_error" || event.eventType === "unhandled_rejection")
        .map((event) => event.detail)
    ].join(" ")
  )
}

function buildOrTestEvidenceText(bundle: NormalizedArtifactBundle) {
  return normalizeWhitespace([...bundle.buildOrTestTexts, ...bundle.outputSnippets].join(" "))
}

function changedFilesEvidenceText(bundle: NormalizedArtifactBundle) {
  return normalizeWhitespace(bundle.changedFileLabels.join(" "))
}

function explainEvidenceType(evidenceType: DeepCriterionEvidenceType) {
  if (evidenceType === "dom_ui_state") return "visible DOM/UI artifacts"
  if (evidenceType === "runtime_error_state") return "visible runtime/error artifacts"
  if (evidenceType === "build_or_test_output") return "visible build/test artifacts"
  if (evidenceType === "changed_files") return "changed-file artifacts"
  if (evidenceType === "interaction_trace") return "extension interaction traces"
  if (evidenceType === "popup_state") return "popup state artifacts"
  if (evidenceType === "response_code") return "response code artifacts"
  return "response evidence"
}

function summarizeChecklistStatusForFinding(status: ChecklistItem["status"]) {
  if (status === "met") return "verified"
  if (status === "missed") return "missing"
  if (status === "blocked") return "blocked"
  return "left unresolved"
}

function friendlyArtifactLabel(type: ArtifactType) {
  switch (type) {
    case "response_text":
      return "response"
    case "response_code_blocks":
      return "code blocks"
    case "dom_observations":
      return "DOM signals"
    case "extension_event_trace":
      return "interaction telemetry"
    case "popup_state_snapshot":
      return "popup telemetry"
    case "visible_output_snippet":
      return "visible output snippets"
    case "visible_error_summary":
      return "visible error summary"
    case "visible_build_or_test_text":
      return "visible build/test snippets"
    case "visible_runtime_signals":
      return "visible runtime signals"
    case "changed_file_labels":
      return "changed file labels"
    default:
      return String(type).replace(/_/g, " ")
  }
}

function titleCaseConfidence(confidence: "low" | "medium" | "high") {
  if (confidence === "high") return "High"
  if (confidence === "medium") return "Medium"
  return "Low"
}

function buildCheckedArtifactLabels(
  deepAnalysisRequested: boolean,
  bundle: NormalizedArtifactBundle,
  responseSummary: AfterPipelineRequest["response_summary"]
) {
  if (deepAnalysisRequested) {
    return dedupe(bundle.checkedArtifactTypes.map((type) => limitText(friendlyArtifactLabel(type), ARTIFACT_LABEL_MAX)), 8)
  }

  const labels = ["response"]
  if (responseSummary.has_code_blocks) labels.push("code blocks")
  if (responseSummary.mentioned_files.length) labels.push("mentioned files")
  return dedupe(labels.map((item) => limitText(item, ARTIFACT_LABEL_MAX)), 8)
}

function buildUncheckedArtifactLabels(
  deepAnalysisRequested: boolean,
  bundle: NormalizedArtifactBundle,
  reviewContract: ReviewContract
) {
  const unchecked: string[] = []
  const checked = new Set(bundle.checkedArtifactTypes)
  const needsEvidenceType = (evidenceType: DeepCriterionEvidenceType) =>
    reviewContract.criteria.some((criterion) => {
      const policy = evidencePolicyForCriterion(criterion.label)
      return policy.primary.includes(evidenceType) || (policy.fallbackIfPrimaryUnavailable ?? []).includes(evidenceType)
    })

  if (!deepAnalysisRequested) {
    return [
      "DOM/UI signals",
      "interaction telemetry",
      "popup telemetry",
      "live runtime in the workspace"
    ]
  }

  if (needsEvidenceType("dom_ui_state") && !checked.has("dom_observations")) {
    unchecked.push("visible UI state on the page")
  }
  if (needsEvidenceType("interaction_trace") && !checked.has("extension_event_trace")) {
    unchecked.push("interaction telemetry for the user flow")
  }
  if (needsEvidenceType("popup_state") && !checked.has("popup_state_snapshot")) {
    unchecked.push("popup-open behavior")
  }
  if (needsEvidenceType("runtime_error_state") && !checked.has("visible_runtime_signals") && !checked.has("visible_error_summary")) {
    unchecked.push("live runtime behavior in the workspace")
  }
  if (needsEvidenceType("build_or_test_output") && !checked.has("visible_build_or_test_text")) {
    unchecked.push("actual workspace build/test output")
  }
  if (checked.size > 0) {
    unchecked.push("live runtime in the Replit workspace")
  }

  return dedupe(unchecked.map((item) => limitText(item, ARTIFACT_LABEL_MAX)), 8)
}

function buildBlockedOrUnprovenItems(checklist: Array<z.infer<typeof AcceptanceChecklistItemSchema>>) {
  return checklist
    .filter((item) => item.status !== "met")
    .map((item) => limitText(normalizeCriterionLabel(item.label), CRITERION_LABEL_MAX))
    .slice(0, 6)
}

function sanitizeReviewContractForSchema(reviewContract: ReviewContract): ReviewContract {
  return ReviewContractSchema.parse({
    ...reviewContract,
    criteria: reviewContract.criteria.slice(0, MAX_REVIEW_CRITERIA).map((criterion, index) => ({
      ...criterion,
      label: limitText(normalizeCriterionLabel(criterion.label), CRITERION_LABEL_MAX),
      priority: Math.max(1, Math.min(criterion.priority || index + 1, MAX_REVIEW_CRITERIA))
    }))
  })
}

function sanitizeAcceptanceChecklistForSchema(checklist: Array<z.infer<typeof AcceptanceChecklistItemSchema>>) {
  return checklist.slice(0, MAX_REVIEW_CRITERIA).map((item) =>
    AcceptanceChecklistItemSchema.parse({
      ...item,
      label: limitText(normalizeCriterionLabel(item.label), CRITERION_LABEL_MAX)
    })
  )
}

function sanitizeDeepVerificationsForSchema(verifications: z.infer<typeof DeepCriterionVerificationSchema>[]) {
  return verifications.slice(0, MAX_REVIEW_CRITERIA).map((item) =>
    DeepCriterionVerificationSchema.parse({
      ...item,
      criterion_label: limitText(normalizeCriterionLabel(item.criterion_label), CRITERION_LABEL_MAX),
      artifact_findings: item.artifact_findings.map((finding) => limitText(finding, CRITERION_LABEL_MAX)).slice(0, 6),
      explanation: limitText(item.explanation, CRITERION_LABEL_MAX)
    })
  )
}

const CONFIDENCE_RANK: Record<z.infer<typeof AfterConfidenceSchema>, number> = {
  low: 1,
  medium: 2,
  high: 3
}

function displayDecisionLabel(
  params: {
    decision: z.infer<typeof AfterPipelineResponseSchema>["decision"]
    deepAnalysisRequested: boolean
    metCount: number
    blockedCount: number
  }
) {
  const { decision, deepAnalysisRequested, metCount, blockedCount } = params
  if (deepAnalysisRequested) {
    switch (decision) {
      case "Safe to proceed":
        return "Verified enough to continue"
      case "Needs refinement":
        return "Needs refinement"
      case "Likely wrong direction":
        return "Likely wrong direction"
      default:
        return metCount > 0 ? "Looks correct, but not proven" : blockedCount > 0 ? "Not verified yet" : "Missing visible proof"
    }
  }

  switch (decision) {
    case "Safe to proceed":
      return "Likely aligned"
    case "Needs refinement":
      return "Needs refinement"
    case "Likely wrong direction":
      return "Likely off track"
    default:
      return "Not clear yet"
  }
}

function buildConfidenceTrend(
  current: z.infer<typeof AfterConfidenceSchema>,
  baseline?: z.infer<typeof AfterConfidenceSchema>
) {
  if (!baseline) return "flat" as const
  if (CONFIDENCE_RANK[current] > CONFIDENCE_RANK[baseline]) return "up" as const
  if (CONFIDENCE_RANK[current] < CONFIDENCE_RANK[baseline]) return "down" as const
  return "flat" as const
}

function buildDeepDeltaSummary(params: {
  baselineChecklist: Array<z.infer<typeof AcceptanceChecklistItemSchema>>
  deepChecklist: Array<z.infer<typeof AcceptanceChecklistItemSchema>>
  confidenceTrend: z.infer<typeof ConfidenceTrendSchema>
  baselineDecision?: z.infer<typeof AfterDecisionSchema>
  checkedArtifacts: string[]
  contradictionCount: number
}) {
  const { baselineChecklist, deepChecklist, confidenceTrend, baselineDecision, checkedArtifacts, contradictionCount } = params
  const baselineMap = new Map(baselineChecklist.map((item) => [normalizeForMatch(item.label), item.status]))
  const changed = deepChecklist.filter((item) => {
    const previous = baselineMap.get(normalizeForMatch(item.label))
    return previous && previous !== item.status
  })
  const changedLabels = changed.map((item) => normalizeCriterionLabel(item.label)).filter(Boolean)
  const sampleLabel = changedLabels[0]
  const artifactText = checkedArtifacts[0] ? ` after checking ${checkedArtifacts[0]}` : " after checking stronger visible evidence"

  if (!baselineChecklist.length) {
    return `Deep validation rechecked the same target${artifactText}.`
  }

  if (confidenceTrend === "down" && changedLabels.length) {
    return `Deep reduced confidence because visible evidence did not confirm: ${summarizeChecklistLabels(changedLabels, 2)}.`
  }

  if (confidenceTrend === "up" && changedLabels.length) {
    return `Deep strengthened the earlier read with visible support for: ${summarizeChecklistLabels(changedLabels, 2)}.`
  }

  if (changedLabels.length) {
    return `Deep kept the same target but tightened ${changedLabels.length} checklist result${changedLabels.length > 1 ? "s" : ""}; for example, ${sampleLabel}.`
  }

  if (confidenceTrend === "down") {
    return contradictionCount > 0
      ? "Deep reduced confidence because stronger checks found a contradiction."
      : "Deep reduced confidence because stronger checks still did not verify key steps."
  }

  if (confidenceTrend === "up") {
    return "Deep strengthened the earlier read with stronger visible evidence."
  }

  if (baselineDecision === "Safe to proceed") {
    return "Deep checked the same checklist with stronger visible evidence and kept the earlier direction."
  }

  return `Deep validated the same checklist${artifactText}.`
}

function buildReviewModeExplainer(params: {
  deepAnalysisRequested: boolean
  confidenceTrend: z.infer<typeof ConfidenceTrendSchema>
  contradictionCount: number
  allCriteriaMet: boolean
  blockedItems: Array<z.infer<typeof AcceptanceChecklistItemSchema>>
}) {
  const { deepAnalysisRequested, confidenceTrend, contradictionCount, allCriteriaMet, blockedItems } = params

  if (!deepAnalysisRequested) {
    return "Quick read is an early, answer-based judgment."
  }

  if (confidenceTrend === "down") {
    return contradictionCount > 0
      ? "This deeper validation reduced confidence because visible evidence contradicted a claimed step."
      : "This deeper validation reduced confidence because visible evidence did not confirm one or more claimed steps."
  }

  if (confidenceTrend === "up") {
    return "This deeper validation strengthened the earlier read with visible support."
  }

  if (allCriteriaMet && blockedItems.length === 0) {
    return "This deeper validation kept the earlier direction and found enough visible support to continue."
  }

  return "This deeper validation checked the same checklist with stronger visible evidence."
}

function buildDecisionNextPrompt(params: {
  optimizedPrompt: string
  reviewContract: ReviewContract
  intent: AttemptIntent
  decision: z.infer<typeof AfterPipelineResponseSchema>["decision"]
  promptStrategy: z.infer<typeof NextPromptOutputSchema>["prompt_strategy"]
  blockedOrUnprovenItems: string[]
  contradictionCount: number
  whyBullets: string[]
  deepAnalysisRequested: boolean
  baselineDecision?: z.infer<typeof AfterDecisionSchema>
}) {
  const {
    reviewContract,
    intent,
    decision,
    promptStrategy,
    blockedOrUnprovenItems,
    contradictionCount,
    whyBullets,
    deepAnalysisRequested,
    baselineDecision
  } = params
  const focusItems = blockedOrUnprovenItems.slice(0, 2)
  const constraints = intent.constraints.filter(Boolean).slice(0, 3)
  const goalLine = `Stay inside the original goal: ${reviewContract.goal}.`
  const constraintsLine = constraints.length ? `Keep these constraints: ${constraints.join(" | ")}.` : ""
  const focusLine = focusItems.length
    ? `Focus only on these items:\n${focusItems.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
    : "Focus only on the part that still lacks proof."
  const deepTightenedEarlierRead = deepAnalysisRequested && Boolean(baselineDecision) && baselineDecision !== decision

  if (promptStrategy === "resolve_contradiction") {
    return NextPromptOutputSchema.parse({
      next_prompt: [
        goalLine,
        constraintsLine,
        deepTightenedEarlierRead ? "The earlier quick read looked aligned, but the deeper review found a proof gap." : "",
        "Your last answer and the visible evidence do not agree.",
        contradictionCount > 0 && whyBullets.length ? `Resolve this contradiction first: ${whyBullets[0]}` : "",
        focusLine,
        "Resolve only this mismatch. Do not broaden scope.",
        "Return the minimum correction and the evidence for it. If it is still not verified, say that plainly."
      ]
        .filter(Boolean)
        .join("\n\n"),
      prompt_strategy: promptStrategy,
      next_prompt_explanation:
        "This prompt forces the assistant to resolve the exact mismatch instead of wandering into a broad retry.",
      expected_outcome:
        "The assistant should resolve the mismatch or say clearly why the claim is still unverified."
    })
  }

  if (promptStrategy === "fix_missing") {
    return NextPromptOutputSchema.parse({
      next_prompt: [
        goalLine,
        constraintsLine,
        deepAnalysisRequested ? "The answer looked plausible, but the deeper review did not verify the missing step below." : "",
        focusLine,
        "Fix only that part. Do not touch parts that already look correct.",
        "Return the minimum correction and the evidence for it."
      ]
        .filter(Boolean)
        .join("\n\n"),
      prompt_strategy: promptStrategy,
      next_prompt_explanation:
        "This prompt isolates the missing requirement so the assistant stays narrow and avoids redoing good work.",
      expected_outcome:
        "The assistant should fix only the missing step and show evidence for that exact change."
    })
  }

  if (promptStrategy === "narrow_scope") {
    return NextPromptOutputSchema.parse({
      next_prompt: [
        goalLine,
        constraintsLine,
        deepTightenedEarlierRead ? "Quick looked directionally right, but the deeper review still needs proof for the exact scope below." : "",
        focusLine,
        "Return to the requested scope and ignore side work.",
        "Do not refactor unrelated files or redo parts that already look correct.",
        "Give the minimum correction and the evidence for it."
      ]
        .filter(Boolean)
        .join("\n\n"),
      prompt_strategy: promptStrategy,
      next_prompt_explanation:
        "This prompt pulls the assistant back to the original requirement and blocks unrelated changes.",
      expected_outcome:
        "The assistant should return to the requested scope and produce the minimum correction needed."
    })
  }

  return NextPromptOutputSchema.parse({
    next_prompt: [
      goalLine,
      constraintsLine,
      deepAnalysisRequested ? "The answer looked plausible, but stronger visible proof is still missing." : "",
      "Validate only the still-unproven part below before making broader changes.",
      focusLine,
      "Say what is verified, what is not verified yet, and what evidence supports each point.",
      "If you cannot verify a point, say that plainly instead of claiming success."
    ]
      .filter(Boolean)
      .join("\n\n"),
    prompt_strategy: "validate",
    next_prompt_explanation:
      "This prompt asks the assistant to prove the unresolved behavior before you make another broad retry.",
    expected_outcome:
      decision === "Safe to proceed"
        ? "The assistant should confirm the remaining proof point without changing the implementation."
        : "The assistant should clearly validate or disprove the unresolved behavior only."
  })
}

function buildDecisionPresentation(params: {
  verdict: ReturnType<typeof VerdictOutputSchema.parse>
  checklist: Array<z.infer<typeof AcceptanceChecklistItemSchema>>
  reviewContract: ReviewContract
  verifications: z.infer<typeof DeepCriterionVerificationSchema>[]
  contradictionCount: number
  deepAnalysisRequested: boolean
  baselineDecision?: z.infer<typeof AfterDecisionSchema>
  baselineConfidence?: z.infer<typeof AfterConfidenceSchema>
  baselineChecklist: Array<z.infer<typeof AcceptanceChecklistItemSchema>>
  bundle: NormalizedArtifactBundle
  responseSummary: AfterPipelineRequest["response_summary"]
  intent: AttemptIntent
  usedFallbackIntent: boolean
  detailInspection: ReturnType<typeof DetailInspectionSchema.parse>
  optimizedPrompt: string
}) {
  const {
    verdict,
    checklist,
    reviewContract,
    verifications,
    contradictionCount,
    deepAnalysisRequested,
    baselineDecision,
    baselineConfidence,
    baselineChecklist,
    bundle,
    responseSummary,
    intent,
    usedFallbackIntent,
    detailInspection,
    optimizedPrompt
  } = params

  const blockedItems = checklist.filter((item) => item.status === "blocked")
  const missedItems = checklist.filter((item) => item.status === "missed")
  const unresolvedItems = checklist.filter((item) => item.status === "not_sure")
  const metItems = checklist.filter((item) => item.status === "met")
  const coreBlocked = blockedItems.filter((item) => item.layer === "core")
  const coreMissed = missedItems.filter((item) => item.layer === "core")
  const allCriteriaMet = checklist.length > 0 && checklist.every((item) => item.status === "met")
  const checkedArtifacts = buildCheckedArtifactLabels(deepAnalysisRequested, bundle, responseSummary)
  const uncheckedArtifacts = buildUncheckedArtifactLabels(deepAnalysisRequested, bundle, reviewContract)
  const blockedOrUnprovenItems = buildBlockedOrUnprovenItems(checklist)

  let decision: z.infer<typeof AfterPipelineResponseSchema>["decision"] = "Needs refinement"
  if (verdict.status === "WRONG_DIRECTION") {
    decision = "Likely wrong direction"
  } else if (verdict.status === "UNVERIFIED" || coreBlocked.length > 0 || (blockedItems.length > 0 && coreMissed.length === 0)) {
    decision = "Not enough proof"
  } else if ((verdict.status === "SUCCESS" || verdict.status === "LIKELY_SUCCESS") && allCriteriaMet && contradictionCount === 0) {
    decision = "Safe to proceed"
  } else if (verdict.status === "PARTIAL" || verdict.status === "FAILED") {
    decision = "Needs refinement"
  } else if (verdict.status === "LIKELY_SUCCESS") {
    decision = blockedItems.length > 0 ? "Not enough proof" : "Safe to proceed"
  }

  let confidence: "low" | "medium" | "high" = "low"
  const confidenceReasons: string[] = []
  const evidenceRich =
    bundle.checkedArtifactTypes.includes("dom_observations") ||
    bundle.checkedArtifactTypes.includes("extension_event_trace") ||
    bundle.checkedArtifactTypes.includes("popup_state_snapshot")

  if (contradictionCount > 0) {
    confidence = "low"
    confidenceReasons.push("Artifact signals contradicted part of the answer.")
  } else if (decision === "Safe to proceed" && allCriteriaMet && evidenceRich && blockedItems.length === 0 && !usedFallbackIntent) {
    confidence = "high"
    confidenceReasons.push("The answer aligned with all requested criteria.")
    confidenceReasons.push("Available artifacts supported the claimed behavior.")
    confidenceReasons.push("No contradictions were detected.")
  } else if (decision === "Safe to proceed") {
    confidence = "medium"
    confidenceReasons.push("The answer looks aligned with the requested fix.")
    confidenceReasons.push("The checked artifacts supported the visible flow.")
    confidenceReasons.push("Live runtime behavior in the workspace was not directly verified.")
  } else if (decision === "Not enough proof") {
    confidence = blockedItems.length > 0 || unresolvedItems.length > 0 ? "medium" : "low"
    confidenceReasons.push("Some required steps were not verified yet from the visible evidence available here.")
    if (uncheckedArtifacts.length) {
      confidenceReasons.push(`This review did not check ${uncheckedArtifacts[0]}.`)
    }
    if (usedFallbackIntent) {
      confidenceReasons.push("The original intent had to be inferred, so the review stayed cautious.")
    }
  } else {
    confidence = coreMissed.length > 0 || contradictionCount > 0 ? "low" : "medium"
    if (coreMissed.length > 0) {
      confidenceReasons.push(`A required step still looks missing: ${normalizeCriterionLabel(coreMissed[0].label)}.`)
    } else if (missedItems.length > 0) {
      confidenceReasons.push(`At least one requested check is not verified yet: ${normalizeCriterionLabel(missedItems[0].label)}.`)
    }
    if (metItems.length > 0) {
      confidenceReasons.push(`Some of the flow does look supported: ${normalizeCriterionLabel(metItems[0].label)}.`)
    }
    if (uncheckedArtifacts.length) {
      confidenceReasons.push(`This review did not check ${uncheckedArtifacts[0]}.`)
    }
  }

  const confidenceTrend = buildConfidenceTrend(confidence, deepAnalysisRequested ? baselineConfidence : undefined)
  const decisionDisplayLabel = displayDecisionLabel({
    decision,
    deepAnalysisRequested,
    metCount: metItems.length,
    blockedCount: blockedItems.length
  })
  const reviewModeLabel = deepAnalysisRequested ? "Deep validation" : "Quick read"
  const deltaFromQuick = deepAnalysisRequested
    ? buildDeepDeltaSummary({
        baselineChecklist,
        deepChecklist: checklist,
        confidenceTrend,
        baselineDecision,
        checkedArtifacts,
        contradictionCount
      })
    : ""
  const reviewModeExplainer = buildReviewModeExplainer({
    deepAnalysisRequested,
    confidenceTrend,
    contradictionCount,
    allCriteriaMet,
    blockedItems
  })

  const whyBullets: string[] = []
  const contradiction = detailInspection.contradictions[0]
  if (contradiction) {
    whyBullets.push(limitText(contradiction, 220))
  }
  const firstMissed = verifications.find((item) => item.judgment === "missed")
  if (firstMissed) {
    whyBullets.push(limitText(firstMissed.explanation || `Could not confirm: ${firstMissed.criterion_label}.`, 220))
  }
  const firstBlocked = verifications.find((item) => item.judgment === "blocked")
  if (firstBlocked) {
    whyBullets.push(limitText(firstBlocked.explanation || `Could not verify: ${firstBlocked.criterion_label}.`, 220))
  }
  const firstMet = verifications.find((item) => item.judgment === "met")
  if (firstMet && whyBullets.length < 3) {
    whyBullets.push(limitText(firstMet.explanation || `Observed support for: ${firstMet.criterion_label}.`, 220))
  }
  if (!whyBullets.length) {
    whyBullets.push(...verdict.findings.slice(0, 3).map((item) => limitText(item, 220)))
  }

  let promptStrategy: z.infer<typeof NextPromptOutputSchema>["prompt_strategy"] = "validate"
  if (contradictionCount > 0) {
    promptStrategy = "resolve_contradiction"
  } else if (decision === "Likely wrong direction") {
    promptStrategy = "narrow_scope"
  } else if (missedItems.length > 0 && missedItems.length <= 2) {
    promptStrategy = "fix_missing"
  } else if (decision === "Needs refinement") {
    promptStrategy = "narrow_scope"
  } else {
    promptStrategy = "validate"
  }

  const nextPromptOutput = buildDecisionNextPrompt({
    optimizedPrompt,
    reviewContract,
    intent,
    decision,
    promptStrategy,
    blockedOrUnprovenItems,
    contradictionCount,
    whyBullets,
    deepAnalysisRequested,
    baselineDecision
  })

  const recommendedAction =
    decision === "Safe to proceed"
      ? "PROCEED"
      : decision === "Needs refinement"
        ? "SEND_PROMPT"
        : decision === "Likely wrong direction"
          ? "RESTART_WITH_PROMPT"
          : "VALIDATE_FIRST"

  const nextAction =
    recommendedAction === "PROCEED"
      ? "Continue, no changes needed."
      : recommendedAction === "SEND_PROMPT"
        ? "Send this prompt before continuing."
        : recommendedAction === "RESTART_WITH_PROMPT"
          ? "Restart with this prompt."
          : "Validate this before proceeding."

  return {
    decision,
    decisionDisplayLabel,
    popupState:
      decision === "Safe to proceed"
        ? "SAFE_TO_PROCEED"
        : decision === "Needs refinement"
          ? "NEEDS_REFINEMENT"
          : decision === "Likely wrong direction"
            ? "WRONG_DIRECTION"
            : "NOT_ENOUGH_PROOF",
    recommendedAction,
    reviewModeLabel,
    reviewModeExplainer: limitText(reviewModeExplainer, WHY_BULLET_MAX),
    deltaFromQuick: limitText(deltaFromQuick, WHY_BULLET_MAX),
    whyBullets: dedupe(whyBullets.map((item) => limitText(item, WHY_BULLET_MAX)), 3).slice(0, 3),
    nextAction: limitText(nextAction, NEXT_ACTION_MAX),
    nextPromptOutput,
    checkedArtifacts,
    uncheckedArtifacts,
    blockedOrUnprovenItems,
    confidence,
    confidenceTrend,
    confidenceLabel: titleCaseConfidence(confidence),
    confidenceReasons: dedupe(confidenceReasons.map((item) => limitText(item, CONFIDENCE_REASON_MAX)), 3).slice(0, 3)
  }
}

function verifyCriterionAgainstArtifacts(
  criterion: ReviewCriterion,
  bundle: NormalizedArtifactBundle,
  responseSummary: AfterPipelineRequest["response_summary"]
) {
  const policy = evidencePolicyForCriterion(criterion.label)
  const availablePrimary = policy.primary.filter((type) => hasEvidenceTypeAvailable(bundle, type))
  const activeEvidenceTypes =
    availablePrimary.length > 0
      ? availablePrimary
      : (policy.fallbackIfPrimaryUnavailable ?? []).filter((type) => hasEvidenceTypeAvailable(bundle, type))
  const artifactFindings: string[] = []
  const contradictions: string[] = []
  const normalizedResponseText = normalizeForMatch(responseSummary.response_text)
  const broadlyClaimsSuccess =
    /\b(validated|verified|full flow|end to end|end-to-end|works|working|fixed|confirmed)\b/i.test(
      normalizedResponseText
    ) || responseSummary.success_signals.length > 0
  const criterionMentionedInResponse =
    extractMeaningfulTokens(criterion.label).filter((token) => normalizedResponseText.includes(token)).length >= 2
  const claimedInResponse =
    quickCriterionSatisfied(criterion.label, responseSummary) || (broadlyClaimsSuccess && criterionMentionedInResponse)

  if (!activeEvidenceTypes.length) {
    const requiredEvidenceTypes = (availablePrimary.length ? availablePrimary : policy.primary).slice(0, 4)
    return {
      verification: DeepCriterionVerificationSchema.parse({
        criterion_label: criterion.label,
        required_evidence_types: requiredEvidenceTypes,
        artifact_findings: [
          `Needed ${requiredEvidenceTypes.map((type) => explainEvidenceType(type)).join(" or ")}, but those artifacts were not available.`
        ],
        judgment: "blocked",
        confidence: "medium",
        explanation: `Deep could not verify this criterion because the required artifact evidence was unavailable.`
      }),
      contradictions
    }
  }

  let judgment: z.infer<typeof DeepCriterionVerificationSchema>["judgment"] = "blocked"
  let confidence: "low" | "medium" | "high" = "medium"
  let explanation = "Deep checked the available artifacts for this criterion."

  for (const evidenceType of activeEvidenceTypes) {
    if (evidenceType === "dom_ui_state") {
      const observations = domObservationsForCriterion(criterion.label, bundle)
      if (!observations.length) continue

      const observedCount = observations.filter((item) => item.observed).length
      const missingObservation = observations.find((item) => !item.observed)
      artifactFindings.push(
        ...observations.map(
          (observation) =>
            `${observation.probeId}: ${observation.observed ? "observed" : "not observed"} (${limitText(observation.details, 120)})`
        )
      )

      if (missingObservation) {
        judgment = "missed"
        confidence = "high"
        explanation = `Deep checked visible DOM/UI artifacts and did not observe: ${limitText(
          missingObservation.details,
          150
        )}`
      } else if (observedCount === observations.length) {
        judgment = "met"
        confidence = observations.every((item) => item.confidence >= 0.7) ? "high" : "medium"
        explanation = `Deep checked visible DOM/UI artifacts and verified this criterion.`
      }
      continue
    }

    if (evidenceType === "runtime_error_state") {
      const runtimeText = runtimeEvidenceText(bundle)
      if (!runtimeText) continue

      const saysNoErrors =
        /\b(no|zero)\b[\w\s-]{0,40}\b(console|devtools|extension-related)\s+errors?\b/i.test(runtimeText) ||
        /\bno\s+errors?\b/i.test(runtimeText)
      const showsErrors = /\b(error|errors|exception|traceback|failed|failure)\b/i.test(runtimeText) && !saysNoErrors

      artifactFindings.push(limitText(runtimeText, 180))

      if (showsErrors) {
        judgment = "missed"
        confidence = "high"
        explanation = `Deep checked visible runtime/error artifacts and found error signals that contradict this criterion.`
      } else if (saysNoErrors || /passed|success/i.test(runtimeText)) {
        judgment = "met"
        confidence = saysNoErrors ? "high" : "medium"
        explanation = `Deep checked visible runtime/error artifacts and found no active error signal for this criterion.`
      } else if (judgment !== "missed") {
        judgment = "blocked"
        confidence = "medium"
        explanation = `Deep checked runtime/error artifacts, but they did not clearly prove this criterion either way.`
      }
      continue
    }

    if (evidenceType === "build_or_test_output") {
      const buildText = buildOrTestEvidenceText(bundle)
      if (!buildText) continue

      const buildFailed = /\b(fail(?:ed|ing)?|error|errors|exception)\b/i.test(buildText) && !/\bno errors?\b/i.test(buildText)
      const buildPassed = /\b(passed|success|successful|compiled|build succeeded|typecheck passed)\b/i.test(buildText)
      artifactFindings.push(limitText(buildText, 180))

      if (buildFailed) {
        judgment = "missed"
        confidence = "high"
        explanation = `Deep checked visible build/test artifacts and found failure signals.`
      } else if (buildPassed) {
        judgment = "met"
        confidence = "medium"
        explanation = `Deep checked visible build/test artifacts and found a positive signal for this criterion.`
      }
      continue
    }

    if (evidenceType === "changed_files") {
      const filesText = changedFilesEvidenceText(bundle)
      if (!filesText) continue

      const criterionTokens = extractMeaningfulTokens(criterion.label)
      const matched = criterionTokens.filter((token) => filesText.includes(token))
      artifactFindings.push(`Changed file labels: ${limitText(filesText, 180)}`)

      if (matched.length >= Math.min(2, criterionTokens.length)) {
        judgment = "met"
        confidence = "low"
        explanation = `Deep found changed-file artifacts that align with this criterion, but file labels alone are weaker proof.`
      } else if (judgment === "blocked") {
        explanation = `Deep found changed-file artifacts, but they did not clearly line up with this criterion.`
      }
      continue
    }

    if (evidenceType === "interaction_trace") {
      const relevantEvents = bundle.extensionEvents.filter((event) => {
        if (/answer questions and receive a generated improved prompt with acceptance criteria/i.test(criterion.label)) {
          return event.eventType === "clarification_questions_visible" || event.eventType === "improved_prompt_generated"
        }
        if (/replace button injects|text visibly updates|injects the improved prompt/i.test(criterion.label)) {
          return event.eventType === "prompt_replaced"
        }
        if (/popup opens|auth state|usage|strengthen tab works end-to-end/i.test(criterion.label)) {
          return event.eventType === "optimizer_panel_opened" || event.eventType === "deep_analysis_requested"
        }
        if (/spa navigation|re-appears|survive/i.test(criterion.label)) {
          return event.eventType === "spa_navigation_detected" || event.eventType === "launcher_reappeared_after_navigation"
        }

        return false
      })

      if (!relevantEvents.length) continue
      artifactFindings.push(
        ...relevantEvents.slice(0, 4).map((event) => `${event.eventType}: ${limitText(event.detail, 120)}`)
      )

      const failedEvent = relevantEvents.find((event) => event.status === "failed")
      const successfulEvent = relevantEvents.find((event) => event.status === "success")
      const observedEvent = relevantEvents.find((event) => event.status === "observed")

      if (failedEvent) {
        judgment = "missed"
        confidence = "high"
        explanation = `Deep checked extension interaction traces and found a failed step: ${failedEvent.eventType}.`
      } else if (/answer questions and receive a generated improved prompt with acceptance criteria/i.test(criterion.label)) {
        const sawQuestions = relevantEvents.some((event) => event.eventType === "clarification_questions_visible")
        const sawGeneratedPrompt = relevantEvents.some((event) => event.eventType === "improved_prompt_generated")
        if (sawQuestions && sawGeneratedPrompt) {
          judgment = successfulEvent ? "met" : "met"
          confidence = successfulEvent ? "high" : "medium"
          explanation = `Deep checked extension interaction traces and saw both the question flow and improved prompt generation.`
        } else {
          judgment = "missed"
          confidence = "medium"
          explanation = `Deep checked extension interaction traces, but the full question-to-improved-prompt flow was not observed.`
        }
      } else if (/replace button injects|text visibly updates|injects the improved prompt/i.test(criterion.label)) {
        const replaceSuccess = relevantEvents.some(
          (event) => event.eventType === "prompt_replaced" && event.status === "success"
        )
        if (replaceSuccess) {
          judgment = "met"
          confidence = "high"
          explanation = `Deep checked extension interaction traces and confirmed the Replace flow updated the textarea.`
        } else {
          judgment = "missed"
          confidence = "medium"
          explanation = `Deep checked extension interaction traces, but the Replace flow was not fully confirmed.`
        }
      } else if (/spa navigation|re-appears|survive/i.test(criterion.label)) {
        const sawNavigation = relevantEvents.some((event) => event.eventType === "spa_navigation_detected")
        const sawReappearance = relevantEvents.some((event) => event.eventType === "launcher_reappeared_after_navigation")
        if (sawNavigation && sawReappearance) {
          judgment = "met"
          confidence = "high"
          explanation = `Deep checked extension interaction traces and saw the launcher reappear after navigation.`
        } else {
          judgment = "missed"
          confidence = "medium"
          explanation = `Deep checked extension interaction traces, but it did not see the launcher reappear after navigation.`
        }
      } else if (successfulEvent) {
        judgment = "met"
        confidence = "high"
        explanation = `Deep checked extension interaction traces and verified this criterion from observed flow events.`
      } else if (observedEvent && judgment !== "missed") {
        judgment = "met"
        confidence = "medium"
        explanation = `Deep checked extension interaction traces and found supporting observed flow events.`
      }
      continue
    }

    if (evidenceType === "popup_state") {
      const popupSnapshot = bundle.popupSnapshots[bundle.popupSnapshots.length - 1]
      if (!popupSnapshot) continue

      artifactFindings.push(limitText(popupSnapshot.visibleText, 180))

      const hostLooksRelevant =
        !popupSnapshot.hostHint || /replit|chatgpt|openai/i.test(popupSnapshot.hostHint)
      const hasAuth = /\b(auth|signed in|sign in|logged in|login)\b/i.test(
        `${popupSnapshot.visibleText} ${popupSnapshot.authStateText}`
      )
      const hasUsage = /\b(usage|credits|quota|retry|status)\b/i.test(
        `${popupSnapshot.visibleText} ${popupSnapshot.usageText}`
      )
      const hasStrengthen = popupSnapshot.strengthenVisible || /\bstrengthen\b/i.test(popupSnapshot.visibleText)

      if (hostLooksRelevant && hasAuth && hasUsage && hasStrengthen) {
        judgment = "met"
        confidence = "medium"
        explanation = `Deep checked a recent popup state snapshot and found auth, usage, and Strengthen evidence.`
      } else if (hostLooksRelevant && (hasAuth || hasUsage || hasStrengthen)) {
        judgment = "missed"
        confidence = "medium"
        explanation = `Deep checked a recent popup state snapshot, but it did not show the full popup/auth/usage/Strengthen flow.`
      } else if (judgment !== "missed") {
        judgment = "blocked"
        confidence = "medium"
        explanation = `Deep found a popup snapshot, but it was not clearly tied to the active flow.`
      }
      continue
    }

    if (evidenceType === "response_code") {
      const codeText = normalizeWhitespace(bundle.responseCodeBlocks.join(" "))
      if (!codeText) continue
      const supported = deepCriterionSatisfiedFromEvidence(criterion.label, codeText, responseSummary)
      artifactFindings.push(`Response code blocks inspected.`)

      if (supported) {
        judgment = "met"
        confidence = "medium"
        explanation = `Deep checked response code artifacts and found support for this criterion.`
      }
      continue
    }

    if (evidenceType === "response_claim") {
      const claimText = responseClaimText(bundle, responseSummary)
      if (!claimText) continue
      const supported = deepCriterionSatisfiedFromEvidence(criterion.label, claimText, responseSummary)
      artifactFindings.push(`Visible response claims inspected.`)

      if (supported) {
        judgment = "met"
        confidence = "medium"
        explanation = `Deep checked the visible answer text for this criterion because stronger artifacts were unavailable.`
      }
    }
  }

  if (judgment === "missed" && claimedInResponse) {
    contradictions.push(`The answer claimed this criterion was satisfied, but the artifacts did not support it.`)
  }

  if (judgment === "blocked" && activeEvidenceTypes.some((type) => type !== "response_claim")) {
    explanation = `Deep could not verify this criterion from the available ${activeEvidenceTypes
      .map((type) => explainEvidenceType(type))
      .join(" or ")}.`
  }

  return {
    verification: DeepCriterionVerificationSchema.parse({
      criterion_label: criterion.label,
      required_evidence_types: activeEvidenceTypes.slice(0, 4),
      artifact_findings: dedupe(artifactFindings, 6).slice(0, 6),
      judgment,
      confidence,
      explanation: limitText(explanation, 240)
    }),
    contradictions
  }
}

function buildArtifactAwareDeepEvaluation(
  reviewContract: ReviewContract,
  bundle: NormalizedArtifactBundle,
  responseSummary: AfterPipelineRequest["response_summary"]
): DeepArtifactEvaluation {
  const verifications: z.infer<typeof DeepCriterionVerificationSchema>[] = []
  const contradictions: string[] = []

  for (const criterion of reviewContract.criteria.slice(0, MAX_REVIEW_CRITERIA)) {
    const result = verifyCriterionAgainstArtifacts(criterion, bundle, responseSummary)
    verifications.push(result.verification)
    contradictions.push(...result.contradictions)
  }

  const checklist = reviewContract.criteria.slice(0, MAX_REVIEW_CRITERIA).map((criterion) => {
    const verification = verifications.find((item) => normalizeForMatch(item.criterion_label) === normalizeForMatch(criterion.label))
    return AcceptanceChecklistItemSchema.parse({
      label: criterion.label,
      source: criterion.source,
      layer: criterion.layer,
      priority: criterion.priority,
      status: verification?.judgment ?? "blocked"
    })
  })

  const addressedCriteria = checklist.filter((item) => item.status === "met").map((item) => item.label)
  const missingCriteria = checklist
    .filter((item) => item.status === "missed" || item.status === "blocked")
    .map((item) => item.label)
  const blockedCriteria = checklist.filter((item) => item.status === "blocked").map((item) => item.label)
  const contradictionCount = contradictions.length
  const problemFit =
    contradictionCount > 0 && addressedCriteria.length === 0
      ? "wrong_direction"
      : missingCriteria.length
        ? "partial"
        : addressedCriteria.length
          ? "correct"
          : "wrong_direction"

  const analysisNotes = dedupe(
    [
      bundle.checkedArtifactTypes.length
        ? `Deep checked artifact types: ${bundle.checkedArtifactTypes.join(", ")}.`
        : "",
      addressedCriteria.length
        ? `Artifact-backed support found for: ${summarizeChecklistLabels(addressedCriteria)}.`
        : "",
      blockedCriteria.length
        ? `Deep could not verify required artifacts for: ${summarizeChecklistLabels(blockedCriteria, 1)}.`
        : "",
      contradictions[0] || ""
    ],
    4
  )

  const detailInspection = DetailInspectionSchema.parse({
    supported_claims: verifications
      .filter((item) => item.judgment === "met")
      .slice(0, 2)
      .map((item) => normalizeCriterionLabel(item.criterion_label)),
    contradictions: dedupe(contradictions, 4),
    unresolved_risks: verifications
      .filter((item) => item.judgment === "blocked")
      .slice(0, 2)
      .map((item) => item.explanation),
    evidence_strength:
      addressedCriteria.length === checklist.length && checklist.length > 0
        ? "strong"
        : addressedCriteria.length > 0 || contradictionCount > 0
          ? "moderate"
          : "weak",
    inspection_depth:
      bundle.responseCodeBlocks.length > 0 || bundle.changedFileLabels.length > 0
        ? "targeted_code"
        : bundle.checkedArtifactTypes.length > 0
          ? "targeted_text"
          : "summary_only"
  })

  return {
    checklist,
    stage2: Stage2OutputSchema.parse({
      addressed_criteria: addressedCriteria,
      missing_criteria: missingCriteria,
      constraint_risks: [],
      problem_fit: problemFit,
      analysis_notes: analysisNotes
    }),
    detailInspection,
    verifications,
    checkedArtifactTypes: bundle.checkedArtifactTypes,
    contradictionCount
  }
}

function constraintMentioned(constraint: string, responseSummary: AfterPipelineRequest["response_summary"]) {
  const normalizedConstraint = normalizeForMatch(constraint)
  const haystack = [
    responseSummary.response_text,
    responseSummary.first_excerpt,
    responseSummary.last_excerpt,
    ...responseSummary.key_paragraphs
  ]
    .join(" ")
  const normalizedHaystack = normalizeForMatch(haystack)

  if (normalizedHaystack.includes(normalizedConstraint)) return true

  if (/weight loss|fat loss|fat-loss/.test(normalizedConstraint)) {
    return /\b(weight loss|fat loss|fat-loss|fat loss friendly|fat-loss friendly|low calorie|calorie deficit|lean)\b/.test(
      normalizedHaystack
    )
  }

  if (/vegetarian/.test(normalizedConstraint)) {
    return /\b(vegetarian|veggie|meatless|plant based|plant-based)\b/.test(normalizedHaystack)
  }

  return false
}

type NonCodeCriterionCheck = {
  addressed: string[]
  missing: string[]
}

function evaluateNonCodeCriteria(intent: AttemptIntent, responseSummary: AfterPipelineRequest["response_summary"]): NonCodeCriterionCheck {
  const haystack = normalizeForMatch(responseSummary.response_text)
  const requested = normalizeForMatch(`${intent.goal} ${intent.constraints.join(" ")} ${intent.acceptance_criteria.join(" ")}`)

  const checks: Array<{ id: string; requested: boolean; met: boolean; message: string }> = [
    {
      id: "vegetarian",
      requested: /\bvegetarian|veggie|meatless|plant based|plant-based\b/.test(requested),
      met: /\bvegetarian|veggie|meatless|plant based|plant-based\b/.test(haystack),
      message: "The answer did not clearly show that the recipe stays vegetarian."
    },
    {
      id: "weight_loss",
      requested: /\bweight loss|fat loss|fat-loss|low calorie|calorie deficit\b/.test(requested),
      met: /\bweight loss|fat loss|fat-loss|fat loss friendly|fat-loss friendly|low calorie|calorie deficit|lean|high protein\b/.test(haystack),
      message: "The answer did not clearly explain why the recipe fits a weight-loss goal."
    },
    {
      id: "ingredients",
      requested: /\bingredients?\b/.test(requested),
      met: /\bingredients?\b/.test(haystack),
      message: "The answer did not clearly include an ingredients list."
    },
    {
      id: "steps",
      requested: /\bsteps?|instructions?|directions?|prep\b/.test(requested),
      met: /\bsteps?|instructions?|directions?|method|prep\b/.test(haystack),
      message: "The answer did not clearly include quick prep steps."
    },
    {
      id: "nutrition",
      requested: /\bnutrition|protein|carbs|fat|fiber|calories|kcal\b/.test(requested),
      met: /\bnutrition|protein|carbs|fat|fiber|calories|kcal\b/.test(haystack),
      message: "The answer did not clearly include basic nutrition details."
    },
    {
      id: "time_under_15",
      requested: /\bunder 15|within 15|15 minutes|15 mins|15 min\b/.test(requested),
      met: /\b(under|within|about|around)?\s*1[0-5]\s*(minutes|minute|mins|min)\b/.test(haystack),
      message: "The answer did not clearly show the recipe can be made in about 15 minutes or less."
    }
  ]

  return {
    addressed: checks.filter((check) => check.requested && check.met).map((check) => check.id),
    missing: checks.filter((check) => check.requested && !check.met).map((check) => check.message)
  }
}

function parseLooseJson(raw: string): unknown {
  const cleaned = raw.trim()

  try {
    return JSON.parse(cleaned)
  } catch {
    const startCandidates = [cleaned.indexOf("{"), cleaned.indexOf("[")].filter((index) => index >= 0)
    const start = startCandidates.length ? Math.min(...startCandidates) : -1
    if (start === -1) {
      throw new Error("Model response did not contain JSON")
    }

    for (let end = cleaned.length; end > start; end -= 1) {
      const slice = cleaned.slice(start, end).trim()
      if (!slice) continue

      try {
        return JSON.parse(slice)
      } catch {
        continue
      }
    }

    throw new Error("Model response contained malformed JSON")
  }
}

async function callStructuredJson<T>(
  systemPrompt: string,
  userPrompt: string,
  parser: (value: unknown) => T,
  maxTokens: number
) {
  const trimmedPrompt = trimForBudget(userPrompt, 5000)
  const providers = [
    () => callKimiJson(systemPrompt, trimmedPrompt, maxTokens),
    () => callDeepSeekJson(systemPrompt, trimmedPrompt, maxTokens)
  ]

  for (const callProvider of providers) {
    try {
      const raw = await callProvider()
      if (!raw) continue
      return parser(parseLooseJson(raw))
    } catch {
      continue
    }
  }

  return null
}

function estimateTokensFromText(...parts: string[]) {
  const chars = parts.join("").length
  return Math.max(1, Math.ceil(chars / 4))
}

function hasGenericAcceptanceCriterion(criterion: string) {
  const normalized = normalizeForMatch(criterion)
  return (
    !normalized ||
    normalized === "solve the requested task" ||
    normalized === "solve the user s latest request" ||
    /^solve\s+(the|this|that)\b/.test(normalized)
  )
}

function needsFallbackIntent(intent: AttemptIntent) {
  if (intent.task_type === "other" && intent.constraints.length === 0 && intent.acceptance_criteria.length === 0) {
    return true
  }

  const goalTokens = extractMeaningfulTokens(intent.goal)
  const weakCriteria =
    intent.acceptance_criteria.length === 0 ||
    intent.acceptance_criteria.every((criterion) => hasGenericAcceptanceCriterion(criterion))
  const weakGoal = hasWeakGoal(intent.goal)

  return weakCriteria || weakGoal || goalTokens.length < 3
}

function buildIntentExtractionPrompts(rawPrompt: string, projectContext = "", currentState = "") {
  return {
    system:
      "Extract intent for an AI debugging loop. Return JSON only with keys: task_type, goal, constraints, acceptance_criteria. Use the project context and current state to infer the user's real requirement when the raw prompt is short or ambiguous. Acceptance criteria must be concrete and user-facing, not generic placeholders like 'solve the request'. Keep it minimal and do not invent detailed constraints.",
    user: JSON.stringify({ raw_prompt: rawPrompt, project_context: projectContext, current_state: currentState })
  }
}

function buildStage1Prompts(
  payload: AfterPipelineRequest["response_summary"],
  intent: AttemptIntent,
  projectContext = "",
  currentState = "",
  changedFiles: string[] = [],
  errorSummary = ""
) {
  return {
    system:
      "Summarize what the assistant appears to have done in one concrete sentence. Use the saved goal, project context, and current state to describe the actual claimed changes or claimed fix. Avoid parroting filler like 'three things were changed' without naming what changed. Return JSON only with keys: assistant_action_summary, claimed_evidence, response_mode, scope_assessment.",
    user: JSON.stringify({
      intent_goal: compressGoal(intent.goal),
      task_type: intent.task_type,
      project_context: projectContext,
      current_state: currentState,
      changed_file_paths_summary: summarizeChangedFiles(changedFiles),
      error_summary: errorSummary,
      response_summary: {
        response_length: payload.response_length,
        has_code_blocks: payload.has_code_blocks,
        mentioned_files: payload.mentioned_files,
        change_claims: summarizeChangeClaims(payload),
        validation_signals: summarizeValidationSignals(payload),
        certainty_signals: payload.certainty_signals,
        uncertainty_signals: payload.uncertainty_signals,
        success_signals: payload.success_signals,
        failure_signals: payload.failure_signals,
        first_excerpt: payload.first_excerpt,
        last_excerpt: payload.last_excerpt,
        key_paragraphs: payload.key_paragraphs
      }
    })
  }
}

function buildStage2Prompts(
  intent: AttemptIntent,
  reviewContract: ReviewContract,
  stage1: ReturnType<typeof Stage1OutputSchema.parse>,
  responseSummary: AfterPipelineRequest["response_summary"],
  candidates: EvidenceCandidate[],
  deepAnalysisRequested = false,
  projectContext = "",
  currentState = "",
  changedFiles: string[] = [],
  errorSummary = ""
) {
  return {
    system:
      `Choose which raw answer excerpts deserve closer inspection. Prioritize evidence that can confirm or refute the claimed fix against the frozen review contract, current debugging state, repeated bugs, and visible error summary. ${reviewQualityContract(deepAnalysisRequested)} Return JSON only with keys: selected_candidate_ids, risk_flags, inspection_goal. Pick at most 4 IDs.`,
    user: JSON.stringify({
      intent: {
        goal: compressGoal(intent.goal),
        constraints: intent.constraints.slice(0, 4),
        acceptance_criteria: reviewContract.criteria.map((item) => item.label)
      },
      review_contract: reviewContract,
      project_context: projectContext,
      current_state: currentState,
      changed_file_paths_summary: summarizeChangedFiles(changedFiles),
      error_summary: errorSummary,
      stage_1: stage1,
      visible_change_claims: summarizeChangeClaims(responseSummary),
      visible_validation_signals: summarizeValidationSignals(responseSummary),
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        type: candidate.type,
        label: candidate.label,
        excerpt: candidate.excerpt
      }))
    })
  }
}

function buildStage3Prompts(
  intent: AttemptIntent,
  reviewContract: ReviewContract,
  stage1: ReturnType<typeof Stage1OutputSchema.parse>,
  stage2: ReturnType<typeof EvidenceTargetingSchema.parse>,
  responseSummary: AfterPipelineRequest["response_summary"],
  selectedEvidence: EvidenceCandidate[],
  deepAnalysisRequested = false,
  projectContext = "",
  currentState = "",
  changedFiles: string[] = [],
  errorSummary = ""
) {
  return {
    system:
      `Inspect the selected raw answer excerpts and decide whether they support the assistant's claims against the frozen review contract. Use the project context, current debugging state, repeated bugs, and the current visible error summary to distinguish a real fix from a partial or drifting change. ${reviewQualityContract(deepAnalysisRequested)} Return JSON only with keys: supported_claims, contradictions, unresolved_risks, evidence_strength, inspection_depth.`,
    user: JSON.stringify({
      intent: {
        goal: compressGoal(intent.goal),
        constraints: intent.constraints.slice(0, 4),
        acceptance_criteria: reviewContract.criteria.map((item) => item.label)
      },
      review_contract: reviewContract,
      project_context: projectContext,
      current_state: currentState,
      changed_file_paths_summary: summarizeChangedFiles(changedFiles),
      error_summary: errorSummary,
      visible_change_claims: summarizeChangeClaims(responseSummary),
      visible_validation_signals: summarizeValidationSignals(responseSummary),
      stage_1: stage1,
      stage_2: stage2,
      selected_evidence: selectedEvidence.map((candidate) => ({
        type: candidate.type,
        label: candidate.label,
        excerpt: candidate.excerpt
      }))
    })
  }
}

function buildStage4Prompts(
  intent: AttemptIntent,
  reviewContract: ReviewContract,
  stage1: ReturnType<typeof Stage1OutputSchema.parse>,
  stage2: ReturnType<typeof Stage2OutputSchema.parse>,
  detail: ReturnType<typeof DetailInspectionSchema.parse>,
  responseSummary: AfterPipelineRequest["response_summary"],
  deepAnalysisRequested = false,
  projectContext = "",
  currentState = "",
  changedFiles: string[] = [],
  errorSummary = ""
) {
  return {
    system:
      `Generate a trustworthy verdict for the AI response against the frozen review contract. Prefer UNVERIFIED over success when evidence is weak. Use the project context, current debugging state, changed file hints, and visible error summary to judge whether the answer really resolves the user's debugging situation instead of only sounding plausible. ${reviewQualityContract(deepAnalysisRequested)} Return JSON only with keys: status, confidence, findings, issues.`,
    user: JSON.stringify({
      intent,
      review_contract: reviewContract,
      project_context: projectContext,
      current_state: currentState,
      changed_file_paths_summary: summarizeChangedFiles(changedFiles),
      error_summary: errorSummary,
      stage_1: stage1,
      stage_2: stage2,
      detail_inspection: detail,
      response_summary: {
        response_length: responseSummary.response_length,
        has_code_blocks: responseSummary.has_code_blocks,
        mentioned_files: responseSummary.mentioned_files,
        change_claims: summarizeChangeClaims(responseSummary),
        validation_signals: summarizeValidationSignals(responseSummary),
        certainty_signals: responseSummary.certainty_signals,
        uncertainty_signals: responseSummary.uncertainty_signals,
        success_signals: responseSummary.success_signals,
        failure_signals: responseSummary.failure_signals
      }
    })
  }
}

function buildStage5Prompts(
  optimizedPrompt: string,
  intent: AttemptIntent,
  verdict: ReturnType<typeof VerdictOutputSchema.parse>,
  stage2: ReturnType<typeof Stage2OutputSchema.parse>,
  projectContext = "",
  currentState = "",
  changedFiles: string[] = [],
  errorSummary = ""
) {
  return {
    system:
      "Write the next best prompt for the user. Keep scope tight and focus only on what is still unresolved, unproven, or contradictory. Return JSON only with keys: next_prompt and prompt_strategy. prompt_strategy must be one of: validate, fix_missing, narrow_scope, resolve_contradiction.",
    user: JSON.stringify({
      optimized_prompt: optimizedPrompt,
      intent,
      project_context: projectContext,
      current_state: currentState,
      changed_file_paths_summary: summarizeChangedFiles(changedFiles),
      error_summary: errorSummary,
      verdict,
      missing_criteria: stage2.missing_criteria,
      constraint_risks: stage2.constraint_risks
    })
  }
}

function fallbackStage1(
  responseSummary: AfterPipelineRequest["response_summary"],
  changedFiles: string[] = [],
  errorSummary = ""
) {
  const responseMode =
    responseSummary.has_code_blocks || responseSummary.mentioned_files.length
      ? "implemented"
      : responseSummary.uncertainty_signals.length
        ? "uncertain"
        : responseSummary.success_signals.length
          ? "explained"
          : "suggested"

  const scopeAssessment =
    responseSummary.mentioned_files.length >= 6
      ? "broad"
      : responseSummary.mentioned_files.length >= 2 || responseSummary.response_length > 1800
        ? "moderate"
        : "narrow"

  const visibleFileHints = summarizeChangedFiles([...changedFiles, ...responseSummary.mentioned_files])
  const evidenceSummary =
    visibleFileHints.length > 0
      ? `The answer claims changes in ${visibleFileHints.join(", ")}${errorSummary ? ` to address ${limitText(errorSummary, 120)}` : ""}.`
      : responseSummary.change_claims[0]
        ? limitText(responseSummary.change_claims[0], 220)
      : responseSummary.success_signals[0]
        ? limitText(responseSummary.success_signals[0], 220)
        : summarizeVisibleAnswer(responseSummary)
  const summarySource = evidenceSummary

  return Stage1OutputSchema.parse({
    assistant_action_summary: summarySource.slice(0, 220),
    claimed_evidence: dedupe(
      [
        ...responseSummary.success_signals,
        ...responseSummary.change_claims,
        ...responseSummary.validation_signals,
        ...responseSummary.mentioned_files,
        ...(responseSummary.has_code_blocks ? ["Included code blocks"] : [])
      ],
      4
    ),
    response_mode: responseMode,
    scope_assessment: scopeAssessment
  })
}

function fallbackStage2(
  reviewContract: ReviewContract,
  intent: AttemptIntent,
  stage1: ReturnType<typeof Stage1OutputSchema.parse>,
  detail: ReturnType<typeof DetailInspectionSchema.parse>,
  responseSummary: AfterPipelineRequest["response_summary"]
) {
  const codeHeavyTask = isCodeHeavyTask(intent)
  const contractCriteria = reviewContract.criteria.map((criterion) => criterion.label)
  const nonCodeChecks = codeHeavyTask ? { addressed: [], missing: [] } : evaluateNonCodeCriteria(intent, responseSummary)
  const goalMatched =
    hasGoalEvidence(intent.goal, responseSummary) ||
    reviewContract.criteria.some((criterion) => quickCriterionSatisfied(criterion.label, responseSummary)) ||
    hasGoalEvidence(reviewContract.goal, responseSummary)
  const usesDefaultGoalCriterion = contractCriteria.some((criterion) =>
    /prove the answer solved this goal:/i.test(criterion)
  )
  const hasOnTopicSignals =
    goalMatched &&
    (stage1.response_mode === "implemented" ||
      stage1.response_mode === "explained" ||
      responseSummary.success_signals.length > 0 ||
      responseSummary.response_length > 220)
  const quickAddressedCriteria = contractCriteria.filter((criterion) =>
    quickCriterionSatisfied(criterion, responseSummary)
  )

  const addressed =
    (stage1.response_mode === "implemented" || detail.evidence_strength === "strong") && goalMatched
      ? dedupe([...quickAddressedCriteria, ...contractCriteria], 4)
      : quickAddressedCriteria.length
        ? quickAddressedCriteria.slice(0, 4)
      : !codeHeavyTask && nonCodeChecks.addressed.length && goalMatched && detail.inspection_depth !== "summary_only"
        ? contractCriteria.slice(0, Math.min(2, Math.max(1, nonCodeChecks.addressed.length)))
      : !codeHeavyTask && usesDefaultGoalCriterion && goalMatched && detail.inspection_depth !== "summary_only"
        ? contractCriteria.slice(0, 1)
        : usesDefaultGoalCriterion && hasOnTopicSignals
        ? contractCriteria.slice(0, 1)
        : []
  const rawMissing = contractCriteria.filter((criterion) => !addressed.includes(criterion)).slice(0, 4)
  const missing = dedupe([...rawMissing.map((criterion) => {
    if (/prove the answer solved this goal:/i.test(criterion)) {
      if (!codeHeavyTask && goalMatched && detail.inspection_depth !== "summary_only") {
        return ""
      }

      return goalMatched
        ? ""
        : `The answer appears focused on ${responseFocusSnippet(responseSummary)} instead of ${conciseGoal(intent.goal)}.`
    }
    return criterion
  }).filter(Boolean), ...nonCodeChecks.missing], 4)
  const risks = intent.constraints
    .filter((constraint) => !constraintMentioned(constraint, responseSummary))
    .slice(0, 3)
    .map((constraint) => `The answer did not explicitly address this constraint: ${constraint}`)

  const problemFit = !goalMatched
    ? "wrong_direction"
    : !codeHeavyTask && detail.inspection_depth !== "summary_only"
      ? "correct"
      : stage1.scope_assessment === "broad"
        ? "partial"
        : "correct"

  return Stage2OutputSchema.parse({
    addressed_criteria: addressed,
    missing_criteria: missing,
    constraint_risks: risks,
    problem_fit: problemFit,
    analysis_notes: dedupe(
      [
        stage1.response_mode === "uncertain" ? "The assistant sounded uncertain." : "",
        !goalMatched ? "The visible answer does not share enough signal with the intended goal." : "",
        detail.contradictions.length ? `Possible contradiction: ${detail.contradictions[0]}` : "",
        detail.unresolved_risks.length ? `Unresolved detail risk: ${detail.unresolved_risks[0]}` : "",
        !codeHeavyTask && nonCodeChecks.addressed.length
          ? `Checked requested details: ${nonCodeChecks.addressed.join(", ")}.`
          : "",
        !codeHeavyTask && goalMatched && detail.inspection_depth !== "summary_only" && !missing.length
          ? "The answer appears to directly deliver the requested content."
          : goalMatched && usesDefaultGoalCriterion && !missing.length
          ? "The answer looks on-topic, but NoRetry is relying on inferred validation rather than explicit proof."
          : "",
        missing.length ? "Some acceptance criteria remain unverified." : ""
      ],
      4
    )
  })
}

function fallbackDetailInspection(
  selectedEvidence: EvidenceCandidate[],
  responseSummary: AfterPipelineRequest["response_summary"]
) {
  const hasCode = selectedEvidence.some((candidate) => candidate.type === "code")
  const hasClaims = selectedEvidence.some((candidate) => candidate.type === "claim")
  const evidenceStrength =
    hasCode || responseSummary.mentioned_files.length > 0
      ? "strong"
      : hasClaims || selectedEvidence.length >= 2
        ? "moderate"
        : "weak"

  return DetailInspectionSchema.parse({
    supported_claims: selectedEvidence
      .filter((candidate) => candidate.type === "claim" || candidate.type === "file")
      .slice(0, 2)
      .map((candidate) => candidate.excerpt),
    contradictions: [],
    unresolved_risks:
      evidenceStrength === "weak" && responseSummary.success_signals.length > 0
        ? ["The answer claims success, but the inspected evidence is still limited."]
        : [],
    evidence_strength: evidenceStrength,
    inspection_depth: hasCode ? "targeted_code" : selectedEvidence.length ? "targeted_text" : "summary_only"
  })
}

function buildAcceptanceChecklist(
  reviewContract: ReviewContract,
  stage2: ReturnType<typeof Stage2OutputSchema.parse>,
  detail: ReturnType<typeof DetailInspectionSchema.parse>,
  responseSummary: AfterPipelineRequest["response_summary"],
  deepAnalysisRequested = false,
  deepCriterionVerifications: z.infer<typeof DeepCriterionVerificationSchema>[] = []
) {
  const addressedKeys = new Set(stage2.addressed_criteria.map((item) => normalizeForMatch(item)))
  const missedKeys = new Set(stage2.missing_criteria.map((item) => normalizeForMatch(item)))
  const binaryDecisionRequired = deepAnalysisRequested || detail.inspection_depth !== "summary_only"
  const verificationByLabel = new Map(
    deepCriterionVerifications.map((item) => [normalizeForMatch(item.criterion_label), item])
  )

  return reviewContract.criteria.slice(0, MAX_REVIEW_CRITERIA).map((criterion) =>
    {
      const normalizedLabel = normalizeForMatch(criterion.label)
      const artifactVerification = verificationByLabel.get(normalizedLabel)
      if (deepAnalysisRequested && artifactVerification) {
        return AcceptanceChecklistItemSchema.parse({
          label: criterion.label,
          source: criterion.source,
          layer: criterion.layer,
          priority: criterion.priority,
          status: artifactVerification.judgment
        })
      }

      const quickSatisfied = quickCriterionSatisfied(criterion.label, responseSummary)
      const explicitlyUnproven = criterionExplicitlyUnproven(criterion.label, responseSummary)

      let status: "met" | "not_sure" | "missed" | "blocked"
      if (explicitlyUnproven) {
        status = binaryDecisionRequired ? "missed" : "not_sure"
      } else if (addressedKeys.has(normalizedLabel) || quickSatisfied) {
        status = "met"
      } else if (missedKeys.has(normalizedLabel)) {
        status = binaryDecisionRequired ? "missed" : "not_sure"
      } else {
        status = binaryDecisionRequired ? "missed" : "not_sure"
      }

      return AcceptanceChecklistItemSchema.parse({
        label: criterion.label,
        source: criterion.source,
        layer: criterion.layer,
        priority: criterion.priority,
        status
      })
    }
  )
}

function alignStage2WithChecklist(
  stage2: ReturnType<typeof Stage2OutputSchema.parse>,
  checklist: Array<z.infer<typeof AcceptanceChecklistItemSchema>>,
  reviewContract: ReviewContract
) {
  const checklistByLabel = new Map(checklist.map((item) => [normalizeForMatch(item.label), item.status]))
  const addressedCriteria = reviewContract.criteria
    .filter((criterion) => checklistByLabel.get(normalizeForMatch(criterion.label)) === "met")
    .map((criterion) => criterion.label)
  const missingCriteria = reviewContract.criteria
    .filter((criterion) => {
      const status = checklistByLabel.get(normalizeForMatch(criterion.label))
      return status === "missed" || status === "not_sure" || status === "blocked"
    })
    .map((criterion) => criterion.label)

  const constraintRisks = missingCriteria.length
    ? stage2.constraint_risks.filter((risk) => {
        const normalizedRisk = normalizeForMatch(risk)
        const matchedCriterion = reviewContract.criteria.find((criterion) =>
          normalizedRisk.includes(normalizeForMatch(criterion.label))
        )

        if (!matchedCriterion) return true
        return missingCriteria.includes(matchedCriterion.label)
      })
    : []
  const problemFit =
    !addressedCriteria.length && stage2.problem_fit === "wrong_direction"
      ? "wrong_direction"
      : missingCriteria.length
        ? "partial"
        : addressedCriteria.length
          ? "correct"
          : stage2.problem_fit

  const analysisNotes = dedupe(
    stage2.analysis_notes.filter((note) => {
      const normalized = note.trim().toLowerCase()
      if (!missingCriteria.length) {
        return (
          normalized.length > 18 &&
          !normalized.includes("the user's latest request") &&
          !normalized.includes("solve the requested task") &&
          !normalized.includes("some acceptance criteria remain unverified") &&
          !normalized.includes("still does not clearly show") &&
          !normalized.includes("needs proof") &&
          !normalized.includes("could not directly verify")
        )
      }

      return normalized.length > 18
    }),
    4
  )

  return Stage2OutputSchema.parse({
    ...stage2,
    problem_fit: problemFit,
    addressed_criteria: addressedCriteria,
    missing_criteria: missingCriteria,
    constraint_risks: constraintRisks,
    analysis_notes: analysisNotes
  })
}

function reconcileVerdictWithChecklist(
  verdict: ReturnType<typeof VerdictOutputSchema.parse>,
  checklist: Array<z.infer<typeof AcceptanceChecklistItemSchema>>,
  reviewContract: ReviewContract,
  stage2: ReturnType<typeof Stage2OutputSchema.parse>,
  detail: ReturnType<typeof DetailInspectionSchema.parse>,
  deepAnalysisRequested = false
) {
  const contractCriteria = reviewContract.criteria
  const coreCriteria = contractCriteria.filter((criterion) => criterion.layer === "core")
  const validationCriteria = contractCriteria.filter((criterion) => criterion.layer === "validation")
  const checklistByLabel = new Map(checklist.map((item) => [normalizeForMatch(item.label), item.status]))
  const statusForCriterion = (criterion: ReviewCriterion) =>
    checklistByLabel.get(normalizeForMatch(criterion.label)) ?? "not_sure"

  const metCount = checklist.filter((item) => item.status === "met").length
  const unresolvedCount = checklist.filter((item) => item.status === "not_sure").length
  const blockedCount = checklist.filter((item) => item.status === "blocked").length
  const missedCore = coreCriteria.filter((criterion) => statusForCriterion(criterion) === "missed")
  const missedValidation = validationCriteria.filter((criterion) => statusForCriterion(criterion) === "missed")
  const unresolvedCore = coreCriteria.filter((criterion) => statusForCriterion(criterion) === "not_sure")
  const unresolvedValidation = validationCriteria.filter((criterion) => statusForCriterion(criterion) === "not_sure")
  const blockedCore = coreCriteria.filter((criterion) => statusForCriterion(criterion) === "blocked")
  const blockedValidation = validationCriteria.filter((criterion) => statusForCriterion(criterion) === "blocked")
  const allKnownCriteriaMet = checklist.length > 0 && checklist.every((item) => item.status === "met")
  const remainingStageMissing = stage2.missing_criteria.filter(
    (item) => checklistByLabel.get(normalizeForMatch(item)) !== "met"
  )
  const remainingConstraintRisks = stage2.constraint_risks.filter((risk) => {
    const normalizedRisk = normalizeForMatch(risk)
    const matchedCriterion = contractCriteria.find((criterion) =>
      normalizedRisk.includes(normalizeForMatch(criterion.label))
    )

    if (!matchedCriterion) {
      return false
    }

    return statusForCriterion(matchedCriterion) !== "met"
  })
  const hasUnresolvedStageRisks = remainingStageMissing.length > 0 || remainingConstraintRisks.length > 0

  let status = verdict.status
  let confidence = verdict.confidence
  let confidenceReason = verdict.confidence_reason
  let findings = verdict.findings

  if (allKnownCriteriaMet && !hasUnresolvedStageRisks) {
    status = detail.inspection_depth === "summary_only" ? "LIKELY_SUCCESS" : "SUCCESS"
    confidence =
      detail.inspection_depth !== "summary_only" && deepAnalysisRequested
        ? "high"
        : confidence === "low"
          ? "medium"
          : confidence
    confidenceReason =
      detail.inspection_depth !== "summary_only" && deepAnalysisRequested
        ? "Deep review found direct visible support for every acceptance criterion."
        : "The visible checklist and review contract are fully aligned."
  } else if (missedCore.length > 0) {
    status = "PARTIAL"
    confidence =
      deepAnalysisRequested && detail.inspection_depth !== "summary_only" && unresolvedCount === 0
        ? "high"
        : confidence === "high"
          ? "medium"
          : confidence
    confidenceReason =
      deepAnalysisRequested && detail.inspection_depth !== "summary_only" && unresolvedCount === 0
        ? `Deep review resolved the fixed checklist and found at least one unmet core requirement: ${missedCore[0].label}.`
        : `At least one core requirement is still not satisfied: ${missedCore[0].label}.`
  } else if (blockedCore.length > 0) {
    status = "PARTIAL"
    confidence = "medium"
    confidenceReason = `A core requirement still needs artifact proof: ${blockedCore[0].label}.`
  } else if (unresolvedCore.length > 0) {
    status = "PARTIAL"
    confidence = "medium"
    confidenceReason = `A core requirement still needs proof: ${unresolvedCore[0].label}.`
  } else if (missedValidation.length > 0 || unresolvedValidation.length > 0 || blockedValidation.length > 0) {
    status = blockedValidation.length > 0 ? "PARTIAL" : "LIKELY_SUCCESS"
    confidence = detail.inspection_depth === "summary_only" ? "medium" : "high"
    confidenceReason =
      missedValidation.length > 0
        ? deepAnalysisRequested && detail.inspection_depth !== "summary_only" && unresolvedCount === 0
          ? `Deep review resolved the fixed checklist and found a failed validation check: ${missedValidation[0].label}.`
          : `Core requirements look satisfied, but a validation check failed: ${missedValidation[0].label}.`
        : blockedValidation.length > 0
          ? `Core requirements look satisfied, but a validation check still needs artifact proof: ${blockedValidation[0].label}.`
        : `Core requirements look satisfied, but a validation check still needs proof: ${unresolvedValidation[0].label}.`
  } else if (stage2.problem_fit === "wrong_direction") {
    status = "WRONG_DIRECTION"
    confidence = detail.inspection_depth === "summary_only" ? "medium" : "high"
    confidenceReason = "The answer appears to solve a different problem than the frozen review contract."
  }

  if (deepAnalysisRequested && blockedCount > 0 && status === "SUCCESS") {
    status = "LIKELY_SUCCESS"
  }

  if (detail.inspection_depth !== "summary_only" && confidence === "low") {
    confidence = "medium"
  }

  if (
    (status === "FAILED" || status === "WRONG_DIRECTION") &&
    metCount >= Math.min(2, checklist.length) &&
    missedCore.length === 0
  ) {
    status = "PARTIAL"
    confidence = confidence === "high" ? "medium" : confidence
    confidenceReason = "The answer still needs review, but the fixed checklist shows meaningful alignment with the request."
    findings = [
      "The answer shows meaningful progress against the request, but NoRetry still found gaps or weak evidence in the overall review.",
      ...verdict.findings.slice(1)
    ].slice(0, 3)
  }

  return VerdictOutputSchema.parse({
    ...verdict,
    status,
    confidence,
    confidence_reason: limitText(confidenceReason, 180),
    findings
  })
}

function fallbackVerdict(
  intent: AttemptIntent,
  responseSummary: AfterPipelineRequest["response_summary"],
  stage1: ReturnType<typeof Stage1OutputSchema.parse>,
  stage2: ReturnType<typeof Stage2OutputSchema.parse>,
  detail: ReturnType<typeof DetailInspectionSchema.parse>,
  usedFallbackIntent: boolean,
  deepAnalysisRequested: boolean
) {
  let status: "SUCCESS" | "LIKELY_SUCCESS" | "PARTIAL" | "FAILED" | "WRONG_DIRECTION" | "UNVERIFIED" = "UNVERIFIED"
  const codeHeavyTask = isCodeHeavyTask(intent)
  const strongFailureSignals = responseSummary.failure_signals.filter((signal) =>
    /\b(error|failed|failure|broken|exception|traceback|unable|cannot|can't|doesn't work)\b/i.test(signal)
  )

  if (strongFailureSignals.length && stage2.problem_fit !== "correct") status = "FAILED"
  else if (stage2.problem_fit === "wrong_direction") status = "WRONG_DIRECTION"
  else if (
    !codeHeavyTask &&
    stage2.problem_fit === "correct" &&
    !stage2.missing_criteria.length &&
    !stage2.constraint_risks.length &&
    detail.inspection_depth !== "summary_only"
  ) {
    status = detail.evidence_strength === "strong" ? "SUCCESS" : "LIKELY_SUCCESS"
  } else if (!stage2.missing_criteria.length && responseSummary.success_signals.length) status = "LIKELY_SUCCESS"
  else if (stage2.missing_criteria.length || responseSummary.uncertainty_signals.length) status = "PARTIAL"

  const hasConcreteEvidence = responseSummary.mentioned_files.length > 0 || responseSummary.has_code_blocks
  const deepReviewed = detail.inspection_depth !== "summary_only"
  const strongAlignedOutcome =
    deepReviewed &&
    stage2.problem_fit === "correct" &&
    !stage2.missing_criteria.length &&
    !stage2.constraint_risks.length &&
    (status === "SUCCESS" || status === "LIKELY_SUCCESS")
  const confidence =
    status === "FAILED"
      ? detail.inspection_depth === "summary_only"
        ? "medium"
        : strongFailureSignals.length
          ? "high"
          : "medium"
      : status === "WRONG_DIRECTION"
        ? detail.inspection_depth === "summary_only"
          ? "medium"
          : "high"
      : strongAlignedOutcome
        ? "high"
      : codeHeavyTask &&
          deepReviewed &&
          stage2.problem_fit === "correct" &&
          stage2.addressed_criteria.length > 0 &&
          !detail.contradictions.length
        ? hasConcreteEvidence
          ? "medium"
          : "low"
      : usedFallbackIntent
        ? "low"
        : detail.inspection_depth === "summary_only"
          ? codeHeavyTask
            ? "low"
            : stage2.problem_fit === "correct"
              ? "medium"
              : "low"
          : codeHeavyTask
          ? hasConcreteEvidence
            ? detail.evidence_strength === "strong"
              ? "high"
              : "medium"
            : "low"
          : stage2.problem_fit === "correct" && !stage2.missing_criteria.length && !stage2.constraint_risks.length
            ? "high"
            : "low"

  const confidenceReason =
    usedFallbackIntent
      ? "NoRetry had to infer the goal from the prompt, so this review is more cautious."
      : status === "WRONG_DIRECTION"
        ? "The answer appears to be about a different problem than the saved goal."
        : detail.inspection_depth === "summary_only"
          ? deepAnalysisRequested
            ? "NoRetry attempted a deeper review, but could not inspect enough raw evidence to raise confidence."
            : codeHeavyTask
              ? "NoRetry only reviewed the response summary, not targeted raw evidence."
              : "NoRetry only did a quick review of the answer, so this result is still cautious."
        : codeHeavyTask
          ? hasConcreteEvidence
            ? detail.evidence_strength === "strong"
              ? deepAnalysisRequested
                ? "NoRetry deeply reviewed targeted raw evidence, including implementation details."
                : "NoRetry reviewed targeted raw evidence, including implementation details."
              : "The answer included some implementation evidence, but important details remain limited."
            : "The answer stayed on-topic, but it did not include enough concrete implementation evidence."
          : stage2.problem_fit === "correct"
            ? !stage2.missing_criteria.length && !stage2.constraint_risks.length
              ? deepAnalysisRequested
                ? "NoRetry deeply reviewed the answer and found strong alignment with the requested outcome."
                : "NoRetry found the answer aligned with the requested outcome."
              : "The answer appears aligned with the goal, but some requested details still look unconfirmed."
          : "The answer gave limited concrete evidence, so this review is cautious."

  const supportedDeepEvidence = detail.supported_claims
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean)
    .slice(0, 2)
  const firstMissingCriterion = stage2.missing_criteria.length
    ? normalizeCriterionLabel(stage2.missing_criteria[0])
    : ""
  const firstAnalysisNote = stage2.analysis_notes.find((item) => {
    const normalized = item.trim().toLowerCase()
    return (
      normalized.length > 18 &&
      !normalized.includes("the answer appears to directly deliver the requested content") &&
      !normalized.includes("some acceptance criteria remain unverified")
    )
  }) || ""

  const primaryFinding =
    status === "WRONG_DIRECTION"
      ? `The answer appears to address ${responseFocusSnippet(responseSummary)} instead of ${intent.goal.trim()}.`
      : deepReviewed && supportedDeepEvidence.length && firstMissingCriterion
        ? `Deep review verified ${supportedDeepEvidence[0]}, but it still does not clearly prove: ${firstMissingCriterion}.`
      : deepReviewed && supportedDeepEvidence.length
        ? `Deep review verified ${supportedDeepEvidence.join(" and ")} against the request.`
      : deepReviewed && firstAnalysisNote
        ? `Deep review found: ${firstAnalysisNote}`
      : !codeHeavyTask && deepReviewed && detail.evidence_strength === "weak"
        ? "NoRetry ran a deeper review, but the visible evidence is still too limited to confirm the request is fully satisfied."
      : stage2.problem_fit === "correct" && stage2.missing_criteria.length
        ? `The answer mentions progress, but it still does not clearly show: ${normalizeCriterionLabel(stage2.missing_criteria[0])}.`
      : stage2.problem_fit === "correct" && !stage2.missing_criteria.length
        ? `The answer appears aligned with the goal: ${intent.goal.trim()}.`
        : stage2.problem_fit === "correct"
          ? "The answer appears aligned with the goal, but some requested details still need confirmation."
          : stage1.assistant_action_summary

  return VerdictOutputSchema.parse({
    status,
    confidence,
    confidence_reason: limitText(confidenceReason, 180),
    findings: dedupe(
      [
        primaryFinding,
        stage2.analysis_notes[0] || "",
        detail.supported_claims.length ? `Inspected evidence: ${detail.supported_claims[0]}` : "",
        stage2.missing_criteria.length && !usedFallbackIntent ? stage2.missing_criteria[0] : "",
        responseSummary.failure_signals.length ? `Failure signal: ${responseSummary.failure_signals[0]}` : "",
        hasConcreteEvidence ? `Evidence referenced: ${[...responseSummary.mentioned_files, ...(responseSummary.has_code_blocks ? ["code blocks"] : [])].slice(0, 2).join(", ")}` : ""
      ],
      3
    ),
    issues: dedupe(
      [
        ...stage2.missing_criteria,
        ...stage2.constraint_risks,
        ...detail.contradictions,
        ...detail.unresolved_risks,
        ...(responseSummary.uncertainty_signals.length ? ["The response sounds uncertain."] : []),
        ...(usedFallbackIntent && status !== "WRONG_DIRECTION"
          ? ["NoRetry inferred the goal from the prompt, so this review may be less precise."]
          : [])
      ],
      6
    )
  })
}

function fallbackNextPrompt(
  optimizedPrompt: string,
  verdict: ReturnType<typeof VerdictOutputSchema.parse>,
  stage2: ReturnType<typeof Stage2OutputSchema.parse>
) {
  const focus =
    stage2.missing_criteria[0] ||
    stage2.constraint_risks[0] ||
    verdict.issues[0] ||
    "validate the result against the original request"

  const strategy =
    verdict.status === "FAILED" || verdict.status === "WRONG_DIRECTION"
      ? "resolve_contradiction"
      : stage2.constraint_risks.length
        ? "narrow_scope"
        : stage2.missing_criteria.length
          ? "fix_missing"
          : "validate"

  return NextPromptOutputSchema.parse({
    next_prompt: `${optimizedPrompt}\n\nBefore continuing, focus only on this: ${focus}. Tell me exactly what you changed, what evidence proves it, and whether the original request is now fully satisfied.`,
    prompt_strategy: strategy
  })
}

function buildDeepReviewPrimaryFinding(
  intent: AttemptIntent,
  stage2: ReturnType<typeof Stage2OutputSchema.parse>,
  detail: ReturnType<typeof DetailInspectionSchema.parse>,
  deepCriterionVerifications: z.infer<typeof DeepCriterionVerificationSchema>[] = []
) {
  const blockedVerification = deepCriterionVerifications.find((item) => item.judgment === "blocked")
  const missedVerification = deepCriterionVerifications.find((item) => item.judgment === "missed")
  const metVerification = deepCriterionVerifications.find((item) => item.judgment === "met")
  const supportedClaim = detail.supported_claims
    .map((item) => normalizeWhitespace(item))
    .find(Boolean)
  const unresolvedRisk = detail.unresolved_risks
    .map((item) => normalizeWhitespace(item))
    .find(Boolean)
  const contradiction = detail.contradictions
    .map((item) => normalizeWhitespace(item))
    .find(Boolean)
  const missingCriterion = stage2.missing_criteria
    .map((item) => normalizeCriterionLabel(item))
    .find(Boolean)
  const addressedCriterion = stage2.addressed_criteria
    .map((item) => normalizeCriterionLabel(item))
    .find(Boolean)

  if (blockedVerification) {
    return `Deep could not verify "${blockedVerification.criterion_label}" because the required artifact evidence was not available.`
  }

  if (missedVerification && missedVerification.artifact_findings.length) {
    return `Deep checked artifacts and marked "${missedVerification.criterion_label}" missing.`
  }

  if (metVerification && metVerification.artifact_findings.length) {
    return `Deep verified "${metVerification.criterion_label}" using artifact evidence.`
  }

  if (supportedClaim && missingCriterion) {
    return `Deep review verified ${supportedClaim}, but it still does not directly prove: ${missingCriterion}.`
  }

  if (supportedClaim) {
    return `Deep review verified ${supportedClaim} against the request.`
  }

  if (contradiction) {
    return `Deep review found a contradiction: ${contradiction}`
  }

  if (unresolvedRisk) {
    return `Deep review found a remaining risk: ${unresolvedRisk}`
  }

  if (missingCriterion) {
    return `Deep review still could not directly verify: ${missingCriterion}.`
  }

  if (addressedCriterion) {
    return `Deep review found visible support for: ${addressedCriterion}.`
  }

  return `Deep review inspected the visible answer for proof that it satisfied: ${conciseGoal(intent.goal)}.`
}

function buildChecklistDrivenPrimaryFinding(
  checklist: Array<z.infer<typeof AcceptanceChecklistItemSchema>>,
  reviewContract: ReviewContract,
  deepAnalysisRequested: boolean
) {
  const concreteMissed = checklist
    .filter((item) => item.status === "missed" && !isGenericDisplayCriterion(item.label))
    .map((item) => item.label)
  const concreteUnresolved = checklist
    .filter((item) => item.status === "not_sure" && !isGenericDisplayCriterion(item.label))
    .map((item) => item.label)
  const concreteMet = checklist
    .filter((item) => item.status === "met" && !isGenericDisplayCriterion(item.label))
    .map((item) => item.label)
  const missedCore = checklist
    .filter((item) => item.status === "missed" && item.layer === "core" && !isGenericDisplayCriterion(item.label))
    .map((item) => item.label)
  const unresolvedCore = checklist
    .filter((item) => item.status === "not_sure" && item.layer === "core" && !isGenericDisplayCriterion(item.label))
    .map((item) => item.label)
  const missedValidation = checklist
    .filter((item) => item.status === "missed" && item.layer === "validation" && !isGenericDisplayCriterion(item.label))
    .map((item) => item.label)
  const unresolvedValidation = checklist
    .filter((item) => item.status === "not_sure" && item.layer === "validation" && !isGenericDisplayCriterion(item.label))
    .map((item) => item.label)
  const blockedCore = checklist
    .filter((item) => item.status === "blocked" && item.layer === "core" && !isGenericDisplayCriterion(item.label))
    .map((item) => item.label)
  const blockedValidation = checklist
    .filter((item) => item.status === "blocked" && item.layer === "validation" && !isGenericDisplayCriterion(item.label))
    .map((item) => item.label)
  const visibleVerifiedWork = concreteMet.length ? summarizeChecklistLabels(concreteMet) : ""

  if (deepAnalysisRequested && blockedCore.length) {
    return visibleVerifiedWork
      ? `Deep verified ${visibleVerifiedWork}, but it still needs artifact proof for: ${blockedCore[0]}.`
      : `Deep still needs artifact proof for: ${blockedCore[0]}.`
  }

  if (deepAnalysisRequested && missedCore.length) {
    return visibleVerifiedWork
      ? `Deep review verified ${visibleVerifiedWork}, but it still could not confirm: ${missedCore[0]}.`
      : `Deep review still could not confirm: ${missedCore[0]}.`
  }

  if (!deepAnalysisRequested && missedCore.length) {
    return visibleVerifiedWork
      ? `The answer appears to cover ${visibleVerifiedWork}, but it still does not clearly show: ${missedCore[0]}.`
      : `The answer mentions progress, but it still does not clearly show: ${missedCore[0]}.`
  }

  if (deepAnalysisRequested && missedValidation.length) {
    return visibleVerifiedWork
      ? `Deep review verified ${visibleVerifiedWork}, but it still found a validation failure: ${missedValidation[0]}.`
      : `Deep review resolved the core flow, but it still found a validation failure: ${missedValidation[0]}.`
  }

  if (deepAnalysisRequested && blockedValidation.length) {
    return visibleVerifiedWork
      ? `Deep verified ${visibleVerifiedWork}, but it still needs validation artifacts for: ${blockedValidation[0]}.`
      : `Deep still needs validation artifacts for: ${blockedValidation[0]}.`
  }

  if (!deepAnalysisRequested && unresolvedCore.length) {
    return visibleVerifiedWork
      ? `The answer appears to cover ${visibleVerifiedWork}, but it still does not clearly show: ${unresolvedCore[0]}.`
      : `The answer mentions progress, but it still does not clearly show: ${unresolvedCore[0]}.`
  }

  if (!deepAnalysisRequested && missedValidation.length) {
    return visibleVerifiedWork
      ? `The answer looks aligned with the main goal and appears to cover ${visibleVerifiedWork}, but it still does not clearly show: ${missedValidation[0]}.`
      : `The answer appears aligned with the main goal, but it still does not clearly show: ${missedValidation[0]}.`
  }

  if (!deepAnalysisRequested && unresolvedValidation.length) {
    return visibleVerifiedWork
      ? `The answer looks aligned with the main goal and appears to cover ${visibleVerifiedWork}, but it still does not clearly show: ${unresolvedValidation[0]}.`
      : `The answer appears aligned with the main goal, but it still does not clearly show: ${unresolvedValidation[0]}.`
  }

  if (deepAnalysisRequested && concreteMet.length) {
    return concreteMet.length === checklist.length
      ? "Deep review found direct visible support for every acceptance criterion."
      : `Deep review found direct visible support for: ${summarizeChecklistLabels(concreteMet)}.`
  }

  if (concreteMet.length) {
    return `The answer looks aligned with the goal and appears to cover: ${summarizeChecklistLabels(concreteMet)}.`
  }

  return deepAnalysisRequested
    ? `Deep review inspected the visible answer for proof that it satisfied: ${conciseGoal(reviewContract.goal)}.`
    : `The answer looks aligned with the goal: ${conciseGoal(reviewContract.goal)}.`
}

function buildDeepDeltaFinding(
  baselineChecklist: Array<z.infer<typeof AcceptanceChecklistItemSchema>>,
  deepChecklist: Array<z.infer<typeof AcceptanceChecklistItemSchema>>
) {
  if (!baselineChecklist.length || !deepChecklist.length) return ""

  const baselineMap = new Map(baselineChecklist.map((item) => [normalizeForMatch(item.label), item.status]))
  const changed = deepChecklist.filter((item) => {
    const previous = baselineMap.get(normalizeForMatch(item.label))
    return previous && previous !== item.status
  })

  if (!changed.length) {
    return "Deep review checked the same fixed criteria with tighter evidence and did not need to change checklist outcomes."
  }

  const sample = changed[0]
  const previous = baselineMap.get(normalizeForMatch(sample.label))
  return `Deep review changed ${changed.length} checklist result${changed.length > 1 ? "s" : ""}; for example, ${sample.label} moved from ${previous} to ${summarizeChecklistStatusForFinding(sample.status)}.`
}

export async function analyzeAfterAttempt(input: AfterPipelineRequest) {
  const parsed = input
  const changedFiles = summarizeChangedFiles(parsed.changed_file_paths_summary ?? [])
  const errorSummary = parsed.error_summary?.trim() ?? ""
  const deepAnalysisRequested = parsed.deep_analysis ?? false
  const artifactBundle = normalizeArtifactContext(parsed.artifact_context)
  // Once quick has frozen a contract for this answer, deep should only deepen evidence,
  // not re-derive the checklist or verdict from fresh model drift.
  const frozenDeepReview = deepAnalysisRequested && Boolean(parsed.baseline_review_contract?.criteria?.length)
  const budgetSoftLimit = deepAnalysisRequested ? 2800 : 1800
  const stageSoftDeadline = deepAnalysisRequested ? AFTER_DEEP_STAGE_SOFT_DEADLINE_MS : AFTER_STAGE_SOFT_DEADLINE_MS
  const startedAt = Date.now()
  let tokenUsageTotal = 0
  let intent = parsed.attempt.intent
  let usedFallbackIntent = false
  const initialIntentNeedsContextRescue = intentNeedsContextRescue(intent)
  const elapsed = () => Date.now() - startedAt

  if (needsFallbackIntent(intent)) {
    const prompts = buildIntentExtractionPrompts(
      parsed.attempt.raw_prompt,
      parsed.project_context,
      parsed.current_state
    )
    const maxTokens = tokenUsageTotal >= budgetSoftLimit ? 140 : 220
    const extracted = await callStructuredJson(
      prompts.system,
      prompts.user,
      (value) => IntentExtractionOutputSchema.parse(value),
      maxTokens
    )
    tokenUsageTotal += estimateTokensFromText(prompts.system, prompts.user)
    if (extracted) {
      intent = extracted
      usedFallbackIntent = true
    }
  }

  intent = mergeIntentWithProjectMemory(intent, parsed.project_context, parsed.current_state, {
    aggressive: deepAnalysisRequested,
    forceIncludeAllContext: initialIntentNeedsContextRescue
  })
  const reviewContract = buildReviewContract(
    intent,
    parsed.project_context,
    parsed.current_state,
    parsed.baseline_review_contract ?? null,
    parsed.attempt.attempt_id && parsed.response_summary.response_length
      ? `${parsed.attempt.attempt_id}:${parsed.response_summary.response_length}:${parsed.response_summary.first_excerpt.slice(0, 80)}`
      : parsed.attempt.attempt_id,
    {
      forceIncludeAllContext: initialIntentNeedsContextRescue
    }
  )
  intent = {
    ...intent,
    goal: reviewContract.goal,
    acceptance_criteria: canonicalAcceptanceCriteria(
      intent,
      parsed.baseline_acceptance_criteria,
      reviewContract
    )
  }

  let safeStage1 = fallbackStage1(parsed.response_summary, changedFiles, errorSummary)
  if (!frozenDeepReview) {
    const stage1Prompts = buildStage1Prompts(
      parsed.response_summary,
      intent,
      parsed.project_context,
      parsed.current_state,
      changedFiles,
      errorSummary
    )
    const stage1 = await callStructuredJson(
      stage1Prompts.system,
      stage1Prompts.user,
      (value) => Stage1OutputSchema.parse(value),
      tokenUsageTotal >= budgetSoftLimit ? 120 : 180
    )
    tokenUsageTotal += estimateTokensFromText(stage1Prompts.system, stage1Prompts.user)
    safeStage1 = stage1 ?? safeStage1
  }

  const rawResponse = parsed.response_text_fallback || parsed.response_summary.response_text
  const evidenceCandidates = buildEvidenceCandidates(rawResponse, intent, parsed.response_summary, changedFiles, errorSummary)
  const shouldZoomIn = deepAnalysisRequested && evidenceCandidates.length > 0

  let targetedEvidence = EvidenceTargetingSchema.parse({
    selected_candidate_ids: [],
    risk_flags: [],
    inspection_goal: ""
  })

  if (shouldZoomIn) {
    if (frozenDeepReview) {
      targetedEvidence = buildFrozenDeepEvidenceTargeting(
        reviewContract,
        evidenceCandidates,
        parsed.response_summary,
        parsed.baseline_acceptance_checklist
      )
    } else {
      const stage2Prompts = buildStage2Prompts(
        intent,
        reviewContract,
        safeStage1,
        parsed.response_summary,
        evidenceCandidates,
        deepAnalysisRequested,
        parsed.project_context,
        parsed.current_state,
        changedFiles,
        errorSummary
      )
      const stage2Targeting = await callStructuredJson(
        stage2Prompts.system,
        stage2Prompts.user,
        (value) => sanitizeEvidenceTargeting(value),
        tokenUsageTotal >= budgetSoftLimit ? 90 : 140
      )
      tokenUsageTotal += estimateTokensFromText(stage2Prompts.system, stage2Prompts.user)
      targetedEvidence =
        stage2Targeting ??
        EvidenceTargetingSchema.parse({
          selected_candidate_ids: evidenceCandidates.slice(0, deepAnalysisRequested ? 4 : 3).map((candidate) => candidate.id),
          risk_flags: parsed.response_summary.success_signals.length ? ["success_claim_needs_evidence"] : [],
          inspection_goal: limitText(
            `Verify whether the visible answer truly supports: ${compressGoal(intent.goal)}`,
            180
          )
        })
    }
  }

  const selectedEvidence = (
    targetedEvidence.selected_candidate_ids.length
      ? evidenceCandidates.filter((candidate) => targetedEvidence.selected_candidate_ids.includes(candidate.id))
      : shouldZoomIn
        ? evidenceCandidates.slice(0, deepAnalysisRequested ? 4 : 3)
        : []
  ).slice(0, 4)

  let detailInspection = fallbackDetailInspection(selectedEvidence, parsed.response_summary)
  if (!frozenDeepReview && selectedEvidence.length && elapsed() < stageSoftDeadline) {
    const stage3Prompts = buildStage3Prompts(
      intent,
      reviewContract,
      safeStage1,
      targetedEvidence,
      parsed.response_summary,
      selectedEvidence,
      deepAnalysisRequested,
      parsed.project_context,
      parsed.current_state,
      changedFiles,
      errorSummary
    )
    const detail = await callStructuredJson(
      stage3Prompts.system,
      stage3Prompts.user,
      (value) => DetailInspectionSchema.parse(value),
      tokenUsageTotal >= budgetSoftLimit ? 130 : deepAnalysisRequested ? 220 : 170
    )
    tokenUsageTotal += estimateTokensFromText(stage3Prompts.system, stage3Prompts.user)
    detailInspection = detail ?? detailInspection
  }

  const fallbackAlignedStage2 = fallbackStage2(reviewContract, intent, safeStage1, detailInspection, parsed.response_summary)
  let safeStage2 = normalizeStage2AgainstReviewContract(
    frozenDeepReview
      ? buildFrozenDeepStage2FromEvidence(reviewContract, intent, safeStage1, selectedEvidence, parsed.response_summary)
      : fallbackAlignedStage2,
    reviewContract
  )
  if (!frozenDeepReview) {
    const alignmentPrompts = {
      system:
        `Compare the assistant response to the intended goal. Use the saved project context and current debugging state so the judgment stays grounded in the user's real situation. ${reviewQualityContract(deepAnalysisRequested)} Return JSON only with keys: addressed_criteria, missing_criteria, constraint_risks, problem_fit, analysis_notes.`,
      user: JSON.stringify({
        intent,
        review_contract: reviewContract,
        project_context: parsed.project_context,
        current_state: parsed.current_state,
        stage_1: safeStage1,
        detail_inspection: detailInspection,
        response_excerpts: buildResponseExcerpts(parsed.response_summary),
        response_summary: {
          mentioned_files: parsed.response_summary.mentioned_files,
          change_claims: summarizeChangeClaims(parsed.response_summary),
          validation_signals: summarizeValidationSignals(parsed.response_summary),
          success_signals: parsed.response_summary.success_signals,
          failure_signals: parsed.response_summary.failure_signals,
          uncertainty_signals: parsed.response_summary.uncertainty_signals
        },
        changed_file_paths_summary: changedFiles,
        error_summary: errorSummary
      })
    }
    const stage4Alignment = await callStructuredJson(
      alignmentPrompts.system,
      alignmentPrompts.user,
      (value) => Stage2OutputSchema.parse(value),
      tokenUsageTotal >= budgetSoftLimit ? 130 : deepAnalysisRequested ? 220 : 180
    )
    tokenUsageTotal += estimateTokensFromText(alignmentPrompts.system, alignmentPrompts.user)
    safeStage2 = normalizeStage2AgainstReviewContract(stage4Alignment ?? fallbackAlignedStage2, reviewContract)
  }

  const artifactAwareDeepEvaluation = deepAnalysisRequested
    ? buildArtifactAwareDeepEvaluation(reviewContract, artifactBundle, parsed.response_summary)
    : null
  if (artifactAwareDeepEvaluation) {
    detailInspection = artifactAwareDeepEvaluation.detailInspection
    safeStage2 = artifactAwareDeepEvaluation.stage2
  }

  let safeVerdict = fallbackVerdict(
    intent,
    parsed.response_summary,
    safeStage1,
    safeStage2,
    detailInspection,
    usedFallbackIntent,
    deepAnalysisRequested
  )
  let safeNextPrompt = fallbackNextPrompt(parsed.attempt.optimized_prompt, safeVerdict, safeStage2)

  if (!frozenDeepReview && elapsed() < stageSoftDeadline) {
    const stage4Prompts = buildStage4Prompts(
      intent,
      reviewContract,
      safeStage1,
      safeStage2,
      detailInspection,
      parsed.response_summary,
      deepAnalysisRequested,
      parsed.project_context,
      parsed.current_state,
      changedFiles,
      errorSummary
    )
    const verdict = await callStructuredJson(
      stage4Prompts.system,
      stage4Prompts.user,
      (value) => VerdictOutputSchema.parse(value),
      tokenUsageTotal >= budgetSoftLimit ? 120 : deepAnalysisRequested ? 200 : 160
    )
    tokenUsageTotal += estimateTokensFromText(stage4Prompts.system, stage4Prompts.user)
    safeVerdict = verdict ?? safeVerdict
  }

  if (!frozenDeepReview && elapsed() < stageSoftDeadline) {
    const stage5Prompts = buildStage5Prompts(
      parsed.attempt.optimized_prompt,
      intent,
      safeVerdict,
      safeStage2,
      parsed.project_context,
      parsed.current_state,
      changedFiles,
      errorSummary
    )
    const nextPromptOutput = await callStructuredJson(
      stage5Prompts.system,
      stage5Prompts.user,
      (value) => NextPromptOutputSchema.parse(value),
      tokenUsageTotal >= budgetSoftLimit ? 150 : deepAnalysisRequested ? 240 : 180
    )
    tokenUsageTotal += estimateTokensFromText(stage5Prompts.system, stage5Prompts.user)
    safeNextPrompt = nextPromptOutput ?? safeNextPrompt
  }

  const acceptanceChecklist = buildAcceptanceChecklist(
    reviewContract,
    safeStage2,
    detailInspection,
    parsed.response_summary,
    deepAnalysisRequested,
    artifactAwareDeepEvaluation?.verifications ?? []
  )
  if (deepAnalysisRequested) {
    safeStage2 = alignStage2WithChecklist(safeStage2, acceptanceChecklist, reviewContract)
  }
  safeVerdict = reconcileVerdictWithChecklist(
    safeVerdict,
    acceptanceChecklist,
    reviewContract,
    safeStage2,
    detailInspection,
    deepAnalysisRequested
  )
  if (deepAnalysisRequested) {
    safeNextPrompt = fallbackNextPrompt(parsed.attempt.optimized_prompt, safeVerdict, safeStage2)
  }

  const checklistDrivenPrimaryFinding = buildChecklistDrivenPrimaryFinding(
    acceptanceChecklist,
    reviewContract,
    deepAnalysisRequested
  )
  const deepDeltaFinding =
    deepAnalysisRequested
      ? buildDeepDeltaFinding(parsed.baseline_acceptance_checklist, acceptanceChecklist)
      : ""
  safeVerdict = VerdictOutputSchema.parse({
    ...safeVerdict,
    findings: dedupe([checklistDrivenPrimaryFinding, deepDeltaFinding, ...safeVerdict.findings], 3)
  })

  if (deepAnalysisRequested && detailInspection.inspection_depth !== "summary_only") {
    const deepPrimaryFinding = buildDeepReviewPrimaryFinding(
      intent,
      safeStage2,
      detailInspection,
      artifactAwareDeepEvaluation?.verifications ?? []
    )
    safeVerdict = VerdictOutputSchema.parse({
      ...safeVerdict,
      findings: dedupe([deepPrimaryFinding, ...safeVerdict.findings], 3)
    })
  }

  const decisionPresentation = buildDecisionPresentation({
    verdict: safeVerdict,
    checklist: acceptanceChecklist,
    reviewContract,
    verifications: artifactAwareDeepEvaluation?.verifications ?? [],
    contradictionCount: artifactAwareDeepEvaluation?.contradictionCount ?? 0,
    deepAnalysisRequested,
    baselineDecision: parsed.baseline_decision,
    baselineConfidence: parsed.baseline_confidence,
    baselineChecklist: parsed.baseline_acceptance_checklist,
    bundle: artifactBundle,
    responseSummary: parsed.response_summary,
    intent,
    usedFallbackIntent,
    detailInspection,
    optimizedPrompt: parsed.attempt.optimized_prompt
  })
  safeVerdict = VerdictOutputSchema.parse({
    ...safeVerdict,
    confidence: decisionPresentation.confidence,
    confidence_reason: decisionPresentation.confidenceReasons[0] ?? safeVerdict.confidence_reason
  })
  safeNextPrompt = decisionPresentation.nextPromptOutput
  const sanitizedReviewContract = sanitizeReviewContractForSchema(reviewContract)
  const sanitizedAcceptanceChecklist = sanitizeAcceptanceChecklistForSchema(acceptanceChecklist)
  const sanitizedDeepVerifications = sanitizeDeepVerificationsForSchema(
    artifactAwareDeepEvaluation?.verifications ?? []
  )

  return AfterPipelineResponseSchema.parse({
    status: safeVerdict.status,
    confidence: safeVerdict.confidence,
    popup_state: decisionPresentation.popupState,
    review_mode_label: decisionPresentation.reviewModeLabel,
    review_mode_explainer: decisionPresentation.reviewModeExplainer,
    confidence_label: decisionPresentation.confidenceLabel,
    confidence_trend: decisionPresentation.confidenceTrend,
    confidence_reason: limitText(safeVerdict.confidence_reason, CONFIDENCE_REASON_MAX),
    confidence_reasons: decisionPresentation.confidenceReasons,
    inspection_depth: detailInspection.inspection_depth,
    decision: decisionPresentation.decision,
    decision_display_label: decisionPresentation.decisionDisplayLabel,
    delta_from_quick: decisionPresentation.deltaFromQuick,
    recommended_action: decisionPresentation.recommendedAction,
    why_bullets: decisionPresentation.whyBullets,
    next_action: decisionPresentation.nextAction,
    findings: safeVerdict.findings,
    issues: safeVerdict.issues,
    next_prompt: safeNextPrompt.next_prompt,
    prompt_strategy: safeNextPrompt.prompt_strategy,
    next_prompt_explanation: limitText(safeNextPrompt.next_prompt_explanation, WHY_BULLET_MAX),
    expected_outcome: limitText(safeNextPrompt.expected_outcome, WHY_BULLET_MAX),
    stage_1: safeStage1,
    stage_2: safeStage2,
    verdict: safeVerdict,
    next_prompt_output: safeNextPrompt,
    acceptance_checklist: sanitizedAcceptanceChecklist,
    review_contract: sanitizedReviewContract,
    response_summary: parsed.response_summary,
    checked_artifact_types: artifactAwareDeepEvaluation?.checkedArtifactTypes ?? [],
    checked_artifacts: decisionPresentation.checkedArtifacts,
    unchecked_artifacts: decisionPresentation.uncheckedArtifacts,
    blocked_or_unproven_items: decisionPresentation.blockedOrUnprovenItems,
    deep_criterion_verifications: sanitizedDeepVerifications,
    contradiction_count: artifactAwareDeepEvaluation?.contradictionCount ?? 0,
    helpful_feedback: {
      helpful: null,
      next_prompt_success: null
    },
    used_fallback_intent: usedFallbackIntent,
    token_usage_total: tokenUsageTotal
  })
}
