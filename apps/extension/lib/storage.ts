import type { AfterAnalysisResult, SessionSummary } from "@prompt-optimizer/shared"
import { Storage } from "@plasmohq/storage"

const storage = new Storage({ area: "local" })

const ONBOARDING_KEY = "prompt-optimizer:onboarding-seen"
const SESSION_KEY = "prompt-optimizer:session-summary"
const PROJECT_MEMORY_PREFIX = "prompt-optimizer:project-memory:"
const AFTER_REVIEW_CACHE_PREFIX = "prompt-optimizer:after-review:"
const DEEP_ARTIFACT_TELEMETRY_PREFIX = "prompt-optimizer:deep-artifact-telemetry:"
const GLOBAL_POPUP_TELEMETRY_KEY = `${DEEP_ARTIFACT_TELEMETRY_PREFIX}popup-global`
const AFTER_EXPERIENCE_EVENT_LOG_KEY = "prompt-optimizer:after-experience-events"

export type ProjectMemoryRecord = {
  projectKey: string
  projectLabel: string
  projectContext: string
  currentState: string
  memoryDepth?: "quick" | "deep"
  awaitingFreshAnswer?: boolean
  baselineResponseIdentity?: string
  baselineResponseText?: string
  baselineThreadIdentity?: string
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
  eventType: "decision_shown" | "copy_next_prompt" | "popup_expanded" | "feedback_helpful" | "feedback_next_prompt_success"
  attemptId: string
  decision: AfterAnalysisResult["decision"]
  recommendedAction: AfterAnalysisResult["recommended_action"]
  confidence: AfterAnalysisResult["confidence"]
  promptStrategy: AfterAnalysisResult["prompt_strategy"]
  reviewMode?: "quick" | "deep"
  userFeedbackHelpful?: boolean
  userFeedbackNextPromptSuccess?: boolean
  createdAt: string
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
  const segments = url.pathname.split("/").filter(Boolean)
  const scopedPath = segments.slice(0, 3).join("/")
  return {
    key: `${url.origin}/${scopedPath || ""}`,
    label: scopedPath || url.hostname
  }
}

function getProjectMemoryKey(projectKey: string) {
  return `${PROJECT_MEMORY_PREFIX}${projectKey}`
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
  const signature = `${input.threadIdentity}::${input.responseIdentity || ""}::${input.normalizedText}`
  return `${AFTER_REVIEW_CACHE_PREFIX}${stableStorageHash(signature)}`
}

function getDeepArtifactTelemetryKey(projectKey: string) {
  return `${DEEP_ARTIFACT_TELEMETRY_PREFIX}${stableStorageHash(projectKey)}`
}

export async function getProjectMemory(projectKey: string) {
  return ((await storage.get<ProjectMemoryRecord>(getProjectMemoryKey(projectKey))) ?? null) as ProjectMemoryRecord | null
}

export async function saveProjectMemory(input: {
  projectKey: string
  projectLabel: string
  projectContext: string
  currentState: string
  memoryDepth?: "quick" | "deep"
  awaitingFreshAnswer?: boolean
  baselineResponseIdentity?: string
  baselineResponseText?: string
  baselineThreadIdentity?: string
}) {
  const record: ProjectMemoryRecord = {
    projectKey: input.projectKey,
    projectLabel: input.projectLabel,
    projectContext: input.projectContext.trim(),
    currentState: input.currentState.trim(),
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
