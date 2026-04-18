import type { FailureType } from "../review/failure-taxonomy"

export function detectRepeatedFailureTypes(params: {
  recentFailureTypes: FailureType[][]
  currentFailureTypes: FailureType[]
}) {
  const { recentFailureTypes, currentFailureTypes } = params
  const current = new Set(currentFailureTypes)
  return [...current].filter((type) => recentFailureTypes.some((entry) => entry.includes(type)))
}
