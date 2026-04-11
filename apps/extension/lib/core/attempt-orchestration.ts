import {
  buildAttemptIntentFromBefore,
  buildAttemptIntentFromSubmittedPrompt
} from "@prompt-optimizer/shared"
import type {
  AnalyzePromptResponse,
  Attempt,
  AttemptIntent,
  ClarificationQuestion
} from "@prompt-optimizer/shared/src/schemas"

export function buildDraftAttemptInput(params: {
  promptText: string
  optimizedPrompt: string
  platform: Attempt["platform"]
  beforeIntent: AnalyzePromptResponse["intent"] | null | undefined
  clarificationQuestions: ClarificationQuestion[]
  answers: Record<string, string | string[]>
}) {
  const { promptText, optimizedPrompt, platform, beforeIntent, clarificationQuestions, answers } = params

  return {
    attempt_id: crypto.randomUUID(),
    platform,
    raw_prompt: promptText.trim(),
    optimized_prompt: optimizedPrompt.trim(),
    intent: buildAttemptIntentFromBefore(
      promptText,
      optimizedPrompt,
      beforeIntent,
      clarificationQuestions,
      answers
    )
  }
}

export function buildSubmittedAttemptPatch(params: {
  prompt: string
  beforeIntent: AnalyzePromptResponse["intent"] | null | undefined
}) {
  const { prompt, beforeIntent } = params

  return {
    raw_prompt: prompt,
    optimized_prompt: prompt,
    intent: buildAttemptIntentFromSubmittedPrompt(prompt, beforeIntent)
  } satisfies Partial<Pick<Attempt, "raw_prompt" | "optimized_prompt" | "intent">>
}

export function shouldReuseLatestSubmittedAttempt(params: {
  normalizedPrompt: string
  latestSubmitted:
    | Pick<Attempt, "raw_prompt" | "optimized_prompt">
    | null
}) {
  const { normalizedPrompt, latestSubmitted } = params
  if (!latestSubmitted) return false
  if (!normalizedPrompt) return true

  return (
    latestSubmitted.raw_prompt.trim() === normalizedPrompt ||
    latestSubmitted.optimized_prompt.trim() === normalizedPrompt
  )
}

export function buildFallbackSubmittedAttemptInput(params: {
  prompt: string
  platform: Attempt["platform"]
  beforeIntent: AnalyzePromptResponse["intent"] | null | undefined
}) {
  const { prompt, platform, beforeIntent } = params

  return {
    attempt_id: crypto.randomUUID(),
    platform,
    raw_prompt: prompt,
    optimized_prompt: prompt,
    intent: buildAttemptIntentFromSubmittedPrompt(prompt, beforeIntent)
  }
}

export function buildPlanningAttemptIntentFromPrompt(params: {
  prompt: string
  beforeIntent: AnalyzePromptResponse["intent"] | null | undefined
}): AttemptIntent {
  const { prompt, beforeIntent } = params
  return buildAttemptIntentFromSubmittedPrompt(prompt, beforeIntent)
}
