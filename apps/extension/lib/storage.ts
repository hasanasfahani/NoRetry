import type { AfterAnalysisResult, SessionSummary } from "@prompt-optimizer/shared"
import { Storage } from "@plasmohq/storage"
import {
  buildImportedProjectContextRecord,
  buildProjectHandoffMarkdown,
  type ImportedProjectContextRecord
} from "./core/project-context"
import {
  buildStructuredProjectMemoryFromTexts,
  mergeStructuredProjectMemory,
  type StructuredProjectMemory
} from "./session/project-memory"
import type { ProjectTrackerRecord } from "./project-tracker/project-tracker"
import {
  buildProjectSettingsRecord,
  createDefaultProjectSettingsRecord,
  type ProjectSettingsRecord
} from "./session/project-settings"

const storage = new Storage({ area: "local" })

const ONBOARDING_KEY = "prompt-optimizer:onboarding-seen"
const PROJECT_ONBOARDING_PREFIX = "prompt-optimizer:project-onboarding:"
const SESSION_KEY = "prompt-optimizer:session-summary"
const PROJECT_MEMORY_PREFIX = "prompt-optimizer:project-memory:"
const PROJECT_PROGRESS_PREFIX = "prompt-optimizer:project-progress:"
const PROJECT_TRACKER_PREFIX = "prompt-optimizer:project-tracker:"
const PROJECT_CATALOG_KEY = "prompt-optimizer:project-catalog"
const BUG_REPORT_SCREENSHOT_PREFIX = "prompt-optimizer:bug-report-screenshot:"
const AFTER_REVIEW_CACHE_PREFIX = "prompt-optimizer:after-review:"
const DEEP_ARTIFACT_TELEMETRY_PREFIX = "prompt-optimizer:deep-artifact-telemetry:"
const GLOBAL_POPUP_TELEMETRY_KEY = `${DEEP_ARTIFACT_TELEMETRY_PREFIX}popup-global`
const AFTER_EXPERIENCE_EVENT_LOG_KEY = "prompt-optimizer:after-experience-events"
const NEXT_MOVE_TELEMETRY_KEY = "prompt-optimizer:next-move-telemetry-events"
const NEXT_MOVE_EVAL_CANDIDATES_KEY = "prompt-optimizer:next-move-eval-candidates"
const AFTER_REVIEW_CACHE_VERSION = "after-review-v2"
const NEXT_MOVE_EVAL_CANDIDATE_VERSION = "next-move-eval-candidate-v2"

export type ProjectMemoryRecord = {
  projectKey: string
  projectLabel: string
  projectContext: string
  currentState: string
  importedContext?: ImportedProjectContextRecord | null
  structuredMemory?: StructuredProjectMemory | null
  settings?: ProjectSettingsRecord | null
  memoryDepth?: "quick" | "deep"
  awaitingFreshAnswer?: boolean
  baselineResponseIdentity?: string
  baselineResponseText?: string
  baselineThreadIdentity?: string
  updatedAt: string
}

export type ProjectCatalogItemRecord = {
  id: string
  projectKey: string
  projectLabel: string
  title: string
  summary: string
  prdHash: string
  submittedPromptHash: string
  phaseTitles: string[]
  createdAt: string
  updatedAt: string
}

export type BugReportScreenshotRecord = {
  id: string
  projectKey: string
  projectLabel: string
  dataUrl: string
  mimeType: string
  sourceUrl: string
  capturedAt: string
}

export type ProjectProgressRecord = {
  projectKey: string
  activeSurface?: "answer_mode" | "prompt_mode" | null
  currentWorkflowState?: string | null
  promptModeSessionKey?: string | null
  promptModeStateJson?: unknown | null
  latestPromptDraft?: string | null
  latestReviewTargetIdentity?: string | null
  latestReviewSummaryJson?: unknown | null
  onboardingStateJson?: unknown | null
  planningStateJson?: unknown | null
  version: number
  updatedAt: string
}

export type ProjectOnboardingStatus = "entry" | "in_progress_import" | "planning_ready" | "completed"
export type ProjectOnboardingChoice = "in_progress" | "starting_now" | null

export type ProjectOnboardingRecord = {
  projectKey: string
  status: ProjectOnboardingStatus
  entryChoice: ProjectOnboardingChoice
  completedAt: string | null
  updatedAt: string
}

export type AfterReviewCacheRecord = {
  threadIdentity: string
  responseIdentity: string
  normalizedText: string
  quick: AfterAnalysisResult | null
  deep: AfterAnalysisResult | null
  deepArtifactSignature?: string
  updatedAt: string
}

export type DeepArtifactEventRecord = {
  eventType: string
  status: "observed" | "success" | "failed"
  detail: string
  capturedAt: string
  threadIdentity?: string
  responseIdentity?: string
  route?: string
}

export type PopupArtifactSnapshot = {
  capturedAt: string
  statusText: string
  retryCount: number
  lastIntent: string
  visibleText: string
  authStateText?: string
  usageText?: string
  strengthenVisible?: boolean
  hostHint?: string
}

