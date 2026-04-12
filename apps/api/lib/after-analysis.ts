import {
  AcceptanceChecklistItemSchema,
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
  type AttemptIntent,
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
  }
): AttemptIntent {
  const aggressive = options?.aggressive ?? false
  const currentGoalHint =
    extractPrefixedLine(currentState, ["working on", "current goal", "goal", "what i am working on"]) ||
    extractPrefixedLine(projectContext, ["user-facing goal", "definition of done", "goal"])

  const definitionOfDone = extractSectionLines(projectContext, ["definition of done"]).concat(
    extractSectionLines(currentState, ["definition of done"])
  )

  const userIntentToPreserve = extractSectionLines(projectContext, ["user intent to preserve"]).concat(
    extractSectionLines(currentState, ["user intent to preserve"])
  )
  const constraintsFromContext = extractSectionLines(projectContext, ["constraints"])
    .concat(extractSectionLines(currentState, ["constraints"]))
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

  return normalized
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

  return Stage2OutputSchema.parse({
    ...stage2,
    addressed_criteria: addressedCriteria,
    missing_criteria: missingCriteria,
    analysis_notes: dedupe(
      stage2.analysis_notes.filter((note) => {
        const normalized = note.trim().toLowerCase()
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
  targetSignature: string
): ReviewContract {
  if (baselineContract?.criteria?.length) {
    return ReviewContractSchema.parse({
      ...baselineContract,
      target_signature: targetSignature || baselineContract.target_signature || "",
      goal: baselineContract.goal || intent.goal,
      criteria: baselineContract.criteria.slice(0, MAX_REVIEW_CRITERIA)
    })
  }

  const definitionOfDone = extractSectionLines(projectContext, ["definition of done"]).concat(
    extractSectionLines(currentState, ["definition of done"])
  )
  const userIntentToPreserve = extractSectionLines(projectContext, ["user intent to preserve"]).concat(
    extractSectionLines(currentState, ["user intent to preserve"])
  )
  const validationCriteria = extractSectionLines(projectContext, ["constraints"])
    .concat(extractSectionLines(currentState, ["constraints"]))
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
  const normalizedCriterion = normalizeForMatch(criterion)
  const haystack = normalizeForMatch(responseSummary.response_text)
  const validationHaystack = normalizeForMatch(
    [
      ...responseSummary.validation_signals,
      ...responseSummary.success_signals,
      ...responseSummary.change_claims,
      ...responseSummary.mentioned_files
    ].join(" ")
  )

  if (criterionExplicitlyUnproven(criterion, responseSummary)) {
    return false
  }

  if (/return only/i.test(criterion) && /html|code block|markdown code block/i.test(criterion)) {
    return responseSummary.has_code_blocks
  }

  if (/no explanations/i.test(criterion)) {
    return responseSummary.has_code_blocks && responseIsMostlyCode(responseSummary.response_text)
  }

  if (/red\/yellow\/green button|strength button/i.test(criterion) && /textarea|chat textarea|prompt area/i.test(criterion)) {
    return hasAllSignals(haystack, [
      /\b(button|badge|icon)\b/i,
      /\b(visible|appear(?:s|ed)?|shows?)\b/i,
      /\b(textarea|chat|prompt)\b/i
    ])
  }

  if (/opens the optimize panel|llm-generated questions|strength badge/i.test(criterion)) {
    return hasAllSignals(haystack, [
      /\b(click(?:ing)?|tap(?:ping)?)\b/i,
      /\b(open(?:s|ed)?|show(?:s|ed)?)\b/i,
      /\b(panel|popup|optimi[sz]e)\b/i
    ]) && /\b(question|badge)\b/i.test(haystack)
  }

  if (/answer questions and receive a generated improved prompt with acceptance criteria/i.test(criterion)) {
    return hasAllSignals(haystack, [
      /\b(answer(?:ed|ing)?|question(?:s)?)\b/i,
      /\b(generate(?:d|s)?|generated)\b/i,
      /\b(improved prompt|acceptance criteria)\b/i
    ])
  }

  if (/replace button injects|text visibly updates|injects the improved prompt/i.test(criterion)) {
    return hasAllSignals(haystack, [
      /\b(replace button|replace)\b/i,
      /\b(inject(?:s|ed)?|write(?:s|n)? back|updates?)\b/i,
      /\b(textarea|prompt text|text visibly updates?)\b/i
    ])
  }

  if (/popup opens|auth state|usage|strengthen tab works end-to-end/i.test(criterion)) {
    return hasAllSignals(haystack, [
      /\b(popup|extension icon|strengthen tab)\b/i,
      /\b(open(?:s|ed)?)\b/i,
      /\b(auth state|usage|end-to-end)\b/i
    ])
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
  responseSummary: AfterPipelineRequest["response_summary"]
) {
  return EvidenceTargetingSchema.parse({
    selected_candidate_ids: candidates.slice(0, 4).map((candidate) => candidate.id),
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
      "Write the next best prompt for the user. Keep scope tight and focus only on what is missing or risky. Return JSON only with keys: next_prompt, prompt_strategy.",
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
  deepAnalysisRequested = false
) {
  const addressedKeys = new Set(stage2.addressed_criteria.map((item) => normalizeForMatch(item)))
  const missedKeys = new Set(stage2.missing_criteria.map((item) => normalizeForMatch(item)))
  const binaryDecisionRequired = deepAnalysisRequested || detail.inspection_depth !== "summary_only"

  return reviewContract.criteria.slice(0, MAX_REVIEW_CRITERIA).map((criterion) =>
    {
      const normalizedLabel = normalizeForMatch(criterion.label)
      const quickSatisfied = quickCriterionSatisfied(criterion.label, responseSummary)
      const explicitlyUnproven = criterionExplicitlyUnproven(criterion.label, responseSummary)

      let status: "met" | "not_sure" | "missed"
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
      return status === "missed" || status === "not_sure"
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

  const analysisNotes = dedupe(
    stage2.analysis_notes.filter((note) => {
      const normalized = note.trim().toLowerCase()
      if (!missingCriteria.length) {
        return (
          !normalized.includes("some acceptance criteria remain unverified") &&
          !normalized.includes("still does not clearly show") &&
          !normalized.includes("needs proof")
        )
      }

      return true
    }),
    4
  )

  return Stage2OutputSchema.parse({
    ...stage2,
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
  const missedCore = coreCriteria.filter((criterion) => statusForCriterion(criterion) === "missed")
  const missedValidation = validationCriteria.filter((criterion) => statusForCriterion(criterion) === "missed")
  const unresolvedCore = coreCriteria.filter((criterion) => statusForCriterion(criterion) === "not_sure")
  const unresolvedValidation = validationCriteria.filter((criterion) => statusForCriterion(criterion) === "not_sure")
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
  } else if (unresolvedCore.length > 0) {
    status = "PARTIAL"
    confidence = "medium"
    confidenceReason = `A core requirement still needs proof: ${unresolvedCore[0].label}.`
  } else if (missedValidation.length > 0 || unresolvedValidation.length > 0) {
    status = "LIKELY_SUCCESS"
    confidence = detail.inspection_depth === "summary_only" ? "medium" : "high"
    confidenceReason =
      missedValidation.length > 0
        ? deepAnalysisRequested && detail.inspection_depth !== "summary_only" && unresolvedCount === 0
          ? `Deep review resolved the fixed checklist and found a failed validation check: ${missedValidation[0].label}.`
          : `Core requirements look satisfied, but a validation check failed: ${missedValidation[0].label}.`
        : `Core requirements look satisfied, but a validation check still needs proof: ${unresolvedValidation[0].label}.`
  } else if (stage2.problem_fit === "wrong_direction") {
    status = "WRONG_DIRECTION"
    confidence = detail.inspection_depth === "summary_only" ? "medium" : "high"
    confidenceReason = "The answer appears to solve a different problem than the frozen review contract."
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
    verdict.status === "FAILED"
      ? "retry_cleanly"
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
  detail: ReturnType<typeof DetailInspectionSchema.parse>
) {
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
  const visibleVerifiedWork = concreteMet.length ? summarizeChecklistLabels(concreteMet) : ""

  if (deepAnalysisRequested && missedCore.length) {
    return visibleVerifiedWork
      ? `Deep review verified ${visibleVerifiedWork}, but it still could not confirm: ${missedCore[0]}.`
      : `Deep review still could not confirm: ${missedCore[0]}.`
  }

  if (!deepAnalysisRequested && missedCore.length) {
    return visibleVerifiedWork
      ? `The answer visibly covers ${visibleVerifiedWork}, but it still does not clearly show: ${missedCore[0]}.`
      : `The answer mentions progress, but it still does not clearly show: ${missedCore[0]}.`
  }

  if (deepAnalysisRequested && missedValidation.length) {
    return visibleVerifiedWork
      ? `Deep review verified ${visibleVerifiedWork}, but it still found a validation failure: ${missedValidation[0]}.`
      : `Deep review resolved the core flow, but it still found a validation failure: ${missedValidation[0]}.`
  }

  if (!deepAnalysisRequested && unresolvedCore.length) {
    return visibleVerifiedWork
      ? `The answer visibly covers ${visibleVerifiedWork}, but it still does not clearly show: ${unresolvedCore[0]}.`
      : `The answer mentions progress, but it still does not clearly show: ${unresolvedCore[0]}.`
  }

  if (!deepAnalysisRequested && missedValidation.length) {
    return visibleVerifiedWork
      ? `The answer appears aligned with the main goal and visibly covers ${visibleVerifiedWork}, but it still does not clearly show: ${missedValidation[0]}.`
      : `The answer appears aligned with the main goal, but it still does not clearly show: ${missedValidation[0]}.`
  }

  if (!deepAnalysisRequested && unresolvedValidation.length) {
    return visibleVerifiedWork
      ? `The answer appears aligned with the main goal and visibly covers ${visibleVerifiedWork}, but it still does not clearly show: ${unresolvedValidation[0]}.`
      : `The answer appears aligned with the main goal, but it still does not clearly show: ${unresolvedValidation[0]}.`
  }

  if (deepAnalysisRequested && concreteMet.length) {
    return concreteMet.length === checklist.length
      ? "Deep review found direct visible support for every acceptance criterion."
      : `Deep review found direct visible support for: ${summarizeChecklistLabels(concreteMet)}.`
  }

  if (concreteMet.length) {
    return `The answer appears aligned with the goal and visibly covers: ${summarizeChecklistLabels(concreteMet)}.`
  }

  return deepAnalysisRequested
    ? `Deep review inspected the visible answer for proof that it satisfied: ${conciseGoal(reviewContract.goal)}.`
    : `The answer appears aligned with the goal: ${conciseGoal(reviewContract.goal)}.`
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
  return `Deep review changed ${changed.length} checklist result${changed.length > 1 ? "s" : ""}; for example, ${sample.label} moved from ${previous} to ${sample.status}.`
}

export async function analyzeAfterAttempt(input: AfterPipelineRequest) {
  const parsed = input
  const changedFiles = summarizeChangedFiles(parsed.changed_file_paths_summary ?? [])
  const errorSummary = parsed.error_summary?.trim() ?? ""
  const deepAnalysisRequested = parsed.deep_analysis ?? false
  // Once quick has frozen a contract for this answer, deep should only deepen evidence,
  // not re-derive the checklist or verdict from fresh model drift.
  const frozenDeepReview = deepAnalysisRequested && Boolean(parsed.baseline_review_contract?.criteria?.length)
  const budgetSoftLimit = deepAnalysisRequested ? 2800 : 1800
  const stageSoftDeadline = deepAnalysisRequested ? AFTER_DEEP_STAGE_SOFT_DEADLINE_MS : AFTER_STAGE_SOFT_DEADLINE_MS
  const startedAt = Date.now()
  let tokenUsageTotal = 0
  let intent = parsed.attempt.intent
  let usedFallbackIntent = false
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
    aggressive: deepAnalysisRequested
  })
  const reviewContract = buildReviewContract(
    intent,
    parsed.project_context,
    parsed.current_state,
    parsed.baseline_review_contract ?? null,
    parsed.attempt.attempt_id && parsed.response_summary.response_length
      ? `${parsed.attempt.attempt_id}:${parsed.response_summary.response_length}:${parsed.response_summary.first_excerpt.slice(0, 80)}`
      : parsed.attempt.attempt_id
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
      targetedEvidence = buildFrozenDeepEvidenceTargeting(reviewContract, evidenceCandidates, parsed.response_summary)
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
  let safeStage2 = normalizeStage2AgainstReviewContract(fallbackAlignedStage2, reviewContract)
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
    deepAnalysisRequested
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
    const deepPrimaryFinding = buildDeepReviewPrimaryFinding(intent, safeStage2, detailInspection)
    safeVerdict = VerdictOutputSchema.parse({
      ...safeVerdict,
      findings: dedupe([deepPrimaryFinding, ...safeVerdict.findings], 3)
    })
  }

  return AfterPipelineResponseSchema.parse({
    status: safeVerdict.status,
    confidence: safeVerdict.confidence,
    confidence_reason: safeVerdict.confidence_reason,
    inspection_depth: detailInspection.inspection_depth,
    findings: safeVerdict.findings,
    issues: safeVerdict.issues,
    next_prompt: safeNextPrompt.next_prompt,
    prompt_strategy: safeNextPrompt.prompt_strategy,
    stage_1: safeStage1,
    stage_2: safeStage2,
    verdict: safeVerdict,
    next_prompt_output: safeNextPrompt,
    acceptance_checklist: acceptanceChecklist,
    review_contract: reviewContract,
    response_summary: parsed.response_summary,
    used_fallback_intent: usedFallbackIntent,
    token_usage_total: tokenUsageTotal
  })
}
