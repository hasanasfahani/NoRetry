import type { Attempt, AfterAnalysisResult } from "@prompt-optimizer/shared/src/schemas"
import type { ProjectOnboardingRecord } from "../storage"
import type {
  GeneratedPrdDraft,
  ProjectPlanningCoverageReport,
  ProjectPlanningPrdSnapshot,
  ProjectPlanningQuestion,
  ProjectPlanningState
} from "../project-planning/project-planning"
import type { ReviewPopupSurface, ReviewPromptModeState } from "../review/types"

export type SyncedReviewSummary = {
  verdict: AfterAnalysisResult | null
  reviewMode: "quick" | "deep"
  attempt: Attempt | null
  planningGoal: string
}

export type SyncedPromptModeState = {
  version: 1
  v1: Partial<ReviewPromptModeState> | null
}

export type SyncedProjectOnboardingState = Pick<ProjectOnboardingRecord, "status" | "entryChoice" | "completedAt" | "updatedAt">

export type SyncedProjectPlanningState = {
  version: 1
  phase: ProjectPlanningState["phase"]
  description: string
  coverageReport: ProjectPlanningCoverageReport | null
  prdSnapshot: ProjectPlanningPrdSnapshot | null
  questions: ProjectPlanningQuestion[]
  activeQuestionIndex: number
  answerState: Record<string, string | string[]>
  otherAnswerState: Record<string, string>
  generatedPrd: GeneratedPrdDraft | null
  completed: boolean
}

function hasKeys(value: Record<string, unknown>) {
  return Object.keys(value).length > 0
}

function hasArrayValues(value: Record<string, string | string[]>) {
  return Object.values(value).some((entry) =>
    Array.isArray(entry) ? entry.length > 0 : entry.trim().length > 0
  )
}

export function sanitizePromptModeStateForSync(state: ReviewPromptModeState): Partial<ReviewPromptModeState> | null {
  const hasMeaningfulState =
    Boolean(state.sessionKey) ||
    Boolean(state.sourcePrompt.trim()) ||
    Boolean(state.questionHistory.length) ||
    hasKeys(state.answerState) ||
    hasKeys(state.otherAnswerState) ||
    Boolean(state.promptDraft.trim()) ||
    Boolean(state.promptReady)

  if (!hasMeaningfulState) return null

  return {
    popupState: state.popupState,
    sessionKey: state.sessionKey,
    sourcePrompt: state.sourcePrompt,
    planningGoal: state.planningGoal,
    requestBrief: state.requestBrief,
    goalContract: state.goalContract,
    promptContract: state.promptContract,
    planningAttempt: state.planningAttempt,
    analysisSeed: state.analysisSeed,
    localAnalysis: state.localAnalysis,
    questionHistory: state.questionHistory,
    questionLevels: state.questionLevels,
    currentLevelQuestions: state.currentLevelQuestions,
    currentLevel: state.currentLevel,
    activeQuestionIndex: state.activeQuestionIndex,
    answerState: state.answerState,
    otherAnswerState: state.otherAnswerState,
    isLoadingQuestions: false,
    branchReadyToGenerate: state.branchReadyToGenerate,
    branchStatusMessage: state.branchStatusMessage,
    isGeneratingPrompt: false,
    promptDraft: state.promptDraft,
    promptReady: state.promptReady,
    errorMessage: null
  }
}

export function buildSyncedPromptModeState(input: { v1: ReviewPromptModeState }): SyncedPromptModeState | null {
  const v1 = sanitizePromptModeStateForSync(input.v1)

  if (!v1) return null

  return {
    version: 1,
    v1
  }
}

export function sanitizeProjectOnboardingStateForSync(
  record: ProjectOnboardingRecord | null
): SyncedProjectOnboardingState | null {
  if (!record) return null

  return {
    status: record.status,
    entryChoice: record.entryChoice,
    completedAt: record.completedAt,
    updatedAt: record.updatedAt
  }
}