export type DeepArtifactTelemetryRecord = {
  projectKey: string
  events: DeepArtifactEventRecord[]
  popupSnapshots: PopupArtifactSnapshot[]
  updatedAt: string
}

export type AfterExperienceEventRecord = {
  eventType:
    | "decision_shown"
    | "prompt_copy_clicked"
    | "proof_details_expanded"
    | "feedback_helpful_yes"
    | "feedback_helpful_no"
    | "feedback_next_prompt_success_yes"
    | "feedback_next_prompt_success_no"
    | "next_prompt_hidden_due_to_state"
    | "analysis_blocked_streaming"
    | "analysis_blocked_early"
    | "internal_error_hidden_from_user"
  attemptId: string
  decision: AfterAnalysisResult["decision"]
  recommendedAction: AfterAnalysisResult["recommended_action"]
  confidence: AfterAnalysisResult["confidence"]
  promptStrategy: AfterAnalysisResult["prompt_strategy"]
  popupState?: AfterAnalysisResult["popup_state"]
  reviewMode?: "quick" | "deep"
  userFeedbackHelpful?: boolean
  userFeedbackNextPromptSuccess?: boolean
  errorCode?: string
  errorType?: string
  requestStage?: string
  rawErrorMessage?: string
  createdAt: string
}

export type NextMoveSignalSnapshotRecord = {
  source?: "ai" | "local_heuristic" | "none"
  kind?: string
  nextMoveType?: string
  currentStepClaim?: string
  confidenceLevel?: string
  targetLabel?: string | null
  targetPhaseNumber?: number | null
}

export type NextMoveDecisionSnapshotRecord = {
  status: string
  recommendationKind: string
  title: string
  primaryCtaLabel: string
}

export type SimpleNextPromptTelemetrySnapshotRecord = {
  version: string
  status: "needs_confirmation" | "ready_for_next_prompt"
  rolloutMode?: "off" | "shadow" | "on"
  applied?: boolean
  requirementStatus: "pass" | "needs_confirmation"
  confirmedCount: number
  missingCount: number
  missingRequirements: string[]
  optimizedPrompt: string
  assistantSuggestedNextMove: string | null
}

export type DeepAnalysisV2TelemetrySnapshotRecord = {
  version: string
  analysisId?: string
  analysisVersion?: string
  analysisState?: "idle" | "quick_check_ready" | "v2_running" | "v2_ready" | "v2_unavailable" | "stale"
  analysisMode?: "standard" | "large_input_checkpoint"
  threadId?: string
  messageId?: string
  submittedPromptHash?: string
  assistantAnswerHash?: string
  surface?: "chatgpt" | "replit" | "lovable" | "unknown"
  completedAt?: string
  rolloutMode?: "off" | "shadow" | "on"
  applied?: boolean
  provider: "openai" | "kimi" | "deepseek" | "fallback" | "none"
  model?: string
  latencyMs?: number
  providerAttempted?: "openai" | "kimi" | "deepseek" | "none"
  fallbackReason?: string
  failureMessage?: string
  kimiLatencyMs?: number
  deepSeekAttempted?: boolean
  deepSeekLatencyMs?: number
  deepSeekFailureReason?: string
  overallStatus: "pass" | "needs_confirmation" | "risky" | "fail" | "unavailable"
  confidence: "low" | "medium" | "high"
  requirementCount: number
  missingCount: number
  assistantSuggestedNextMove: string | null
  nextStepSource?: "assistant_suggestion" | "project_memory" | "system_inferred" | "unavailable"
  nextStepRequirements?: string[]
  blockedScope?: string[]
  promptIntent?: "implement_next_step" | "confirm_missing_requirements" | "ask_for_next_step" | "review_before_advancing"
  generatedPrompt: string
}

export type DeepAnalysisV2ComparisonTelemetryRecord = {
  v1Decision: string | null
  v2Decision: string
  agreement: "agree" | "disagree" | "unknown"
  provider: "openai" | "kimi" | "deepseek" | "fallback" | "none"
  latencyMs?: number
  generatedPrompt: string
}

export type NextMoveTelemetryEventRecord = {
  eventId: string
  eventType: "decision_shown" | "primary_action_clicked" | "candidate_reviewed"
  projectKey?: string
  projectLabel?: string
  attemptId: string
  threadIdentity: string
  responseIdentity: string
  mode: "quick" | "deep"
  taskType: string
  analysisStatus: AfterAnalysisResult["status"]
  confidence: AfterAnalysisResult["confidence"]
  workflowState?: string | null
  promptText: string
  responseText: string
  finalDecision: NextMoveDecisionSnapshotRecord | null
  selectedSignal: NextMoveSignalSnapshotRecord | null
  aiSignal: NextMoveSignalSnapshotRecord | null
  localSignal: NextMoveSignalSnapshotRecord | null
  signalSource: "ai" | "local_heuristic" | "none"
  signalAgreement: "agree" | "disagree" | "ai_only" | "local_only" | "none"
  simpleNextPromptDecision?: SimpleNextPromptTelemetrySnapshotRecord | null
  deepAnalysisV2Decision?: DeepAnalysisV2TelemetrySnapshotRecord | null
  deepAnalysisV2Comparison?: DeepAnalysisV2ComparisonTelemetryRecord | null
  userAction?: string
  createdAt: string
}

