import type { AfterAnalysisResult } from "@prompt-optimizer/shared/src/schemas"
import type { ReviewSignalState } from "../types"
import type { ReviewTaskType } from "../services/review-task-type"

function isGoalMisaligned(result: AfterAnalysisResult) {
  return result.status === "WRONG_DIRECTION" || result.stage_2.problem_fit === "wrong_direction"
}

function hasHighImpactGap(result: AfterAnalysisResult) {
  if (result.status === "FAILED") return true
  if (result.stage_2.constraint_risks.length > 0) return true
  return result.acceptance_checklist.some((item) => item.status === "missed")
}

export function createIdleReviewSignal(): ReviewSignalState {
  return {
    state: "idle",
    tooltip: "Open deep review",
    ariaLabel: "Open deep review",
    targetKey: null
  }
}

export function createLoadingReviewSignal(targetKey: string | null): ReviewSignalState {
  return {
    state: "loading",
    tooltip: "Checking the latest answer",
    ariaLabel: "Checking the latest answer",
    targetKey
  }
}

export function createTypingReviewSignal(promptKey: string | null): ReviewSignalState {
  return {
    state: "typing",
    tooltip: "Shape this prompt before sending",
    ariaLabel: "Review signal: Shape this prompt before sending",
    targetKey: promptKey
  }
}

export function mapReviewResultToSignal(input: {
  result: AfterAnalysisResult
  taskType: ReviewTaskType
  targetKey: string
}): ReviewSignalState {
  const { result, taskType, targetKey } = input
  const unresolvedCount = result.acceptance_checklist.filter((item) => item.status !== "met").length
  const highImpactGap = hasHighImpactGap(result)

  if (isGoalMisaligned(result) || result.status === "FAILED") {
    return {
      state: "red",
      tooltip: "Likely wrong — don’t trust",
      ariaLabel: "Review signal: Likely wrong — don’t trust",
      targetKey
    }
  }

  if (
    (result.status === "SUCCESS" || result.status === "LIKELY_SUCCESS") &&
    unresolvedCount === 0 &&
    result.stage_2.problem_fit === "correct"
  ) {
    return {
      state: "green",
      tooltip: "Safe to trust",
      ariaLabel: "Review signal: Safe to trust",
      targetKey
    }
  }

  if (taskType === "debug" && result.prompt_strategy === "narrow_scope") {
    return {
      state: "yellow_search",
      tooltip: "Looks correct, but not tested",
      ariaLabel: "Review signal: Looks correct, but not tested",
      targetKey
    }
  }

  if (highImpactGap || result.confidence === "low") {
    return {
      state: "yellow_warning",
      tooltip: "High risk — key parts not proven",
      ariaLabel: "Review signal: High risk — key parts not proven",
      targetKey
    }
  }

  return {
    state: "yellow_puzzle",
    tooltip: "Convincing, but unproven",
    ariaLabel: "Review signal: Convincing, but unproven",
    targetKey
  }
}
