import {
  AcceptanceChecklistItemSchema,
  AfterPipelineResponseSchema,
  IntentExtractionOutputSchema,
  NextPromptOutputSchema,
  Stage1OutputSchema,
  Stage2OutputSchema,
  VerdictOutputSchema,
  type AfterPipelineRequest,
  type AttemptIntent
} from "@prompt-optimizer/shared"
import { buildResponseExcerpts, compressGoal } from "@prompt-optimizer/shared"
import * as z from "zod"
import { trimForBudget } from "./cost-control"
import { callDeepSeekJson } from "./deepseek"
import { callKimiJson } from "./kimi"

const AFTER_STAGE_SOFT_DEADLINE_MS = 8000
const AFTER_DEEP_STAGE_SOFT_DEADLINE_MS = 16000
const EVIDENCE_EXCERPT_LIMIT = 320

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

function responseIsMostlyCode(responseText: string) {
  const stripped = normalizeWhitespace(
    responseText
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
  )
  return stripped.length < 80
}

function quickCriterionSatisfied(criterion: string, responseSummary: AfterPipelineRequest["response_summary"]) {
  const normalizedCriterion = normalizeForMatch(criterion)
  const haystack = normalizeForMatch(responseSummary.response_text)

  if (/return only/i.test(criterion) && /html|code block|markdown code block/i.test(criterion)) {
    return responseSummary.has_code_blocks
  }

  if (/no explanations/i.test(criterion)) {
    return responseSummary.has_code_blocks && responseIsMostlyCode(responseSummary.response_text)
  }

  const tokens = extractMeaningfulTokens(normalizedCriterion).filter(
    (token) =>
      !["return", "only", "complete", "updated", "html", "block", "markdown", "already", "implemented"].includes(token)
  )

  if (!tokens.length) return false

  const matched = tokens.filter((token) => haystack.includes(token))
  return matched.length >= Math.min(2, tokens.length) || matched.length / tokens.length >= 0.66
}