export type NextMoveEvalCandidateStatus = "pending" | "accepted" | "rejected" | "needs_edit" | "product_rule_issue"

export type NextMoveEvalCandidateRecord = {
  candidateId: string
  schemaVersion?: string
  status: NextMoveEvalCandidateStatus
  reasons: string[]
  sourceEventIds: string[]
  projectKey?: string
  projectLabel?: string
  promptText: string
  responseText: string
  taskType: string
  analysisStatus: AfterAnalysisResult["status"]
  confidence: AfterAnalysisResult["confidence"]
  workflowState?: string | null
  finalDecision: NextMoveDecisionSnapshotRecord | null
  selectedSignal: NextMoveSignalSnapshotRecord | null
  aiSignal: NextMoveSignalSnapshotRecord | null
  localSignal: NextMoveSignalSnapshotRecord | null
  signalSource: "ai" | "local_heuristic" | "none"
  signalAgreement: "agree" | "disagree" | "ai_only" | "local_only" | "none"
  simpleNextPromptDecision?: SimpleNextPromptTelemetrySnapshotRecord | null
  deepAnalysisV2Decision?: DeepAnalysisV2TelemetrySnapshotRecord | null
  deepAnalysisV2Comparison?: DeepAnalysisV2ComparisonTelemetryRecord | null
  suggestedExpectedDecision: NextMoveDecisionSnapshotRecord | null
  reviewerNote?: string
  createdAt: string
  updatedAt: string
}

export async function hasSeenOnboarding() {
  return (await storage.get<boolean>(ONBOARDING_KEY)) ?? false
}

export async function markOnboardingSeen() {
  await storage.set(ONBOARDING_KEY, true)
}

export async function resetOnboardingState() {
  await storage.remove(ONBOARDING_KEY)
}

export async function getSessionSummary() {
  return ((await storage.get<SessionSummary>(SESSION_KEY)) ?? null) as SessionSummary | null
}

export async function saveSessionSummary(summary: SessionSummary) {
  await storage.set(SESSION_KEY, summary)
}

export function deriveProjectMemoryIdentity(locationLike = window.location) {
  const url = new URL(locationLike.href)
  const hostname = url.hostname.toLowerCase()

  if (hostname.includes("openai.com") || hostname.includes("chatgpt.com")) {
    return {
      key: `${url.origin}/`,
      label: url.hostname
    }
  }

  if (hostname.includes("lovable.dev")) {
    return {
      key: `${url.origin}/`,
      label: url.hostname
    }
  }

  const segments = url.pathname.split("/").filter(Boolean)
  const scopedPath = segments.slice(0, 3).join("/")
  return {
    key: `${url.origin}/${scopedPath || ""}`,
    label: scopedPath || url.hostname
  }
}

export function isReplitProjectLauncherLocation(locationLike = window.location) {
  const url = new URL(locationLike.href)
  const segments = url.pathname.split("/").filter(Boolean)

  if (/replit\.com$/i.test(url.hostname)) {
    return segments.length === 1 && segments[0] === "~"
  }

  return false
}

export function isChatGptProjectLauncherLocation(locationLike = window.location) {
  const url = new URL(locationLike.href)
  if (!/(^|\.)chatgpt\.com$/i.test(url.hostname) && !/(^|\.)openai\.com$/i.test(url.hostname)) {
    return false
  }

  return url.pathname === "/" || url.pathname === ""
}

export function isProjectLauncherLocation(locationLike = window.location) {
  return isReplitProjectLauncherLocation(locationLike) || isChatGptProjectLauncherLocation(locationLike)
}

function getProjectMemoryKey(projectKey: string) {
  return `${PROJECT_MEMORY_PREFIX}${projectKey}`
}

function getProjectOnboardingKey(projectKey: string) {
  return `${PROJECT_ONBOARDING_PREFIX}${projectKey}`
}

function getProjectProgressKey(projectKey: string) {
  return `${PROJECT_PROGRESS_PREFIX}${projectKey}`
}

function getProjectTrackerKey(projectKey: string) {
  return `${PROJECT_TRACKER_PREFIX}${projectKey}`
}

function getBugReportScreenshotKey(projectKey: string) {
  return `${BUG_REPORT_SCREENSHOT_PREFIX}${stableStorageHash(projectKey)}`
}

function stableStorageHash(value: string) {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(36)
}

function getAfterReviewCacheKey(input: {
  threadIdentity: string
  responseIdentity: string
  normalizedText: string
}) {
  const signature = `${AFTER_REVIEW_CACHE_VERSION}::${input.threadIdentity}::${input.responseIdentity || ""}::${input.normalizedText}`
  return `${AFTER_REVIEW_CACHE_PREFIX}${stableStorageHash(signature)}`
}

