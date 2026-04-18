import type { GoalContract } from "../goal/types"

export type PreflightSignalSeverity = "info" | "warning" | "critical"

export type PreflightSignalType =
  | "ambiguity_risk"
  | "missing_success_criteria"
  | "missing_proof_requirement"
  | "scope_too_broad"
  | "likely_wrong_file_targeting"
  | "conflicting_instructions"

export type PreflightSignal = {
  id: string
  type: PreflightSignalType
  severity: PreflightSignalSeverity
  label: string
  detail: string
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function createSignal(type: PreflightSignalType, severity: PreflightSignalSeverity, label: string, detail: string): PreflightSignal {
  return {
    id: `${type}:${normalizeText(label).replace(/[^a-z0-9]+/g, "-")}`,
    type,
    severity,
    label,
    detail
  }
}

function hasExplicitSuccessCriteria(goalContract: GoalContract, promptText: string) {
  const normalizedPrompt = normalizeText(promptText)
  return (
    goalContract.outputRequirements.length > 0 ||
    goalContract.verificationExpectations.length > 0 ||
    goalContract.hardConstraints.some((constraint) =>
      ["output", "technology", "method", "time", "count", "servings", "calories", "protein"].includes(constraint.type)
    ) ||
    /\b(success|done|verify|validated?|proof|test|assert|should include|must include|return only)\b/.test(normalizedPrompt)
  )
}

function hasProofRequirement(goalContract: GoalContract, promptText: string) {
  const normalizedPrompt = normalizeText(promptText)
  return (
    goalContract.verificationExpectations.length > 0 ||
    /\bprove|proof|verify|validated?|show evidence|test|runtime|working\b/.test(normalizedPrompt)
  )
}

function hasBroadScope(promptText: string, goalContract: GoalContract) {
  const normalizedPrompt = normalizeText(promptText)
  const requirementCount =
    goalContract.hardConstraints.length + goalContract.outputRequirements.length + goalContract.softPreferences.length
  return (
    requirementCount >= 8 ||
    normalizedPrompt.length > 320 ||
    /\band\b.*\band\b.*\band\b/.test(normalizedPrompt) ||
    /\b(build|create|generate|implement|fix|rewrite)\b.*\b(and|plus)\b/i.test(promptText)
  )
}

function hasLikelyWrongFileTargeting(promptText: string, goalContract: GoalContract) {
  const normalizedPrompt = normalizeText(promptText)
  const mentionsCodeTarget = /\bfile|component|module|function|class|route|endpoint|tsx?|jsx?|py|html|css\b/.test(normalizedPrompt)
  const vagueAction = /\bfix this|update it|change it|make it work|handle this\b/.test(normalizedPrompt)
  const technicalGoal = goalContract.taskFamily === "creation" || /\breact|next\.?js|typescript|html|css|python|api\b/.test(normalizedPrompt)
  return technicalGoal && vagueAction && !mentionsCodeTarget
}

function hasConflictingInstructions(promptText: string, goalContract: GoalContract) {
  const normalizedPrompt = normalizeText(promptText)
  const hasMicrowave = /\bmicrowave\b/.test(normalizedPrompt)
  const hasOven = /\boven\b/.test(normalizedPrompt)
  const hasConcise = /\bconcise|brief|short\b/.test(normalizedPrompt)
  const hasDetailed = /\bdetailed|thorough|comprehensive\b/.test(normalizedPrompt)
  const duplicateConflicts = goalContract.hardConstraints.some((constraint, _, all) => {
    if (constraint.type !== "method") return false
    return all.some((other) => other.id !== constraint.id && other.type === "method" && normalizeText(other.label) !== normalizeText(constraint.label))
  })
  return duplicateConflicts || (hasMicrowave && hasOven) || (hasConcise && hasDetailed)
}

function hasAmbiguityRisk(promptText: string, goalContract: GoalContract) {
  const normalizedPrompt = normalizeText(promptText)
  const hardSignalCount = goalContract.hardConstraints.length + goalContract.outputRequirements.length
  return (
    /\bthis\b|\bit\b|\bsomething\b|\bstuff\b/.test(normalizedPrompt) &&
    hardSignalCount < 2
  ) || (
    goalContract.userGoal.length < 24 && hardSignalCount < 2
  )
}

export function buildPreflightSignals(input: { goalContract: GoalContract; promptText: string }) {
  const { goalContract, promptText } = input
  const signals: PreflightSignal[] = []

  if (hasAmbiguityRisk(promptText, goalContract)) {
    signals.push(
      createSignal(
        "ambiguity_risk",
        "warning",
        "This prompt is still ambiguous.",
        "The goal is short or uses vague references without enough concrete requirements."
      )
    )
  }

  if (!hasExplicitSuccessCriteria(goalContract, promptText)) {
    signals.push(
      createSignal(
        "missing_success_criteria",
        "critical",
        "This prompt lacks a success condition.",
        "Add the exact output or acceptance criteria you want the assistant to satisfy."
      )
    )
  }

  if ((goalContract.taskFamily === "debug" || /\bfix|debug|validate|verify|test\b/i.test(promptText)) && !hasProofRequirement(goalContract, promptText)) {
    signals.push(
      createSignal(
        "missing_proof_requirement",
        "warning",
        "You asked for validation but not for proof.",
        "Ask for a visible proof step such as a test, runtime check, or exact verification point."
      )
    )
  }

  if (hasBroadScope(promptText, goalContract)) {
    signals.push(
      createSignal(
        "scope_too_broad",
        "critical",
        "This is too broad for one AI attempt.",
        "Narrow the task to the first concrete deliverable or the highest-risk requirement."
      )
    )
  }

  if (hasLikelyWrongFileTargeting(promptText, goalContract)) {
    signals.push(
      createSignal(
        "likely_wrong_file_targeting",
        "warning",
        "This may target the wrong file or code area.",
        "Name the file, component, route, or function you want changed."
      )
    )
  }

  if (hasConflictingInstructions(promptText, goalContract)) {
    signals.push(
      createSignal(
        "conflicting_instructions",
        "critical",
        "This prompt contains conflicting instructions.",
        "Resolve method, scope, or style conflicts before sending."
      )
    )
  }

  return signals
}
