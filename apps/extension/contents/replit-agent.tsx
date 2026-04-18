import type { PlasmoCSConfig, PlasmoGetRootContainer } from "plasmo"
import { useEffect, useMemo, useRef, useState } from "react"
import type {
  AnalyzePromptResponse,
  AfterAnalysisResult,
  ClarificationQuestion,
  DetectOutcomeResponse,
  DiagnoseFailureResponse,
  PromptIntent,
  SessionSummary,
  Attempt
} from "@prompt-optimizer/shared/src/schemas"
import { DETECTION_THRESHOLDS } from "@prompt-optimizer/shared/src/constants"
import { analyzePromptLocally } from "@prompt-optimizer/shared/src/analyzePrompt"
import {
  mapPromptIntentToTaskType,
  preprocessResponse
} from "@prompt-optimizer/shared"
import { summarizeSessionMemory } from "@prompt-optimizer/shared/src/session"
import { AfterVerdictPanel } from "../components/AfterVerdictPanel"
import { OptimizerShell } from "../components/OptimizerShell"
import { ReviewPopupContainer } from "../components/review-popup/review/ReviewPopupContainer"
import type { ReviewPopupViewModel } from "../components/review-popup/review/review-types"
import { analyzeAfterAttempt, analyzePromptRemote, detectOutcome, diagnoseFailure, extendQuestions, generateAfterNextQuestion, refinePrompt, sendFeedback } from "../lib/api"
import { readAssistantMessageIdentity } from "../lib/after/surface"
import {
  appendPlanningDirection,
  buildAfterPlaceholder,
  buildAfterNextPromptPlan,
  buildNextPromptAnswers,
  buildAfterQuestionRequest,
  buildInitialPlannerState,
  buildPlannerBranchContext,
  buildPlannerAdvanceResult,
  buildLevelMap,
  buildPlanningAttemptFromDraft,
  buildOrderedAnsweredPath,
  buildSuggestedDirectionFallback,
  buildSuggestedDirectionRewritePrompt,
  buildSuggestedDirectionChips,
  hasRealAfterReview,
  mapTaskTypeToPromptIntent,
  mergeUniqueQuestions,
  prunePlannerBranch,
  resolvePlannerAnswer,
  shouldRebuildPlannerBranch
} from "../lib/core/after-orchestration"
import {
  buildDraftAttemptInput,
  buildFallbackSubmittedAttemptInput,
  buildPlanningAttemptIntentFromPrompt,
  buildSubmittedAttemptPatch,
  shouldReuseLatestSubmittedAttempt
} from "../lib/core/attempt-orchestration"
import {
  buildProjectHandoffMarkdown,
  buildReplitDeepContextRequestPrompt,
  parseProjectHandoffMarkdown,
  REPLIT_CONTEXT_REQUEST_PROMPT
} from "../lib/core/project-context"
import {
  buildDetectOutcomePayload,
  buildPendingPrompt,
  buildSessionAfterOutcome,
  buildSessionAfterSubmit,
  type PendingPrompt
} from "../lib/core/session-orchestration"
import { resolveSurfaceAdapter } from "../lib/surfaces/resolve-surface-adapter"
import {
  attachAnalysisResult,
  createAttempt,
  getActiveAttempt,
  getCodeAnalysisMode,
  getRecentReviewableAttempts,
  getLatestSubmittedAttempt,
  markAttemptSubmitted,
  setCodeAnalysisMode
} from "../lib/attempt-session-manager"
import {
  collectChangedFilesSummary,
  collectVisibleErrorSummary,
  collectVisibleOutputSnippet,
  findPromptInput,
  findSubmitButton,
  getPromptSurface,
  isPromptLikeElement,
  isSupportedPromptPage,
  readPromptValue,
  writePromptValue
} from "../lib/replit"
import {
  deriveProjectMemoryIdentity,
  getProjectMemory,
  getSessionSummary,
  hasSeenOnboarding,
  markOnboardingSeen,
  saveProjectMemory,
  saveSessionSummary
} from "../lib/storage"
import { createReviewPopupOrchestrator } from "../lib/review/orchestrator/review-popup-orchestrator"
import { createReviewPromptModeOrchestrator } from "../lib/review/orchestrator/review-prompt-mode-orchestrator"
import { createReviewPromptModeV2Orchestrator } from "../lib/review/orchestrator/review-prompt-mode-v2-orchestrator"
import { buildReviewLoadingViewModel } from "../lib/review/mappers/review-view-model"
import {
  createIdleReviewSignal,
  createLoadingReviewSignal,
  mapReviewResultToSignal
} from "../lib/review/mappers/review-signal"
import { normalizeGoalContract } from "../lib/goal/goal-normalizer"
import { buildPreflightAssessment } from "../lib/preflight/preflight-risk-engine"
import { mapPreflightAssessmentToTypingSignal } from "../lib/preflight/preflight-view-model"
import { createReviewAnalysisRunner } from "../lib/review/services/review-analysis"
import { buildPromptModeSessionKey } from "../lib/review/services/review-prompt-mode"
import { createReviewTargetResolver } from "../lib/review/services/review-target"
import type {
  ReviewPopupControllerState,
  ReviewPromptModeState,
  ReviewPromptModeV2Question,
  ReviewPromptModeV2State,
  ReviewPopupSurface,
  ReviewSignalState,
  ReviewTypingState
} from "../lib/review/types"

export const config: PlasmoCSConfig = {
  matches: ["https://replit.com/*", "https://www.replit.com/*", "https://chatgpt.com/*", "https://chat.openai.com/*"],
  all_frames: false
}

export const getRootContainer: PlasmoGetRootContainer = async () => {
  let host = document.getElementById("prompt-optimizer-root")
  if (!host) {
    host = document.createElement("div")
    host.id = "prompt-optimizer-root"
    document.body.appendChild(host)
  }

  return host
}

const SEND_DETECTION_DEDUPE_MS = 1200
const REVIEW_SIGNAL_SETTLE_MS = 1200

function logReviewDebug(message: string, details?: Record<string, unknown>) {
  if (details) {
    console.debug("[reeva AI][Review]", message, details)
    return
  }

  console.debug("[reeva AI][Review]", message)
}

