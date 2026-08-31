import type { AfterAnalysisResult } from "@prompt-optimizer/shared/src/schemas"
import type {
  AssistantCurrentStepClaim,
  AssistantInterpreterConfidence,
  AssistantInterpreterSource,
  AssistantNextMoveInterpretation,
  AssistantNextMoveType
} from "../assistant-next-move-interpreter-types"
import type { AssistantNextStepSignalKind } from "../assistant-next-step-signal"
import type {
  NextMoveDecisionStatus,
  NextMoveRecommendationKind
} from "../next-move-decision"
import type { ReviewWorkflowState } from "../workflow-state"

export type NextMoveEvalCategory =
  | "requirement_gate"
  | "clear_continue"
  | "clear_stop"
  | "revise_retry"
  | "ambiguous_low_confidence"
  | "regression"

export type NextMoveEvalSelectedSource = AssistantInterpreterSource | "none"

export type NextMoveEvalInput = {
  promptText: string
  responseText: string
  taskFamily: string
  review: {
    analysisStatus: AfterAnalysisResult["status"]
    confidence: AfterAnalysisResult["confidence"]
    workflowState?: ReviewWorkflowState | null
    noRetryRecommended: boolean
    decisionText: string
    recommendationText: string
    promptLabel?: string
    promptText?: string
  }
}

export type NextMoveEvalInterpreterExpectation = Partial<{
  currentStepClaim: AssistantCurrentStepClaim
  nextMoveType: AssistantNextMoveType
  kind: AssistantNextStepSignalKind
  confidenceLevel: AssistantInterpreterConfidence
  targetLabel: string | null
  targetPhaseNumber: number | null
  requiresApproval: boolean
  suggestsImplementation: boolean
  suggestsClarification: boolean
  suggestsValidation: boolean
  suggestsCompletion: boolean
}>

export type NextMoveEvalDecisionExpectation = {
  status: NextMoveDecisionStatus
  recommendationKind: NextMoveRecommendationKind
}

export type NextMoveEvalDecisionSnapshot = NextMoveEvalDecisionExpectation

export type NextMoveEvalSignalSnapshot = Partial<NextMoveEvalInterpreterExpectation> & {
  kind?: AssistantNextStepSignalKind | "none"
  nextMoveType?: AssistantNextMoveType | "none"
  currentStepClaim?: AssistantCurrentStepClaim | "none"
  confidenceLevel?: AssistantInterpreterConfidence | "none"
}

export type NextMoveEvalSelectedSignalSnapshot = NextMoveEvalSignalSnapshot & {
  source: NextMoveEvalSelectedSource
  agreement: "agree" | "disagree" | "ai_only" | "local_only" | "none"
}

export type NextMoveEvalHardGateExpectation = {
  requirementSatisfied: boolean
  mustBlockAdvancement: boolean
  rationale: string
}

export type NextMoveEvalExpected = {
  interpreter?: NextMoveEvalInterpreterExpectation
  selectedSignalSource?: NextMoveEvalSelectedSource
  signalAgreement?: "agree" | "disagree" | "ai_only" | "local_only" | "none"
  decision: NextMoveEvalDecisionExpectation
  hardGate: NextMoveEvalHardGateExpectation
}

export type NextMoveEvalRubric = {
  must: string[]
  should?: string[]
  rejectIf?: string[]
}

export type NextMoveEvalAiFixture = Omit<AssistantNextMoveInterpretation, "source"> & {
  promptVersion?: string
}

export type NextMoveEvalCase = {
  id: string
  title: string
  category: NextMoveEvalCategory
  input: NextMoveEvalInput
  aiFixture?: NextMoveEvalAiFixture | null
  expected: NextMoveEvalExpected
  rubric: NextMoveEvalRubric
  notes?: string
}

export type NextMoveEvalRubricFailure = {
  rule: string
  message: string
}

export type NextMoveEvalRubricResult = {
  failures: NextMoveEvalRubricFailure[]
  passedRules: string[]
}
