import type { ReviewEvidenceSummary } from "./evidence-model"
import type { FailureType } from "./failure-taxonomy"

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
  analysisDebug?: ReviewAnalysisDebugPayload | null
}
