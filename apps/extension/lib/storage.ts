import type { SessionSummary } from "@prompt-optimizer/shared/src/schemas"
import { Storage } from "@plasmohq/storage"

const storage = new Storage({ area: "local" })

const ONBOARDING_KEY = "prompt-optimizer:onboarding-seen"
const SESSION_KEY = "prompt-optimizer:session-summary"

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