export function sanitizeProjectPlanningStateForSync(
  state: ProjectPlanningState
): SyncedProjectPlanningState | null {
  const hasMeaningfulState =
    Boolean(state.description.trim()) ||
    state.phase !== "intake" ||
    Boolean(state.coverageReport) ||
    Boolean(state.prdSnapshot) ||
    state.questions.length > 0 ||
    hasArrayValues(state.answerState) ||
    hasKeys(state.otherAnswerState) ||
    Boolean(state.generatedPrd)

  if (!hasMeaningfulState) return null

  return {
    version: 1,
    phase: state.phase,
    description: state.description,
    coverageReport: state.coverageReport,
    prdSnapshot: state.prdSnapshot,
    questions: state.questions,
    activeQuestionIndex: state.activeQuestionIndex,
    answerState: state.answerState,
    otherAnswerState: state.otherAnswerState,
    generatedPrd: state.generatedPrd,
    completed: state.completed
  }
}

export function restoreProjectPlanningStateFromSync(value: unknown): ProjectPlanningState | null {
  if (!value || typeof value !== "object") return null

  const record = value as Partial<SyncedProjectPlanningState>
  const phase =
    record.phase === "intake" || record.phase === "questions" || record.phase === "review"
      ? record.phase
      : record.phase === "saving"
        ? "review"
        : "intake"

  const description = typeof record.description === "string" ? record.description : ""
  const questions = Array.isArray(record.questions) ? (record.questions as ProjectPlanningQuestion[]) : []
  const answerState =
    record.answerState && typeof record.answerState === "object"
      ? (record.answerState as Record<string, string | string[]>)
      : {}
  const otherAnswerState =
    record.otherAnswerState && typeof record.otherAnswerState === "object"
      ? (record.otherAnswerState as Record<string, string>)
      : {}

  const restored: ProjectPlanningState = {
    phase: "intake",
    description,
    coverageReport: null,
    prdSnapshot: null,
    questions: [],
    activeQuestionIndex: 0,
    answerState: {},
    otherAnswerState: {},
    generatedPrd: null,
    completed: false
  }

  return {
    ...restored,
    phase,
    coverageReport: (record.coverageReport as ProjectPlanningCoverageReport | null | undefined) ?? null,
    prdSnapshot: (record.prdSnapshot as ProjectPlanningPrdSnapshot | null | undefined) ?? null,
    questions,
    activeQuestionIndex:
      typeof record.activeQuestionIndex === "number"
        ? Math.max(0, Math.min(record.activeQuestionIndex, Math.max(0, questions.length - 1)))
        : 0,
    answerState,
    otherAnswerState,
    generatedPrd: (record.generatedPrd as GeneratedPrdDraft | null | undefined) ?? null,
    completed: Boolean(record.completed)
  }
}

export function hasMeaningfulProgressSnapshot(input: {
  promptModeState: SyncedPromptModeState | null
  latestPromptDraft: string
  latestReviewSummary: SyncedReviewSummary | null
  currentWorkflowState: string | null
  latestReviewTargetIdentity: string | null
  onboardingState: SyncedProjectOnboardingState | null
  planningState: SyncedProjectPlanningState | null
}) {
  return Boolean(
    input.promptModeState ||
      input.latestPromptDraft.trim() ||
      input.latestReviewSummary?.verdict ||
      input.currentWorkflowState ||
      input.latestReviewTargetIdentity ||
      input.onboardingState ||
      input.planningState
  )
}

export function buildSyncedReviewSummary(input: {
  verdict: AfterAnalysisResult | null
  reviewMode: "quick" | "deep"
  attempt: Attempt | null
  planningGoal: string
}): SyncedReviewSummary | null {
  if (!input.verdict && !input.attempt && !input.planningGoal.trim()) return null

  return {
    verdict: input.verdict,
    reviewMode: input.reviewMode,
    attempt: input.attempt,
    planningGoal: input.planningGoal
  }
}

export function normalizeActiveSurface(surface: ReviewPopupSurface): ReviewPopupSurface {
  return surface === "prompt_mode" ? "prompt_mode" : "answer_mode"
}
