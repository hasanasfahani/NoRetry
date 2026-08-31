import type {
  AssistantCurrentStepClaim,
  AssistantInterpreterConfidence,
  AssistantNextMoveInterpretation,
  AssistantNextMoveType
} from "./assistant-next-move-interpreter-types"

export type AssistantNextStepSignalKind =
  | "approval_to_continue"
  | "start_next_phase"
  | "continue_current_work"
  | "finish_missing_piece"
  | "validate_or_test"
  | "clarify_decision"
  | "offer_optional_enhancement"
  | "task_complete"
  | "unknown"

export type AssistantNextStepSignal = AssistantNextMoveInterpretation & {
  rawPhrase: string
  normalizedPhrase: string
  kind: AssistantNextStepSignalKind
  confidence: number
}

function mapKindToNextMoveType(kind: AssistantNextStepSignalKind): AssistantNextMoveType {
  switch (kind) {
    case "approval_to_continue":
      return "approval_request"
    case "start_next_phase":
    case "continue_current_work":
    case "finish_missing_piece":
      return "continuation_offer"
    case "clarify_decision":
      return "clarification_request"
    case "validate_or_test":
      return "validation_request"
    case "offer_optional_enhancement":
      return "optional_enhancement"
    case "task_complete":
      return "task_complete"
    case "unknown":
    default:
      return "unknown"
  }
}

function confidenceLevelForScore(score: number): AssistantInterpreterConfidence {
  if (score >= 0.8) return "high"
  if (score >= 0.58) return "medium"
  return "low"
}

function confidenceScoreForLevel(level: AssistantInterpreterConfidence) {
  switch (level) {
    case "high":
      return 0.9
    case "medium":
      return 0.7
    case "low":
    default:
      return 0.45
  }
}

