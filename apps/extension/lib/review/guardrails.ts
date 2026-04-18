import type { ReviewContract } from "./contracts"
import { sanitizeStringList, sanitizeUserFacingText } from "./sanitizers"

const CREATION_CASE_TASK_FAMILIES = new Set([
  "creation",
  "writing",
  "instructional",
  "explanatory",
  "advice",
  "ideation",
  "prompt"
])

const FORBIDDEN_CREATION_PATTERNS = [
  /^task\s*\/\s*goal:/i,
  /\bartifact proof\b/i,
  /\bstill-unproven part\b/i,
  /\bstrong first draft\b/i,
  /\bconcrete change or fix\b/i,
  /\bvisible proof\b/i,
  /\bfull prompt text\b/i
]

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function looksLikeRepeatedPromptBody(value: string) {
  const normalized = normalizeText(value)
  const lineCount = value.split("\n").filter((line) => line.trim()).length
  return (
    lineCount >= 8 &&
    (/task\s*\/\s*goal:/i.test(normalized) ||
      /key requirements:/i.test(normalized) ||
      /constraints:/i.test(normalized))
  )
}

export function shouldApplyCreationGuardrails(taskFamily: string) {
  return CREATION_CASE_TASK_FAMILIES.has(taskFamily)
}

export function guardrailText(value: string, taskFamily: string) {
  const cleaned = sanitizeUserFacingText(value)
  if (!cleaned) return ""
  if (!shouldApplyCreationGuardrails(taskFamily)) return cleaned
  if (looksLikeRepeatedPromptBody(cleaned)) return ""
  if (FORBIDDEN_CREATION_PATTERNS.some((pattern) => pattern.test(cleaned))) return ""
  return cleaned
}

export function guardrailList(values: string[], taskFamily: string) {
  return sanitizeStringList(values.map((value) => guardrailText(value, taskFamily)).filter(Boolean))
}

export function applyReviewContractGuardrails(contract: ReviewContract): ReviewContract {
  if (!shouldApplyCreationGuardrails(contract.taskFamily)) return contract

  const sanitizationChanges = [...contract.sanitizationChanges]
  const guard = (value: string, fallback = "") => {
    const guarded = guardrailText(value, contract.taskFamily)
    if (!guarded && value.trim()) sanitizationChanges.push(`Guardrail removed user-facing text: ${value.slice(0, 80)}`)
    return guarded || fallback
  }

  const filteredRequirements = contract.requirements.filter((item) => {
    const guarded = guardrailText(item.label, contract.taskFamily)
    if (!guarded && item.label.trim()) {
      sanitizationChanges.push(`Guardrail removed requirement label: ${item.label.slice(0, 80)}`)
    }
    return Boolean(guarded)
  })

  const topFailureIds = new Set(contract.topFailures.map((item) => item.id))
  const topPassIds = new Set(contract.topPasses.map((item) => item.id))

  return {
    ...contract,
    requirements: filteredRequirements,
    topFailures: filteredRequirements.filter((item) => topFailureIds.has(item.id)),
    topPasses: filteredRequirements.filter((item) => topPassIds.has(item.id)),
    overallDecision: guard(contract.overallDecision, contract.overallDecision),
    recommendation: guard(contract.recommendation, contract.recommendation),
    nextMoveShort: guard(contract.nextMoveShort, contract.nextMoveShort),
    missingItems: guardrailList(contract.missingItems, contract.taskFamily),
    whyItems: guardrailList(contract.whyItems, contract.taskFamily),
    checkedItems: guardrailList(contract.checkedItems, contract.taskFamily),
    uncheckedItems: guardrailList(contract.uncheckedItems, contract.taskFamily),
    promptLabel: guard(contract.promptLabel, contract.promptLabel),
    promptText: guard(contract.promptText, contract.nextMoveShort),
    promptNote: guard(contract.promptNote, contract.promptNote),
    copyPromptText: guard(contract.copyPromptText ?? "", contract.nextMoveShort),
    confidenceNote: guard(contract.confidenceNote, contract.confidenceNote),
    confidenceReasons: guardrailList(contract.confidenceReasons, contract.taskFamily),
    proofSummary: guard(contract.proofSummary, contract.proofSummary),
    sanitizationChanges,
    analysisDebug: contract.analysisDebug ?? null
  }
}
