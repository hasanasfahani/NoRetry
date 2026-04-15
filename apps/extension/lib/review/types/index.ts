import type { AfterAnalysisResult, AnalyzePromptResponse, Attempt, ClarificationQuestion } from "@prompt-optimizer/shared/src/schemas"
import type { ReviewTaskType } from "../services/review-task-type"

export type ReviewPopupMode = "quick" | "deep"

export type ReviewPopupState = "idle" | "loading" | "quick_review" | "deep_review" | "error"

export type ReviewPopupSurface = "answer_mode" | "prompt_mode"

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
  quick: AfterAnalysisResult | null
  deep: AfterAnalysisResult | null
}

export type ReviewPromptModePopupState = "idle" | "loading" | "questions" | "error"

export type ReviewPromptModeState = {
  popupState: ReviewPromptModePopupState
  sessionKey: string | null
  sourcePrompt: string
  planningGoal: string
  planningAttempt: Attempt | null
  analysisSeed: AfterAnalysisResult | null
  localAnalysis: AnalyzePromptResponse | null
  questionHistory: ClarificationQuestion[]
  questionLevels: Record<string, number>
  currentLevelQuestions: ClarificationQuestion[]
  currentLevel: number
  activeQuestionIndex: number
  answerState: Record<string, string>
  otherAnswerState: Record<string, string>
  isLoadingQuestions: boolean
  isGeneratingPrompt: boolean
  promptDraft: string
  promptReady: boolean
  errorMessage: string | null
}

export type ReviewTypingState = {
  active: boolean
  promptText: string
  sessionKey: string | null
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
