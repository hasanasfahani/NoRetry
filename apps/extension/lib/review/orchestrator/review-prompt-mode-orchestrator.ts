import type {
  AfterAnalysisResult,
  AnalyzePromptResponse,
  Attempt,
  ClarificationQuestion,
  ExtendQuestionsResponse,
  PromptSurface,
  RefinePromptResponse,
  SessionSummary
} from "@prompt-optimizer/shared/src/schemas"
import {
  buildInitialPlannerState,
  buildLevelMap,
  buildNextPromptAnswers,
  buildOrderedAnsweredPath,
  buildPlannerAdvanceResult,
  buildPlannerBranchContext,
  mergeUniqueQuestions,
  prunePlannerBranch,
  resolvePlannerAnswer,
  shouldRebuildPlannerBranch
} from "../../core/after-orchestration"
import type { ReviewPromptModeState } from "../types"
import {
  buildPromptModeFallbackQuestions,
  buildPromptModePromptPlan,
  buildPromptModeQuestionRequest,
  buildPromptModeSeedAnalysis,
  buildPromptModeSessionKey,
  formatPromptModeStructuredDraft
} from "../services/review-prompt-mode"

type PromptModeOpenInput = {
  promptText: string
  beforeIntent: AnalyzePromptResponse["intent"] | null | undefined
}

type CreateReviewPromptModeOrchestratorInput = {
  getPlatform: () => Attempt["platform"]
  getSurface: () => PromptSurface
  getSessionSummary: () => Partial<SessionSummary> | null
  getProjectMemoryContext: () => { projectContext: string; currentState: string }
  extendQuestions: (input: ReturnType<typeof buildPromptModeQuestionRequest>) => Promise<ExtendQuestionsResponse>
  refinePrompt: (input: {
    prompt: string
    surface?: PromptSurface
    intent: "DEBUG" | "BUILD" | "REFACTOR" | "EXPLAIN" | "DESIGN_UI" | "OTHER"
    answers: Record<string, string>
    sessionSummary?: Partial<SessionSummary>
  }) => Promise<RefinePromptResponse>
  onStateChange: (state: ReviewPromptModeState) => void
}

const OTHER_OPTION = "Other"

function getReturnedQuestions(result: ExtendQuestionsResponse | null | undefined) {
  return result?.clarification_questions ?? []
}

function findHistoryIndexForQuestion(params: {
  questionId: string
  history: ClarificationQuestion[]
  fallbackIndex: number
}) {
  const { questionId, history, fallbackIndex } = params
  const historyIndex = history.findIndex((item) => item.id === questionId)
  return historyIndex >= 0 ? historyIndex : fallbackIndex
}

function buildInitialState(): ReviewPromptModeState {
  return {
    popupState: "idle",
    sessionKey: null,
    sourcePrompt: "",
    planningGoal: "",
    planningAttempt: null,
    analysisSeed: null,
    localAnalysis: null,
    questionHistory: [],
    questionLevels: {},
    currentLevelQuestions: [],
    currentLevel: 1,
    activeQuestionIndex: 0,
    answerState: {},
    otherAnswerState: {},
    isLoadingQuestions: false,
    isGeneratingPrompt: false,
    promptDraft: "",
    promptReady: false,
    errorMessage: null
  }
}

function mapTaskTypeToPromptIntent(taskType: Attempt["intent"]["task_type"]) {
  switch (taskType) {
    case "debug":
      return "DEBUG"
    case "build":
      return "BUILD"
    case "refactor":
      return "REFACTOR"
    case "explain":
      return "EXPLAIN"
    case "create_ui":
      return "DESIGN_UI"
    default:
      return "OTHER"
  }
}

