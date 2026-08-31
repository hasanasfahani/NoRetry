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
import type { AuthSession, AuthUser } from "@prompt-optimizer/shared"
import { DETECTION_THRESHOLDS } from "@prompt-optimizer/shared/src/constants"
import { analyzePromptLocally, buildPromptFromAnswers } from "@prompt-optimizer/shared/src/analyzePrompt"
import {
  mapPromptIntentToTaskType,
  preprocessResponse
} from "@prompt-optimizer/shared"
import { summarizeSessionMemory } from "@prompt-optimizer/shared/src/session"
import { AfterVerdictPanel } from "../components/AfterVerdictPanel"
import { OptimizerShell } from "../components/OptimizerShell"
import { ReviewPopupContainer } from "../components/review-popup/review/ReviewPopupContainer"
import type { ReviewPopupViewModel } from "../components/review-popup/review/review-types"
import {
  analyzeAfterAttempt,
  analyzeDeepAnalysisV2,
  analyzePromptRemote,
  detectOutcome,
  diagnoseFailure,
  extendQuestions,
  generateAfterNextQuestion,
  generateProjectPlanningDraft,
  getProjectPlanningDiagnosticsFromError,
  interpretNextMovePrompt,
  refinePrompt,
  sendFeedback,
  trackAnalyticsEvent,
  type AnalyticsEventParams
} from "../lib/api"
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
  buildImportedProjectContextRecord,
  buildProjectHandoffMarkdown,
  buildReplitDeepContextRequestPrompt,
  type ImportedProjectContextRecord,
  parseProjectHandoffMarkdown,
  REPLIT_CONTEXT_REQUEST_PROMPT
} from "../lib/core/project-context"
import {
  appendProjectContextBlock,
  buildProjectContextPack,
  formatProjectContextBlock
} from "../lib/core/project-context-pack"
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
  findPromptLikeAncestor,
  findPromptInput,
  findPromptInputNearSubmitButton,
  findVisiblePromptSubmitButton,
  findSubmitButton,
  getPromptSurface,
  isReplitConnectionInterrupted,
  isPromptLikeElement,
  isSupportedPromptPage,
  readPromptValue,
  writePromptValue
} from "../lib/replit"
import {
  deriveProjectMemoryIdentity,
  clearBugReportScreenshot,
  clearProjectMemoryContext,
  getBugReportScreenshots,
  getProjectCatalog,
  getProjectMemory,
  getProjectOnboarding,
  getProjectProgress,
  getProjectTracker,
  getSessionSummary,
  saveProjectTracker,
  saveProjectOnboarding,
  saveBugReportScreenshot,
  saveProjectCatalogItem,
  appendNextMoveTelemetryEvent,
  type BugReportScreenshotRecord,
  type ProjectCatalogItemRecord,
  type ProjectOnboardingChoice,
  type ProjectOnboardingRecord,
  type ProjectProgressRecord,
  saveProjectMemory,
  saveProjectProgress,
  saveSessionSummary
} from "../lib/storage"
import { createReviewPopupOrchestrator } from "../lib/review/orchestrator/review-popup-orchestrator"
import { createReviewPromptModeOrchestrator } from "../lib/review/orchestrator/review-prompt-mode-orchestrator"
import { buildReviewLoadingViewModel } from "../lib/review/mappers/review-view-model"
import {
  createIdleReviewSignal,
  mapReviewResultToSignal
} from "../lib/review/mappers/review-signal"
import { evaluateQuickSignal, mapQuickEvaluationToReviewSignal } from "../lib/review/services/quick-signal-evaluator"
import { normalizeGoalContract } from "../lib/goal/goal-normalizer"
import { buildPreflightAssessment } from "../lib/preflight/preflight-risk-engine"
import { mapPreflightAssessmentToTypingSignal } from "../lib/preflight/preflight-view-model"
import { createReviewAnalysisRunner, getReviewAnalysisContext } from "../lib/review/services/review-analysis"
import { getDeepAnalysisV2RolloutMode, shouldRunDeepAnalysisV2 } from "../lib/review/deep-analysis-v2-rollout"
import {
  DEEP_ANALYSIS_V2_ANALYSIS_VERSION,
  DEEP_ANALYSIS_V2_VERSION,
  hashDeepAnalysisV2Text,
  type DeepAnalysisV2Result
} from "../lib/review/deep-analysis-v2-contract"
import { buildNextMoveTelemetryEvent } from "../lib/review/next-move-telemetry"
import { scheduleNextMoveEvalCandidateSync } from "../lib/review/next-move-candidate-sync"
import { buildPromptModeSessionKey } from "../lib/review/services/review-prompt-mode"
import { createReviewTargetResolver } from "../lib/review/services/review-target"
import {
  buildStructuredProjectMemoryPatchFromAnalysis,
  buildStructuredProjectMemoryPatchFromRequestBrief,
  deriveArchitectureRecordFromImportedMarkdown,
  deriveArchitectureRecordFromPlanning,
  formatArchitectureRecordForConfirmation,
  parseArchitectureConfirmationDraft,
  replaceStructuredProjectMemoryFields,
  mergeStructuredProjectMemory,
  type ArchitectureConfirmationState,
  type ArchitectureRecordV1,
  type StructuredProjectMemory
} from "../lib/session/project-memory"
import {
  createDefaultProjectSettingsRecord,
  type ProjectPreferenceSettings,
  type ProjectSettingsRecord
} from "../lib/session/project-settings"
import { createGuestAccountState, type AccountState } from "../lib/account/account-types"
import {
  getCurrentAccount,
  loginAccount as loginAccountRemote,
  logoutAccount as logoutAccountRemote,
  refreshAccount as refreshAccountRemote,
  registerAccount as registerAccountRemote
} from "../lib/account/auth-client"
import {
  buildAuthDevice,
  clearStoredAuth,
  getStoredSession,
  getStoredUser,
  saveStoredAuth
} from "../lib/account/session-store"
import {
  getProject as getRemoteProject,
  syncProjectContextImport as syncProjectContextImportRemote,
  syncProjectMemory as syncProjectMemoryRemote,
  syncProjectPreferences as syncProjectPreferencesRemote,
  syncProjectProgress as syncProjectProgressRemote
} from "../lib/sync/project-sync-client"
import { getProjectSyncState, saveProjectSyncState } from "../lib/sync/sync-state-store"
import type { ProjectSyncState, ProjectSyncStatus } from "../lib/sync/sync-types"
import {
  buildSyncedPromptModeState,
  restoreProjectPlanningStateFromSync,
  buildSyncedReviewSummary,
  hasMeaningfulProgressSnapshot,
  normalizeActiveSurface,
  sanitizeProjectOnboardingStateForSync,
  sanitizeProjectPlanningStateForSync,
  type SyncedPromptModeState,
  type SyncedReviewSummary
} from "../lib/progress/project-progress"
import {
  analyzeProjectDescription,
  buildProjectPlanningIntakeFields,
  buildProjectPlanningContextPayload,
  buildProjectPlanningSubmissionPrompt,
  createEmptyProjectPlanningState,
  hasAnsweredPlanningQuestion,
  PROJECT_PLANNING_INTAKE_QUESTIONS,
  PROJECT_PLANNING_OTHER_OPTION,
  type ProjectPlanningDebugPayload,
  type ProjectPlanningState
} from "../lib/project-planning/project-planning"
import {
  advanceProjectTrackerAfterPhasePass,
  buildProjectTrackerCurrentPhasePrompt,
  buildProjectTrackerDeepAnalysisBrief,
  buildProjectTrackerDebugMetadata,
  buildProjectTrackerFinalReviewPrompt,
  buildProjectTrackerHandoffPrompt,
  buildProjectTrackerRecord,
  deactivateProjectTracker,
  getProjectTrackerCarryoverItems,
  getSpecificProjectTrackerRequirementMatches,
  hashProjectTrackerText,
  isProjectTrackerBoundTo,
  isProjectTrackerAwaitingFreshAnswer,
  markProjectTrackerFinalReviewAnswerReceived,
  markProjectTrackerFinalReviewCopied,
  markProjectTrackerFinalReviewSubmitted,
  markProjectTrackerTestingCheckpointAnswered,
  shouldAdvanceProjectTrackerFromAnalysis,
  shouldShowProjectTrackerFinalReview,
  type ProjectTrackerRecord,
  type ProjectTrackerSurface
} from "../lib/project-tracker/project-tracker"
import {
  resolveProjectSetupView as resolveProjectSetupViewForState,
  shouldAutoCloseProjectSetupPanel,
  shouldPreferReviewOverProjectSetup,
  shouldTreatProjectEntryAsNew
} from "../lib/project-planning/onboarding-routing"
import { resolveProjectPlanningSeedText } from "../lib/project-planning/seed"
import type {
  ReviewPopupControllerState,
  ReviewPromptModeState,
  ReviewPopupSurface,
  ReviewSignalState,
  ReviewTarget,
  ReviewTypingState
} from "../lib/review/types"

export const config: PlasmoCSConfig = {
  matches: [
    "https://replit.com/*",
    "https://www.replit.com/*",
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://lovable.dev/*",
    "https://www.lovable.dev/*"
  ],
  all_frames: false
}

export const getRootContainer: PlasmoGetRootContainer = async () => {
  let host = document.getElementById("prompt-optimizer-root")
  if (!host) {
    host = document.createElement("div")
    host.id = "prompt-optimizer-root"
    document.body.appendChild(host)
  }

  host.style.position = host.style.position || "fixed"
  host.style.top = host.style.top || "112px"
  host.style.right = host.style.right || "18px"
  host.style.left = host.style.left || "auto"
  host.style.zIndex = "2147483647"
  host.style.opacity = host.style.opacity || "1"
  host.style.pointerEvents = host.style.pointerEvents || "auto"

  return host
}

const SEND_DETECTION_DEDUPE_MS = 1200
const REVIEW_SIGNAL_SETTLE_MS = 450
const NEXT_MOVE_V2_ENABLED = true
type NextMoveV2Choice = "small_feature" | "large_feature" | "bug_fix" | "small_change"
type NextMoveV2FirstQuestion = {
  label: string
  helper?: string
  options?: string[]
  placeholder: string
  source: "ai" | "fallback"
  provider?: string
}
type NextMoveV2QuestionSuggestion = NextMoveV2FirstQuestion
const NEXT_MOVE_V2_CHOICE_LABELS: Record<NextMoveV2Choice, string> = {
  small_feature: "new small feature",
  large_feature: "new large feature",
  bug_fix: "bug fix",
  small_change: "small change"
}

function createIdleReviewPopupControllerState(): ReviewPopupControllerState {
  return {
    surface: "answer_mode",
    popupState: "idle",
    activeMode: "deep",
    targetKey: null,
    cacheStatus: "none",
    analysisStarted: false,
    analysisFinished: false,
    errorReason: null
  }
}

