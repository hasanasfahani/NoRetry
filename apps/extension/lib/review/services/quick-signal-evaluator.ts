import type { AfterAnalysisResult, ResponsePreprocessorOutput } from "@prompt-optimizer/shared/src/schemas"
import type { ReviewSignalState, ReviewSignalVisualState, ReviewTarget } from "../types"
import { isNoRetryAnalysisResult } from "../no-retry"

export type QuickSignalRequestKind =
  | "handoff_document"
  | "code_change"
  | "debug_fix"
  | "planning"
  | "answer_only"
  | "unknown"

type QuickSignalVisualState = Extract<
  ReviewSignalVisualState,
  "typing" | "green" | "red" | "yellow_warning" | "yellow_search" | "yellow_puzzle"
>

export type QuickSignalEvaluation = {
  state: QuickSignalVisualState
  tooltip: string
  ariaLabel: string
  reason: string
  requestKind: QuickSignalRequestKind
  confidence: "low" | "medium" | "high"
}

const HANDOFF_PROMPT_TERMS = [
  "markdown",
  ".md",
  "md file",
  "project context",
  "context file",
  "requirements file",
  "requirements document",
  "handoff",
  "project brief",
  "request brief",
  "current state",
  "architecture summary",
  "product requirements",
  "prd"
]

const PLANNING_PROMPT_TERMS = [
  "plan",
  "requirements",
  "roadmap",
  "spec",
  "strategy",
  "checklist",
  "proposal",
  "user flow",
  "acceptance criteria"
]

const DEBUG_PROMPT_TERMS = ["bug", "error", "fix", "debug", "broken", "crash", "failing", "issue"]
const CODE_PROMPT_TERMS = ["build", "implement", "add", "update", "refactor", "code", "component", "api", "database", "schema"]
const ANSWER_ONLY_PROMPT_TERMS = ["explain", "what is", "how can", "recommend", "compare", "summarize", "analyze"]

const HANDOFF_SECTION_PATTERNS = [
  /\bproject\s+(?:overview|context|summary)\b/i,
  /\bcurrent\s+(?:state|status|implementation)\b/i,
  /\brequirements?\b/i,
  /\bacceptance\s+criteria\b/i,
  /\bconstraints?\b/i,
  /\barchitecture\b/i,
  /\bfiles?\b|\bfolder\b|\bstructure\b/i,
  /\bnext\s+steps?\b/i,
  /\bblockers?\b|\brisks?\b/i,
  /\bassumptions?\b/i
]

