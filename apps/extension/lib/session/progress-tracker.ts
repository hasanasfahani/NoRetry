import type { FailureType } from "../review/failure-taxonomy"

export type ProgressState = "improving" | "stalled" | "regressing" | "first_attempt"

export function trackProgress(params: {
  retryCount: number
  previousFailureTypes: FailureType[]
  currentFailureTypes: FailureType[]
}) {
  const { retryCount, previousFailureTypes, currentFailureTypes } = params
  if (retryCount === 0) return "first_attempt" as const
  if (!previousFailureTypes.length) return "stalled" as const

  const previous = new Set(previousFailureTypes)
  const current = new Set(currentFailureTypes)
  const overlap = [...current].filter((item) => previous.has(item)).length

  if (overlap === 0) return "improving" as const
  if (current.size > previous.size) return "regressing" as const
  return "stalled" as const
}
