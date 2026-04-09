import {
  AfterPipelineResponseSchema,
  IntentExtractionOutputSchema,
  NextPromptOutputSchema,
  Stage1OutputSchema,
  Stage2OutputSchema,
  VerdictOutputSchema,
  type AfterPipelineRequest,
  type AttemptIntent
} from "@prompt-optimizer/shared"
import { buildResponseExcerpts, compressGoal } from "@prompt-optimizer/shared"
import { trimForBudget } from "./cost-control"
import { callDeepSeekJson } from "./deepseek"
import { callKimiJson } from "./kimi"

function parseLooseJson(raw: string): unknown {
  const cleaned = raw.trim()

  try {
    return JSON.parse(cleaned)
  } catch {
    const startCandidates = [cleaned.indexOf("{"), cleaned.indexOf("[")].filter((index) => index >= 0)
    const start = startCandidates.length ? Math.min(...startCandidates) : -1
    if (start === -1) {
      throw new Error("Model response did not contain JSON")
    }

    for (let end = cleaned.length; end > start; end -= 1) {
      const slice = cleaned.slice(start, end).trim()
      if (!slice) continue

      try {
        return JSON.parse(slice)
      } catch {
        continue
      }
    }

    throw new Error("Model response contained malformed JSON")
  }
}

async function callStructuredJson<T>(
  systemPrompt: string,
  userPrompt: string,
  parser: (value: unknown) => T,
  maxTokens: number
) {
  const trimmedPrompt = trimForBudget(userPrompt, 5000)
  const providers = [
    () => callKimiJson(systemPrompt, trimmedPrompt, maxTokens),
    () => callDeepSeekJson(systemPrompt, trimmedPrompt, maxTokens)
  ]

  for (const callProvider of providers) {
    try {
      const raw = await callProvider()
      if (!raw) continue
      return parser(parseLooseJson(raw))
    } catch {
      continue
    }
  }

  return null
}

function estimateTokensFromText(...parts: string[]) {
  const chars = parts.join("").length
  return Math.max(1, Math.ceil(chars / 4))
}

function needsFallbackIntent(intent: AttemptIntent) {
  return intent.task_type === "other" && intent.constraints.length === 0 && intent.acceptance_criteria.length === 0
}

function buildIntentExtractionPrompts(rawPrompt: string) {
  return {
    system:
      "Extract intent for an AI debugging loop. Return JSON only with keys: task_type, goal, constraints, acceptance_criteria. Keep it minimal and do not invent detailed constraints.",
    user: JSON.stringify({ raw_prompt: rawPrompt })
  }
}

function buildStage1Prompts(payload: AfterPipelineRequest["response_summary"], intent: AttemptIntent) {
  return {
    system:
      "Summarize what the assistant appears to have done. Return JSON only with keys: assistant_action_summary, claimed_evidence, response_mode, scope_assessment.",
    user: JSON.stringify({
      intent_goal: compressGoal(intent.goal),
      task_type: intent.task_type,
      response_summary: {
        response_length: payload.response_length,
        has_code_blocks: payload.has_code_blocks,
        mentioned_files: payload.mentioned_files,
        certainty_signals: payload.certainty_signals,
        uncertainty_signals: payload.uncertainty_signals,
        success_signals: payload.success_signals,
        failure_signals: payload.failure_signals,
        first_excerpt: payload.first_excerpt,
        last_excerpt: payload.last_excerpt,
        key_paragraphs: payload.key_paragraphs
      }
    })
  }
}

function buildStage2Prompts(
  intent: AttemptIntent,
  stage1: ReturnType<typeof Stage1OutputSchema.parse>,
  responseSummary: AfterPipelineRequest["response_summary"]
) {
  return {
    system:
      "Compare the assistant response to the intended goal. Return JSON only with keys: addressed_criteria, missing_criteria, constraint_risks, problem_fit, analysis_notes.",
    user: JSON.stringify({
      intent,
      stage_1: stage1,
      response_excerpts: buildResponseExcerpts(responseSummary)
    })
  }
}

function buildStage3Prompts(
  intent: AttemptIntent,
  stage1: ReturnType<typeof Stage1OutputSchema.parse>,
  stage2: ReturnType<typeof Stage2OutputSchema.parse>,
  responseSummary: AfterPipelineRequest["response_summary"]
) {
  return {
    system:
      "Generate a trustworthy verdict for the AI response. Prefer UNVERIFIED over success when evidence is weak. Return JSON only with keys: status, confidence, findings, issues.",
    user: JSON.stringify({
      intent,
      stage_1: stage1,
      stage_2: stage2,
      response_summary: {
        response_length: responseSummary.response_length,
        has_code_blocks: responseSummary.has_code_blocks,
        mentioned_files: responseSummary.mentioned_files,
        certainty_signals: responseSummary.certainty_signals,
        uncertainty_signals: responseSummary.uncertainty_signals,
        success_signals: responseSummary.success_signals,
        failure_signals: responseSummary.failure_signals
      }
    })
  }
}

