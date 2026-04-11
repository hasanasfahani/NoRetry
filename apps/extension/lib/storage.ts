import type { SessionSummary } from "@prompt-optimizer/shared/src/schemas"
import { Storage } from "@plasmohq/storage"

const storage = new Storage({ area: "local" })

const ONBOARDING_KEY = "prompt-optimizer:onboarding-seen"
const SESSION_KEY = "prompt-optimizer:session-summary"
const PROJECT_MEMORY_PREFIX = "prompt-optimizer:project-memory:"

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