function getDeepArtifactTelemetryKey(projectKey: string) {
  return `${DEEP_ARTIFACT_TELEMETRY_PREFIX}${stableStorageHash(projectKey)}`
}

export async function getProjectMemory(projectKey: string) {
  const record = ((await storage.get<ProjectMemoryRecord>(getProjectMemoryKey(projectKey))) ?? null) as ProjectMemoryRecord | null
  if (!record) return null

  const structuredMemory = mergeStructuredProjectMemory(
    buildStructuredProjectMemoryFromTexts({
      projectContext: record.projectContext ?? "",
      currentState: record.currentState ?? ""
    }),
    record.structuredMemory ?? null
  )

  return {
    ...record,
    importedContext:
      record.importedContext ??
      ((record.projectContext ?? "").trim() || (record.currentState ?? "").trim()
        ? buildImportedProjectContextRecord(
            buildProjectHandoffMarkdown(record.projectContext ?? "", record.currentState ?? ""),
            record.updatedAt
          )
        : null),
    settings: buildProjectSettingsRecord({
      projectContext: record.projectContext ?? "",
      currentState: record.currentState ?? "",
      importedContext:
        record.importedContext ??
        ((record.projectContext ?? "").trim() || (record.currentState ?? "").trim()
          ? buildImportedProjectContextRecord(
              buildProjectHandoffMarkdown(record.projectContext ?? "", record.currentState ?? ""),
              record.updatedAt
            )
          : null),
      structuredMemory,
      previous: record.settings ?? createDefaultProjectSettingsRecord(),
      importedAt: record.importedContext?.parsedAt ?? record.updatedAt
    }),
    structuredMemory
  }
}

export async function getProjectCatalog() {
  const items = ((await storage.get<ProjectCatalogItemRecord[]>(PROJECT_CATALOG_KEY)) ?? []) as ProjectCatalogItemRecord[]
  return [...items].sort((first, second) => second.updatedAt.localeCompare(first.updatedAt))
}

export async function saveProjectCatalogItem(input: Omit<ProjectCatalogItemRecord, "createdAt" | "updatedAt"> & {
  createdAt?: string
}) {
  const current = await getProjectCatalog()
  const existing = current.find((item) => item.id === input.id)
  const now = new Date().toISOString()
  const nextItem: ProjectCatalogItemRecord = {
    id: input.id,
    projectKey: input.projectKey,
    projectLabel: input.projectLabel,
    title: input.title.trim() || "Untitled PRD",
    summary: input.summary.trim(),
    prdHash: input.prdHash,
    submittedPromptHash: input.submittedPromptHash,
    phaseTitles: input.phaseTitles.map((title) => title.trim()).filter(Boolean),
    createdAt: input.createdAt ?? existing?.createdAt ?? now,
    updatedAt: now
  }
  const nextItems = [
    nextItem,
    ...current.filter((item) => item.id !== input.id)
  ]
    .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt))
    .slice(0, 50)

  await storage.set(PROJECT_CATALOG_KEY, nextItems)
  return nextItems
}

export async function getBugReportScreenshot(projectKey: string) {
  const stored = await storage.get<BugReportScreenshotRecord | BugReportScreenshotRecord[]>(
    getBugReportScreenshotKey(projectKey)
  )
  if (!stored) return null
  return (Array.isArray(stored) ? stored[0] ?? null : stored) as BugReportScreenshotRecord | null
}

export async function getBugReportScreenshots(projectKey: string) {
  const stored = await storage.get<BugReportScreenshotRecord | BugReportScreenshotRecord[]>(
    getBugReportScreenshotKey(projectKey)
  )
  if (!stored) return []
  return (Array.isArray(stored) ? stored : [stored]) as BugReportScreenshotRecord[]
}

export async function saveBugReportScreenshot(input: Omit<BugReportScreenshotRecord, "id" | "capturedAt"> & {
  capturedAt?: string
}) {
  const capturedAt = input.capturedAt ?? new Date().toISOString()
  const record: BugReportScreenshotRecord = {
    id: stableStorageHash(`${input.projectKey}::${input.sourceUrl}::${capturedAt}`),
    projectKey: input.projectKey,
    projectLabel: input.projectLabel,
    dataUrl: input.dataUrl,
    mimeType: input.mimeType,
    sourceUrl: input.sourceUrl,
    capturedAt
  }

  const existing = await getBugReportScreenshots(input.projectKey)
  const nextRecords = [record, ...existing.filter((item) => item.id !== record.id)].slice(0, 10)
  await storage.set(getBugReportScreenshotKey(input.projectKey), nextRecords)
  return record
}

export async function clearBugReportScreenshot(projectKey: string) {
  await storage.remove(getBugReportScreenshotKey(projectKey))
}

export async function getProjectOnboarding(projectKey: string) {
  return ((await storage.get<ProjectOnboardingRecord>(getProjectOnboardingKey(projectKey))) ?? null) as ProjectOnboardingRecord | null
}

