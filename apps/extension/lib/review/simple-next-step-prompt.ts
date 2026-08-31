import type {
  SimpleAssistantSuggestedNextMove,
  SimpleRequirementCheck
} from "./simple-next-prompt-decision"

export const SIMPLE_NEXT_STEP_COMPLETION_CTA =
  "After you finish, confirm which requirements were completed and suggest the next step."

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function stripTrailingPunctuation(value: string) {
  return normalize(value).replace(/[.。]+$/, "")
}

function sentenceCase(value: string) {
  const cleaned = stripTrailingPunctuation(value)
  if (!cleaned) return ""
  return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`
}

function splitRecommendationCandidates(responseText: string) {
  const lines = responseText
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((line) => normalize(line.replace(/^\s*[-*•]\s*/, "")))
    .filter(Boolean)
  const candidates: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const recommendation = extractRecommendationClause(line)
    if (!recommendation) {
      continue
    }

    const headingOnly = /^#{0,6}\s*(?:next phase|next step)\s*:?\s*$/i.test(recommendation)
    candidates.push(headingOnly && lines[index + 1] ? `${recommendation} ${lines[index + 1]}` : recommendation)
  }

  return candidates
}

function cleanRecommendationText(value: string) {
  return stripTrailingPunctuation(
    value
      .replace(/^(?:➡️\s*)?/u, "")
      .replace(/^#{1,6}\s*/i, "")
      .replace(/^next\s+(?:phase|step)\s*[:—-]\s*/i, "")
      .replace(/^.*?\bnext\s+(?:phase|step)\s*[:—-]\s*/i, "")
      .replace(/^from here\s*[:—-]\s*/i, "")
      .replace(/^the next\s+(?:phase|step)\s+(?:is|should be)\s*/i, "")
      .replace(/^i(?:'|’)d\s+(?:recommend|suggest)\s*/i, "")
  )
}

function isNextRecommendation(value: string) {
  return /\b(?:next phase|next step|next:|from here|i(?:'|’)d recommend|i(?:'|’)d suggest)\b/i.test(value)
}

function extractRecommendationClause(value: string) {
  const cleaned = normalize(value)
  const match = cleaned.match(
    /(?:➡️\s*)?(?:#{1,6}\s*)?(?:\bnext\s+(?:phase|step)\b\s*[:—-]?|\bnext\s*[:—-]|\bfrom here\b\s*[:—-]?|\bi(?:'|’)d\s+(?:recommend|suggest)\b)/i
  )
  if (!match || match.index == null) return null

  return cleaned.slice(match.index).trim()
}

function confidenceForRecommendation(rawText: string, normalizedText: string): "high" | "medium" | "low" {
  if (!normalizedText) return "low"
  if (/^next\s+(?:phase|step)\s*[:—-]/i.test(rawText)) return "high"
  if (/\bnext\s+(?:phase|step)\b/i.test(rawText)) return "medium"
  return "low"
}

export function extractSimpleAssistantSuggestedNextMove(responseText: string): SimpleAssistantSuggestedNextMove | null {
  const candidates = splitRecommendationCandidates(responseText).filter(isNextRecommendation)
  const rawText = candidates.at(-1) ?? ""
  const normalizedText = cleanRecommendationText(rawText)

  if (!rawText || !normalizedText) {
    return null
  }

  return {
    rawText,
    normalizedText,
    confidence: confidenceForRecommendation(rawText, normalizedText)
  }
}

function isBookingPhaseOneUiFlow(promptText: string, responseText: string) {
  const combined = `${promptText}\n${responseText}`.toLowerCase()
  return (
    /\bbooking app\b/.test(combined) &&
    /\bphase\s+1\b/.test(combined) &&
    /\b(?:ui only|form ui only|booking form ui only|booking form ui|form ui)\b/.test(combined)
  )
}

function shouldUseBookingValidationBeforeBackend(input: {
  promptText: string
  responseText: string
  suggestedNextMove: SimpleAssistantSuggestedNextMove | null
}) {
  if (!isBookingPhaseOneUiFlow(input.promptText, input.responseText)) {
    return false
  }

  const suggestion = input.suggestedNextMove?.normalizedText.toLowerCase() ?? ""
  return (
    !suggestion ||
    /\b(?:backend|api|database|data storage|store bookings?|save bookings?|submission logic|validation|confirmation|form state)\b/.test(
      suggestion
    )
  )
}

function buildBookingValidationPrompt() {
  return [
    "Please implement the best next step now:",
    "- Add required field validation",
    "- Show clear error messages",
    "- Prevent empty submission",
    "- Show a booking confirmation summary",
    "",
    "Do not connect a backend yet.",
    "",
    SIMPLE_NEXT_STEP_COMPLETION_CTA
  ].join("\n")
}

function buildGenericNextStepPrompt(suggestedNextMove: SimpleAssistantSuggestedNextMove | null) {
  const action = suggestedNextMove?.normalizedText
    ? sentenceCase(suggestedNextMove.normalizedText)
    : "Continue with the best next step"

  return [
    "Please implement the best next step now:",
    `- ${action}`,
    "",
    SIMPLE_NEXT_STEP_COMPLETION_CTA
  ].join("\n")
}

export function buildSimpleNextStepPrompt(input: {
  requirementCheck: SimpleRequirementCheck
  promptText: string
  responseText: string
  suggestedNextMove?: SimpleAssistantSuggestedNextMove | null
}) {
  if (input.requirementCheck.status !== "pass") {
    return null
  }

  const suggestedNextMove = input.suggestedNextMove ?? extractSimpleAssistantSuggestedNextMove(input.responseText)

  if (
    shouldUseBookingValidationBeforeBackend({
      promptText: input.promptText,
      responseText: input.responseText,
      suggestedNextMove
    })
  ) {
    return buildBookingValidationPrompt()
  }

  return buildGenericNextStepPrompt(suggestedNextMove)
}
