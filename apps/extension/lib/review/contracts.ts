import type { ReviewEvidenceSummary } from "./evidence-model"
import type { FailureType } from "./failure-taxonomy"
import type { AssistantNextStepSignal } from "./assistant-next-step-signal"
import type { AssistantSignalFirstDecision } from "./next-move-decision"
import type { ReviewPhaseProgress } from "./phase-progress"
import type { SimpleNextPromptDecision } from "./simple-next-prompt-decision"
import type { SimpleNextPromptRolloutMode } from "./simple-next-prompt-rollout"
import type { ReviewWorkflowState } from "./workflow-state"

export type ReviewRequirementPriority = "P1" | "P2" | "P3" | "P4"

export type ReviewRequirementStatus = "pass" | "fail" | "unclear" | "contradicted"

export type ReviewRequirement = {
  id: string
  label: string
  type: string
  priority: ReviewRequirementPriority
  expected?: string | number
  actual?: string | number
  status: ReviewRequirementStatus
  evidence: string[]
}

export type ReviewAnalysisJudgmentStatus = "met" | "missing" | "unclear" | "contradicted"

export type ReviewAnalysisEvidenceSpan = {
  source: "request" | "answer" | "review"
  snippet: string
  lineStart: number
  lineEnd: number
}

export type ReviewAnalysisJudgment = {
  id: string
  section: "taskGoal" | "requirements" | "constraints" | "acceptanceCriteria" | "actualOutputToEvaluate"
  label: string
  status: ReviewAnalysisJudgmentStatus
  confidence: "high" | "medium" | "low"
  usefulness: number
  rationale: string
  requestEvidence: ReviewAnalysisEvidenceSpan[]
  answerEvidence: ReviewAnalysisEvidenceSpan[]
}

export type ReviewFollowUpStrategyMode =
  | "no_retry"
  | "direct_revise"
  | "clarify_scope"
  | "validate_before_continue"
  | "plan_first"
  | "split_into_phases"

export type ReviewAnalysisDebugPayload = {
  promptVersion: string
  selectedPath: "baseline" | "smart"
  comparisonSummary: string
  baseline: {
    working: string[]
    gaps: string[]
    nextMove: string
    judgments: ReviewAnalysisJudgment[]
  }
  smart: {
    working: string[]
    gaps: string[]
    nextMove: string
    assistantSuggestedNextStep?: string | null
    assistantNextStepSignal?: AssistantNextStepSignal | null
    assistantNextStepSignalLocal?: AssistantNextStepSignal | null
    assistantNextStepSignalAi?: AssistantNextStepSignal | null
    assistantNextStepSignalSource?: "ai" | "local_heuristic" | "none"
    assistantNextStepSignalAgreement?: "agree" | "disagree" | "ai_only" | "local_only" | "none"
    assistantSignalDecision?: AssistantSignalFirstDecision | null
    simpleNextPromptDecision?: SimpleNextPromptDecision | null
    simpleNextPromptRolloutMode?: SimpleNextPromptRolloutMode
    simpleNextPromptApplied?: boolean
    workflowState: ReviewWorkflowState
    phaseProgress?: ReviewPhaseProgress | null
    strategy: {
      mode: ReviewFollowUpStrategyMode
      reason: string
    }
    judgments: ReviewAnalysisJudgment[]
    judgeNotes: string[]
    validatorNotes: string[]
  }
}

export type ReviewAttemptMemory = {
  retryCount: number
  repeatedFailureTypes: FailureType[]
  previousFailureTypes: FailureType[]
  unresolvedIssues: string[]
  progressState: "improving" | "stalled" | "regressing" | "first_attempt"
}

export type ReviewContract = {
  taskFamily: string
  checklistSource: "decomposed" | "prompt_artifact" | "informational_generic" | "fallback_structured" | "backend"
  sanitizationChanges: string[]
  overallDecision: string
  recommendation: string
  confidence: "high" | "medium" | "low"
  confidenceNote: string
  confidenceReasons: string[]
  failureTypes: FailureType[]
  evidenceSummary: ReviewEvidenceSummary
  attemptMemory: ReviewAttemptMemory | null
  requirements: ReviewRequirement[]
  topFailures: ReviewRequirement[]
  topPasses: ReviewRequirement[]
  missingItems: string[]
  whyItems: string[]
  proofSummary: string
  checkedItems: string[]
  uncheckedItems: string[]
  promptLabel: string
  promptText: string
  promptNote: string
  copyPromptText?: string
  nextMoveShort: string
  feedbackPrompt: string
  retryStrategy?: string
  phaseProgress?: ReviewPhaseProgress | null
  analysisDebug?: ReviewAnalysisDebugPayload | null
}