export async function saveProjectOnboarding(input: {
  projectKey: string
  status: ProjectOnboardingStatus
  entryChoice?: ProjectOnboardingChoice
  completedAt?: string | null
}) {
  const existing = await getProjectOnboarding(input.projectKey)
  const record: ProjectOnboardingRecord = {
    projectKey: input.projectKey,
    status: input.status,
    entryChoice: input.entryChoice ?? existing?.entryChoice ?? null,
    completedAt: input.completedAt ?? existing?.completedAt ?? null,
    updatedAt: new Date().toISOString()
  }

  await storage.set(getProjectOnboardingKey(input.projectKey), record)
  return record
}

export async function saveProjectMemory(input: {
  projectKey: string
  projectLabel: string
  projectContext: string
  currentState: string
  importedContext?: ImportedProjectContextRecord | null
  structuredMemory?: StructuredProjectMemory | null
  replaceArchitecture?: boolean
  settings?: ProjectSettingsRecord | null
  memoryDepth?: "quick" | "deep"
  awaitingFreshAnswer?: boolean
  baselineResponseIdentity?: string
  baselineResponseText?: string
  baselineThreadIdentity?: string
}) {
  const existing =
    ((await storage.get<ProjectMemoryRecord>(getProjectMemoryKey(input.projectKey))) ?? null) as ProjectMemoryRecord | null
  const importedContext =
    input.importedContext ??
    (input.projectContext.trim() || input.currentState.trim()
      ? buildImportedProjectContextRecord(
          buildProjectHandoffMarkdown(input.projectContext.trim(), input.currentState.trim()),
          new Date().toISOString()
        )
      : null)
  const generatedStructuredMemory = buildStructuredProjectMemoryFromTexts({
    projectContext: input.projectContext.trim(),
    currentState: input.currentState.trim()
  })
  const explicitlyClearingMemory =
    input.structuredMemory === null &&
    input.importedContext === null &&
    !input.projectContext.trim() &&
    !input.currentState.trim()
  const structuredMemoryBase =
    explicitlyClearingMemory || input.replaceArchitecture
      ? generatedStructuredMemory
      : mergeStructuredProjectMemory(generatedStructuredMemory, {
          architecture: existing?.structuredMemory?.architecture
        })
  const structuredMemory = mergeStructuredProjectMemory(structuredMemoryBase, input.structuredMemory ?? null)
  const settings = buildProjectSettingsRecord({
    projectContext: input.projectContext.trim(),
    currentState: input.currentState.trim(),
    importedContext,
    structuredMemory,
    previous: input.settings ?? existing?.settings ?? createDefaultProjectSettingsRecord(),
    importedAt: importedContext?.parsedAt ?? new Date().toISOString()
  })
  const record: ProjectMemoryRecord = {
    projectKey: input.projectKey,
    projectLabel: input.projectLabel,
    projectContext: input.projectContext.trim(),
    currentState: input.currentState.trim(),
    importedContext,
    structuredMemory,
    settings,
    memoryDepth: input.memoryDepth,
    awaitingFreshAnswer: input.awaitingFreshAnswer,
    baselineResponseIdentity: input.baselineResponseIdentity,
    baselineResponseText: input.baselineResponseText,
    baselineThreadIdentity: input.baselineThreadIdentity,
    updatedAt: new Date().toISOString()
  }

  await storage.set(getProjectMemoryKey(input.projectKey), record)
  return record
}

export async function clearProjectMemoryContext(input: {
  projectKey: string
  projectLabel: string
}) {
  const existing = await getProjectMemory(input.projectKey)

  return saveProjectMemory({
    projectKey: input.projectKey,
    projectLabel: input.projectLabel,
    projectContext: "",
    currentState: "",
    importedContext: null,
    structuredMemory: null,
    settings: existing?.settings ?? createDefaultProjectSettingsRecord(),
    memoryDepth: existing?.memoryDepth === "quick" ? "quick" : "deep",
    awaitingFreshAnswer: false,
    baselineResponseIdentity: "",
    baselineResponseText: "",
    baselineThreadIdentity: ""
  })
}

export async function getProjectProgress(projectKey: string) {
  return ((await storage.get<ProjectProgressRecord>(getProjectProgressKey(projectKey))) ?? null) as ProjectProgressRecord | null
}

export async function saveProjectProgress(input: Omit<ProjectProgressRecord, "version" | "updatedAt"> & {
  version?: number
}) {
  const existing =
    ((await storage.get<ProjectProgressRecord>(getProjectProgressKey(input.projectKey))) ?? null) as ProjectProgressRecord | null

  const record: ProjectProgressRecord = {
    projectKey: input.projectKey,
    activeSurface: input.activeSurface ?? null,
    currentWorkflowState: input.currentWorkflowState ?? null,
    promptModeSessionKey: input.promptModeSessionKey ?? null,
    promptModeStateJson: input.promptModeStateJson ?? null,
    latestPromptDraft: input.latestPromptDraft ?? null,
    latestReviewTargetIdentity: input.latestReviewTargetIdentity ?? null,
    latestReviewSummaryJson: input.latestReviewSummaryJson ?? null,
    onboardingStateJson: input.onboardingStateJson ?? null,
    planningStateJson: input.planningStateJson ?? null,
    version: input.version ?? (existing?.version ?? 0) + 1,
    updatedAt: new Date().toISOString()
  }

  await storage.set(getProjectProgressKey(input.projectKey), record)
  return record
}

