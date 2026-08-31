import {
  assessAnalysisInput,
  buildAttemptIntentFromBefore,
  buildAttemptIntentFromSubmittedPrompt
} from "@prompt-optimizer/shared"
import type {
  AnalyzePromptResponse,
  Attempt,
  AttemptIntent,
  ClarificationQuestion
} from "@prompt-optimizer/shared/src/schemas"

function toOptionalIntent(beforeIntent: AnalyzePromptResponse["intent"] | null | undefined): AnalyzePromptResponse["intent"] | undefined {
  return beforeIntent == null ? undefined : beforeIntent
}

function buildAnalysisInputMetadata(promptText: string) {
  const assessment = assessAnalysisInput(promptText)
  return {
    analysis_input_size: assessment.analysisInputSize,
    analysis_mode: assessment.analysisMode,
    analysis_input_signals: assessment.signals
  }
}

export function buildDraftAttemptInput(params: {
  promptText: string
  optimizedPrompt: string
  platform: Attempt["platform"]
  beforeIntent: AnalyzePromptResponse["intent"] | null | undefined
  clarificationQuestions: ClarificationQuestion[]
  answers: Record<string, string | string[]>
}) {
  const { promptText, optimizedPrompt, platform, beforeIntent, clarificationQuestions, answers } = params
  const normalizedIntent = toOptionalIntent(beforeIntent)

  return {
    attempt_id: crypto.randomUUID(),
    platform,
    raw_prompt: promptText.trim(),
    optimized_prompt: optimizedPrompt.trim(),
    ...buildAnalysisInputMetadata(promptText),
    intent: buildAttemptIntentFromBefore(
      promptText,
      optimizedPrompt,
      normalizedIntent,
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
  const normalizedIntent = toOptionalIntent(beforeIntent)

  return {
    raw_prompt: prompt,
    optimized_prompt: prompt,
    ...buildAnalysisInputMetadata(prompt),
    intent: buildAttemptIntentFromSubmittedPrompt(prompt, normalizedIntent)
  } satisfies Partial<Pick<Attempt, "raw_prompt" | "optimized_prompt" | "intent" | "analysis_input_size" | "analysis_mode" | "analysis_input_signals">>
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
  const normalizedIntent = toOptionalIntent(beforeIntent)

  return {
    attempt_id: crypto.randomUUID(),
    platform,
    raw_prompt: prompt,
    optimized_prompt: prompt,
    ...buildAnalysisInputMetadata(prompt),
    intent: buildAttemptIntentFromSubmittedPrompt(prompt, normalizedIntent)
  }
}

export function buildPlanningAttemptIntentFromPrompt(params: {
  prompt: string
  beforeIntent: AnalyzePromptResponse["intent"] | null | undefined
}): AttemptIntent {
  const { prompt, beforeIntent } = params
  return buildAttemptIntentFromSubmittedPrompt(prompt, toOptionalIntent(beforeIntent))
}
