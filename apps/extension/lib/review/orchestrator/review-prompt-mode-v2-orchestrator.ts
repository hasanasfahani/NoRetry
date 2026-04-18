import type {
  AnalyzePromptResponse,
  ClarificationQuestion,
  ExtendQuestionsResponse,
  PromptSurface,
  SessionSummary
} from "@prompt-optimizer/shared/src/schemas"
import {
  buildInitialPlannerState,
  buildLevelMap,
  buildPlannerAdvanceResult,
  buildPlannerBranchContext,
  mergeUniqueQuestions,
  prunePlannerBranch,
  resolvePlannerAnswer,
  shouldRebuildPlannerBranch
} from "../../core/after-orchestration"
import type { ReviewPromptModeV2Question, ReviewPromptModeV2State } from "../types"
import {
  assessPromptModeV2Intent,
  buildPromptModeV2NextQuestion,
  initializePromptModeV2Sections,
  updatePromptModeV2Sections
} from "../v2/prompt-mode-v2-service"
import { assemblePromptModeV2Prompt } from "../v2/prompt-mode-v2-assembly"
import { computePromptModeV2ProgressState } from "../v2/prompt-mode-v2-progress"
import { resolvePromptModeV2TemplateKind, type ReviewPromptModeV2RequestType } from "../v2/request-types"
import { buildPromptModeQuestionRequest, selectPromptModeQuestions } from "../services/review-prompt-mode"
import { mapLegacyQuestionToPromptModeV2 } from "../v2/legacy-question-mapper"

type PromptModeV2OpenInput = {
  promptText: string
  beforeIntent: AnalyzePromptResponse["intent"] | null | undefined
}

type CreateReviewPromptModeV2OrchestratorInput = {
  getSurface?: () => PromptSurface
  getSessionSummary?: () => Partial<SessionSummary> | null
  extendQuestions?: (input: ReturnType<typeof buildPromptModeQuestionRequest>) => Promise<ExtendQuestionsResponse>
  onStateChange: (state: ReviewPromptModeV2State) => void
}

const OTHER_OPTION = "Other"

function buildInitialState(): ReviewPromptModeV2State {
  return {
    popupState: "idle",
    sessionKey: null,
    sourcePrompt: "",
    goalContract: null,
    localAnalysis: null,
    intentConfidence: "medium",
    likelyTaskTypes: [],
    selectedTaskType: null,
    selectedTemplateKind: null,
    clarifyingQuestion: null,
    clarifyingAnswer: "",
    sections: [],
    additionalNotes: [],
    isGeneratingPrompt: false,
    promptDraft: "",
    promptReady: false,
    validation: null,
    progress: null,
    assemblyErrorMessage: null,
    questionHistory: [],
    activeQuestionIndex: 0,
    answerState: {},
    otherAnswerState: {},
    errorMessage: null
  }
}

function buildSessionKey(promptText: string) {
  return promptText.replace(/\s+/g, " ").trim().toLowerCase()
}

function buildClarifiedPromptText(sourcePrompt: string, clarifyingAnswer: string) {
  const trimmedAnswer = clarifyingAnswer.trim()
  if (!trimmedAnswer) return sourcePrompt
  return `${sourcePrompt}\n\nClarification: ${trimmedAnswer}`
}

function resolveQuestionValue(answerValue: string | string[] | undefined, otherValue: string | undefined) {
  if (Array.isArray(answerValue)) {
    const withOther = answerValue.includes(OTHER_OPTION) ? [...answerValue.filter((item) => item !== OTHER_OPTION), otherValue?.trim() ?? ""] : answerValue
    return withOther.map((item) => item.trim()).filter(Boolean)
  }
  if (answerValue === OTHER_OPTION) {
    return otherValue?.trim() ?? ""
  }
  return answerValue?.trim() ?? ""
}