export async function getProjectTracker(projectKey: string) {
  return ((await storage.get<ProjectTrackerRecord>(getProjectTrackerKey(projectKey))) ?? null) as ProjectTrackerRecord | null
}

export async function saveProjectTracker(input: ProjectTrackerRecord) {
  const record: ProjectTrackerRecord = {
    ...input,
    updatedAt: new Date().toISOString()
  }

  await storage.set(getProjectTrackerKey(input.projectKey), record)
  return record
}

export async function clearProjectTracker(projectKey: string) {
  await storage.remove(getProjectTrackerKey(projectKey))
}

export async function getAfterReviewCache(input: {
  threadIdentity: string
  responseIdentity: string
  normalizedText: string
}) {
  const record =
    ((await storage.get<AfterReviewCacheRecord>(getAfterReviewCacheKey(input))) ?? null) as AfterReviewCacheRecord | null

  if (!record) return null
  if (record.threadIdentity !== input.threadIdentity) return null
  if (record.responseIdentity !== input.responseIdentity) return null
  if (record.normalizedText !== input.normalizedText) return null

  return record
}

export async function saveAfterReviewCache(input: {
  threadIdentity: string
  responseIdentity: string
  normalizedText: string
  quick: AfterAnalysisResult | null
  deep: AfterAnalysisResult | null
  deepArtifactSignature?: string
}) {
  const record: AfterReviewCacheRecord = {
    threadIdentity: input.threadIdentity,
    responseIdentity: input.responseIdentity,
    normalizedText: input.normalizedText,
    quick: input.quick,
    deep: input.deep,
    deepArtifactSignature: input.deepArtifactSignature,
    updatedAt: new Date().toISOString()
  }

  await storage.set(getAfterReviewCacheKey(input), record)
  return record
}

export async function getDeepArtifactTelemetry(projectKey: string) {
  return ((await storage.get<DeepArtifactTelemetryRecord>(getDeepArtifactTelemetryKey(projectKey))) ??
    null) as DeepArtifactTelemetryRecord | null
}

async function saveDeepArtifactTelemetryRecord(key: string, record: DeepArtifactTelemetryRecord) {
  await storage.set(key, record)
  return record
}

export async function appendDeepArtifactEvent(input: {
  projectKey: string
  eventType: string
  status: "observed" | "success" | "failed"
  detail: string
  threadIdentity?: string
  responseIdentity?: string
  route?: string
}) {
  const key = getDeepArtifactTelemetryKey(input.projectKey)
  const existing =
    ((await storage.get<DeepArtifactTelemetryRecord>(key)) ?? null) as DeepArtifactTelemetryRecord | null
  const nextEvent: DeepArtifactEventRecord = {
    eventType: input.eventType,
    status: input.status,
    detail: input.detail.trim(),
    capturedAt: new Date().toISOString(),
    threadIdentity: input.threadIdentity,
    responseIdentity: input.responseIdentity,
    route: input.route
  }

  const previous = existing?.events.length ? existing.events[existing.events.length - 1] : null
  const isDuplicate =
    previous != null &&
    previous.eventType === nextEvent.eventType &&
    previous.status === nextEvent.status &&
    previous.detail === nextEvent.detail &&
    previous.threadIdentity === nextEvent.threadIdentity &&
    previous.route === nextEvent.route

  const record: DeepArtifactTelemetryRecord = {
    projectKey: input.projectKey,
    events: isDuplicate ? existing?.events ?? [] : [...(existing?.events ?? []), nextEvent].slice(-80),
    popupSnapshots: existing?.popupSnapshots ?? [],
    updatedAt: new Date().toISOString()
  }

  return saveDeepArtifactTelemetryRecord(key, record)
}

export async function savePopupArtifactSnapshot(input: {
  projectKey?: string
  statusText: string
  retryCount: number
  lastIntent: string
  visibleText: string
  authStateText?: string
  usageText?: string
  strengthenVisible?: boolean
  hostHint?: string
}) {
  const key = input.projectKey ? getDeepArtifactTelemetryKey(input.projectKey) : GLOBAL_POPUP_TELEMETRY_KEY
  const existing =
    ((await storage.get<DeepArtifactTelemetryRecord>(key)) ?? null) as DeepArtifactTelemetryRecord | null
  const snapshot: PopupArtifactSnapshot = {
    capturedAt: new Date().toISOString(),
    statusText: input.statusText.trim(),
    retryCount: input.retryCount,
    lastIntent: input.lastIntent.trim(),
    visibleText: input.visibleText.trim(),
    authStateText: input.authStateText?.trim(),
    usageText: input.usageText?.trim(),
    strengthenVisible: input.strengthenVisible,
    hostHint: input.hostHint
  }

  const record: DeepArtifactTelemetryRecord = {
    projectKey: input.projectKey ?? "popup-global",
    events: existing?.events ?? [],
    popupSnapshots: [...(existing?.popupSnapshots ?? []), snapshot].slice(-12),
    updatedAt: new Date().toISOString()
  }

  return saveDeepArtifactTelemetryRecord(key, record)
}

