import type { PopupAction, PopupTone } from "../shared/types"
import type { ReviewWorkflowState } from "../../../lib/review/workflow-state"
import type { NextMoveDecision } from "../../../lib/review/next-move-decision"

export type ReviewPopupVisualState =
  | "loading"
  | "quick_review"
  | "deep_review"
  | "rescue_diagnosis"
  | "rescue_execution"
  | "error"

export type ReviewChecklistItem = {
  id: string
  label: string
  status: "verified" | "not_verified" | "missing" | "blocked"
}

export type ReviewRequirementMatchSummary = {
  status: "pass" | "needs_confirmation"
  confirmedCount: number
  missingCount: number
  rows: ReviewChecklistItem[]
}

export type ReviewDeepAnalysisV2Trace = {
  analysisId?: string
  analysisState?: string
  analysisMode?: string
  submittedPromptHash?: string
  assistantAnswerHash?: string
  submittedPromptLength?: number | null
  assistantAnswerLength?: number | null
  overallStatus: string
  confidence: string
  providerName: string
  providerModel?: string | null
  durationMs: number | null
  timedOut?: boolean
  usedFallback?: boolean
  providerAttempted?: string | null
  fallbackReason?: string | null
  failureMessage?: string | null
  kimiLatencyMs?: number | null
  deepSeekAttempted?: boolean | null
  deepSeekLatencyMs?: number | null
  deepSeekFailureReason?: string | null
  promptIntent: string
  nextStepSource: string
  nextStepRequirements: string[]
  blockedScope: string[]
  ignoredExternalValidation?: string[]
  actionableMissingItems?: string[]
  phaseAdvanceBasis?: string
  phaseCompletionClaimed?: boolean
  classificationAudit?: string[]
  recommendedNextMove: string
  generatedPrompt: string
  requirementMatches: Array<{
    requirementText: string
    status: string
    evidence: string[]
    note: string
  }>
}

export type ReviewPopupViewModel = {
  state: ReviewPopupVisualState
  mode: "quick" | "deep"
  eyebrow: string
  title: string
  statusBadge: {
    label: string
    tone: PopupTone
  }
  decision: string
  recommendedAction: string
  requirementMatchSummary?: ReviewRequirementMatchSummary | null
  nextMoveDecision?: NextMoveDecision | null
  readyForTesting?: boolean
  nextMoveInterpreterNote?: string
  deepAnalysisV2Trace?: ReviewDeepAnalysisV2Trace | null
  promptLabel: string
  prompt: string
  promptNote?: string
  workflowState?: ReviewWorkflowState | null
  workflowHelper?: string
  promptActions: PopupAction[]
  confidenceLabel: string
  confidenceNote: string
  confidenceReasons: string[]
  missingItems: string[]
  whyItems: string[]
  proofSummary: string
  checkedArtifacts: string[]
  uncheckedArtifacts: string[]
  checklistRows: ReviewChecklistItem[]
  quickToDeepDelta: string
  feedbackPrompt: string
  error?: {
    title: string
    body: string
  }
}