export default function PromptOptimizerApp() {
  type PendingContextAnalysis = {
    attempt: Attempt
    responseText: string
    responseIdentity: string
    threadIdentity: string
  }

  type CachedAfterReviews = {
    threadIdentity: string
    responseIdentity: string
    normalizedText: string
    quick: AfterAnalysisResult | null
    deep: AfterAnalysisResult | null
  }

  const OTHER_OPTION = "Other"
  const [mounted, setMounted] = useState(false)
  const [inputBindingVersion, setInputBindingVersion] = useState(0)
  const [panelOpen, setPanelOpen] = useState(false)
  const [onboardingVisible, setOnboardingVisible] = useState(false)
  const [promptPreview, setPromptPreview] = useState("")
  const [beforeResult, setBeforeResult] = useState<AnalyzePromptResponse | null>(null)
  const [isAnalyzingPrompt, setIsAnalyzingPrompt] = useState(false)
  const [detection, setDetection] = useState<DetectOutcomeResponse | null>(null)
  const [diagnosis, setDiagnosis] = useState<DiagnoseFailureResponse | null>(null)
  const [session, setSession] = useState<SessionSummary | null>(null)
  const [issueVisible, setIssueVisible] = useState(false)
  const [hasSubmittedPrompt, setHasSubmittedPrompt] = useState(false)
  const [answerState, setAnswerState] = useState<Record<string, string | string[]>>({})
  const [otherAnswerState, setOtherAnswerState] = useState<Record<string, string>>({})
  const [editableDraft, setEditableDraft] = useState("")
  const [aiDraftNotes, setAiDraftNotes] = useState<string[]>([])
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false)
  const [isAddingQuestions, setIsAddingQuestions] = useState(false)
  const [draftReady, setDraftReady] = useState(false)
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(false)
  const [questionLoadError, setQuestionLoadError] = useState<string | null>(null)
  const [afterAttempt, setAfterAttempt] = useState<Attempt | null>(null)
  const [afterVerdict, setAfterVerdict] = useState<AfterAnalysisResult | null>(null)
  const [afterPanelOpen, setAfterPanelOpen] = useState(false)
  const [reviewPopupOpen, setReviewPopupOpen] = useState(false)
  const [reviewPopupSurface, setReviewPopupSurface] = useState<ReviewPopupSurface>("answer_mode")
  const [reviewSignal, setReviewSignal] = useState<ReviewSignalState>(createIdleReviewSignal())
  const [reviewTypingState, setReviewTypingState] = useState<ReviewTypingState>({
    active: false,
    promptText: "",
    sessionKey: null,
    goalContract: null,
    preflight: null
  })
  const [reviewPopupViewModel, setReviewPopupViewModel] = useState<ReviewPopupViewModel>(
    buildReviewLoadingViewModel("deep")
  )
  const [reviewPopupControllerState, setReviewPopupControllerState] = useState<ReviewPopupControllerState>({
    surface: "answer_mode",
    popupState: "idle",
    activeMode: "deep",
    targetKey: null,
    cacheStatus: "none",
    analysisStarted: false,
    analysisFinished: false,
    errorReason: null
  })
  const [reviewPromptModeState, setReviewPromptModeState] = useState<ReviewPromptModeState>({
    popupState: "idle",
    sessionKey: null,
    sourcePrompt: "",
    planningGoal: "",
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
    isGeneratingPrompt: false,
    promptDraft: "",
    promptReady: false,
    errorMessage: null
  })
  const [reviewPromptModeV2State, setReviewPromptModeV2State] = useState<ReviewPromptModeV2State>({
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
  })
  const [isEvaluatingAfterResponse, setIsEvaluatingAfterResponse] = useState(false)
  const [isDeepAnalyzingAfterResponse, setIsDeepAnalyzingAfterResponse] = useState(false)
  const [afterDisplayedReviewMode, setAfterDisplayedReviewMode] = useState<"quick" | "deep">("quick")
  const [afterLoadingProgress, setAfterLoadingProgress] = useState<{
    percent: number
    label: string
  } | null>(null)
  const [codeAnalysisMode, setCodeAnalysisModeState] = useState<"quick" | "deep">("quick")
  const [afterNextStepStarted, setAfterNextStepStarted] = useState(false)
  const [afterPlanningGoal, setAfterPlanningGoal] = useState("")
  const [activeSuggestedDirectionChipId, setActiveSuggestedDirectionChipId] = useState<string | null>(null)
  const [usedSuggestedDirectionChipIds, setUsedSuggestedDirectionChipIds] = useState<string[]>([])
  const [planningGoalNotice, setPlanningGoalNotice] = useState("")
  const [recentlyAnsweredAfterQuestionId, setRecentlyAnsweredAfterQuestionId] = useState<string | null>(null)
  const [afterQuestionHistory, setAfterQuestionHistory] = useState<ClarificationQuestion[]>([])
  const [afterQuestionLevels, setAfterQuestionLevels] = useState<Record<string, number>>({})
  const [afterQuestions, setAfterQuestions] = useState<ClarificationQuestion[]>([])
  const [afterQuestionLevel, setAfterQuestionLevel] = useState(1)
  const [afterAnswerState, setAfterAnswerState] = useState<Record<string, string>>({})
  const [afterOtherAnswerState, setAfterOtherAnswerState] = useState<Record<string, string>>({})
  const [afterActiveQuestionIndex, setAfterActiveQuestionIndex] = useState(0)
  const [isAddingAfterQuestions, setIsAddingAfterQuestions] = useState(false)
  const [isGeneratingAfterNextPrompt, setIsGeneratingAfterNextPrompt] = useState(false)
  const [afterNextPromptDraft, setAfterNextPromptDraft] = useState("")
  const [afterNextPromptReady, setAfterNextPromptReady] = useState(false)
  const [projectMemoryKey, setProjectMemoryKey] = useState("")
  const [projectMemoryLabel, setProjectMemoryLabel] = useState("")
  const [projectContextDraft, setProjectContextDraft] = useState("")
  const [currentStateDraft, setCurrentStateDraft] = useState("")
  const [projectHandoffDraft, setProjectHandoffDraft] = useState("")
  const [projectContextSetupActive, setProjectContextSetupActive] = useState(false)
  const [projectContextReadyActive, setProjectContextReadyActive] = useState(false)
  const [projectMemoryDepth, setProjectMemoryDepth] = useState<"quick" | "deep">("deep")
  const [hasProjectMemory, setHasProjectMemory] = useState(false)
  const [isSavingProjectMemory, setIsSavingProjectMemory] = useState(false)
  const promptRef = useRef<HTMLElement | null>(null)
  const submitRef = useRef<HTMLButtonElement | null>(null)
  const pendingPromptRef = useRef<PendingPrompt | null>(null)
  const lastDetectedSendRef = useRef<{ prompt: string; at: number } | null>(null)
  const retryTimeoutRef = useRef<number | null>(null)
  const outcomeEventIdRef = useRef<string | null>(null)
  const lastAnalyzedPromptRef = useRef("")
  const analyzingPromptRef = useRef<string | null>(null)
  const analysisRequestIdRef = useRef(0)
  const lastFocusedPromptRef = useRef<HTMLElement | null>(null)
  const lastPromptValueRef = useRef("")
  const lastStablePromptValueRef = useRef("")
  const lastSubmittedOrAppliedPromptRef = useRef("")
  const latestAssistantNodeRef = useRef<HTMLElement | null>(null)
  const lastEvaluatedAssistantTextRef = useRef("")
  const lastEvaluatedAssistantMessageIdRef = useRef("")
  const lastEvaluatedChatHrefRef = useRef("")
  const planningGoalNoticeTimeoutRef = useRef<number | null>(null)
  const afterEvaluationRequestIdRef = useRef(0)
  const afterQuestionRequestIdRef = useRef(0)
  const afterNextPromptRequestIdRef = useRef(0)
  const recentAnsweredTimeoutRef = useRef<number | null>(null)
  const afterLoadingIntervalRef = useRef<number | null>(null)
  const pendingContextAnalysisRef = useRef<PendingContextAnalysis | null>(null)
  const popupOpenRef = useRef(false)
  const frozenHostPositionRef = useRef<{ top: string; left: string } | null>(null)
  const popupAnchorPromptRef = useRef<HTMLElement | null>(null)
  const projectMemoryAwaitingFreshAnswerRef = useRef(false)
  const projectMemoryBaselineResponseRef = useRef<{
    identity: string
    normalizedText: string
    threadIdentity: string
  } | null>(null)
  const strongestAfterVerdictRef = useRef<AfterAnalysisResult | null>(null)
  const afterReviewCacheRef = useRef<CachedAfterReviews | null>(null)
  const reviewPopupOrchestratorRef = useRef<ReturnType<typeof createReviewPopupOrchestrator> | null>(null)
  const reviewPromptModeOrchestratorRef = useRef<ReturnType<typeof createReviewPromptModeOrchestrator> | null>(null)
  const reviewPromptModeV2OrchestratorRef = useRef<ReturnType<typeof createReviewPromptModeV2Orchestrator> | null>(null)
  const reviewPopupOpenStateRef = useRef(false)
  const reviewPopupTargetKeyRef = useRef<string | null>(null)
  const reviewTypingTimeoutRef = useRef<number | null>(null)
  const reviewTargetResolverRef = useRef<ReturnType<typeof createReviewTargetResolver> | null>(null)
  const reviewAnalysisRunnerRef = useRef<ReturnType<typeof createReviewAnalysisRunner> | null>(null)
  const reviewSignalRequestIdRef = useRef(0)
  const reviewSignalSettleTimeoutRef = useRef<number | null>(null)
  const reviewSignalCacheRef = useRef<{
    targetKey: string
    signal: ReviewSignalState
  } | null>(null)
  const lastObservedAssistantSignalKeyRef = useRef("")
  const lastSettledAssistantSignalKeyRef = useRef("")
  const awaitingFreshReviewAnswerRef = useRef(false)
  const submittedAssistantBaselineKeyRef = useRef("")

  function isReplitSurface() {
    return getPromptSurface() === "REPLIT"
  }

  async function loadProjectMemoryForCurrentLocation() {
    if (!isReplitSurface()) {
      setProjectMemoryKey("")
      setProjectMemoryLabel("")
      setProjectContextDraft("")
      setCurrentStateDraft("")
      setProjectMemoryDepth("deep")
      setHasProjectMemory(false)
      projectMemoryAwaitingFreshAnswerRef.current = false
      projectMemoryBaselineResponseRef.current = null
      strongestAfterVerdictRef.current = null
      afterReviewCacheRef.current = null
      return
    }

    const identity = deriveProjectMemoryIdentity()
    setProjectMemoryKey(identity.key)
    setProjectMemoryLabel(identity.label)
    const record = await getProjectMemory(identity.key)
    setProjectContextDraft(record?.projectContext ?? "")
    setCurrentStateDraft(record?.currentState ?? "")
    setProjectHandoffDraft(
      record && (record.projectContext?.trim() || record.currentState?.trim())
        ? buildProjectHandoffMarkdown(record.projectContext ?? "", record.currentState ?? "")
        : ""
    )
    setProjectMemoryDepth(record?.memoryDepth === "quick" ? "quick" : "deep")
    setHasProjectMemory(Boolean(record && (record.projectContext || record.currentState)))
    projectMemoryAwaitingFreshAnswerRef.current = Boolean(record?.awaitingFreshAnswer)
    projectMemoryBaselineResponseRef.current = record
      ? {
          identity: record.baselineResponseIdentity ?? "",
          normalizedText: normalizeAssistantTextForReuse(record.baselineResponseText ?? ""),
          threadIdentity: record.baselineThreadIdentity ?? ""
        }
      : null
    strongestAfterVerdictRef.current = null
    afterReviewCacheRef.current = null
  }

  useEffect(() => {
    void getCodeAnalysisMode().then((mode) => setCodeAnalysisModeState(mode))
  }, [])

  function stopAfterLoadingProgress() {
    if (afterLoadingIntervalRef.current) {
      window.clearInterval(afterLoadingIntervalRef.current)
      afterLoadingIntervalRef.current = null
    }
    setAfterLoadingProgress(null)
  }

  function computeHostPosition(sourceInput = promptRef.current, sourceSubmit = submitRef.current) {
    if (!sourceInput) return null

    if (sourceSubmit) {
      const inputRect = sourceInput.getBoundingClientRect()
      return {
        top: `${window.scrollY + inputRect.top - 26}px`,
        left: `${window.scrollX + inputRect.right - 28}px`
      }
    }

    const rect = sourceInput.getBoundingClientRect()
    return {
      top: `${window.scrollY + rect.top - 26}px`,
      left: `${window.scrollX + rect.right - 28}px`
    }
  }

  function startAfterLoadingProgress(mode: "quick" | "deep") {
    if (afterLoadingIntervalRef.current) {
      window.clearInterval(afterLoadingIntervalRef.current)
      afterLoadingIntervalRef.current = null
    }

    const stages =
      mode === "deep"
        ? [
            { label: "Capturing latest change", start: 8, target: 15 },
            { label: "Checking prompt criteria", start: 16, target: 35 },
            { label: "Inspecting answer deeply", start: 36, target: 58 },
            { label: "Verifying missed points", start: 59, target: 78 },
            { label: "Preparing result", start: 79, target: 92 }
          ]
        : [
            { label: "Capturing latest change", start: 8, target: 15 },
            { label: "Checking prompt criteria", start: 16, target: 42 },
            { label: "Scanning answer evidence", start: 43, target: 72 },
            { label: "Preparing result", start: 73, target: 92 }
          ]

    let stageIndex = 0
    let percent = stages[0]?.start ?? 8
    let currentStage = stages[0]
    setAfterLoadingProgress({
      percent,
      label: currentStage?.label ?? "Preparing result"
    })

    afterLoadingIntervalRef.current = window.setInterval(() => {
      if (!currentStage) return

      const driftStep = percent < currentStage.target - 8 ? 2 : 1
      percent = Math.min(percent + driftStep, currentStage.target)

      if (percent >= currentStage.target && stageIndex < stages.length - 1) {
        stageIndex += 1
        currentStage = stages[stageIndex]
        percent = Math.max(percent, currentStage.start)
      }

      setAfterLoadingProgress({
        percent: Math.min(percent, 95),
        label: currentStage.label
      })
    }, 240)
  }

  async function showProjectContextAssimilationStep() {
    stopAfterLoadingProgress()
    setAfterVerdict(
      buildAfterPlaceholder(
        "Project context received. reeva AI is grounding the review with your newly added information.",
        [
          "This gives the next analysis more signal from your architecture, current bug, and latest findings before it judges the earlier answer."
        ],
        ""
      )
    )
    setAfterLoadingProgress({
      percent: 22,
      label: "Absorbing project context"
    })

    await new Promise((resolve) => window.setTimeout(resolve, 950))
  }

  function getAttemptPlatform(): Attempt["platform"] {
    return getPromptSurface() === "CHATGPT" ? "chatgpt" : "replit"
  }

  function resetAfterNextStepFlow() {
    afterQuestionRequestIdRef.current += 1
    afterNextPromptRequestIdRef.current += 1
    if (planningGoalNoticeTimeoutRef.current) {
      window.clearTimeout(planningGoalNoticeTimeoutRef.current)
      planningGoalNoticeTimeoutRef.current = null
    }
    if (recentAnsweredTimeoutRef.current) {
      window.clearTimeout(recentAnsweredTimeoutRef.current)
      recentAnsweredTimeoutRef.current = null
    }
    setAfterNextStepStarted(false)
    setAfterPlanningGoal("")
    setActiveSuggestedDirectionChipId(null)
    setUsedSuggestedDirectionChipIds([])
    setPlanningGoalNotice("")
    setRecentlyAnsweredAfterQuestionId(null)
    setAfterQuestionHistory([])
    setAfterQuestionLevels({})
    setAfterQuestions([])
    setAfterQuestionLevel(1)
    setAfterAnswerState({})
    setAfterOtherAnswerState({})
    setAfterActiveQuestionIndex(0)
    setIsAddingAfterQuestions(false)
    setIsGeneratingAfterNextPrompt(false)
    setAfterNextPromptDraft("")
    setAfterNextPromptReady(false)
  }

  function celebrateAnsweredQuestion(questionId: string) {
    setRecentlyAnsweredAfterQuestionId(questionId)
    if (recentAnsweredTimeoutRef.current) {
      window.clearTimeout(recentAnsweredTimeoutRef.current)
    }
    recentAnsweredTimeoutRef.current = window.setTimeout(() => {
      setRecentlyAnsweredAfterQuestionId((current) => (current === questionId ? null : current))
      recentAnsweredTimeoutRef.current = null
    }, 2000)
  }

  function showPlanningGoalNotice(message: string) {
    setPlanningGoalNotice(message)
    if (planningGoalNoticeTimeoutRef.current) {
      window.clearTimeout(planningGoalNoticeTimeoutRef.current)
    }
    planningGoalNoticeTimeoutRef.current = window.setTimeout(() => {
      setPlanningGoalNotice("")
      planningGoalNoticeTimeoutRef.current = null
    }, 1800)
  }

  function pruneAfterBranchFromIndex(startIndex: number) {
    afterQuestionRequestIdRef.current += 1
    afterNextPromptRequestIdRef.current += 1
    const pruned = prunePlannerBranch({
      startIndex,
      questionHistory: afterQuestionHistory,
      questionLevels: afterQuestionLevels,
      answerState: afterAnswerState,
      otherAnswerState: afterOtherAnswerState
    })

    setAfterQuestionHistory(pruned.keptHistory)
    setAfterQuestions(pruned.currentLevelQuestions)
    setAfterQuestionLevel(pruned.activeLevel)
    setAfterAnswerState(pruned.answerState)
    setAfterOtherAnswerState(pruned.otherAnswerState)
    setAfterQuestionLevels(pruned.questionLevels)
    setAfterActiveQuestionIndex(pruned.activeQuestionIndex)
    setAfterNextPromptReady(false)
    setAfterNextPromptDraft("")
  }

  async function fetchAfterNextQuestions(
    existingQuestions: ClarificationQuestion[],
    answers: Record<string, string>,
    currentLevel: number,
    requestKind: "next_level" | "expand_level",
    overrides?: {
      attempt?: Attempt | null
      analysis?: AfterAnalysisResult | null
      planningGoal?: string
      questionLevels?: Record<string, number>
    }
  ) {
    const attemptSource = overrides?.attempt ?? afterAttempt
    const analysisSource = overrides?.analysis ?? afterVerdict
    if (!analysisSource || !attemptSource) return null
    const compactProjectMemory = getCompactProjectMemory()

    const result = await generateAfterNextQuestion(
      buildAfterQuestionRequest({
        attempt: attemptSource,
        analysis: analysisSource,
        askedQuestions: existingQuestions,
        questionLevels: overrides?.questionLevels ?? afterQuestionLevels,
        answers,
        planningGoal: overrides?.planningGoal ?? afterPlanningGoal,
        projectContext: compactProjectMemory.projectContext,
        currentState: compactProjectMemory.currentState,
        currentLevel,
        requestKind
      })
    )

    return result
  }

  async function saveDraftAttempt(promptText: string, improvedPrompt?: string | null) {
    const optimizedPrompt = (improvedPrompt ?? beforeResult?.rewrite ?? promptText).trim()
    const attempt = await createAttempt(
      buildDraftAttemptInput({
        promptText,
        optimizedPrompt,
        platform: getAttemptPlatform(),
        beforeIntent: beforeResult?.intent,
        clarificationQuestions: beforeResult?.clarification_questions ?? [],
        answers: normalizeAnswers(answerState)
      })
    )
    return attempt
  }

  function getActiveSurfaceAdapter() {
    return resolveSurfaceAdapter()
  }

  function getCurrentDraftSnapshot() {
    return getActiveSurfaceAdapter().getDraftPrompt()
  }

  function hasUnsentPromptDraft(promptText = getCurrentDraftSnapshot().text) {
    const trimmedPrompt = promptText.trim()
    if (!trimmedPrompt) return false

    return trimmedPrompt !== lastSubmittedOrAppliedPromptRef.current.trim()
  }

  function updateReviewTypingState(promptText: string) {
    const trimmedPrompt = promptText.trim()
    const shouldType = hasUnsentPromptDraft(trimmedPrompt)

    if (!shouldType) {
      if (reviewTypingTimeoutRef.current) {
        window.clearTimeout(reviewTypingTimeoutRef.current)
        reviewTypingTimeoutRef.current = null
      }
      setReviewTypingState({
        active: false,
        promptText: "",
        sessionKey: null,
        goalContract: null,
        preflight: null
      })
      return
    }

    const sessionKey = buildPromptModeSessionKey(trimmedPrompt)
    const goalContract = normalizeGoalContract({
      promptText: trimmedPrompt,
      taskFamily: mapPromptIntentToTaskType(beforeResult?.intent ?? "OTHER")
    })
    const preflight = buildPreflightAssessment({
      goalContract,
      promptText: trimmedPrompt
    })
    setReviewTypingState({
      active: true,
      promptText: trimmedPrompt,
      sessionKey,
      goalContract,
      preflight
    })

    if (reviewTypingTimeoutRef.current) {
      window.clearTimeout(reviewTypingTimeoutRef.current)
    }

    reviewTypingTimeoutRef.current = window.setTimeout(() => {
      const currentDraft = getCurrentDraftSnapshot().text.trim()
      if (!hasUnsentPromptDraft(currentDraft)) {
        setReviewTypingState({
          active: false,
          promptText: "",
          sessionKey: null,
          goalContract: null,
          preflight: null
        })
        reviewTypingTimeoutRef.current = null
        return
      }

      setReviewTypingState((current) => ({
        ...current,
        active: document.activeElement === promptRef.current
      }))
      reviewTypingTimeoutRef.current = null
    }, 2200)
  }

  function getCurrentAssistantSnapshot() {
    return getActiveSurfaceAdapter().getLatestAssistantResponse()
  }

  function getCurrentReviewPromptSnapshot() {
    const liveSnapshot = getCurrentUserSnapshot()
    const liveText = liveSnapshot.text.trim()
    if (liveText) {
      return {
        ...liveSnapshot,
        text: liveText
      }
    }

    const fallbackText =
      pendingPromptRef.current?.prompt.trim() ||
      lastSubmittedOrAppliedPromptRef.current.trim() ||
      lastStablePromptValueRef.current.trim() ||
      ""

    return {
      exists: Boolean(fallbackText),
      text: fallbackText,
      node: liveSnapshot.node ?? null
    }
  }

  function getCurrentUserSnapshot() {
    return getActiveSurfaceAdapter().getLatestUserPrompt()
  }

  function getCurrentThreadSnapshot() {
    return getActiveSurfaceAdapter().getThread()
  }

  function buildLiveAssistantSignalKey(input?: {
    threadIdentity: string
    responseIdentity: string
    responseText: string
  }) {
    const source =
      input ??
      (() => {
        const assistant = getCurrentAssistantResponseText()
        const thread = getCurrentThreadSnapshot()
        return {
          threadIdentity: thread.identity,
          responseIdentity: assistant.identity,
          responseText: assistant.text
        }
      })()

    const normalizedResponseText = normalizeAssistantTextForReuse(source.responseText)
    if (!normalizedResponseText) return ""

    return [source.threadIdentity, source.responseIdentity || "no-response-id", normalizedResponseText].join("::")
  }

  async function ensureSubmittedAttempt() {
    const userMessage = getCurrentUserSnapshot().text.trim()
    const submittedPrompt = pendingPromptRef.current?.prompt.trim() ?? ""
    const draftPrompt = getCurrentDraftSnapshot().text.trim()
    const inferredPrompt =
      userMessage ||
      submittedPrompt ||
      draftPrompt ||
      lastStablePromptValueRef.current.trim() ||
      lastPromptValueRef.current.trim() ||
      promptPreview.trim()
    const normalizedPrompt = inferredPrompt.trim()
    const latestSubmitted = await getLatestSubmittedAttempt()
    if (shouldReuseLatestSubmittedAttempt({ normalizedPrompt, latestSubmitted })) {
      return latestSubmitted
    }

    const activeAttempt = await getActiveAttempt()
    if (activeAttempt) {
      const submitted = await markAttemptSubmitted(
        activeAttempt.attempt_id,
        buildSubmittedAttemptPatch({
          prompt: inferredPrompt,
          beforeIntent: beforeResult?.intent
        })
      )
      if (submitted) return submitted
    }

    if (!inferredPrompt) return null

    const fallbackAttempt = await createAttempt(
      buildFallbackSubmittedAttemptInput({
        prompt: inferredPrompt,
        platform: getAttemptPlatform(),
        beforeIntent: beforeResult?.intent
      })
    )
    return markAttemptSubmitted(fallbackAttempt.attempt_id)
  }

  function getCurrentAssistantResponseText() {
    const snapshot = getCurrentAssistantSnapshot()
    return {
      latestMessage: snapshot.node,
      text: snapshot.text,
      identity: snapshot.identity
    }
  }

  function normalizeAssistantTextForReuse(value: string) {
    return value.replace(/\s+/g, " ").trim()
  }

  function getReviewTargetResolver() {
    if (!reviewTargetResolverRef.current) {
      reviewTargetResolverRef.current = createReviewTargetResolver({
        getLatestAssistantResponse: () => {
          const snapshot = getCurrentAssistantResponseText()
          return {
            node: snapshot.latestMessage,
            text: snapshot.text,
            identity: snapshot.identity
          }
        },
        getLatestUserPrompt: () => getCurrentReviewPromptSnapshot(),
        getThread: () => getCurrentThreadSnapshot(),
        getLatestSubmittedAttempt: () => getLatestSubmittedAttempt(),
        getReviewableAttempts: () => getRecentReviewableAttempts(),
        ensureSubmittedAttempt,
        readAssistantMessageIdentity: (node, text) => readAssistantMessageIdentity(node, text),
        normalizeResponseText: (value) => normalizeAssistantTextForReuse(value)
      })
    }

    return reviewTargetResolverRef.current
  }

  function getReviewAnalysisRunner() {
    if (!reviewAnalysisRunnerRef.current) {
      reviewAnalysisRunnerRef.current = createReviewAnalysisRunner({
        analyzeAfterAttempt,
        attachAnalysisResult,
        preprocessResponse,
        getProjectMemoryContext: () => getCompactProjectMemory(),
        collectChangedFilesSummary,
        collectVisibleErrorSummary,
        refinePrompt: (request) => refinePrompt(request)
      })
    }

    return reviewAnalysisRunnerRef.current
  }

  function isGenericChecklistLabel(label: string) {
    const normalized = label.trim().toLowerCase()
    return (
      !normalized ||
      normalized === "solve the requested task" ||
      normalized === "solve: the user's latest request" ||
      normalized === "solve: the user’s latest request" ||
      normalized === "solve: the users latest request"
    )
  }

  function specificityScore(result: AfterAnalysisResult | null) {
    if (!result) return 0

    const checklistScore = (result.acceptance_checklist ?? []).reduce((score, item) => {
      if (isGenericChecklistLabel(item.label)) return score
      return score + Math.min(item.label.trim().length, 80)
    }, 0)

    const findingScore = result.findings.reduce((score, item) => {
      const normalized = item.trim().toLowerCase()
      if (!normalized) return score
      if (normalized.includes("the user's latest request")) return score
      if (normalized.includes("help replit users write stronger ai prompts")) return score
      return score + Math.min(item.trim().length, 120)
    }, 0)

    return checklistScore + findingScore
  }

  function preserveStrongerReviewContext(
    nextResult: AfterAnalysisResult,
    previousResult: AfterAnalysisResult | null
  ) {
    if (!previousResult) return nextResult

    const nextScore = specificityScore(nextResult)
    const previousScore = specificityScore(previousResult)
    if (nextScore >= previousScore || previousScore === 0) return nextResult

    return {
      ...nextResult,
      status: previousResult.status,
      confidence: previousResult.confidence,
      confidence_reason: previousResult.confidence_reason,
      findings: previousResult.findings,
      issues: previousResult.issues,
      next_prompt: previousResult.next_prompt,
      prompt_strategy: previousResult.prompt_strategy,
      verdict: previousResult.verdict,
      next_prompt_output: previousResult.next_prompt_output,
      acceptance_checklist: previousResult.acceptance_checklist,
      stage_1: previousResult.stage_1,
      stage_2: previousResult.stage_2
    }
  }

  function isSameCachedAfterTarget(
    cache: CachedAfterReviews | null,
    threadIdentity: string,
    responseIdentity: string,
    normalizedText: string
  ) {
    if (!cache) return false

    if (cache.threadIdentity !== threadIdentity) return false

    if (responseIdentity && cache.responseIdentity) {
      return responseIdentity === cache.responseIdentity
    }

    return normalizedText === cache.normalizedText
  }

  function buildCurrentAfterTargetOverride(): PendingContextAnalysis | null {
    if (!afterAttempt) return null

    const liveTarget = getCurrentAssistantResponseText()
    const currentThread = getCurrentThreadSnapshot()
    const responseText = lastEvaluatedAssistantTextRef.current || liveTarget.text
    const responseIdentity = lastEvaluatedAssistantMessageIdRef.current || liveTarget.identity
    const threadIdentity = lastEvaluatedChatHrefRef.current || currentThread.identity

    if (!responseText.trim()) return null

    return {
      attempt: afterAttempt,
      responseText,
      responseIdentity,
      threadIdentity
    }
  }

  async function submitReviewPopupPrompt(prompt: string) {
    const normalizedPrompt = prompt.trim()
    if (!normalizedPrompt) return

    const draftSnapshot = getCurrentDraftSnapshot()
    const sourcePrompt = draftSnapshot.text.trim() || promptPreview.trim() || normalizedPrompt

    lastStablePromptValueRef.current = normalizedPrompt
    getActiveSurfaceAdapter().writeDraftPrompt(normalizedPrompt)
    setPromptPreview(normalizedPrompt.slice(0, 220))
    updateReviewTypingState(normalizedPrompt)
    await saveDraftAttempt(sourcePrompt, normalizedPrompt)
    setReviewPopupOpen(false)
  }

  async function runReviewSignalAnalysis(reason: string) {
    const requestId = ++reviewSignalRequestIdRef.current
    const resolution = await getReviewTargetResolver()()

    if (requestId !== reviewSignalRequestIdRef.current) return

    if (!resolution.ok) {
      logReviewDebug("signal target unavailable", { reason, failure: resolution.reason })
      setReviewSignal(createIdleReviewSignal())
      return
    }

    const target = resolution.target
    const targetKey = buildLiveAssistantSignalKey({
      threadIdentity: target.threadIdentity,
      responseIdentity: target.responseIdentity,
      responseText: target.responseText
    })

    if (reviewSignalCacheRef.current?.targetKey === targetKey) {
      logReviewDebug("signal cache hit", { reason, targetKey })
      setReviewSignal(reviewSignalCacheRef.current.signal)
    } else {
      logReviewDebug("signal analysis running", {
        reason,
        targetKey,
        responseIdentity: target.responseIdentity,
        responseLength: target.responseText.length
      })
      setReviewSignal(createLoadingReviewSignal(targetKey))
      const result = await getReviewAnalysisRunner()({
        target,
        mode: "quick",
        quickBaseline: null
      })
      if (requestId !== reviewSignalRequestIdRef.current) return

      const signal = mapReviewResultToSignal({
        result,
        taskType: target.taskType,
        targetKey
      })
      reviewSignalCacheRef.current = {
        targetKey,
        signal
      }
      setReviewSignal(signal)
      logReviewDebug("signal analysis completed", {
        reason,
        targetKey,
        signal: signal.state
      })
    }

    if (
      reviewPopupOpenStateRef.current &&
      reviewPopupSurface === "answer_mode" &&
      reviewPopupTargetKeyRef.current !== targetKey
    ) {
      logReviewDebug("popup switching to newer answer", {
        previousTargetKey: reviewPopupTargetKeyRef.current,
        nextTargetKey: targetKey
      })
      reviewPopupOrchestratorRef.current?.invalidate()
      void getReviewPopupOrchestrator().open()
    }
  }

  function scheduleReviewSignalRefresh(reason: string) {
    const assistant = getCurrentAssistantResponseText()
    const thread = getCurrentThreadSnapshot()
    const liveKey = buildLiveAssistantSignalKey({
      threadIdentity: thread.identity,
      responseIdentity: assistant.identity,
      responseText: assistant.text
    })

    if (!liveKey) return

    if (awaitingFreshReviewAnswerRef.current && liveKey === submittedAssistantBaselineKeyRef.current) {
      return
    }

    if (liveKey === lastObservedAssistantSignalKeyRef.current) return

    lastObservedAssistantSignalKeyRef.current = liveKey
    logReviewDebug("new answer detected", {
      reason,
      liveKey,
      responseIdentity: assistant.identity,
      responseLength: assistant.text.trim().length
    })

    if (reviewSignalSettleTimeoutRef.current) {
      window.clearTimeout(reviewSignalSettleTimeoutRef.current)
    }

    reviewSignalSettleTimeoutRef.current = window.setTimeout(() => {
      const currentAssistant = getCurrentAssistantResponseText()
      const currentThread = getCurrentThreadSnapshot()
      const settledKey = buildLiveAssistantSignalKey({
        threadIdentity: currentThread.identity,
        responseIdentity: currentAssistant.identity,
        responseText: currentAssistant.text
      })

      if (!settledKey || settledKey !== liveKey || settledKey === lastSettledAssistantSignalKeyRef.current) {
        return
      }

      awaitingFreshReviewAnswerRef.current = false
      lastSettledAssistantSignalKeyRef.current = settledKey
      reviewSignalCacheRef.current = null
      logReviewDebug("answer settled", {
        reason,
        settledKey,
        responseIdentity: currentAssistant.identity,
        responseLength: currentAssistant.text.trim().length
      })
      reviewPopupOrchestratorRef.current?.invalidate()
      void runReviewSignalAnalysis("answer_settled")
    }, REVIEW_SIGNAL_SETTLE_MS)
  }

  function compactContextForApi(value: string, maxLength: number) {
    const normalized = value.trim()
    if (normalized.length <= maxLength) return normalized

    const headLength = Math.max(0, Math.floor(maxLength * 0.62))
    const tailLength = Math.max(0, maxLength - headLength - 24)

    return `${normalized.slice(0, headLength).trim()}\n\n[...trimmed for size...]\n\n${normalized.slice(-tailLength).trim()}`
      .slice(0, maxLength)
      .trim()
  }

  function getCompactProjectMemory() {
    return {
      projectContext: compactContextForApi(projectContextDraft, 4000),
      currentState: compactContextForApi(currentStateDraft, 3000)
    }
  }

  async function runAfterEvaluation(
    force = false,
    deepAnalysis = false,
    targetOverride?: PendingContextAnalysis
  ) {
    const requestId = ++afterEvaluationRequestIdRef.current
    const liveTarget = getCurrentAssistantResponseText()
    const latestMessage = targetOverride ? null : liveTarget.latestMessage
    const text = targetOverride?.responseText ?? liveTarget.text
    const identity = targetOverride?.responseIdentity ?? liveTarget.identity
    const normalizedText = normalizeAssistantTextForReuse(text)
    const normalizedLastText = normalizeAssistantTextForReuse(lastEvaluatedAssistantTextRef.current)
    const latestMessageId = identity || readAssistantMessageIdentity(latestMessage, text)
    const currentThread = getCurrentThreadSnapshot()
    const effectiveThreadIdentity = targetOverride?.threadIdentity ?? currentThread.identity
    const sameAnalyzedTarget = isSameCachedAfterTarget(
      afterReviewCacheRef.current,
      effectiveThreadIdentity,
      latestMessageId,
      normalizedText
    )

    if (!text || (!force && normalizedText === normalizedLastText)) {
      return false
    }

    const attempt = targetOverride?.attempt ?? (await ensureSubmittedAttempt())
    if (!attempt) return false

    latestAssistantNodeRef.current = latestMessage
    setIsEvaluatingAfterResponse(true)

    try {
      const compactProjectMemory = getCompactProjectMemory()
      const responseSummary = preprocessResponse(text)
      const changedFiles = collectChangedFilesSummary()
      const rawResult = await analyzeAfterAttempt({
        attempt,
        response_summary: responseSummary,
        response_text_fallback: text,
        deep_analysis: deepAnalysis,
        project_context: compactProjectMemory.projectContext,
        current_state: compactProjectMemory.currentState,
        error_summary: collectVisibleErrorSummary(),
        changed_file_paths_summary: changedFiles
      })
      const cachedReviews = sameAnalyzedTarget ? afterReviewCacheRef.current : null
      const baselineVerdict = sameAnalyzedTarget
        ? deepAnalysis
          ? cachedReviews?.quick ?? strongestAfterVerdictRef.current ?? afterVerdict
          : cachedReviews?.quick ?? strongestAfterVerdictRef.current ?? afterVerdict
        : null
      const result = baselineVerdict
        ? preserveStrongerReviewContext(rawResult, baselineVerdict)
        : rawResult
      if (requestId !== afterEvaluationRequestIdRef.current) {
        return false
      }
      if (normalizedText !== normalizedLastText) {
        resetAfterNextStepFlow()
      }
      projectMemoryAwaitingFreshAnswerRef.current = false
      projectMemoryBaselineResponseRef.current = null
      if (projectMemoryKey && projectMemoryLabel && hasProjectMemory) {
        await saveProjectMemory({
          projectKey: projectMemoryKey,
          projectLabel: projectMemoryLabel,
          projectContext: projectContextDraft,
          currentState: currentStateDraft,
          memoryDepth: projectMemoryDepth,
          awaitingFreshAnswer: false,
          baselineResponseIdentity: "",
          baselineResponseText: "",
          baselineThreadIdentity: ""
        })
      }
      setAfterAttempt(attempt)
      setAfterVerdict(result)
      setAfterDisplayedReviewMode(deepAnalysis ? "deep" : "quick")
      await attachAnalysisResult(attempt.attempt_id, text, result, latestMessageId)
      lastEvaluatedAssistantTextRef.current = text
      lastEvaluatedAssistantMessageIdRef.current = latestMessageId
      lastEvaluatedChatHrefRef.current = effectiveThreadIdentity
      if (!sameAnalyzedTarget || !afterReviewCacheRef.current) {
        afterReviewCacheRef.current = {
          threadIdentity: effectiveThreadIdentity,
          responseIdentity: latestMessageId,
          normalizedText,
          quick: deepAnalysis ? null : result,
          deep: deepAnalysis ? result : null
        }
      } else if (deepAnalysis) {
        afterReviewCacheRef.current = {
          ...afterReviewCacheRef.current,
          quick: afterReviewCacheRef.current.quick ?? baselineVerdict ?? null,
          deep: result
        }
      } else {
        afterReviewCacheRef.current = {
          ...afterReviewCacheRef.current,
          quick: result
        }
      }
      if (!sameAnalyzedTarget || !strongestAfterVerdictRef.current) {
        strongestAfterVerdictRef.current = result
      } else if (specificityScore(result) >= specificityScore(strongestAfterVerdictRef.current)) {
        strongestAfterVerdictRef.current = result
      }
      return true
    } finally {
      if (requestId === afterEvaluationRequestIdRef.current) {
        setIsEvaluatingAfterResponse(false)
      }
    }
  }

  const currentSession = useMemo<SessionSummary>(
    () =>
      session ?? {
        sessionId: crypto.randomUUID(),
        lastPrompts: [],
        lastOptimizedPrompts: [],
        retryCount: 0,
        lastIssueDetected: null,
        lastProbableStatus: "UNKNOWN"
      },
    [session]
  )

  useEffect(() => {
    if (!isSupportedPromptPage()) return

    void getSessionSummary().then((existing) => {
      if (existing) setSession(existing)
    })

    void hasSeenOnboarding().then((seen) => {
      if (!seen) setOnboardingVisible(true)
    })
    void loadProjectMemoryForCurrentLocation()

    const scan = () => {
      if (popupOpenRef.current) {
        positionHost()
        scheduleReviewSignalRefresh("popup-open-mutation")
        return
      }

      const input = findPromptInput()
      if (!input) {
        const fallbackInput = lastFocusedPromptRef.current
        if (fallbackInput && fallbackInput.isConnected && isPromptLikeElement(fallbackInput)) {
          promptRef.current = fallbackInput
          submitRef.current = findSubmitButton(fallbackInput)
          positionHost()
          scheduleReviewSignalRefresh("fallback-scan")
          return
        }

        promptRef.current = null
        submitRef.current = null
        positionHost()
        scheduleReviewSignalRefresh("no-input-scan")
        return
      }

      const inputChanged = promptRef.current !== input
      promptRef.current = input
      lastFocusedPromptRef.current = input
      submitRef.current = findSubmitButton(input)
      positionHost()
      scheduleReviewSignalRefresh("scan")
      if (inputChanged) {
        setInputBindingVersion((current) => current + 1)
      }
    }

    const handleFocusIn = (event: FocusEvent) => {
      if (popupOpenRef.current) return

      const target = event.target
      if (!(target instanceof HTMLElement) || !isPromptLikeElement(target)) return

      const inputChanged = promptRef.current !== target
      promptRef.current = target
      lastFocusedPromptRef.current = target
      submitRef.current = findSubmitButton(target)
      positionHost()
      updateReviewTypingState(readPromptValue(target))
      scheduleReviewSignalRefresh("focus")
      if (inputChanged) {
        setInputBindingVersion((current) => current + 1)
      }
    }

    scan()
    const observer = new MutationObserver(scan)
    observer.observe(document.body, { childList: true, subtree: true })
    document.addEventListener("focusin", handleFocusIn)
    window.addEventListener("resize", positionHost)
    window.addEventListener("scroll", positionHost, true)
    const freshnessIntervalId = window.setInterval(() => {
      scheduleReviewSignalRefresh("poll")
    }, 1000)
    setMounted(true)

    return () => {
      observer.disconnect()
      document.removeEventListener("focusin", handleFocusIn)
      window.removeEventListener("resize", positionHost)
      window.removeEventListener("scroll", positionHost, true)
      window.clearInterval(freshnessIntervalId)
      if (retryTimeoutRef.current) window.clearTimeout(retryTimeoutRef.current)
      if (afterLoadingIntervalRef.current) {
        window.clearInterval(afterLoadingIntervalRef.current)
        afterLoadingIntervalRef.current = null
      }
      if (reviewSignalSettleTimeoutRef.current) {
        window.clearTimeout(reviewSignalSettleTimeoutRef.current)
        reviewSignalSettleTimeoutRef.current = null
      }
      if (reviewTypingTimeoutRef.current) {
        window.clearTimeout(reviewTypingTimeoutRef.current)
        reviewTypingTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    popupOpenRef.current = panelOpen || afterPanelOpen || reviewPopupOpen
    reviewPopupOpenStateRef.current = reviewPopupOpen
    reviewPopupTargetKeyRef.current = reviewPopupControllerState.targetKey

    if (popupOpenRef.current && !frozenHostPositionRef.current) {
      popupAnchorPromptRef.current = promptRef.current
      frozenHostPositionRef.current = computeHostPosition()
    }

    if (!popupOpenRef.current) {
      frozenHostPositionRef.current = null
      popupAnchorPromptRef.current = null
    }

    positionHost()
  }, [panelOpen, afterPanelOpen, reviewPopupOpen, reviewPopupControllerState.targetKey])

  useEffect(() => {
    const input = promptRef.current

    let debounceId: number | null = null

    const bindPromptTarget = (target: HTMLElement) => {
      const inputChanged = promptRef.current !== target
      promptRef.current = target
      lastFocusedPromptRef.current = target
      submitRef.current = findSubmitButton(target)
      positionHost()
      if (inputChanged) {
        setInputBindingVersion((current) => current + 1)
      }
    }

    const handleInput = (sourceInput?: HTMLElement) => {
      const activeInput = sourceInput ?? promptRef.current
      if (!activeInput) return

      const prompt = readPromptValue(activeInput)
      const previousPromptValue = lastPromptValueRef.current
      const promptChanged = prompt !== previousPromptValue
      lastPromptValueRef.current = prompt
      if (prompt.trim()) {
        lastStablePromptValueRef.current = prompt.trim()
      }
      setPromptPreview(prompt.slice(0, 220))
      updateReviewTypingState(prompt)
      setIssueVisible(false)
      setDiagnosis(null)
      if (promptChanged && prompt.trim() && afterVerdict) {
        setAfterAttempt(null)
        setAfterVerdict(null)
        setAfterPanelOpen(false)
        resetAfterNextStepFlow()
      }
      if (!prompt.trim()) {
        setIsAnalyzingPrompt(false)
      }

      if (debounceId) window.clearTimeout(debounceId)
      debounceId = window.setTimeout(async () => {
        const normalizedPrompt = prompt.trim()
        if (!normalizedPrompt) {
          setIsAnalyzingPrompt(false)
          return
        }

        setIsAnalyzingPrompt(true)
        const alreadyAnalyzedSamePrompt = normalizedPrompt.length > 0 && normalizedPrompt === lastAnalyzedPromptRef.current
        const alreadyAnalyzingSamePrompt =
          normalizedPrompt.length > 0 && normalizedPrompt === analyzingPromptRef.current

        if (alreadyAnalyzedSamePrompt || alreadyAnalyzingSamePrompt) {
          setIsAnalyzingPrompt(false)
          return
        }

        analyzingPromptRef.current = normalizedPrompt
        const requestId = ++analysisRequestIdRef.current

        try {
          const result = analyzePromptLocally(prompt, summarizeSessionMemory(currentSession))

          if (requestId !== analysisRequestIdRef.current) {
            return
          }

          const latestPromptValue = promptRef.current ? readPromptValue(promptRef.current).trim() : promptPreview.trim()
          const promptChangedDuringAnalysis = latestPromptValue !== normalizedPrompt

          if (promptChangedDuringAnalysis) {
            return
          }

          const promptChanged = normalizedPrompt !== lastAnalyzedPromptRef.current
          setBeforeResult(result)
          if (promptChanged) {
            setAnswerState({})
            setOtherAnswerState({})
            setAiDraftNotes([])
            setEditableDraft("")
            setDraftReady(false)
            lastAnalyzedPromptRef.current = normalizedPrompt
          }
        } finally {
          setIsAnalyzingPrompt(false)
          if (analyzingPromptRef.current === normalizedPrompt) {
            analyzingPromptRef.current = null
          }
        }
      }, 800)
    }

    const handleDocumentInput = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return

      const candidate =
        isPromptLikeElement(target)
          ? target
          : target.closest<HTMLElement>("textarea, input, [role='textbox'], [contenteditable='true']")

      if (!candidate || !isPromptLikeElement(candidate)) return

      bindPromptTarget(candidate)
      handleInput(candidate)
    }

    const handleDocumentKeydown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey || event.altKey || event.isComposing || event.repeat) return

      const target = event.target
      if (!(target instanceof HTMLElement)) return

      const candidate =
        isPromptLikeElement(target)
          ? target
          : target.closest<HTMLElement>("textarea, input, [role='textbox'], [contenteditable='true']")

      if (!candidate || !isPromptLikeElement(candidate)) return

      bindPromptTarget(candidate)
      void handleSubmit(event.metaKey || event.ctrlKey ? "shortcut-enter" : "enter", candidate)
    }

    const handleDocumentSubmit = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLFormElement)) return

      const candidate = promptRef.current ?? findPromptInput()
      if (!candidate || !target.contains(candidate)) return

      bindPromptTarget(candidate)
      void handleSubmit("form-submit", candidate)
    }

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement) || target.closest("#prompt-optimizer-root")) return

      const button = target.closest<HTMLButtonElement>("button")
      if (!button) return

      const candidate = promptRef.current ?? findPromptInput()
      if (!candidate) return

      const submitButton = findSubmitButton(candidate)
      if (!submitButton || submitButton !== button) return

      bindPromptTarget(candidate)
      void handleSubmit("submit-click", candidate)
    }

    document.addEventListener("input", handleDocumentInput, true)
    document.addEventListener("keydown", handleDocumentKeydown, true)
    document.addEventListener("submit", handleDocumentSubmit, true)
    document.addEventListener("click", handleDocumentClick, true)
    handleInput(input ?? undefined)

    return () => {
      document.removeEventListener("input", handleDocumentInput, true)
      document.removeEventListener("keydown", handleDocumentKeydown, true)
      document.removeEventListener("submit", handleDocumentSubmit, true)
      document.removeEventListener("click", handleDocumentClick, true)
      if (debounceId) window.clearTimeout(debounceId)
    }
  }, [currentSession, inputBindingVersion])

  useEffect(() => {
    let lastThreadIdentity = getCurrentThreadSnapshot().identity
    const intervalId = window.setInterval(() => {
      const currentThreadIdentity = getCurrentThreadSnapshot().identity
      if (currentThreadIdentity === lastThreadIdentity) return

      lastThreadIdentity = currentThreadIdentity
      void loadProjectMemoryForCurrentLocation()
      setAfterVerdict(null)
      setAfterAttempt(null)
      setAfterDisplayedReviewMode("quick")
      setAfterPanelOpen(false)
      resetAfterNextStepFlow()
      setProjectContextSetupActive(false)
      setProjectContextReadyActive(false)
      reviewPopupOrchestratorRef.current?.close()
      reviewPromptModeOrchestratorRef.current?.reset()
      setReviewPopupOpen(false)
      setReviewPopupSurface("answer_mode")
      setReviewPopupControllerState({
        surface: "answer_mode",
        popupState: "idle",
        activeMode: "deep",
        targetKey: null,
        cacheStatus: "none",
        analysisStarted: false,
        analysisFinished: false,
        errorReason: null
      })
      setReviewPopupViewModel(buildReviewLoadingViewModel("deep"))
      setReviewPromptModeState({
        popupState: "idle",
        sessionKey: null,
        sourcePrompt: "",
        planningGoal: "",
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
        isGeneratingPrompt: false,
        promptDraft: "",
        promptReady: false,
        errorMessage: null
      })
      setReviewSignal(createIdleReviewSignal())
      setReviewTypingState({
        active: false,
        promptText: "",
        sessionKey: null,
        goalContract: null,
        preflight: null
      })
      setIsEvaluatingAfterResponse(false)
      setIsDeepAnalyzingAfterResponse(false)
      setHasSubmittedPrompt(false)
      latestAssistantNodeRef.current = null
      pendingContextAnalysisRef.current = null
      lastEvaluatedAssistantTextRef.current = ""
      lastEvaluatedAssistantMessageIdRef.current = ""
      lastEvaluatedChatHrefRef.current = ""
      strongestAfterVerdictRef.current = null
      lastSubmittedOrAppliedPromptRef.current = ""
      afterReviewCacheRef.current = null
      reviewSignalCacheRef.current = null
      lastObservedAssistantSignalKeyRef.current = ""
      lastSettledAssistantSignalKeyRef.current = ""
      awaitingFreshReviewAnswerRef.current = false
      submittedAssistantBaselineKeyRef.current = ""
      if (reviewSignalSettleTimeoutRef.current) {
        window.clearTimeout(reviewSignalSettleTimeoutRef.current)
        reviewSignalSettleTimeoutRef.current = null
      }
      pendingPromptRef.current = null
    }, 500)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  async function handleOpenAfterPanel() {
    if (isEvaluatingAfterResponse || isDeepAnalyzingAfterResponse) {
      setAfterPanelOpen(true)
      return
    }

    const { latestMessage, text, identity } = getCurrentAssistantResponseText()
    const draftSnapshot = getCurrentDraftSnapshot()
    const threadSnapshot = getCurrentThreadSnapshot()
    const normalizedText = normalizeAssistantTextForReuse(text)
    const normalizedLastText = normalizeAssistantTextForReuse(lastEvaluatedAssistantTextRef.current)
    const latestMessageId = identity || readAssistantMessageIdentity(latestMessage, text)
    const sameChat = threadSnapshot.identity === lastEvaluatedChatHrefRef.current
    const currentDraftPrompt = draftSnapshot.text.trim()
    const savedDraftPrompt = afterPlanningGoal.trim() || afterAttempt?.raw_prompt.trim() || ""
    const shouldStartWithDeepReview = false
    const sameMessage =
      latestMessageId && lastEvaluatedAssistantMessageIdRef.current
        ? latestMessageId === lastEvaluatedAssistantMessageIdRef.current
        : normalizedText === normalizedLastText
    const sameDraftPrompt = currentDraftPrompt === savedDraftPrompt
    const baselineResponse = projectMemoryBaselineResponseRef.current
    const sameAsProjectMemoryBaseline =
      Boolean(text) &&
      Boolean(baselineResponse) &&
      baselineResponse?.threadIdentity === threadSnapshot.identity &&
      ((latestMessageId && baselineResponse.identity && latestMessageId === baselineResponse.identity) ||
        normalizedText === baselineResponse.normalizedText)

    if (hasProjectMemory && projectMemoryAwaitingFreshAnswerRef.current && sameAsProjectMemoryBaseline) {
      setProjectContextSetupActive(false)
      setProjectContextReadyActive(true)
      setAfterPanelOpen(true)
      setAfterDisplayedReviewMode("quick")
      setAfterVerdict(
        buildAfterPlaceholder(
          "Your project memory is saved and ready.",
          [
            "Continue with Replit and come back after the next real project answer. reeva AI will start reviewing from that point forward."
          ],
          ""
        )
      )
      return
    }

    if (afterVerdict && sameChat && ((text && sameMessage) || (!text && sameDraftPrompt))) {
      setProjectContextReadyActive(false)
      setAfterPanelOpen(true)
      return
    }

    if (isReplitSurface() && text && !hasProjectMemory) {
      const pendingAttempt = await ensureSubmittedAttempt()
      if (pendingAttempt) {
        pendingContextAnalysisRef.current = {
          attempt: pendingAttempt,
          responseText: text,
          responseIdentity: latestMessageId,
          threadIdentity: threadSnapshot.identity
        }
      }

      setAfterPanelOpen(true)
      setProjectContextSetupActive(true)
      setProjectContextReadyActive(false)
      resetAfterNextStepFlow()
      setAfterDisplayedReviewMode("quick")
      setAfterVerdict(
        buildAfterPlaceholder(
          "Before I review this, I need project context so I don’t judge your work out of context.",
          [
            "Paste the Replit handoff below. After you save it, reeva AI will return to your latest project answer and review it automatically."
          ],
          ""
        )
      )
      setAfterAttempt(pendingAttempt)
      setAfterNextStepStarted(false)
      setAfterPlanningGoal("")
      setProjectMemoryDepth("deep")
      return
    }

    setProjectContextSetupActive(false)
    setProjectContextReadyActive(false)

    if (!text) {
      stopAfterLoadingProgress()
      const emptyVerdict = buildAfterPlaceholder(
        "There’s no AI answer to review yet.",
        ["Use the prompt planner below or send a prompt first."],
        ""
      )

      setAfterPanelOpen(true)
      resetAfterNextStepFlow()
      setAfterDisplayedReviewMode("quick")
      setAfterVerdict(emptyVerdict)
      setAfterAttempt(
        currentDraftPrompt
          ? buildPlanningAttemptFromDraft(
              currentDraftPrompt,
              getAttemptPlatform(),
              buildPlanningAttemptIntentFromPrompt({
                prompt: currentDraftPrompt,
                beforeIntent: beforeResult?.intent
              })
            )
          : null
      )
      setAfterNextStepStarted(true)
      setAfterPlanningGoal(currentDraftPrompt)

      if (currentDraftPrompt) {
        const planningAttempt = buildPlanningAttemptFromDraft(
          currentDraftPrompt,
          getAttemptPlatform(),
          buildPlanningAttemptIntentFromPrompt({
            prompt: currentDraftPrompt,
            beforeIntent: beforeResult?.intent
          })
        )
        const requestId = ++afterQuestionRequestIdRef.current
        setAfterAttempt(planningAttempt)
        setIsAddingAfterQuestions(true)

        try {
          const result = await fetchAfterNextQuestions(
            [],
            { planning_goal: currentDraftPrompt },
            1,
            "next_level",
            {
              attempt: planningAttempt,
              analysis: emptyVerdict,
              planningGoal: currentDraftPrompt,
              questionLevels: {}
            }
          )
          if (requestId !== afterQuestionRequestIdRef.current) return
          if (result?.questions.length) {
            setAfterQuestions(result.questions)
            setAfterQuestionHistory(result.questions)
            setAfterQuestionLevels(buildLevelMap(result.questions, result.next_level))
            setAfterQuestionLevel(result.next_level)
            setAfterActiveQuestionIndex(0)
          }
        } finally {
          if (requestId === afterQuestionRequestIdRef.current) {
            setIsAddingAfterQuestions(false)
          }
        }
      }

      return
    }

    setAfterPanelOpen(true)
    resetAfterNextStepFlow()
    setAfterAttempt(null)
    setAfterDisplayedReviewMode("quick")
    setAfterVerdict(
      buildAfterPlaceholder("Checking the latest change.")
    )
    setIsEvaluatingAfterResponse(true)
    startAfterLoadingProgress(shouldStartWithDeepReview ? "deep" : "quick")

    try {
      const opened = await runAfterEvaluation(true, shouldStartWithDeepReview)
      if (!opened) {
        setAfterVerdict(
          buildAfterPlaceholder(
            "reeva AI could not capture the latest AI answer yet.",
            ["Wait for the answer to finish, then click the thunder again."],
            "Please restate your final result, list the concrete changes you made, and verify whether the original request is now fully satisfied."
          )
        )
      }
    } catch (error) {
      setAfterVerdict(
        buildAfterPlaceholder(
          error instanceof Error ? error.message : "reeva AI hit a problem while analyzing the latest answer.",
          ["Try clicking the thunder again after the response fully settles."],
          "Analyze your last answer again. Tell me exactly what you changed, what remains missing, and give me the next focused prompt to continue."
        )
      )
    } finally {
      stopAfterLoadingProgress()
      setIsEvaluatingAfterResponse(false)
    }
  }

  async function handleRunDeepAnalysis() {
    if (!afterVerdict || isEvaluatingAfterResponse || isDeepAnalyzingAfterResponse) return

    const targetOverride = buildCurrentAfterTargetOverride()
    if (targetOverride) {
      const normalizedText = normalizeAssistantTextForReuse(targetOverride.responseText)
      const cachedReviews = isSameCachedAfterTarget(
        afterReviewCacheRef.current,
        targetOverride.threadIdentity,
        targetOverride.responseIdentity,
        normalizedText
      )
        ? afterReviewCacheRef.current
        : null

      if (cachedReviews?.deep) {
        setAfterDisplayedReviewMode("deep")
        setAfterVerdict(cachedReviews.deep)
        return
      }
    }

    setIsDeepAnalyzingAfterResponse(true)
    startAfterLoadingProgress("deep")

    try {
      const opened = await runAfterEvaluation(true, true, targetOverride ?? undefined)
      if (!opened) {
        setAfterVerdict(
          buildAfterPlaceholder(
            "reeva AI could not re-open the latest AI answer for a deeper review.",
            ["Wait for the answer to finish, then try Deep Analyze again."],
            afterVerdict.next_prompt
          )
        )
      }
    } catch (error) {
      setAfterVerdict(
        buildAfterPlaceholder(
          error instanceof Error ? error.message : "reeva AI could not complete a deeper review.",
          ["Try Deep Analyze again after the response fully settles."],
          afterVerdict.next_prompt
        )
      )
    } finally {
      stopAfterLoadingProgress()
      setIsDeepAnalyzingAfterResponse(false)
    }
  }

  async function handleSelectCodeAnalysisMode(mode: "quick" | "deep") {
    const currentReviewMode = afterDisplayedReviewMode

    if (mode === currentReviewMode || isEvaluatingAfterResponse || isDeepAnalyzingAfterResponse) return

    setCodeAnalysisModeState(mode)
    await setCodeAnalysisMode(mode)

    if (!afterVerdict) return

    const targetOverride = buildCurrentAfterTargetOverride()
    if (targetOverride) {
      const normalizedText = normalizeAssistantTextForReuse(targetOverride.responseText)
      const cachedReviews = isSameCachedAfterTarget(
        afterReviewCacheRef.current,
        targetOverride.threadIdentity,
        targetOverride.responseIdentity,
        normalizedText
      )
        ? afterReviewCacheRef.current
        : null

      const cachedResult = mode === "deep" ? cachedReviews?.deep : cachedReviews?.quick
      if (cachedResult) {
        setAfterDisplayedReviewMode(mode)
        setAfterVerdict(cachedResult)
        return
      }
    }

    if (mode === "deep") {
      await handleRunDeepAnalysis()
      return
    }

    setIsEvaluatingAfterResponse(true)
    startAfterLoadingProgress("quick")
    try {
      const opened = await runAfterEvaluation(true, false, targetOverride ?? undefined)
      if (!opened) {
        setAfterVerdict(
          buildAfterPlaceholder(
            "reeva AI could not reopen the latest AI answer for a quick review.",
            ["Try switching analysis mode again after the answer fully settles."],
            afterVerdict.next_prompt
          )
        )
      }
    } catch (error) {
      setAfterVerdict(
        buildAfterPlaceholder(
          error instanceof Error ? error.message : "reeva AI could not switch back to quick review.",
          ["Try switching analysis mode again after the answer fully settles."],
          afterVerdict.next_prompt
        )
      )
    } finally {
      stopAfterLoadingProgress()
      setIsEvaluatingAfterResponse(false)
    }
  }

  function getReviewPopupOrchestrator() {
    if (!reviewPopupOrchestratorRef.current) {
      reviewPopupOrchestratorRef.current = createReviewPopupOrchestrator({
        resolveTarget: getReviewTargetResolver(),
        runAnalysis: getReviewAnalysisRunner(),
        onStateChange: (nextState) => {
          setReviewPopupControllerState(nextState.controller)
          setReviewPopupViewModel(nextState.viewModel)
        },
        onOpenChange: setReviewPopupOpen,
        onCopyPrompt: (prompt) => {
          void submitReviewPopupPrompt(prompt)
        }
      })
    }

    return reviewPopupOrchestratorRef.current
  }

  function getReviewPromptModeOrchestrator() {
    if (!reviewPromptModeOrchestratorRef.current) {
      reviewPromptModeOrchestratorRef.current = createReviewPromptModeOrchestrator({
        getPlatform: () => getAttemptPlatform(),
        getSurface: () => getPromptSurface(),
        getSessionSummary: () => summarizeSessionMemory(currentSession) ?? null,
        getProjectMemoryContext: () => getCompactProjectMemory(),
        extendQuestions: (request) => extendQuestions(request),
        refinePrompt: (request) => refinePrompt(request),
        onStateChange: (nextState) => {
          setReviewPromptModeState(nextState)
        }
      })
    }

    return reviewPromptModeOrchestratorRef.current
  }

  function getReviewPromptModeV2Orchestrator() {
    if (!reviewPromptModeV2OrchestratorRef.current) {
      reviewPromptModeV2OrchestratorRef.current = createReviewPromptModeV2Orchestrator({
        getSurface: () => getPromptSurface(),
        getSessionSummary: () => summarizeSessionMemory(currentSession) ?? null,
        extendQuestions: (request) => extendQuestions(request),
        onStateChange: (nextState) => {
          setReviewPromptModeV2State(nextState)
        }
      })
    }

    return reviewPromptModeV2OrchestratorRef.current
  }

  async function handleOpenReviewPopup() {
    setPanelOpen(false)
    setAfterPanelOpen(false)
    const currentDraft = getCurrentDraftSnapshot().text.trim()
    if (reviewTypingState.active && hasUnsentPromptDraft(currentDraft)) {
      setReviewPopupSurface("prompt_mode")
      setReviewPopupOpen(true)
      await getReviewPromptModeOrchestrator().open({
        promptText: currentDraft,
        beforeIntent: beforeResult?.intent
      })
      return
    }

    setReviewPopupSurface("answer_mode")
    await getReviewPopupOrchestrator().open()
  }

  async function handleSwitchReviewPopupSurface(surface: ReviewPopupSurface) {
    if (surface === "prompt_mode") {
      const currentDraft = getCurrentDraftSnapshot().text.trim()
      if (!currentDraft) return
      setReviewPopupSurface("prompt_mode")
      setReviewPopupOpen(true)
      await getReviewPromptModeOrchestrator().open({
        promptText: currentDraft,
        beforeIntent: beforeResult?.intent
      })
      return
    }

    if (surface === "prompt_mode_v2") {
      const currentDraft = getCurrentDraftSnapshot().text.trim()
      if (!currentDraft) return
      setReviewPopupSurface("prompt_mode_v2")
      setReviewPopupOpen(true)
      await getReviewPromptModeV2Orchestrator().open({
        promptText: currentDraft,
        beforeIntent: beforeResult?.intent
      })
      return
    }

    setReviewPopupSurface("answer_mode")
    await getReviewPopupOrchestrator().open()
  }

  async function handleStartNextStep() {
    if (!hasRealAfterReview(afterVerdict)) return

    setAfterNextStepStarted(true)
  }

  async function handleBeginAfterDecisionTree() {
    if (!afterVerdict || !afterPlanningGoal.trim() || afterQuestions.length > 0) return

    const planningAttempt =
      afterAttempt ??
      buildPlanningAttemptFromDraft(
        afterPlanningGoal.trim(),
        getAttemptPlatform(),
        buildPlanningAttemptIntentFromPrompt({
          prompt: afterPlanningGoal.trim(),
          beforeIntent: beforeResult?.intent
        })
      )
    if (!afterAttempt) {
      setAfterAttempt(planningAttempt)
    }

    const requestId = ++afterQuestionRequestIdRef.current
    setIsAddingAfterQuestions(true)
    try {
      const result = await fetchAfterNextQuestions(
        [],
        { planning_goal: afterPlanningGoal.trim() },
        1,
        "next_level",
        {
          attempt: planningAttempt,
          analysis: afterVerdict,
          planningGoal: afterPlanningGoal.trim(),
          questionLevels: {}
        }
      )
      if (requestId !== afterQuestionRequestIdRef.current) return
      if (result?.questions.length) {
        const initialState = buildInitialPlannerState(result.questions, result.next_level)
        setAfterQuestions(initialState.currentLevelQuestions)
        setAfterQuestionHistory(initialState.questionHistory)
        setAfterQuestionLevels(initialState.questionLevels)
        setAfterQuestionLevel(initialState.currentLevel)
        setAfterActiveQuestionIndex(initialState.activeQuestionIndex)
      }
    } finally {
      if (requestId === afterQuestionRequestIdRef.current) {
        setIsAddingAfterQuestions(false)
      }
    }
  }

  async function handleSubmitPlanningGoalPrompt() {
    const draftSnapshot = getCurrentDraftSnapshot()
    if (!draftSnapshot.exists || !afterPlanningGoal.trim()) return

    const normalizedPlanningGoal = afterPlanningGoal.trim()
    lastStablePromptValueRef.current = normalizedPlanningGoal
    getActiveSurfaceAdapter().writeDraftPrompt(normalizedPlanningGoal)
    const sourcePrompt = promptPreview || getCurrentDraftSnapshot().text
    await saveDraftAttempt(sourcePrompt, afterPlanningGoal.trim())
    setAfterPanelOpen(false)
  }

  const suggestedDirectionChips = useMemo(() => {
    if (!afterVerdict || !afterVerdict.acceptance_checklist?.length) return []

    return buildSuggestedDirectionChips(afterVerdict, usedSuggestedDirectionChipIds)
  }, [afterVerdict, usedSuggestedDirectionChipIds])

  async function handleSuggestedDirectionClick(chipId: string) {
    if (!afterVerdict || !afterAttempt) return
    const chip = suggestedDirectionChips.find((item) => item.id === chipId)
    if (!chip) return

    setActiveSuggestedDirectionChipId(chipId)
    const currentDirection = afterPlanningGoal.trim()
    const actionVerb = chip.actionStyle === "fix" ? "fix" : "double-check and, if needed, fix"
    const rewritePrompt = buildSuggestedDirectionRewritePrompt({
      originalPrompt: afterAttempt.raw_prompt,
      acceptanceCriterion: chip.id,
      confidence: afterVerdict.confidence,
      actionStyle: chip.actionStyle,
      currentDirection
    })

    try {
      const result = await refinePrompt({
        prompt: rewritePrompt,
        surface: getPromptSurface(),
        intent: mapTaskTypeToPromptIntent(afterAttempt.intent.task_type),
        answers: {
          acceptance_criterion: chip.id,
          action_style: actionVerb,
          current_direction: currentDirection
        },
        sessionSummary: summarizeSessionMemory(currentSession)
      })

      const nextDirection = result.improved_prompt.trim()
      if (nextDirection) {
        setAfterPlanningGoal((current) => {
          return appendPlanningDirection(current, nextDirection)
        })
        setUsedSuggestedDirectionChipIds((current) => [...new Set([...current, chip.id])])
        showPlanningGoalNotice("Added to next step")
      }
    } catch {
      const fallbackDirection = buildSuggestedDirectionFallback({
        criterion: chip.id,
        actionStyle: chip.actionStyle
      })
      setAfterPlanningGoal((current) => {
        return appendPlanningDirection(current, fallbackDirection)
      })
      setUsedSuggestedDirectionChipIds((current) => [...new Set([...current, chip.id])])
      showPlanningGoalNotice("Added to next step")
    } finally {
      setActiveSuggestedDirectionChipId(null)
    }
  }

  function handleAfterAnswerChange(question: ClarificationQuestion, value: string) {
    const previousValue = afterAnswerState[question.id] ?? ""
    const previousResolvedValue = resolvePlannerAnswer(previousValue, afterOtherAnswerState[question.id], OTHER_OPTION)
    const nextResolvedValue = resolvePlannerAnswer(value, afterOtherAnswerState[question.id], OTHER_OPTION)
    const branchContext = buildPlannerBranchContext({
      questionId: question.id,
      questionHistory: afterQuestionHistory,
      questionLevels: afterQuestionLevels
    })

    setAfterAnswerState((current) => ({ ...current, [question.id]: value }))
    setAfterNextPromptReady(false)
    if (value !== OTHER_OPTION) {
      celebrateAnsweredQuestion(question.id)
    }

    if (
      shouldRebuildPlannerBranch({
        questionIndex: branchContext.questionIndex,
        totalQuestions: afterQuestionHistory.length,
        previousResolvedValue,
        nextResolvedValue
      })
    ) {
      pruneAfterBranchFromIndex(branchContext.questionIndex)
      if (value !== OTHER_OPTION) {
        void advanceAfterDecisionTree(question.id, value, {
          history: branchContext.keptHistory,
          currentLevelQuestions: branchContext.keptLevelQuestions,
          currentLevel: branchContext.activeLevel
        })
        return
      }
    }

    if (value === OTHER_OPTION) {
      return
    }
    void advanceAfterDecisionTree(question.id, value)
  }

  function handleAfterOtherAnswerChange(question: ClarificationQuestion, value: string) {
    setAfterOtherAnswerState((current) => ({ ...current, [question.id]: value }))
    setAfterNextPromptReady(false)
  }

  function handleAdvanceAfterQuestion() {
    const activeQuestion = afterQuestionHistory[afterActiveQuestionIndex] ?? afterQuestions[afterActiveQuestionIndex]
    if (!activeQuestion) return
    const typedOther = afterOtherAnswerState[activeQuestion.id]?.trim()
    if (!typedOther) return
    celebrateAnsweredQuestion(activeQuestion.id)

    const branchContext = buildPlannerBranchContext({
      questionId: activeQuestion.id,
      questionHistory: afterQuestionHistory,
      questionLevels: afterQuestionLevels
    })
    const previousValue = afterAnswerState[activeQuestion.id]
    const previousResolvedValue = resolvePlannerAnswer(
      previousValue,
      afterOtherAnswerState[activeQuestion.id],
      OTHER_OPTION
    )

    if (
      shouldRebuildPlannerBranch({
        questionIndex: branchContext.questionIndex,
        totalQuestions: afterQuestionHistory.length,
        previousResolvedValue,
        nextResolvedValue: typedOther
      })
    ) {
      pruneAfterBranchFromIndex(branchContext.questionIndex)
      void advanceAfterDecisionTree(activeQuestion.id, typedOther, {
        history: branchContext.keptHistory,
        currentLevelQuestions: branchContext.keptLevelQuestions,
        currentLevel: branchContext.activeLevel
      })
      return
    }

    void advanceAfterDecisionTree(activeQuestion.id, typedOther)
  }

  async function advanceAfterDecisionTree(
    questionId: string,
    resolvedValue: string,
    branchContext?: {
      history: ClarificationQuestion[]
      currentLevelQuestions: ClarificationQuestion[]
      currentLevel: number
    }
  ) {
    const visibleLevelQuestions = branchContext?.currentLevelQuestions ?? afterQuestions
    const visibleHistory = branchContext?.history ?? afterQuestionHistory
    const visibleLevel = branchContext?.currentLevel ?? afterQuestionLevel
    const advanceResult = buildPlannerAdvanceResult({
      questionId,
      resolvedValue,
      answerState: afterAnswerState,
      otherAnswerState: afterOtherAnswerState,
      visibleLevelQuestions,
      visibleHistory,
      visibleLevel,
      questionLevels: afterQuestionLevels,
      otherOption: OTHER_OPTION
    })

    if (advanceResult.kind === "advance_local") {
      setAfterActiveQuestionIndex(advanceResult.nextIndex)
      return
    }

    const requestId = ++afterQuestionRequestIdRef.current
    setIsAddingAfterQuestions(true)
    try {
      const result = await fetchAfterNextQuestions(
        advanceResult.askedQuestions,
        advanceResult.normalizedAnswers,
        advanceResult.currentLevel,
        "next_level",
        {
          questionLevels: advanceResult.questionLevels
        }
      )
      if (requestId !== afterQuestionRequestIdRef.current) return
      if (result?.questions.length) {
        setAfterQuestionHistory((current) => mergeUniqueQuestions(current, result.questions))
        setAfterQuestions(result.questions)
        setAfterQuestionLevels((current) => ({
          ...current,
          ...buildLevelMap(result.questions, result.next_level)
        }))
        setAfterQuestionLevel(result.next_level)
        setAfterActiveQuestionIndex(advanceResult.askedQuestions.length)
        return
      }
    } finally {
      if (requestId === afterQuestionRequestIdRef.current) {
        setIsAddingAfterQuestions(false)
      }
    }

    if (requestId === afterQuestionRequestIdRef.current) {
      setAfterActiveQuestionIndex((current) => Math.min(current, Math.max(0, visibleLevelQuestions.length - 1)))
    }
  }

  async function handleGenerateAfterNextPrompt() {
    if (!afterVerdict) return

    const draftSnapshot = getCurrentDraftSnapshot()
    const submittedPrompt =
      afterAttempt?.raw_prompt.trim() ||
      promptPreview.trim() ||
      draftSnapshot.text.trim() ||
      afterPlanningGoal.trim()
    if (!submittedPrompt) return

    const effectiveAttempt =
      afterAttempt ??
      buildPlanningAttemptFromDraft(
        submittedPrompt,
        getAttemptPlatform(),
        buildPlanningAttemptIntentFromPrompt({
          prompt: submittedPrompt,
          beforeIntent: beforeResult?.intent
        })
      )

    if (!afterAttempt) {
      setAfterAttempt(effectiveAttempt)
    }

    const answers = buildNextPromptAnswers({
      answerState: afterAnswerState,
      otherAnswerState: afterOtherAnswerState,
      otherOption: OTHER_OPTION,
      planningGoal: afterPlanningGoal
    })

    if (!Object.keys(answers).length) return

    const requestId = ++afterNextPromptRequestIdRef.current
    setIsGeneratingAfterNextPrompt(true)
    setAfterNextPromptReady(false)

    const orderedAnsweredPath = buildOrderedAnsweredPath({
      questionHistory: afterQuestionHistory,
      answerState: afterAnswerState,
      otherAnswerState: afterOtherAnswerState,
      otherOption: OTHER_OPTION
    })

    const { basePrompt, localFallback } = buildAfterNextPromptPlan({
      submittedPrompt,
      planningGoal: afterPlanningGoal,
      verdict: afterVerdict,
      answeredPath: orderedAnsweredPath,
      constraints: (effectiveAttempt.intent.constraints ?? []).map((item) => item.trim()).filter(Boolean),
      projectContext: projectContextDraft,
      currentState: currentStateDraft
    })

    try {
      const effectiveIntent =
        effectiveAttempt.intent.task_type

      const result = await refinePrompt({
        prompt: basePrompt,
        surface: getPromptSurface(),
        intent: mapTaskTypeToPromptIntent(effectiveIntent),
        answers,
        sessionSummary: summarizeSessionMemory(currentSession)
      })
      if (requestId !== afterNextPromptRequestIdRef.current) return
      setAfterNextPromptDraft(result.improved_prompt)
      setAfterNextPromptReady(true)
    } catch {
      if (requestId !== afterNextPromptRequestIdRef.current) return
      setAfterNextPromptDraft(localFallback)
      setAfterNextPromptReady(true)
    } finally {
      if (requestId === afterNextPromptRequestIdRef.current) {
        setIsGeneratingAfterNextPrompt(false)
      }
    }
  }

  async function handleSubmitAfterNextPrompt() {
    const draftSnapshot = getCurrentDraftSnapshot()
    if (!draftSnapshot.exists || !afterNextPromptReady || !afterNextPromptDraft.trim()) return

    const normalizedNextPrompt = afterNextPromptDraft.trim()
    lastStablePromptValueRef.current = normalizedNextPrompt
    getActiveSurfaceAdapter().writeDraftPrompt(normalizedNextPrompt)
    const sourcePrompt = promptPreview || getCurrentDraftSnapshot().text
    if (projectMemoryKey && projectMemoryLabel && hasProjectMemory && projectMemoryAwaitingFreshAnswerRef.current) {
      projectMemoryAwaitingFreshAnswerRef.current = false
      projectMemoryBaselineResponseRef.current = null
      await saveProjectMemory({
        projectKey: projectMemoryKey,
        projectLabel: projectMemoryLabel,
        projectContext: projectContextDraft,
        currentState: currentStateDraft,
        memoryDepth: projectMemoryDepth,
        awaitingFreshAnswer: false,
        baselineResponseIdentity: "",
        baselineResponseText: "",
        baselineThreadIdentity: ""
      })
    }
    await saveDraftAttempt(sourcePrompt, afterNextPromptDraft.trim())
    setAfterPanelOpen(false)
  }

  async function handleSubmitReviewPromptModeDraft() {
    const draftSnapshot = getCurrentDraftSnapshot()
    if (!draftSnapshot.exists || !reviewPromptModeState.promptReady || !reviewPromptModeState.promptDraft.trim()) return

    const normalizedPrompt = reviewPromptModeState.promptDraft.trim()
    const sourcePrompt =
      reviewPromptModeState.sourcePrompt.trim() || draftSnapshot.text.trim() || promptPreview.trim() || normalizedPrompt

    lastStablePromptValueRef.current = normalizedPrompt
    getActiveSurfaceAdapter().writeDraftPrompt(normalizedPrompt)
    setPromptPreview(normalizedPrompt.slice(0, 220))
    updateReviewTypingState(normalizedPrompt)
    await saveDraftAttempt(sourcePrompt, normalizedPrompt)
    setReviewPopupOpen(false)
  }

  async function handleSaveProjectMemory() {
    if (!projectMemoryKey || !projectMemoryLabel) return
    const parsed = parseProjectHandoffMarkdown(projectHandoffDraft)
    if (!(parsed.projectContext.trim() || parsed.currentState.trim())) return
    setIsSavingProjectMemory(true)
    try {
      const currentAssistant = getCurrentAssistantResponseText()
      const currentThreadIdentity = getCurrentThreadSnapshot().identity
      await saveProjectMemory({
        projectKey: projectMemoryKey,
        projectLabel: projectMemoryLabel,
        projectContext: parsed.projectContext,
        currentState: parsed.currentState,
        memoryDepth: projectMemoryDepth,
        awaitingFreshAnswer: true,
        baselineResponseIdentity: currentAssistant.identity,
        baselineResponseText: currentAssistant.text,
        baselineThreadIdentity: currentThreadIdentity
      })
      setProjectContextDraft(parsed.projectContext)
      setCurrentStateDraft(parsed.currentState)
      setProjectHandoffDraft(buildProjectHandoffMarkdown(parsed.projectContext, parsed.currentState))
      setHasProjectMemory(Boolean(parsed.projectContext.trim() || parsed.currentState.trim()))
      setProjectContextSetupActive(false)
      projectMemoryAwaitingFreshAnswerRef.current = true
      projectMemoryBaselineResponseRef.current = {
        identity: currentAssistant.identity,
        normalizedText: normalizeAssistantTextForReuse(currentAssistant.text),
        threadIdentity: currentThreadIdentity
      }
      showPlanningGoalNotice("Project memory saved")

      pendingContextAnalysisRef.current = null
      resetAfterNextStepFlow()
      setAfterPanelOpen(true)
      setIsEvaluatingAfterResponse(false)
      await showProjectContextAssimilationStep()
      stopAfterLoadingProgress()
      setProjectContextReadyActive(true)
    } finally {
      setIsSavingProjectMemory(false)
    }
  }

  async function handleCopyProjectContextRequest() {
    await navigator.clipboard.writeText(
      projectMemoryDepth === "deep"
        ? buildReplitDeepContextRequestPrompt(projectMemoryLabel || "project")
        : REPLIT_CONTEXT_REQUEST_PROMPT
    )
    showPlanningGoalNotice(projectMemoryDepth === "deep" ? "Deep context request copied" : "Quick context request copied")
  }

  async function handleSubmit(source = "unknown", inputOverride?: HTMLElement | null) {
    const input = inputOverride ?? promptRef.current ?? findPromptInput()
    if (!input) {
      logReviewDebug("send detected but no prompt input was available", { source })
      return
    }

    if (promptRef.current !== input) {
      promptRef.current = input
      lastFocusedPromptRef.current = input
      submitRef.current = findSubmitButton(input)
    }

    const prompt = readPromptValue(input).trim()
    logReviewDebug("send detected", { source, promptLength: prompt.length })
    if (!prompt) {
      logReviewDebug("send ignored because prompt was empty", { source })
      return
    }

    const now = Date.now()
    const lastDetectedSend = lastDetectedSendRef.current
    if (lastDetectedSend && lastDetectedSend.prompt === prompt && now - lastDetectedSend.at < SEND_DETECTION_DEDUPE_MS) {
      logReviewDebug("duplicate send detection suppressed", {
        source,
        promptLength: prompt.length,
        elapsedMs: now - lastDetectedSend.at
      })
      return
    }
    lastDetectedSendRef.current = { prompt, at: now }
    logReviewDebug("captured prompt for submitted attempt", {
      source,
      promptLength: prompt.length,
      promptPreview: prompt.slice(0, 120)
    })

    lastSubmittedOrAppliedPromptRef.current = prompt
    updateReviewTypingState("")
    submittedAssistantBaselineKeyRef.current = buildLiveAssistantSignalKey()
    awaitingFreshReviewAnswerRef.current = true
    lastObservedAssistantSignalKeyRef.current = submittedAssistantBaselineKeyRef.current
    lastSettledAssistantSignalKeyRef.current = ""
    reviewSignalCacheRef.current = null
    reviewPopupOrchestratorRef.current?.invalidate()
    setReviewSignal(createLoadingReviewSignal(null))

    lastStablePromptValueRef.current = prompt

    const retryCount =
      pendingPromptRef.current && now - pendingPromptRef.current.sentAt < DETECTION_THRESHOLDS.retryWindowMs
        ? currentSession.retryCount + 1
        : currentSession.retryCount

    pendingPromptRef.current = buildPendingPrompt({
      prompt,
      intent: beforeResult?.intent ?? "OTHER",
      now
    })
    if (projectMemoryKey && projectMemoryLabel && hasProjectMemory && projectMemoryAwaitingFreshAnswerRef.current) {
      projectMemoryAwaitingFreshAnswerRef.current = false
      projectMemoryBaselineResponseRef.current = null
      await saveProjectMemory({
        projectKey: projectMemoryKey,
        projectLabel: projectMemoryLabel,
        projectContext: projectContextDraft,
        currentState: currentStateDraft,
        memoryDepth: projectMemoryDepth,
        awaitingFreshAnswer: false,
        baselineResponseIdentity: "",
        baselineResponseText: "",
        baselineThreadIdentity: ""
      })
    }
    const activeAttempt = await getActiveAttempt()
    if (activeAttempt) {
      const submittedAttempt = await markAttemptSubmitted(
        activeAttempt.attempt_id,
        buildSubmittedAttemptPatch({
          prompt,
          beforeIntent: beforeResult?.intent
        })
      )
      logReviewDebug("submitted attempt marked from active attempt", {
        source,
        attemptId: submittedAttempt?.attempt_id ?? activeAttempt.attempt_id,
        promptLength: prompt.length
      })
    } else {
      const fallbackAttempt = await createAttempt(
        buildFallbackSubmittedAttemptInput({
          prompt,
          platform: getAttemptPlatform(),
          beforeIntent: beforeResult?.intent
        })
      )
      const submittedAttempt = await markAttemptSubmitted(fallbackAttempt.attempt_id)
      logReviewDebug("submitted attempt created from fallback", {
        source,
        attemptId: submittedAttempt?.attempt_id ?? fallbackAttempt.attempt_id,
        promptLength: prompt.length
      })
    }
    setAfterVerdict(null)
    setAfterPanelOpen(false)
    resetAfterNextStepFlow()
    latestAssistantNodeRef.current = null
    setHasSubmittedPrompt(true)

    const nextSession = buildSessionAfterSubmit({
      currentSession,
      prompt,
      rewrite: beforeResult?.rewrite,
      intent: beforeResult?.intent,
      retryCount
    })

    setSession(nextSession)
    await saveSessionSummary(nextSession)

    if (retryTimeoutRef.current) {
      window.clearTimeout(retryTimeoutRef.current)
    }

    retryTimeoutRef.current = window.setTimeout(() => {
      // Delay the outcome check slightly so we inspect only visible results, not transient UI churn.
      void inspectOutcome()
    }, 3500)
  }

  async function inspectOutcome() {
    if (!pendingPromptRef.current) return

    const outputSnippet = collectVisibleOutputSnippet()
    const errorSummary = collectVisibleErrorSummary()
    const changedFiles = collectChangedFilesSummary()
    const result = await detectOutcome({
      ...buildDetectOutcomePayload({
        currentSession,
        pendingPrompt: pendingPromptRef.current,
        optimizedPrompt: beforeResult?.rewrite ?? null,
        strengthScore: beforeResult?.score ?? "MID",
        outputSnippet,
        errorSummary,
        changedFiles
      })
    })

    setDetection(result)
    outcomeEventIdRef.current = result.outcome_event_id
    setIssueVisible(result.should_suggest_diagnosis)

    const nextSession = buildSessionAfterOutcome({
      currentSession,
      lastIssueDetected: result.concise_issue,
      lastProbableStatus: result.probable_status
    })
    setSession(nextSession)
    await saveSessionSummary(nextSession)
  }

  async function handleExplain() {
    if (!pendingPromptRef.current) return
    const changedFiles = collectChangedFilesSummary()

    const result = await diagnoseFailure({
      session_id: currentSession.sessionId,
      prompt_id: pendingPromptRef.current.id,
      outcome_event_id: outcomeEventIdRef.current ?? undefined,
      final_sent_prompt: pendingPromptRef.current.prompt,
      prompt_intent: pendingPromptRef.current.intent,
      output_snippet: collectVisibleOutputSnippet(),
      error_summary: collectVisibleErrorSummary(),
      changed_files_count: changedFiles.length,
      changed_file_paths_summary: changedFiles,
      detection_flags: detection?.detection_flags ?? {
        retry_pattern: currentSession.retryCount > 0,
        error_detected: Boolean(collectVisibleErrorSummary()),
        scope_drift: false,
        possible_vagueness: false,
        looping_behavior: currentSession.retryCount >= 2,
        overreach_detected: false
      },
      sessionSummary: summarizeSessionMemory(currentSession)
    })

    setDiagnosis(result)
    setPanelOpen(true)
    setIssueVisible(false)
  }

  function handleRewrite() {
    const input = promptRef.current
    if (!input || !beforeResult?.rewrite) return
    writePromptValue(input, beforeResult.rewrite)
    void saveDraftAttempt(promptPreview || beforeResult.rewrite, beforeResult.rewrite)
    setPanelOpen(false)
  }

  function handleReplacePrompt() {
    const input = promptRef.current
    if (!draftReady || !input || !editableDraft.trim()) return
    writePromptValue(input, editableDraft.trim())
    const sourcePrompt = promptPreview || readPromptValue(input)
    void saveDraftAttempt(sourcePrompt, editableDraft.trim())
    setPanelOpen(false)
  }

  function normalizeAnswers(
    baseAnswers: Record<string, string | string[]>,
    baseOtherAnswers: Record<string, string> = otherAnswerState
  ) {
    const normalizedEntries = Object.entries(baseAnswers).flatMap(([questionId, value]) => {
      const otherValue = baseOtherAnswers[questionId]?.trim() ?? ""

      if (Array.isArray(value)) {
        const withoutOther = value.filter((item) => item !== OTHER_OPTION)
        const normalizedArray = otherValue ? [...withoutOther, otherValue] : withoutOther
        return normalizedArray.length ? [[questionId, normalizedArray] as const] : []
      }

      if (value === OTHER_OPTION) {
        return otherValue ? [[questionId, otherValue] as const] : []
      }

      return typeof value === "string" && value.trim() ? [[questionId, value] as const] : []
    })

    return Object.fromEntries(normalizedEntries) as Record<string, string | string[]>
  }

  async function handleGenerateAiDraft(answerOverride?: Record<string, string | string[]>) {
    if (!beforeResult) return
    setIsGeneratingDraft(true)
    const answers = normalizeAnswers(answerOverride ?? answerState)

    try {
      const sourcePrompt = promptRef.current ? readPromptValue(promptRef.current) : promptPreview
      const result = await refinePrompt({
        prompt: sourcePrompt || promptPreview,
        surface: getPromptSurface(),
        intent: beforeResult.intent,
        answers,
        sessionSummary: summarizeSessionMemory(currentSession)
      })
      setEditableDraft(result.improved_prompt)
      setAiDraftNotes(result.notes)
      setDraftReady(true)
    } catch {
      const sourcePrompt = promptRef.current ? readPromptValue(promptRef.current) : promptPreview
      setEditableDraft(buildPromptFromAnswers(sourcePrompt || promptPreview, answers))
      setAiDraftNotes(["AI draft generation failed, so a local fallback draft was created."])
      setDraftReady(true)
    } finally {
      setIsGeneratingDraft(false)
    }
  }

  async function handleAddQuestions() {
    if (!beforeResult) return
    setIsAddingQuestions(true)
    setQuestionLoadError(null)

    try {
      const sourcePrompt = promptRef.current ? readPromptValue(promptRef.current).trim() : promptPreview.trim()
      const result = await extendQuestions({
        prompt: sourcePrompt || promptPreview,
        surface: getPromptSurface(),
        intent: beforeResult.intent,
        existing_questions: beforeResult.clarification_questions,
        answers: normalizeAnswers(answerState),
        sessionSummary: summarizeSessionMemory(currentSession)
      })

      if (result.clarification_questions.length) {
        setBeforeResult({
          ...beforeResult,
          clarification_questions: [...beforeResult.clarification_questions, ...result.clarification_questions],
          question_source: "AI",
          ai_available: result.ai_available
        })
      } else {
        setQuestionLoadError("No more strong follow-up questions were available for this prompt yet.")
      }
    } catch (error) {
      setQuestionLoadError(error instanceof Error ? error.message : "Could not load more questions.")
    } finally {
      setIsAddingQuestions(false)
    }
  }

  function handleApplyFix() {
    const input = promptRef.current
    if (!input || !diagnosis?.improved_retry_prompt) return
    writePromptValue(input, diagnosis.improved_retry_prompt)
    setPanelOpen(false)
  }

  async function handleCopyFix() {
    if (!diagnosis?.improved_retry_prompt) return
    await navigator.clipboard.writeText(diagnosis.improved_retry_prompt)
  }

  function handleRetry() {
    handleApplyFix()
    setPanelOpen(false)
  }

  async function markWorked() {
    if (outcomeEventIdRef.current) {
      await sendFeedback(outcomeEventIdRef.current, "WORKED")
    }
    const nextSession = buildSessionAfterOutcome({
      currentSession,
      lastIssueDetected: currentSession.lastIssueDetected,
      lastProbableStatus: "SUCCESS"
    })
    setSession(nextSession)
    await saveSessionSummary(nextSession)
    setIssueVisible(false)
    setPanelOpen(false)
  }

  async function markDidNotWork() {
    if (outcomeEventIdRef.current) {
      await sendFeedback(outcomeEventIdRef.current, "DID_NOT_WORK")
    }
    setIssueVisible(true)
    setPanelOpen(true)
  }

  async function dismissOnboarding() {
    setOnboardingVisible(false)
    setPanelOpen(false)
    await markOnboardingSeen()
  }

  const displayedReviewSignal = reviewTypingState.active
    ? mapPreflightAssessmentToTypingSignal({
        assessment: reviewTypingState.preflight ?? {
          riskLevel: "low",
          signals: [],
          topSignal: null,
          summary: "Shape this prompt before sending"
        },
        promptKey: reviewTypingState.sessionKey
      })
    : reviewSignal

  const reviewPopupSurfaceActions: {
    id: string
    label: string
    kind?: "primary" | "secondary" | "ghost"
    onClick?: () => void
  }[] = [
    {
      id: "prompt-mode",
      label: "Prompt",
      kind: reviewPopupSurface === "prompt_mode" ? "primary" : "secondary",
      onClick: () => void handleSwitchReviewPopupSurface("prompt_mode")
    },
    {
      id: "answer-mode",
      label: "Answer",
      kind: reviewPopupSurface === "answer_mode" ? "primary" : "secondary",
      onClick: () => void handleSwitchReviewPopupSurface("answer_mode")
    }
  ]

  const reviewPromptActions =
    reviewPromptModeState.promptReady && reviewPromptModeState.promptDraft.trim()
      ? [
          {
            id: "submit-prompt-mode-draft",
            label: "Submit prompt",
            kind: "primary" as const,
            onClick: () => void handleSubmitReviewPromptModeDraft()
          }
        ]
      : []

  const reviewPromptQuestions = reviewPromptModeState.questionHistory.length
    ? reviewPromptModeState.questionHistory
    : reviewPromptModeState.currentLevelQuestions
  const reviewPromptModeV2Questions = reviewPromptModeV2State.questionHistory

  async function syncPromptFromPage() {
    const latestInput = findPromptInput()
    if (latestInput) {
      promptRef.current = latestInput
      lastFocusedPromptRef.current = latestInput
      submitRef.current = findSubmitButton(latestInput)
      positionHost()
    }

    const sourceInput = latestInput ?? lastFocusedPromptRef.current ?? promptRef.current
    const prompt = sourceInput ? readPromptValue(sourceInput).trim() : lastPromptValueRef.current.trim()

    setPromptPreview(prompt.slice(0, 220))
    updateReviewTypingState(prompt)

    if (!prompt) {
      setBeforeResult(null)
      setIsAnalyzingPrompt(false)
      setQuestionLoadError(null)
      return null
    }

    const normalizedPrompt = prompt.trim()
    const alreadyAnalyzedSamePrompt = normalizedPrompt === lastAnalyzedPromptRef.current && beforeResult !== null
    if (alreadyAnalyzedSamePrompt) {
      setIsAnalyzingPrompt(false)
      return {
        prompt: normalizedPrompt,
        result: beforeResult
      }
    }

    const requestId = ++analysisRequestIdRef.current
    setIsAnalyzingPrompt(true)
    const result = analyzePromptLocally(prompt, summarizeSessionMemory(currentSession))

    if (requestId !== analysisRequestIdRef.current) {
      return
    }

    setBeforeResult(result)
    setAnswerState({})
    setOtherAnswerState({})
    setAiDraftNotes([])
    setEditableDraft("")
    setDraftReady(false)
    lastAnalyzedPromptRef.current = normalizedPrompt
    setIsAnalyzingPrompt(false)
    return {
      prompt: normalizedPrompt,
      result
    }
  }

  async function loadAiQuestionsForCurrentPrompt(sourcePrompt: string, current: AnalyzePromptResponse | null) {
    if (!current) return
    if (current.question_source === "AI" && current.clarification_questions.length > 0) return
    if (isLoadingQuestions) return

    setIsLoadingQuestions(true)
    setQuestionLoadError(null)

    try {
      let nextQuestions: AnalyzePromptResponse["clarification_questions"] = []
      let nextQuestionSource: AnalyzePromptResponse["question_source"] = "NONE"
      let nextAiAvailable = false
      let nextScore = current.score
      let nextIntent = current.intent
      let nextMissing = current.missing_elements
      let nextSuggestions = current.suggestions
      let nextRewrite = current.rewrite

      try {
        const extendResult = await extendQuestions({
          prompt: sourcePrompt,
          surface: getPromptSurface(),
          intent: current.intent,
          existing_questions: [],
          answers: {},
          sessionSummary: summarizeSessionMemory(currentSession)
        })

        nextQuestions = extendResult.clarification_questions.slice(0, 5)
        nextQuestionSource = extendResult.clarification_questions.length
          ? extendResult.ai_available
            ? "AI"
            : "FALLBACK"
          : "NONE"
        nextAiAvailable = extendResult.ai_available
      } catch (error) {
        nextAiAvailable = false
        setQuestionLoadError(error instanceof Error ? error.message : "AI question loading failed")
      }

      if (!nextAiAvailable) {
        try {
          const analyzeResult = await analyzePromptRemote({
            prompt: sourcePrompt,
            surface: getPromptSurface(),
            sessionSummary: summarizeSessionMemory(currentSession)
          })

          nextScore = analyzeResult.score
          nextIntent = analyzeResult.intent
          nextMissing = analyzeResult.missing_elements
          nextSuggestions = analyzeResult.suggestions
          nextRewrite = analyzeResult.rewrite

          if (analyzeResult.clarification_questions.length) {
            nextQuestions = analyzeResult.clarification_questions.slice(0, 5)
            nextQuestionSource = analyzeResult.ai_available ? "AI" : "FALLBACK"
            nextAiAvailable = analyzeResult.ai_available
            setQuestionLoadError(null)
          }
        } catch (error) {
          setQuestionLoadError((currentError) =>
            currentError ?? (error instanceof Error ? error.message : "AI question loading failed")
          )
          // Keep the local score-only state if both AI calls fail.
        }
      }

      setBeforeResult((previous) => {
        if (!previous) return previous

        return {
          ...previous,
          score: nextScore,
          intent: nextIntent,
          missing_elements: nextMissing,
          suggestions: nextSuggestions,
          rewrite: nextRewrite,
          clarification_questions: nextQuestions,
          question_source: nextQuestions.length ? nextQuestionSource : "NONE",
          ai_available: nextAiAvailable
        }
      })
    } finally {
      setIsLoadingQuestions(false)
    }
  }

  function updateDraft(
    nextAnswers: Record<string, string | string[]>,
    basePrompt?: string,
    nextOtherAnswers: Record<string, string> = otherAnswerState
  ) {
    const currentInput = promptRef.current ? readPromptValue(promptRef.current) : ""
    const sourcePrompt = basePrompt ?? currentInput ?? promptPreview
    setEditableDraft(buildPromptFromAnswers(sourcePrompt || promptPreview, normalizeAnswers(nextAnswers, nextOtherAnswers)))
  }

  function handleAnswerChange(question: ClarificationQuestion, value: string) {
    const nextAnswers = {
      ...answerState,
      [question.id]: value
    }
    setAnswerState(nextAnswers)
    setDraftReady(false)
    setAiDraftNotes([])
    updateDraft(nextAnswers)
  }

  function handleToggleMultiAnswer(question: ClarificationQuestion, value: string) {
    const currentValues = Array.isArray(answerState[question.id]) ? (answerState[question.id] as string[]) : []
    const nextValues = currentValues.includes(value)
      ? currentValues.filter((item) => item !== value)
      : [...currentValues, value]

    const nextAnswers = {
      ...answerState,
      [question.id]: nextValues
    }
    setAnswerState(nextAnswers)
    setDraftReady(false)
    setAiDraftNotes([])
    updateDraft(nextAnswers)
  }

  function handleOtherAnswerChange(question: ClarificationQuestion, value: string) {
    const nextOtherAnswers = {
      ...otherAnswerState,
      [question.id]: value
    }

    setOtherAnswerState(nextOtherAnswers)
    setDraftReady(false)
    setAiDraftNotes([])
    updateDraft(answerState, undefined, nextOtherAnswers)
  }

  function isAnswered(
    question: ClarificationQuestion,
    answers: Record<string, string | string[]>,
    otherAnswers: Record<string, string> = otherAnswerState
  ) {
    const value = answers[question.id]
    const otherValue = otherAnswers[question.id]?.trim() ?? ""
    return question.mode === "multi"
      ? Array.isArray(value) && value.length > 0 && (!value.includes(OTHER_OPTION) || otherValue.length > 0)
      : typeof value === "string" && value.trim().length > 0 && (value !== OTHER_OPTION || otherValue.length > 0)
  }

  function positionHost() {
    const host = document.getElementById("prompt-optimizer-root")
    const input = promptRef.current
    const submitButton = submitRef.current
    if (!host) return

    if (popupOpenRef.current && frozenHostPositionRef.current) {
      host.style.position = "absolute"
      host.style.top = frozenHostPositionRef.current.top
      host.style.left = frozenHostPositionRef.current.left
      host.style.right = "auto"
      host.style.opacity = "1"
      host.style.pointerEvents = "auto"
      return
    }

    if (!input) {
      host.style.opacity = "0"
      host.style.pointerEvents = "none"
      return
    }

    host.style.opacity = "1"
    host.style.pointerEvents = "auto"

    if (submitButton) {
      const inputRect = input.getBoundingClientRect()
      const badgeTop = window.scrollY + inputRect.top - 26
      const badgeLeft = window.scrollX + inputRect.right - 28
      host.style.position = "absolute"
      host.style.top = `${badgeTop}px`
      host.style.left = `${badgeLeft}px`
      host.style.right = "auto"
      return
    }

    const rect = input.getBoundingClientRect()
    host.style.position = "absolute"
    host.style.top = `${window.scrollY + rect.top - 26}px`
    host.style.left = `${window.scrollX + rect.right - 28}px`
    host.style.right = "auto"
  }

  return (
    <>
        <OptimizerShell
          mounted={mounted}
          panelOpen={panelOpen}
          afterPanelOpen={afterPanelOpen}
          reviewPopupOpen={reviewPopupOpen}
          reviewSignal={displayedReviewSignal}
          promptPreview={promptPreview}
        beforeResult={beforeResult}
        isAnalyzingPrompt={isAnalyzingPrompt}
        diagnosis={diagnosis}
        detection={detection}
        session={session}
        onboardingVisible={onboardingVisible}
        issueVisible={hasSubmittedPrompt && issueVisible}
        answerState={answerState}
        otherAnswerState={otherAnswerState}
        editableDraft={editableDraft}
        aiDraftNotes={aiDraftNotes}
        isGeneratingDraft={isGeneratingDraft}
        isAddingQuestions={isAddingQuestions}
        answeredCount={
          (beforeResult?.clarification_questions ?? []).filter((question) =>
            isAnswered(question, answerState, otherAnswerState)
          ).length
        }
        totalQuestions={beforeResult?.clarification_questions?.length ?? 0}
        draftReady={draftReady}
        isLoadingQuestions={isLoadingQuestions}
        isEvaluatingAfterResponse={isEvaluatingAfterResponse}
        onClosePanel={() => setPanelOpen(false)}
        onOpenPanel={() => {
          reviewPopupOrchestratorRef.current?.close()
          setReviewPopupOpen(false)
          void syncPromptFromPage().then((snapshot) => {
            if (!snapshot) return
            void loadAiQuestionsForCurrentPrompt(snapshot.prompt, snapshot.result)
          })
          setPanelOpen(true)
        }}
        onOpenAfterPanel={() => {
          reviewPopupOrchestratorRef.current?.close()
          setReviewPopupOpen(false)
          void handleOpenAfterPanel()
        }}
        onOpenReviewPopup={() => void handleOpenReviewPopup()}
        onRewrite={handleRewrite}
        onExplain={() => void handleExplain()}
        onApplyFix={handleApplyFix}
        onCopyFix={() => void handleCopyFix()}
        onRetry={handleRetry}
        onDismissOnboarding={() => void dismissOnboarding()}
        onWorked={() => void markWorked()}
        onDidNotWork={() => void markDidNotWork()}
        onAnswerChange={handleAnswerChange}
        onToggleMultiAnswer={handleToggleMultiAnswer}
        onOtherAnswerChange={handleOtherAnswerChange}
        onDraftChange={setEditableDraft}
        onReplacePrompt={handleReplacePrompt}
        onGenerateAiDraft={() => void handleGenerateAiDraft()}
        onAddQuestions={() => void handleAddQuestions()}
      />
      {afterVerdict && afterPanelOpen ? (
        <AfterVerdictPanel
          verdict={afterVerdict}
          isEvaluating={isEvaluatingAfterResponse}
          isDeepAnalyzing={isDeepAnalyzingAfterResponse}
          loadingProgress={afterLoadingProgress}
          codeAnalysisMode={codeAnalysisMode}
          displayedReviewMode={afterDisplayedReviewMode}
          nextStepStarted={afterNextStepStarted}
          planningGoal={afterPlanningGoal}
          planningGoalNotice={planningGoalNotice}
          suggestedDirectionChips={suggestedDirectionChips}
          activeSuggestionChipId={activeSuggestedDirectionChipId}
          hasUsedSuggestedDirection={usedSuggestedDirectionChipIds.length > 0}
          recentlyAnsweredQuestionId={recentlyAnsweredAfterQuestionId}
          nextQuestionHistory={afterQuestionHistory}
          nextQuestions={afterQuestions}
          nextAnswerState={afterAnswerState}
          nextOtherAnswerState={afterOtherAnswerState}
          activeNextQuestionIndex={afterActiveQuestionIndex}
          isAddingNextQuestions={isAddingAfterQuestions}
          isGeneratingNextPrompt={isGeneratingAfterNextPrompt}
          nextPromptDraft={afterNextPromptDraft}
          nextPromptReady={afterNextPromptReady}
          projectContextSetupActive={projectContextSetupActive}
          projectContextReadyActive={projectContextReadyActive}
          projectMemoryEnabled={isReplitSurface()}
          projectMemoryExists={hasProjectMemory}
          projectMemoryLabel={projectMemoryLabel}
          projectMemoryDepth={projectMemoryDepth}
          projectHandoffDraft={projectHandoffDraft}
          isSavingProjectMemory={isSavingProjectMemory}
          onRunDeepAnalysis={() => void handleRunDeepAnalysis()}
          onSelectCodeAnalysisMode={(mode) => void handleSelectCodeAnalysisMode(mode)}
          onStartNextStep={() => void handleStartNextStep()}
          onPlanningGoalChange={setAfterPlanningGoal}
          onSuggestedDirectionClick={(chipId) => void handleSuggestedDirectionClick(chipId)}
          onBeginDecisionTree={() => void handleBeginAfterDecisionTree()}
          onSubmitPlanningGoalPrompt={() => void handleSubmitPlanningGoalPrompt()}
          onNextAnswerChange={(question, value) => handleAfterAnswerChange(question, value)}
          onNextOtherAnswerChange={(question, value) => handleAfterOtherAnswerChange(question, value)}
          onNextQuestionIndexChange={setAfterActiveQuestionIndex}
          onAdvanceNextQuestion={() => handleAdvanceAfterQuestion()}
          onNextPromptDraftChange={setAfterNextPromptDraft}
          onGenerateNextPrompt={() => void handleGenerateAfterNextPrompt()}
          onSubmitNextPrompt={() => void handleSubmitAfterNextPrompt()}
          onProjectHandoffChange={setProjectHandoffDraft}
          onProjectMemoryDepthChange={setProjectMemoryDepth}
          onCopyProjectContextRequest={() => void handleCopyProjectContextRequest()}
          onSaveProjectMemory={() => void handleSaveProjectMemory()}
          onClose={() => {
            setAfterPanelOpen(false)
            setProjectContextSetupActive(false)
            setProjectContextReadyActive(false)
          }}
        />
      ) : null}
      <ReviewPopupContainer
        open={reviewPopupOpen}
        surface={reviewPopupSurface}
        viewModel={reviewPopupViewModel}
        promptModeState={reviewPromptModeState}
        promptModeV2State={reviewPromptModeV2State}
        surfaceActions={reviewPopupSurfaceActions}
        promptActions={reviewPromptActions}
        onPromptQuestionIndexChange={(index) => getReviewPromptModeOrchestrator().setActiveQuestionIndex(index)}
        onPromptAnswerChange={(questionId, value) => {
          const question = reviewPromptQuestions.find((item) => item.id === questionId)
          if (!question) return
          void getReviewPromptModeOrchestrator().setAnswer(question, value)
        }}
        onPromptToggleMultiAnswer={(questionId, value) => {
          const question = reviewPromptQuestions.find((item) => item.id === questionId)
          if (!question) return
          const existing = reviewPromptModeState.answerState[questionId]
          const next = Array.isArray(existing)
            ? existing.includes(value)
              ? existing.filter((item) => item !== value)
              : [...existing, value]
            : [value]
          getReviewPromptModeOrchestrator().setAnswerDraft(question, next)
        }}
        onPromptOtherAnswerChange={(questionId, value) => {
          const question = reviewPromptQuestions.find((item) => item.id === questionId)
          if (!question) return
          getReviewPromptModeOrchestrator().setOtherAnswer(question, value)
        }}
        onPromptAdvanceOther={() => void getReviewPromptModeOrchestrator().advanceOther()}
        onPromptGenerate={() => void getReviewPromptModeOrchestrator().generatePrompt()}
        onPromptV2TaskTypeSelect={(taskType) => getReviewPromptModeV2Orchestrator().selectTaskType(taskType)}
        onPromptV2ContinueFromEntry={() => getReviewPromptModeV2Orchestrator().continueFromEntry()}
        onPromptV2QuestionIndexChange={(index) => getReviewPromptModeV2Orchestrator().setActiveQuestionIndex(index)}
        onPromptV2QuestionAnswerChange={(questionId, value) => {
          const question = reviewPromptModeV2Questions.find((item) => item.id === questionId)
          if (!question) return
          void getReviewPromptModeV2Orchestrator().setAnswer(question, value)
        }}
        onPromptV2QuestionMultiToggle={(questionId, value) => {
          const question = reviewPromptModeV2Questions.find((item) => item.id === questionId)
          if (!question) return
          const existing = reviewPromptModeV2State.answerState[questionId]
          const next = Array.isArray(existing)
            ? existing.includes(value)
              ? existing.filter((item) => item !== value)
              : [...existing, value]
            : [value]
          getReviewPromptModeV2Orchestrator().setAnswerDraft(question, next)
        }}
        onPromptV2ContinueQuestion={() => getReviewPromptModeV2Orchestrator().continueQuestion()}
        onPromptV2Generate={() => getReviewPromptModeV2Orchestrator().generatePrompt()}
        onClose={() => {
          reviewPopupOrchestratorRef.current?.close()
          setReviewPopupSurface("answer_mode")
          setReviewPopupOpen(false)
        }}
      />
    </>
  )
}
