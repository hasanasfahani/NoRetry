import type { AfterAnalysisResult, Attempt, AttemptIntent, AttemptPlatform } from "@prompt-optimizer/shared/src/schemas"
import { Storage } from "@plasmohq/storage"

const storage = new Storage({ area: "local" })

const ATTEMPTS_KEY = "noretry:attempts"
const ACTIVE_ATTEMPT_KEY = "noretry:active-attempt-id"
const CODE_ANALYSIS_MODE_KEY = "noretry:code-analysis-mode"
const MAX_ATTEMPTS = 12

export type CodeAnalysisMode = "quick" | "deep"

async function getAttempts() {
  return ((await storage.get<Attempt[]>(ATTEMPTS_KEY)) ?? []) as Attempt[]
}

async function saveAttempts(attempts: Attempt[]) {
  await storage.set(ATTEMPTS_KEY, attempts.slice(-MAX_ATTEMPTS))
}

export async function createAttempt(input: {
  attempt_id: string
  platform: AttemptPlatform
  raw_prompt: string
  optimized_prompt: string
  intent: AttemptIntent
}) {
  const attempts = await getAttempts()
  const attempt: Attempt = {
    ...input,
    status: "draft",
    created_at: new Date().toISOString(),
    submitted_at: null,
    response_text: null,
    response_message_id: null,
    analysis_result: null,
    token_usage_total: 0,
    stage_cache: {}
  }

  const nextAttempts = [...attempts.filter((entry) => entry.attempt_id !== attempt.attempt_id), attempt]
  await saveAttempts(nextAttempts)
  await storage.set(ACTIVE_ATTEMPT_KEY, attempt.attempt_id)
  return attempt
}

export async function updateAttempt(attemptId: string, patch: Partial<Attempt>) {
  const attempts = await getAttempts()
  const nextAttempts = attempts.map((attempt) =>
    attempt.attempt_id === attemptId ? { ...attempt, ...patch, attempt_id: attempt.attempt_id } : attempt
  )
  await saveAttempts(nextAttempts)
  return nextAttempts.find((attempt) => attempt.attempt_id === attemptId) ?? null
}

export async function markAttemptSubmitted(
  attemptId: string,
  patch?: Partial<Pick<Attempt, "raw_prompt" | "optimized_prompt" | "intent">>
) {
  return updateAttempt(attemptId, {
    ...patch,
    status: "submitted",
    submitted_at: new Date().toISOString()
  })
}

export async function getLatestSubmittedAttempt() {
  const attempts = await getAttempts()
  return (
    attempts
      .filter((attempt) => attempt.status === "submitted")
      .sort((a, b) => (b.submitted_at ?? b.created_at).localeCompare(a.submitted_at ?? a.created_at))[0] ?? null
  )
}

export async function getActiveAttempt() {
  const activeAttemptId = await storage.get<string>(ACTIVE_ATTEMPT_KEY)
  if (!activeAttemptId) return null

  const attempts = await getAttempts()
  return attempts.find((attempt) => attempt.attempt_id === activeAttemptId) ?? null
}

export async function attachAnalysisResult(
  attemptId: string,
  responseText: string,
  analysis: AfterAnalysisResult,
  responseMessageId?: string | null
) {
  return updateAttempt(attemptId, {
    status: "analyzed",
    response_text: responseText,
    response_message_id: responseMessageId ?? null,
    analysis_result: analysis,
    token_usage_total: analysis.token_usage_total
  })
}

export async function getCodeAnalysisMode(): Promise<CodeAnalysisMode> {
  return ((await storage.get<CodeAnalysisMode>(CODE_ANALYSIS_MODE_KEY)) ?? "quick") as CodeAnalysisMode
}

export async function setCodeAnalysisMode(mode: CodeAnalysisMode) {
  await storage.set(CODE_ANALYSIS_MODE_KEY, mode)
}