function issueMentionsCriterion(criterion: string, issues: string[]) {
  const criterionTokens = extractMeaningfulTokens(criterion).slice(0, 6)
  if (!criterionTokens.length) return false
  const issueHaystack = normalizeForMatch(issues.join(" "))
  const matched = criterionTokens.filter((token) => issueHaystack.includes(token))
  return matched.length >= Math.min(2, criterionTokens.length)
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

  return (
    intent.task_type === "other" &&
    (weakCriteria || goalTokens.length < 3)
  )
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
  stage1: ReturnType<typeof Stage1OutputSchema.parse>,
  responseSummary: AfterPipelineRequest["response_summary"],
  candidates: EvidenceCandidate[],
  projectContext = "",
  currentState = "",
  changedFiles: string[] = [],
  errorSummary = ""
) {
  return {
    system:
      "Choose which raw answer excerpts deserve closer inspection. Prioritize evidence that can confirm or refute the claimed fix against the saved goal, current debugging state, repeated bugs, and visible error summary. Return JSON only with keys: selected_candidate_ids, risk_flags, inspection_goal. Pick at most 4 IDs.",
    user: JSON.stringify({
      intent: {
        goal: compressGoal(intent.goal),
        constraints: intent.constraints.slice(0, 4),
        acceptance_criteria: intent.acceptance_criteria.slice(0, 4)
      },
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
  stage1: ReturnType<typeof Stage1OutputSchema.parse>,
  stage2: ReturnType<typeof EvidenceTargetingSchema.parse>,
  responseSummary: AfterPipelineRequest["response_summary"],
  selectedEvidence: EvidenceCandidate[],
  projectContext = "",
  currentState = "",
  changedFiles: string[] = [],
  errorSummary = ""
) {
  return {
    system:
      "Inspect the selected raw answer excerpts and decide whether they support the assistant's claims. Use the project context, current debugging state, repeated bugs, and the current visible error summary to distinguish a real fix from a partial or drifting change. Return JSON only with keys: supported_claims, contradictions, unresolved_risks, evidence_strength, inspection_depth.",
    user: JSON.stringify({
      intent: {
        goal: compressGoal(intent.goal),
        constraints: intent.constraints.slice(0, 4),
        acceptance_criteria: intent.acceptance_criteria.slice(0, 4)
      },
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
  stage1: ReturnType<typeof Stage1OutputSchema.parse>,
  stage2: ReturnType<typeof Stage2OutputSchema.parse>,
  detail: ReturnType<typeof DetailInspectionSchema.parse>,
  responseSummary: AfterPipelineRequest["response_summary"],
  projectContext = "",
  currentState = "",
  changedFiles: string[] = [],
  errorSummary = ""
) {
  return {
    system:
      "Generate a trustworthy verdict for the AI response. Prefer UNVERIFIED over success when evidence is weak. Use the project context, current debugging state, changed file hints, and visible error summary to judge whether the answer really resolves the user's debugging situation instead of only sounding plausible. Return JSON only with keys: status, confidence, findings, issues.",
    user: JSON.stringify({
      intent,
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
  intent: AttemptIntent,
  stage1: ReturnType<typeof Stage1OutputSchema.parse>,
  detail: ReturnType<typeof DetailInspectionSchema.parse>,
  responseSummary: AfterPipelineRequest["response_summary"]
) {
  const codeHeavyTask = isCodeHeavyTask(intent)
  const nonCodeChecks = codeHeavyTask ? { addressed: [], missing: [] } : evaluateNonCodeCriteria(intent, responseSummary)
  const goalMatched = hasGoalEvidence(intent.goal, responseSummary)
  const usesDefaultGoalCriterion = intent.acceptance_criteria.some((criterion) =>
    /prove the answer solved this goal:/i.test(criterion)
  )
  const hasOnTopicSignals =
    goalMatched &&
    (stage1.response_mode === "implemented" ||
      stage1.response_mode === "explained" ||
      responseSummary.success_signals.length > 0 ||
      responseSummary.response_length > 220)
  const quickAddressedCriteria = intent.acceptance_criteria.filter((criterion) =>
    quickCriterionSatisfied(criterion, responseSummary)
  )

  const addressed =
    (stage1.response_mode === "implemented" || detail.evidence_strength === "strong") && goalMatched
      ? dedupe([...quickAddressedCriteria, ...intent.acceptance_criteria], 4)
      : quickAddressedCriteria.length
        ? quickAddressedCriteria.slice(0, 4)
      : !codeHeavyTask && nonCodeChecks.addressed.length && goalMatched && detail.inspection_depth !== "summary_only"
        ? intent.acceptance_criteria.slice(0, Math.min(2, Math.max(1, nonCodeChecks.addressed.length)))
      : !codeHeavyTask && usesDefaultGoalCriterion && goalMatched && detail.inspection_depth !== "summary_only"
        ? intent.acceptance_criteria.slice(0, 1)
        : usesDefaultGoalCriterion && hasOnTopicSignals
        ? intent.acceptance_criteria.slice(0, 1)
        : []
  const rawMissing = intent.acceptance_criteria.filter((criterion) => !addressed.includes(criterion)).slice(0, 4)
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
  intent: AttemptIntent,
  stage2: ReturnType<typeof Stage2OutputSchema.parse>,
  detail: ReturnType<typeof DetailInspectionSchema.parse>,
  responseSummary: AfterPipelineRequest["response_summary"]
) {
  const addressedKeys = new Set(stage2.addressed_criteria.map((item) => normalizeForMatch(item)))
  const issuePool = [...stage2.missing_criteria, ...stage2.constraint_risks, ...detail.unresolved_risks]

  return intent.acceptance_criteria.slice(0, 6).map((criterion) =>
    AcceptanceChecklistItemSchema.parse({
      label: limitText(normalizeCriterionLabel(criterion), 72),
      status:
        addressedKeys.has(normalizeForMatch(criterion)) || quickCriterionSatisfied(criterion, responseSummary)
          ? "met"
          : detail.inspection_depth !== "summary_only" && issueMentionsCriterion(criterion, issuePool)
            ? "missed"
            : "not_sure"
    })
  )
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

  const primaryFinding =
    status === "WRONG_DIRECTION"
      ? `The answer appears to address ${responseFocusSnippet(responseSummary)} instead of ${intent.goal.trim()}.`
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
    confidence_reason: confidenceReason,
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

export async function analyzeAfterAttempt(input: AfterPipelineRequest) {
  const parsed = input
  const changedFiles = summarizeChangedFiles(parsed.changed_file_paths_summary ?? [])
  const errorSummary = parsed.error_summary?.trim() ?? ""
  const deepAnalysisRequested = parsed.deep_analysis ?? false
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
  const safeStage1 = stage1 ?? fallbackStage1(parsed.response_summary, changedFiles, errorSummary)

  const rawResponse = parsed.response_text_fallback || parsed.response_summary.response_text
  const evidenceCandidates = buildEvidenceCandidates(rawResponse, intent, parsed.response_summary, changedFiles, errorSummary)
  const shouldZoomIn = deepAnalysisRequested && evidenceCandidates.length > 0

  let targetedEvidence = EvidenceTargetingSchema.parse({
    selected_candidate_ids: [],
    risk_flags: [],
    inspection_goal: ""
  })

  if (shouldZoomIn) {
    const stage2Prompts = buildStage2Prompts(
      intent,
      safeStage1,
      parsed.response_summary,
      evidenceCandidates,
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
        inspection_goal: `Verify whether the visible answer truly supports: ${compressGoal(intent.goal)}`
      })
  }

  const selectedEvidence = (
    targetedEvidence.selected_candidate_ids.length
      ? evidenceCandidates.filter((candidate) => targetedEvidence.selected_candidate_ids.includes(candidate.id))
      : shouldZoomIn
        ? evidenceCandidates.slice(0, deepAnalysisRequested ? 4 : 3)
        : []
  ).slice(0, 4)

  let detailInspection = fallbackDetailInspection(selectedEvidence, parsed.response_summary)
  if (selectedEvidence.length && elapsed() < stageSoftDeadline) {
    const stage3Prompts = buildStage3Prompts(
      intent,
      safeStage1,
      targetedEvidence,
      parsed.response_summary,
      selectedEvidence,
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

  const alignmentPrompts = {
    system:
      "Compare the assistant response to the intended goal. Use the saved project context and current debugging state so the judgment stays grounded in the user's real situation. Return JSON only with keys: addressed_criteria, missing_criteria, constraint_risks, problem_fit, analysis_notes.",
    user: JSON.stringify({
      intent,
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
  const safeStage2 = stage4Alignment ?? fallbackStage2(intent, safeStage1, detailInspection, parsed.response_summary)

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

  if (elapsed() < stageSoftDeadline) {
    const stage4Prompts = buildStage4Prompts(
      intent,
      safeStage1,
      safeStage2,
      detailInspection,
      parsed.response_summary,
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

  if (elapsed() < stageSoftDeadline) {
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
    acceptance_checklist: buildAcceptanceChecklist(intent, safeStage2, detailInspection, parsed.response_summary),
    response_summary: parsed.response_summary,
    used_fallback_intent: usedFallbackIntent,
    token_usage_total: tokenUsageTotal
  })
}