function buildStage4Prompts(
  optimizedPrompt: string,
  intent: AttemptIntent,
  verdict: ReturnType<typeof VerdictOutputSchema.parse>,
  stage2: ReturnType<typeof Stage2OutputSchema.parse>
) {
  return {
    system:
      "Write the next best prompt for the user. Keep scope tight and focus only on what is missing or risky. Return JSON only with keys: next_prompt, prompt_strategy.",
    user: JSON.stringify({
      optimized_prompt: optimizedPrompt,
      intent,
      verdict,
      missing_criteria: stage2.missing_criteria,
      constraint_risks: stage2.constraint_risks
    })
  }
}

export async function analyzeAfterAttempt(input: AfterPipelineRequest) {
  const parsed = input
  const budgetSoftLimit = 1800
  let tokenUsageTotal = 0
  let intent = parsed.attempt.intent
  let usedFallbackIntent = false

  if (needsFallbackIntent(intent)) {
    const prompts = buildIntentExtractionPrompts(parsed.attempt.raw_prompt)
    const maxTokens = tokenUsageTotal >= budgetSoftLimit ? 140 : 220
    const extracted = await callStructuredJson(
      prompts.system,
      prompts.user,
      (value) => IntentExtractionOutputSchema.parse(value),
      maxTokens
    )
    tokenUsageTotal += estimateTokensFromText(prompts.system, prompts.user)
    if (extracted) {
      intent = extracted
      usedFallbackIntent = true
    }
  }

  const stage1Prompts = buildStage1Prompts(parsed.response_summary, intent)
  const stage1 = await callStructuredJson(
    stage1Prompts.system,
    stage1Prompts.user,
    (value) => Stage1OutputSchema.parse(value),
    tokenUsageTotal >= budgetSoftLimit ? 180 : 260
  )
  tokenUsageTotal += estimateTokensFromText(stage1Prompts.system, stage1Prompts.user)
  if (!stage1) throw new Error("Stage 1 response summary failed")

  const stage2Prompts = buildStage2Prompts(intent, stage1, parsed.response_summary)
  const stage2 = await callStructuredJson(
    stage2Prompts.system,
    stage2Prompts.user,
    (value) => Stage2OutputSchema.parse(value),
    tokenUsageTotal >= budgetSoftLimit ? 180 : 260
  )
  tokenUsageTotal += estimateTokensFromText(stage2Prompts.system, stage2Prompts.user)
  if (!stage2) throw new Error("Stage 2 intent alignment failed")

  const stage3Prompts = buildStage3Prompts(intent, stage1, stage2, parsed.response_summary)
  const verdict = await callStructuredJson(
    stage3Prompts.system,
    stage3Prompts.user,
    (value) => VerdictOutputSchema.parse(value),
    tokenUsageTotal >= budgetSoftLimit ? 160 : 240
  )
  tokenUsageTotal += estimateTokensFromText(stage3Prompts.system, stage3Prompts.user)
  if (!verdict) throw new Error("Stage 3 verdict generation failed")

  const stage4Prompts = buildStage4Prompts(parsed.attempt.optimized_prompt, intent, verdict, stage2)
  const nextPromptOutput = await callStructuredJson(
    stage4Prompts.system,
    stage4Prompts.user,
    (value) => NextPromptOutputSchema.parse(value),
    tokenUsageTotal >= budgetSoftLimit ? 180 : 280
  )
  tokenUsageTotal += estimateTokensFromText(stage4Prompts.system, stage4Prompts.user)
  if (!nextPromptOutput) throw new Error("Stage 4 next-prompt generation failed")

  return AfterPipelineResponseSchema.parse({
    status: verdict.status,
    confidence: verdict.confidence,
    findings: verdict.findings,
    issues: verdict.issues,
    next_prompt: nextPromptOutput.next_prompt,
    prompt_strategy: nextPromptOutput.prompt_strategy,
    stage_1: stage1,
    stage_2: stage2,
    verdict,
    next_prompt_output: nextPromptOutput,
    response_summary: parsed.response_summary,
    used_fallback_intent: usedFallbackIntent,
    token_usage_total: tokenUsageTotal
  })
}
