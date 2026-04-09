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

const AFTER_STAGE_SOFT_DEADLINE_MS = 8000

function dedupe(items: string[], limit = 6) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, limit)
}

function conciseGoal(goal: string, limit = 140) {
  const trimmed = goal.trim()
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit - 1).trimEnd()}…`
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "your",
  "have",
  "will",
  "into",
  "about",
  "after",
  "before",
  "then",
  "when",
  "what",
  "where",
  "which",
  "they",
  "them",
  "their",
  "because",
  "should",
  "could",
  "would",
  "there",
  "please",
  "just",
  "only",
  "keep",
  "focus",
  "tell",
  "exactly"
])

function extractMeaningfulTokens(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token))
}

function hasGoalEvidence(goal: string, responseSummary: AfterPipelineRequest["response_summary"]) {
  const goalTokens = extractMeaningfulTokens(goal)
  if (!goalTokens.length) return true

  const haystack = [
    responseSummary.first_excerpt,
    responseSummary.last_excerpt,
    ...responseSummary.key_paragraphs,
    ...responseSummary.mentioned_files
  ]
    .join(" ")
    .toLowerCase()

  const matched = goalTokens.filter((token) => haystack.includes(token))
  return matched.length >= Math.min(2, goalTokens.length)
}

function responseFocusSnippet(responseSummary: AfterPipelineRequest["response_summary"]) {
  const snippet = responseSummary.key_paragraphs[0] || responseSummary.first_excerpt || responseSummary.last_excerpt
  return conciseGoal(snippet || "the visible answer")
}

function summarizeVisibleAnswer(responseSummary: AfterPipelineRequest["response_summary"]) {
  const snippet = responseFocusSnippet(responseSummary)
  const compact = snippet.replace(/\s+/g, " ").trim()
  if (!compact) return "The answer stayed on the visible topic."

  const sentenceLike = /[.!?]/.test(compact)
  if (sentenceLike || compact.length > 90) return compact

  return `The answer appears focused on: ${compact}`
}

function constraintMentioned(constraint: string, responseSummary: AfterPipelineRequest["response_summary"]) {
  const normalizedConstraint = constraint.toLowerCase()
  const haystack = [
    responseSummary.first_excerpt,
    responseSummary.last_excerpt,
    ...responseSummary.key_paragraphs
  ]
    .join(" ")
    .toLowerCase()

  return haystack.includes(normalizedConstraint)
}

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

function fallbackStage1(responseSummary: AfterPipelineRequest["response_summary"]) {
  const responseMode =
    responseSummary.has_code_blocks || responseSummary.mentioned_files.length
      ? "implemented"
      : responseSummary.uncertainty_signals.length
        ? "uncertain"
        : responseSummary.success_signals.length
          ? "explained"
          : "suggested"

  const scopeAssessment =
    responseSummary.mentioned_files.length >= 6
      ? "broad"
      : responseSummary.mentioned_files.length >= 2 || responseSummary.response_length > 1800
        ? "moderate"
        : "narrow"

  const summarySource = summarizeVisibleAnswer(responseSummary)

  return Stage1OutputSchema.parse({
    assistant_action_summary: summarySource.slice(0, 220),
    claimed_evidence: dedupe(
      [
        ...responseSummary.success_signals,
        ...responseSummary.mentioned_files,
        ...(responseSummary.has_code_blocks ? ["Included code blocks"] : [])
      ],
      4
    ),
    response_mode: responseMode,
    scope_assessment: scopeAssessment
  })
}

function fallbackStage2(
  intent: AttemptIntent,
  stage1: ReturnType<typeof Stage1OutputSchema.parse>,
  responseSummary: AfterPipelineRequest["response_summary"]
) {
  const goalMatched = hasGoalEvidence(intent.goal, responseSummary)
  const usesDefaultGoalCriterion = intent.acceptance_criteria.some((criterion) =>
    /prove the answer solved this goal:/i.test(criterion)
  )
  const hasOnTopicSignals =
    goalMatched &&
    (stage1.response_mode === "implemented" ||
      stage1.response_mode === "explained" ||
      responseSummary.success_signals.length > 0 ||
      responseSummary.response_length > 220)

  const addressed =
    stage1.response_mode === "implemented" && goalMatched
      ? intent.acceptance_criteria.slice(0, 2)
      : usesDefaultGoalCriterion && hasOnTopicSignals
        ? intent.acceptance_criteria.slice(0, 1)
        : []
  const rawMissing = intent.acceptance_criteria.filter((criterion) => !addressed.includes(criterion)).slice(0, 4)
  const missing = rawMissing.map((criterion) => {
    if (/prove the answer solved this goal:/i.test(criterion)) {
      return goalMatched
        ? ""
        : `The answer appears focused on ${responseFocusSnippet(responseSummary)} instead of ${conciseGoal(intent.goal)}.`
    }
    return criterion
  }).filter(Boolean)
  const risks = intent.constraints
    .filter((constraint) => !constraintMentioned(constraint, responseSummary))
    .slice(0, 3)
    .map((constraint) => `The answer did not explicitly address this constraint: ${constraint}`)

  return Stage2OutputSchema.parse({
    addressed_criteria: addressed,
    missing_criteria: missing,
    constraint_risks: risks,
    problem_fit: goalMatched ? (stage1.scope_assessment === "broad" ? "partial" : "correct") : "wrong_direction",
    analysis_notes: dedupe(
      [
        stage1.response_mode === "uncertain" ? "The assistant sounded uncertain." : "",
        !goalMatched ? "The visible answer does not share enough signal with the intended goal." : "",
        goalMatched && usesDefaultGoalCriterion && !missing.length
          ? "The answer looks on-topic, but NoRetry is relying on inferred validation rather than explicit proof."
          : "",
        missing.length ? "Some acceptance criteria remain unverified." : ""
      ],
      4
    )
  })
}

function fallbackVerdict(
  intent: AttemptIntent,
  responseSummary: AfterPipelineRequest["response_summary"],
  stage1: ReturnType<typeof Stage1OutputSchema.parse>,
  stage2: ReturnType<typeof Stage2OutputSchema.parse>,
  usedFallbackIntent: boolean
) {
  let status: "SUCCESS" | "LIKELY_SUCCESS" | "PARTIAL" | "FAILED" | "WRONG_DIRECTION" | "UNVERIFIED" = "UNVERIFIED"

  if (responseSummary.failure_signals.length) status = "FAILED"
  else if (stage2.problem_fit === "wrong_direction") status = "WRONG_DIRECTION"
  else if (!stage2.missing_criteria.length && responseSummary.success_signals.length) status = "LIKELY_SUCCESS"
  else if (stage2.missing_criteria.length || responseSummary.uncertainty_signals.length) status = "PARTIAL"

  const isCodeHeavyTask =
    intent.task_type === "debug" || intent.task_type === "build" || intent.task_type === "refactor" || intent.task_type === "create_ui"
  const hasConcreteEvidence = responseSummary.mentioned_files.length > 0 || responseSummary.has_code_blocks
  const confidence =
    status === "FAILED" || status === "WRONG_DIRECTION"
      ? "high"
      : usedFallbackIntent
        ? "low"
        : isCodeHeavyTask
          ? hasConcreteEvidence
            ? "medium"
            : "low"
          : stage2.problem_fit === "correct" && !stage2.missing_criteria.length
            ? "medium"
            : "low"

  const confidenceReason =
    usedFallbackIntent
      ? "NoRetry had to infer the goal from the prompt, so this review is more cautious."
      : status === "WRONG_DIRECTION"
        ? "The answer appears to be about a different problem than the saved goal."
        : isCodeHeavyTask
          ? hasConcreteEvidence
            ? "The answer included concrete implementation evidence."
            : "The answer stayed on-topic, but it did not include enough concrete implementation evidence."
          : stage2.problem_fit === "correct"
            ? "The answer appears aligned with the goal, but NoRetry cannot fully verify the outcome from text alone."
            : "The answer gave limited concrete evidence, so this review is cautious."

  const primaryFinding =
    status === "WRONG_DIRECTION"
      ? `The answer appears to address ${responseFocusSnippet(responseSummary)} instead of ${conciseGoal(intent.goal)}.`
      : stage2.problem_fit === "correct" && !stage2.missing_criteria.length
        ? `The answer appears aligned with the goal: ${conciseGoal(intent.goal)}.`
        : stage1.assistant_action_summary

  return VerdictOutputSchema.parse({
    status,
    confidence,
    confidence_reason: confidenceReason,
    findings: dedupe(
      [
        primaryFinding,
        stage2.analysis_notes[0] || "",
        stage2.missing_criteria.length && !usedFallbackIntent ? stage2.missing_criteria[0] : "",
        responseSummary.failure_signals.length ? `Failure signal: ${responseSummary.failure_signals[0]}` : "",
        hasConcreteEvidence ? `Evidence referenced: ${[...responseSummary.mentioned_files, ...(responseSummary.has_code_blocks ? ["code blocks"] : [])].slice(0, 2).join(", ")}` : ""
      ],
      3
    ),
    issues: dedupe(
      [
        ...stage2.missing_criteria,
        ...stage2.constraint_risks,
        ...(responseSummary.uncertainty_signals.length ? ["The response sounds uncertain."] : []),
        ...(usedFallbackIntent && status !== "WRONG_DIRECTION"
          ? ["NoRetry inferred the goal from the prompt, so this review may be less precise."]
          : [])
      ],
      6
    )
  })
}

function fallbackNextPrompt(
  optimizedPrompt: string,
  verdict: ReturnType<typeof VerdictOutputSchema.parse>,
  stage2: ReturnType<typeof Stage2OutputSchema.parse>
) {
  const focus =
    stage2.missing_criteria[0] ||
    stage2.constraint_risks[0] ||
    verdict.issues[0] ||
    "validate the result against the original request"

  const strategy =
    verdict.status === "FAILED"
      ? "retry_cleanly"
      : stage2.constraint_risks.length
        ? "narrow_scope"
        : stage2.missing_criteria.length
          ? "fix_missing"
          : "validate"

  return NextPromptOutputSchema.parse({
    next_prompt: `${optimizedPrompt}\n\nBefore continuing, focus only on this: ${focus}. Tell me exactly what you changed, what evidence proves it, and whether the original request is now fully satisfied.`,
    prompt_strategy: strategy
  })
}

export async function analyzeAfterAttempt(input: AfterPipelineRequest) {
  const parsed = input
  const budgetSoftLimit = 1800
  const startedAt = Date.now()
  let tokenUsageTotal = 0
  let intent = parsed.attempt.intent
  let usedFallbackIntent = false
  const elapsed = () => Date.now() - startedAt

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
    tokenUsageTotal >= budgetSoftLimit ? 120 : 180
  )
  tokenUsageTotal += estimateTokensFromText(stage1Prompts.system, stage1Prompts.user)
  const safeStage1 = stage1 ?? fallbackStage1(parsed.response_summary)

  const stage2Prompts = buildStage2Prompts(intent, safeStage1, parsed.response_summary)
  const stage2 = await callStructuredJson(
    stage2Prompts.system,
    stage2Prompts.user,
    (value) => Stage2OutputSchema.parse(value),
    tokenUsageTotal >= budgetSoftLimit ? 120 : 180
  )
  tokenUsageTotal += estimateTokensFromText(stage2Prompts.system, stage2Prompts.user)
  const safeStage2 = stage2 ?? fallbackStage2(intent, safeStage1, parsed.response_summary)

  let safeVerdict = fallbackVerdict(intent, parsed.response_summary, safeStage1, safeStage2, usedFallbackIntent)
  let safeNextPrompt = fallbackNextPrompt(parsed.attempt.optimized_prompt, safeVerdict, safeStage2)

  if (elapsed() < AFTER_STAGE_SOFT_DEADLINE_MS) {
    const stage3Prompts = buildStage3Prompts(intent, safeStage1, safeStage2, parsed.response_summary)
    const verdict = await callStructuredJson(
      stage3Prompts.system,
      stage3Prompts.user,
      (value) => VerdictOutputSchema.parse(value),
      tokenUsageTotal >= budgetSoftLimit ? 110 : 160
    )
    tokenUsageTotal += estimateTokensFromText(stage3Prompts.system, stage3Prompts.user)
    safeVerdict = verdict ?? safeVerdict
  }

  if (elapsed() < AFTER_STAGE_SOFT_DEADLINE_MS) {
    const stage4Prompts = buildStage4Prompts(parsed.attempt.optimized_prompt, intent, safeVerdict, safeStage2)
    const nextPromptOutput = await callStructuredJson(
      stage4Prompts.system,
      stage4Prompts.user,
      (value) => NextPromptOutputSchema.parse(value),
      tokenUsageTotal >= budgetSoftLimit ? 130 : 180
    )
    tokenUsageTotal += estimateTokensFromText(stage4Prompts.system, stage4Prompts.user)
    safeNextPrompt = nextPromptOutput ?? safeNextPrompt
  }

  return AfterPipelineResponseSchema.parse({
    status: safeVerdict.status,
    confidence: safeVerdict.confidence,
    confidence_reason: safeVerdict.confidence_reason,
    findings: safeVerdict.findings,
    issues: safeVerdict.issues,
    next_prompt: safeNextPrompt.next_prompt,
    prompt_strategy: safeNextPrompt.prompt_strategy,
    stage_1: safeStage1,
    stage_2: safeStage2,
    verdict: safeVerdict,
    next_prompt_output: safeNextPrompt,
    response_summary: parsed.response_summary,
    used_fallback_intent: usedFallbackIntent,
    token_usage_total: tokenUsageTotal
  })
}