function createEmptyReviewPromptModeState(): ReviewPromptModeState {
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

function logReviewDebug(message: string, details?: Record<string, unknown>) {
  if (details) {
    console.debug("[reeva AI][Review]", message, details)
    return
  }

  console.debug("[reeva AI][Review]", message)
}

function logProjectPlanningDiagnostics(stage: string, diagnostics: unknown) {
  console.debug("[reeva AI][Project Planning]", stage, diagnostics)
}

function applyVisibleFallbackHostPosition(host: HTMLElement) {
  host.style.position = "fixed"
  host.style.top = "112px"
  host.style.right = "18px"
  host.style.left = "auto"
  host.style.opacity = "1"
  host.style.pointerEvents = "auto"
  host.style.zIndex = "2147483647"
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
  const BACKGROUND_QUICK_REVIEW_ENABLED = false
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
  const [isDeepAnalysisPrewarming, setIsDeepAnalysisPrewarming] = useState(false)
  const [reviewButtonAttentionKind, setReviewButtonAttentionKind] = useState<"onboarding" | "review" | null>(null)
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
  const [reviewPopupControllerState, setReviewPopupControllerState] = useState<ReviewPopupControllerState>(
    createIdleReviewPopupControllerState()
  )
  const [reviewPromptModeState, setReviewPromptModeState] = useState<ReviewPromptModeState>(
    createEmptyReviewPromptModeState()
  )
  const nextMoveV2QuestionSetCacheRef = useRef<Record<string, NextMoveV2QuestionSuggestion[]>>({})
  const nextMoveV2FinalPromptCacheRef = useRef<Record<string, string>>({})
  const deepAnalysisPrewarmTokensRef = useRef<Set<string>>(new Set())
  const activeActionIconAttentionTokensRef = useRef<Map<string, "onboarding" | "review">>(new Map())
  const actionIconAttentionTimeoutsRef = useRef<Map<string, number>>(new Map())
  const lastOnboardingAttentionUrlRef = useRef("")
  const lastReviewAttentionKeyRef = useRef("")
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
  const [afterHelpfulFeedback, setAfterHelpfulFeedback] = useState<boolean | null>(null)
  const [afterNextPromptSuccessFeedback, setAfterNextPromptSuccessFeedback] = useState<boolean | null>(null)
  const [afterPromptActionTaken, setAfterPromptActionTaken] = useState(false)
  const [activeSuggestedDirectionChipId, setActiveSuggestedDirectionChipId] = useState<string | null>(null)
  const [usedSuggestedDirectionChipIds, setUsedSuggestedDirectionChipIds] = useState<string[]>([])
  const [planningGoalNotice, setPlanningGoalNotice] = useState("")
  const [reviewPromptCopyFeedback, setReviewPromptCopyFeedback] = useState<{
    prompt: string
    message: string
    tone: "success" | "error"
  } | null>(null)
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
  const projectMemoryKeyRef = useRef("")
  const projectMemoryLabelRef = useRef("")
  const [projectContextDraft, setProjectContextDraft] = useState("")
  const [currentStateDraft, setCurrentStateDraft] = useState("")
  const [importedProjectContext, setImportedProjectContext] = useState<ImportedProjectContextRecord | null>(null)
  const [projectStructuredMemory, setProjectStructuredMemory] = useState<StructuredProjectMemory | null>(null)
  const [architectureConfirmation, setArchitectureConfirmation] = useState<ArchitectureConfirmationState | null>(null)
  const [projectSettingsRecord, setProjectSettingsRecord] = useState<ProjectSettingsRecord>(createDefaultProjectSettingsRecord())
  const [projectHandoffDraft, setProjectHandoffDraft] = useState("")
  const [promptProjectContextImportOpen, setPromptProjectContextImportOpen] = useState(false)
  const [projectPanelView, setProjectPanelView] = useState<
    "closed" | "onboarding" | "context" | "planning" | "settings" | "account" | "projects"
  >("closed")
  const [projectCatalogItems, setProjectCatalogItems] = useState<ProjectCatalogItemRecord[]>([])
  const [bugReportScreenshots, setBugReportScreenshots] = useState<BugReportScreenshotRecord[]>([])
  const [bugReportScreenshotCapturing, setBugReportScreenshotCapturing] = useState(false)
  const [bugReportScreenshotError, setBugReportScreenshotError] = useState<string | null>(null)
  const [projectContextSetupActive, setProjectContextSetupActive] = useState(false)
  const [projectContextReadyActive, setProjectContextReadyActive] = useState(false)
  const [projectPlanningState, setProjectPlanningState] = useState<ProjectPlanningState>(
    createEmptyProjectPlanningState()
  )
  const [projectTrackerRecord, setProjectTrackerRecord] = useState<ProjectTrackerRecord | null>(null)
  const projectTrackerRecordRef = useRef<ProjectTrackerRecord | null>(null)
  const [projectPlanningGeneratingDraft, setProjectPlanningGeneratingDraft] = useState(false)
  const [projectPlanningErrorMessage, setProjectPlanningErrorMessage] = useState<string | null>(null)
  const [projectPlanningCopyMessage, setProjectPlanningCopyMessage] = useState<string | null>(null)
  const [projectPlanningDebugPayload, setProjectPlanningDebugPayload] = useState<ProjectPlanningDebugPayload | null>(null)
  const projectPlanningGenerationAttemptRef = useRef(0)
  const projectPlanningSubmitGuardUntilRef = useRef(0)
  const [projectMemoryDepth, setProjectMemoryDepth] = useState<"quick" | "deep">("deep")
  const [hasProjectMemory, setHasProjectMemory] = useState(false)
  const [projectOnboardingRecord, setProjectOnboardingRecord] = useState<ProjectOnboardingRecord | null>(null)
  const [projectSetupDismissedProjectKey, setProjectSetupDismissedProjectKey] = useState<string | null>(null)
  const [isSavingProjectMemory, setIsSavingProjectMemory] = useState(false)
  const [isDeletingProjectContext, setIsDeletingProjectContext] = useState(false)
  const [isSavingProjectPreferences, setIsSavingProjectPreferences] = useState(false)
  const [isSavingProjectFocus, setIsSavingProjectFocus] = useState(false)
  const [projectSyncState, setProjectSyncState] = useState<ProjectSyncState>({
    projectKey: "",
    status: "guest",
    lastSyncedAt: null,
    lastRemoteUpdatedAt: null,
    errorMessage: null
  })
  const [accountState, setAccountState] = useState<AccountState>({
    status: "loading",
    user: null,
    session: null,
    errorMessage: null
  })
  const [isAccountSubmitting, setIsAccountSubmitting] = useState(false)
  const promptRef = useRef<HTMLElement | null>(null)
  const submitRef = useRef<HTMLButtonElement | null>(null)
  const pendingPromptRef = useRef<PendingPrompt | null>(null)
  const lastSubmittedAttemptRef = useRef<Attempt | null>(null)
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
  const pinnedAssistantSnapshotRef = useRef<{
    node: HTMLElement | null
    text: string
    identity: string
    threadIdentity: string
  } | null>(null)
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
  const projectMemorySyncTimeoutRef = useRef<number | null>(null)
  const projectProgressSyncTimeoutRef = useRef<number | null>(null)
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
  const projectContextDraftRef = useRef("")
  const currentStateDraftRef = useRef("")
  const importedProjectContextRef = useRef<ImportedProjectContextRecord | null>(null)
  const projectStructuredMemoryRef = useRef<StructuredProjectMemory | null>(null)
  const strongestAfterVerdictRef = useRef<AfterAnalysisResult | null>(null)
  const afterReviewCacheRef = useRef<CachedAfterReviews | null>(null)
  const reviewPopupOrchestratorRef = useRef<ReturnType<typeof createReviewPopupOrchestrator> | null>(null)
  const reviewPromptModeOrchestratorRef = useRef<ReturnType<typeof createReviewPromptModeOrchestrator> | null>(null)
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

  function supportsProjectWorkflowSurface() {
    if (!isSupportedPromptPage()) return false

    const surface = getPromptSurface()
    return surface === "REPLIT" || surface === "CHATGPT" || surface === "LOVABLE"
  }

  function applyProjectTrackerRecord(record: ProjectTrackerRecord | null) {
    projectTrackerRecordRef.current = record
    setProjectTrackerRecord(record)
  }

  function getCurrentProjectSource(): "REPLIT" | "CHATGPT" | "LOVABLE" {
    const surface = getPromptSurface()
    if (surface === "CHATGPT") return "CHATGPT"
    if (surface === "LOVABLE") return "LOVABLE"
    return "REPLIT"
  }

  function getCurrentPlatformLabel() {
    const surface = getPromptSurface()
    if (surface === "CHATGPT") return "ChatGPT"
    if (surface === "LOVABLE") return "Lovable"
    return "Replit"
  }

  function getAnalyticsSurface(): NonNullable<AnalyticsEventParams["surface"]> {
    const surface = getPromptSurface()
    if (surface === "REPLIT") return "replit"
    if (surface === "CHATGPT") return "chatgpt"
    if (surface === "LOVABLE") return "lovable"
    return "unknown"
  }

  function getBaseAnalyticsParams(featureArea?: AnalyticsEventParams["feature_area"]): AnalyticsEventParams {
    const tracker = projectTrackerRecordRef.current
    return {
      surface: getAnalyticsSurface(),
      ...(featureArea ? { feature_area: featureArea } : {}),
      has_project_context: Boolean(importedProjectContextRef.current),
      tracker_enabled: Boolean(tracker?.enabled),
      ...(typeof tracker?.currentPhaseIndex === "number" ? { tracker_phase_index: tracker.currentPhaseIndex } : {})
    }
  }

  function trackProductEvent(name: Parameters<typeof trackAnalyticsEvent>[0], params: AnalyticsEventParams = {}) {
    trackAnalyticsEvent(name, {
      ...getBaseAnalyticsParams(params.feature_area),
      ...params
    })
  }

  function normalizeAnalyticsProvider(value: string | null | undefined): AnalyticsEventParams["provider_winner"] {
    const normalized = value?.toLowerCase()
    if (normalized === "openai") return "openai"
    if (normalized === "kimi") return "kimi"
    if (normalized === "deepseek") return "deepseek"
    return "none"
  }

  function normalizeAnalyticsProviderAttempt(
    value: string | null | undefined
  ): AnalyticsEventParams["provider_attempted"] | null {
    const normalized = value?.toLowerCase()
    if (normalized === "openai") return "openai"
    if (normalized === "kimi") return "kimi"
    if (normalized === "deepseek") return "deepseek"
    return null
  }

  function trackLlmProviderAttempt(input: {
    provider: string | null | undefined
    status: "success" | "failed" | "timeout" | "aborted" | "empty"
    durationMs?: number
    errorReason?: string
  }) {
    const provider = normalizeAnalyticsProviderAttempt(input.provider)
    if (!provider) return

    const status =
      input.status === "success" ? "success" : input.status === "timeout" ? "timeout" : "failed"
    trackProductEvent("llm_provider_attempted", {
      feature_area: "reliability",
      status,
      provider_attempted: provider,
      ...(typeof input.durationMs === "number" ? { duration_ms: input.durationMs } : {}),
      ...(input.errorReason ? { error_reason: input.errorReason } : {})
    })
    if (input.status !== "success") {
      trackProductEvent("llm_provider_failed", {
        feature_area: "reliability",
        status,
        provider_attempted: provider,
        ...(typeof input.durationMs === "number" ? { duration_ms: input.durationMs } : {}),
        error_reason: input.errorReason ?? input.status
      })
    }
  }

  function guardProjectPlanningSubmit(durationMs = 15_000) {
    projectPlanningSubmitGuardUntilRef.current = Date.now() + durationMs
  }

  function isProjectPlanningSubmitGuardActive() {
    return Date.now() < projectPlanningSubmitGuardUntilRef.current
  }

  function applyAuthenticatedAccount(user: AuthUser, session: AuthSession) {
    setAccountState({
      status: "authenticated",
      user,
      session,
      errorMessage: null
    })
  }

  async function bootstrapAccountState() {
    await buildAuthDevice()

    const [storedUser, storedSession] = await Promise.all([getStoredUser(), getStoredSession()])
    if (!storedUser || !storedSession) {
      setAccountState(createGuestAccountState())
      return
    }

    applyAuthenticatedAccount(storedUser, storedSession)

    try {
      const me = await getCurrentAccount(storedSession.accessToken)
      const nextUser = me.user
      await saveStoredAuth({
        user: nextUser,
        session: storedSession
      })
      applyAuthenticatedAccount(nextUser, storedSession)
      return
    } catch {
      try {
        const refreshed = await refreshAccountRemote({
          refreshToken: storedSession.refreshToken,
          device: await buildAuthDevice()
        })
        await saveStoredAuth(refreshed)
        applyAuthenticatedAccount(refreshed.user, refreshed.session)
        return
      } catch (error) {
        await clearStoredAuth()
        setAccountState({
          ...createGuestAccountState(),
          errorMessage: error instanceof Error ? error.message : null
        })
      }
    }
  }

  async function handleAccountLogin(input: { email: string; password: string }) {
    setIsAccountSubmitting(true)
    try {
      const result = await loginAccountRemote({
        ...input,
        device: await buildAuthDevice()
      })
      await saveStoredAuth(result)
      applyAuthenticatedAccount(result.user, result.session)
    } catch (error) {
      setAccountState((current) => ({
        ...current,
        status: current.status === "authenticated" ? current.status : "guest",
        errorMessage: error instanceof Error ? error.message : "Unable to sign in."
      }))
    } finally {
      setIsAccountSubmitting(false)
    }
  }

  async function handleAccountRegister(input: { firstName: string; lastName: string; email: string; password: string }) {
    setIsAccountSubmitting(true)
    try {
      const result = await registerAccountRemote({
        ...input,
        device: await buildAuthDevice()
      })
      await saveStoredAuth(result)
      applyAuthenticatedAccount(result.user, result.session)
    } catch (error) {
      setAccountState((current) => ({
        ...current,
        status: current.status === "authenticated" ? current.status : "guest",
        errorMessage: error instanceof Error ? error.message : "Unable to create account."
      }))
    } finally {
      setIsAccountSubmitting(false)
    }
  }

  async function handleAccountLogout() {
    setIsAccountSubmitting(true)
    try {
      if (accountState.session?.accessToken) {
        await logoutAccountRemote(accountState.session.accessToken)
      }
    } catch {
      // Keep logout resilient even if the network is unavailable.
    } finally {
      await clearStoredAuth()
      setAccountState(createGuestAccountState())
      setIsAccountSubmitting(false)
    }
  }

  function buildProjectSyncState(next: Partial<ProjectSyncState> & { projectKey?: string; status: ProjectSyncStatus }) {
    return {
      projectKey: next.projectKey ?? projectMemoryKey,
      status: next.status,
      cloudProjectId: next.cloudProjectId ?? projectSyncState.cloudProjectId ?? null,
      lastSyncedAt: next.lastSyncedAt ?? projectSyncState.lastSyncedAt ?? null,
      lastRemoteUpdatedAt: next.lastRemoteUpdatedAt ?? projectSyncState.lastRemoteUpdatedAt ?? null,
      errorMessage: next.errorMessage ?? null
    } satisfies ProjectSyncState
  }

  async function applyProjectSyncState(next: Partial<ProjectSyncState> & { projectKey?: string; status: ProjectSyncStatus }) {
    const state = buildProjectSyncState(next)
    setProjectSyncState(state)
    if (state.projectKey) {
      await saveProjectSyncState(state)
    }
    return state
  }

  async function persistProjectOnboardingState(input: {
    status: "entry" | "in_progress_import" | "planning_ready" | "completed"
    entryChoice?: ProjectOnboardingChoice
    completedAt?: string | null
  }) {
    if (!projectMemoryKey) return null

    const record = await saveProjectOnboarding({
      projectKey: projectMemoryKey,
      status: input.status,
      entryChoice: input.entryChoice,
      completedAt: input.completedAt
    })
    setProjectOnboardingRecord(record)
    return record
  }

  function resolveProjectSetupView(params?: {
    projectHasMemory?: boolean
    onboardingRecord?: ProjectOnboardingRecord | null
    planningState?: ProjectPlanningState
  }) {
    return resolveProjectSetupViewForState({
      supportsProjectSetup: supportsProjectWorkflowSurface(),
      projectHasMemory: params?.projectHasMemory ?? hasProjectMemory,
      projectKey: projectMemoryKey,
      dismissedProjectKey: projectSetupDismissedProjectKey,
      onboardingRecord: params?.onboardingRecord ?? projectOnboardingRecord,
      planningState: params?.planningState ?? projectPlanningState
    })
  }

  async function syncProjectPreferencesToCloud(nextPreferences: ProjectPreferenceSettings) {
    const accessToken = accountState.session?.accessToken
    if (!accessToken || !projectMemoryKey || !projectMemoryLabel) return null

    await applyProjectSyncState({ status: "syncing", errorMessage: null })

    try {
      const remote = await syncProjectPreferencesRemote(projectMemoryKey, accessToken, {
        projectLabel: projectMemoryLabel,
        source: getCurrentProjectSource(),
        preferences: nextPreferences
      })
      await applyProjectSyncState({
        status: "synced",
        cloudProjectId: remote.id,
        lastSyncedAt: new Date().toISOString(),
        lastRemoteUpdatedAt: remote.updatedAt,
        errorMessage: null
      })
      return remote
    } catch (error) {
      await applyProjectSyncState({
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Preferences sync failed."
      })
      return null
    }
  }

  async function syncProjectMemoryToCloud(input?: {
    projectContext?: string
    currentState?: string
    importedContext?: ImportedProjectContextRecord | null
    structuredMemory?: StructuredProjectMemory | null
    settings?: ProjectSettingsRecord | null
    memoryDepth?: "quick" | "deep"
  }) {
    const accessToken = accountState.session?.accessToken
    if (!accessToken || !projectMemoryKey || !projectMemoryLabel) return null

    const effectiveSettings = input?.settings ?? projectSettingsRecord
    await applyProjectSyncState({ status: "syncing", errorMessage: null })

    try {
      const remote = await syncProjectMemoryRemote(projectMemoryKey, accessToken, {
        projectLabel: projectMemoryLabel,
        source: getCurrentProjectSource(),
        projectContext: input?.projectContext ?? projectContextDraftRef.current,
        currentState: input?.currentState ?? currentStateDraftRef.current,
        importedContextRawMarkdown: input?.importedContext?.rawMarkdown ?? importedProjectContextRef.current?.rawMarkdown ?? null,
        structuredMemoryJson: input?.structuredMemory ?? projectStructuredMemoryRef.current,
        memoryDepth: input?.memoryDepth ?? projectMemoryDepth,
        contextStatus: effectiveSettings.context.status
      })
      await applyProjectSyncState({
        status: "synced",
        cloudProjectId: remote.id,
        lastSyncedAt: new Date().toISOString(),
        lastRemoteUpdatedAt: remote.memory?.updatedAt ?? remote.updatedAt,
        errorMessage: null
      })
      return remote
    } catch (error) {
      await applyProjectSyncState({
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Project sync failed."
      })
      return null
    }
  }

  async function syncProjectContextImportToCloud(importedContext: ImportedProjectContextRecord) {
    const accessToken = accountState.session?.accessToken
    if (!accessToken || !projectMemoryKey || !projectMemoryLabel) return null

    await applyProjectSyncState({ status: "syncing", errorMessage: null })

    try {
      const remote = await syncProjectContextImportRemote(projectMemoryKey, accessToken, {
        projectLabel: projectMemoryLabel,
        source: getCurrentProjectSource(),
        rawMarkdown: importedContext.rawMarkdown,
        parsedSummaryJson: importedContext.summary
      })
      await applyProjectSyncState({
        status: "synced",
        cloudProjectId: remote.id,
        lastSyncedAt: new Date().toISOString(),
        lastRemoteUpdatedAt: remote.latestContextImport?.importedAt ?? remote.updatedAt,
        errorMessage: null
      })
      return remote
    } catch (error) {
      await applyProjectSyncState({
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Context import sync failed."
      })
      return null
    }
  }

  function buildCurrentWorkflowStateValue() {
    return reviewPopupViewModel.workflowState ?? projectStructuredMemory?.currentWorkflowState ?? null
  }

  function buildCurrentProgressSnapshot(): Omit<ProjectProgressRecord, "projectKey" | "version" | "updatedAt"> | null {
    const promptModeState = buildSyncedPromptModeState({
      v1: reviewPromptModeState
    })
    const onboardingState = sanitizeProjectOnboardingStateForSync(projectOnboardingRecord)
    const planningState = sanitizeProjectPlanningStateForSync(projectPlanningState)
    const latestPromptDraft = reviewPromptModeState.promptDraft.trim() || afterNextPromptDraft.trim()
    const latestReviewSummary = buildSyncedReviewSummary({
      verdict: afterVerdict,
      reviewMode: afterDisplayedReviewMode,
      attempt: afterAttempt,
      planningGoal: afterPlanningGoal
    })
    const currentWorkflowState = buildCurrentWorkflowStateValue()
    const latestReviewTargetIdentity = reviewPopupControllerState.targetKey ?? null

    if (
      !hasMeaningfulProgressSnapshot({
        promptModeState,
        latestPromptDraft,
        latestReviewSummary,
        currentWorkflowState,
        latestReviewTargetIdentity,
        onboardingState,
        planningState
      })
    ) {
      return null
    }

    const activeSurface = normalizeActiveSurface(reviewPopupSurface)
    const promptModeSessionKey = reviewPromptModeState.sessionKey ?? reviewTypingState.sessionKey ?? null

    return {
      activeSurface,
      currentWorkflowState,
      promptModeSessionKey,
      promptModeStateJson: promptModeState,
      latestPromptDraft: latestPromptDraft || null,
      latestReviewTargetIdentity,
      latestReviewSummaryJson: latestReviewSummary,
      onboardingStateJson: onboardingState,
      planningStateJson: planningState
    }
  }

  function applyRestoredProgress(record: {
    activeSurface?: string | null
    currentWorkflowState?: string | null
    promptModeSessionKey?: string | null
    promptModeStateJson?: unknown | null
    latestPromptDraft?: string | null
    latestReviewTargetIdentity?: string | null
    latestReviewSummaryJson?: unknown | null
    onboardingStateJson?: unknown | null
    planningStateJson?: unknown | null
  } | null, options?: { projectHasMemory?: boolean }) {
    if (!record) return

    const syncedPromptModeState = (record.promptModeStateJson ?? null) as SyncedPromptModeState | null
    const restoredV1 = syncedPromptModeState?.v1 ?? null
    const restoredReviewSummary = (record.latestReviewSummaryJson ?? null) as SyncedReviewSummary | null
    const projectHasMemory = options?.projectHasMemory ?? hasProjectMemory

    if (!projectHasMemory && projectMemoryKey) {
      const restoredOnboarding = record.onboardingStateJson as Partial<ProjectOnboardingRecord> | null
      if (
        restoredOnboarding &&
        (restoredOnboarding.status === "entry" ||
          restoredOnboarding.status === "in_progress_import" ||
          restoredOnboarding.status === "planning_ready" ||
          restoredOnboarding.status === "completed")
      ) {
        setProjectOnboardingRecord({
          projectKey: projectMemoryKey,
          status: restoredOnboarding.status,
          entryChoice:
            restoredOnboarding.entryChoice === "in_progress" || restoredOnboarding.entryChoice === "starting_now"
              ? restoredOnboarding.entryChoice
              : null,
          completedAt: typeof restoredOnboarding.completedAt === "string" ? restoredOnboarding.completedAt : null,
          updatedAt:
            typeof restoredOnboarding.updatedAt === "string"
              ? restoredOnboarding.updatedAt
              : new Date().toISOString()
        })
      }

      const restoredPlanning = restoreProjectPlanningStateFromSync(record.planningStateJson)
      if (restoredPlanning) {
        setProjectPlanningState(restoredPlanning)
      }

      if (reviewPopupOpen && projectPanelView === "onboarding") {
        if (restoredOnboarding?.status === "in_progress_import") {
          setProjectPanelView("context")
        } else if (restoredOnboarding?.status === "planning_ready" || restoredPlanning) {
          setProjectPanelView("planning")
        }
      }
    }

    if (restoredV1) {
      setReviewPromptModeState({
        ...createEmptyReviewPromptModeState(),
        ...restoredV1,
        isLoadingQuestions: false,
        isGeneratingPrompt: false,
        errorMessage: null
      })
    }

    if (
      record.activeSurface === "prompt_mode" ||
      record.activeSurface === "prompt_mode_v2" ||
      record.activeSurface === "answer_mode"
    ) {
      setReviewPopupSurface(record.activeSurface === "answer_mode" ? "answer_mode" : "prompt_mode")
    }

    if (record.latestPromptDraft?.trim()) {
      setAfterNextPromptDraft((current) => current || record.latestPromptDraft || "")
      setAfterNextPromptReady((current) => current || Boolean(record.latestPromptDraft?.trim()))
    }

    if (restoredReviewSummary) {
      if (restoredReviewSummary.verdict) {
        setAfterVerdict((current) => current ?? restoredReviewSummary.verdict)
      }
      if (restoredReviewSummary.attempt) {
        setAfterAttempt((current) => current ?? restoredReviewSummary.attempt)
      }
      if (restoredReviewSummary.reviewMode) {
        setAfterDisplayedReviewMode(restoredReviewSummary.reviewMode)
      }
      if (restoredReviewSummary.planningGoal.trim()) {
        setAfterPlanningGoal((current) => current || restoredReviewSummary.planningGoal)
      }
    }

    if (record.latestReviewTargetIdentity) {
      setReviewPopupControllerState((current) => ({
        ...current,
        targetKey: current.targetKey ?? record.latestReviewTargetIdentity ?? null
      }))
    }
  }

  async function syncProjectProgressToCloud(input?: Omit<ProjectProgressRecord, "projectKey" | "version" | "updatedAt"> | null) {
    const accessToken = accountState.session?.accessToken
    if (!accessToken || !projectMemoryKey || !projectMemoryLabel) return null

    const nextProgress = input ?? buildCurrentProgressSnapshot()
    if (!nextProgress) return null

    await applyProjectSyncState({ status: "syncing", errorMessage: null })

    try {
      const remote = await syncProjectProgressRemote(projectMemoryKey, accessToken, {
        projectLabel: projectMemoryLabel,
        source: getCurrentProjectSource(),
        progress: {
          ...nextProgress
        }
      })
      await applyProjectSyncState({
        status: "synced",
        cloudProjectId: remote.id,
        lastSyncedAt: new Date().toISOString(),
        lastRemoteUpdatedAt: remote.progress?.updatedAt ?? remote.updatedAt,
        errorMessage: null
      })
      return remote
    } catch (error) {
      await applyProjectSyncState({
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Project progress sync failed."
      })
      return null
    }
  }

  function scheduleProjectMemorySync() {
    if (projectMemorySyncTimeoutRef.current) {
      window.clearTimeout(projectMemorySyncTimeoutRef.current)
    }

    projectMemorySyncTimeoutRef.current = window.setTimeout(() => {
      projectMemorySyncTimeoutRef.current = null
      void syncProjectMemoryToCloud()
    }, 900)
  }

  function scheduleProjectProgressSync() {
    if (projectProgressSyncTimeoutRef.current) {
      window.clearTimeout(projectProgressSyncTimeoutRef.current)
    }

    projectProgressSyncTimeoutRef.current = window.setTimeout(() => {
      projectProgressSyncTimeoutRef.current = null
      void syncProjectProgressToCloud()
    }, 900)
  }

  async function hydrateProjectFromRemote(input: {
    projectKey: string
    projectLabel: string
    localRecord: Awaited<ReturnType<typeof getProjectMemory>>
    localProgress: ProjectProgressRecord | null
  }) {
    const accessToken = accountState.session?.accessToken
    if (!accessToken) {
      await applyProjectSyncState({
        projectKey: input.projectKey,
        status: "guest",
        errorMessage: null
      })
      return
    }

    const cachedSyncState = await getProjectSyncState(input.projectKey)
    setProjectSyncState(
      cachedSyncState ?? {
        projectKey: input.projectKey,
        status: "local_only",
        lastSyncedAt: null,
        lastRemoteUpdatedAt: null,
        errorMessage: null
      }
    )

    try {
      const remote = await getRemoteProject(input.projectKey, accessToken)
      const remoteMemoryUpdatedAt = remote.memory?.updatedAt ? Date.parse(remote.memory.updatedAt) : Number.NaN
      const remoteProgressUpdatedAt = remote.progress?.updatedAt ? Date.parse(remote.progress.updatedAt) : Number.NaN
      const knownRemoteUpdatedAt = cachedSyncState?.lastRemoteUpdatedAt ? Date.parse(cachedSyncState.lastRemoteUpdatedAt) : Number.NaN
      const lastSyncedAt = cachedSyncState?.lastSyncedAt ? Date.parse(cachedSyncState.lastSyncedAt) : Number.NaN
      const localUpdatedAt = input.localRecord?.updatedAt ? Date.parse(input.localRecord.updatedAt) : Number.NaN
      const localProgressUpdatedAt = input.localProgress?.updatedAt ? Date.parse(input.localProgress.updatedAt) : Number.NaN
      const shouldApplyRemoteOverLocal =
        Boolean(input.localRecord) &&
        Boolean(remote.memory) &&
        !Number.isNaN(remoteMemoryUpdatedAt) &&
        !Number.isNaN(knownRemoteUpdatedAt) &&
        remoteMemoryUpdatedAt > knownRemoteUpdatedAt &&
        !Number.isNaN(localUpdatedAt) &&
        !Number.isNaN(lastSyncedAt) &&
        localUpdatedAt <= lastSyncedAt
      const shouldApplyRemoteProgressOverLocal =
        Boolean(remote.progress) &&
        (!input.localProgress ||
          (!Number.isNaN(remoteProgressUpdatedAt) &&
            !Number.isNaN(knownRemoteUpdatedAt) &&
            !Number.isNaN(localProgressUpdatedAt) &&
            !Number.isNaN(lastSyncedAt) &&
            remoteProgressUpdatedAt > knownRemoteUpdatedAt &&
            localProgressUpdatedAt <= lastSyncedAt))
      await applyProjectSyncState({
        projectKey: input.projectKey,
        status: "synced",
        cloudProjectId: remote.id,
        lastSyncedAt: cachedSyncState?.lastSyncedAt ?? new Date().toISOString(),
        lastRemoteUpdatedAt: remote.progress?.updatedAt ?? remote.memory?.updatedAt ?? remote.updatedAt,
        errorMessage: null
      })

      if ((!input.localRecord || shouldApplyRemoteOverLocal) && remote.memory) {
        const rawMarkdown =
          remote.latestContextImport?.rawMarkdown ??
          remote.memory.importedContextRawMarkdown ??
          buildProjectHandoffMarkdown(remote.memory.projectContext, remote.memory.currentState)
        const importedContext = rawMarkdown
          ? buildImportedProjectContextRecord(
              rawMarkdown,
              remote.latestContextImport?.importedAt ?? remote.memory.updatedAt ?? new Date().toISOString()
            )
          : null
        const saved = await saveProjectMemory({
          projectKey: input.projectKey,
          projectLabel: remote.projectLabel || input.projectLabel,
          projectContext: remote.memory.projectContext,
          currentState: remote.memory.currentState,
          importedContext,
          structuredMemory: (remote.memory.structuredMemoryJson as StructuredProjectMemory | null | undefined) ?? null,
          settings: remote.preferences
            ? {
                ...createDefaultProjectSettingsRecord(),
                preferences: remote.preferences
              }
            : undefined,
          memoryDepth: remote.memory.memoryDepth ?? "deep",
          awaitingFreshAnswer: false,
          baselineResponseIdentity: "",
          baselineResponseText: "",
          baselineThreadIdentity: ""
        })

        setProjectContextDraft(saved.projectContext)
        setCurrentStateDraft(saved.currentState)
        setImportedProjectContext(saved.importedContext ?? importedContext)
        setProjectStructuredMemory(saved.structuredMemory ?? null)
        setProjectSettingsRecord(saved.settings ?? createDefaultProjectSettingsRecord())
        setProjectHandoffDraft((saved.importedContext ?? importedContext)?.rawMarkdown ?? "")
        setProjectMemoryDepth(saved.memoryDepth === "quick" ? "quick" : "deep")
        setHasProjectMemory(Boolean(saved.projectContext.trim() || saved.currentState.trim()))
        projectContextDraftRef.current = saved.projectContext
        currentStateDraftRef.current = saved.currentState
        importedProjectContextRef.current = saved.importedContext ?? importedContext
        projectStructuredMemoryRef.current = saved.structuredMemory ?? null
      }

      if (shouldApplyRemoteProgressOverLocal && remote.progress) {
        const savedProgress = await saveProjectProgress({
          projectKey: input.projectKey,
          activeSurface: remote.progress.activeSurface ?? null,
          currentWorkflowState: remote.progress.currentWorkflowState ?? null,
          promptModeSessionKey: remote.progress.promptModeSessionKey ?? null,
          promptModeStateJson: remote.progress.promptModeStateJson ?? null,
          latestPromptDraft: remote.progress.latestPromptDraft ?? null,
          latestReviewTargetIdentity: remote.progress.latestReviewTargetIdentity ?? null,
          latestReviewSummaryJson: remote.progress.latestReviewSummaryJson ?? null,
          onboardingStateJson: remote.progress.onboardingStateJson ?? null,
          planningStateJson: remote.progress.planningStateJson ?? null,
          version: remote.progress.version
        })
        applyRestoredProgress(savedProgress, {
          projectHasMemory: Boolean(
            (remote.memory?.projectContext ?? "").trim() || (remote.memory?.currentState ?? "").trim()
          )
        })
      } else if (
        input.localProgress &&
        (!remote.progress ||
          (!Number.isNaN(localProgressUpdatedAt) &&
            !Number.isNaN(remoteProgressUpdatedAt) &&
            localProgressUpdatedAt > remoteProgressUpdatedAt))
      ) {
        void syncProjectProgressToCloud(input.localProgress)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Project sync is unavailable."
      if (/project not found/i.test(message)) {
        await applyProjectSyncState({
          projectKey: input.projectKey,
          status: "local_only",
          errorMessage: null
        })

        if (input.localRecord) {
          void syncProjectMemoryToCloud({
            projectContext: input.localRecord.projectContext,
            currentState: input.localRecord.currentState,
            importedContext: input.localRecord.importedContext ?? null,
            structuredMemory: input.localRecord.structuredMemory ?? null,
            settings: input.localRecord.settings ?? createDefaultProjectSettingsRecord(),
            memoryDepth: input.localRecord.memoryDepth === "quick" ? "quick" : "deep"
          })
          if (input.localRecord.settings?.preferences) {
            void syncProjectPreferencesToCloud(input.localRecord.settings.preferences)
          }
          if (input.localRecord.importedContext?.rawMarkdown?.trim()) {
            void syncProjectContextImportToCloud(input.localRecord.importedContext)
          }
        }
        if (input.localProgress) {
          void syncProjectProgressToCloud(input.localProgress)
        }
        return
      }

      await applyProjectSyncState({
        projectKey: input.projectKey,
        status: "failed",
        errorMessage: message
      })
    }
  }

  async function loadProjectMemoryForCurrentLocation() {
    if (!supportsProjectWorkflowSurface()) {
      setProjectMemoryKey("")
      setProjectMemoryLabel("")
      setProjectContextDraft("")
      setCurrentStateDraft("")
      setImportedProjectContext(null)
      setProjectStructuredMemory(null)
      setProjectSettingsRecord(createDefaultProjectSettingsRecord())
      projectContextDraftRef.current = ""
      currentStateDraftRef.current = ""
      importedProjectContextRef.current = null
      projectStructuredMemoryRef.current = null
      setProjectHandoffDraft("")
      setProjectPlanningState(createEmptyProjectPlanningState())
      applyProjectTrackerRecord(null)
      setProjectOnboardingRecord(null)
      setProjectSetupDismissedProjectKey(null)
      setPromptProjectContextImportOpen(false)
      setProjectPanelView("closed")
      setProjectMemoryDepth("deep")
      setHasProjectMemory(false)
      projectMemoryAwaitingFreshAnswerRef.current = false
      projectMemoryBaselineResponseRef.current = null
      strongestAfterVerdictRef.current = null
      afterReviewCacheRef.current = null
      setProjectSyncState({
        projectKey: "",
        status: "guest",
        lastSyncedAt: null,
        lastRemoteUpdatedAt: null,
        errorMessage: null
      })
      return
    }

    const identity = deriveProjectMemoryIdentity()
    setProjectMemoryKey(identity.key)
    setProjectMemoryLabel(identity.label)
    setProjectSetupDismissedProjectKey((current) => (current === identity.key ? current : null))

    let record = await getProjectMemory(identity.key)
    let onboardingRecord = await getProjectOnboarding(identity.key)
    let progressRecord = await getProjectProgress(identity.key)
    let storedTrackerRecord = await getProjectTracker(identity.key)

    const url = new URL(window.location.href)
    const launcherProjectKey = `${url.origin}/~`
    const isFinalReplitProjectUrl =
      /replit\.com$/i.test(url.hostname) &&
      identity.key !== launcherProjectKey &&
      url.pathname.split("/").filter(Boolean).length >= 2

    if (!record && !storedTrackerRecord && isFinalReplitProjectUrl) {
      const migrationCutoff = Date.now() - 24 * 60 * 60 * 1000
      const launcherCatalogItem = (await getProjectCatalog()).find(
        (item) =>
          item.projectKey === launcherProjectKey &&
          Number.isFinite(Date.parse(item.updatedAt)) &&
          Date.parse(item.updatedAt) >= migrationCutoff
      )

      if (launcherCatalogItem) {
        const [launcherMemory, launcherOnboarding, launcherProgress, launcherTracker] = await Promise.all([
          getProjectMemory(launcherProjectKey),
          getProjectOnboarding(launcherProjectKey),
          getProjectProgress(launcherProjectKey),
          getProjectTracker(launcherProjectKey)
        ])

        if (launcherMemory && launcherTracker?.enabled && launcherTracker.prdHash === launcherCatalogItem.prdHash) {
          await saveProjectMemory({
            projectKey: identity.key,
            projectLabel: identity.label,
            projectContext: launcherMemory.projectContext,
            currentState: launcherMemory.currentState,
            importedContext: launcherMemory.importedContext,
            structuredMemory: launcherMemory.structuredMemory,
            settings: launcherMemory.settings,
            memoryDepth: launcherMemory.memoryDepth,
            awaitingFreshAnswer: launcherMemory.awaitingFreshAnswer,
            baselineResponseIdentity: launcherMemory.baselineResponseIdentity,
            baselineResponseText: launcherMemory.baselineResponseText,
            baselineThreadIdentity: launcherMemory.baselineThreadIdentity
          })
          record = await getProjectMemory(identity.key)
          onboardingRecord = launcherOnboarding
            ? await saveProjectOnboarding({
                projectKey: identity.key,
                status: launcherOnboarding.status,
                entryChoice: launcherOnboarding.entryChoice,
                completedAt: launcherOnboarding.completedAt
              })
            : null
          if (launcherProgress) {
            progressRecord = await saveProjectProgress({
              projectKey: identity.key,
              activeSurface: launcherProgress.activeSurface,
              currentWorkflowState: launcherProgress.currentWorkflowState,
              promptModeSessionKey: launcherProgress.promptModeSessionKey,
              promptModeStateJson: launcherProgress.promptModeStateJson,
              latestPromptDraft: launcherProgress.latestPromptDraft,
              latestReviewTargetIdentity: launcherProgress.latestReviewTargetIdentity,
              latestReviewSummaryJson: launcherProgress.latestReviewSummaryJson,
              onboardingStateJson: launcherProgress.onboardingStateJson,
              planningStateJson: launcherProgress.planningStateJson,
              version: launcherProgress.version
            })
          }
          storedTrackerRecord = await saveProjectTracker({
            ...launcherTracker,
            projectId: `${identity.key}::${launcherTracker.prdHash}`,
            projectKey: identity.key,
            projectLabel: identity.label
          })
          const catalogItems = await saveProjectCatalogItem({
            id: `${identity.key}::${launcherCatalogItem.prdHash}`,
            projectKey: identity.key,
            projectLabel: identity.label,
            title: launcherCatalogItem.title,
            summary: launcherCatalogItem.summary,
            prdHash: launcherCatalogItem.prdHash,
            submittedPromptHash: launcherCatalogItem.submittedPromptHash,
            phaseTitles: launcherCatalogItem.phaseTitles,
            createdAt: launcherCatalogItem.createdAt
          })
          setProjectCatalogItems(catalogItems)
          logProjectPlanningDiagnostics("launcher_project_state_migrated", {
            fromProjectKey: launcherProjectKey,
            toProjectKey: identity.key,
            prdHash: launcherTracker.prdHash,
            currentPhaseIndex: launcherTracker.currentPhaseIndex
          })
        }
      }
    }
    let trackerRecord = storedTrackerRecord
    const loadedPrdHash = record?.importedContext?.rawMarkdown?.trim()
      ? hashProjectTrackerText(record.importedContext.rawMarkdown)
      : null
    if (
      trackerRecord &&
      !isProjectTrackerBoundTo({
        record: trackerRecord,
        projectKey: identity.key,
        surface: getProjectTrackerSurface(),
        prdHash: loadedPrdHash
      })
    ) {
      trackerRecord = deactivateProjectTracker({
        record: trackerRecord,
        reason: "stale_prd"
      })
      try {
        trackerRecord = await saveProjectTracker(trackerRecord)
        logProjectPlanningDiagnostics("tracker_marked_stale", getProjectTrackerDiagnostics({
          record: trackerRecord
        }))
      } catch (error) {
        logProjectPlanningDiagnostics("tracker_stale_save_failed", {
          ...getProjectTrackerDiagnostics({
            record: trackerRecord
          }),
          message: error instanceof Error ? error.message : "Unknown stale tracker save error"
        })
      }
    }
    setProjectContextDraft(record?.projectContext ?? "")
    setCurrentStateDraft(record?.currentState ?? "")
    setImportedProjectContext(record?.importedContext ?? null)
    setProjectStructuredMemory(record?.structuredMemory ?? null)
    setProjectSettingsRecord(record?.settings ?? createDefaultProjectSettingsRecord())
    projectContextDraftRef.current = record?.projectContext ?? ""
    currentStateDraftRef.current = record?.currentState ?? ""
    importedProjectContextRef.current = record?.importedContext ?? null
    projectStructuredMemoryRef.current = record?.structuredMemory ?? null
    setProjectHandoffDraft(
      record?.importedContext?.rawMarkdown?.trim()
        ? record.importedContext.rawMarkdown
        : record && (record.projectContext?.trim() || record.currentState?.trim())
          ? buildProjectHandoffMarkdown(record.projectContext ?? "", record.currentState ?? "")
        : ""
    )
    setProjectPlanningState(createEmptyProjectPlanningState())
    applyProjectTrackerRecord(trackerRecord)
    setProjectOnboardingRecord(onboardingRecord)
    setPromptProjectContextImportOpen(false)
    setProjectMemoryDepth(record?.memoryDepth === "quick" ? "quick" : "deep")
    setHasProjectMemory(Boolean(record && (record.projectContext || record.currentState)))
    if (record && (record.projectContext || record.currentState)) {
      if (onboardingRecord?.status !== "completed") {
        void saveProjectOnboarding({
          projectKey: identity.key,
          status: "completed",
          entryChoice: onboardingRecord?.entryChoice ?? null,
          completedAt: onboardingRecord?.completedAt ?? record.updatedAt
        })
      }
      setProjectOnboardingRecord(
        onboardingRecord?.status === "completed"
          ? onboardingRecord
          : {
              projectKey: identity.key,
              status: "completed",
              entryChoice: onboardingRecord?.entryChoice ?? null,
              completedAt: onboardingRecord?.completedAt ?? record.updatedAt,
              updatedAt: onboardingRecord?.updatedAt ?? record.updatedAt
            }
      )
    }
    applyRestoredProgress(progressRecord, {
      projectHasMemory: Boolean(record && (record.projectContext || record.currentState))
    })
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

    if (accountState.status === "authenticated") {
      void hydrateProjectFromRemote({
        projectKey: identity.key,
        projectLabel: identity.label,
        localRecord: record,
        localProgress: progressRecord
      })
      return
    }

    const cachedSyncState = await getProjectSyncState(identity.key)
    setProjectSyncState(
      cachedSyncState ?? {
        projectKey: identity.key,
        status: "guest",
        lastSyncedAt: null,
        lastRemoteUpdatedAt: null,
        errorMessage: null
      }
    )
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
    const BADGE_SIZE = 26
    const EDGE_GAP = 10

    const clampToViewport = (left: number, top: number) => {
      const minLeft = 8
      const maxLeft = window.innerWidth - BADGE_SIZE - 8
      const minTop = 8
      const maxTop = window.innerHeight - BADGE_SIZE - 8

      return {
        top: `${Math.min(Math.max(top, minTop), maxTop)}px`,
        left: `${Math.min(Math.max(left, minLeft), maxLeft)}px`
      }
    }

    if (sourceInput) {
      const rect = sourceInput.getBoundingClientRect()
      return clampToViewport(
        rect.right - BADGE_SIZE / 2 - 12,
        rect.top - BADGE_SIZE / 2
      )
    }

    if (sourceSubmit) {
      const submitRect = sourceSubmit.getBoundingClientRect()
      return clampToViewport(
        submitRect.left - BADGE_SIZE - EDGE_GAP,
        submitRect.top + (submitRect.height - BADGE_SIZE) / 2
      )
    }

    return null
  }

  function isPromptAnchorStable(input: HTMLElement | null) {
    if (!input || !input.isConnected || !isPromptLikeElement(input)) return false

    const rect = input.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= window.innerHeight) return false

    const submitButton = findSubmitButton(input)
    if (submitButton && submitButton.isConnected) return true

    if (!isReplitSurface()) return true
    return rect.bottom > window.innerHeight * 0.55 && rect.width > 220
  }

  function getStablePromptAnchorFallback() {
    if (isPromptAnchorStable(promptRef.current)) return promptRef.current
    if (isPromptAnchorStable(lastFocusedPromptRef.current)) return lastFocusedPromptRef.current
    return null
  }

  function getPreferredComposerAnchor(fallbackSubmit?: HTMLButtonElement | null) {
    const visibleSubmit = fallbackSubmit ?? submitRef.current ?? findVisiblePromptSubmitButton()
    const submitAnchoredInput = visibleSubmit ? findPromptInputNearSubmitButton(visibleSubmit) : null
    const directInput = findPromptInput()
    return resolvePromptAnchorCandidate(submitAnchoredInput ?? directInput, visibleSubmit)
  }

  function resolvePromptAnchorCandidate(candidate: HTMLElement | null, fallbackSubmit?: HTMLButtonElement | null) {
    const activePrompt = findPromptLikeAncestor(document.activeElement)
    if (isPromptAnchorStable(activePrompt)) {
      return activePrompt
    }

    const stableCurrent = getStablePromptAnchorFallback()
    if (!candidate || !candidate.isConnected || !isPromptAnchorStable(candidate)) {
      return stableCurrent ?? candidate ?? null
    }

    if (!stableCurrent || stableCurrent === candidate) {
      return candidate
    }

    const currentValue = readPromptValue(stableCurrent).trim()
    const candidateValue = readPromptValue(candidate).trim()
    if (currentValue && !candidateValue) return stableCurrent

    if (isReplitSurface()) {
      const currentRect = stableCurrent.getBoundingClientRect()
      const candidateRect = candidate.getBoundingClientRect()
      const currentSubmit = findSubmitButton(stableCurrent) ?? fallbackSubmit ?? null
      const candidateSubmit = findSubmitButton(candidate) ?? fallbackSubmit ?? null

      if (currentSubmit && !candidateSubmit) return stableCurrent
      if (currentRect.bottom >= candidateRect.bottom - 24) return stableCurrent
    }

    return candidate
  }

  function mutationNodeLooksRelevant(node: Node | null) {
    if (!(node instanceof HTMLElement)) return false
    if (node.closest("#prompt-optimizer-root")) return false
    if (isPromptLikeElement(node)) return true

    const text = (node.innerText || node.textContent || "").slice(0, 220).trim().toLowerCase()
    if (!text) return false

    return /\boutput file\b|\bcheckpoint made\b|\bworked for\b|\bopen\b|\bplease refresh\b|\bconnection lost\b|\breload to connect\b|\bsend\b|\bsubmit\b|\bmake, test, iterate\b|\beconomy\b|\bplan\b/.test(
      text
    )
  }

  function shouldScheduleScanFromMutations(mutations: MutationRecord[]) {
    if (!isReplitSurface()) return true

    for (const mutation of mutations) {
      if (mutationNodeLooksRelevant(mutation.target)) return true
      for (const node of Array.from(mutation.addedNodes)) {
        if (mutationNodeLooksRelevant(node)) return true
      }
      for (const node of Array.from(mutation.removedNodes)) {
        if (mutationNodeLooksRelevant(node)) return true
      }
    }

    return false
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
    const surface = getPromptSurface()
    if (surface === "CHATGPT") return "chatgpt"
    if (surface === "LOVABLE") return "lovable"
    return "replit"
  }

  function normalizeProjectMemoryResultStatus(
    status: AfterAnalysisResult["status"]
  ): "SUCCESS" | "PARTIAL" | "FAILED" | "WRONG_DIRECTION" | null {
    if (status === "SUCCESS" || status === "PARTIAL" || status === "FAILED" || status === "WRONG_DIRECTION") {
      return status
    }
    return null
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

  async function copyTextToClipboardBestEffort(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      const textarea = document.createElement("textarea")
      textarea.value = text
      textarea.setAttribute("readonly", "true")
      textarea.style.position = "fixed"
      textarea.style.left = "-9999px"
      textarea.style.top = "0"
      textarea.style.opacity = "0"
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      try {
        return document.execCommand("copy")
      } catch {
        return false
      } finally {
        textarea.remove()
      }
    }
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

  function getBoundPromptSnapshot() {
    const input = promptRef.current
    if (!input || !input.isConnected || !isPromptLikeElement(input)) return null

    return {
      exists: true,
      text: readPromptValue(input),
      input,
      submitButton: findSubmitButton(input)
    }
  }

  function getCurrentDraftSnapshot() {
    return getBoundPromptSnapshot() ?? getActiveSurfaceAdapter().getDraftPrompt()
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
    const liveSnapshot = getActiveSurfaceAdapter().getLatestAssistantResponse()
    const currentThread = getCurrentThreadSnapshot()
    const pinnedSnapshot = pinnedAssistantSnapshotRef.current

    if (!pinnedSnapshot || pinnedSnapshot.threadIdentity !== currentThread.identity) {
      return liveSnapshot
    }

    const normalizedLiveText = normalizeAssistantTextForReuse(liveSnapshot.text)
    const normalizedPinnedText = normalizeAssistantTextForReuse(pinnedSnapshot.text)

    if (!normalizedLiveText) {
      return {
        exists: true,
        text: pinnedSnapshot.text,
        identity: pinnedSnapshot.identity,
        node: pinnedSnapshot.node
      }
    }

    if (
      (liveSnapshot.identity && pinnedSnapshot.identity && liveSnapshot.identity === pinnedSnapshot.identity) ||
      normalizedLiveText === normalizedPinnedText
    ) {
      return liveSnapshot
    }

    return {
      exists: true,
      text: pinnedSnapshot.text,
      identity: pinnedSnapshot.identity,
      node: pinnedSnapshot.node
    }
  }

  function getLiveAssistantSnapshot() {
    return getActiveSurfaceAdapter().getLatestAssistantResponse()
  }

  function getCurrentReviewPromptSnapshot() {
    const liveSnapshot = getCurrentUserSnapshot()
    const liveText = liveSnapshot.text.trim()
    const fallbackText =
      pendingPromptRef.current?.prompt.trim() ||
      lastSubmittedOrAppliedPromptRef.current.trim()

    if (isReplitSurface() && !reviewTypingState.active && fallbackText) {
      return {
        exists: true,
        text: fallbackText,
        node: liveSnapshot.node ?? null
      }
    }

    if (liveText) {
      return {
        ...liveSnapshot,
        text: liveText
      }
    }

    return {
      exists: Boolean(fallbackText),
      text: fallbackText,
      node: liveSnapshot.node ?? null
    }
  }

  function getCurrentUserSnapshot() {
    const boundPromptSnapshot = getBoundPromptSnapshot()
    if (boundPromptSnapshot) {
      const text = boundPromptSnapshot.text.trim()
      if (!text) {
        return {
          exists: false,
          text: "",
          node: boundPromptSnapshot.input
        }
      }

      return {
        exists: true,
        text,
        node: boundPromptSnapshot.input
      }
    }

    return getActiveSurfaceAdapter().getLatestUserPrompt()
  }

  function getProjectPlanningSeedText(existingDescription = "") {
    return resolveProjectPlanningSeedText({
      latestUserPromptText: getActiveSurfaceAdapter().getLatestUserPrompt().text,
      draftPromptText: getCurrentDraftSnapshot().text,
      existingDescription
    })
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
    const inferredPrompt =
      userMessage ||
      submittedPrompt ||
      lastSubmittedOrAppliedPromptRef.current.trim()
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

  function getLiveAssistantResponseText() {
    const snapshot = getLiveAssistantSnapshot()
    return {
      latestMessage: snapshot.node,
      text: snapshot.text,
      identity: snapshot.identity
    }
  }

  function getAnswerCompletionState() {
    return getActiveSurfaceAdapter().getAnswerCompletionState()
  }

  function normalizeAssistantTextForReuse(value: string) {
    return value.replace(/\s+/g, " ").trim()
  }

  function shouldPauseReplitReviewRuntime() {
    return isReplitSurface() && isReplitConnectionInterrupted()
  }

  function maybeScheduleReviewSignalRefresh(reason: string, promptText = "") {
    if (shouldPauseReplitReviewRuntime()) {
      logReviewDebug("signal refresh skipped during reconnect state", { reason })
      return
    }

    if (hasUnsentPromptDraft(promptText.trim())) {
      return
    }

    scheduleReviewSignalRefresh(reason)
  }

  function shouldPauseReplitHeavyScan(promptText = "") {
    if (!isReplitSurface()) return false
    if (shouldPauseReplitReviewRuntime()) return true
    return hasUnsentPromptDraft(promptText.trim())
  }

  function shouldSkipReplitFreshnessPoll() {
    if (!isReplitSurface()) return false
    if (document.visibilityState === "hidden") return true
    if (shouldPauseReplitReviewRuntime()) return true
    if (awaitingFreshReviewAnswerRef.current) return false
    if (popupOpenRef.current || reviewPopupOpenStateRef.current) return false
    return true
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
        getAnswerCompletionState,
        getLatestUserPrompt: () => getCurrentReviewPromptSnapshot(),
        getThread: () => getCurrentThreadSnapshot(),
        getLatestSubmittedAttempt: () => getLatestSubmittedAttempt(),
        getPinnedSubmittedAttempt: () => lastSubmittedAttemptRef.current,
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
        analyzeDeepAnalysisV2: async (input) => {
          const startedAt = Date.now()
          trackProductEvent("deep_analysis_started", {
            feature_area: "deep_analysis",
            status: "started"
          })
          try {
            const analysis = await analyzeDeepAnalysisV2(input)
            const provider = normalizeAnalyticsProvider(analysis.providerMetadata.provider)
            const params: AnalyticsEventParams = {
              feature_area: "deep_analysis",
              status: analysis.overallStatus === "unavailable" ? "failed" : "success",
              duration_ms: analysis.providerMetadata.latencyMs ?? Date.now() - startedAt,
              provider_winner: provider,
              error_reason: analysis.providerMetadata.fallbackReason
            }
            const deepAnalysisProviderAttempts = new Set<string>()
            if (analysis.providerMetadata.providerAttempted && analysis.providerMetadata.providerAttempted !== "none") {
              deepAnalysisProviderAttempts.add(analysis.providerMetadata.providerAttempted)
              trackLlmProviderAttempt({
                provider: analysis.providerMetadata.providerAttempted,
                status:
                  analysis.providerMetadata.timedOut || analysis.providerMetadata.fallbackReason === "timeout"
                    ? "timeout"
                    : analysis.overallStatus === "unavailable"
                      ? "failed"
                      : "success",
                durationMs: analysis.providerMetadata.latencyMs,
                errorReason: analysis.providerMetadata.fallbackReason
              })
            }
            if (analysis.providerMetadata.deepSeekAttempted && !deepAnalysisProviderAttempts.has("deepseek")) {
              trackLlmProviderAttempt({
                provider: "deepseek",
                status: analysis.providerMetadata.deepSeekFailureReason === "timeout" ? "timeout" : "failed",
                durationMs: analysis.providerMetadata.deepSeekLatencyMs,
                errorReason: analysis.providerMetadata.deepSeekFailureReason
              })
            }
            trackProductEvent(
              analysis.overallStatus === "unavailable" ? "deep_analysis_failed" : "deep_analysis_succeeded",
              params
            )
            trackProductEvent(
              analysis.overallStatus === "unavailable" ? "llm_request_failed" : "llm_request_succeeded",
              {
                ...params,
                feature_area: "reliability"
              }
            )
            return analysis
          } catch (error) {
            trackProductEvent("deep_analysis_failed", {
              feature_area: "deep_analysis",
              status: "failed",
              duration_ms: Date.now() - startedAt,
              error_reason: error instanceof Error ? error.name || "request_failed" : "request_failed"
            })
            trackProductEvent("llm_request_failed", {
              feature_area: "reliability",
              status: "failed",
              duration_ms: Date.now() - startedAt,
              error_reason: error instanceof Error ? error.name || "request_failed" : "request_failed"
            })
            throw error
          }
        },
        getDeepAnalysisV2PreflightResult: ({ target, promptText }) => {
          const tracker = projectTrackerRecordRef.current
          if (!tracker || !projectTrackerMatchesCurrentBinding(tracker)) return null
          const finalReviewAnalysis = buildProjectTrackerFinalReviewAnalysis({
            tracker,
            target,
            promptText
          })
          if (finalReviewAnalysis) return finalReviewAnalysis
          if (!tracker.enabled) return null
          return buildProjectTrackerAwaitingFreshAnswerAnalysis({
            tracker,
            target,
            promptText
          })
        },
        getDeepAnalysisV2ContextOverride: () => {
          const tracker = projectTrackerRecordRef.current
          if (!tracker?.enabled || !projectTrackerMatchesCurrentBinding(tracker)) return null
          const trackerBrief = buildProjectTrackerDeepAnalysisBrief(tracker)
          if (!trackerBrief) return null

          return {
            ...trackerBrief,
            source: "project_tracker"
          }
        },
        transformDeepAnalysisV2Result: ({ analysis, promptText, target }) => {
          const tracker = projectTrackerRecordRef.current
          if (!tracker?.enabled) return analysis
          if (!projectTrackerMatchesCurrentBinding(tracker)) return analysis
          const trackerBrief = buildProjectTrackerDeepAnalysisBrief(tracker)
          if (!trackerBrief) return analysis
          if (hashDeepAnalysisV2Text(trackerBrief.promptText) !== hashDeepAnalysisV2Text(promptText)) return analysis

          const isAwaitingFreshAnswerAnalysis =
            analysis.phaseAdvanceBasis === "awaiting_fresh_answer_for_current_phase"

          if (!isAwaitingFreshAnswerAnalysis && (analysis.overallStatus === "unavailable" || analysis.providerMetadata.provider === "none")) {
            logProjectPlanningDiagnostics("tracker_deep_analysis_unavailable", {
              ...getProjectTrackerDiagnostics({
                record: tracker,
                advanceRecommended: false
              }),
              overallStatus: analysis.overallStatus,
              confidence: analysis.confidence,
              providerName: analysis.providerMetadata.provider,
              fallbackReason: analysis.providerMetadata.fallbackReason,
              failureMessage: analysis.providerMetadata.failureMessage
            })

            return {
              ...analysis,
              recommendedNextMove: "Deep Analysis v2 did not return an LLM result. Retry before submitting the next project-tracker prompt.",
              generatedPrompt: "",
              nextStepSource: "unavailable",
              nextStepRequirements: [],
              blockedScope: ["Do not advance the project tracker without an LLM-backed review."],
              userExplanation:
                "Deep Analysis v2 did not return an LLM-backed result, so Project Tracker did not generate a next prompt."
            }
          }

          const advanceRecommended = shouldAdvanceProjectTrackerFromAnalysis(analysis)
          const trackerPrompt = buildProjectTrackerHandoffPrompt({
            record: tracker,
            analysis,
            latestAnswerContext: target.responseText
          })
          if (!trackerPrompt) return analysis

          logProjectPlanningDiagnostics("tracker_deep_analysis_result", {
            ...getProjectTrackerDiagnostics({
              record: tracker,
              advanceRecommended
            }),
            overallStatus: analysis.overallStatus,
            confidence: analysis.confidence
          })

          const hasSpecificTrackerMatches = getSpecificProjectTrackerRequirementMatches(analysis).length > 0
          const trackerAdjustedAnalysis =
            !advanceRecommended && trackerPrompt.promptIntent === "confirm_missing_requirements"
              ? {
                  ...analysis,
                  overallStatus: "needs_confirmation" as const,
                  assistantSuggestedNextMove: null,
                  userExplanation:
                    "Project tracker needs specific current-phase evidence before advancing to the next phase.",
                  requirementMatches: hasSpecificTrackerMatches
                    ? analysis.requirementMatches
                    : trackerPrompt.nextStepRequirements.map((requirementText, index) => ({
                        requirementId: `project-tracker-missing-${index + 1}`,
                        requirementText,
                        status: "missing" as const,
                        evidence: [],
                        note: "Tracker guard blocked advancement because the Deep Analysis result did not provide specific phase-level proof."
                      }))
                }
              : analysis
          const trackerUserExplanation = normalizeProjectTrackerExplanation(trackerAdjustedAnalysis)

          return {
            ...trackerAdjustedAnalysis,
            userExplanation: trackerUserExplanation,
            requirementMatches: trackerAdjustedAnalysis.requirementMatches?.map((match) => ({
              ...match,
              note: /no (user prompt|assistant answer).*provided/i.test(match.note ?? "")
                ? trackerUserExplanation
                : match.note
            })),
            promptIntent: trackerPrompt.promptIntent,
            generatedPrompt: trackerPrompt.generatedPrompt,
            recommendedNextMove: trackerPrompt.recommendedNextMove,
            nextStepSource: "project_memory",
            nextStepRequirements: trackerPrompt.nextStepRequirements,
            blockedScope: trackerPrompt.blockedScope
          }
        },
        interpretNextMovePrompt: (request) => interpretNextMovePrompt(request).then((result) => result.output),
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

  async function copyPromptForManualHandoff(
    prompt: string,
    options: {
      sourcePromptOverride?: string
      successMessage: string
      failureMessage?: string
      featureArea?: AnalyticsEventParams["feature_area"]
      showNotice?: boolean
    }
  ) {
    const normalizedPrompt = prompt.trim()
    if (!normalizedPrompt) return false

    const copied = await copyTextToClipboardBestEffort(normalizedPrompt)
    trackProductEvent(copied ? "prompt_copied" : "prompt_copy_failed", {
      feature_area: options.featureArea ?? "prompt_submit",
      status: copied ? "success" : "failed"
    })
    if (options.showNotice !== false) {
      showPlanningGoalNotice(
        copied
          ? options.successMessage
          : options.failureMessage ?? "Copy failed. Keep this popup open, then try Copy Prompt again after focusing the page."
      )
    }
    return copied
  }

  async function captureBugReportScreenshotFromTab() {
    const response = await chrome.runtime.sendMessage({
      type: "PROMPT_OPTIMIZER_CAPTURE_VISIBLE_TAB"
    }) as {
      ok?: boolean
      dataUrl?: string
      mimeType?: string
      error?: string
    }

    if (!response?.ok || !response.dataUrl) {
      throw new Error(response?.error || "Screenshot capture failed")
    }

    return {
      dataUrl: response.dataUrl,
      mimeType: response.mimeType || "image/jpeg"
    }
  }

  function dataUrlToFile(dataUrl: string, mimeType: string, filename: string) {
    const [header, base64Data = ""] = dataUrl.split(",", 2)
    const effectiveMimeType = mimeType || header.match(/^data:([^;]+)/)?.[1] || "image/jpeg"
    const binary = window.atob(base64Data)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return new File([bytes], filename, { type: effectiveMimeType })
  }

  function findBugScreenshotFileInput() {
    const fileInputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[type='file']"))
    return (
      fileInputs.find((input) => {
        if (input.disabled) return false
        const accept = input.accept.toLowerCase()
        return !accept || accept.includes("image") || accept.includes(".png") || accept.includes(".jpg") || accept.includes(".jpeg")
      }) ?? null
    )
  }

  function clickLikelyBugScreenshotAttachButton() {
    const buttons = Array.from(document.querySelectorAll<HTMLElement>("button,[role='button'],[aria-label],[title]"))
    const attachButton = buttons.find((button) => {
      const label = [
        button.getAttribute("aria-label"),
        button.getAttribute("title"),
        button.textContent
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()

      if (!label) return false
      return /\b(attach|upload|image|file|photo|screenshot)\b/.test(label)
    })

    attachButton?.click()
    return Boolean(attachButton)
  }

  async function waitForBugScreenshotFileInput() {
    let imageInput = findBugScreenshotFileInput()
    if (imageInput) return imageInput

    clickLikelyBugScreenshotAttachButton()
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 100))
      imageInput = findBugScreenshotFileInput()
      if (imageInput) return imageInput
    }

    return null
  }

  async function attachBugScreenshotsToPrompt(screenshots: BugReportScreenshotRecord[]) {
    const validScreenshots = screenshots.filter((screenshot) => screenshot.dataUrl)
    if (!validScreenshots.length) return false

    const imageInput = await waitForBugScreenshotFileInput()

    if (!imageInput) return false

    try {
      const transfer = new DataTransfer()
      for (const screenshot of validScreenshots) {
        transfer.items.add(dataUrlToFile(screenshot.dataUrl, screenshot.mimeType, `bug-screenshot-${screenshot.id}.jpg`))
      }
      imageInput.files = transfer.files
      imageInput.dispatchEvent(new Event("input", { bubbles: true }))
      imageInput.dispatchEvent(new Event("change", { bubbles: true }))
      return true
    } catch (error) {
      console.warn("[prompt-optimizer] Failed to attach bug screenshot", error)
      return false
    }
  }

  async function attachBugScreenshotToPrompt(screenshot: BugReportScreenshotRecord | null) {
    return attachBugScreenshotsToPrompt(screenshot ? [screenshot] : [])
  }

  function buildBugFixPromptFromAnswers(input: {
    answers: Record<string, string>
  }) {
    const detailRows = [
      ["Bug", input.answers.bug_summary],
      ["Steps to reproduce", input.answers.steps_to_reproduce],
      ["Expected behavior", input.answers.expected_behavior],
      ["Actual behavior", input.answers.actual_behavior],
      ["Where it happens", input.answers.bug_location],
      ["Extra evidence", input.answers.evidence]
    ]
      .map(([label, value]) => {
        const trimmed = String(value ?? "").trim()
        return trimmed ? `- ${label}: ${trimmed}` : ""
      })
      .filter(Boolean)

    return [
      "Please fix this bug only.",
      "",
      "Bug report:",
      ...detailRows,
      "",
      "Screenshot evidence:",
      "- Before submitting this prompt, attach screenshots or a screen recording of the bug directly in the AI agent.",
      "",
      "Scope rules:",
      "- Fix only the described bug.",
      "- Do not add unrelated features, redesigns, payments, or new architecture.",
      "- Do not add a new backend or auth system; if the bug is inside an existing backend/auth flow, fix only the existing flow required for this bug.",
      "- Preserve existing behavior unless it directly causes this bug.",
      "",
      "After you finish, confirm:",
      "- Root cause",
      "- Files changed",
      "- How the fix was verified",
      "- Any remaining risks"
    ].join("\n")
  }

  async function handleAddPostTrackerBugScreenshot(input: { dataUrl: string; mimeType: string }) {
    if (!projectMemoryKey || !projectMemoryLabel) return
    if (bugReportScreenshots.length >= 10) {
      setBugReportScreenshotError("You can add up to 10 screenshots.")
      return
    }

    setBugReportScreenshotCapturing(true)
    setBugReportScreenshotError(null)
    try {
      const saved = await saveBugReportScreenshot({
        projectKey: projectMemoryKey,
        projectLabel: projectMemoryLabel,
        dataUrl: input.dataUrl,
        mimeType: input.mimeType,
        sourceUrl: window.location.href
      })
      setBugReportScreenshots((current) => [saved, ...current.filter((item) => item.id !== saved.id)].slice(0, 10))
    } catch (error) {
      setBugReportScreenshotError(error instanceof Error ? error.message : "Screenshot upload failed")
    } finally {
      setBugReportScreenshotCapturing(false)
    }
  }

  async function handleClearPostTrackerBugScreenshot() {
    if (!projectMemoryKey) return
    await clearBugReportScreenshot(projectMemoryKey)
    setBugReportScreenshots([])
    setBugReportScreenshotError(null)
  }

  async function handleSubmitPostTrackerBugFixPrompt(prompt: string) {
    await copyPromptForManualHandoff(prompt.trim(), {
      successMessage: "Bug prompt copied. Paste it into Replit, attach screenshots or a screen recording there, then click Start.",
      featureArea: "next_move"
    })
    if (projectMemoryKey && bugReportScreenshots.length) {
      await clearBugReportScreenshot(projectMemoryKey)
      setBugReportScreenshots([])
      setBugReportScreenshotError(null)
    }
  }

  function buildScopedPostTrackerNextMovePrompt(input: {
    choice: "small_feature" | "small_change"
    answers: Record<string, string>
  }) {
    if (input.choice === "small_feature") {
      const detailRows = [
        ["Feature", input.answers.feature_goal],
        ["User value", input.answers.user_value],
        ["Placement", input.answers.placement],
        ["Out of scope", input.answers.out_of_scope],
        ["Done criteria", input.answers.done_criteria]
      ]
        .map(([label, value]) => {
          const trimmed = String(value ?? "").trim()
          return trimmed ? `- ${label}: ${trimmed}` : ""
        })
        .filter(Boolean)

      return [
        "Please implement this new small feature only.",
        "",
        "Feature brief:",
        ...detailRows,
        "",
        "Scope rules:",
        "- Keep this as a focused addition to the completed MVP.",
        "- Do not start a new PRD or rebuild the existing app.",
        "- Do not add unrelated features, backend changes, auth, payments, or a redesign unless explicitly required above.",
        "- Preserve existing working flows unless they directly need to support this feature.",
        "",
        "After you finish, confirm:",
        "- What changed",
        "- Which requested details were completed",
        "- How I can manually test it",
        "- Any risks or follow-up needed"
      ].join("\n")
    }

    const detailRows = [
      ["Change", input.answers.change_summary],
      ["Location", input.answers.change_location],
      ["Desired result", input.answers.desired_result],
      ["Keep unchanged", input.answers.keep_unchanged],
      ["Verification", input.answers.verification]
    ]
      .map(([label, value]) => {
        const trimmed = String(value ?? "").trim()
        return trimmed ? `- ${label}: ${trimmed}` : ""
      })
      .filter(Boolean)

    return [
      "Please make this small change only.",
      "",
      "Change brief:",
      ...detailRows,
      "",
      "Scope rules:",
      "- Keep the change narrow and avoid unrelated cleanup.",
      "- Do not add new features, backend changes, auth, payments, or architecture changes.",
      "- Preserve existing behavior unless the requested change explicitly modifies it.",
      "",
      "After you finish, confirm:",
      "- What changed",
      "- What stayed unchanged",
      "- How I can verify the change",
      "- Any risks or follow-up needed"
    ].join("\n")
  }

  function buildLargeFeaturePostTrackerPrompt(answers: Record<string, string>) {
    const detailRows = [
      ["Large feature or new module", answers.feature_summary],
      ["Target user and need", answers.target_user],
      ["Must-have workflows", answers.core_flows],
      ["Existing behavior to protect", answers.protected_behavior],
      ["Constraints, deadline, platform, or data limits", answers.constraints],
      ["Success criteria", answers.success_criteria]
    ]
      .map(([label, value]) => {
        const trimmed = String(value ?? "").trim()
        return trimmed ? `- ${label}: ${trimmed}` : ""
      })
      .filter(Boolean)

    return [
      "Before implementing, create a fresh PRD for this large feature.",
      "",
      "Large feature brief:",
      ...detailRows,
      "",
      "Planning rules:",
      "- Treat this as a new large feature that extends the completed MVP.",
      "- Use the existing app as context, but do not restart or rebuild completed MVP phases.",
      "- Create clear implementation phases with goals, build scope, out of scope, data/state needed, deliverables, acceptance criteria, and validation proof.",
      "- Keep the first implementation phase narrow and safe.",
      "- Do not implement the feature yet.",
      "",
      "After you finish, confirm:",
      "- The PRD title",
      "- The recommended implementation phases",
      "- What should be implemented first",
      "- What should stay out of scope"
    ].join("\n")
  }

  type PostTrackerNextMoveChoice = "small_feature" | "large_feature" | "bug_fix" | "small_change"

  function buildPostTrackerNextMoveFallbackPrompt(input: {
    choice: PostTrackerNextMoveChoice
    answers: Record<string, string>
  }) {
    if (input.choice === "bug_fix") {
      return buildBugFixPromptFromAnswers({
        answers: input.answers
      })
    }

    if (input.choice === "large_feature") {
      return buildLargeFeaturePostTrackerPrompt(input.answers)
    }

    return buildScopedPostTrackerNextMovePrompt({
      choice: input.choice,
      answers: input.answers
    })
  }

  function nextMoveGenerationBrief(choice: PostTrackerNextMoveChoice) {
    switch (choice) {
      case "large_feature":
        return "Generate a precise PRD-planning prompt for a large feature. It must ask for planning and phases before implementation."
      case "bug_fix":
        return "Generate a precise bug-fix prompt for the AI coding agent."
      case "small_change":
        return "Generate a precise small-change prompt for the AI coding agent."
      default:
        return "Generate a precise small-feature prompt for the AI coding agent."
    }
  }

  async function handleGeneratePostTrackerNextMovePrompt(
    choice: PostTrackerNextMoveChoice,
    answers: Record<string, string>
  ) {
    const fallbackPrompt = buildPostTrackerNextMoveFallbackPrompt({
      choice,
      answers
    })
    const nextMoveBrief = [
      nextMoveGenerationBrief(choice),
      "Use the user's answers and completed MVP context.",
      "Make the prompt specific, scoped, and ready for the AI development assistant.",
      "Protect the completed MVP from unrelated changes.",
      "",
      fallbackPrompt
    ].join("\n")

    try {
      const result = await refinePrompt({
        prompt: nextMoveBrief,
        surface: getPromptSurface(),
        intent: choice === "bug_fix" ? "DEBUG" : "OTHER",
        answers: {
          ...answers,
          next_move_type: choice,
          screenshot: choice === "bug_fix"
            ? "User should attach screenshots or a screen recording directly in the AI agent before submitting."
            : ""
        },
        sessionSummary: summarizeSessionMemory(currentSession)
      })
      return result.improved_prompt.trim() || fallbackPrompt
    } catch {
      return fallbackPrompt
    }
  }

  async function handleSubmitPostTrackerNextMovePrompt(choice: PostTrackerNextMoveChoice, prompt: string) {
    if (choice === "bug_fix") {
      await handleSubmitPostTrackerBugFixPrompt(prompt)
      return
    }

    await copyPromptForManualHandoff(prompt.trim(), {
      successMessage: "Prompt copied. Paste it into Replit and click Start.",
      featureArea: "next_move"
    })
  }

  async function runReviewSignalAnalysis(reason: string) {
    if (!BACKGROUND_QUICK_REVIEW_ENABLED) {
      setReviewSignal(createIdleReviewSignal())
      return
    }

    const requestId = ++reviewSignalRequestIdRef.current
    if (shouldPauseReplitReviewRuntime()) {
      setReviewSignal(createIdleReviewSignal())
      return
    }
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
      setReviewSignal(createIdleReviewSignal())
      const result = await getReviewAnalysisRunner()({
        target,
        mode: "quick",
        quickBaseline: null
      })
      if (requestId !== reviewSignalRequestIdRef.current) return

      const quickEvaluation = evaluateQuickSignal({ result, target })
      const signal =
        quickEvaluation.confidence === "low"
          ? mapReviewResultToSignal({
              result,
              taskType: target.taskType,
              targetKey
            })
          : mapQuickEvaluationToReviewSignal({
              evaluation: quickEvaluation,
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
        signal: signal.state,
        requestKind: signal.requestKind,
        signalReason: signal.reason
      })
    }

    if (
      reviewPopupOpenStateRef.current &&
      projectPanelView === "closed" &&
      reviewPopupSurface === "answer_mode" &&
      reviewPopupTargetKeyRef.current !== targetKey
    ) {
      logReviewDebug("popup switching to newer answer", {
        previousTargetKey: reviewPopupTargetKeyRef.current,
        nextTargetKey: targetKey
      })
      reviewPopupOrchestratorRef.current?.invalidate()
      if (shouldOpenPostTrackerTestingCheckpointDirectly()) {
        openPostTrackerTestingCheckpointDirectly()
        return
      }
      void getReviewPopupOrchestrator().open()
    }
  }

  function scheduleReviewSignalRefresh(reason: string) {
    if (shouldPauseReplitReviewRuntime()) {
      return
    }

    const assistant = getLiveAssistantResponseText()
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

    const completionState = getAnswerCompletionState()
    if (completionState.isStreamingActive || !completionState.assistantControlsVisible) {
      logReviewDebug("answer observation waiting for completion controls", {
        reason,
        completionReason: completionState.reason,
        streaming: completionState.isStreamingActive,
        assistantControlsVisible: completionState.assistantControlsVisible
      })
      return
    }

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
      const latestCompletionState = getAnswerCompletionState()
      if (latestCompletionState.isStreamingActive || !latestCompletionState.assistantControlsVisible) {
        logReviewDebug("answer settle skipped while assistant is still updating", {
          reason,
          completionReason: latestCompletionState.reason,
          streaming: latestCompletionState.isStreamingActive,
          assistantControlsVisible: latestCompletionState.assistantControlsVisible
        })
        return
      }
      const currentAssistant = getLiveAssistantResponseText()
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
      pinnedAssistantSnapshotRef.current = {
        node: currentAssistant.latestMessage,
        text: currentAssistant.text,
        identity: currentAssistant.identity,
        threadIdentity: currentThread.identity
      }
      logReviewDebug("answer settled", {
        reason,
        settledKey,
        responseIdentity: currentAssistant.identity,
        responseLength: currentAssistant.text.trim().length
      })
      reviewPopupOrchestratorRef.current?.invalidate()
      if (shouldCapturePostTrackerFinalReviewAnswer()) {
        void capturePostTrackerFinalReviewAnswer()
        return
      }
      triggerActionIconAttention({
        kind: "review",
        token: `review-ready:${settledKey}`,
        durationMs: 14000
      })
      const deepAnalysisV2RolloutMode = getDeepAnalysisV2RolloutMode()
      if (shouldRunDeepAnalysisV2(deepAnalysisV2RolloutMode)) {
        const actionIconToken = `deep-analysis:${settledKey}:${Date.now()}`
        setActionIconLoading(actionIconToken, true)
        void getReviewPopupOrchestrator()
          .prewarm("deep")
          .then((warmed) => {
            logReviewDebug(warmed ? "deep analysis v2 prewarmed" : "deep analysis v2 prewarm skipped", {
              reason,
              settledKey,
              rolloutMode: deepAnalysisV2RolloutMode
            })
          })
          .catch((error) => {
            logReviewDebug("deep analysis v2 prewarm failed", {
              reason,
              settledKey,
              rolloutMode: deepAnalysisV2RolloutMode,
              error: error instanceof Error ? error.message : "unknown"
            })
          })
          .finally(() => {
            setActionIconLoading(actionIconToken, false)
          })
      }
      void runReviewSignalAnalysis("answer_settled")
    }, REVIEW_SIGNAL_SETTLE_MS)
  }

  function setActionIconLoading(token: string, loading: boolean) {
    if (loading) {
      deepAnalysisPrewarmTokensRef.current.add(token)
    } else {
      deepAnalysisPrewarmTokensRef.current.delete(token)
    }
    setIsDeepAnalysisPrewarming(deepAnalysisPrewarmTokensRef.current.size > 0)

    try {
      chrome.runtime.sendMessage(
        {
          type: "PROMPT_OPTIMIZER_ACTION_ICON",
          state: loading ? "loading" : "idle",
          token
        },
        () => {
          void chrome.runtime.lastError
        }
      )
    } catch {
      // The action icon is a non-critical affordance; analysis should continue if the worker is unavailable.
    }
  }

  function setActionIconAttention(input: {
    token: string
    kind: "onboarding" | "review"
    active: boolean
    durationMs?: number
  }) {
    const clearLocalAttentionTimeout = () => {
      const existingTimeout = actionIconAttentionTimeoutsRef.current.get(input.token)
      if (existingTimeout) {
        window.clearTimeout(existingTimeout)
        actionIconAttentionTimeoutsRef.current.delete(input.token)
      }
    }

    const syncReviewButtonAttention = () => {
      const activeKinds = [...activeActionIconAttentionTokensRef.current.values()]
      if (activeKinds.includes("review")) {
        setReviewButtonAttentionKind("review")
      } else {
        setReviewButtonAttentionKind(activeKinds[0] ?? null)
      }
    }

    clearLocalAttentionTimeout()
    if (input.active) {
      activeActionIconAttentionTokensRef.current.set(input.token, input.kind)
      const timeoutId = window.setTimeout(() => {
        activeActionIconAttentionTokensRef.current.delete(input.token)
        actionIconAttentionTimeoutsRef.current.delete(input.token)
        syncReviewButtonAttention()
      }, Math.max(1200, input.durationMs ?? 9000))
      actionIconAttentionTimeoutsRef.current.set(input.token, timeoutId)
    } else {
      activeActionIconAttentionTokensRef.current.delete(input.token)
    }
    syncReviewButtonAttention()

    try {
      chrome.runtime.sendMessage(
        {
          type: "PROMPT_OPTIMIZER_ACTION_ICON",
          state: "attention",
          token: input.token,
          kind: input.kind,
          active: input.active,
          durationMs: input.durationMs
        },
        () => {
          void chrome.runtime.lastError
        }
      )
    } catch {
      // The action icon is a non-critical affordance; user workflows should continue if unavailable.
    }
  }

  function triggerActionIconAttention(input: {
    kind: "onboarding" | "review"
    token: string
    durationMs?: number
  }) {
    if (popupOpenRef.current || reviewPopupOpenStateRef.current) return
    if (input.kind === "review") {
      if (input.token === lastReviewAttentionKeyRef.current) return
      lastReviewAttentionKeyRef.current = input.token
    }
    setActionIconAttention({ ...input, active: true })
  }

  function clearActionIconAttention() {
    for (const [token, kind] of [...activeActionIconAttentionTokensRef.current]) {
      setActionIconAttention({
        token,
        kind,
        active: false
      })
    }
    activeActionIconAttentionTokensRef.current.clear()
    for (const timeoutId of actionIconAttentionTimeoutsRef.current.values()) {
      window.clearTimeout(timeoutId)
    }
    actionIconAttentionTimeoutsRef.current.clear()
    setReviewButtonAttentionKind(null)
  }

  function isNewProjectEntryLocation() {
    const { hostname, pathname } = window.location
    const normalizedPath = pathname.replace(/\/+$/, "") || "/"
    if ((hostname === "replit.com" || hostname === "www.replit.com") && (normalizedPath === "/" || normalizedPath === "/~")) {
      return true
    }
    if ((hostname === "chatgpt.com" || hostname === "chat.openai.com") && normalizedPath === "/") {
      return true
    }
    return false
  }

  function shouldTreatCurrentLocationAsNewProject() {
    const projectHasMemory = Boolean(
      projectContextDraftRef.current.trim() ||
        currentStateDraftRef.current.trim() ||
        importedProjectContextRef.current?.rawMarkdown.trim()
    )
    const hasActiveTracker = Boolean(projectTrackerRecordRef.current?.enabled)
    const hasAssistantResponse = Boolean(getLiveAssistantResponseText().text.trim())

    return shouldTreatProjectEntryAsNew({
      isEntryLocation: isNewProjectEntryLocation(),
      projectHasMemory,
      hasActiveTracker,
      hasAssistantResponse
    })
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
      projectContext: compactContextForApi(projectContextDraftRef.current, 4000),
      currentState: compactContextForApi(currentStateDraftRef.current, 3000),
      importedContext: importedProjectContextRef.current,
      structuredMemory: projectStructuredMemoryRef.current,
      settings: projectSettingsRecord
    }
  }

  function showArchitectureConfirmation(
    source: ArchitectureConfirmationState["source"],
    candidate: ArchitectureRecordV1 | null | undefined,
    baseMemory: StructuredProjectMemory | null | undefined
  ) {
    try {
      if (!candidate) {
        setArchitectureConfirmation(null)
        return
      }
      const combined = mergeStructuredProjectMemory(baseMemory, { architecture: candidate })?.architecture
      const draft = formatArchitectureRecordForConfirmation(combined)
      if (!draft) return
      setArchitectureConfirmation({ source, draft, editing: false })
    } catch {
      setArchitectureConfirmation(null)
    }
  }

  function handleArchitectureConfirmationEdit() {
    setArchitectureConfirmation((current) => current ? { ...current, editing: true } : current)
  }

  function handleArchitectureConfirmationDraftChange(value: string) {
    setArchitectureConfirmation((current) => current ? { ...current, draft: value } : current)
  }

  async function handleArchitectureConfirmationConfirm() {
    if (!architectureConfirmation || !projectMemoryKey || !projectMemoryLabel) return

    setIsSavingProjectMemory(true)
    try {
      const parsed = parseArchitectureConfirmationDraft(architectureConfirmation.draft)
      if (!parsed) {
        setArchitectureConfirmation((current) => current ? { ...current, editing: true } : current)
        showPlanningGoalNotice("Keep at least one architecture item under the provided headings before saving.")
        return
      }
      const existingDecisions = projectStructuredMemoryRef.current?.architecture?.decisions
      const confirmedArchitecture: ArchitectureRecordV1 = {
        ...parsed,
        ...(existingDecisions?.length ? { decisions: existingDecisions } : {})
      }
      const nextStructuredMemory = replaceStructuredProjectMemoryFields(projectStructuredMemoryRef.current, {
        architecture: confirmedArchitecture
      })
      const saved = await saveProjectMemory({
        projectKey: projectMemoryKey,
        projectLabel: projectMemoryLabel,
        projectContext: projectContextDraftRef.current,
        currentState: currentStateDraftRef.current,
        importedContext: importedProjectContextRef.current,
        structuredMemory: nextStructuredMemory,
        replaceArchitecture: true,
        settings: projectSettingsRecord,
        memoryDepth: projectMemoryDepth,
        awaitingFreshAnswer: projectMemoryAwaitingFreshAnswerRef.current,
        baselineResponseIdentity: projectMemoryBaselineResponseRef.current?.identity ?? "",
        baselineResponseText: projectMemoryBaselineResponseRef.current?.normalizedText ?? "",
        baselineThreadIdentity: projectMemoryBaselineResponseRef.current?.threadIdentity ?? ""
      })

      const savedStructuredMemory = saved.structuredMemory ?? nextStructuredMemory
      setProjectStructuredMemory(savedStructuredMemory)
      projectStructuredMemoryRef.current = savedStructuredMemory
      setProjectSettingsRecord(saved.settings ?? createDefaultProjectSettingsRecord())
      setArchitectureConfirmation(null)
      showPlanningGoalNotice("Architecture record saved")

      if (accountState.status === "authenticated") {
        void syncProjectMemoryToCloud({
          projectContext: saved.projectContext,
          currentState: saved.currentState,
          importedContext: saved.importedContext ?? null,
          structuredMemory: savedStructuredMemory,
          settings: saved.settings ?? createDefaultProjectSettingsRecord(),
          memoryDepth: saved.memoryDepth === "quick" ? "quick" : "deep"
        })
      }
    } catch {
      showPlanningGoalNotice("Architecture record was not saved. Your existing project memory is unchanged.")
    } finally {
      setIsSavingProjectMemory(false)
    }
  }

  async function persistProjectMemoryPatch(params: {
    structuredPatch?: StructuredProjectMemory | null
    awaitingFreshAnswer?: boolean
    baselineResponseIdentity?: string
    baselineResponseText?: string
    baselineThreadIdentity?: string
  } = {}) {
    if (!projectMemoryKey || !projectMemoryLabel) return

    const mergedStructuredMemory = mergeStructuredProjectMemory(projectStructuredMemoryRef.current, params.structuredPatch ?? null)
    const baselineIdentity =
      params.baselineResponseIdentity ?? projectMemoryBaselineResponseRef.current?.identity ?? ""
    const baselineText =
      params.baselineResponseText ??
      (projectMemoryBaselineResponseRef.current?.normalizedText ? projectMemoryBaselineResponseRef.current.normalizedText : "")
    const baselineThreadIdentity =
      params.baselineThreadIdentity ?? projectMemoryBaselineResponseRef.current?.threadIdentity ?? ""

    const saved = await saveProjectMemory({
      projectKey: projectMemoryKey,
      projectLabel: projectMemoryLabel,
      projectContext: projectContextDraftRef.current,
      currentState: currentStateDraftRef.current,
      importedContext: importedProjectContextRef.current,
      structuredMemory: mergedStructuredMemory,
      memoryDepth: projectMemoryDepth,
      awaitingFreshAnswer: params.awaitingFreshAnswer ?? projectMemoryAwaitingFreshAnswerRef.current,
      baselineResponseIdentity: baselineIdentity,
      baselineResponseText: baselineText,
      baselineThreadIdentity
    })

    setProjectStructuredMemory(mergedStructuredMemory)
    setImportedProjectContext(saved.importedContext ?? null)
    projectStructuredMemoryRef.current = mergedStructuredMemory
    importedProjectContextRef.current = saved.importedContext ?? null
    setProjectSettingsRecord(saved.settings ?? createDefaultProjectSettingsRecord())
    if (accountState.status === "authenticated") {
      scheduleProjectMemorySync()
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
        baseline_acceptance_criteria: [],
        baseline_acceptance_checklist: [],
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
      const reviewContext = getReviewAnalysisContext(result)
      projectMemoryAwaitingFreshAnswerRef.current = false
      projectMemoryBaselineResponseRef.current = null
      if (projectMemoryKey && projectMemoryLabel) {
        await persistProjectMemoryPatch({
          structuredPatch: buildStructuredProjectMemoryPatchFromAnalysis({
            promptText: attempt.optimized_prompt || attempt.raw_prompt || attempt.intent.goal || "",
            goalContract: reviewContext?.goalContract ?? null,
            reviewContract: reviewContext?.reviewContract ?? null,
            resultStatus: normalizeProjectMemoryResultStatus(result.status),
            taskType: targetOverride?.attempt.intent.task_type || attempt.intent.task_type,
            previousWorkflowState: projectStructuredMemory?.currentWorkflowState ?? null
          }),
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

  async function loadProjectCatalog() {
    try {
      setProjectCatalogItems(await getProjectCatalog())
    } catch (error) {
      console.warn("[prompt-optimizer] Failed to load project catalog", error)
      setProjectCatalogItems([])
    }
  }

  async function loadBugReportScreenshot() {
    if (!projectMemoryKey) return

    try {
      setBugReportScreenshots(await getBugReportScreenshots(projectMemoryKey))
      setBugReportScreenshotError(null)
    } catch (error) {
      console.warn("[prompt-optimizer] Failed to load bug screenshot", error)
      setBugReportScreenshots([])
    }
  }

  useEffect(() => {
    void bootstrapAccountState()
    void loadProjectCatalog()
  }, [])

  useEffect(() => {
    projectMemoryKeyRef.current = projectMemoryKey
    projectMemoryLabelRef.current = projectMemoryLabel
  }, [projectMemoryKey, projectMemoryLabel])

  useEffect(() => {
    setArchitectureConfirmation(null)
    void loadBugReportScreenshot()
  }, [projectMemoryKey])

  useEffect(() => {
    projectTrackerRecordRef.current = projectTrackerRecord
  }, [projectTrackerRecord])

  useEffect(() => {
    if (!projectMemoryKey) return
    if (accountState.status === "loading") return
    void loadProjectMemoryForCurrentLocation()
  }, [accountState.status, projectMemoryKey])

  useEffect(() => {
    if (
      shouldAutoCloseProjectSetupPanel({
        panelView: projectPanelView,
        projectHasMemory: hasProjectMemory
      })
    ) {
      setProjectPanelView("closed")
    }
  }, [hasProjectMemory, projectPanelView])

  useEffect(() => {
    if (!projectMemoryKey || !supportsProjectWorkflowSurface()) return

    const snapshot = buildCurrentProgressSnapshot()
    if (!snapshot) return

    const timeoutId = window.setTimeout(() => {
      void saveProjectProgress({
        projectKey: projectMemoryKey,
        ...snapshot
      }).then(() => {
        if (accountState.status === "authenticated") {
          scheduleProjectProgressSync()
        }
      })
    }, 250)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [
    accountState.status,
    afterAttempt,
    afterDisplayedReviewMode,
    afterNextPromptDraft,
    afterPlanningGoal,
    afterVerdict,
    projectMemoryKey,
    projectOnboardingRecord,
    projectPlanningState,
    reviewPopupControllerState.targetKey,
    reviewPopupSurface,
    reviewPopupViewModel.workflowState,
    reviewPromptModeState,
    reviewTypingState.sessionKey
  ])

  useEffect(() => {
    if (!isSupportedPromptPage()) return

    void getSessionSummary().then((existing) => {
      if (existing) setSession(existing)
    })
    void loadProjectMemoryForCurrentLocation()

    const scan = () => {
      if (popupOpenRef.current) {
        positionHost()
        maybeScheduleReviewSignalRefresh("popup-open-mutation")
        return
      }

      const currentDraft = getCurrentDraftSnapshot().text.trim()
      if (shouldPauseReplitHeavyScan(currentDraft)) {
        if (promptRef.current && promptRef.current.isConnected) {
          positionHost()
        }
        return
      }

      const visibleSubmit = submitRef.current ?? findVisiblePromptSubmitButton()
      const input = getPreferredComposerAnchor(visibleSubmit)
      if (!input) {
        const fallbackInput = getStablePromptAnchorFallback()
        if (fallbackInput && fallbackInput.isConnected && isPromptLikeElement(fallbackInput)) {
          promptRef.current = fallbackInput
          submitRef.current = findSubmitButton(fallbackInput)
          const promptText = readPromptValue(fallbackInput)
          updateReviewTypingState(promptText)
          positionHost()
          maybeScheduleReviewSignalRefresh("fallback-scan", promptText)
          return
        }

        const fallbackSubmit = visibleSubmit
        if (fallbackSubmit) {
          const resolvedNearbyInput = getPreferredComposerAnchor(fallbackSubmit)
          promptRef.current = resolvedNearbyInput
          if (resolvedNearbyInput) {
            lastFocusedPromptRef.current = resolvedNearbyInput
            const promptText = readPromptValue(resolvedNearbyInput)
            updateReviewTypingState(promptText)
            maybeScheduleReviewSignalRefresh("submit-anchor-scan", promptText)
          }
          submitRef.current = fallbackSubmit
          positionHost()
          return
        }

        promptRef.current = null
        submitRef.current = null
        positionHost()
        maybeScheduleReviewSignalRefresh("no-input-scan")
        return
      }

      const inputChanged = promptRef.current !== input
      promptRef.current = input
      lastFocusedPromptRef.current = input
      submitRef.current = findSubmitButton(input)
      const promptText = readPromptValue(input)
      updateReviewTypingState(promptText)
      positionHost()
      maybeScheduleReviewSignalRefresh("scan", promptText)
      if (inputChanged) {
        setInputBindingVersion((current) => current + 1)
      }
    }

    const handleFocusIn = (event: FocusEvent) => {
      if (popupOpenRef.current) return

      const target = event.target
      const candidate = findPromptLikeAncestor(target)
      if (!candidate) return

      const visibleSubmit = submitRef.current ?? findVisiblePromptSubmitButton()
      const preferredCandidate = getPreferredComposerAnchor(visibleSubmit)
      if (!preferredCandidate) return

      const sameComposerTarget =
        candidate === preferredCandidate ||
        preferredCandidate.contains(candidate) ||
        candidate.contains(preferredCandidate)
      if (!sameComposerTarget) {
        positionHost()
        return
      }

      const inputChanged = promptRef.current !== preferredCandidate
      promptRef.current = preferredCandidate
      lastFocusedPromptRef.current = preferredCandidate
      submitRef.current = findSubmitButton(preferredCandidate)
      positionHost()
      const promptText = readPromptValue(preferredCandidate)
      updateReviewTypingState(promptText)
      maybeScheduleReviewSignalRefresh("focus", promptText)
      if (inputChanged) {
        setInputBindingVersion((current) => current + 1)
      }
    }

    scan()
    let scanTimeoutId: number | null = null
    const scheduleScan = () => {
      const currentDraft = getCurrentDraftSnapshot().text.trim()
      if (shouldPauseReplitHeavyScan(currentDraft)) {
        return
      }
      if (scanTimeoutId != null) return
      scanTimeoutId = window.setTimeout(() => {
        scanTimeoutId = null
        scan()
      }, isReplitSurface() ? 140 : 0)
    }

    const observer = new MutationObserver((mutations) => {
      if (!shouldScheduleScanFromMutations(mutations)) return
      scheduleScan()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    document.addEventListener("focusin", handleFocusIn)
    window.addEventListener("resize", positionHost)
    window.addEventListener("scroll", positionHost, true)
    const freshnessIntervalId = window.setInterval(() => {
      if (shouldSkipReplitFreshnessPoll()) return
      const currentDraft = getCurrentDraftSnapshot().text.trim()
      maybeScheduleReviewSignalRefresh("poll", currentDraft)
    }, 2500)
    setMounted(true)

    return () => {
      observer.disconnect()
      if (scanTimeoutId != null) {
        window.clearTimeout(scanTimeoutId)
      }
      document.removeEventListener("focusin", handleFocusIn)
      window.removeEventListener("resize", positionHost)
      window.removeEventListener("scroll", positionHost, true)
      window.clearInterval(freshnessIntervalId)
      if (retryTimeoutRef.current) window.clearTimeout(retryTimeoutRef.current)
      if (afterLoadingIntervalRef.current) {
        window.clearInterval(afterLoadingIntervalRef.current)
        afterLoadingIntervalRef.current = null
      }
      if (projectMemorySyncTimeoutRef.current) {
        window.clearTimeout(projectMemorySyncTimeoutRef.current)
        projectMemorySyncTimeoutRef.current = null
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

    if (popupOpenRef.current) {
      clearActionIconAttention()
    }

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
    const maybeTriggerOnboardingAttention = () => {
      if (!shouldTreatCurrentLocationAsNewProject()) return

      const urlKey = window.location.href.split("#")[0]
      if (urlKey === lastOnboardingAttentionUrlRef.current) return
      lastOnboardingAttentionUrlRef.current = urlKey
      triggerActionIconAttention({
        kind: "onboarding",
        token: `onboarding:${urlKey}`,
        durationMs: 9000
      })
    }

    maybeTriggerOnboardingAttention()
    const intervalId = window.setInterval(maybeTriggerOnboardingAttention, 1500)
    window.addEventListener("popstate", maybeTriggerOnboardingAttention)
    window.addEventListener("hashchange", maybeTriggerOnboardingAttention)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener("popstate", maybeTriggerOnboardingAttention)
      window.removeEventListener("hashchange", maybeTriggerOnboardingAttention)
    }
  }, [])

  useEffect(() => {
    const input = promptRef.current

    let debounceId: number | null = null
    let deferredInputSyncId: number | null = null

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

    const scheduleDeferredInputSync = (candidate: HTMLElement) => {
      if (deferredInputSyncId != null) {
        window.clearTimeout(deferredInputSyncId)
      }

      deferredInputSyncId = window.setTimeout(() => {
        deferredInputSyncId = null
        bindPromptTarget(candidate)
        handleInput(candidate)
      }, 0)
    }

    const handleDocumentInput = (event: Event) => {
      const candidate = findPromptLikeAncestor(event.target)
      if (!candidate) return

      bindPromptTarget(candidate)
      handleInput(candidate)
    }

    const handleDocumentBeforeInput = (event: InputEvent) => {
      const candidate = findPromptLikeAncestor(event.target)
      if (!candidate) return

      scheduleDeferredInputSync(candidate)
    }

    const handleDocumentKeydown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey || event.altKey || event.isComposing || event.repeat) return

      const candidate = findPromptLikeAncestor(event.target)
      if (!candidate) return

      bindPromptTarget(candidate)
      void handleSubmit(event.metaKey || event.ctrlKey ? "shortcut-enter" : "enter", candidate)
    }

    const handleDocumentTypingKeydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat) return
      if (!(event.key.length === 1 || event.key === "Backspace" || event.key === "Delete" || event.key === " " || event.key === "Tab")) {
        return
      }

      const candidate = findPromptLikeAncestor(event.target)
      if (!candidate) return

      scheduleDeferredInputSync(candidate)
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

      const candidate = promptRef.current ?? findPromptInput() ?? findPromptInputNearSubmitButton(button)
      if (!candidate) return

      const submitButton = findSubmitButton(candidate)
      const fallbackSubmitButton = submitButton ?? findVisiblePromptSubmitButton()
      if (!fallbackSubmitButton || fallbackSubmitButton !== button) return

      bindPromptTarget(candidate)
      void handleSubmit("submit-click", candidate)
    }

    document.addEventListener("input", handleDocumentInput, true)
    document.addEventListener("beforeinput", handleDocumentBeforeInput, true)
    document.addEventListener("keydown", handleDocumentKeydown, true)
    document.addEventListener("keydown", handleDocumentTypingKeydown, true)
    document.addEventListener("submit", handleDocumentSubmit, true)
    document.addEventListener("click", handleDocumentClick, true)
    handleInput(input ?? undefined)

    return () => {
      document.removeEventListener("input", handleDocumentInput, true)
      document.removeEventListener("beforeinput", handleDocumentBeforeInput, true)
      document.removeEventListener("keydown", handleDocumentKeydown, true)
      document.removeEventListener("keydown", handleDocumentTypingKeydown, true)
      document.removeEventListener("submit", handleDocumentSubmit, true)
      document.removeEventListener("click", handleDocumentClick, true)
      if (debounceId) window.clearTimeout(debounceId)
      if (deferredInputSyncId != null) window.clearTimeout(deferredInputSyncId)
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
      setProjectPanelView("closed")
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
      })
      setPromptProjectContextImportOpen(false)
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
      pinnedAssistantSnapshotRef.current = null
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
      lastSubmittedAttemptRef.current = null
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

    if (supportsProjectWorkflowSurface() && text && !hasProjectMemory) {
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
        ["Use Next Move below or send a prompt first."],
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
        onCopyPrompt: async (prompt) => {
          const copied = await copyPromptForManualHandoff(prompt, {
            successMessage: "Prompt copied. Paste it into Replit and click Start.",
            failureMessage: "Copy failed. Focus the page and click Copy Prompt again.",
            featureArea: "deep_analysis",
            showNotice: false
          })
          setReviewPromptCopyFeedback({
            prompt,
            message: copied
              ? "Prompt copied. Paste it into Replit and click Send."
              : "Copy failed. Focus the page and click Copy Prompt again.",
            tone: copied ? "success" : "error"
          })
        },
        shouldSuppressSoftFallback: () => {
          const tracker = projectTrackerRecordRef.current
          return Boolean(tracker?.enabled && projectTrackerMatchesCurrentBinding(tracker))
        },
        onDecisionShown: ({ target, mode, result, reviewContract, viewModel, cacheStatus }) => {
          if (mode === "deep" && cacheStatus !== "hit") {
            void syncProjectTrackerFromDeepAnalysis(result)
          }
          if (mode === "deep") {
            const context = getReviewAnalysisContext(result)
            const analysis = context?.deepAnalysisV2Applied ? context.deepAnalysisV2 : null
            trackProductEvent("deep_analysis_result_viewed", {
              feature_area: "deep_analysis",
              status: analysis?.overallStatus === "unavailable" ? "failed" : "success",
              provider_winner: normalizeAnalyticsProvider(analysis?.providerMetadata.provider),
              duration_ms: analysis?.providerMetadata.latencyMs
            })
            if (viewModel.prompt.trim()) {
              trackProductEvent("deep_analysis_next_prompt_generated", {
                feature_area: "deep_analysis",
                status: "success",
                provider_winner: normalizeAnalyticsProvider(analysis?.providerMetadata.provider)
              })
            }
          }
          void appendNextMoveTelemetryEvent(
            buildNextMoveTelemetryEvent({
              eventType: "decision_shown",
              target,
              result,
              reviewContract,
              viewModel,
              mode,
              projectKey: projectMemoryKeyRef.current || undefined,
              projectLabel: projectMemoryLabelRef.current || undefined
            })
          ).then(() => scheduleNextMoveEvalCandidateSync())
        },
        onPrimaryActionClicked: async ({ target, mode, result, reviewContract, viewModel }) => {
          if (mode === "deep") {
            await syncProjectTrackerFromDeepAnalysis(result)
            await syncProjectTrackerFinalReviewCopied(result, viewModel.prompt)
            trackProductEvent("prompt_copied", {
              feature_area: "deep_analysis",
              status: "success"
            })
          }
          void appendNextMoveTelemetryEvent(
            buildNextMoveTelemetryEvent({
              eventType: "primary_action_clicked",
              target,
              result,
              reviewContract,
              viewModel,
              mode,
              projectKey: projectMemoryKeyRef.current || undefined,
              projectLabel: projectMemoryLabelRef.current || undefined,
              userAction: viewModel.nextMoveDecision?.recommendation.primaryCtaLabel ?? "primary_action"
            })
          )
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

  function hasRestorablePromptModeState() {
    return Boolean(
      reviewPromptModeState.sessionKey ||
        reviewPromptModeState.questionHistory.length ||
        reviewPromptModeState.promptDraft.trim() ||
        reviewPromptModeState.promptReady
    )
  }

  function resetReviewPromptModeStateForEmptyDraft() {
    setReviewPromptModeState(createEmptyReviewPromptModeState())
    setPromptPreview("")
  }

  function truncateNextMoveV2ContextValue(value: string, maxLength = 180) {
    const normalized = value.replace(/\s+/g, " ").trim()
    if (normalized.length <= maxLength) return normalized
    return `${normalized.slice(0, maxLength - 1).trim()}…`
  }

  function formatNextMoveV2ContextList(label: string, values: string[] | null | undefined, limit = 4) {
    const items = (values ?? [])
      .map((value) => truncateNextMoveV2ContextValue(value))
      .filter(Boolean)
      .slice(0, limit)
    if (!items.length) return ""
    return [`${label}:`, ...items.map((item) => `- ${item}`)].join("\n")
  }

  function buildImplementationProjectContextPack() {
    try {
      return buildProjectContextPack({
        projectContext: projectContextDraftRef.current,
        currentState: currentStateDraftRef.current,
        importedContext: importedProjectContextRef.current,
        structuredMemory: projectStructuredMemoryRef.current,
        settings: projectSettingsRecord
      })
    } catch {
      return null
    }
  }

  function buildNextMoveV2ProjectContextBrief() {
    const importedContext = importedProjectContextRef.current
    const structuredMemory = projectStructuredMemoryRef.current
    const tracker = projectTrackerRecordRef.current
    const trackerPhases = tracker?.phases ?? []
    const completedPhases = trackerPhases
      .filter((phase) => phase.status === "completed")
      .map((phase) => phase.title)
    const activePhase = tracker ? tracker.phases[tracker.currentPhaseIndex] ?? null : null
    const nextPhase = tracker ? tracker.phases[tracker.currentPhaseIndex + 1] ?? null : null

    const lines = [
      projectMemoryLabelRef.current ? `Project: ${truncateNextMoveV2ContextValue(projectMemoryLabelRef.current, 120)}` : "",
      importedContext?.projectContext
        ? `Product/context: ${truncateNextMoveV2ContextValue(importedContext.projectContext, 360)}`
        : "",
      importedContext?.currentState
        ? `Current state: ${truncateNextMoveV2ContextValue(importedContext.currentState, 280)}`
        : "",
      structuredMemory?.currentFeatureArea
        ? `Current feature area: ${truncateNextMoveV2ContextValue(structuredMemory.currentFeatureArea, 160)}`
        : "",
      structuredMemory?.currentPhase ? `Current phase: ${structuredMemory.currentPhase}` : "",
      activePhase ? `Tracker active phase: ${activePhase.title}` : "",
      nextPhase ? `Tracker next phase: ${nextPhase.title}` : "",
      completedPhases.length ? `Completed tracker phases: ${completedPhases.slice(0, 5).join(", ")}` : "",
      formatNextMoveV2ContextList("Known current build scope", activePhase?.buildScope, 4),
      formatNextMoveV2ContextList("Protected areas", structuredMemory?.protectedAreas, 5),
      formatNextMoveV2ContextList("Stable constraints", structuredMemory?.stableConstraints, 5),
      formatNextMoveV2ContextList("User intent to preserve", importedContext?.summary.userIntent, 4),
      formatNextMoveV2ContextList("Definition of done", importedContext?.summary.definitionOfDone, 4),
      formatNextMoveV2ContextList("Relevant files or screens", importedContext?.summary.relevantFiles, 4),
      formatNextMoveV2ContextList("Known bad directions", structuredMemory?.knownBadDirections, 4)
    ].filter(Boolean)

    return lines.join("\n").trim().slice(0, 1800)
  }

  function buildNextMoveV2QuestionSetPrompt(input: {
    promptText: string
    projectContextBrief: string
    choice: NextMoveV2Choice
  }) {
    const requiredTopics =
      input.choice === "large_feature"
        ? ["feature/module", "target user and need", "must-have workflows", "existing behavior to protect", "success criteria"]
        : input.choice === "bug_fix"
          ? ["bug summary", "steps to reproduce", "expected behavior", "actual behavior", "bug location"]
          : input.choice === "small_change"
            ? ["exact change", "change location", "desired result", "what stays unchanged", "verification"]
            : ["feature goal", "user value", "placement", "out of scope", "completion criteria"]

    return [
      "Generate one complete, coherent five-question decision tree for the selected next-move path.",
      "Return JSON only with this exact shape:",
      '{"questions":[{"label":"","helper":"","options":["","","",""],"placeholder":""},{"label":"","helper":"","options":["","","",""],"placeholder":""},{"label":"","helper":"","options":["","","",""],"placeholder":""},{"label":"","helper":"","options":["","","",""],"placeholder":""},{"label":"","helper":"","options":["","","",""],"placeholder":""}]}',
      "",
      "Rules:",
      "- Use the typed draft as context.",
      "- Use the project context brief when available.",
      "- Return exactly five questions in a logical order.",
      `- Cover these five topics in this exact order: ${requiredTopics.join("; ")}.`,
      "- Make the five questions complementary; do not repeat the same decision.",
      "- Make questions and answer options fit the existing app, completed work, protected areas, and constraints.",
      "- Do not ask generic questions when project context gives a more specific option.",
      "- Each label must be a short question for a non-technical user.",
      "- Each helper must be one short sentence explaining what to choose.",
      "- Each options array must contain 3 or 4 short answer options that can be selected together.",
      "- Do not make options mutually exclusive; the UI is multi-select.",
      "- Make options concrete and specific to the app/request instead of generic categories.",
      "- Each placeholder must be a concrete example answer.",
      "- Do not include an Other option; the UI adds it.",
      "- Do not generate the final prompt.",
      "- Do not ask multiple questions in one label.",
      "",
      `Selected path: ${NEXT_MOVE_V2_CHOICE_LABELS[input.choice]}`,
      input.projectContextBrief
        ? `Project context brief:\n${input.projectContextBrief}`
        : "Project context brief: unavailable",
      `Typed draft: ${input.promptText}`
    ].join("\n")
  }

  function parseNextMoveV2QuestionSetOutput(
    output: string | null,
    provider: string | undefined
  ): NextMoveV2QuestionSuggestion[] {
    if (!output?.trim()) return []

    try {
      const parsed = JSON.parse(output) as {
        questions?: Array<{ label?: unknown; helper?: unknown; options?: unknown; placeholder?: unknown }>
      }
      const questions = Array.isArray(parsed.questions) ? parsed.questions : []

      const nextQuestions: NextMoveV2QuestionSuggestion[] = []

      for (const question of questions) {
        const label = typeof question.label === "string" ? question.label.trim() : ""
        const helper = typeof question.helper === "string" ? question.helper.trim() : ""
        const options = Array.isArray(question.options)
          ? question.options.map((option) => String(option).trim()).filter(Boolean).slice(0, 4)
          : []
        const placeholder = typeof question.placeholder === "string" ? question.placeholder.trim() : ""
        const distinctOptions = new Set(options.map((option) => option.toLowerCase()))
        if (!label || !helper || !placeholder || options.length < 3 || distinctOptions.size !== options.length) continue

        nextQuestions.push({
          label,
          helper,
          options,
          placeholder,
          source: "ai",
          provider
        })

      }

      if (nextQuestions.length !== 5) return []
      const labels = new Set(nextQuestions.map((question) => question.label.toLowerCase()))
      if (labels.size !== 5) return []
      return nextQuestions
    } catch {
      return []
    }
  }

  function buildNextMoveV2FinalPromptGenerationPrompt(input: {
    promptText: string
    projectContextBrief: string
    choice: NextMoveV2Choice
    answers: Record<string, string>
    fallbackPrompt: string
  }) {
    return [
      "Generate the final scoped prompt for the selected next-move path.",
      "",
      "Rules:",
      "- Return the final prompt text only.",
      "- Preserve the fallback prompt section order, headings, opening line, scope rules, and confirmation checklist exactly.",
      "- Do not compress the fallback prompt into a prose paragraph.",
      "- Do not remove path-specific headings such as Feature brief, Large feature brief, Bug report, Change brief, Planning rules, Scope rules, or After you finish, confirm.",
      "- Improve clarity, specificity, and sequencing only inside the existing detail lines from the user's answers.",
      "- Use the project context brief to keep the prompt aligned with the existing app and saved PRD context.",
      "- Keep the same safety boundaries and scope rules from the fallback prompt.",
      "- Do not add unrelated scope.",
      "- If you cannot preserve the fallback structure, return the fallback prompt unchanged.",
      "- Do not wrap the response in JSON or markdown fences.",
      "",
      `Selected path: ${NEXT_MOVE_V2_CHOICE_LABELS[input.choice]}`,
      input.projectContextBrief ? `Project context brief:\n${input.projectContextBrief}` : "Project context brief: unavailable",
      `Typed draft: ${input.promptText}`,
      "Answers JSON:",
      JSON.stringify(input.answers, null, 2),
      "",
      "Fallback prompt baseline:",
      input.fallbackPrompt
    ].join("\n")
  }

  function parseNextMoveV2FinalPromptOutput(output: string | null): string {
    const trimmed = output?.trim() ?? ""
    if (!trimmed) return ""
    const fencedMatch = trimmed.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/)
    return (fencedMatch?.[1] ?? trimmed).trim()
  }

  function getNextMoveV2RequiredPromptAnchors(choice: NextMoveV2Choice): string[] {
    if (choice === "large_feature") {
      return [
        "Before implementing, create a fresh PRD for this large feature.",
        "Large feature brief:",
        "Planning rules:",
        "After you finish, confirm:"
      ]
    }

    if (choice === "bug_fix") {
      return [
        "Please fix this bug only.",
        "Bug report:",
        "Before submitting this prompt, attach screenshots or a screen recording of the bug directly in the AI agent.",
        "Scope rules:",
        "After you finish, confirm:"
      ]
    }

    if (choice === "small_change") {
      return ["Please make this small change only.", "Change brief:", "Scope rules:", "After you finish, confirm:"]
    }

    return ["Please implement this new small feature only.", "Feature brief:", "Scope rules:", "After you finish, confirm:"]
  }

  function isValidNextMoveV2FinalPrompt(choice: NextMoveV2Choice, prompt: string): boolean {
    const normalizedPrompt = prompt.toLowerCase()
    return getNextMoveV2RequiredPromptAnchors(choice).every((anchor) =>
      normalizedPrompt.includes(anchor.toLowerCase())
    )
  }

  async function loadNextMoveV2QuestionSet(
    choice: NextMoveV2Choice,
    sourcePromptOverride?: string
  ): Promise<NextMoveV2QuestionSuggestion[]> {
    const trimmedPrompt = (sourcePromptOverride ?? reviewPromptModeState.sourcePrompt).trim()
    if (!trimmedPrompt) return []

    const projectContextBrief = buildNextMoveV2ProjectContextBrief()
    const cacheKey = [
      buildPromptModeSessionKey(trimmedPrompt),
      buildPromptModeSessionKey(projectContextBrief),
      choice
    ].join("::")
    const cached = nextMoveV2QuestionSetCacheRef.current[cacheKey]
    if (cached) return cached

    const startedAt = Date.now()
    trackProductEvent("next_move_questions_started", {
      feature_area: "next_move",
      status: "started",
      next_move_path: choice
    })
    trackProductEvent("llm_request_started", {
      feature_area: "reliability",
      status: "started"
    })
    try {
      const result = await interpretNextMovePrompt({
        prompt: buildNextMoveV2QuestionSetPrompt({
          promptText: trimmedPrompt,
          projectContextBrief,
          choice
        }),
        answers: {},
        taskType: "next_move_v2_question_set"
      })
      for (const attempt of result.attemptedProviders ?? []) {
        trackLlmProviderAttempt({
          provider: attempt.provider,
          status: attempt.status,
          errorReason: attempt.status === "empty" ? "empty_response" : undefined
        })
      }
      const parsedQuestions = parseNextMoveV2QuestionSetOutput(result.output, result.provider)
      if (parsedQuestions.length === 5) {
        nextMoveV2QuestionSetCacheRef.current[cacheKey] = parsedQuestions
        trackProductEvent("next_move_questions_succeeded", {
          feature_area: "next_move",
          status: "success",
          duration_ms: Date.now() - startedAt,
          provider_winner: normalizeAnalyticsProvider(result.provider),
          next_move_path: choice,
          question_count: parsedQuestions.length
        })
        trackProductEvent("llm_request_succeeded", {
          feature_area: "reliability",
          status: "success",
          duration_ms: Date.now() - startedAt,
          provider_winner: normalizeAnalyticsProvider(result.provider)
        })
      } else {
        trackProductEvent("next_move_questions_failed", {
          feature_area: "next_move",
          status: "failed",
          duration_ms: Date.now() - startedAt,
          provider_winner: normalizeAnalyticsProvider(result.provider),
          next_move_path: choice,
          question_count: parsedQuestions.length,
          error_reason: "incomplete_question_set"
        })
        trackProductEvent("llm_request_failed", {
          feature_area: "reliability",
          status: "failed",
          duration_ms: Date.now() - startedAt,
          provider_winner: normalizeAnalyticsProvider(result.provider),
          error_reason: "incomplete_question_set"
        })
      }
      return parsedQuestions
    } catch {
      trackProductEvent("next_move_questions_failed", {
        feature_area: "next_move",
        status: "failed",
        duration_ms: Date.now() - startedAt,
        next_move_path: choice,
        error_reason: "request_failed"
      })
      trackProductEvent("llm_request_failed", {
        feature_area: "reliability",
        status: "failed",
        duration_ms: Date.now() - startedAt,
        error_reason: "request_failed"
      })
      return []
    }
  }

  async function generateNextMoveV2FinalPrompt(
    choice: NextMoveV2Choice,
    answers: Record<string, string>,
    fallbackPrompt: string,
    sourcePromptOverride?: string
  ): Promise<string> {
    const trimmedPrompt = (sourcePromptOverride ?? reviewPromptModeState.sourcePrompt).trim()
    const trimmedFallback = fallbackPrompt.trim()
    const projectContextPack = buildImplementationProjectContextPack()
    const appendSavedContext = (prompt: string) => appendProjectContextBlock(prompt, projectContextPack)
    if (!trimmedPrompt || !trimmedFallback) return appendSavedContext(trimmedFallback)

    const projectContextBrief = buildNextMoveV2ProjectContextBrief()
    const normalizedAnswers = Object.fromEntries(
      Object.entries(answers)
        .map(([key, value]) => [key, value.trim()] as const)
        .filter(([, value]) => value)
    )
    const cacheKey = [
      buildPromptModeSessionKey(trimmedPrompt),
      buildPromptModeSessionKey(projectContextBrief),
      choice,
      buildPromptModeSessionKey(JSON.stringify(normalizedAnswers)),
      buildPromptModeSessionKey(trimmedFallback)
    ].join("::")
    const cached = nextMoveV2FinalPromptCacheRef.current[cacheKey]
    if (cached) return appendSavedContext(cached)

    const startedAt = Date.now()
    trackProductEvent("next_move_prompt_generation_started", {
      feature_area: "next_move",
      status: "started",
      next_move_path: choice,
      answered_count: Object.keys(normalizedAnswers).length
    })
    try {
      const result = await interpretNextMovePrompt({
        prompt: buildNextMoveV2FinalPromptGenerationPrompt({
          promptText: trimmedPrompt,
          projectContextBrief,
          choice,
          answers: normalizedAnswers,
          fallbackPrompt: trimmedFallback
        }),
        answers: {},
        taskType: "next_move_v2_final_prompt"
      })
      for (const attempt of result.attemptedProviders ?? []) {
        trackLlmProviderAttempt({
          provider: attempt.provider,
          status: attempt.status,
          errorReason: attempt.status === "empty" ? "empty_response" : undefined
        })
      }
      const parsedPrompt = parseNextMoveV2FinalPromptOutput(result.output)
      const finalPrompt =
        parsedPrompt && isValidNextMoveV2FinalPrompt(choice, parsedPrompt) ? parsedPrompt : trimmedFallback
      nextMoveV2FinalPromptCacheRef.current[cacheKey] = finalPrompt
      trackProductEvent("next_move_prompt_generation_succeeded", {
        feature_area: "next_move",
        status: "success",
        duration_ms: Date.now() - startedAt,
        provider_winner: normalizeAnalyticsProvider(result.provider),
        next_move_path: choice,
        answered_count: Object.keys(normalizedAnswers).length
      })
      return appendSavedContext(finalPrompt)
    } catch {
      nextMoveV2FinalPromptCacheRef.current[cacheKey] = trimmedFallback
      trackProductEvent("next_move_prompt_generation_failed", {
        feature_area: "next_move",
        status: "failed",
        duration_ms: Date.now() - startedAt,
        next_move_path: choice,
        answered_count: Object.keys(normalizedAnswers).length,
        error_reason: "request_failed"
      })
      return appendSavedContext(trimmedFallback)
    }
  }

  function openNextMoveV2PromptMode(
    promptText: string,
    initialChoice: ReviewPromptModeState["nextMoveInitialChoice"] = null
  ) {
    const trimmedPrompt = promptText.trim()
    const sessionKey = trimmedPrompt ? buildPromptModeSessionKey(trimmedPrompt) : null
    setReviewPromptModeState({
      ...createEmptyReviewPromptModeState(),
      popupState: trimmedPrompt ? "questions" : "idle",
      sessionKey,
      sourcePrompt: trimmedPrompt,
      nextMoveInitialChoice: initialChoice,
      planningGoal: trimmedPrompt
    })
    setPromptPreview(trimmedPrompt)
    setReviewPopupSurface("prompt_mode")
    setReviewPopupOpen(true)
    trackProductEvent("next_move_opened", {
      feature_area: "next_move",
      status: "started",
      ...(initialChoice ? { next_move_path: initialChoice } : {})
    })
    if (initialChoice) {
      trackProductEvent("next_move_path_selected", {
        feature_area: "next_move",
        status: "started",
        next_move_path: initialChoice
      })
    }
  }

  function shouldOpenPostTrackerTestingCheckpointDirectly() {
    const tracker = projectTrackerRecordRef.current ?? projectTrackerRecord
    if (!tracker?.finalReviewAnswerReceivedAt) return false
    if (tracker.testingCheckpointAnsweredAt) return false
    const trackerCompleted =
      Boolean(tracker.completedAt) ||
      Boolean(tracker.phases.length && tracker.phases.every((phase) => phase.status === "completed"))
    return trackerCompleted && !tracker.enabled
  }

  function shouldCapturePostTrackerFinalReviewAnswer() {
    const tracker = projectTrackerRecordRef.current
    if (!tracker?.finalReviewPromptSubmittedAt || tracker.finalReviewAnswerReceivedAt) return false
    return Boolean(
      tracker.completedAt ||
        (tracker.phases.length && tracker.phases.every((phase) => phase.status === "completed"))
    )
  }

  async function capturePostTrackerFinalReviewAnswer() {
    const tracker = projectTrackerRecordRef.current
    if (!tracker || !projectTrackerMatchesCurrentBinding(tracker)) return
    const updated = markProjectTrackerFinalReviewAnswerReceived({ record: tracker })
    if (!updated) return

    applyProjectTrackerRecord(updated)
    try {
      const saved = await saveProjectTracker(updated)
      applyProjectTrackerRecord(saved)
      logProjectPlanningDiagnostics("tracker_final_review_answer_received", {
        ...getProjectTrackerDiagnostics({ record: saved }),
        projectId: saved.projectId
      })
      triggerActionIconAttention({
        kind: "review",
        token: `post-tracker-testing:${saved.projectId}:${saved.finalReviewAnswerReceivedAt}`,
        durationMs: 14000
      })
      if (reviewPopupOpenStateRef.current) {
        openPostTrackerTestingCheckpointDirectly()
      }
    } catch (error) {
      applyProjectTrackerRecord(tracker)
      logProjectPlanningDiagnostics("tracker_final_review_answer_marker_failed", {
        message: error instanceof Error ? error.message : "Unknown final review answer marker error"
      })
    }
  }

  async function handleProjectTrackerTestingCheckpointAnswered(choice: "needs_testing" | "testing_complete") {
    trackProductEvent("testing_gate_answered", {
      feature_area: "deep_analysis",
      status: choice === "testing_complete" ? "success" : "started"
    })
    if (choice === "needs_testing") {
      trackProductEvent("testing_prompt_generated", {
        feature_area: "deep_analysis",
        status: "started"
      })
    }
    if (choice !== "testing_complete") return
    const tracker = projectTrackerRecordRef.current
    if (!tracker || !projectTrackerMatchesCurrentBinding(tracker)) return
    const updated = markProjectTrackerTestingCheckpointAnswered({ record: tracker })
    if (!updated) return

    applyProjectTrackerRecord(updated)
    try {
      const saved = await saveProjectTracker(updated)
      applyProjectTrackerRecord(saved)
      trackProductEvent("testing_completed_confirmed", {
        feature_area: "deep_analysis",
        status: "success"
      })
    } catch (error) {
      applyProjectTrackerRecord(tracker)
      logProjectPlanningDiagnostics("tracker_testing_checkpoint_save_failed", {
        message: error instanceof Error ? error.message : "Unknown testing checkpoint save error"
      })
    }
  }

  function getLatestSubmittedPromptHash() {
    const latestSubmittedPrompt =
      lastSubmittedAttemptRef.current?.optimized_prompt?.trim() ||
      lastSubmittedAttemptRef.current?.raw_prompt?.trim() ||
      lastSubmittedOrAppliedPromptRef.current.trim() ||
      ""
    return latestSubmittedPrompt ? hashDeepAnalysisV2Text(latestSubmittedPrompt) : null
  }

  function openPostTrackerTestingCheckpointDirectly() {
    trackProductEvent("testing_gate_shown", {
      feature_area: "deep_analysis",
      status: "started"
    })
    setReviewPopupSurface("answer_mode")
    setReviewPopupViewModel({
      ...buildReviewLoadingViewModel("deep"),
      state: "deep_review",
      statusBadge: { label: "Ready for testing", tone: "info" },
      decision: "Tracked implementation phases are complete. Validate the finished work before adding new scope.",
      recommendedAction: "Confirm whether testing is complete, then choose the next move.",
      confidenceLabel: "Project Tracker",
      confidenceNote: "Deep Analysis is back to normal for future prompts.",
      uncheckedArtifacts: ["No critical missing items found."]
    })
    setReviewPopupControllerState({
      surface: "answer_mode",
      popupState: "idle",
      activeMode: "deep",
      targetKey: null,
      cacheStatus: "none",
      analysisStarted: false,
      analysisFinished: true,
      errorReason: null
    })
    setReviewPopupOpen(true)
  }

  async function handleOpenReviewPopup() {
    trackProductEvent("extension_opened")
    trackProductEvent("surface_detected")
    if (!supportsProjectWorkflowSurface()) {
      trackProductEvent("surface_unsupported", { status: "failed" })
    }
    if (
      isProjectPlanningSubmitGuardActive() ||
      (projectPlanningState.generatedPrd && (projectPlanningState.phase === "review" || projectPlanningState.phase === "saving"))
    ) {
      setPanelOpen(false)
      setAfterPanelOpen(false)
      setReviewPopupSurface("answer_mode")
      setProjectPanelView("planning")
      setReviewPopupOpen(true)
      return
    }
    setPanelOpen(false)
    setAfterPanelOpen(false)
    if (shouldTreatCurrentLocationAsNewProject()) {
      setProjectSetupDismissedProjectKey(null)
      setProjectPanelView("planning")
      setReviewPopupOpen(true)
      return
    }
    const preferReviewOverSetup = shouldPreferReviewOverProjectSetup({
      hasAssistantResponse: Boolean(getLiveAssistantResponseText().text.trim()),
      hasActiveTracker: Boolean(projectTrackerRecordRef.current?.enabled)
    })
    const setupView = preferReviewOverSetup ? null : resolveProjectSetupView()
    if (setupView) {
      setProjectPanelView(setupView)
      setReviewPopupOpen(true)
      return
    }
    if (shouldPauseReplitReviewRuntime()) {
      trackProductEvent("answer_analysis_opened", {
        feature_area: "deep_analysis",
        status: "started"
      })
      setReviewPopupSurface("answer_mode")
      setReviewPopupOpen(true)
      setReviewPopupViewModel(
        buildReviewLoadingViewModel("deep")
      )
      setReviewPopupControllerState({
        surface: "answer_mode",
        popupState: "idle",
        activeMode: "deep",
        targetKey: null,
        cacheStatus: "none",
        analysisStarted: false,
        analysisFinished: false,
        errorReason: "replit_reconnecting"
      })
      return
    }
    const currentDraft = getCurrentDraftSnapshot().text.trim()
    if (hasUnsentPromptDraft(currentDraft) && (reviewTypingState.active || NEXT_MOVE_V2_ENABLED)) {
      if (NEXT_MOVE_V2_ENABLED) {
        openNextMoveV2PromptMode(currentDraft)
        return
      }
      setReviewPopupSurface("prompt_mode")
      setReviewPopupOpen(true)
      await getReviewPromptModeOrchestrator().open({
        promptText: currentDraft,
        beforeIntent: beforeResult?.intent
      })
      return
    }

    if (shouldOpenPostTrackerTestingCheckpointDirectly()) {
      openPostTrackerTestingCheckpointDirectly()
      return
    }

    setReviewPopupSurface("answer_mode")
    trackProductEvent("answer_analysis_opened", {
      feature_area: "deep_analysis",
      status: "started"
    })
    await getReviewPopupOrchestrator().open()
  }

  async function handleSwitchReviewPopupSurface(surface: ReviewPopupSurface) {
    if (surface === "prompt_mode") {
      const currentDraft = getCurrentDraftSnapshot().text.trim()
      if (!currentDraft) {
        resetReviewPromptModeStateForEmptyDraft()
        setReviewPopupSurface("prompt_mode")
        setReviewPopupOpen(true)
        return
      }
      if (NEXT_MOVE_V2_ENABLED) {
        openNextMoveV2PromptMode(currentDraft)
        return
      }
      if (hasRestorablePromptModeState() && reviewPromptModeState.sourcePrompt.trim() === currentDraft) {
        setReviewPopupSurface("prompt_mode")
        setReviewPopupOpen(true)
        return
      }
      setReviewPopupSurface("prompt_mode")
      setReviewPopupOpen(true)
      await getReviewPromptModeOrchestrator().open({
        promptText: currentDraft,
        beforeIntent: beforeResult?.intent
      })
      return
    }

    if (shouldOpenPostTrackerTestingCheckpointDirectly()) {
      openPostTrackerTestingCheckpointDirectly()
      return
    }

    setReviewPopupSurface("answer_mode")
    trackProductEvent("answer_analysis_opened", {
      feature_area: "deep_analysis",
      status: "started"
    })
    await getReviewPopupOrchestrator().open()
  }

  async function handleRetryReviewAnalysis() {
    trackProductEvent("deep_analysis_retried", {
      feature_area: "deep_analysis",
      status: "started"
    })
    setReviewPopupSurface("answer_mode")
    await getReviewPopupOrchestrator().retry("deep")
  }

  async function handleProjectOnboardingChooseInProgress() {
    setProjectSetupDismissedProjectKey(null)
    await persistProjectOnboardingState({
      status: "in_progress_import",
      entryChoice: "in_progress",
      completedAt: null
    })
    setProjectPanelView("context")
    setReviewPopupOpen(true)
  }

  async function handleProjectOnboardingChooseStartingNow() {
    setProjectSetupDismissedProjectKey(null)
    await persistProjectOnboardingState({
      status: "planning_ready",
      entryChoice: "starting_now",
      completedAt: null
    })
    setProjectPlanningState((current) =>
      createEmptyProjectPlanningState(getProjectPlanningSeedText(current.description))
    )
    setProjectPlanningDebugPayload(null)
    setProjectPanelView("planning")
    setReviewPopupOpen(true)
  }

  function handleProjectOnboardingOpen() {
    setProjectSetupDismissedProjectKey(null)
    setProjectPanelView("onboarding")
    setReviewPopupOpen(true)
  }

  function handleProjectPlanningOpen() {
    setProjectSetupDismissedProjectKey(null)
    setProjectPanelView("planning")
    setReviewPopupOpen(true)
    trackProductEvent("project_planning_opened", {
      feature_area: "project_planning",
      status: "started"
    })
  }

  function handleProjectsOpen() {
    void loadProjectCatalog()
    setProjectPanelView("projects")
    setReviewPopupOpen(true)
  }

  function handleProjectPlanningBackToOnboarding() {
    setProjectPlanningErrorMessage(null)
    setProjectPlanningCopyMessage(null)
    setProjectPlanningDebugPayload(null)
    setProjectPanelView("onboarding")
  }

  function handleProjectPlanningDraftChange(value: string) {
    if (!projectPlanningState.description.trim() && value.trim()) {
      trackProductEvent("project_planning_intake_started", {
        feature_area: "project_planning",
        status: "started"
      })
    }
    projectPlanningGenerationAttemptRef.current = 0
    setProjectPlanningErrorMessage(null)
    setProjectPlanningCopyMessage(null)
    setProjectPlanningDebugPayload(null)
    setProjectPlanningState((current) => ({
      ...current,
      description: value,
      coverageReport: current.phase === "intake" ? null : current.coverageReport,
      prdSnapshot: current.phase === "intake" ? null : current.prdSnapshot,
      generatedPrd: current.phase === "review" ? null : current.generatedPrd,
      completed: false
    }))
  }

  function handleProjectPlanningQuestionIndexChange(index: number) {
    setProjectPlanningErrorMessage(null)
    setProjectPlanningCopyMessage(null)
    setProjectPlanningState((current) => ({
      ...current,
      activeQuestionIndex: Math.max(0, Math.min(index, Math.max(0, current.questions.length - 1)))
    }))
  }

  function handleProjectPlanningAnswerChange(questionId: string, value: string) {
    projectPlanningGenerationAttemptRef.current = 0
    setProjectPlanningErrorMessage(null)
    setProjectPlanningCopyMessage(null)
    setProjectPlanningState((current) => {
      const question = current.questions.find((item) => item.id === questionId)

      const nextState: ProjectPlanningState = {
        ...current,
        answerState: {
          ...current.answerState,
          [questionId]: value
        },
        completed: false
      }

      if (question?.mode === "single" && value !== PROJECT_PLANNING_OTHER_OPTION) {
        nextState.activeQuestionIndex = Math.min(current.activeQuestionIndex + 1, current.questions.length - 1)
      }

      return nextState
    })
  }

  function handleProjectPlanningToggleMultiAnswer(questionId: string, value: string) {
    projectPlanningGenerationAttemptRef.current = 0
    setProjectPlanningErrorMessage(null)
    setProjectPlanningCopyMessage(null)
    setProjectPlanningState((current) => {
      const existing = current.answerState[questionId]
      const currentValues = Array.isArray(existing) ? existing : []
      const nextValues = currentValues.includes(value)
        ? currentValues.filter((item) => item !== value)
        : [...currentValues, value]

      return {
        ...current,
        answerState: {
          ...current.answerState,
          [questionId]: nextValues
        },
        completed: false
      }
    })
  }

  function handleProjectPlanningOtherAnswerChange(questionId: string, value: string) {
    projectPlanningGenerationAttemptRef.current = 0
    setProjectPlanningErrorMessage(null)
    setProjectPlanningCopyMessage(null)
    setProjectPlanningState((current) => ({
      ...current,
      otherAnswerState: {
        ...current.otherAnswerState,
        [questionId]: value
      },
      completed: false
    }))
  }

  function handleProjectPlanningAdvanceQuestion() {
    setProjectPlanningErrorMessage(null)
    setProjectPlanningCopyMessage(null)
    setProjectPlanningState((current) => {
      const activeQuestion = current.questions[current.activeQuestionIndex]
      if (!activeQuestion) return current
      if (!hasAnsweredPlanningQuestion(activeQuestion, current.answerState, current.otherAnswerState)) return current

      return {
        ...current,
        activeQuestionIndex: Math.min(current.activeQuestionIndex + 1, current.questions.length - 1)
      }
    })
  }

  function handleProjectPlanningBackToIntake() {
    setProjectPlanningErrorMessage(null)
    setProjectPlanningCopyMessage(null)
    setProjectPlanningDebugPayload(null)
    setProjectPlanningState((current) => ({
      ...current,
      phase: "intake",
      activeQuestionIndex: 0,
      prdSnapshot: null,
      generatedPrd: null,
      completed: false
    }))
  }

  async function handleProjectPlanningBuildDraft() {
    const description = projectPlanningState.description.trim()
    if (!description) return
    setProjectPlanningCopyMessage(null)

    const coverageReport = projectPlanningState.coverageReport ?? analyzeProjectDescription(description)
    const intakeQuestions = PROJECT_PLANNING_INTAKE_QUESTIONS.filter((question) => {
      if (question.id.startsWith("intake_nfr_")) return false
      const answer = projectPlanningState.answerState[question.id]
      return typeof answer === "string" ? Boolean(answer.trim()) : Array.isArray(answer) && answer.length > 0
    })
    const questions = [...intakeQuestions, ...projectPlanningState.questions].slice(0, 8)
    const answerState = projectPlanningState.answerState
    const otherAnswerState = projectPlanningState.otherAnswerState
    const intakeFields = buildProjectPlanningIntakeFields({
      description,
      answerState
    })

    if (
      questions.some(
        (question) =>
          !hasAnsweredPlanningQuestion(question, answerState, otherAnswerState)
      )
    ) {
      return
    }
    trackProductEvent("project_planning_intake_completed", {
      feature_area: "project_planning",
      status: "success",
      question_count: questions.length,
      answered_count: questions.length
    })

    setProjectPlanningGeneratingDraft(true)
    setProjectPlanningDebugPayload(null)
    const generationStartedAt = Date.now()
    const retryCount = projectPlanningGenerationAttemptRef.current
    trackProductEvent(retryCount > 0 ? "prd_generation_retried" : "prd_generation_started", {
      feature_area: "project_planning",
      status: "started",
      question_count: questions.length,
      retry_count: retryCount
    })
    trackProductEvent("llm_request_started", {
      feature_area: "reliability",
      status: "started",
      retry_count: retryCount
    })

    let generatedPrd: ProjectPlanningState["generatedPrd"] = null
    try {
      const result = await generateProjectPlanningDraft({
        projectLabel: projectMemoryLabel || "Project",
        description,
        generationAttempt: projectPlanningGenerationAttemptRef.current,
        intakeFields,
        coverageReport,
        prdSnapshot: projectPlanningState.prdSnapshot ?? undefined,
        questions,
        answerState,
        otherAnswerState
      })
      projectPlanningGenerationAttemptRef.current = 0
      generatedPrd = result.draft
      logProjectPlanningDiagnostics("prd_generated", result.diagnostics)
      for (const attempt of result.diagnostics.providerAttempts ?? []) {
        trackLlmProviderAttempt({
          provider: attempt.providerName,
          status: attempt.status,
          durationMs: attempt.durationMs,
          errorReason: attempt.errorReason
        })
      }
      trackProductEvent("prd_generation_succeeded", {
        feature_area: "project_planning",
        status: "success",
        duration_ms: result.diagnostics.durationMs || Date.now() - generationStartedAt,
        provider_winner: normalizeAnalyticsProvider(result.diagnostics.providerName),
        question_count: questions.length,
        retry_count: retryCount
      })
      trackProductEvent("llm_request_succeeded", {
        feature_area: "reliability",
        status: "success",
        duration_ms: result.diagnostics.durationMs || Date.now() - generationStartedAt,
        provider_winner: normalizeAnalyticsProvider(result.diagnostics.providerName)
      })
      const draftPayload = buildProjectPlanningContextPayload(result.draft)
      const draftSubmissionPrompt = result.draft.submissionPrompt.trim() || buildProjectPlanningSubmissionPrompt(result.draft)
      const draftTracker = buildProjectTrackerRecord({
        projectKey: projectMemoryKey,
        projectLabel: projectMemoryLabel,
        surface: getProjectTrackerSurface(),
        prdHash: hashProjectTrackerText(draftPayload.rawMarkdown),
        submittedPromptHash: hashProjectTrackerText(draftSubmissionPrompt),
        phases: result.draft.implementationPhases
      })
      setProjectPlanningDebugPayload({
        stage: "prd_draft",
        status: "success",
        diagnostics: result.diagnostics,
        tracker: getProjectTrackerDiagnostics({
          record: draftTracker
        }),
        intakeFields,
        phaseTitles: result.draft.implementationPhases.map((phase) => phase.title)
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI PRD generation was unavailable."
      const diagnostics = getProjectPlanningDiagnosticsFromError(error)
      projectPlanningGenerationAttemptRef.current = Math.min(
        projectPlanningGenerationAttemptRef.current + 1,
        3
      )
      if (diagnostics) logProjectPlanningDiagnostics("prd_failed", diagnostics)
      for (const attempt of diagnostics?.providerAttempts ?? []) {
        trackLlmProviderAttempt({
          provider: attempt.providerName,
          status: attempt.status,
          durationMs: attempt.durationMs,
          errorReason: attempt.errorReason
        })
      }
      trackProductEvent("prd_generation_failed", {
        feature_area: "project_planning",
        status: diagnostics?.errorReason === "provider_timeout" ? "timeout" : "failed",
        duration_ms: diagnostics?.durationMs ?? Date.now() - generationStartedAt,
        provider_winner: normalizeAnalyticsProvider(diagnostics?.providerName),
        error_reason: diagnostics?.errorReason ?? "unknown",
        question_count: questions.length,
        retry_count: projectPlanningGenerationAttemptRef.current
      })
      trackProductEvent("llm_request_failed", {
        feature_area: "reliability",
        status: diagnostics?.errorReason === "provider_timeout" ? "timeout" : "failed",
        duration_ms: diagnostics?.durationMs ?? Date.now() - generationStartedAt,
        provider_winner: normalizeAnalyticsProvider(diagnostics?.providerName),
        error_reason: diagnostics?.errorReason ?? "unknown"
      })
      if (diagnostics?.repairAttempted) {
        trackProductEvent("llm_json_repair_attempted", {
          feature_area: "reliability",
          status: "started"
        })
        trackProductEvent(diagnostics.repairSucceeded ? "llm_json_repair_succeeded" : "llm_json_repair_failed", {
          feature_area: "reliability",
          status: diagnostics.repairSucceeded ? "success" : "failed"
        })
      }
      setProjectPlanningDebugPayload({
        stage: "prd_draft",
        status: "failed",
        diagnostics,
        tracker: getProjectTrackerDiagnostics(),
        intakeFields,
        errorMessage: message
      })
      setProjectPlanningErrorMessage(
        diagnostics?.malformedJson
          ? "The AI returned an incomplete PRD structure. Your answers are preserved; retry will use a corrective JSON request."
          : diagnostics?.errorReason === "provider_timeout"
            ? "The AI providers did not finish in time, even after the structured PRD retry. Your answers are preserved; please retry."
            : `${message} Your answers are preserved; please retry PRD generation.`
      )
      return
    } finally {
      setProjectPlanningGeneratingDraft(false)
    }

    setProjectPlanningState((current) => ({
      ...current,
      description,
      coverageReport,
      phase: "review",
      generatedPrd,
      completed: true
    }))
  }

  function handleProjectPlanningReturnToQuestions() {
    setProjectPlanningErrorMessage(null)
    setProjectPlanningCopyMessage(null)
    setProjectPlanningState((current) => ({
      ...current,
      phase: "questions",
      completed: false
    }))
  }

  function getProjectTrackerSurface(): ProjectTrackerSurface {
    switch (getPromptSurface()) {
      case "CHATGPT":
        return "chatgpt"
      case "LOVABLE":
        return "lovable"
      case "REPLIT":
        return "replit"
      default:
        return "unknown"
    }
  }

  function getProjectTrackerBinding(input?: { prdHash?: string | null; submittedPromptHash?: string | null }) {
    return {
      projectKey: projectMemoryKeyRef.current,
      surface: getProjectTrackerSurface(),
      prdHash: input?.prdHash,
      submittedPromptHash: input?.submittedPromptHash
    }
  }

  function projectTrackerMatchesCurrentBinding(record: ProjectTrackerRecord | null | undefined) {
    if (!record) return false
    return isProjectTrackerBoundTo({
      record,
      ...getProjectTrackerBinding()
    })
  }

  function getProjectTrackerDiagnostics(input?: {
    record?: ProjectTrackerRecord | null
    advanceRecommended?: boolean
  }) {
    return buildProjectTrackerDebugMetadata({
      record: input?.record === undefined ? projectTrackerRecordRef.current : input.record,
      advanceRecommended: input?.advanceRecommended
    })
  }

  function buildProjectTrackerAwaitingFreshAnswerAnalysis(input: {
    tracker: ProjectTrackerRecord
    target: ReviewTarget
    promptText: string
  }): DeepAnalysisV2Result | null {
    const assistantAnswerHash = hashDeepAnalysisV2Text(input.target.responseText)
    if (!isProjectTrackerAwaitingFreshAnswer({
      record: input.tracker,
      assistantAnswerHash
    })) {
      return null
    }

    const currentPhasePrompt = buildProjectTrackerCurrentPhasePrompt(
      input.tracker,
      formatProjectContextBlock(buildImplementationProjectContextPack())
    )
    if (!currentPhasePrompt) return null

    const now = new Date().toISOString()
    const submittedPromptHash = hashDeepAnalysisV2Text(input.promptText)

    return {
      version: DEEP_ANALYSIS_V2_VERSION,
      analysisId: hashDeepAnalysisV2Text([
        "project_tracker_awaiting_fresh_answer",
        input.tracker.projectId,
        input.tracker.currentPhaseIndex,
        submittedPromptHash,
        assistantAnswerHash
      ].join("::")),
      analysisVersion: DEEP_ANALYSIS_V2_ANALYSIS_VERSION,
      analysisState: "v2_ready",
      analysisMode: "standard",
      threadId: input.target.threadIdentity,
      messageId: input.target.responseIdentity,
      submittedPromptHash,
      assistantAnswerHash,
      surface: getProjectTrackerSurface(),
      createdAt: now,
      completedAt: now,
      requirements: [],
      requirementMatches: [],
      ignoredExternalValidation: [],
      actionableMissingItems: [],
      phaseAdvanceBasis: "awaiting_fresh_answer_for_current_phase",
      phaseCompletionClaimed: false,
      classificationAudit: [],
      overallStatus: "pass",
      assistantSuggestedNextMove: null,
      recommendedNextMove: currentPhasePrompt.recommendedNextMove,
      nextStepSource: "project_memory",
      nextStepRequirements: currentPhasePrompt.nextStepRequirements,
      blockedScope: currentPhasePrompt.blockedScope,
      promptIntent: currentPhasePrompt.promptIntent,
      generatedPrompt: currentPhasePrompt.generatedPrompt,
      confidence: "medium",
      userExplanation:
        "Project Tracker is waiting for a fresh AI answer for the current phase. The visible answer was already used to advance the previous phase.",
      providerMetadata: {
        provider: "none",
        model: "project-tracker-state",
        latencyMs: 0,
        timedOut: false,
        usedFallback: false,
        providerAttempted: "none"
      }
    }
  }

  function buildProjectTrackerFinalReviewAnalysis(input: {
    tracker: ProjectTrackerRecord
    target: ReviewTarget
    promptText: string
  }): DeepAnalysisV2Result | null {
    if (!shouldShowProjectTrackerFinalReview(input.tracker)) return null

    const finalReviewPrompt = buildProjectTrackerFinalReviewPrompt({
      record: input.tracker
    })
    if (!finalReviewPrompt) return null

    const now = new Date().toISOString()
    const submittedPromptHash = hashDeepAnalysisV2Text(input.promptText)
    const assistantAnswerHash = hashDeepAnalysisV2Text(input.target.responseText)
    const carryoverItems = input.tracker.carryoverItems ?? []

    return {
      version: DEEP_ANALYSIS_V2_VERSION,
      analysisId: hashDeepAnalysisV2Text([
        "project_tracker_completed_final_review",
        input.tracker.projectId,
        submittedPromptHash,
        assistantAnswerHash
      ].join("::")),
      analysisVersion: DEEP_ANALYSIS_V2_ANALYSIS_VERSION,
      analysisState: "v2_ready",
      analysisMode: "standard",
      threadId: input.target.threadIdentity,
      messageId: input.target.responseIdentity,
      submittedPromptHash,
      assistantAnswerHash,
      surface: getProjectTrackerSurface(),
      createdAt: now,
      completedAt: now,
      requirements: carryoverItems.map((text, index) => ({
        id: `project-tracker-final-carryover-${index + 1}`,
        source: "project_memory" as const,
        text
      })),
      requirementMatches: carryoverItems.map((requirementText, index) => ({
        requirementId: `project-tracker-final-carryover-${index + 1}`,
        requirementText,
        status: "unclear" as const,
        evidence: [],
        note: "Carry this tracked gap into the final MVP review prompt."
      })),
      ignoredExternalValidation: [],
      actionableMissingItems: carryoverItems,
      phaseAdvanceBasis: "tracker_completed_final_review",
      phaseCompletionClaimed: true,
      classificationAudit: [],
      overallStatus: "pass",
      assistantSuggestedNextMove: null,
      recommendedNextMove: finalReviewPrompt.recommendedNextMove,
      nextStepSource: "project_memory",
      nextStepRequirements: finalReviewPrompt.nextStepRequirements,
      blockedScope: finalReviewPrompt.blockedScope,
      promptIntent: finalReviewPrompt.promptIntent,
      generatedPrompt: finalReviewPrompt.generatedPrompt,
      confidence: "medium",
      userExplanation:
        "Project Tracker completed all tracked phases and prepared one final MVP review prompt before returning Deep Analysis to normal.",
      providerMetadata: {
        provider: "none",
        model: "project-tracker-state",
        latencyMs: 0,
        timedOut: false,
        usedFallback: false,
        providerAttempted: "none"
      }
    }
  }

  function normalizeProjectTrackerExplanation(analysis: DeepAnalysisV2Result) {
    if (!/no (user prompt|assistant answer).*provided/i.test(analysis.userExplanation)) {
      return analysis.userExplanation
    }

    if (analysis.phaseAdvanceBasis === "phase_completion_claimed_with_carryover") {
      return "Project Tracker reviewed the latest answer against the current phase checklist and carried unresolved items into the next phase prompt."
    }

    return "Project Tracker reviewed the latest answer against the current phase checklist."
  }

  async function handleProjectTrackerToggle() {
    if (!projectTrackerRecord) return
    if (projectTrackerRecord.completedAt || projectTrackerRecord.disabledReason === "completed") return
    if (!projectTrackerMatchesCurrentBinding(projectTrackerRecord)) return
    const enabled = !projectTrackerRecord.enabled
    const updated: ProjectTrackerRecord = {
      ...projectTrackerRecord,
      enabled,
      disabledAt: enabled ? null : new Date().toISOString(),
      disabledReason: enabled ? null : "manual",
      updatedAt: new Date().toISOString()
    }

    applyProjectTrackerRecord(updated)
    try {
      const saved = await saveProjectTracker(updated)
      applyProjectTrackerRecord(saved)
    } catch (error) {
      applyProjectTrackerRecord(projectTrackerRecord)
      logProjectPlanningDiagnostics("tracker_toggle_failed", {
        message: error instanceof Error ? error.message : "Unknown tracker toggle error"
      })
    }
  }

  async function syncProjectTrackerFromDeepAnalysis(result: AfterAnalysisResult) {
    const tracker = projectTrackerRecordRef.current
    if (!tracker?.enabled) return
    if (!projectTrackerMatchesCurrentBinding(tracker)) return

    const context = getReviewAnalysisContext(result)
    const analysis = context?.deepAnalysisV2Applied ? context.deepAnalysisV2 : null
    if (!analysis) return
    if (isProjectTrackerAwaitingFreshAnswer({
      record: tracker,
      assistantAnswerHash: analysis.assistantAnswerHash
    })) {
      logProjectPlanningDiagnostics("tracker_phase_advance_skipped", {
        ...getProjectTrackerDiagnostics({
          record: tracker,
          advanceRecommended: false
        }),
        reason: "awaiting_fresh_answer_for_current_phase",
        projectId: tracker.projectId,
        currentPhaseIndex: tracker.currentPhaseIndex
      })
      return
    }
    if (!shouldAdvanceProjectTrackerFromAnalysis(analysis)) return

    const trackerBrief = buildProjectTrackerDeepAnalysisBrief(tracker)
    if (!trackerBrief) return
    if (!analysis.submittedPromptHash || analysis.submittedPromptHash !== hashDeepAnalysisV2Text(trackerBrief.promptText)) {
      logProjectPlanningDiagnostics("tracker_phase_advance_skipped", {
        ...getProjectTrackerDiagnostics({
          record: tracker,
          advanceRecommended: true
        }),
        reason: "analysis_prompt_hash_mismatch",
        projectId: tracker.projectId,
        currentPhaseIndex: tracker.currentPhaseIndex
      })
      return
    }

    const updated = advanceProjectTrackerAfterPhasePass({
      record: tracker,
      reviewedAssistantAnswerHash: analysis.assistantAnswerHash,
      reviewedSubmittedPromptHash: analysis.submittedPromptHash,
      carryoverItems: getProjectTrackerCarryoverItems(analysis, 12)
    })
    if (!updated) return
    if (updated.updatedAt === tracker.updatedAt && updated.currentPhaseIndex === tracker.currentPhaseIndex) return

    applyProjectTrackerRecord(updated)
    try {
      const saved = await saveProjectTracker(updated)
      applyProjectTrackerRecord(saved)
      trackProductEvent("project_tracker_phase_completed", {
        feature_area: "project_planning",
        status: "success",
        tracker_enabled: Boolean(saved.enabled),
        tracker_phase_index: tracker.currentPhaseIndex
      })
      if (saved.completedAt) {
        trackProductEvent("project_tracker_completed", {
          feature_area: "project_planning",
          status: "success",
          tracker_enabled: false,
          tracker_phase_index: saved.currentPhaseIndex
        })
      } else {
        trackProductEvent("project_tracker_phase_started", {
          feature_area: "project_planning",
          status: "started",
          tracker_enabled: Boolean(saved.enabled),
          tracker_phase_index: saved.currentPhaseIndex
        })
      }
      logProjectPlanningDiagnostics("tracker_phase_advanced", {
        ...getProjectTrackerDiagnostics({
          record: saved,
          advanceRecommended: true
        }),
        projectId: saved.projectId,
        currentPhaseIndex: saved.currentPhaseIndex,
        completed: Boolean(saved.completedAt),
        disabledReason: saved.disabledReason
      })
    } catch (error) {
      applyProjectTrackerRecord(tracker)
      logProjectPlanningDiagnostics("tracker_phase_advance_failed", {
        message: error instanceof Error ? error.message : "Unknown tracker phase advance error"
      })
    }
  }

  async function syncProjectTrackerFinalReviewCopied(
    result: AfterAnalysisResult,
    copiedPrompt: string
  ) {
    const tracker = projectTrackerRecordRef.current
    if (!tracker || !projectTrackerMatchesCurrentBinding(tracker)) return

    const context = getReviewAnalysisContext(result)
    const analysis = context?.deepAnalysisV2Applied ? context.deepAnalysisV2 : null
    const isFinalReviewPrompt =
      analysis?.phaseAdvanceBasis === "tracker_completed_final_review" ||
      /all tracked implementation phases are complete/i.test(analysis?.generatedPrompt ?? "")
    if (!isFinalReviewPrompt) return
    if (!copiedPrompt.trim()) return
    const updated = markProjectTrackerFinalReviewCopied({ record: tracker })
    if (!updated) return

    applyProjectTrackerRecord(updated)
    try {
      const saved = await saveProjectTracker(updated)
      applyProjectTrackerRecord(saved)
      logProjectPlanningDiagnostics("tracker_final_review_prompt_copied", {
        ...getProjectTrackerDiagnostics({
          record: saved,
          advanceRecommended: false
        }),
        projectId: saved.projectId
      })
    } catch (error) {
      applyProjectTrackerRecord(tracker)
      logProjectPlanningDiagnostics("tracker_final_review_copy_mark_failed", {
        message: error instanceof Error ? error.message : "Unknown tracker final review marker error"
      })
    }
  }

  async function syncProjectTrackerFinalReviewSubmittedFromPrompt(submittedPrompt: string) {
    const tracker = projectTrackerRecordRef.current
    if (!tracker || !projectTrackerMatchesCurrentBinding(tracker)) return
    const finalReviewPrompt = buildProjectTrackerFinalReviewPrompt({ record: tracker, force: true })
    if (!finalReviewPrompt) return

    const submittedPromptHash = hashDeepAnalysisV2Text(submittedPrompt.trim())
    const expectedPromptHash = hashDeepAnalysisV2Text(finalReviewPrompt.generatedPrompt)
    if (!submittedPromptHash || submittedPromptHash !== expectedPromptHash) return

    const updated = markProjectTrackerFinalReviewSubmitted({ record: tracker, submittedPromptHash })
    if (!updated) return

    applyProjectTrackerRecord(updated)
    try {
      const saved = await saveProjectTracker(updated)
      applyProjectTrackerRecord(saved)
      logProjectPlanningDiagnostics("tracker_final_review_prompt_submitted", {
        ...getProjectTrackerDiagnostics({ record: saved }),
        projectId: saved.projectId
      })
    } catch (error) {
      applyProjectTrackerRecord(tracker)
      logProjectPlanningDiagnostics("tracker_final_review_submit_mark_failed", {
        message: error instanceof Error ? error.message : "Unknown tracker final review submit marker error"
      })
    }
  }

  async function handleProjectPlanningCopyPrd() {
    guardProjectPlanningSubmit()
    setProjectPlanningErrorMessage(null)
    setProjectPlanningCopyMessage(null)
    if (planningGoalNoticeTimeoutRef.current) {
      window.clearTimeout(planningGoalNoticeTimeoutRef.current)
      planningGoalNoticeTimeoutRef.current = null
    }
    setPlanningGoalNotice("")
    if (!projectMemoryKey || !projectMemoryLabel) {
      setProjectPlanningErrorMessage("reeva AI could not identify this Replit project. Reopen the extension on the project page and try again.")
      setProjectPlanningState((current) => ({
        ...current,
        phase: current.generatedPrd ? "review" : current.phase
      }))
      return
    }
    const generatedPrd = projectPlanningState.generatedPrd
    if (!generatedPrd) {
      setProjectPlanningErrorMessage("No generated PRD is available to copy yet. Generate the PRD again and then copy it.")
      return
    }

    const submissionPrompt = generatedPrd.submissionPrompt.trim() || buildProjectPlanningSubmissionPrompt(generatedPrd)
    const payload = buildProjectPlanningContextPayload(generatedPrd)
    const prdHash = hashProjectTrackerText(payload.rawMarkdown)
    const submittedPromptHash = hashProjectTrackerText(submissionPrompt)
    const importedContext = buildImportedProjectContextRecord(payload.rawMarkdown)
    let architectureCandidate: ArchitectureRecordV1 | undefined
    try {
      const planningIntakeFields = buildProjectPlanningIntakeFields({
        description: projectPlanningState.description,
        answerState: projectPlanningState.answerState
      })
      architectureCandidate = deriveArchitectureRecordFromPlanning({
        accessAndRoles: planningIntakeFields.accessAndRoles,
        dataAndSensitivity: planningIntakeFields.dataAndSensitivity,
        deploymentAndServices: planningIntakeFields.deploymentAndServices,
        qualityPriorities: planningIntakeFields.qualityPriorities,
        nonFunctionalRequirements:
          generatedPrd.sections.find((section) => section.id === "non-functional-requirements")?.body ?? ""
      })
    } catch {
      architectureCandidate = undefined
    }
    const mergedStructuredMemory = mergeStructuredProjectMemory(projectStructuredMemoryRef.current, {
      stableConstraints: payload.structuredMemory.stableConstraints,
      protectedAreas: payload.structuredMemory.protectedAreas,
      acceptedAssumptions: payload.structuredMemory.acceptedAssumptions,
      currentFeatureArea: payload.structuredMemory.currentFeatureArea,
      currentPhase: "planning",
      currentWorkflowState: "drafting"
    })

    setIsSavingProjectMemory(true)
    let saveSucceeded = false

    try {
      const saved = await saveProjectMemory({
        projectKey: projectMemoryKey,
        projectLabel: projectMemoryLabel,
        projectContext: payload.projectContext,
        currentState: payload.currentState,
        importedContext,
        structuredMemory: mergedStructuredMemory,
        memoryDepth: "deep",
        awaitingFreshAnswer: false,
        baselineResponseIdentity: "",
        baselineResponseText: "",
        baselineThreadIdentity: ""
      })

      setProjectContextDraft(payload.projectContext)
      setCurrentStateDraft(payload.currentState)
      setImportedProjectContext(saved.importedContext ?? importedContext)
      setProjectStructuredMemory(saved.structuredMemory ?? mergedStructuredMemory)
      setProjectSettingsRecord(saved.settings ?? createDefaultProjectSettingsRecord())
      projectContextDraftRef.current = payload.projectContext
      currentStateDraftRef.current = payload.currentState
      importedProjectContextRef.current = saved.importedContext ?? importedContext
      projectStructuredMemoryRef.current = saved.structuredMemory ?? mergedStructuredMemory
      showArchitectureConfirmation("planning", architectureCandidate, saved.structuredMemory ?? mergedStructuredMemory)
      setProjectHandoffDraft((saved.importedContext ?? importedContext).rawMarkdown)
      setProjectMemoryDepth("deep")
      setHasProjectMemory(true)
      try {
        const catalogItems = await saveProjectCatalogItem({
          id: `${projectMemoryKey}::${prdHash}`,
          projectKey: projectMemoryKey,
          projectLabel: projectMemoryLabel,
          title: generatedPrd.title,
          summary: generatedPrd.summary,
          prdHash,
          submittedPromptHash,
          phaseTitles: generatedPrd.implementationPhases.map((phase) => phase.title)
        })
        setProjectCatalogItems(catalogItems)
      } catch (error) {
        logProjectPlanningDiagnostics("project_catalog_save_failed", {
          message: error instanceof Error ? error.message : "Unknown project catalog save error"
        })
      }
      await persistProjectOnboardingState({
        status: "completed",
        entryChoice: projectOnboardingRecord?.entryChoice ?? "starting_now",
        completedAt: new Date().toISOString()
      })
      try {
        const tracker = buildProjectTrackerRecord({
          projectKey: projectMemoryKey,
          projectLabel: projectMemoryLabel,
          surface: getProjectTrackerSurface(),
          prdHash,
          submittedPromptHash,
          phases: generatedPrd.implementationPhases
        })
        if (tracker) {
          const previousTracker = projectTrackerRecordRef.current
          const savedTracker = await saveProjectTracker(tracker)
          applyProjectTrackerRecord(savedTracker)
          trackProductEvent("project_tracker_enabled", {
            feature_area: "project_planning",
            status: "success",
            tracker_enabled: true,
            tracker_phase_index: savedTracker.currentPhaseIndex
          })
          trackProductEvent("project_tracker_phase_started", {
            feature_area: "project_planning",
            status: "started",
            tracker_enabled: true,
            tracker_phase_index: savedTracker.currentPhaseIndex
          })
          if (previousTracker?.enabled && previousTracker.projectId !== savedTracker.projectId) {
            logProjectPlanningDiagnostics("tracker_replaced_for_new_prd", {
              ...getProjectTrackerDiagnostics({
                record: savedTracker
              }),
              previousProjectId: previousTracker.projectId,
              nextProjectId: savedTracker.projectId
            })
          }
        }
      } catch (error) {
        logProjectPlanningDiagnostics("tracker_save_failed", {
          message: error instanceof Error ? error.message : "Unknown tracker save error"
        })
      }
      saveSucceeded = true

      if (accountState.status === "authenticated") {
        void syncProjectMemoryToCloud({
          projectContext: payload.projectContext,
          currentState: payload.currentState,
          importedContext: saved.importedContext ?? importedContext,
          structuredMemory: saved.structuredMemory ?? mergedStructuredMemory,
          settings: saved.settings ?? createDefaultProjectSettingsRecord(),
          memoryDepth: "deep"
        })
        void syncProjectContextImportToCloud(saved.importedContext ?? importedContext)
      }

      const copied = await copyPromptForManualHandoff(submissionPrompt, {
        sourcePromptOverride: payload.projectContext,
        successMessage: "PRD copied. Paste it into Replit and click Start.",
        failureMessage: "PRD was saved, but copy failed. Keep this popup open, focus the page, and click Copy PRD again.",
        featureArea: "project_planning",
        showNotice: false
      })
      const copyMessage = copied
        ? "PRD copied. Paste it into Replit and click Start."
        : "PRD was saved, but copy failed. Keep this popup open, focus the page, and click Copy PRD again."
      guardProjectPlanningSubmit(8_000)
      setProjectPlanningCopyMessage(copyMessage)
      setProjectPlanningErrorMessage(copied ? null : copyMessage)
      setProjectPlanningState((current) => ({
        ...current,
        phase: "review"
      }))
    } catch (error) {
      guardProjectPlanningSubmit(8_000)
      const message = error instanceof Error ? error.message : "PRD copy failed before reeva AI could save project context."
      setProjectPlanningErrorMessage(message)
      setProjectPlanningCopyMessage(null)
      setProjectPlanningState((current) => ({
        ...current,
        phase: current.generatedPrd ? "review" : "intake"
      }))
      logProjectPlanningDiagnostics("prd_copy_failed", {
        message
      })
    } finally {
      setIsSavingProjectMemory(false)
      if (!saveSucceeded) {
        setProjectPlanningState((current) =>
          current.phase === "saving"
            ? {
                ...current,
                phase: current.generatedPrd ? "review" : "intake"
              }
            : current
        )
      }
    }
  }

  function handleProjectPanelClose() {
    if (projectPanelView === "planning" || projectPanelView === "context") {
      setProjectPanelView("onboarding")
      return
    }
    if (projectPanelView === "onboarding" && !projectOnboardingRecord && projectMemoryKey) {
      setProjectSetupDismissedProjectKey(projectMemoryKey)
    }
    setProjectPanelView("closed")
  }

  function handleReviewPopupClose() {
    trackProductEvent("popup_closed")
    reviewPopupOrchestratorRef.current?.close()
    if (projectPanelView === "onboarding" && !projectOnboardingRecord && projectMemoryKey) {
      setProjectSetupDismissedProjectKey(projectMemoryKey)
    }
    setReviewPopupSurface("answer_mode")
    setReviewPopupOpen(false)
    setProjectPanelView("closed")
    setPromptProjectContextImportOpen(false)
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
    const normalizedPlanningGoal = afterPlanningGoal.trim()
    if (!normalizedPlanningGoal) return

    await copyPromptForManualHandoff(normalizedPlanningGoal, {
      successMessage: "Prompt copied. Paste it into Replit and click Start.",
      featureArea: "next_move"
    })
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
    const actionStyle: "fix" | "double-check" = chip.actionStyle === "fix" ? "fix" : "double-check"
    const actionVerb = actionStyle === "fix" ? "fix" : "double-check and, if needed, fix"
    const rewritePrompt = buildSuggestedDirectionRewritePrompt({
      originalPrompt: afterAttempt.raw_prompt,
      acceptanceCriterion: chip.id,
      confidence: afterVerdict.confidence,
      actionStyle,
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
        actionStyle
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
    if (!afterNextPromptReady || !afterNextPromptDraft.trim()) return

    const normalizedNextPrompt = afterNextPromptDraft.trim()
    if (projectMemoryKey && projectMemoryLabel && hasProjectMemory && projectMemoryAwaitingFreshAnswerRef.current) {
      projectMemoryAwaitingFreshAnswerRef.current = false
      projectMemoryBaselineResponseRef.current = null
      await persistProjectMemoryPatch({
        awaitingFreshAnswer: false,
        baselineResponseIdentity: "",
        baselineResponseText: "",
        baselineThreadIdentity: ""
      })
    }
    await copyPromptForManualHandoff(normalizedNextPrompt, {
      successMessage: "Prompt copied. Paste it into Replit and click Start.",
      featureArea: "next_move"
    })
  }

  async function handleCopyAfterNextPrompt() {
    const prompt = afterNextPromptDraft.trim() || afterVerdict?.next_prompt.trim() || afterPlanningGoal.trim()
    if (!prompt) return
    await copyPromptForManualHandoff(prompt, {
      successMessage: "Prompt copied. Paste it into Replit and click Start.",
      featureArea: "next_move"
    })
  }

  function handleAfterHelpfulFeedback(helpful: boolean) {
    setAfterHelpfulFeedback(helpful)
  }

  function handleAfterNextPromptSuccessFeedback(success: boolean) {
    setAfterNextPromptSuccessFeedback(success)
  }

  async function handleSubmitReviewPromptModeDraft() {
    if (!reviewPromptModeState.promptReady || !reviewPromptModeState.promptDraft.trim()) return

    const normalizedPrompt = reviewPromptModeState.promptDraft.trim()
    await persistProjectMemoryPatch({
      structuredPatch: buildStructuredProjectMemoryPatchFromRequestBrief(reviewPromptModeState.requestBrief)
    })
    await copyPromptForManualHandoff(normalizedPrompt, {
      sourcePromptOverride: reviewPromptModeState.sourcePrompt,
      successMessage: "Prompt copied. Paste it into Replit and click Start.",
      featureArea: "next_move"
    })
  }

  async function handleSaveProjectMemory() {
    if (!projectMemoryKey || !projectMemoryLabel) return
    const parsed = parseProjectHandoffMarkdown(projectHandoffDraft)
    if (!(parsed.projectContext.trim() || parsed.currentState.trim())) return
    const importedContext = buildImportedProjectContextRecord(projectHandoffDraft)
    const architectureCandidate = deriveArchitectureRecordFromImportedMarkdown(projectHandoffDraft)
    trackProductEvent("context_markdown_import_started", {
      feature_area: "project_context",
      status: "started"
    })
    setIsSavingProjectMemory(true)
    try {
      const currentAssistant = getCurrentAssistantResponseText()
      const currentThreadIdentity = getCurrentThreadSnapshot().identity
      const mergedStructuredMemory = mergeStructuredProjectMemory(projectStructuredMemoryRef.current, null)
      const saved = await saveProjectMemory({
        projectKey: projectMemoryKey,
        projectLabel: projectMemoryLabel,
        projectContext: parsed.projectContext,
        currentState: parsed.currentState,
        importedContext,
        structuredMemory: mergedStructuredMemory,
        memoryDepth: projectMemoryDepth,
        awaitingFreshAnswer: true,
        baselineResponseIdentity: currentAssistant.identity,
        baselineResponseText: currentAssistant.text,
        baselineThreadIdentity: currentThreadIdentity
      })
      setProjectContextDraft(parsed.projectContext)
      setCurrentStateDraft(parsed.currentState)
      setImportedProjectContext(saved.importedContext ?? importedContext)
      setProjectStructuredMemory(mergedStructuredMemory)
      setProjectSettingsRecord(saved.settings ?? createDefaultProjectSettingsRecord())
      projectContextDraftRef.current = parsed.projectContext
      currentStateDraftRef.current = parsed.currentState
      importedProjectContextRef.current = saved.importedContext ?? importedContext
      projectStructuredMemoryRef.current = mergedStructuredMemory
      showArchitectureConfirmation("imported_context", architectureCandidate, saved.structuredMemory ?? mergedStructuredMemory)
      setProjectHandoffDraft((saved.importedContext ?? importedContext).rawMarkdown)
      setHasProjectMemory(Boolean(parsed.projectContext.trim() || parsed.currentState.trim()))
      await persistProjectOnboardingState({
        status: "completed",
        entryChoice: projectOnboardingRecord?.entryChoice ?? "in_progress",
        completedAt: new Date().toISOString()
      })
      setProjectContextSetupActive(false)
      projectMemoryAwaitingFreshAnswerRef.current = true
      projectMemoryBaselineResponseRef.current = {
        identity: currentAssistant.identity,
        normalizedText: normalizeAssistantTextForReuse(currentAssistant.text),
        threadIdentity: currentThreadIdentity
      }
      showPlanningGoalNotice("Project memory saved")
      trackProductEvent("context_markdown_import_succeeded", {
        feature_area: "project_context",
        status: "success"
      })
      trackProductEvent("project_memory_available", {
        feature_area: "project_context",
        status: "success"
      })

      pendingContextAnalysisRef.current = null
      resetAfterNextStepFlow()
      setAfterPanelOpen(true)
      setIsEvaluatingAfterResponse(false)
      await showProjectContextAssimilationStep()
      stopAfterLoadingProgress()
      setProjectContextReadyActive(true)
      if (accountState.status === "authenticated") {
        void syncProjectMemoryToCloud({
          projectContext: parsed.projectContext,
          currentState: parsed.currentState,
          importedContext: saved.importedContext ?? importedContext,
          structuredMemory: mergedStructuredMemory,
          settings: saved.settings ?? createDefaultProjectSettingsRecord(),
          memoryDepth: projectMemoryDepth
        })
        void syncProjectContextImportToCloud(saved.importedContext ?? importedContext)
      }
    } catch (error) {
      trackProductEvent("context_markdown_import_failed", {
        feature_area: "project_context",
        status: "failed",
        error_reason: error instanceof Error ? error.name || "import_failed" : "import_failed"
      })
      throw error
    } finally {
      setIsSavingProjectMemory(false)
    }
  }

  function handleTogglePromptProjectContextImport() {
    if (!promptProjectContextImportOpen && !projectHandoffDraft.trim()) {
      setProjectHandoffDraft(
        importedProjectContextRef.current?.rawMarkdown?.trim()
          ? importedProjectContextRef.current.rawMarkdown
          : buildProjectHandoffMarkdown(projectContextDraftRef.current, currentStateDraftRef.current)
      )
    }
    setPromptProjectContextImportOpen((current) => !current)
  }

  async function handleImportPromptProjectContext() {
    if (!projectMemoryKey || !projectMemoryLabel) return

    const parsed = parseProjectHandoffMarkdown(projectHandoffDraft)
    if (!(parsed.projectContext.trim() || parsed.currentState.trim())) return
    const importedContext = buildImportedProjectContextRecord(projectHandoffDraft)
    const architectureCandidate = deriveArchitectureRecordFromImportedMarkdown(projectHandoffDraft)
    trackProductEvent("context_markdown_import_started", {
      feature_area: "project_context",
      status: "started"
    })

    setIsSavingProjectMemory(true)

    try {
      const saved = await saveProjectMemory({
        projectKey: projectMemoryKey,
        projectLabel: projectMemoryLabel,
        projectContext: parsed.projectContext,
        currentState: parsed.currentState,
        importedContext,
        structuredMemory: projectStructuredMemoryRef.current,
        memoryDepth: "deep",
        awaitingFreshAnswer: false,
        baselineResponseIdentity: "",
        baselineResponseText: "",
        baselineThreadIdentity: ""
      })

      setProjectContextDraft(parsed.projectContext)
      setCurrentStateDraft(parsed.currentState)
      setImportedProjectContext(saved.importedContext ?? importedContext)
      setProjectStructuredMemory(saved.structuredMemory ?? null)
      setProjectSettingsRecord(saved.settings ?? createDefaultProjectSettingsRecord())
      projectContextDraftRef.current = parsed.projectContext
      currentStateDraftRef.current = parsed.currentState
      importedProjectContextRef.current = saved.importedContext ?? importedContext
      projectStructuredMemoryRef.current = saved.structuredMemory ?? null
      showArchitectureConfirmation("imported_context", architectureCandidate, saved.structuredMemory ?? null)
      setProjectHandoffDraft((saved.importedContext ?? importedContext).rawMarkdown)
      setProjectMemoryDepth("deep")
      setHasProjectMemory(Boolean(parsed.projectContext.trim() || parsed.currentState.trim()))
      await persistProjectOnboardingState({
        status: "completed",
        entryChoice: projectOnboardingRecord?.entryChoice ?? "in_progress",
        completedAt: new Date().toISOString()
      })
      setPromptProjectContextImportOpen(false)
      projectMemoryAwaitingFreshAnswerRef.current = false
      projectMemoryBaselineResponseRef.current = null
      showPlanningGoalNotice("Project context imported")
      trackProductEvent("context_markdown_import_succeeded", {
        feature_area: "project_context",
        status: "success"
      })
      trackProductEvent("project_memory_available", {
        feature_area: "project_context",
        status: "success"
      })

      if (
        !NEXT_MOVE_V2_ENABLED &&
        reviewPopupOpen &&
        reviewPopupSurface === "prompt_mode" &&
        reviewPromptModeState.sourcePrompt.trim()
      ) {
        await getReviewPromptModeOrchestrator().open({
          promptText: reviewPromptModeState.sourcePrompt.trim(),
          beforeIntent: reviewPromptModeState.localAnalysis?.intent
        })
      }
      if (accountState.status === "authenticated") {
        void syncProjectMemoryToCloud({
          projectContext: parsed.projectContext,
          currentState: parsed.currentState,
          importedContext: saved.importedContext ?? importedContext,
          structuredMemory: saved.structuredMemory ?? null,
          settings: saved.settings ?? createDefaultProjectSettingsRecord(),
          memoryDepth: "deep"
        })
        void syncProjectContextImportToCloud(saved.importedContext ?? importedContext)
      }
    } catch (error) {
      trackProductEvent("context_markdown_import_failed", {
        feature_area: "project_context",
        status: "failed",
        error_reason: error instanceof Error ? error.name || "import_failed" : "import_failed"
      })
      throw error
    } finally {
      setIsSavingProjectMemory(false)
    }
  }

  async function handleDeletePromptProjectContext() {
    if (!projectMemoryKey || !projectMemoryLabel) return

    setIsDeletingProjectContext(true)

    try {
      const saved = await clearProjectMemoryContext({
        projectKey: projectMemoryKey,
        projectLabel: projectMemoryLabel
      })

      setProjectContextDraft("")
      setCurrentStateDraft("")
      setImportedProjectContext(null)
      setProjectStructuredMemory(null)
      setProjectSettingsRecord(saved.settings ?? createDefaultProjectSettingsRecord())
      projectContextDraftRef.current = ""
      currentStateDraftRef.current = ""
      importedProjectContextRef.current = null
      projectStructuredMemoryRef.current = null
      setArchitectureConfirmation(null)
      setProjectHandoffDraft("")
      setPromptProjectContextImportOpen(false)
      setProjectMemoryDepth(saved.memoryDepth === "quick" ? "quick" : "deep")
      setHasProjectMemory(false)
      projectMemoryAwaitingFreshAnswerRef.current = false
      projectMemoryBaselineResponseRef.current = null
      showPlanningGoalNotice("Project context deleted")

      if (
        !NEXT_MOVE_V2_ENABLED &&
        reviewPopupOpen &&
        reviewPopupSurface === "prompt_mode" &&
        reviewPromptModeState.sourcePrompt.trim()
      ) {
        await getReviewPromptModeOrchestrator().open({
          promptText: reviewPromptModeState.sourcePrompt.trim(),
          beforeIntent: reviewPromptModeState.localAnalysis?.intent
        })
      }

      if (accountState.status === "authenticated") {
        void syncProjectMemoryToCloud({
          projectContext: "",
          currentState: "",
          importedContext: null,
          structuredMemory: null,
          settings: saved.settings ?? createDefaultProjectSettingsRecord(),
          memoryDepth: saved.memoryDepth === "quick" ? "quick" : "deep"
        })
      }
    } finally {
      setIsDeletingProjectContext(false)
    }
  }

  async function handleCopyPromptProjectContextRequest() {
    const prompt = buildReplitDeepContextRequestPrompt(projectMemoryLabel || "project")
    await copyPromptForManualHandoff(prompt, {
      successMessage: "Project context request copied. Paste it into Replit and click Start.",
      failureMessage: "Copy failed. Keep this popup open, then try Copy Prompt again after focusing the page.",
      featureArea: "project_context"
    })
    setPromptProjectContextImportOpen(true)
  }

  async function handleProjectPreferencesSave(nextPreferences: ProjectPreferenceSettings) {
    if (!projectMemoryKey || !projectMemoryLabel) return

    const nextSettings: ProjectSettingsRecord = {
      ...projectSettingsRecord,
      preferences: nextPreferences
    }

    setProjectSettingsRecord(nextSettings)
    setIsSavingProjectPreferences(true)

    try {
      const saved = await saveProjectMemory({
        projectKey: projectMemoryKey,
        projectLabel: projectMemoryLabel,
        projectContext: projectContextDraftRef.current,
        currentState: currentStateDraftRef.current,
        importedContext: importedProjectContextRef.current,
        structuredMemory: projectStructuredMemoryRef.current,
        settings: nextSettings,
        memoryDepth: projectMemoryDepth,
        awaitingFreshAnswer: projectMemoryAwaitingFreshAnswerRef.current,
        baselineResponseIdentity: projectMemoryBaselineResponseRef.current?.identity ?? "",
        baselineResponseText: projectMemoryBaselineResponseRef.current?.normalizedText ?? "",
        baselineThreadIdentity: projectMemoryBaselineResponseRef.current?.threadIdentity ?? ""
      })
      setProjectSettingsRecord(saved.settings ?? nextSettings)
      if (accountState.status === "authenticated") {
        void syncProjectPreferencesToCloud(saved.settings?.preferences ?? nextSettings.preferences)
      }
    } finally {
      setIsSavingProjectPreferences(false)
    }
  }

  async function handleProjectStructureChange(input: {
    protectedAreas?: string[]
    currentFeatureArea?: string
    currentPhase?: StructuredProjectMemory["currentPhase"]
  }) {
    if (!projectMemoryKey || !projectMemoryLabel) return

    const previousStructuredMemory = projectStructuredMemoryRef.current
    const nextStructuredMemory = replaceStructuredProjectMemoryFields(projectStructuredMemoryRef.current, input)
    setProjectStructuredMemory(nextStructuredMemory)
    projectStructuredMemoryRef.current = nextStructuredMemory
    setIsSavingProjectFocus(true)

    try {
      const saved = await saveProjectMemory({
        projectKey: projectMemoryKey,
        projectLabel: projectMemoryLabel,
        projectContext: projectContextDraftRef.current,
        currentState: currentStateDraftRef.current,
        importedContext: importedProjectContextRef.current,
        structuredMemory: nextStructuredMemory,
        settings: projectSettingsRecord,
        memoryDepth: projectMemoryDepth,
        awaitingFreshAnswer: projectMemoryAwaitingFreshAnswerRef.current,
        baselineResponseIdentity: projectMemoryBaselineResponseRef.current?.identity ?? "",
        baselineResponseText: projectMemoryBaselineResponseRef.current?.normalizedText ?? "",
        baselineThreadIdentity: projectMemoryBaselineResponseRef.current?.threadIdentity ?? ""
      })

      setProjectStructuredMemory(saved.structuredMemory ?? nextStructuredMemory)
      projectStructuredMemoryRef.current = saved.structuredMemory ?? nextStructuredMemory
      setProjectSettingsRecord(saved.settings ?? createDefaultProjectSettingsRecord())

      if (
        !NEXT_MOVE_V2_ENABLED &&
        reviewPopupOpen &&
        reviewPopupSurface === "prompt_mode" &&
        reviewPromptModeState.sourcePrompt.trim()
      ) {
        await getReviewPromptModeOrchestrator().open({
          promptText: reviewPromptModeState.sourcePrompt.trim(),
          beforeIntent: reviewPromptModeState.localAnalysis?.intent
        })
      }
      if (accountState.status === "authenticated") {
        void syncProjectMemoryToCloud({
          structuredMemory: saved.structuredMemory ?? nextStructuredMemory,
          settings: saved.settings ?? createDefaultProjectSettingsRecord()
        })
      }
    } catch (error) {
      setProjectStructuredMemory(previousStructuredMemory)
      projectStructuredMemoryRef.current = previousStructuredMemory
      throw error
    } finally {
      setIsSavingProjectFocus(false)
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
    const fallbackSubmit = submitRef.current ?? findVisiblePromptSubmitButton()
    const input =
      inputOverride ?? promptRef.current ?? findPromptInput() ?? (fallbackSubmit ? findPromptInputNearSubmitButton(fallbackSubmit) : null)
    if (!input) {
      logReviewDebug("send detected but no prompt input was available", { source })
      return
    }

    if (promptRef.current !== input) {
      promptRef.current = input
      lastFocusedPromptRef.current = input
      submitRef.current = findSubmitButton(input) ?? fallbackSubmit
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
    await syncProjectTrackerFinalReviewSubmittedFromPrompt(prompt)
    updateReviewTypingState("")
    pinnedAssistantSnapshotRef.current = null
    submittedAssistantBaselineKeyRef.current = buildLiveAssistantSignalKey()
    awaitingFreshReviewAnswerRef.current = true
    lastObservedAssistantSignalKeyRef.current = submittedAssistantBaselineKeyRef.current
    lastSettledAssistantSignalKeyRef.current = ""
    reviewSignalCacheRef.current = null
    reviewPopupOrchestratorRef.current?.invalidate()
    setReviewSignal(createIdleReviewSignal())

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
      await persistProjectMemoryPatch({
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
      lastSubmittedAttemptRef.current = submittedAttempt ?? activeAttempt
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
      lastSubmittedAttemptRef.current = submittedAttempt ?? fallbackAttempt
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
    const normalizedEntries: Array<readonly [string, string | string[]]> = []
    for (const [questionId, value] of Object.entries(baseAnswers)) {
      const otherValue = baseOtherAnswers[questionId]?.trim() ?? ""

      if (Array.isArray(value)) {
        const withoutOther = value.filter((item) => item !== OTHER_OPTION)
        const normalizedArray = otherValue ? [...withoutOther, otherValue] : withoutOther
        if (normalizedArray.length) normalizedEntries.push([questionId, normalizedArray] as const)
        continue
      }

      if (value === OTHER_OPTION) {
        if (otherValue) normalizedEntries.push([questionId, otherValue] as const)
        continue
      }

      if (typeof value === "string" && value.trim()) {
        normalizedEntries.push([questionId, value] as const)
      }
    }

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
      label: "Next Move",
      kind: reviewPopupSurface === "prompt_mode" ? "primary" : "secondary",
      onClick: () => void handleSwitchReviewPopupSurface("prompt_mode")
    },
    {
      id: "answer-mode",
      label: "Answer Analysis",
      kind: reviewPopupSurface === "answer_mode" ? "primary" : "secondary",
      onClick: () => void handleSwitchReviewPopupSurface("answer_mode")
    }
  ]

  const reviewPromptActions =
    !NEXT_MOVE_V2_ENABLED && reviewPromptModeState.promptReady && reviewPromptModeState.promptDraft.trim()
      ? [
          {
            id: "copy-prompt-mode-draft",
            label: "Copy Next Move prompt",
            kind: "primary" as const,
            onClick: () => void handleSubmitReviewPromptModeDraft()
          }
        ]
      : []

  const reviewPromptQuestions = reviewPromptModeState.questionHistory.length
    ? reviewPromptModeState.questionHistory
    : reviewPromptModeState.currentLevelQuestions
  const activeProjectContextRequestText =
    reviewPopupSurface === "prompt_mode" ? reviewPromptModeState.sourcePrompt : ""
  const projectContextDisplayPack = useMemo(
    () =>
      buildProjectContextPack({
        projectContext: projectContextDraft,
        currentState: currentStateDraft,
        importedContext: importedProjectContext,
        structuredMemory: projectStructuredMemory,
        settings: projectSettingsRecord,
        currentRequestText: activeProjectContextRequestText
      }),
    [
      activeProjectContextRequestText,
      currentStateDraft,
      importedProjectContext,
      projectContextDraft,
      projectSettingsRecord,
      projectStructuredMemory
    ]
  )
  const projectSyncMessage =
    projectSyncState.status === "guest"
      ? "Sign in when you want this project memory to follow you to another device."
      : projectSyncState.status === "syncing"
        ? "reeva AI is syncing the latest project memory in the background."
        : projectSyncState.status === "synced"
          ? "This project memory is available in your signed-in account."
          : projectSyncState.status === "failed"
            ? projectSyncState.errorMessage ?? "Sync failed. Local project memory is still safe on this device."
            : accountState.status === "authenticated"
              ? "This project is still local to this device until the first sync completes."
              : null

  async function syncPromptFromPage() {
    const latestSubmit = submitRef.current ?? findVisiblePromptSubmitButton()
    const latestInput = getPreferredComposerAnchor(latestSubmit)
    if (latestInput) {
      promptRef.current = latestInput
      lastFocusedPromptRef.current = latestInput
      submitRef.current = findSubmitButton(latestInput) ?? latestSubmit
      positionHost()
    } else if (latestSubmit) {
      submitRef.current = latestSubmit
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
    const submitButton = submitRef.current
    if (!host) return

    if (popupOpenRef.current && frozenHostPositionRef.current) {
      host.style.position = "fixed"
      host.style.top = frozenHostPositionRef.current.top
      host.style.left = frozenHostPositionRef.current.left
      host.style.right = "auto"
      host.style.opacity = "1"
      host.style.pointerEvents = "auto"
      return
    }

    const input = getPreferredComposerAnchor(submitButton)
    if (input && promptRef.current !== input) {
      promptRef.current = input
      lastFocusedPromptRef.current = input
      submitRef.current = findSubmitButton(input) ?? submitButton
    }

    if (!input) {
      const fallbackSubmit = submitButton ?? findVisiblePromptSubmitButton()
      const anchor = computeHostPosition(null, fallbackSubmit)
      if (!anchor) {
        applyVisibleFallbackHostPosition(host)
        return
      }

      submitRef.current = fallbackSubmit
      host.style.position = "fixed"
      host.style.top = anchor.top
      host.style.left = anchor.left
      host.style.right = "auto"
      host.style.opacity = "1"
      host.style.pointerEvents = "auto"
      return
    }

    host.style.opacity = "1"
    host.style.pointerEvents = "auto"

    if (submitButton) {
      const anchor = computeHostPosition(input, submitButton)
      if (!anchor) return
      host.style.position = "fixed"
      host.style.top = anchor.top
      host.style.left = anchor.left
      host.style.right = "auto"
      return
    }

    const anchor = computeHostPosition(input, null)
    if (!anchor) return
    host.style.position = "fixed"
    host.style.top = anchor.top
    host.style.left = anchor.left
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
          reviewButtonAttentionKind={reviewButtonAttentionKind}
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
        isDeepAnalysisPrewarming={isDeepAnalysisPrewarming}
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
          afterHelpfulFeedback={afterHelpfulFeedback}
          afterNextPromptSuccessFeedback={afterNextPromptSuccessFeedback}
          afterPromptActionTaken={afterPromptActionTaken}
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
          projectMemoryEnabled={supportsProjectWorkflowSurface()}
          projectMemoryExists={hasProjectMemory}
          projectMemoryLabel={projectMemoryLabel}
          projectMemoryDepth={projectMemoryDepth}
          projectHandoffDraft={projectHandoffDraft}
          isSavingProjectMemory={isSavingProjectMemory}
          architectureConfirmation={architectureConfirmation}
          onArchitectureConfirmationEdit={handleArchitectureConfirmationEdit}
          onArchitectureConfirmationDraftChange={handleArchitectureConfirmationDraftChange}
          onArchitectureConfirmationConfirm={() => void handleArchitectureConfirmationConfirm()}
          onRunDeepAnalysis={() => void handleRunDeepAnalysis()}
          onSelectCodeAnalysisMode={(mode) => void handleSelectCodeAnalysisMode(mode)}
          onCopyNextPrompt={() => void handleCopyAfterNextPrompt()}
          onProofDetailsExpanded={() => undefined}
          onHelpfulFeedback={handleAfterHelpfulFeedback}
          onNextPromptSuccessFeedback={handleAfterNextPromptSuccessFeedback}
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
        projectSettingsEnabled={supportsProjectWorkflowSurface()}
        projectPanelView={projectPanelView}
        projectContextStatus={projectContextDisplayPack.contextStatus}
        projectContextWarnings={projectContextDisplayPack.warnings}
        projectContextStaleReasons={projectContextDisplayPack.staleReasons}
        projectContextConflictReasons={projectContextDisplayPack.conflictReasons}
        projectSyncStatus={projectSyncState.status}
        projectSyncMessage={projectSyncMessage}
        promptProjectContextImportedContext={importedProjectContext}
        projectPreferences={projectSettingsRecord.preferences}
        projectCurrentPhase={projectStructuredMemory?.currentPhase ?? null}
        projectProtectedAreas={projectStructuredMemory?.protectedAreas ?? []}
        promptProjectContextEnabled={supportsProjectWorkflowSurface()}
        promptProjectContextReady={hasProjectMemory}
        promptProjectContextLabel={projectMemoryLabel}
        projectCatalogItems={projectCatalogItems}
        projectTracker={projectTrackerRecord}
        latestSubmittedPromptHash={getLatestSubmittedPromptHash()}
        projectPlanningPlatformLabel={getCurrentPlatformLabel()}
        promptProjectContextFeatureArea={projectStructuredMemory?.currentFeatureArea ?? ""}
        promptProjectContextProtectedCount={projectStructuredMemory?.protectedAreas.length ?? 0}
        promptProjectContextConstraintCount={projectStructuredMemory?.stableConstraints.length ?? 0}
        promptProjectContextImportOpen={promptProjectContextImportOpen}
        promptProjectContextDraft={projectHandoffDraft}
        projectPlanningState={projectPlanningState}
        promptProjectContextSaving={isSavingProjectMemory}
        projectPlanningSaving={isSavingProjectMemory}
        projectPlanningGeneratingDraft={projectPlanningGeneratingDraft}
        projectPlanningErrorMessage={projectPlanningErrorMessage}
        projectPlanningCopyMessage={projectPlanningCopyMessage}
        reviewPromptCopyFeedback={reviewPromptCopyFeedback}
        projectPlanningDebugPayload={projectPlanningDebugPayload}
        promptProjectContextDeleting={isDeletingProjectContext}
        projectPreferencesSaving={isSavingProjectPreferences}
        projectFocusSaving={isSavingProjectFocus}
        accountState={accountState}
        accountSubmitting={isAccountSubmitting}
        bugReportScreenshots={bugReportScreenshots}
        bugReportScreenshotCapturing={bugReportScreenshotCapturing}
        bugReportScreenshotError={bugReportScreenshotError}
        handoffNotice={planningGoalNotice}
        surfaceActions={reviewPopupSurfaceActions}
        promptActions={reviewPromptActions}
        architectureConfirmation={architectureConfirmation}
        onArchitectureConfirmationEdit={handleArchitectureConfirmationEdit}
        onArchitectureConfirmationDraftChange={handleArchitectureConfirmationDraftChange}
        onArchitectureConfirmationConfirm={() => void handleArchitectureConfirmationConfirm()}
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
        onPromptReviewConflict={() => setProjectPanelView("context")}
        onPromptFixMissingContext={() => setProjectPanelView("context")}
        onProjectOnboardingOpen={handleProjectOnboardingOpen}
        onProjectContextOpen={() => {
          setProjectPanelView("context")
          trackProductEvent("project_context_viewed", {
            feature_area: "project_context",
            status: "started"
          })
          if (!hasProjectMemory) {
            trackProductEvent("project_context_missing_shown", {
              feature_area: "project_context",
              status: "started"
            })
          }
        }}
        onProjectPlanningOpen={handleProjectPlanningOpen}
        onProjectsOpen={handleProjectsOpen}
        onProjectSettingsOpen={() => setProjectPanelView("settings")}
        onAccountOpen={() => setProjectPanelView("account")}
        onProjectPanelClose={handleProjectPanelClose}
        onProjectOnboardingChooseInProgress={() => void handleProjectOnboardingChooseInProgress()}
        onProjectOnboardingChooseStartingNow={() => void handleProjectOnboardingChooseStartingNow()}
        onProjectPlanningDraftChange={handleProjectPlanningDraftChange}
        onProjectPlanningQuestionIndexChange={handleProjectPlanningQuestionIndexChange}
        onProjectPlanningAnswerChange={handleProjectPlanningAnswerChange}
        onProjectPlanningToggleMultiAnswer={handleProjectPlanningToggleMultiAnswer}
        onProjectPlanningOtherAnswerChange={handleProjectPlanningOtherAnswerChange}
        onProjectPlanningAdvanceQuestion={handleProjectPlanningAdvanceQuestion}
        onProjectPlanningBackToOnboarding={handleProjectPlanningBackToOnboarding}
        onProjectPlanningBackToIntake={handleProjectPlanningBackToIntake}
        onProjectPlanningBuildDraft={() => void handleProjectPlanningBuildDraft()}
        onProjectPlanningReturnToQuestions={handleProjectPlanningReturnToQuestions}
        onProjectPlanningCopyPrd={() => void handleProjectPlanningCopyPrd()}
        onProjectTrackerToggle={() => void handleProjectTrackerToggle()}
        onProjectPreferencesSave={(next) => handleProjectPreferencesSave(next)}
        onAccountLogin={(input) => handleAccountLogin(input)}
        onAccountRegister={(input) => handleAccountRegister(input)}
        onAccountLogout={() => handleAccountLogout()}
        onProjectProtectedAreasChange={(areas) => void handleProjectStructureChange({ protectedAreas: areas })}
        onProjectFeatureAreaChange={(value) => void handleProjectStructureChange({ currentFeatureArea: value })}
        onProjectPhaseChange={(value) => void handleProjectStructureChange({ currentPhase: value })}
        onPromptProjectContextToggle={handleTogglePromptProjectContextImport}
        onPromptProjectContextDraftChange={setProjectHandoffDraft}
        onPromptProjectContextCopyRequest={() => void handleCopyPromptProjectContextRequest()}
        onPromptProjectContextImport={() => void handleImportPromptProjectContext()}
        onPromptProjectContextDelete={() => void handleDeletePromptProjectContext()}
        onPostTrackerTestingChoice={(choice) => void handleProjectTrackerTestingCheckpointAnswered(choice)}
        onPostTrackerTestingPromptSubmit={(prompt) => {
          void copyPromptForManualHandoff(prompt, {
            successMessage: "Testing prompt copied. Paste it into Replit and click Start.",
            featureArea: "deep_analysis"
          })
        }}
        onPostTrackerBugScreenshotAdd={(input) => void handleAddPostTrackerBugScreenshot(input)}
        onPostTrackerBugScreenshotClear={() => void handleClearPostTrackerBugScreenshot()}
        onPostTrackerNextMovePromptGenerate={(choice, answers) =>
          handleGeneratePostTrackerNextMovePrompt(choice, answers)
        }
        onPostTrackerNextMovePromptSubmit={(choice, prompt) =>
          void handleSubmitPostTrackerNextMovePrompt(choice, prompt)
        }
        onPostTrackerNextMoveV2Open={(description, choice) => openNextMoveV2PromptMode(description, choice)}
        onNextMoveV2QuestionSetLoad={(choice, sourcePromptOverride) =>
          loadNextMoveV2QuestionSet(choice, sourcePromptOverride)
        }
        onNextMoveV2PromptGenerate={(choice, answers, fallbackPrompt, sourcePromptOverride) =>
          generateNextMoveV2FinalPrompt(choice, answers, fallbackPrompt, sourcePromptOverride)
        }
        onNextMoveV2PathSelected={(choice) =>
          trackProductEvent("next_move_path_selected", {
            feature_area: "next_move",
            status: "started",
            next_move_path: choice
          })
        }
        onNextMoveV2QuestionAnswered={(input) => {
          trackProductEvent("next_move_question_answered", {
            feature_area: "next_move",
            status: "success",
            next_move_path: input.choice,
            question_count: input.questionCount,
            answered_count: input.answeredCount
          })
          if (input.allAnswered) {
            trackProductEvent("next_move_all_questions_answered", {
              feature_area: "next_move",
              status: "success",
              next_move_path: input.choice,
              question_count: input.questionCount,
              answered_count: input.answeredCount
            })
          }
        }}
        onNextMoveV2DescriptionEdited={(choice) =>
          trackProductEvent("next_move_description_edited", {
            feature_area: "next_move",
            status: "success",
            next_move_path: choice
          })
        }
        onNextMoveV2QuestionsRetried={(choice) =>
          trackProductEvent("next_move_questions_retried", {
            feature_area: "next_move",
            status: "started",
            next_move_path: choice
          })
        }
        onNextMoveV2PromptSubmit={(prompt) =>
          copyPromptForManualHandoff(prompt, {
            successMessage: "Prompt copied. Paste it into Replit and click Start.",
            failureMessage: "Copy failed. Focus the page and click Copy Prompt again.",
            featureArea: "next_move",
            showNotice: false
          })
        }
        onRetryAnalysis={() => void handleRetryReviewAnalysis()}
        onClose={handleReviewPopupClose}
      />
    </>
  )
}