export function createReviewPromptModeV2Orchestrator(input: CreateReviewPromptModeV2OrchestratorInput) {
  let state = buildInitialState()
  let rawQuestionHistory: ClarificationQuestion[] = []
  let rawQuestionLevels: Record<string, number> = {}
  let rawCurrentLevelQuestions: ClarificationQuestion[] = []
  let rawCurrentLevel = 1
  let rawAnswerState: Record<string, string> = {}

  function emit(next: ReviewPromptModeV2State) {
    const nextWithProgress = {
      ...next,
      progress:
        next.selectedTaskType && next.sections.length
          ? computePromptModeV2ProgressState({
              sections: next.sections,
              questionHistoryLength: next.questionHistory.length,
              validation: next.validation,
              promptReady: next.promptReady
            })
          : null
    }
    state = nextWithProgress
    input.onStateChange(nextWithProgress)
  }

  function patch(next: Partial<ReviewPromptModeV2State>) {
    emit({
      ...state,
      ...next
    })
  }

  function resetLegacyTree() {
    rawQuestionHistory = []
    rawQuestionLevels = {}
    rawCurrentLevelQuestions = []
    rawCurrentLevel = 1
    rawAnswerState = {}
  }

  function getReturnedQuestions(result: ExtendQuestionsResponse | null | undefined) {
    return result?.clarification_questions ?? []
  }

  function findHistoryIndexForQuestion(questionId: string, history: ClarificationQuestion[], fallbackIndex: number) {
    const historyIndex = history.findIndex((item) => item.id === questionId)
    return historyIndex >= 0 ? historyIndex : fallbackIndex
  }

  function mapRawQuestionsToV2(
    questions: ClarificationQuestion[],
    templateKind: ReturnType<typeof resolvePromptModeV2TemplateKind>,
    sections: ReviewPromptModeV2State["sections"],
    sourcePrompt: string,
    goalContract: ReviewPromptModeV2State["goalContract"]
  ) {
    return questions.map((question) =>
      mapLegacyQuestionToPromptModeV2({
        question,
        templateKind,
        sections,
        promptText: sourcePrompt,
        goalContract
      })
    )
  }

  async function requestLegacyQuestions(params: {
    promptText: string
    localAnalysis: AnalyzePromptResponse
    goalContract: ReviewPromptModeV2State["goalContract"]
    existingQuestions: ClarificationQuestion[]
    answerState: Record<string, string>
  }) {
    if (!input.extendQuestions || !input.getSurface) return null

    const result = await input.extendQuestions(
      buildPromptModeQuestionRequest({
        promptText: params.promptText,
        localAnalysis: params.localAnalysis,
        existingQuestions: params.existingQuestions,
        answerState: params.answerState,
        otherAnswerState: {},
        surface: input.getSurface(),
        sessionSummary: input.getSessionSummary?.() ?? null
      })
    )

    return selectPromptModeQuestions({
      goalContract: params.goalContract,
      localAnalysis: params.localAnalysis,
      questions: getReturnedQuestions(result),
      promptText: params.promptText
    })
  }

  function syncNextQuestion(nextState: ReviewPromptModeV2State) {
    if (input.extendQuestions && input.getSurface && nextState.localAnalysis) {
      return nextState
    }
    if (!nextState.selectedTaskType) return nextState
    const nextQuestion = buildPromptModeV2NextQuestion({
      taskType: nextState.selectedTaskType,
      promptText: nextState.sourcePrompt,
      goalContract: nextState.goalContract,
      sections: nextState.sections,
      additionalNotes: nextState.additionalNotes,
      state: nextState
    })

    if (!nextQuestion) {
      return {
        ...nextState,
        popupState: "questions",
        questionHistory: nextState.questionHistory,
        activeQuestionIndex: nextState.questionHistory.length
      }
    }

    const exists = nextState.questionHistory.some((question) => question.id === nextQuestion.id)
    const nextHistory = exists ? nextState.questionHistory : [...nextState.questionHistory, nextQuestion]
    const nextIndex = nextHistory.findIndex((question) => question.id === nextQuestion.id)
    return {
      ...nextState,
      popupState: "questions",
      questionHistory: nextHistory,
      activeQuestionIndex: nextIndex >= 0 ? nextIndex : 0
    }
  }

  function emitLegacyQuestions(nextState: ReviewPromptModeV2State, params?: { activeQuestionId?: string; fallbackIndex?: number }) {
    const templateKind = nextState.selectedTemplateKind ?? resolvePromptModeV2TemplateKind(nextState.selectedTaskType)
    const mappedHistory = mapRawQuestionsToV2(rawQuestionHistory, templateKind, nextState.sections, nextState.sourcePrompt, nextState.goalContract)
    const activeQuestionIndex = params?.activeQuestionId
      ? findHistoryIndexForQuestion(params.activeQuestionId, rawQuestionHistory, params.fallbackIndex ?? 0)
      : Math.max(0, Math.min(nextState.activeQuestionIndex, Math.max(0, mappedHistory.length - 1)))

    emit({
      ...nextState,
      popupState: "questions",
      questionHistory: mappedHistory,
      activeQuestionIndex
    })
  }

  async function loadInitialLegacyQuestions(nextState: ReviewPromptModeV2State) {
    if (!nextState.selectedTaskType || !nextState.localAnalysis) {
      emit(syncNextQuestion(nextState))
      return
    }

    if (!input.extendQuestions || !input.getSurface) {
      emit(syncNextQuestion(nextState))
      return
    }

    const selectedQuestions = await requestLegacyQuestions({
      promptText: nextState.sourcePrompt,
      localAnalysis: nextState.localAnalysis,
      goalContract: nextState.goalContract,
      existingQuestions: [],
      answerState: {}
    })

    const plannerState = buildInitialPlannerState(selectedQuestions ?? [], 1)
    rawQuestionHistory = plannerState.questionHistory
    rawQuestionLevels = plannerState.questionLevels
    rawCurrentLevelQuestions = plannerState.currentLevelQuestions
    rawCurrentLevel = plannerState.currentLevel
    rawAnswerState = {}

    emitLegacyQuestions(
      selectedQuestions?.length
        ? {
            ...nextState,
            popupState: "questions",
            questionHistory: [],
            activeQuestionIndex: 0
          }
        : syncNextQuestion(nextState)
    )
  }

  function normalizeLegacyAnswerValue(value: string | string[]) {
    return Array.isArray(value) ? value.join("; ").trim() : value.trim()
  }

  function pruneLegacyBranch(startIndex: number, nextState: ReviewPromptModeV2State) {
    const pruned = prunePlannerBranch({
      startIndex,
      questionHistory: rawQuestionHistory,
      questionLevels: rawQuestionLevels,
      answerState: rawAnswerState,
      otherAnswerState: {}
    })

    rawQuestionHistory = pruned.keptHistory
    rawQuestionLevels = pruned.questionLevels
    rawCurrentLevelQuestions = pruned.currentLevelQuestions
    rawCurrentLevel = pruned.activeLevel
    rawAnswerState = Object.fromEntries(
      Object.entries(rawAnswerState).filter(([questionId]) => rawQuestionHistory.some((item) => item.id === questionId))
    )

    emitLegacyQuestions(
      {
        ...nextState,
        questionHistory: [],
        activeQuestionIndex: pruned.activeQuestionIndex
      },
      {
        activeQuestionId: rawQuestionHistory[pruned.activeQuestionIndex]?.id,
        fallbackIndex: pruned.activeQuestionIndex
      }
    )
  }

  async function advanceLegacyDecisionTree(
    questionId: string,
    resolvedValue: string,
    nextState: ReviewPromptModeV2State,
    branchContext?: {
      history: ClarificationQuestion[]
      currentLevelQuestions: ClarificationQuestion[]
      currentLevel: number
    }
  ) {
    if (!nextState.localAnalysis || !nextState.selectedTaskType) {
      emit(syncNextQuestion(nextState))
      return
    }

    if (!input.extendQuestions || !input.getSurface) {
      emit(syncNextQuestion(nextState))
      return
    }

    const visibleLevelQuestions = branchContext?.currentLevelQuestions ?? rawCurrentLevelQuestions
    const visibleHistory = branchContext?.history ?? rawQuestionHistory
    const visibleLevel = branchContext?.currentLevel ?? rawCurrentLevel
    const advance = buildPlannerAdvanceResult({
      questionId,
      resolvedValue,
      answerState: rawAnswerState,
      otherAnswerState: {},
      visibleLevelQuestions,
      visibleHistory,
      visibleLevel,
      questionLevels: rawQuestionLevels,
      otherOption: OTHER_OPTION
    })

    rawAnswerState = advance.mergedAnswers

    if (advance.kind === "advance_local") {
      const nextQuestion = visibleLevelQuestions[advance.nextIndex]
      emitLegacyQuestions(
        {
          ...nextState,
          questionHistory: [],
          activeQuestionIndex: advance.nextIndex
        },
        {
          activeQuestionId: nextQuestion?.id,
          fallbackIndex: advance.nextIndex
        }
      )
      return
    }

    const selectedQuestions = await requestLegacyQuestions({
      promptText: nextState.sourcePrompt,
      localAnalysis: nextState.localAnalysis,
      goalContract: nextState.goalContract,
      existingQuestions: advance.askedQuestions,
      answerState: advance.normalizedAnswers
    })

    if (selectedQuestions?.length) {
      const nextLevel = Math.max(advance.currentLevel + 1, rawCurrentLevel + 1)
      rawQuestionHistory = mergeUniqueQuestions(rawQuestionHistory, selectedQuestions)
      rawCurrentLevelQuestions = selectedQuestions
      rawQuestionLevels = {
        ...rawQuestionLevels,
        ...buildLevelMap(selectedQuestions, nextLevel)
      }
      rawCurrentLevel = nextLevel
      emitLegacyQuestions(
        {
          ...nextState,
          questionHistory: [],
          activeQuestionIndex: advance.askedQuestions.length
        },
        {
          activeQuestionId: selectedQuestions[0]?.id,
          fallbackIndex: advance.askedQuestions.length
        }
      )
      return
    }

    emitLegacyQuestions(
      {
        ...nextState,
        questionHistory: [],
        activeQuestionIndex: findHistoryIndexForQuestion(
          questionId,
          rawQuestionHistory,
          Math.min(state.activeQuestionIndex, Math.max(0, visibleLevelQuestions.length - 1))
        )
      },
      {
        activeQuestionId: questionId,
        fallbackIndex: Math.min(state.activeQuestionIndex, Math.max(0, visibleLevelQuestions.length - 1))
      }
    )
  }

  async function open(params: PromptModeV2OpenInput) {
    const promptText = params.promptText.trim()
    if (!promptText) {
      emit({
        ...buildInitialState(),
        popupState: "error",
        errorMessage: "Type a prompt first so Prompt Mode v2 can suggest the right request type."
      })
      return
    }

    emit({
      ...buildInitialState(),
      popupState: "loading",
      sourcePrompt: promptText,
      sessionKey: buildSessionKey(promptText)
    })
    resetLegacyTree()

    try {
      const assessment = assessPromptModeV2Intent({
        promptText,
        beforeIntent: params.beforeIntent
      })

      if (assessment.confidence === "low") {
        const defaultTaskType: ReviewPromptModeV2RequestType = "creation"
        const sections = initializePromptModeV2Sections({
          taskType: defaultTaskType,
          promptText,
          goalContract: assessment.goalContract
        })

        await loadInitialLegacyQuestions(
          syncNextQuestion({
            popupState: "questions",
            sessionKey: buildSessionKey(promptText),
            sourcePrompt: promptText,
            goalContract: assessment.goalContract,
            localAnalysis: assessment.localAnalysis,
            intentConfidence: assessment.confidence,
            likelyTaskTypes: assessment.likelyTaskTypes,
            selectedTaskType: defaultTaskType,
            selectedTemplateKind: resolvePromptModeV2TemplateKind(defaultTaskType),
            clarifyingQuestion: null,
            clarifyingAnswer: "",
            sections,
            additionalNotes: [],
            isGeneratingPrompt: false,
            promptDraft: "",
            promptReady: false,
            validation: null,
            progress: null,
            assemblyErrorMessage: null,
            questionHistory: [],
            activeQuestionIndex: 0,
            answerState: {},
            otherAnswerState: {},
            errorMessage: null
          })
        )
        return
      }

      emit({
        popupState: "entry",
        sessionKey: buildSessionKey(promptText),
        sourcePrompt: promptText,
        goalContract: assessment.goalContract,
        localAnalysis: assessment.localAnalysis,
        intentConfidence: assessment.confidence,
        likelyTaskTypes: assessment.likelyTaskTypes,
        selectedTaskType: null,
        selectedTemplateKind: null,
        clarifyingQuestion: assessment.clarifyingQuestion,
        clarifyingAnswer: "",
        sections: [],
        additionalNotes: [],
        isGeneratingPrompt: false,
        promptDraft: "",
        promptReady: false,
        validation: null,
        progress: null,
        assemblyErrorMessage: null,
        questionHistory: [],
        activeQuestionIndex: 0,
        answerState: {},
        otherAnswerState: {},
        errorMessage: null
      })
    } catch (error) {
      emit({
        ...buildInitialState(),
        popupState: "error",
        sourcePrompt: promptText,
        sessionKey: buildSessionKey(promptText),
        errorMessage: error instanceof Error ? error.message : "Prompt Mode v2 could not start safely."
      })
    }
  }

  function continueFromEntry() {
    if (state.popupState === "loading" || state.popupState === "error") return

    const clarifiedPromptText = buildClarifiedPromptText(state.sourcePrompt, state.clarifyingAnswer)
    const assessment = assessPromptModeV2Intent({
      promptText: clarifiedPromptText,
      beforeIntent: state.localAnalysis?.intent ?? null
    })
    const nextTaskType = state.selectedTaskType ?? assessment.likelyTaskTypes[0]?.type ?? state.likelyTaskTypes[0]?.type ?? null

    if (!nextTaskType) {
      emit({
        ...state,
        goalContract: assessment.goalContract,
        localAnalysis: assessment.localAnalysis,
        intentConfidence: assessment.confidence,
        likelyTaskTypes: assessment.likelyTaskTypes,
        clarifyingQuestion: assessment.clarifyingQuestion,
        errorMessage: "Prompt Mode v2 could not determine a safe next task type yet."
      })
      return
    }

    const sections = initializePromptModeV2Sections({
      taskType: nextTaskType,
      promptText: clarifiedPromptText,
      goalContract: assessment.goalContract
    })

    void loadInitialLegacyQuestions(
      syncNextQuestion({
        ...state,
        popupState: "questions",
        sourcePrompt: clarifiedPromptText,
        goalContract: assessment.goalContract,
        localAnalysis: assessment.localAnalysis,
        intentConfidence: assessment.confidence,
        likelyTaskTypes: assessment.likelyTaskTypes,
        selectedTaskType: nextTaskType,
        selectedTemplateKind: resolvePromptModeV2TemplateKind(nextTaskType),
        clarifyingQuestion: assessment.clarifyingQuestion,
        sections,
        additionalNotes: [],
        isGeneratingPrompt: false,
        promptDraft: "",
        promptReady: false,
        validation: null,
        progress: null,
        assemblyErrorMessage: null,
        questionHistory: [],
        activeQuestionIndex: 0,
        answerState: {},
        otherAnswerState: {},
        errorMessage: null
      })
    )
  }

  function selectTaskType(taskType: ReviewPromptModeV2RequestType) {
    const sections = initializePromptModeV2Sections({
      taskType,
      promptText: state.sourcePrompt,
      goalContract: state.goalContract
    })

    resetLegacyTree()
    void loadInitialLegacyQuestions(
      syncNextQuestion({
        ...state,
        popupState: "questions",
        selectedTaskType: taskType,
        selectedTemplateKind: resolvePromptModeV2TemplateKind(taskType),
        sections,
        additionalNotes: [],
        isGeneratingPrompt: false,
        promptDraft: "",
        promptReady: false,
        validation: null,
        progress: null,
        assemblyErrorMessage: null,
        questionHistory: [],
        activeQuestionIndex: 0,
        answerState: {},
        otherAnswerState: {}
      })
    )
  }

  function setActiveQuestionIndex(index: number) {
    patch({
      activeQuestionIndex: Math.max(0, Math.min(index, state.questionHistory.length - 1))
    })
  }

  function setOtherAnswer(question: ReviewPromptModeV2Question, value: string) {
    patch({
      otherAnswerState: {
        ...state.otherAnswerState,
        [question.id]: value
      }
    })
  }

  function setAnswerDraft(question: ReviewPromptModeV2Question, value: string | string[]) {
    patch({
      answerState: {
        ...state.answerState,
        [question.id]: value
      }
    })
  }

  function setClarifyingAnswer(value: string) {
    emit(
      syncNextQuestion({
        ...state,
        clarifyingAnswer: value
      })
    )
  }

  function setAnswer(question: ReviewPromptModeV2Question, value: string | string[]) {
    if (!state.selectedTaskType) return

    const previousValue = normalizeLegacyAnswerValue(state.answerState[question.id] ?? "")
    const nextResolvedValue = normalizeLegacyAnswerValue(value)
    const nextAnswerState = {
      ...state.answerState,
      [question.id]: value
    }
    const resolved = resolveQuestionValue(value, state.otherAnswerState[question.id])
    const mergeResult = updatePromptModeV2Sections({
      taskType: state.selectedTaskType,
      sections: state.sections,
      question,
      answerValue: resolved,
      otherValue: state.otherAnswerState[question.id],
      additionalNotes: state.additionalNotes
    })

    const nextState = syncNextQuestion({
        ...state,
        answerState: nextAnswerState,
        clarifyingAnswer:
          question.id === `pmv2:${state.selectedTaskType}:clarify` && typeof resolved === "string" ? resolved : state.clarifyingAnswer,
        sections: mergeResult.sections,
        additionalNotes: mergeResult.additionalNotes,
        promptDraft: "",
        promptReady: false,
        validation: null,
        progress: null,
        assemblyErrorMessage: null
      })

    const branchContext = buildPlannerBranchContext({
      questionId: question.id,
      questionHistory: rawQuestionHistory,
      questionLevels: rawQuestionLevels
    })

    if (
      input.extendQuestions &&
      shouldRebuildPlannerBranch({
        questionIndex: branchContext.questionIndex,
        totalQuestions: rawQuestionHistory.length,
        previousResolvedValue: previousValue,
        nextResolvedValue
      })
    ) {
      pruneLegacyBranch(branchContext.questionIndex, nextState)
      void advanceLegacyDecisionTree(question.id, nextResolvedValue, nextState, {
        history: branchContext.keptHistory,
        currentLevelQuestions: branchContext.keptLevelQuestions,
        currentLevel: branchContext.activeLevel
      })
      return
    }

    if (input.extendQuestions) {
      void advanceLegacyDecisionTree(question.id, nextResolvedValue, nextState)
      return
    }

    emit(nextState)
  }

  function continueQuestion() {
    const question = state.questionHistory[state.activeQuestionIndex]
    if (!question) return
    const value = state.answerState[question.id]

    if (question.mode === "multi") {
      if (!Array.isArray(value) || value.length === 0) return
      if (value.includes(OTHER_OPTION) && !state.otherAnswerState[question.id]?.trim()) return
      setAnswer(question, value)
      return
    }

    if (value === OTHER_OPTION) {
      if (!state.otherAnswerState[question.id]?.trim()) return
      setAnswer(question, value)
    }
  }

  function generatePrompt() {
    if (!state.selectedTaskType) return

    patch({
      isGeneratingPrompt: true,
      assemblyErrorMessage: null
    })

    try {
      const assembled = assemblePromptModeV2Prompt({
        taskType: state.selectedTaskType,
        sourcePrompt: state.sourcePrompt,
        goalContract: state.goalContract,
        sections: state.sections,
        additionalNotes: state.additionalNotes
      })

      emit({
        ...state,
        isGeneratingPrompt: false,
        promptDraft: assembled.promptDraft,
        promptReady: Boolean(assembled.promptDraft.trim()),
        validation: assembled.validation,
        progress: null,
        assemblyErrorMessage: null
      })
    } catch (error) {
      emit({
        ...state,
        isGeneratingPrompt: false,
        promptDraft: "",
        promptReady: false,
        validation: null,
        progress: null,
        assemblyErrorMessage: error instanceof Error ? error.message : "Prompt Mode v2 could not assemble the prompt safely."
      })
    }
  }

  function advanceOther() {
    continueQuestion()
  }

  return {
    open,
    continueFromEntry,
    selectTaskType,
    setActiveQuestionIndex,
    setOtherAnswer,
    setAnswerDraft,
    setClarifyingAnswer,
    setAnswer,
    continueQuestion,
    advanceOther,
    generatePrompt,
    getState: () => state
  }
}
