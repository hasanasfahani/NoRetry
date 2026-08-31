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
  findNextUnansweredQuestionIndexInHistory,
  mergeUniqueQuestions,
  prunePlannerBranch,
  resolvePlannerAnswer,
  shouldRebuildPlannerBranch
} from "../../core/after-orchestration"
import type { ImportedProjectContextRecord } from "../../core/project-context"
import type { ReviewPromptModeState } from "../types"
import {
  buildPromptModePromptContract,
  buildPromptModePromptPlan,
  buildPromptModeFallbackQuestions,
  buildPromptModeRequestBrief,
  buildPromptModeQuestionRequest,
  buildPromptModeSeedAnalysis,
  buildPromptModeSessionKey,
  selectPromptModeQuestions
} from "../services/review-prompt-mode"
import { normalizeGoalContract } from "../../goal/goal-normalizer"
import type { StructuredProjectMemory } from "../../session/project-memory"
import type { ProjectSettingsRecord } from "../../session/project-settings"

type PromptModeOpenInput = {
  promptText: string
  beforeIntent: AnalyzePromptResponse["intent"] | null | undefined
}

type CreateReviewPromptModeOrchestratorInput = {
  getPlatform: () => Attempt["platform"]
  getSurface: () => PromptSurface
  getSessionSummary: () => Partial<SessionSummary> | null
  getProjectMemoryContext: () => {
    projectContext: string
    currentState: string
    importedContext?: ImportedProjectContextRecord | null
    structuredMemory?: StructuredProjectMemory | null
    settings?: ProjectSettingsRecord | null
  }
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
    nextMoveInitialChoice: null,
    planningGoal: "",
    requestBrief: null,
    goalContract: null,
    promptContract: null,
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
    branchReadyToGenerate: false,
    branchStatusMessage: null,
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

function findNextExistingQuestionState(params: {
  questionHistory: ClarificationQuestion[]
  questionLevels: Record<string, number>
  startIndex: number
  answerState: Record<string, string | string[]>
  otherAnswerState: Record<string, string>
  otherOption: string
}) {
  const nextHistoryIndex = findNextUnansweredQuestionIndexInHistory({
    questionHistory: params.questionHistory,
    startIndex: params.startIndex,
    answerState: params.answerState,
    otherAnswerState: params.otherAnswerState,
    otherOption: params.otherOption
  })

  if (nextHistoryIndex < 0) return null

  const nextHistoryQuestion = params.questionHistory[nextHistoryIndex]
  const nextLevel = nextHistoryQuestion ? params.questionLevels[nextHistoryQuestion.id] ?? 1 : 1
  const currentLevelQuestions = params.questionHistory.filter((question) => (params.questionLevels[question.id] ?? 1) === nextLevel)

  return {
    currentLevel: nextLevel,
    currentLevelQuestions,
    activeQuestionIndex: nextHistoryIndex
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
    requestBrief?: ReviewPromptModeState["requestBrief"]
    goalContract?: ReviewPromptModeState["goalContract"]
    importedContext?: ImportedProjectContextRecord | null
    structuredMemory?: StructuredProjectMemory | null
    settings?: ProjectSettingsRecord | null
    projectContext?: string
    currentState?: string
    existingQuestions: ClarificationQuestion[]
    answerState: Record<string, string | string[]>
    otherAnswerState: Record<string, string>
  }) {
    return input.extendQuestions(
      buildPromptModeQuestionRequest({
        promptText: params.promptText,
        localAnalysis: params.localAnalysis,
        requestBrief: params.requestBrief ?? null,
        goalContract: params.goalContract ?? null,
        importedContext: params.importedContext ?? null,
        settings: params.settings ?? null,
        structuredMemory: params.structuredMemory ?? null,
        projectContext: params.projectContext ?? "",
        currentState: params.currentState ?? "",
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
        errorMessage: "Type a prompt first so reeva AI can shape the next-step questions."
      })
      return
    }

    const sessionKey = buildPromptModeSessionKey(promptText)
    if (state.sessionKey === sessionKey && state.popupState !== "idle") {
      patch({ popupState: "questions", errorMessage: null })
      return
    }

    const request = ++requestId
    console.debug("[reeva AI][ReviewPromptMode]", "open", {
      promptLength: promptText.length
    })
    const memoryContext = input.getProjectMemoryContext()
    const seed = buildPromptModeSeedAnalysis({
      promptText,
      platform: input.getPlatform(),
      beforeIntent: params.beforeIntent,
      sessionSummary: input.getSessionSummary()
    })
    const goalContract = normalizeGoalContract({
      promptText,
      taskFamily: mapTaskTypeToPromptIntent(seed.planningAttempt.intent.task_type).toLowerCase()
    })
    const requestBrief = buildPromptModeRequestBrief({
      sourcePrompt: promptText,
      localAnalysis: seed.localAnalysis,
      goalContract,
      importedContext: memoryContext.importedContext ?? null,
      settings: memoryContext.settings ?? null,
      structuredMemory: memoryContext.structuredMemory ?? null,
      projectContext: memoryContext.projectContext,
      currentState: memoryContext.currentState,
      constraints: (seed.planningAttempt.intent.constraints ?? []).map((item) => item.trim()).filter(Boolean)
    })

    emit({
      ...buildInitialState(),
      popupState: "loading",
      sessionKey,
      sourcePrompt: promptText,
      planningGoal: promptText,
      requestBrief,
      goalContract,
      planningAttempt: seed.planningAttempt,
      analysisSeed: seed.seedAnalysis,
      localAnalysis: seed.localAnalysis,
      isLoadingQuestions: true
    })

    try {
      const result = await requestNextQuestions({
        promptText,
        localAnalysis: seed.localAnalysis,
        requestBrief,
        goalContract,
        importedContext: memoryContext.importedContext ?? null,
        settings: memoryContext.settings ?? null,
        structuredMemory: memoryContext.structuredMemory ?? null,
        projectContext: memoryContext.projectContext,
        currentState: memoryContext.currentState,
        existingQuestions: [],
        answerState: {},
        otherAnswerState: {}
      })

      if (request !== requestId) return

      const returnedQuestions = getReturnedQuestions(result)
      const selectedQuestions = selectPromptModeQuestions({
        goalContract,
        requestBrief,
        localAnalysis: seed.localAnalysis,
        questions: returnedQuestions,
        promptText,
        importedContext: memoryContext.importedContext ?? null,
        settings: memoryContext.settings ?? null,
        structuredMemory: memoryContext.structuredMemory ?? null,
        projectContext: memoryContext.projectContext,
        currentState: memoryContext.currentState,
        existingQuestions: [],
        answerState: {},
        otherAnswerState: {}
      })
      const nextState = buildInitialPlannerState(selectedQuestions, 1)

      emit({
        ...buildInitialState(),
        popupState: "questions",
        sessionKey,
        sourcePrompt: promptText,
        planningGoal: promptText,
        requestBrief,
        goalContract,
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
      console.debug("[reeva AI][ReviewPromptMode]", "first question level ready", {
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
        requestBrief,
        goalContract,
        planningAttempt: seed.planningAttempt,
        analysisSeed: seed.seedAnalysis,
        localAnalysis: seed.localAnalysis,
        errorMessage: error instanceof Error ? error.message : "reeva AI couldn't start the next-move guide safely."
      })
    }
  }

  function setActiveQuestionIndex(index: number) {
    patch({
      activeQuestionIndex: Math.max(0, Math.min(index, state.questionHistory.length - 1))
    })
  }

  function setOtherAnswer(question: ClarificationQuestion, value: string) {
    const nextOtherAnswerState = {
      ...state.otherAnswerState,
      [question.id]: value
    }
    const requestBrief =
      state.localAnalysis && state.sourcePrompt
        ? buildPromptModeRequestBrief({
            sourcePrompt: state.sourcePrompt,
            localAnalysis: state.localAnalysis,
            goalContract: state.goalContract,
            importedContext: input.getProjectMemoryContext().importedContext ?? null,
            settings: input.getProjectMemoryContext().settings ?? null,
            structuredMemory: input.getProjectMemoryContext().structuredMemory ?? null,
            projectContext: input.getProjectMemoryContext().projectContext,
            currentState: input.getProjectMemoryContext().currentState,
            answeredPath: buildOrderedAnsweredPath({
              questionHistory: state.questionHistory,
              answerState: state.answerState,
              otherAnswerState: nextOtherAnswerState,
              otherOption: OTHER_OPTION
            }),
            constraints: (state.planningAttempt?.intent.constraints ?? []).map((item) => item.trim()).filter(Boolean)
          })
        : state.requestBrief
    patch({
      otherAnswerState: nextOtherAnswerState,
      requestBrief,
      promptReady: false
      ,
      branchReadyToGenerate: false,
      branchStatusMessage: null
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

    const answeredPath = buildOrderedAnsweredPath({
      questionHistory: pruned.keptHistory,
      answerState: pruned.answerState,
      otherAnswerState: pruned.otherAnswerState,
      otherOption: OTHER_OPTION
    })
    const requestBrief =
      state.localAnalysis && state.sourcePrompt
        ? buildPromptModeRequestBrief({
            sourcePrompt: state.sourcePrompt,
            localAnalysis: state.localAnalysis,
            goalContract: state.goalContract,
            importedContext: input.getProjectMemoryContext().importedContext ?? null,
            settings: input.getProjectMemoryContext().settings ?? null,
            structuredMemory: input.getProjectMemoryContext().structuredMemory ?? null,
            projectContext: input.getProjectMemoryContext().projectContext,
            currentState: input.getProjectMemoryContext().currentState,
            answeredPath,
            constraints: (state.planningAttempt?.intent.constraints ?? []).map((item) => item.trim()).filter(Boolean)
          })
        : state.requestBrief

    emit({
      ...state,
      questionHistory: pruned.keptHistory,
      currentLevelQuestions: pruned.currentLevelQuestions,
      currentLevel: pruned.activeLevel,
      answerState: pruned.answerState,
      otherAnswerState: pruned.otherAnswerState,
      questionLevels: pruned.questionLevels,
      activeQuestionIndex: pruned.activeQuestionIndex,
      requestBrief,
      promptContract: null,
      promptDraft: "",
      promptReady: false,
      isLoadingQuestions: false,
      branchReadyToGenerate: false,
      branchStatusMessage: null,
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

    const answeredQuestionsForBrief =
      advance.kind === "advance_local"
        ? mergeUniqueQuestions(visibleHistory, visibleLevelQuestions)
        : advance.askedQuestions

    const nextRequestBrief = buildPromptModeRequestBrief({
      sourcePrompt: state.sourcePrompt,
      localAnalysis: state.localAnalysis,
      goalContract: state.goalContract,
      importedContext: input.getProjectMemoryContext().importedContext ?? null,
      settings: input.getProjectMemoryContext().settings ?? null,
      structuredMemory: input.getProjectMemoryContext().structuredMemory ?? null,
      projectContext: input.getProjectMemoryContext().projectContext,
      currentState: input.getProjectMemoryContext().currentState,
      answeredPath: buildOrderedAnsweredPath({
        questionHistory: answeredQuestionsForBrief,
        answerState: advance.mergedAnswers,
        otherAnswerState: state.otherAnswerState,
        otherOption: OTHER_OPTION
      }),
      constraints: (state.planningAttempt.intent.constraints ?? []).map((item) => item.trim()).filter(Boolean)
    })

    patch({
      answerState: advance.mergedAnswers,
      requestBrief: nextRequestBrief,
      promptReady: false,
      promptContract: null,
      promptDraft: "",
      branchReadyToGenerate: false,
      branchStatusMessage: null
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
          ,
          branchReadyToGenerate: false,
          branchStatusMessage: null
      })
      return
    }

    const currentHistoryIndex = state.questionHistory.findIndex((question) => question.id === questionId)
    const nextHistoryIndex = findNextUnansweredQuestionIndexInHistory({
      questionHistory: state.questionHistory,
      startIndex: currentHistoryIndex,
      answerState: advance.mergedAnswers,
      otherAnswerState: state.otherAnswerState,
      otherOption: OTHER_OPTION
    })

    if (nextHistoryIndex >= 0) {
      const nextHistoryQuestion = state.questionHistory[nextHistoryIndex]
      const nextLevel = nextHistoryQuestion ? state.questionLevels[nextHistoryQuestion.id] ?? state.currentLevel : state.currentLevel
      patch({
        answerState: advance.mergedAnswers,
        currentLevelQuestions: state.questionHistory.filter((question) => (state.questionLevels[question.id] ?? 1) === nextLevel),
        currentLevel: nextLevel,
        activeQuestionIndex: nextHistoryIndex,
        isLoadingQuestions: false,
        branchReadyToGenerate: false,
        branchStatusMessage: null
      })
      return
    }

    const request = ++requestId
    patch({ isLoadingQuestions: true })
    console.debug("[reeva AI][ReviewPromptMode]", "requesting deeper branch", {
      sessionKey: state.sessionKey,
      questionId,
      currentLevel: advance.currentLevel,
      answeredCount: Object.keys(advance.normalizedAnswers).length
    })

    try {
      const memoryContext = input.getProjectMemoryContext()
      const result = await requestNextQuestions({
        promptText: state.sourcePrompt,
        localAnalysis: state.localAnalysis,
        requestBrief: nextRequestBrief,
        goalContract: state.goalContract,
        importedContext: memoryContext.importedContext ?? null,
        settings: memoryContext.settings ?? null,
        structuredMemory: memoryContext.structuredMemory ?? null,
        projectContext: memoryContext.projectContext,
        currentState: memoryContext.currentState,
        existingQuestions: advance.askedQuestions,
        answerState: advance.mergedAnswers,
        otherAnswerState: state.otherAnswerState
      })
      if (request !== requestId) return

      const returnedQuestions = getReturnedQuestions(result)
      const selectedQuestions = selectPromptModeQuestions({
        goalContract: state.goalContract,
        requestBrief: nextRequestBrief,
        localAnalysis: state.localAnalysis,
        questions: returnedQuestions,
        promptText: state.sourcePrompt,
        importedContext: memoryContext.importedContext ?? null,
        settings: memoryContext.settings ?? null,
        structuredMemory: memoryContext.structuredMemory ?? null,
        projectContext: memoryContext.projectContext,
        currentState: memoryContext.currentState,
        existingQuestions: advance.askedQuestions,
        answerState: advance.mergedAnswers,
        otherAnswerState: state.otherAnswerState
      })
      const fallbackQuestions = selectedQuestions.length
        ? []
        : buildPromptModeFallbackQuestions({
            promptText: state.sourcePrompt,
            localAnalysis: state.localAnalysis,
            goalContract: state.goalContract,
            requestBrief: nextRequestBrief,
            importedContext: memoryContext.importedContext ?? null,
            settings: memoryContext.settings ?? null,
            structuredMemory: memoryContext.structuredMemory ?? null,
            projectContext: memoryContext.projectContext,
            currentState: memoryContext.currentState,
            existingQuestions: advance.askedQuestions
          }).questionHistory
      const nextQuestions = selectedQuestions.length ? selectedQuestions : fallbackQuestions

      if (nextQuestions.length) {
        const nextLevel = Math.max(advance.currentLevel + 1, state.currentLevel + 1)
        patch({
          questionHistory: mergeUniqueQuestions(state.questionHistory, nextQuestions),
          currentLevelQuestions: nextQuestions,
          questionLevels: {
            ...state.questionLevels,
            ...buildLevelMap(nextQuestions, nextLevel)
          },
          currentLevel: nextLevel,
          activeQuestionIndex: advance.askedQuestions.length,
          isLoadingQuestions: false,
          branchReadyToGenerate: false,
          branchStatusMessage: null
        })
        console.debug("[reeva AI][ReviewPromptMode]", "branch advanced", {
          sessionKey: state.sessionKey,
          nextLevel,
          questionCount: nextQuestions.length,
          source: selectedQuestions.length ? "ai" : "fallback"
        })
        return
      }

      patch({
        activeQuestionIndex: findHistoryIndexForQuestion({
          questionId,
          history: visibleHistory,
          fallbackIndex: Math.min(state.activeQuestionIndex, Math.max(0, visibleLevelQuestions.length - 1))
        }),
        isLoadingQuestions: false,
        branchReadyToGenerate: true,
        branchStatusMessage: "reeva AI has enough context from this branch. The Generate Next Move prompt button is ready below."
      })
    } catch {
      if (request !== requestId) return
      patch({
        isLoadingQuestions: false
      })
    }
  }

  function setAnswerDraft(question: ClarificationQuestion, value: string | string[]) {
    const nextAnswerState = {
      ...state.answerState,
      [question.id]: value
    }
    const requestBrief =
      state.localAnalysis
        ? buildPromptModeRequestBrief({
            sourcePrompt: state.sourcePrompt,
            localAnalysis: state.localAnalysis,
            goalContract: state.goalContract,
            importedContext: input.getProjectMemoryContext().importedContext ?? null,
            settings: input.getProjectMemoryContext().settings ?? null,
            structuredMemory: input.getProjectMemoryContext().structuredMemory ?? null,
            projectContext: input.getProjectMemoryContext().projectContext,
            currentState: input.getProjectMemoryContext().currentState,
            answeredPath: buildOrderedAnsweredPath({
              questionHistory: state.questionHistory,
              answerState: nextAnswerState,
              otherAnswerState: state.otherAnswerState,
              otherOption: OTHER_OPTION
            }),
            constraints: (state.planningAttempt?.intent.constraints ?? []).map((item) => item.trim()).filter(Boolean)
          })
        : state.requestBrief
    patch({
      answerState: nextAnswerState,
      requestBrief,
      promptReady: false,
      promptDraft: "",
      branchReadyToGenerate: false,
      branchStatusMessage: null
    })
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

    setAnswerDraft(question, value)

    if (value !== OTHER_OPTION) {
      const questionIndex = state.questionHistory.findIndex((item) => item.id === question.id)
      const optimisticAnswerState = {
        ...state.answerState,
        [question.id]: nextResolvedValue
      }
      const nextExisting = findNextExistingQuestionState({
        questionHistory: state.questionHistory,
        questionLevels: state.questionLevels,
        startIndex: questionIndex,
        answerState: optimisticAnswerState,
        otherAnswerState: state.otherAnswerState,
        otherOption: OTHER_OPTION
      })

      if (nextExisting) {
        patch({
          currentLevel: nextExisting.currentLevel,
          currentLevelQuestions: nextExisting.currentLevelQuestions,
          activeQuestionIndex: nextExisting.activeQuestionIndex
        })
      }
    }

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

    const rawValue = state.answerState[activeQuestion.id]
    const typedOther = state.otherAnswerState[activeQuestion.id]?.trim()
    const resolvedSelection = resolvePlannerAnswer(rawValue, state.otherAnswerState[activeQuestion.id], OTHER_OPTION)

    if (Array.isArray(rawValue) && !rawValue.includes(OTHER_OPTION)) {
      if (!resolvedSelection) return
    } else if (!typedOther) {
      return
    }

    const branchContext = buildPlannerBranchContext({
      questionId: activeQuestion.id,
      questionHistory: state.questionHistory,
      questionLevels: state.questionLevels
    })

    const previousResolvedValue = resolvePlannerAnswer(rawValue, state.otherAnswerState[activeQuestion.id], OTHER_OPTION)
    const nextResolvedValue = Array.isArray(rawValue) && !rawValue.includes(OTHER_OPTION) ? resolvedSelection : typedOther

    const currentQuestionIndex = state.questionHistory.findIndex((item) => item.id === activeQuestion.id)
    const optimisticAnswerState = {
      ...state.answerState,
      [activeQuestion.id]: nextResolvedValue
    }
    const nextExisting = findNextExistingQuestionState({
      questionHistory: state.questionHistory,
      questionLevels: state.questionLevels,
      startIndex: currentQuestionIndex,
      answerState: optimisticAnswerState,
      otherAnswerState: state.otherAnswerState,
      otherOption: OTHER_OPTION
    })

    if (nextExisting) {
      patch({
        currentLevel: nextExisting.currentLevel,
        currentLevelQuestions: nextExisting.currentLevelQuestions,
        activeQuestionIndex: nextExisting.activeQuestionIndex
      })
    }

    if (
      shouldRebuildPlannerBranch({
        questionIndex: branchContext.questionIndex,
        totalQuestions: state.questionHistory.length,
        previousResolvedValue,
        nextResolvedValue
      })
    ) {
      pruneFromIndex(branchContext.questionIndex)
      await advanceDecisionTree(activeQuestion.id, nextResolvedValue, {
        history: branchContext.keptHistory,
        currentLevelQuestions: branchContext.keptLevelQuestions,
        currentLevel: branchContext.activeLevel
      })
      return
    }

    await advanceDecisionTree(activeQuestion.id, nextResolvedValue)
  }

  async function generatePrompt() {
    if (!state.planningAttempt || !state.analysisSeed || !state.planningGoal.trim()) return

    const request = ++requestId
    console.debug("[reeva AI][ReviewPromptMode]", "generate prompt", {
      sessionKey: state.sessionKey,
      answeredCount: Object.keys(state.answerState).length
    })
    patch({
      isGeneratingPrompt: true,
      promptReady: false,
      branchReadyToGenerate: false,
      branchStatusMessage: null
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
      requestBrief: state.requestBrief,
      localAnalysis: effectiveLocalAnalysis,
      answeredPath,
      constraints: (state.planningAttempt.intent.constraints ?? []).map((item) => item.trim()).filter(Boolean),
      importedContext: memory.importedContext ?? null,
      settings: memory.settings ?? null,
      projectContext: memory.projectContext,
      currentState: memory.currentState,
      structuredMemory: memory.structuredMemory ?? null
    })

    try {
      const result = await input.refinePrompt({
        prompt: basePrompt,
        surface: input.getSurface(),
        intent: mapTaskTypeToPromptIntent(state.planningAttempt.intent.task_type),
        answers,
        sessionSummary: input.getSessionSummary() ?? undefined
      })

      const promptContract = buildPromptModePromptContract({
        sourcePrompt: state.sourcePrompt,
        planningGoal: state.planningGoal,
        requestBrief: state.requestBrief,
        refinedPrompt: result.improved_prompt,
        localAnalysis: effectiveLocalAnalysis,
        answeredPath,
        importedContext: memory.importedContext ?? null,
        settings: memory.settings ?? null,
        projectContext: memory.projectContext,
        currentState: memory.currentState,
        structuredMemory: memory.structuredMemory ?? null,
        constraints: (state.planningAttempt.intent.constraints ?? []).map((item) => item.trim()).filter(Boolean)
      })
      const structuredPrompt = promptContract.renderedPrompt

      if (request !== requestId) return
      patch({
        goalContract: promptContract.goalContract,
        promptContract,
        promptDraft: structuredPrompt,
        promptReady: true,
        isGeneratingPrompt: false,
        branchReadyToGenerate: false,
        branchStatusMessage: null
      })
      console.debug("[reeva AI][ReviewPromptMode]", "prompt ready", {
        sessionKey: state.sessionKey,
        promptLength: structuredPrompt.length
      })
    } catch {
      if (request !== requestId) return
      const promptContract = buildPromptModePromptContract({
        sourcePrompt: state.sourcePrompt,
        planningGoal: state.planningGoal,
        requestBrief: state.requestBrief,
        refinedPrompt: localFallback,
        localAnalysis: effectiveLocalAnalysis,
        answeredPath,
        importedContext: memory.importedContext ?? null,
        settings: memory.settings ?? null,
        projectContext: memory.projectContext,
        currentState: memory.currentState,
        structuredMemory: memory.structuredMemory ?? null,
        constraints: (state.planningAttempt.intent.constraints ?? []).map((item) => item.trim()).filter(Boolean)
      })
      const structuredFallback = promptContract.renderedPrompt
      patch({
        goalContract: promptContract.goalContract,
        promptContract,
        promptDraft: structuredFallback,
        promptReady: true,
        isGeneratingPrompt: false,
        branchReadyToGenerate: false,
        branchStatusMessage: null
      })
      console.debug("[reeva AI][ReviewPromptMode]", "prompt ready from fallback", {
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
    setAnswerDraft,
    setAnswer,
    setOtherAnswer,
    advanceOther,
    generatePrompt
  }
}