function mapNextMoveTypeToKind(input: {
  nextMoveType: AssistantNextMoveType
  targetPhaseNumber: number | null
}): AssistantNextStepSignalKind {
  switch (input.nextMoveType) {
    case "approval_request":
      return "approval_to_continue"
    case "continuation_offer":
      return input.targetPhaseNumber != null ? "start_next_phase" : "continue_current_work"
    case "clarification_request":
      return "clarify_decision"
    case "validation_request":
      return "validate_or_test"
    case "optional_enhancement":
      return "offer_optional_enhancement"
    case "task_complete":
      return "task_complete"
    case "unknown":
    default:
      return "unknown"
  }
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeLower(value: string) {
  return normalize(value).toLowerCase()
}

function stripMarkdownMarkers(value: string) {
  return normalize(value)
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .replace(/^\*(.+)\*$/, "$1")
    .trim()
}

function extractPhaseMetadata(source: string) {
  const matches = Array.from(source.matchAll(/\b(phase\s+(\d+)(?:\s*[—:-]\s*[^.\n]+)?)\b/gi))
  const labelMatch = matches.length ? matches[matches.length - 1] : null
  const nextPhaseLabelMatch = source.match(/\bnext phase\s*[:—-]\s*([^.\n]+)/i)
  return {
    targetLabel: labelMatch?.[1] ? normalize(labelMatch[1]) : nextPhaseLabelMatch?.[1] ? normalize(nextPhaseLabelMatch[1]) : null,
    targetPhaseNumber: labelMatch?.[2] ? Number(labelMatch[2]) : null
  }
}

function buildSignal(input: {
  rawPhrase: string
  kind: AssistantNextStepSignalKind
  currentStepClaim: AssistantCurrentStepClaim
  nextMoveSummary: string
  confidence: number
  requiresApproval?: boolean
  suggestsImplementation?: boolean
  suggestsClarification?: boolean
  suggestsValidation?: boolean
  suggestsCompletion?: boolean
}) {
  const rawPhrase = normalize(input.rawPhrase)
  const normalizedPhrase = normalizeLower(rawPhrase)
  const { targetLabel, targetPhaseNumber } = extractPhaseMetadata(rawPhrase)

  return {
    source: "local_heuristic",
    rawPhrase,
    normalizedPhrase,
    kind: input.kind,
    nextMoveType: mapKindToNextMoveType(input.kind),
    currentStepClaim: input.currentStepClaim,
    nextMoveSummary: normalize(input.nextMoveSummary),
    targetLabel,
    targetPhaseNumber,
    confidence: input.confidence,
    confidenceLevel: confidenceLevelForScore(input.confidence),
    requiresApproval: Boolean(input.requiresApproval),
    suggestsImplementation: Boolean(input.suggestsImplementation),
    suggestsClarification: Boolean(input.suggestsClarification),
    suggestsValidation: Boolean(input.suggestsValidation),
    suggestsCompletion: Boolean(input.suggestsCompletion)
  } satisfies AssistantNextStepSignal
}

function extractActionableLines(responseText: string) {
  return responseText
    .split(/\n+/)
    .map((line) => stripMarkdownMarkers(line))
    .filter(Boolean)
    .slice(-12)
}

function hasCompletionLanguage(text: string) {
  return /\b(done|complete|completed|finished|ready)\b/i.test(text)
}

function hasApprovalLanguage(text: string) {
  return /\b(approval|confirm|confirmation|ready for|move to|continue to|continue with|start phase)\b/i.test(text)
}

function hasOptionalLanguage(text: string) {
  return /\b(if you want|if you'd like|would you like|optional|i can also|i can now|next i can|i can add\b[^.?!]*\bnext|i'm happy to)\b/i.test(text)
}

function hasClarificationLanguage(text: string) {
  return /\b(let me know|tell me|confirm|which\b[^.?!]*\bdo you want|whether\b[^.?!]*\bshould\b|whether you want|when you're ready|need (?:to know|your input|a decision)|choose|pick|before i (?:wire|build|implement|connect))\b/i.test(
    text
  )
}

function hasValidationLanguage(text: string) {
  return /\b(test|validate|verification|verify|check|review|proof)\b/i.test(text)
}

function hasContinuationLanguage(text: string) {
  return /\b(next|continue|move to|move on|implement|build|add|connect|create|should be)\b/i.test(text)
}

function inferCurrentStepClaim(responseText: string, promptText = ""): AssistantCurrentStepClaim {
  const tail = extractActionableLines(responseText).join("\n")
  const combined = normalizeLower(`${promptText}\n${responseText}`)
  const phaseScopedUiOnly =
    /\bphase\s+\d+\b/.test(combined) &&
    /\b(ui only|form ui only|booking form ui only|visual form|no backend|no saving|no payment)\b/.test(combined) &&
    /\b(next phase|phase\s+\d+\s+should be|phase\s+\d+\s*[—:-])\b/.test(combined)

  if (phaseScopedUiOnly && !/\b(still missing|remaining|incomplete|blocked|mostly done|one more pass)\b/i.test(tail)) {
    return "complete"
  }

  if (
    /\b(done|complete|completed|finished|ready for|phase \d+ covered|stop here)\b/i.test(tail) &&
    !/\b(still missing|not done|remaining|incomplete|blocked|still needs?|still need to|mostly done|one more pass)\b/i.test(tail)
  ) {
    return "complete"
  }
  if (/\b(still missing|remaining|partial|incomplete|needs more work|not done yet|todo|still needs?|still need to|mostly done|one more pass)\b/i.test(tail)) {
    return "partial"
  }
  return "unclear"
}

function summarizeNextMove(kind: AssistantNextStepSignalKind, label: string | null) {
  switch (kind) {
    case "approval_to_continue":
      return `Assistant is asking to continue with ${label || "the next approved step"}.`
    case "start_next_phase":
      return `Assistant is suggesting ${label || "the next phase"} as the next step.`
    case "continue_current_work":
      return "Assistant is suggesting more implementation on the current flow."
    case "finish_missing_piece":
      return "Assistant is signaling that the current step still needs more work."
    case "validate_or_test":
      return "Assistant is asking for validation before moving on."
    case "clarify_decision":
      return "Assistant is asking for a decision or confirmation."
    case "offer_optional_enhancement":
      return "Assistant is offering an optional follow-up step."
    case "task_complete":
      return "Assistant is signaling that the current task is complete."
    case "unknown":
    default:
      return "Assistant suggested a next move, but it is still unclear."
  }
}

function actionabilityScore(line: string) {
  let score = 0
  if (hasCompletionLanguage(line)) score += 2
  if (hasApprovalLanguage(line)) score += 3
  if (hasOptionalLanguage(line)) score += 2
  if (hasClarificationLanguage(line)) score += 2
  if (hasValidationLanguage(line)) score += 2
  if (hasContinuationLanguage(line)) score += 2
  if (/\bnext phase\s*[:—-]/i.test(line)) score += 5
  if (/phase\s+\d+/i.test(line)) score += 3
  if (line.length >= 18) score += 1
  return score
}

function classifyLineIntent(input: {
  line: string
  currentStepClaim: AssistantCurrentStepClaim
}) {
  const line = stripMarkdownMarkers(input.line)
  const currentStepClaim = input.currentStepClaim
  const metadata = extractPhaseMetadata(line)
  const optional = hasOptionalLanguage(line)
  const clarify = hasClarificationLanguage(line)
  const validation = hasValidationLanguage(line)
  const completion = hasCompletionLanguage(line)
  const explicitNextPhase = /\bnext phase\s*[:—-]/i.test(line)
  const phaseShouldBeNext = metadata.targetPhaseNumber != null && /\bphase\s+\d+\s+should be\b/i.test(line)
  const continuation = hasContinuationLanguage(line) || phaseShouldBeNext
  const approval =
    /\b(waiting for your approval|need your approval|ready for|ready to move to|move to)\b/i.test(line) ||
    (currentStepClaim === "complete" &&
      !optional &&
      (/\bready\b/i.test(line) || /\bapproval\b/i.test(line)) &&
      continuation &&
      (metadata.targetPhaseNumber != null || /\bnext\b/i.test(line)))

  let kind: AssistantNextStepSignalKind = "unknown"

  if (clarify) {
    kind = "clarify_decision"
  } else if (optional && continuation) {
    kind = "offer_optional_enhancement"
  } else if (explicitNextPhase || phaseShouldBeNext) {
    kind = "start_next_phase"
  } else if (approval) {
    kind = "approval_to_continue"
  } else if (validation) {
    kind = "validate_or_test"
  } else if (currentStepClaim === "complete" && completion && !continuation) {
    kind = "task_complete"
  } else if (currentStepClaim === "partial" && /\b(finish|complete|fix|address|remaining|missing)\b/i.test(line)) {
    kind = "finish_missing_piece"
  } else if (continuation) {
    kind = metadata.targetPhaseNumber != null ? "start_next_phase" : "continue_current_work"
  } else if (completion) {
    kind = "task_complete"
  }

  const confidenceBase =
    kind === "approval_to_continue"
      ? 0.9
      : kind === "clarify_decision"
        ? 0.78
        : kind === "validate_or_test"
          ? 0.76
          : kind === "offer_optional_enhancement"
            ? 0.78
            : kind === "task_complete"
              ? 0.72
              : kind === "continue_current_work" || kind === "start_next_phase"
                ? 0.7
                : kind === "finish_missing_piece"
                  ? 0.68
                  : 0.42

  return {
    kind,
    confidence: confidenceBase,
    requiresApproval: kind === "approval_to_continue" || /\bconfirm\b/i.test(line),
    suggestsImplementation:
      kind === "approval_to_continue" ||
      kind === "start_next_phase" ||
      kind === "continue_current_work" ||
      kind === "finish_missing_piece" ||
      kind === "offer_optional_enhancement",
    suggestsClarification: kind === "clarify_decision",
    suggestsValidation: kind === "validate_or_test",
    suggestsCompletion: kind === "task_complete",
    targetLabel: metadata.targetLabel
  }
}

export function extractAssistantNextStepSignal(
  responseText: string,
  context: { promptText?: string } = {}
): AssistantNextStepSignal | null {
  const lines = extractActionableLines(responseText)
  const currentStepClaim = inferCurrentStepClaim(responseText, context.promptText ?? "")
  const bestLine = [...lines]
    .reverse()
    .map((line) => ({ line, score: actionabilityScore(line) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)[0]

  if (bestLine) {
    const interpreted = classifyLineIntent({
      line: bestLine.line,
      currentStepClaim
    })
    return buildSignal({
      rawPhrase: bestLine.line,
      kind: interpreted.kind,
      currentStepClaim,
      nextMoveSummary: summarizeNextMove(interpreted.kind, interpreted.targetLabel),
      confidence: interpreted.confidence,
      requiresApproval: interpreted.requiresApproval,
      suggestsImplementation: interpreted.suggestsImplementation,
      suggestsClarification: interpreted.suggestsClarification,
      suggestsValidation: interpreted.suggestsValidation,
      suggestsCompletion: interpreted.suggestsCompletion
    })
  }

  const sentenceMatch = responseText.match(
    /\b(?:next step|the next thing to do|after that|from here)\b[^.?!]*[.?!]/i
  )
  const fallback = normalize(sentenceMatch?.[0] || "")
  if (!fallback) return null

  return buildSignal({
    rawPhrase: fallback,
    currentStepClaim,
    nextMoveSummary: summarizeNextMove("unknown", null),
    kind: "unknown",
    confidence: 0.42
  })
}

export function buildAssistantNextStepSignalFromInterpretation(
  interpretation: AssistantNextMoveInterpretation
): AssistantNextStepSignal {
  const rawPhrase = normalize(
    interpretation.targetLabel
      ? `${interpretation.nextMoveSummary} ${interpretation.targetLabel}`
      : interpretation.nextMoveSummary
  )
  const kind = mapNextMoveTypeToKind({
    nextMoveType: interpretation.nextMoveType,
    targetPhaseNumber: interpretation.targetPhaseNumber
  })

  return {
    ...interpretation,
    rawPhrase,
    normalizedPhrase: normalizeLower(rawPhrase),
    kind,
    confidence: confidenceScoreForLevel(interpretation.confidenceLevel)
  }
}
