import type { AfterAnalysisResult, SessionSummary } from "@prompt-optimizer/shared/src/schemas"
import { getRecentReviewableAttempts } from "../attempt-session-manager"
import type { FailureType } from "../review/failure-taxonomy"
import { detectRepeatedFailureTypes } from "./failure-patterns"
import { trackProgress, type ProgressState } from "./progress-tracker"

export type AttemptMemory = {
  retryCount: number
  repeatedFailureTypes: FailureType[]
  previousFailureTypes: FailureType[]
  unresolvedIssues: string[]
  progressState: ProgressState
}

function normalizeLabel(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function getAttemptAnalysisResult(attempt: Awaited<ReturnType<typeof getRecentReviewableAttempts>>[number]): AfterAnalysisResult | null {
  const analysisResult = attempt.analysis_result
  if (!analysisResult || typeof analysisResult !== "object") return null
  return analysisResult as AfterAnalysisResult
}

function inferFailureTypesFromAttempt(attempt: Awaited<ReturnType<typeof getRecentReviewableAttempts>>[number]): FailureType[] {
  const analysisResult = getAttemptAnalysisResult(attempt)
  const labels = (analysisResult?.acceptance_checklist ?? [])
    .filter((item) => item.status !== "met")
    .map((item) => normalizeLabel(item.label))

  const failureTypes: FailureType[] = []
  if (labels.some((label) => /serving|time|calorie|method|technology|deliverable|constraint/.test(label))) {
    failureTypes.push("hard_constraint_violation")
  }
  if (labels.some((label) => /output|ingredients|instructions|macro|calorie information/.test(label))) {
    failureTypes.push("missing_required_output")
  }
  if ((analysisResult?.stage_2?.missing_criteria ?? []).some((item) => /proof|runtime|verify|tested/i.test(item))) {
    failureTypes.push("proof_missing")
  }
  if (analysisResult?.status === "WRONG_DIRECTION") {
    failureTypes.push("wrong_direction")
  }
  return [...new Set(failureTypes)]
}

export async function buildAttemptMemory(input: {
  sessionSummary: Partial<SessionSummary> | null | undefined
  currentFailureTypes: FailureType[]
  currentTopFailureLabels: string[]
}) : Promise<AttemptMemory> {
  const retryCount = input.sessionSummary?.retryCount ?? 0
  let recentAttempts: Awaited<ReturnType<typeof getRecentReviewableAttempts>> = []
  try {
    recentAttempts = await getRecentReviewableAttempts(4)
  } catch {
    recentAttempts = []
  }
  const previousAttempts = recentAttempts.slice(0, 3)
  const previousFailureTypes = [...new Set(previousAttempts.flatMap(inferFailureTypesFromAttempt))]
  const repeatedFailureTypes = detectRepeatedFailureTypes({
    recentFailureTypes: previousAttempts.map(inferFailureTypesFromAttempt),
    currentFailureTypes: input.currentFailureTypes
  })
  const unresolvedIssues = input.currentTopFailureLabels.filter((label) => {
    const normalized = normalizeLabel(label)
    return previousAttempts.some((attempt) => {
      const analysisResult = getAttemptAnalysisResult(attempt)
      return (analysisResult?.stage_2?.missing_criteria ?? []).some((item) => normalizeLabel(item) === normalized)
    })
  })

  return {
    retryCount,
    repeatedFailureTypes,
    previousFailureTypes,
    unresolvedIssues,
    progressState: trackProgress({
      retryCount,
      previousFailureTypes,
      currentFailureTypes: input.currentFailureTypes
    })
  }
}
