import type { GoalContract, GoalConstraint, GoalPreference } from "../goal/types"
import type { ReviewRequirement } from "./contracts"

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function stripTrailingPunctuation(value: string) {
  return normalizeText(value).replace(/[.:;\s]+$/, "")
}

const GIANT_TASK_PATTERNS = [
  /^task\s*\/\s*goal:/i,
  /^key requirements?:/i,
  /^constraints?:/i,
  /^output format:/i,
  /^required inputs?(?: or ingredients)?:/i,
  /^quality bar/i
]

const META_FILLER_PATTERNS = [
  /\breturn something directly usable as a strong first draft\b/i,
  /\bstrong first draft\b/i,
  /\bkeep the request clear, specific, and easy for the ai assistant to follow\b/i,
  /\bassume a normal home kitchen unless the prompt says otherwise\b/i,
  /\bkeep it practical for real weekday use\b/i
]

const RAW_VALUE_ONLY_PATTERNS = [/^\d+$/, /^(?:yes|no|non|none|n\/a)$/i]

function containsGiantTaskLeak(value: string) {
  return GIANT_TASK_PATTERNS.some((pattern) => pattern.test(value))
}

export function sanitizeUserFacingText(value: string) {
  const cleaned = stripTrailingPunctuation(value)
  if (!cleaned) return ""
  if (containsGiantTaskLeak(cleaned)) return ""
  if (META_FILLER_PATTERNS.some((pattern) => pattern.test(cleaned))) return ""
  return cleaned
}

export function sanitizeConstraintLabel(value: string) {
  const cleaned = sanitizeUserFacingText(value)
  if (!cleaned) return ""
  if (RAW_VALUE_ONLY_PATTERNS.some((pattern) => pattern.test(cleaned))) return ""
  return cleaned
}

export function sanitizeOutputRequirement(value: string) {
  const cleaned = sanitizeUserFacingText(value)
  if (!cleaned) return ""
  if (/^return /i.test(cleaned) && /\bstrong first draft\b/i.test(cleaned)) return ""
  return cleaned
}

export function sanitizeAssumption(value: string) {
  const cleaned = sanitizeUserFacingText(value)
  if (!cleaned) return ""
  return cleaned
}

export function sanitizePreferenceLabel(value: string) {
  return sanitizeUserFacingText(value)
}

export function sanitizeRequirementLabel(value: string) {
  const cleaned = sanitizeUserFacingText(value)
  if (!cleaned) return ""
  if (cleaned.length > 140) return ""
  return cleaned
}

export function sanitizeEvidenceItem(value: string) {
  const cleaned = sanitizeUserFacingText(value)
  if (!cleaned) return ""
  return cleaned
}

export function sanitizeStringList(values: string[]) {
  const seen = new Set<string>()
  const output: string[] = []
  for (const value of values.map(sanitizeUserFacingText).filter(Boolean)) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(value)
  }
  return output
}

export function sanitizeGoalContract(contract: GoalContract): GoalContract {
  return {
    ...contract,
    userGoal: sanitizeUserFacingText(contract.userGoal) || contract.userGoal,
    hardConstraints: contract.hardConstraints
      .map((constraint) => {
        const label = sanitizeConstraintLabel(constraint.label)
        return label ? { ...constraint, label } : null
      })
      .filter(Boolean) as GoalConstraint[],
    softPreferences: contract.softPreferences
      .map((preference) => {
        const label = sanitizePreferenceLabel(preference.label)
        const value = preference.value ? sanitizePreferenceLabel(preference.value) : undefined
        return label ? { ...preference, label, value } : null
      })
      .filter(Boolean) as GoalPreference[],
    outputRequirements: sanitizeStringList(contract.outputRequirements.map(sanitizeOutputRequirement).filter(Boolean)),
    assumptions: sanitizeStringList(contract.assumptions.map(sanitizeAssumption).filter(Boolean)),
    verificationExpectations: sanitizeStringList(contract.verificationExpectations),
    riskFlags: sanitizeStringList(contract.riskFlags)
  }
}

export function sanitizeReviewRequirement(requirement: ReviewRequirement): ReviewRequirement | null {
  const label = sanitizeRequirementLabel(requirement.label)
  if (!label) return null
  return {
    ...requirement,
    label,
    evidence: sanitizeStringList(requirement.evidence.map(sanitizeEvidenceItem).filter(Boolean))
  }
}
