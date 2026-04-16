import type { AfterAnalysisResult, AnalyzePromptResponse, Attempt, ClarificationQuestion } from "./schemas"

export type ReviewPopupMode = "quick" | "deep"
export type ReviewPopupSurface = "answer_mode" | "prompt_mode"
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