export function createReviewPromptModeOrchestrator(input: CreateReviewPromptModeOrchestratorInput) {
  let requestId = 0
  let state = buildInitialState()

  function emit(next: ReviewPromptModeState) {
    state = next
    input.onStateChange(next)
  }

  function patch(next: Partial<ReviewPromptModeState>) {
    emit({
      ...state,
      ...next
    })
  }

  async function requestNextQuestions(params: {
    promptText: string
    localAnalysis: AnalyzePromptResponse
    existingQuestions: ClarificationQuestion[]
    answerState: Record<string, string>
    otherAnswerState: Record<string, string>
  }) {
    return input.extendQuestions(
      buildPromptModeQuestionRequest({
        promptText: params.promptText,
        localAnalysis: params.localAnalysis,
        existingQuestions: params.existingQuestions,
        answerState: params.answerState,
        otherAnswerState: params.otherAnswerState,
        surface: input.getSurface(),
        sessionSummary: input.getSessionSummary()
      })
    )
  }

  async function open(params: PromptModeOpenInput) {
    const promptText = params.promptText.trim()
    if (!promptText) {
      emit({
        ...buildInitialState(),
        popupState: "error",
        errorMessage: "Type a prompt first so NoRetry can shape the next-step questions."
      })
      return
    }

    const sessionKey = buildPromptModeSessionKey(promptText)
    if (state.sessionKey === sessionKey && state.popupState !== "idle") {
      patch({ popupState: "questions", errorMessage: null })
      return
    }

    const request = ++requestId
    console.debug("[NoRetry][ReviewPromptMode]", "open", {
      promptLength: promptText.length
    })
    const seed = buildPromptModeSeedAnalysis({
      promptText,
      platform: input.getPlatform(),
      beforeIntent: params.beforeIntent,
      sessionSummary: input.getSessionSummary()
    })

    emit({
      ...buildInitialState(),
      popupState: "loading",
      sessionKey,
      sourcePrompt: promptText,
      planningGoal: promptText,
      planningAttempt: seed.planningAttempt,
      analysisSeed: seed.seedAnalysis,
      localAnalysis: seed.localAnalysis,
      isLoadingQuestions: true
    })

    try {
      const result = await requestNextQuestions({
        promptText,
        localAnalysis: seed.localAnalysis,
        existingQuestions: [],
        answerState: {},
        otherAnswerState: {}
      })

      if (request !== requestId) return

      const returnedQuestions = getReturnedQuestions(result)
      const nextState =
        returnedQuestions.length
          ? buildInitialPlannerState(returnedQuestions, 1)
          : buildPromptModeFallbackQuestions({
              promptText,
              localAnalysis: seed.localAnalysis
            })

      emit({
        ...buildInitialState(),
        popupState: "questions",
        sessionKey,
        sourcePrompt: promptText,
        planningGoal: promptText,
        planningAttempt: seed.planningAttempt,
        analysisSeed: seed.seedAnalysis,
        localAnalysis: seed.localAnalysis,
        questionHistory: nextState.questionHistory,
        questionLevels: nextState.questionLevels,
        currentLevelQuestions: nextState.currentLevelQuestions,
        currentLevel: nextState.currentLevel,
        activeQuestionIndex: nextState.activeQuestionIndex,
        isLoadingQuestions: false
      })
      console.debug("[NoRetry][ReviewPromptMode]", "first question level ready", {
        sessionKey,
        questionCount: nextState.questionHistory.length,
        level: nextState.currentLevel
      })
    } catch (error) {
      if (request !== requestId) return
      emit({
        ...buildInitialState(),
        popupState: "error",
        sessionKey,
        sourcePrompt: promptText,
        planningGoal: promptText,
        planningAttempt: seed.planningAttempt,
        analysisSeed: seed.seedAnalysis,
        localAnalysis: seed.localAnalysis,
        errorMessage: error instanceof Error ? error.message : "NoRetry couldn't start the prompt tree safely."
      })
    }
  }

  function setActiveQuestionIndex(index: number) {
    patch({
      activeQuestionIndex: Math.max(0, Math.min(index, state.questionHistory.length - 1))
    })
  }

  function setOtherAnswer(question: ClarificationQuestion, value: string) {
    patch({
      otherAnswerState: {
        ...state.otherAnswerState,
        [question.id]: value
      },
      promptReady: false
    })
  }

  function pruneFromIndex(startIndex: number) {
    const pruned = prunePlannerBranch({
      startIndex,
      questionHistory: state.questionHistory,
      questionLevels: state.questionLevels,
      answerState: state.answerState,
      otherAnswerState: state.otherAnswerState
    })

    emit({
      ...state,
      questionHistory: pruned.keptHistory,
      currentLevelQuestions: pruned.currentLevelQuestions,
      currentLevel: pruned.activeLevel,
      answerState: pruned.answerState,
      otherAnswerState: pruned.otherAnswerState,
      questionLevels: pruned.questionLevels,
      activeQuestionIndex: pruned.activeQuestionIndex,
      promptDraft: "",
      promptReady: false,
      isLoadingQuestions: false,
      errorMessage: null
    })
  }

  async function advanceDecisionTree(
    questionId: string,
    resolvedValue: string,
    branchContext?: {
      history: ClarificationQuestion[]
      currentLevelQuestions: ClarificationQuestion[]
      currentLevel: number
    }
  ) {
    if (!state.planningAttempt || !state.localAnalysis) return

    const visibleLevelQuestions = branchContext?.currentLevelQuestions ?? state.currentLevelQuestions
    const visibleHistory = branchContext?.history ?? state.questionHistory
    const visibleLevel = branchContext?.currentLevel ?? state.currentLevel

    const advance = buildPlannerAdvanceResult({
      questionId,
      resolvedValue,
      answerState: state.answerState,
      otherAnswerState: state.otherAnswerState,
      visibleLevelQuestions,
      visibleHistory,
      visibleLevel,
      questionLevels: state.questionLevels,
      otherOption: OTHER_OPTION
    })

    patch({
      answerState: advance.mergedAnswers,
      promptReady: false,
      promptDraft: ""
    })

    if (advance.kind === "advance_local") {
      const nextQuestion = visibleLevelQuestions[advance.nextIndex]
      patch({
        activeQuestionIndex: nextQuestion
          ? findHistoryIndexForQuestion({
              questionId: nextQuestion.id,
              history: visibleHistory,
              fallbackIndex: advance.nextIndex
            })
          : advance.nextIndex
      })
      return
    }

    const request = ++requestId
    patch({ isLoadingQuestions: true })
    console.debug("[NoRetry][ReviewPromptMode]", "requesting deeper branch", {
      sessionKey: state.sessionKey,
      questionId,
      currentLevel: advance.currentLevel,
      answeredCount: Object.keys(advance.normalizedAnswers).length
    })

    try {
      const result = await requestNextQuestions({
        promptText: state.sourcePrompt,
        localAnalysis: state.localAnalysis,
        existingQuestions: advance.askedQuestions,
        answerState: advance.mergedAnswers,
        otherAnswerState: state.otherAnswerState
      })
      if (request !== requestId) return

      const returnedQuestions = getReturnedQuestions(result)
      if (returnedQuestions.length) {
        const nextLevel = Math.max(advance.currentLevel + 1, state.currentLevel + 1)
        patch({
          questionHistory: mergeUniqueQuestions(state.questionHistory, returnedQuestions),
          currentLevelQuestions: returnedQuestions,
          questionLevels: {
            ...state.questionLevels,
            ...buildLevelMap(returnedQuestions, nextLevel)
          },
          currentLevel: nextLevel,
          activeQuestionIndex: advance.askedQuestions.length,
          isLoadingQuestions: false
        })
        console.debug("[NoRetry][ReviewPromptMode]", "branch advanced", {
          sessionKey: state.sessionKey,
          nextLevel,
          questionCount: returnedQuestions.length
        })
        return
      }

      patch({
        activeQuestionIndex: findHistoryIndexForQuestion({
          questionId,
          history: visibleHistory,
          fallbackIndex: Math.min(state.activeQuestionIndex, Math.max(0, visibleLevelQuestions.length - 1))
        }),
        isLoadingQuestions: false
      })
    } catch {
      if (request !== requestId) return
      patch({
        isLoadingQuestions: false
      })
    }
  }

  async function setAnswer(question: ClarificationQuestion, value: string) {
    if (state.isLoadingQuestions) return

    const previousValue = state.answerState[question.id] ?? ""
    const previousResolvedValue = resolvePlannerAnswer(previousValue, state.otherAnswerState[question.id], OTHER_OPTION)
    const nextResolvedValue = resolvePlannerAnswer(value, state.otherAnswerState[question.id], OTHER_OPTION)
    const branchContext = buildPlannerBranchContext({
      questionId: question.id,
      questionHistory: state.questionHistory,
      questionLevels: state.questionLevels
    })

    patch({
      answerState: {
        ...state.answerState,
        [question.id]: value
      },
      promptReady: false,
      promptDraft: ""
    })

    if (
      shouldRebuildPlannerBranch({
        questionIndex: branchContext.questionIndex,
        totalQuestions: state.questionHistory.length,
        previousResolvedValue,
        nextResolvedValue
      })
    ) {
      pruneFromIndex(branchContext.questionIndex)
      if (value !== OTHER_OPTION) {
        await advanceDecisionTree(question.id, value, {
          history: branchContext.keptHistory,
          currentLevelQuestions: branchContext.keptLevelQuestions,
          currentLevel: branchContext.activeLevel
        })
      }
      return
    }

    if (value === OTHER_OPTION) return
    await advanceDecisionTree(question.id, value)
  }

  async function advanceOther() {
    if (state.isLoadingQuestions) return

    const activeQuestion = state.questionHistory[state.activeQuestionIndex] ?? state.currentLevelQuestions[state.activeQuestionIndex]
    if (!activeQuestion) return

    const typedOther = state.otherAnswerState[activeQuestion.id]?.trim()
    if (!typedOther) return

    const branchContext = buildPlannerBranchContext({
      questionId: activeQuestion.id,
      questionHistory: state.questionHistory,
      questionLevels: state.questionLevels
    })

    const previousValue = state.answerState[activeQuestion.id]
    const previousResolvedValue = resolvePlannerAnswer(previousValue, state.otherAnswerState[activeQuestion.id], OTHER_OPTION)

    if (
      shouldRebuildPlannerBranch({
        questionIndex: branchContext.questionIndex,
        totalQuestions: state.questionHistory.length,
        previousResolvedValue,
        nextResolvedValue: typedOther
      })
    ) {
      pruneFromIndex(branchContext.questionIndex)
      await advanceDecisionTree(activeQuestion.id, typedOther, {
        history: branchContext.keptHistory,
        currentLevelQuestions: branchContext.keptLevelQuestions,
        currentLevel: branchContext.activeLevel
      })
      return
    }

    await advanceDecisionTree(activeQuestion.id, typedOther)
  }

  async function generatePrompt() {
    if (!state.planningAttempt || !state.analysisSeed || !state.planningGoal.trim()) return

    const request = ++requestId
    console.debug("[NoRetry][ReviewPromptMode]", "generate prompt", {
      sessionKey: state.sessionKey,
      answeredCount: Object.keys(state.answerState).length
    })
    patch({
      isGeneratingPrompt: true,
      promptReady: false
    })

    const answers = buildNextPromptAnswers({
      answerState: state.answerState,
      otherAnswerState: state.otherAnswerState,
      otherOption: OTHER_OPTION,
      planningGoal: state.planningGoal
    })

    const answeredPath = buildOrderedAnsweredPath({
      questionHistory: state.questionHistory,
      answerState: state.answerState,
      otherAnswerState: state.otherAnswerState,
      otherOption: OTHER_OPTION
    })

    const memory = input.getProjectMemoryContext()
    const effectiveLocalAnalysis =
      state.localAnalysis ??
      buildPromptModeSeedAnalysis({
        promptText: state.sourcePrompt,
        platform: input.getPlatform(),
        beforeIntent: null,
        sessionSummary: input.getSessionSummary()
      }).localAnalysis

    const { basePrompt, localFallback } = buildPromptModePromptPlan({
      sourcePrompt: state.sourcePrompt,
      planningGoal: state.planningGoal,
      localAnalysis: effectiveLocalAnalysis,
      answeredPath,
      constraints: (state.planningAttempt.intent.constraints ?? []).map((item) => item.trim()).filter(Boolean),
      projectContext: memory.projectContext,
      currentState: memory.currentState
    })

    try {
      const result = await input.refinePrompt({
        prompt: basePrompt,
        surface: input.getSurface(),
        intent: mapTaskTypeToPromptIntent(state.planningAttempt.intent.task_type),
        answers,
        sessionSummary: input.getSessionSummary() ?? undefined
      })

      const structuredPrompt = formatPromptModeStructuredDraft({
        sourcePrompt: state.sourcePrompt,
        planningGoal: state.planningGoal,
        refinedPrompt: result.improved_prompt,
        localAnalysis: effectiveLocalAnalysis,
        answeredPath,
        constraints: (state.planningAttempt.intent.constraints ?? []).map((item) => item.trim()).filter(Boolean)
      })

      if (request !== requestId) return
      patch({
        promptDraft: structuredPrompt,
        promptReady: true,
        isGeneratingPrompt: false
      })
      console.debug("[NoRetry][ReviewPromptMode]", "prompt ready", {
        sessionKey: state.sessionKey,
        promptLength: structuredPrompt.length
      })
    } catch {
      if (request !== requestId) return
      const structuredFallback = formatPromptModeStructuredDraft({
        sourcePrompt: state.sourcePrompt,
        planningGoal: state.planningGoal,
        refinedPrompt: localFallback,
        localAnalysis: effectiveLocalAnalysis,
        answeredPath,
        constraints: (state.planningAttempt.intent.constraints ?? []).map((item) => item.trim()).filter(Boolean)
      })
      patch({
        promptDraft: structuredFallback,
        promptReady: true,
        isGeneratingPrompt: false
      })
      console.debug("[NoRetry][ReviewPromptMode]", "prompt ready from fallback", {
        sessionKey: state.sessionKey,
        promptLength: structuredFallback.length
      })
    }
  }

  function reset() {
    requestId += 1
    emit(buildInitialState())
  }

  function getState() {
    return state
  }

  return {
    open,
    getState,
    reset,
    setActiveQuestionIndex,
    setAnswer,
    setOtherAnswer,
    advanceOther,
    generatePrompt
  }
}
