import type {
  SimplePromptRequirement,
  SimpleRequirementCheck,
  SimpleRequirementConfirmation
} from "./simple-next-prompt-decision"

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeLower(value: string) {
  return normalize(value).toLowerCase()
}

function splitSentences(value: string) {
  return value
    .split(/(?<=[.!?])\s+|\n+/)
    .map(normalize)
    .filter(Boolean)
}

function findEvidence(responseText: string, pattern: RegExp) {
  const sentence = splitSentences(responseText).find((item) => pattern.test(item))
  return sentence ? [sentence] : []
}

function removeFutureNextStepText(responseText: string) {
  return splitSentences(responseText)
    .filter((sentence) => !/\b(?:next phase|next step|next:|from here)\b/i.test(sentence))
    .join(" ")
}

function hasCodeLikeOutput(responseText: string) {
  return /```|<!doctype html>|<html\b|<script\b|<style\b|function\s+\w+\s*\(|const\s+\w+\s*=|let\s+\w+\s*=|class\s+\w+\s*\{/i.test(
    responseText
  )
}

function confirmsPhaseGoal(requirement: SimplePromptRequirement, responseText: string) {
  const requirementText = normalizeLower(requirement.text)
  const response = normalizeLower(responseText)
  const phaseMatch = requirement.text.match(/\bphase\s+(\d+)\b/i)
  const phaseNumber = phaseMatch?.[1] ?? null
  const phaseCompletePattern = phaseNumber
    ? new RegExp(`\\bphase\\s+${phaseNumber}\\s+(?:is\\s+)?(?:complete|completed|done)\\b`, "i")
    : /\b(?:complete|completed|done)\b/i
  const uiGoal = /\b(ui|form|booking form|visual)\b/.test(requirementText)
  const uiEvidencePattern = /\b(created|built|added|implemented|styled)\b[^.?!\n]*(?:form|field|ui|layout|screen)|(?:form|field|ui|layout|screen)[^.?!\n]*\b(created|built|added|implemented|styled)\b/i
  const codeLikeUiEvidence = hasCodeLikeOutput(responseText) && /\b(form|input|select|textarea|button|booking form|ui)\b/i.test(responseText)
  const hasGoalEvidence = uiGoal ? uiEvidencePattern.test(responseText) || codeLikeUiEvidence : /\b(created|built|added|implemented|completed|done)\b/i.test(response)
  const hasPhaseConfirmation = phaseCompletePattern.test(responseText)
  const hasPhaseCodeEvidence = Boolean(
    phaseNumber &&
      codeLikeUiEvidence &&
      new RegExp(`\\bphase\\s+${phaseNumber}\\b`, "i").test(responseText)
  )

  if (hasGoalEvidence && (hasPhaseConfirmation || !phaseNumber || hasPhaseCodeEvidence)) {
    return [
      ...findEvidence(responseText, uiEvidencePattern),
      ...findEvidence(responseText, phaseCompletePattern),
      ...(hasPhaseCodeEvidence ? ["Phase-specific UI code detected in the assistant answer."] : [])
    ].slice(0, 2)
  }

  return []
}

function confirmsScopeBoundary(requirement: SimplePromptRequirement, responseText: string) {
  const requirementText = normalizeLower(requirement.text)
  const response = normalizeLower(responseText)
  const currentWorkText = removeFutureNextStepText(responseText)
  const implementedBackend = /\b(?:created|built|implemented|connect(?:ed)?|wired|added)\b[^.?!\n]*(?:backend|api|database|data storage|server|supabase|firebase)\b/i.test(
    currentWorkText
  )
  const implementedSaving = /\b(?:created|built|implemented|connect(?:ed)?|wired|added|saved|stored)\b[^.?!\n]*(?:saving|storage|local storage|database|data storage|persist(?:ed|ence)?)\b/i.test(
    currentWorkText
  )
  const implementedPayment = /\b(?:created|built|implemented|connected|wired|added)\b[^.?!\n]*(?:payment|checkout|stripe)\b/i.test(
    currentWorkText
  )
  const describesUiWork = /\b(form|field|ui|layout|screen|responsive|styled|design)\b/i.test(responseText)

  if (requirementText.includes("backend") && !implementedBackend) {
    return ["No backend/API implementation claim detected in the assistant answer."]
  }
  if (requirementText.includes("saving") && !implementedSaving) {
    return ["No saving/storage implementation claim detected in the assistant answer."]
  }
  if (requirementText.includes("payment") && !implementedPayment) {
    return ["No payment implementation claim detected in the assistant answer."]
  }
  if (requirementText.includes("ui only") && describesUiWork && !implementedBackend && !implementedSaving && !implementedPayment) {
    return ["Answer describes UI/form work and does not claim backend, storage, or payment implementation."]
  }

  return response ? [] : []
}

function confirmsFormatRequirement(requirement: SimplePromptRequirement, responseText: string) {
  const requirementText = normalizeLower(requirement.text)
  const wordCount = normalize(responseText).split(/\s+/).filter(Boolean).length

  if (requirementText.includes("do not include code")) {
    return hasCodeLikeOutput(responseText) ? [] : ["No code block or code-like snippet detected."]
  }

  if (requirementText.includes("reply briefly")) {
    return wordCount > 0 && wordCount <= 90 ? [`Answer is brief at ${wordCount} words.`] : []
  }

  if (requirementText.includes("coding agent")) {
    const actionEvidence = findEvidence(responseText, /\b(created|built|added|implemented|updated|fixed|styled|complete|done)\b/i)
    if (actionEvidence.length) return actionEvidence
    if (hasCodeLikeOutput(responseText) && /\b(phase|implementation plan|code)\b/i.test(responseText)) {
      return ["Answer includes phased implementation/code output consistent with a coding-agent response."]
    }
  }

  return []
}

function confirmsRequiredOutput(requirement: SimplePromptRequirement, responseText: string) {
  const requirementText = normalizeLower(requirement.text)

  if (requirementText.includes("provide code")) {
    return hasCodeLikeOutput(responseText) ? ["Code block or code-like output detected."] : []
  }

  if (requirementText.includes("say what changed")) {
    return findEvidence(responseText, /\b(created|built|added|implemented|updated|styled|changed)\b/i)
  }

  return []
}

function confirmsCompletion(requirement: SimplePromptRequirement, responseText: string) {
  const phaseMatch = requirement.text.match(/\bphase\s+(\d+)\b/i)
  const phaseNumber = phaseMatch?.[1] ?? null
  const pattern = phaseNumber
    ? new RegExp(`\\bphase\\s+${phaseNumber}\\s+(?:is\\s+)?(?:complete|completed|done)\\b`, "i")
    : /\b(?:complete|completed|done)\b/i

  return findEvidence(responseText, pattern)
}

function confirmsNextStep(responseText: string) {
  return findEvidence(responseText, /\b(?:next phase|next step|next:|next,|from here|i(?:'|’)d recommend|i(?:'|’)d suggest)\b/i)
}

function confirmationEvidence(requirement: SimplePromptRequirement, responseText: string) {
  switch (requirement.category) {
    case "task_goal":
      return confirmsPhaseGoal(requirement, responseText)
    case "scope_boundary":
      return confirmsScopeBoundary(requirement, responseText)
    case "format":
      return confirmsFormatRequirement(requirement, responseText)
    case "required_output":
      return confirmsRequiredOutput(requirement, responseText)
    case "confirmation":
      return confirmsCompletion(requirement, responseText)
    case "next_step_request":
      return confirmsNextStep(responseText)
    default:
      return []
  }
}

function buildConfirmation(
  requirement: SimplePromptRequirement,
  responseText: string
): SimpleRequirementConfirmation {
  const evidence = confirmationEvidence(requirement, responseText)
  return {
    id: requirement.id,
    text: requirement.text,
    category: requirement.category,
    source: requirement.source,
    status: evidence.length ? "confirmed" : "needs_confirmation",
    evidence
  }
}

export function checkSimpleRequirementConfirmations(input: {
  requirements: SimplePromptRequirement[]
  responseText: string
}): SimpleRequirementCheck {
  const confirmations = input.requirements.map((requirement) => buildConfirmation(requirement, input.responseText))
  const confirmed = confirmations.filter((item) => item.status === "confirmed")
  const missingConfirmation = confirmations.filter((item) => item.status === "needs_confirmation")

  return {
    status: missingConfirmation.length ? "needs_confirmation" : "pass",
    confirmed,
    missingConfirmation
  }
}
