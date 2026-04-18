import type { GoalConstraint, GoalContract, GoalPreference } from "./types"

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function dedupeStrings(values: string[]) {
  const seen = new Set<string>()
  const output: string[] = []
  for (const value of values.map(normalizeText).filter(Boolean)) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(value)
  }
  return output
}

function dedupeConstraints(values: GoalConstraint[]) {
  const seen = new Set<string>()
  const output: GoalConstraint[] = []
  for (const value of values) {
    const label = normalizeText(value.label)
    if (!label) continue
    const key = `${value.type}:${label.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    output.push({
      ...value,
      label
    })
  }
  return output
}

function dedupePreferences(values: GoalPreference[]) {
  const seen = new Set<string>()
  const output: GoalPreference[] = []
  for (const value of values) {
    const label = normalizeText(value.label)
    if (!label) continue
    const key = `${label.toLowerCase()}:${normalizeText(value.value ?? "").toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    output.push({
      ...value,
      label,
      value: normalizeText(value.value ?? "") || undefined
    })
  }
  return output
}

export function createGoalContract(input: Partial<GoalContract> & Pick<GoalContract, "taskFamily" | "userGoal">): GoalContract {
  return {
    taskFamily: normalizeText(input.taskFamily) || "other",
    userGoal: normalizeText(input.userGoal),
    deliverableType: normalizeText(input.deliverableType ?? "") || undefined,
    hardConstraints: dedupeConstraints(input.hardConstraints ?? []),
    softPreferences: dedupePreferences(input.softPreferences ?? []),
    outputRequirements: dedupeStrings(input.outputRequirements ?? []),
    verificationExpectations: dedupeStrings(input.verificationExpectations ?? []),
    assumptions: dedupeStrings(input.assumptions ?? []),
    riskFlags: dedupeStrings(input.riskFlags ?? [])
  }
}

export function hasMeaningfulGoalContract(contract: GoalContract) {
  return Boolean(
    contract.userGoal ||
      contract.deliverableType ||
      contract.hardConstraints.length ||
      contract.softPreferences.length ||
      contract.outputRequirements.length
  )
}