export async function getGlobalPopupArtifactTelemetry() {
  return ((await storage.get<DeepArtifactTelemetryRecord>(GLOBAL_POPUP_TELEMETRY_KEY)) ??
    null) as DeepArtifactTelemetryRecord | null
}

export async function appendAfterExperienceEvent(
  input: Omit<AfterExperienceEventRecord, "createdAt">
) {
  const existing = ((await storage.get<AfterExperienceEventRecord[]>(AFTER_EXPERIENCE_EVENT_LOG_KEY)) ??
    []) as AfterExperienceEventRecord[]
  const record: AfterExperienceEventRecord = {
    ...input,
    createdAt: new Date().toISOString()
  }
  const next = [...existing, record].slice(-120)
  await storage.set(AFTER_EXPERIENCE_EVENT_LOG_KEY, next)
  return record
}

function compactTelemetryText(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim()
  const maxLength = 8000
  if (normalized.length <= maxLength) return normalized

  const headLength = 4200
  const tailLength = 3400
  return [
    normalized.slice(0, headLength).trimEnd(),
    "[trimmed middle]",
    normalized.slice(-tailLength).trimStart()
  ].join("\n\n")
}

function compactTelemetryPrompt(value: string) {
  const normalizedLines = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  const maxLength = 8000
  if (normalizedLines.length <= maxLength) return normalizedLines

  const headLength = 4200
  const tailLength = 3400
  return [
    normalizedLines.slice(0, headLength).trimEnd(),
    "[trimmed middle]",
    normalizedLines.slice(-tailLength).trimStart()
  ].join("\n\n")
}

function nextMoveCandidateReasons(event: NextMoveTelemetryEventRecord) {
  const reasons: string[] = []

  if (event.signalAgreement === "disagree") {
    reasons.push("ai_local_disagreement")
  }
  if (event.signalAgreement === "ai_only" || event.signalAgreement === "local_only") {
    reasons.push(`signal_${event.signalAgreement}`)
  }
  if (event.aiSignal?.confidenceLevel === "low" && event.signalSource === "local_heuristic") {
    reasons.push("low_confidence_ai_fallback")
  }
  if (event.signalSource === "none") {
    reasons.push("no_next_move_signal")
  }
  if (event.simpleNextPromptDecision?.status === "needs_confirmation") {
    reasons.push("simple_needs_confirmation")
  }
  if (event.simpleNextPromptDecision?.status === "ready_for_next_prompt") {
    reasons.push("simple_ready_for_next_prompt")
  }
  if (event.deepAnalysisV2Decision?.rolloutMode === "shadow") {
    reasons.push("deep_v2_shadow")
  }
  if (event.deepAnalysisV2Decision?.provider === "fallback") {
    reasons.push("deep_v2_fallback")
  }
  if (event.deepAnalysisV2Decision?.overallStatus === "unavailable") {
    reasons.push("deep_v2_unavailable")
  }
  if (event.deepAnalysisV2Decision?.confidence === "low") {
    reasons.push("deep_v2_low_confidence")
  }
  if (event.deepAnalysisV2Comparison?.agreement === "disagree") {
    reasons.push("deep_v2_v1_disagreement")
  }

  return reasons
}

function buildNextMoveCandidateId(event: NextMoveTelemetryEventRecord, reasons: string[]) {
  return stableStorageHash(
    [
      NEXT_MOVE_EVAL_CANDIDATE_VERSION,
      event.promptText,
      event.responseText,
      event.taskType,
      event.finalDecision?.status ?? "",
      event.finalDecision?.recommendationKind ?? "",
      event.simpleNextPromptDecision?.status ?? "",
      event.simpleNextPromptDecision?.requirementStatus ?? "",
      event.deepAnalysisV2Decision?.rolloutMode ?? "",
      event.deepAnalysisV2Decision?.overallStatus ?? "",
      reasons.join("|")
    ].join("::")
  )
}

