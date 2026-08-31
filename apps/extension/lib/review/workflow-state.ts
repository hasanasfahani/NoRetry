import type { AfterAnalysisResult } from "@prompt-optimizer/shared/src/schemas"
import type { RequestBrief } from "@prompt-optimizer/shared/src/request-brief"
import type { ReviewFollowUpStrategyMode } from "./contracts"
import type { PopupTone } from "../../components/review-popup/shared/types"

export type ReviewWorkflowState =
  | "drafting"
  | "plan_requested"
  | "implementation_underway"
  | "validation_needed"
  | "safe_to_proceed"
  | "done"
  | "blocked"

export const WORKFLOW_STAGE_LABELS = ["Draft", "Plan", "Build", "Validate", "Done"] as const

export function workflowStateLabel(state: ReviewWorkflowState | null | undefined) {
  switch (state) {
    case "drafting":
      return "Drafting"
    case "plan_requested":
      return "Plan requested"
    case "implementation_underway":
      return "Implementation underway"
    case "validation_needed":
      return "Validation needed"
    case "safe_to_proceed":
      return "Safe to proceed"
    case "done":
      return "Done"
    case "blocked":
      return "Blocked"
    default:
      return ""
  }
}

export function workflowStateTone(state: ReviewWorkflowState | null | undefined): PopupTone {
  switch (state) {
    case "drafting":
    case "plan_requested":
    case "implementation_underway":
      return "info"
    case "validation_needed":
      return "warning"
    case "safe_to_proceed":
    case "done":
      return "success"
    case "blocked":
      return "danger"
    default:
      return "neutral"
  }
}

export function workflowStateActionLabel(state: ReviewWorkflowState | null | undefined) {
  switch (state) {
    case "drafting":
      return "Next move draft"
    case "plan_requested":
      return "Planning request"
    case "implementation_underway":
      return "Implementation prompt"
    case "validation_needed":
      return "Validation request"
    case "safe_to_proceed":
      return "Next move"
    case "done":
      return "Complete"
    case "blocked":
      return "Corrective request"
    default:
      return "Next best move"
  }
}

export function workflowStateHelper(state: ReviewWorkflowState | null | undefined) {
  switch (state) {
    case "drafting":
      return "Shape the request before asking the assistant to act."
    case "plan_requested":
      return "Pause implementation and align on the safest scope first."
    case "implementation_underway":
      return "Keep the change narrow and preserve the existing architecture."
    case "validation_needed":
      return "Ask for visible proof before building on this work."
    case "safe_to_proceed":
      return "Nothing critical is blocking the next step."
    case "done":
      return "This request looks complete and safe to close."
    case "blocked":
      return "The assistant is off track or unsafe to continue as-is."
    default:
      return ""
  }
}

export function workflowStageIndex(state: ReviewWorkflowState | null | undefined) {
  switch (state) {
    case "drafting":
      return 0
    case "plan_requested":
    case "blocked":
      return 1
    case "implementation_underway":
      return 2
    case "validation_needed":
      return 3
    case "safe_to_proceed":
    case "done":
      return 4
    default:
      return null
  }
}

export function deriveWorkflowStateFromRequestBrief(_brief: RequestBrief | null | undefined): ReviewWorkflowState {
  return "drafting"
}

export function deriveWorkflowStateFromAnalysis(input: {
  resultStatus?: AfterAnalysisResult["status"] | null
  strategyMode?: ReviewFollowUpStrategyMode | null
  taskType?: string
  previousWorkflowState?: ReviewWorkflowState | null
}): ReviewWorkflowState {
  const { resultStatus = null, strategyMode = null, taskType = "", previousWorkflowState = null } = input

  if (resultStatus === "WRONG_DIRECTION") return "blocked"

  if (strategyMode === "clarify_scope" || strategyMode === "plan_first" || strategyMode === "split_into_phases") {
    return "plan_requested"
  }

  if (strategyMode === "validate_before_continue") {
    return "validation_needed"
  }

  if (resultStatus === "SUCCESS") {
    if (
      previousWorkflowState === "validation_needed" ||
      taskType === "verification" ||
      taskType === "debug"
    ) {
      return "done"
    }

    return "safe_to_proceed"
  }

  if (resultStatus === "FAILED") {
    if (previousWorkflowState === "validation_needed" || taskType === "verification") {
      return "validation_needed"
    }
    return "blocked"
  }

  if (strategyMode === "direct_revise") {
    return "implementation_underway"
  }

  if (previousWorkflowState) return previousWorkflowState
  return "implementation_underway"
}