const REFUSAL_OR_FAILURE_PATTERNS = [
  /\bi\s+(?:can'?t|cannot|am unable to)\b/i,
  /\bfailed\b/i,
  /\berror\b/i,
  /\bnot\s+possible\b/i,
  /\bi\s+don'?t\s+have\b/i,
  /\bno\s+access\b/i
]

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

function includesAny(haystack: string, terms: string[]) {
  return terms.some((term) => haystack.includes(term))
}

function getPromptText(target: ReviewTarget) {
  return [
    target.attempt.optimized_prompt,
    target.attempt.raw_prompt,
    target.attempt.intent?.goal,
    ...(target.attempt.intent?.constraints ?? []),
    ...(target.attempt.intent?.acceptance_criteria ?? [])
  ]
    .filter(Boolean)
    .join("\n")
}

function hasMarkdownShape(responseText: string) {
  const trimmed = responseText.trim()
  if (!trimmed) return false

  const headingCount = (trimmed.match(/^#{1,4}\s+\S/gm) ?? []).length
  const bulletCount = (trimmed.match(/^\s*(?:[-*]|\d+\.)\s+\S/gm) ?? []).length
  const tableDividerCount = (trimmed.match(/^\s*\|?\s*:?-{3,}:?\s*\|/gm) ?? []).length
  const fencedBlockCount = (trimmed.match(/```/g) ?? []).length

  return headingCount >= 1 || bulletCount >= 3 || tableDividerCount >= 1 || fencedBlockCount >= 2
}

function countHandoffSections(responseText: string) {
  return HANDOFF_SECTION_PATTERNS.reduce((count, pattern) => count + (pattern.test(responseText) ? 1 : 0), 0)
}

function hasRefusalOrFailure(responseText: string, result: AfterAnalysisResult) {
  if (result.status === "FAILED") return true
  return REFUSAL_OR_FAILURE_PATTERNS.some((pattern) => pattern.test(responseText))
}

function hasWrongDirection(result: AfterAnalysisResult) {
  return result.status === "WRONG_DIRECTION" || result.stage_2.problem_fit === "wrong_direction"
}

function unresolvedChecklistCount(result: AfterAnalysisResult) {
  return result.acceptance_checklist.filter((item) => item.status !== "met").length
}

function hasHighImpactGap(result: AfterAnalysisResult) {
  if (result.status === "FAILED") return true
  if (result.stage_2.constraint_risks.length > 0) return true
  return result.acceptance_checklist.some((item) => item.status === "missed")
}

function hasValidationSignals(responseSummary: ResponsePreprocessorOutput) {
  return responseSummary.validation_signals.length > 0 || responseSummary.success_signals.length > 0
}

function hasChangeSignals(responseSummary: ResponsePreprocessorOutput) {
  return responseSummary.has_code_blocks || responseSummary.change_claims.length > 0 || responseSummary.mentioned_files.length > 0
}

function hasDocumentArtifactSignal(input: {
  target: ReviewTarget
  responseSummary: ResponsePreprocessorOutput
}) {
  const { target, responseSummary } = input
  const responseText = target.responseText
  const mentionedDocumentFile = responseSummary.mentioned_files.some((file) =>
    /\.(?:md|markdown|txt|doc|docx)$/i.test(file) || /\b(?:handoff|requirements?|context|brief|overview|architecture)\b/i.test(file)
  )
  const visibleOutputFile =
    /\boutput file\b/i.test(responseText) ||
    /\bopen\b/i.test(responseText) ||
    /\btext\b/i.test(responseText) ||
    /\bfile\b/i.test(responseText)
  const deliveryClaim =
    responseSummary.change_claims.length > 0 ||
    /\b(?:updated?|created?|wrote|generated|added)\b/i.test(responseText)

  return mentionedDocumentFile && (visibleOutputFile || deliveryClaim)
}

function classifyQuickSignalRequest(input: {
  target: ReviewTarget
  responseSummary: ResponsePreprocessorOutput
}): QuickSignalRequestKind {
  const { target, responseSummary } = input
  const prompt = normalizeText(getPromptText(target))
  const response = target.responseText

  if (includesAny(prompt, HANDOFF_PROMPT_TERMS)) return "handoff_document"
  if (target.taskType === "debug" || includesAny(prompt, DEBUG_PROMPT_TERMS)) return "debug_fix"
  if (includesAny(prompt, PLANNING_PROMPT_TERMS)) return "planning"
  if (includesAny(prompt, CODE_PROMPT_TERMS) || hasChangeSignals(responseSummary)) return "code_change"
  if (includesAny(prompt, ANSWER_ONLY_PROMPT_TERMS)) return "answer_only"
  if (hasMarkdownShape(response)) return "planning"
  return "unknown"
}

function buildEvaluation(input: {
  state: QuickSignalVisualState
  tooltip: string
  reason: string
  requestKind: QuickSignalRequestKind
  confidence: "low" | "medium" | "high"
}): QuickSignalEvaluation {
  return {
    ...input,
    ariaLabel: `Review signal: ${input.tooltip}`
  }
}

function evaluateHandoffDocument(input: {
  result: AfterAnalysisResult
  responseSummary: ResponsePreprocessorOutput
  target: ReviewTarget
  requestKind: QuickSignalRequestKind
}): QuickSignalEvaluation {
  const { result, responseSummary, target, requestKind } = input
  const sectionCount = countHandoffSections(target.responseText)
  const markdownShape = hasMarkdownShape(target.responseText)
  const longEnough = target.responseText.trim().length >= 120
  const documentArtifactDelivered = hasDocumentArtifactSignal({ target, responseSummary })

  if (hasRefusalOrFailure(target.responseText, result) || hasWrongDirection(result)) {
    return buildEvaluation({
      state: "red",
      tooltip: "Wrong direction — do not trust",
      reason: "The answer appears to fail or refuse the requested document.",
      requestKind,
      confidence: "high"
    })
  }

  if (documentArtifactDelivered) {
    return buildEvaluation({
      state: "green",
      tooltip: "Requested document delivered",
      reason: "The response exposes a document artifact that matches the requested handoff/context output.",
      requestKind,
      confidence: "high"
    })
  }

  if (markdownShape && longEnough && sectionCount >= 2) {
    return buildEvaluation({
      state: "green",
      tooltip: "Requested document delivered",
      reason: "The response is structured like the requested markdown/context document.",
      requestKind,
      confidence: "high"
    })
  }

  if (markdownShape && sectionCount >= 1) {
    return buildEvaluation({
      state: "yellow_puzzle",
      tooltip: "Document is partial",
      reason: "The document shape is present, but important sections may be thin.",
      requestKind,
      confidence: "medium"
    })
  }

  return buildEvaluation({
    state: "yellow_warning",
    tooltip: "Requested format not proven",
    reason: "The response does not clearly look like the requested markdown/context file.",
    requestKind,
    confidence: "medium"
  })
}

function evaluateDebugFix(input: {
  result: AfterAnalysisResult
  responseSummary: ResponsePreprocessorOutput
  target: ReviewTarget
  requestKind: QuickSignalRequestKind
}): QuickSignalEvaluation {
  const { result, responseSummary, target, requestKind } = input

  if (hasWrongDirection(result) || hasRefusalOrFailure(target.responseText, result)) {
    return buildEvaluation({
      state: "red",
      tooltip: "Likely wrong — do not trust",
      reason: "The fix appears failed or misaligned with the bug.",
      requestKind,
      confidence: "high"
    })
  }

  if ((result.status === "SUCCESS" || result.status === "LIKELY_SUCCESS") && hasValidationSignals(responseSummary)) {
    return buildEvaluation({
      state: "green",
      tooltip: "Fix looks validated",
      reason: "The answer claims a fix and includes validation or success evidence.",
      requestKind,
      confidence: "medium"
    })
  }

  if (hasChangeSignals(responseSummary)) {
    return buildEvaluation({
      state: "yellow_search",
      tooltip: "Looks fixed, but test it",
      reason: "A plausible fix is present, but validation is not strong enough yet.",
      requestKind,
      confidence: "medium"
    })
  }

  return buildEvaluation({
    state: "yellow_warning",
    tooltip: "Fix not proven",
    reason: "The answer does not show enough implementation or validation evidence.",
    requestKind,
    confidence: "medium"
  })
}

function evaluateCodeChange(input: {
  result: AfterAnalysisResult
  responseSummary: ResponsePreprocessorOutput
  target: ReviewTarget
  requestKind: QuickSignalRequestKind
}): QuickSignalEvaluation {
  const { result, responseSummary, target, requestKind } = input

  if (hasWrongDirection(result) || hasRefusalOrFailure(target.responseText, result)) {
    return buildEvaluation({
      state: "red",
      tooltip: "Likely wrong — do not trust",
      reason: "The answer appears failed or not aligned with the requested change.",
      requestKind,
      confidence: "high"
    })
  }

  if (
    (result.status === "SUCCESS" || result.status === "LIKELY_SUCCESS") &&
    hasChangeSignals(responseSummary) &&
    hasValidationSignals(responseSummary) &&
    !hasHighImpactGap(result)
  ) {
    return buildEvaluation({
      state: "green",
      tooltip: "Change looks complete",
      reason: "The answer includes change evidence and validation signals.",
      requestKind,
      confidence: "medium"
    })
  }

  if (hasChangeSignals(responseSummary) && !hasHighImpactGap(result)) {
    return buildEvaluation({
      state: "yellow_search",
      tooltip: "Looks changed, verify it",
      reason: "The answer includes implementation evidence, but validation is incomplete.",
      requestKind,
      confidence: "medium"
    })
  }

  if (hasHighImpactGap(result) || result.confidence === "low") {
    return buildEvaluation({
      state: "yellow_warning",
      tooltip: "High risk — key parts not proven",
      reason: "The answer may miss constraints, tests, or required implementation details.",
      requestKind,
      confidence: "medium"
    })
  }

  return buildEvaluation({
    state: "yellow_puzzle",
    tooltip: "Convincing, but unproven",
    reason: "The answer may be useful, but proof is not strong enough for a green signal.",
    requestKind,
    confidence: "low"
  })
}

function evaluatePlanningOrAnswer(input: {
  result: AfterAnalysisResult
  target: ReviewTarget
  requestKind: QuickSignalRequestKind
}): QuickSignalEvaluation {
  const { result, target, requestKind } = input
  const structured = hasMarkdownShape(target.responseText)
  const unresolvedCount = unresolvedChecklistCount(result)

  if (hasWrongDirection(result) || hasRefusalOrFailure(target.responseText, result)) {
    return buildEvaluation({
      state: "red",
      tooltip: "Likely wrong — do not trust",
      reason: "The answer appears failed or aimed at the wrong request.",
      requestKind,
      confidence: "high"
    })
  }

  if (
    (result.status === "SUCCESS" || result.status === "LIKELY_SUCCESS") &&
    result.stage_2.problem_fit === "correct" &&
    unresolvedCount <= 1 &&
    (structured || target.responseText.trim().length >= 180)
  ) {
    return buildEvaluation({
      state: "green",
      tooltip: "Looks complete",
      reason: "The answer matches the request and is complete enough for a quick pass.",
      requestKind,
      confidence: "medium"
    })
  }

  if (hasHighImpactGap(result) || result.confidence === "low") {
    return buildEvaluation({
      state: "yellow_warning",
      tooltip: "High risk — key parts not proven",
      reason: "The answer may miss important requested details.",
      requestKind,
      confidence: "medium"
    })
  }

  return buildEvaluation({
    state: "yellow_puzzle",
    tooltip: "Useful, but check details",
    reason: "The answer is plausible, but quick review cannot fully prove completeness.",
    requestKind,
    confidence: "low"
  })
}

export function evaluateQuickSignal(input: {
  result: AfterAnalysisResult
  target: ReviewTarget
}): QuickSignalEvaluation {
  const { result, target } = input
  const responseSummary = result.response_summary
  const requestKind = classifyQuickSignalRequest({ target, responseSummary })
  const responseText = target.responseText.trim()
  const normalizedPrompt = normalizeText(getPromptText(target))
  const completionClaim =
    /\b(?:completed?|done|implemented|built|created|finished|ready)\b/i.test(responseText) ||
    result.status === "SUCCESS" ||
    result.status === "LIKELY_SUCCESS"
  const refusalOrFailure = hasRefusalOrFailure(responseText, result) || hasWrongDirection(result)
  const asksInsteadOfCompletes =
    /\b(?:can you|could you|please provide|send me|i need|which stack|which provider|clarify)\b/i.test(responseText) &&
    /\b(?:build|implement|create|add|fix|phase)\b/i.test(normalizedPrompt)
  const possiblePrematureNextStep =
    /\bnext\s+(?:phase|step)\b/i.test(responseText) &&
    /\b(?:backend|database|storage|payment|deploy|auth|api)\b/i.test(responseText)

  if (!responseText) {
    return buildEvaluation({
      state: "typing",
      tooltip: "Still answering",
      reason: "The assistant answer is not ready to review yet.",
      requestKind,
      confidence: "low"
    })
  }

  if (refusalOrFailure || asksInsteadOfCompletes || possiblePrematureNextStep) {
    return buildEvaluation({
      state: "yellow_warning",
      tooltip: "Needs review",
      reason: "Quick Check found an obvious risk, refusal, question, or possibly premature next step.",
      requestKind,
      confidence: "low"
    })
  }

  if (completionClaim || isNoRetryAnalysisResult(result) || hasChangeSignals(responseSummary)) {
    return buildEvaluation({
      state: "green",
      tooltip: "Looks likely good",
      reason: "Quick Check found a visible completion or change claim. Deep Analysis is needed for the real decision.",
      requestKind,
      confidence: "low"
    })
  }

  return buildEvaluation({
    state: "yellow_warning",
    tooltip: "Needs review",
    reason: "Quick Check did not find enough obvious surface evidence to trust the answer yet.",
    requestKind,
    confidence: "low"
  })
}

export function mapQuickEvaluationToReviewSignal(input: {
  evaluation: QuickSignalEvaluation
  targetKey: string
}): ReviewSignalState {
  const { evaluation, targetKey } = input

  return {
    state: evaluation.state,
    tooltip: evaluation.tooltip,
    ariaLabel: evaluation.ariaLabel,
    targetKey,
    reason: evaluation.reason,
    requestKind: evaluation.requestKind,
    confidence: evaluation.confidence
  }
}