async function maybeAppendNextMoveEvalCandidate(event: NextMoveTelemetryEventRecord) {
  if (event.eventType !== "decision_shown") return null

  const reasons = nextMoveCandidateReasons(event)
  if (reasons.length === 0) return null

  const existing = ((await storage.get<NextMoveEvalCandidateRecord[]>(NEXT_MOVE_EVAL_CANDIDATES_KEY)) ??
    []) as NextMoveEvalCandidateRecord[]
  const currentVersionCandidates = existing.filter(
    (candidate) => candidate.schemaVersion === NEXT_MOVE_EVAL_CANDIDATE_VERSION
  )
  const candidateId = buildNextMoveCandidateId(event, reasons)
  const now = new Date().toISOString()
  const previous = currentVersionCandidates.find((candidate) => candidate.candidateId === candidateId)

  if (previous) {
    const nextCandidate: NextMoveEvalCandidateRecord = {
      ...previous,
      sourceEventIds: Array.from(new Set([...previous.sourceEventIds, event.eventId])).slice(-12),
      updatedAt: now
    }
    const next = [
      nextCandidate,
      ...currentVersionCandidates.filter((candidate) => candidate.candidateId !== candidateId)
    ].slice(0, 120)
    await storage.set(NEXT_MOVE_EVAL_CANDIDATES_KEY, next)
    return nextCandidate
  }

  const candidate: NextMoveEvalCandidateRecord = {
    candidateId,
    schemaVersion: NEXT_MOVE_EVAL_CANDIDATE_VERSION,
    status: "pending",
    reasons,
    sourceEventIds: [event.eventId],
    projectKey: event.projectKey,
    projectLabel: event.projectLabel,
    promptText: event.promptText,
    responseText: event.responseText,
    taskType: event.taskType,
    analysisStatus: event.analysisStatus,
    confidence: event.confidence,
    workflowState: event.workflowState,
    finalDecision: event.finalDecision,
    selectedSignal: event.selectedSignal,
    aiSignal: event.aiSignal,
    localSignal: event.localSignal,
    signalSource: event.signalSource,
    signalAgreement: event.signalAgreement,
    simpleNextPromptDecision: event.simpleNextPromptDecision ?? null,
    deepAnalysisV2Decision: event.deepAnalysisV2Decision ?? null,
    deepAnalysisV2Comparison: event.deepAnalysisV2Comparison ?? null,
    suggestedExpectedDecision: event.finalDecision,
    createdAt: now,
    updatedAt: now
  }

  await storage.set(NEXT_MOVE_EVAL_CANDIDATES_KEY, [candidate, ...currentVersionCandidates].slice(0, 120))
  return candidate
}

export async function appendNextMoveTelemetryEvent(
  input: Omit<NextMoveTelemetryEventRecord, "eventId" | "createdAt">
) {
  const existing = ((await storage.get<NextMoveTelemetryEventRecord[]>(NEXT_MOVE_TELEMETRY_KEY)) ??
    []) as NextMoveTelemetryEventRecord[]
  const event: NextMoveTelemetryEventRecord = {
    ...input,
    promptText: compactTelemetryText(input.promptText),
    responseText: compactTelemetryText(input.responseText),
    simpleNextPromptDecision: input.simpleNextPromptDecision
      ? {
          ...input.simpleNextPromptDecision,
          optimizedPrompt: compactTelemetryPrompt(input.simpleNextPromptDecision.optimizedPrompt)
        }
      : null,
    deepAnalysisV2Decision: input.deepAnalysisV2Decision
      ? {
          ...input.deepAnalysisV2Decision,
          generatedPrompt: compactTelemetryPrompt(input.deepAnalysisV2Decision.generatedPrompt)
        }
      : null,
    deepAnalysisV2Comparison: input.deepAnalysisV2Comparison
      ? {
          ...input.deepAnalysisV2Comparison,
          generatedPrompt: compactTelemetryPrompt(input.deepAnalysisV2Comparison.generatedPrompt)
        }
      : null,
    eventId: stableStorageHash(`${input.eventType}::${input.attemptId}::${input.responseIdentity}::${Date.now()}`),
    createdAt: new Date().toISOString()
  }

  await storage.set(NEXT_MOVE_TELEMETRY_KEY, [event, ...existing].slice(0, 240))
  await maybeAppendNextMoveEvalCandidate(event)
  return event
}

export async function getNextMoveTelemetryEvents() {
  return ((await storage.get<NextMoveTelemetryEventRecord[]>(NEXT_MOVE_TELEMETRY_KEY)) ??
    []) as NextMoveTelemetryEventRecord[]
}

export async function getNextMoveEvalCandidates() {
  const existing = ((await storage.get<NextMoveEvalCandidateRecord[]>(NEXT_MOVE_EVAL_CANDIDATES_KEY)) ??
    []) as NextMoveEvalCandidateRecord[]
  return existing.filter((candidate) => candidate.schemaVersion === NEXT_MOVE_EVAL_CANDIDATE_VERSION)
}

export async function updateNextMoveEvalCandidateReview(input: {
  candidateId: string
  status: NextMoveEvalCandidateStatus
  reviewerNote?: string
}) {
  const existing = await getNextMoveEvalCandidates()
  const next = existing.map((candidate) =>
    candidate.candidateId === input.candidateId
      ? {
          ...candidate,
          status: input.status,
          reviewerNote: input.reviewerNote?.trim() || candidate.reviewerNote,
          updatedAt: new Date().toISOString()
        }
      : candidate
  )
  await storage.set(NEXT_MOVE_EVAL_CANDIDATES_KEY, next)
  return next.find((candidate) => candidate.candidateId === input.candidateId) ?? null
}

export async function clearNextMoveEvalCandidates() {
  await storage.remove(NEXT_MOVE_EVAL_CANDIDATES_KEY)
}
