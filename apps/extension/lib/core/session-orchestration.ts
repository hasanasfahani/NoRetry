import type {
  AnalyzePromptResponse,
  DetectOutcomeRequest,
  PromptIntent,
  SessionSummary
} from "@prompt-optimizer/shared/src/schemas"

export type PendingPrompt = {
  id: string
  prompt: string
  intent: AnalyzePromptResponse["intent"]
  sentAt: number
}

export function buildPendingPrompt(params: {
  prompt: string
  intent: AnalyzePromptResponse["intent"]
  now: number
}): PendingPrompt {
  const { prompt, intent, now } = params

  return {
    id: crypto.randomUUID(),
    prompt,
    intent,
    sentAt: now
  }
}

export function buildSessionAfterSubmit(params: {
  currentSession: SessionSummary
  prompt: string
  rewrite: string | null | undefined
  intent: PromptIntent | undefined
  retryCount: number
}) {
  const { currentSession, prompt, rewrite, intent, retryCount } = params

  return {
    ...currentSession,
    lastPrompts: [...currentSession.lastPrompts.slice(-2), prompt],
    lastOptimizedPrompts: rewrite
      ? [...currentSession.lastOptimizedPrompts.slice(-2), rewrite]
      : currentSession.lastOptimizedPrompts,
    lastIntent: intent ?? "OTHER",
    retryCount
  } satisfies SessionSummary
}

export function buildSessionAfterOutcome(params: {
  currentSession: SessionSummary
  lastIssueDetected: string | null
  lastProbableStatus: SessionSummary["lastProbableStatus"]
}) {
  const { currentSession, lastIssueDetected, lastProbableStatus } = params

  return {
    ...currentSession,
    lastIssueDetected,
    lastProbableStatus
  } satisfies SessionSummary
}

export function buildDetectOutcomePayload(params: {
  currentSession: SessionSummary
  pendingPrompt: PendingPrompt
  optimizedPrompt: string | null
  strengthScore: SessionSummary["lastStrengthScore"] | null | undefined
  outputSnippet: string
  errorSummary: string | null | undefined
  changedFiles: string[]
}) {
  const { currentSession, pendingPrompt, optimizedPrompt, strengthScore, outputSnippet, errorSummary, changedFiles } =
    params

  return {
    session_id: currentSession.sessionId,
    prompt_id: pendingPrompt.id,
    original_prompt: pendingPrompt.prompt,
    optimized_prompt: optimizedPrompt ?? null,
    strength_score: strengthScore ?? undefined,
    final_sent_prompt: pendingPrompt.prompt,
    prompt_intent: pendingPrompt.intent,
    output_snippet: outputSnippet,
    error_summary: errorSummary,
    retry_count: currentSession.retryCount,
    changed_files_count: changedFiles.length,
    changed_file_paths_summary: changedFiles,
    timestamps: {
      promptSentAt: new Date(pendingPrompt.sentAt).toISOString(),
      evaluatedAt: new Date().toISOString()
    }
  } satisfies DetectOutcomeRequest
}
