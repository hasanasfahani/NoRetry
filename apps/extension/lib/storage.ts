import type { AfterAnalysisResult, SessionSummary } from "@prompt-optimizer/shared"
import { Storage } from "@plasmohq/storage"

const storage = new Storage({ area: "local" })

const ONBOARDING_KEY = "prompt-optimizer:onboarding-seen"
const SESSION_KEY = "prompt-optimizer:session-summary"
const PROJECT_MEMORY_PREFIX = "prompt-optimizer:project-memory:"
const AFTER_REVIEW_CACHE_PREFIX = "prompt-optimizer:after-review:"

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
