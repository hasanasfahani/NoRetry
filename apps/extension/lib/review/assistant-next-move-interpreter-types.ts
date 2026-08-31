export type AssistantNextMoveType =
  | "approval_request"
  | "continuation_offer"
  | "clarification_request"
  | "validation_request"
  | "optional_enhancement"
  | "task_complete"
  | "unknown"

export type AssistantInterpreterSource = "ai" | "local_heuristic"

export type AssistantInterpreterConfidence = "high" | "medium" | "low"

export type AssistantCurrentStepClaim = "complete" | "partial" | "unclear"

export type AssistantNextMoveInterpretation = {
  source: AssistantInterpreterSource
  currentStepClaim: AssistantCurrentStepClaim
  nextMoveType: AssistantNextMoveType
  nextMoveSummary: string
  targetLabel: string | null
  targetPhaseNumber: number | null
  requiresApproval: boolean
  suggestsImplementation: boolean
  suggestsClarification: boolean
  suggestsValidation: boolean
  suggestsCompletion: boolean
  confidenceLevel: AssistantInterpreterConfidence
}
