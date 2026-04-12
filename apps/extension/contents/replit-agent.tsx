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
  getAfterReviewCache,
  getProjectMemory,
  getSessionSummary,
  hasSeenOnboarding,
  markOnboardingSeen,
  saveAfterReviewCache,
  saveProjectMemory,
  saveSessionSummary
} from "../lib/storage"

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
  const retryTimeoutRef = useRef<number | null>(null)
  const outcomeEventIdRef = useRef<string | null>(null)
  const lastAnalyzedPromptRef = useRef("")
  const analyzingPromptRef = useRef<string | null>(null)
  const analysisRequestIdRef = useRef(0)
  const lastFocusedPromptRef = useRef<HTMLElement | null>(null)
  const lastPromptValueRef = useRef("")
  const lastStablePromptValueRef = useRef("")
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
        "Project context received. NoRetry is grounding the review with your newly added information.",
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

  function getCurrentAssistantSnapshot() {
    return getActiveSurfaceAdapter().getLatestAssistantResponse()
  }

  function getCurrentUserSnapshot() {
    return getActiveSurfaceAdapter().getLatestUserPrompt()
  }

  function getCurrentThreadSnapshot() {
    return getActiveSurfaceAdapter().getThread()
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

  function canonicalChecklistLabels(result: AfterAnalysisResult | null) {
    const fromContract = (result?.review_contract?.criteria ?? []).map((item) => item.label.trim())
    const labels = fromContract.length ? fromContract : (result?.acceptance_checklist ?? []).map((item) => item.label.trim())
    return labels
      .filter((label) => label && !isGenericChecklistLabel(label))
      .slice(0, 6)
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

    const nextChecklistIsWeak =
      (nextResult.acceptance_checklist?.length ?? 0) === 0 ||
      nextResult.acceptance_checklist.every((item) => isGenericChecklistLabel(item.label))
    const nextFindingsAreWeak =
      nextResult.findings.length === 0 ||
      nextResult.findings.every((item) => {
        const normalized = item.trim().toLowerCase()
        return (
          !normalized ||
          normalized.includes("the user's latest request") ||
          normalized.includes("help replit users write stronger ai prompts") ||
          normalized.includes("the answer appears aligned with the goal")
        )
      })

    return {
      ...nextResult,
      findings: nextFindingsAreWeak ? previousResult.findings : nextResult.findings,
      acceptance_checklist: nextChecklistIsWeak ? previousResult.acceptance_checklist : nextResult.acceptance_checklist,
      review_contract:
        nextChecklistIsWeak && previousResult.review_contract.criteria.length
          ? previousResult.review_contract
          : nextResult.review_contract,
      stage_1: {
        ...nextResult.stage_1,
        claimed_evidence: Array.from(
          new Map(
            [...previousResult.stage_1.claimed_evidence, ...nextResult.stage_1.claimed_evidence].map((item) => [
              item.trim().toLowerCase(),
              item
            ])
          ).values()
        ).filter(Boolean).slice(0, 4)
      },
      stage_2: nextChecklistIsWeak
        ? {
            ...nextResult.stage_2,
            addressed_criteria: previousResult.stage_2.addressed_criteria,
            missing_criteria: previousResult.stage_2.missing_criteria,
            constraint_risks: previousResult.stage_2.constraint_risks,
            analysis_notes: Array.from(
              new Map(
                [...nextResult.stage_2.analysis_notes, ...previousResult.stage_2.analysis_notes].map((item) => [
                  item.trim().toLowerCase(),
                  item
                ])
              ).values()
            ).filter(Boolean).slice(0, 4)
          }
        : nextResult.stage_2
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

  async function getCachedAfterReviewsForTarget(
    threadIdentity: string,
    responseIdentity: string,
    normalizedText: string
  ) {
    const inMemoryCache = isSameCachedAfterTarget(
      afterReviewCacheRef.current,
      threadIdentity,
      responseIdentity,
      normalizedText
    )
      ? afterReviewCacheRef.current
      : null

    if (inMemoryCache) return inMemoryCache

    const persistedCache = await getAfterReviewCache({
      threadIdentity,
      responseIdentity,
      normalizedText
    })

    if (!persistedCache) return null

    const restoredCache: CachedAfterReviews = {
      threadIdentity: persistedCache.threadIdentity,
      responseIdentity: persistedCache.responseIdentity,
      normalizedText: persistedCache.normalizedText,
      quick: persistedCache.quick,
      deep: persistedCache.deep
    }

    afterReviewCacheRef.current = restoredCache
    strongestAfterVerdictRef.current = restoredCache.deep ?? restoredCache.quick ?? strongestAfterVerdictRef.current
    return restoredCache
  }

  function buildDeepDeltaNote(quick: AfterAnalysisResult | null, deep: AfterAnalysisResult | null) {
    if (!quick || !deep) return ""

    const quickChecklist = new Map(
      quick.acceptance_checklist.map((item) => [normalizeAssistantTextForReuse(item.label), item.status])
    )
    const changedItems = deep.acceptance_checklist.filter((item) => {
      const previousStatus = quickChecklist.get(normalizeAssistantTextForReuse(item.label))
      return Boolean(previousStatus) && previousStatus !== item.status
    })

    if (!changedItems.length) return ""

    const sample = changedItems[0]
    const sampleVerdict =
      sample.status === "met" ? "confirmed" : sample.status === "missed" ? "marked missing" : "left unresolved"

    return `Deep review tightened ${changedItems.length} checklist result${changedItems.length > 1 ? "s" : ""}; for example, "${sample.label}" is now ${sampleVerdict}.`
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
      const cachedReviews = sameAnalyzedTarget ? afterReviewCacheRef.current : null
      const baselineVerdict = sameAnalyzedTarget
        ? deepAnalysis
          ? cachedReviews?.quick ?? strongestAfterVerdictRef.current ?? afterVerdict
          : cachedReviews?.quick ?? strongestAfterVerdictRef.current ?? afterVerdict
        : null
      const baselineAcceptanceCriteria =
        sameAnalyzedTarget
          ? canonicalChecklistLabels(afterReviewCacheRef.current?.quick ?? baselineVerdict ?? afterVerdict)
          : []
      const rawResult = await analyzeAfterAttempt({
        attempt,
        response_summary: responseSummary,
        response_text_fallback: text,
        deep_analysis: deepAnalysis,
        baseline_acceptance_criteria: baselineAcceptanceCriteria,
        baseline_acceptance_checklist:
          sameAnalyzedTarget ? afterReviewCacheRef.current?.quick?.acceptance_checklist ?? [] : [],
        baseline_review_contract:
          sameAnalyzedTarget ? afterReviewCacheRef.current?.quick?.review_contract ?? null : null,
        project_context: compactProjectMemory.projectContext,
        current_state: compactProjectMemory.currentState,
        error_summary: collectVisibleErrorSummary(),
        changed_file_paths_summary: changedFiles
      })
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
      if (afterReviewCacheRef.current) {
        await saveAfterReviewCache({
          threadIdentity: afterReviewCacheRef.current.threadIdentity,
          responseIdentity: afterReviewCacheRef.current.responseIdentity,
          normalizedText: afterReviewCacheRef.current.normalizedText,
          quick: afterReviewCacheRef.current.quick,
          deep: afterReviewCacheRef.current.deep
        })
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
  const deepDeltaNote = buildDeepDeltaNote(
    afterReviewCacheRef.current?.quick ?? null,
    afterReviewCacheRef.current?.deep ?? null
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
        return
      }

      const input = findPromptInput()
      if (!input) {
        const fallbackInput = lastFocusedPromptRef.current
        if (fallbackInput && fallbackInput.isConnected && isPromptLikeElement(fallbackInput)) {
          promptRef.current = fallbackInput
          submitRef.current = findSubmitButton(fallbackInput)
          positionHost()
          return
        }

        promptRef.current = null
        submitRef.current = null
        positionHost()
        return
      }

      const inputChanged = promptRef.current !== input
      promptRef.current = input
      lastFocusedPromptRef.current = input
      submitRef.current = findSubmitButton(input)
      positionHost()
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
    setMounted(true)

    return () => {
      observer.disconnect()
      document.removeEventListener("focusin", handleFocusIn)
      window.removeEventListener("resize", positionHost)
      window.removeEventListener("scroll", positionHost, true)
      if (retryTimeoutRef.current) window.clearTimeout(retryTimeoutRef.current)
      if (afterLoadingIntervalRef.current) {
        window.clearInterval(afterLoadingIntervalRef.current)
        afterLoadingIntervalRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    popupOpenRef.current = panelOpen || afterPanelOpen

    if (popupOpenRef.current && !frozenHostPositionRef.current) {
      popupAnchorPromptRef.current = promptRef.current
      frozenHostPositionRef.current = computeHostPosition()
    }

    if (!popupOpenRef.current) {
      frozenHostPositionRef.current = null
      popupAnchorPromptRef.current = null
    }

    positionHost()
  }, [panelOpen, afterPanelOpen])

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

    const handleKeydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        void handleSubmit()
      }
    }

    const submitButton = submitRef.current
    document.addEventListener("input", handleDocumentInput, true)
    input?.addEventListener("keydown", handleKeydown)
    submitButton?.addEventListener("click", handleSubmit)
    handleInput(input ?? undefined)

    return () => {
      document.removeEventListener("input", handleDocumentInput, true)
      input?.removeEventListener("keydown", handleKeydown)
      submitButton?.removeEventListener("click", handleSubmit)
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
      setIsEvaluatingAfterResponse(false)
      setIsDeepAnalyzingAfterResponse(false)
      setHasSubmittedPrompt(false)
      latestAssistantNodeRef.current = null
      pendingContextAnalysisRef.current = null
      lastEvaluatedAssistantTextRef.current = ""
      lastEvaluatedAssistantMessageIdRef.current = ""
      lastEvaluatedChatHrefRef.current = ""
      strongestAfterVerdictRef.current = null
      afterReviewCacheRef.current = null
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
    const cachedReviews = text
      ? await getCachedAfterReviewsForTarget(threadSnapshot.identity, latestMessageId, normalizedText)
      : null

    if (hasProjectMemory && projectMemoryAwaitingFreshAnswerRef.current && sameAsProjectMemoryBaseline) {
      setProjectContextSetupActive(false)
      setProjectContextReadyActive(true)
      setAfterPanelOpen(true)
      setAfterDisplayedReviewMode("quick")
      setAfterVerdict(
        buildAfterPlaceholder(
          "Your project memory is saved and ready.",
          [
            "Continue with Replit and come back after the next real project answer. NoRetry will start reviewing from that point forward."
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

    if (cachedReviews?.quick) {
      setProjectContextSetupActive(false)
      setProjectContextReadyActive(false)
      setAfterPanelOpen(true)
      setAfterDisplayedReviewMode("quick")
      setAfterVerdict(cachedReviews.quick)
      setAfterAttempt(await ensureSubmittedAttempt())
      lastEvaluatedAssistantTextRef.current = text
      lastEvaluatedAssistantMessageIdRef.current = latestMessageId
      lastEvaluatedChatHrefRef.current = threadSnapshot.identity
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
            "Paste the Replit handoff below. After you save it, NoRetry will return to your latest project answer and review it automatically."
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
            "NoRetry could not capture the latest AI answer yet.",
            ["Wait for the answer to finish, then click the thunder again."],
            "Please restate your final result, list the concrete changes you made, and verify whether the original request is now fully satisfied."
          )
        )
      }
    } catch (error) {
      setAfterVerdict(
        buildAfterPlaceholder(
          error instanceof Error ? error.message : "NoRetry hit a problem while analyzing the latest answer.",
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
      const cachedReviews = await getCachedAfterReviewsForTarget(
        targetOverride.threadIdentity,
        targetOverride.responseIdentity,
        normalizedText
      )

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
            "NoRetry could not re-open the latest AI answer for a deeper review.",
            ["Wait for the answer to finish, then try Deep Analyze again."],
            afterVerdict.next_prompt
          )
        )
      }
    } catch (error) {
      setAfterVerdict(
        buildAfterPlaceholder(
          error instanceof Error ? error.message : "NoRetry could not complete a deeper review.",
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
      const cachedReviews = await getCachedAfterReviewsForTarget(
        targetOverride.threadIdentity,
        targetOverride.responseIdentity,
        normalizedText
      )

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
            "NoRetry could not reopen the latest AI answer for a quick review.",
            ["Try switching analysis mode again after the answer fully settles."],
            afterVerdict.next_prompt
          )
        )
      }
    } catch (error) {
      setAfterVerdict(
        buildAfterPlaceholder(
          error instanceof Error ? error.message : "NoRetry could not switch back to quick review.",
          ["Try switching analysis mode again after the answer fully settles."],
          afterVerdict.next_prompt
        )
      )
    } finally {
      stopAfterLoadingProgress()
      setIsEvaluatingAfterResponse(false)
    }
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

  async function handleSubmit() {
    const input = promptRef.current
    if (!input) return
    const prompt = readPromptValue(input).trim()
    if (!prompt) return
    lastStablePromptValueRef.current = prompt

    const now = Date.now()
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
      await markAttemptSubmitted(
        activeAttempt.attempt_id,
        buildSubmittedAttemptPatch({
          prompt,
          beforeIntent: beforeResult?.intent
        })
      )
    } else {
      const fallbackAttempt = await createAttempt(
        buildFallbackSubmittedAttemptInput({
          prompt,
          platform: getAttemptPlatform(),
          beforeIntent: beforeResult?.intent
        })
      )
      await markAttemptSubmitted(fallbackAttempt.attempt_id)
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
          void syncPromptFromPage().then((snapshot) => {
            if (!snapshot) return
            void loadAiQuestionsForCurrentPrompt(snapshot.prompt, snapshot.result)
          })
          setPanelOpen(true)
        }}
        onOpenAfterPanel={() => void handleOpenAfterPanel()}
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
          deepDeltaNote={deepDeltaNote}
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
    </>
  )
}
