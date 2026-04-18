import type { AfterAnalysisResult, AnalyzePromptResponse, Attempt, ClarificationQuestion } from "@prompt-optimizer/shared/src/schemas"
import type { GoalContract } from "../../goal/types"
import type { PromptContract } from "../../prompt/contracts"
import type { PreflightAssessment } from "../../preflight/preflight-risk-engine"
import type { ReviewContract } from "../contracts"
import type { ReviewTaskType } from "../services/review-task-type"
import type { ReviewPromptModeV2Validation } from "../v2/prompt-mode-v2-assembly"
import type { ReviewPromptModeV2ProgressState } from "../v2/prompt-mode-v2-progress"
import type {
  ReviewPromptModeV2IntentConfidence,
  ReviewPromptModeV2RequestType,
  ReviewPromptModeV2TaskTypeChip,
  ReviewPromptModeV2TemplateKind
} from "../v2/request-types"
import type { ReviewPromptModeV2QuestionMode, ReviewPromptModeV2SectionState } from "../v2/section-schemas"

export type ReviewPopupMode = "quick" | "deep"

export type ReviewPopupState = "idle" | "loading" | "quick_review" | "deep_review" | "error"

export type ReviewPopupSurface = "answer_mode" | "prompt_mode" | "prompt_mode_v2"

export type ReviewSignalVisualState =
  | "idle"
  | "loading"
  | "typing"
  | "green"
  | "red"
  | "yellow_warning"
  | "yellow_search"
  | "yellow_puzzle"

export type ReviewSignalState = {
  state: ReviewSignalVisualState
  tooltip: string
  ariaLabel: string
  targetKey: string | null
}

export type ReviewTarget = {
  attempt: Attempt
  taskType: ReviewTaskType
  responseText: string
  responseIdentity: string
  threadIdentity: string
  normalizedResponseText: string
}

export type ReviewTargetResolution =
  | {
      ok: true
      target: ReviewTarget
    }
  | {
      ok: false
      reason: "no_response" | "no_submitted_attempt"
    }

export type ReviewResultCache = {
  targetKey: string
  quick: { result: AfterAnalysisResult; reviewContract: ReviewContract | null; goalContract: GoalContract | null } | null
  deep: { result: AfterAnalysisResult; reviewContract: ReviewContract | null; goalContract: GoalContract | null } | null
}

export type ReviewPromptModePopupState = "idle" | "loading" | "questions" | "error"
export type ReviewPromptModeV2PopupState = "idle" | "loading" | "entry" | "questions" | "error"

export type ReviewPromptModeState = {
  popupState: ReviewPromptModePopupState
  sessionKey: string | null
  sourcePrompt: string
  planningGoal: string
  goalContract: GoalContract | null
  promptContract: PromptContract | null
  planningAttempt: Attempt | null
  analysisSeed: AfterAnalysisResult | null
  localAnalysis: AnalyzePromptResponse | null
  questionHistory: ClarificationQuestion[]
  questionLevels: Record<string, number>
  currentLevelQuestions: ClarificationQuestion[]
  currentLevel: number
  activeQuestionIndex: number
  answerState: Record<string, string | string[]>
  otherAnswerState: Record<string, string>
  isLoadingQuestions: boolean
  isGeneratingPrompt: boolean
  promptDraft: string
  promptReady: boolean
  errorMessage: string | null
}

export type ReviewPromptModeV2State = {
  popupState: ReviewPromptModeV2PopupState
  sessionKey: string | null
  sourcePrompt: string
  goalContract: GoalContract | null
  localAnalysis: AnalyzePromptResponse | null
  intentConfidence: ReviewPromptModeV2IntentConfidence
  likelyTaskTypes: ReviewPromptModeV2TaskTypeChip[]
  selectedTaskType: ReviewPromptModeV2RequestType | null
  selectedTemplateKind: ReviewPromptModeV2TemplateKind | null
  clarifyingQuestion: string | null
  clarifyingAnswer: string
  sections: ReviewPromptModeV2SectionState[]
  additionalNotes: string[]
  isGeneratingPrompt: boolean
  promptDraft: string
  promptReady: boolean
  validation: ReviewPromptModeV2Validation | null
  progress: ReviewPromptModeV2ProgressState | null
  assemblyErrorMessage: string | null
  questionHistory: ReviewPromptModeV2Question[]
  activeQuestionIndex: number
  answerState: Record<string, string | string[]>
  otherAnswerState: Record<string, string>
  errorMessage: string | null
}

export type ReviewPromptModeV2Question = {
  id: string
  sectionId: string
  sectionLabel: string
  label: string
  helper: string
  mode: ReviewPromptModeV2QuestionMode
  options: string[]
  depth?: "primary" | "secondary" | "tertiary"
}

export type ReviewTypingState = {
  active: boolean
  promptText: string
  sessionKey: string | null
  goalContract: GoalContract | null
  preflight: PreflightAssessment | null
}

export type ReviewPopupControllerState = {
  surface: ReviewPopupSurface
  popupState: ReviewPopupState
  activeMode: ReviewPopupMode
  targetKey: string | null
  cacheStatus: "none" | "hit" | "miss"
  analysisStarted: boolean
  analysisFinished: boolean
  errorReason: string | null
}
