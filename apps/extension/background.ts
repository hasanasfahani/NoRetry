import {
  AfterAnalysisResultSchema,
  AfterPipelineRequestSchema,
  IntentExtractionOutputSchema,
  NextPromptOutputSchema,
  Stage1OutputSchema,
  Stage2OutputSchema,
  VerdictOutputSchema,
  type AfterPipelineRequest,
  type AttemptIntent
} from "@prompt-optimizer/shared"
import { buildResponseExcerpts, compressGoal } from "@prompt-optimizer/shared"
import {
  buildIntentExtractionPrompts,
  buildStage1Prompts,
  buildStage2Prompts,
  buildStage3Prompts,
  buildStage4Prompts
} from "./lib/after/prompts"

type ProxyRequestMessage = {
  type: "PROMPT_OPTIMIZER_PROXY"
  path: string
  body: string
}

type AfterPipelineMessage = {
  type: "PROMPT_OPTIMIZER_AFTER_PIPELINE"
  payload: AfterPipelineRequest
}

const API_BASE = process.env.PLASMO_PUBLIC_API_BASE_URL || "https://noretry.vercel.app"
const REQUEST_TIMEOUT_MS = 8000
const KIMI_API_KEY = process.env.PLASMO_PUBLIC_KIMI_API_KEY || ""
const KIMI_MODEL = process.env.PLASMO_PUBLIC_KIMI_MODEL || "kimi-k2-turbo-preview"
const DEEPSEEK_API_KEY = process.env.PLASMO_PUBLIC_DEEPSEEK_API_KEY || ""
const DEEPSEEK_MODEL = process.env.PLASMO_PUBLIC_DEEPSEEK_MODEL || "deepseek-chat"

function getApiBases() {
  const bases = [API_BASE]
  if (API_BASE.includes("localhost")) {
    bases.push(API_BASE.replace("localhost", "127.0.0.1"))
  }
  return [...new Set(bases)]
}

function parseLooseJson(raw: string) {
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

async function callKimiJson(system: string, user: string, maxTokens: number) {
  if (!KIMI_API_KEY) return null

  const response = await fetch("https://api.moonshot.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${KIMI_API_KEY}`
    },
    body: JSON.stringify({
      model: KIMI_MODEL,
      temperature: 0.1,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  })

  if (!response.ok) {
    throw new Error(`Kimi request failed with ${response.status}`)
  }

  const json = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string
      }
    }>
  }

  const text = json.choices?.[0]?.message?.content?.trim()
  if (!text) return null
  return parseLooseJson(text.replace(/```json|```/g, "").trim())
}

async function callDeepSeekJson(system: string, user: string, maxTokens: number) {
  if (!DEEPSEEK_API_KEY) return null

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      temperature: 0.1,
      max_tokens: maxTokens,
      response_format: {
        type: "json_object"
      },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  })

  if (!response.ok) {
    throw new Error(`DeepSeek request failed with ${response.status}`)
  }

  const json = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string
      }
    }>
  }

  const text = json.choices?.[0]?.message?.content?.trim()
  if (!text) return null
  return parseLooseJson(text.replace(/```json|```/g, "").trim())
}

async function callJsonWithFallback<T>(system: string, user: string, maxTokens: number, parser: (value: unknown) => T) {
  const providers = [
    () => callKimiJson(system, user, maxTokens),
    () => callDeepSeekJson(system, user, maxTokens)
  ]

  for (const provider of providers) {
    try {
      const result = await provider()
      if (result) return parser(result)
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
  return (
    intent.task_type === "other" &&
    intent.constraints.length === 0 &&
    intent.acceptance_criteria.length === 0
  )
}

async function runAfterPipeline(payload: AfterPipelineRequest) {
  const parsed = AfterPipelineRequestSchema.parse(payload)
  const budgetSoftLimit = 1800
  let tokenUsageTotal = 0
  let intent = parsed.attempt.intent
  let usedFallbackIntent = false

  if (needsFallbackIntent(intent)) {
    const prompts = buildIntentExtractionPrompts(parsed.attempt.raw_prompt)
    const maxTokens = tokenUsageTotal >= budgetSoftLimit ? 140 : 220
    const extracted = await callJsonWithFallback(prompts.system, prompts.user, maxTokens, (value) =>
      IntentExtractionOutputSchema.parse(value)
    )
    tokenUsageTotal += estimateTokensFromText(prompts.system, prompts.user)
    if (extracted) {
      intent = extracted
      usedFallbackIntent = true
    }
  }

  const stage1Prompts = buildStage1Prompts({
    intent_goal: compressGoal(intent.goal),
    task_type: intent.task_type,
    response_summary: parsed.response_summary
  })
  const stage1MaxTokens = tokenUsageTotal >= budgetSoftLimit ? 180 : 260
  const stage1 = await callJsonWithFallback(stage1Prompts.system, stage1Prompts.user, stage1MaxTokens, (value) =>
    Stage1OutputSchema.parse(value)
  )
  tokenUsageTotal += estimateTokensFromText(stage1Prompts.system, stage1Prompts.user)
  if (!stage1) {
    throw new Error("Stage 1 response summary failed")
  }

  const stage2Prompts = buildStage2Prompts({
    intent,
    stage_1: stage1,
    response_excerpts: buildResponseExcerpts(parsed.response_summary)
  })
  const stage2MaxTokens = tokenUsageTotal >= budgetSoftLimit ? 180 : 260
  const stage2 = await callJsonWithFallback(stage2Prompts.system, stage2Prompts.user, stage2MaxTokens, (value) =>
    Stage2OutputSchema.parse(value)
  )
  tokenUsageTotal += estimateTokensFromText(stage2Prompts.system, stage2Prompts.user)
  if (!stage2) {
    throw new Error("Stage 2 intent alignment failed")
  }

  const stage3Prompts = buildStage3Prompts({
    intent,
    stage_1: stage1,
    stage_2: stage2,
    response_summary: parsed.response_summary
  })
  const stage3MaxTokens = tokenUsageTotal >= budgetSoftLimit ? 160 : 240
  const verdict = await callJsonWithFallback(stage3Prompts.system, stage3Prompts.user, stage3MaxTokens, (value) =>
    VerdictOutputSchema.parse(value)
  )
  tokenUsageTotal += estimateTokensFromText(stage3Prompts.system, stage3Prompts.user)
  if (!verdict) {
    throw new Error("Stage 3 verdict generation failed")
  }

  const stage4Prompts = buildStage4Prompts({
    optimized_prompt: parsed.attempt.optimized_prompt,
    intent,
    verdict,
    missing_criteria: stage2.missing_criteria,
    constraint_risks: stage2.constraint_risks
  })
  const stage4MaxTokens = tokenUsageTotal >= budgetSoftLimit ? 180 : 280
  const nextPromptOutput = await callJsonWithFallback(stage4Prompts.system, stage4Prompts.user, stage4MaxTokens, (value) =>
    NextPromptOutputSchema.parse(value)
  )
  tokenUsageTotal += estimateTokensFromText(stage4Prompts.system, stage4Prompts.user)
  if (!nextPromptOutput) {
    throw new Error("Stage 4 next-prompt generation failed")
  }

  return AfterAnalysisResultSchema.parse({
    status: verdict.status,
    confidence: verdict.confidence,
    confidence_label:
      verdict.confidence === "high" ? "High" : verdict.confidence === "medium" ? "Medium" : "Low",
    confidence_reason: verdict.confidence_reason,
    confidence_reasons: [verdict.confidence_reason].filter(Boolean),
    inspection_depth: "summary_only",
    decision: verdict.status === "WRONG_DIRECTION" ? "Likely wrong direction" : verdict.status === "UNVERIFIED" ? "Not enough proof" : verdict.status === "PARTIAL" || verdict.status === "FAILED" ? "Needs refinement" : "Safe to proceed",
    recommended_action:
      verdict.status === "WRONG_DIRECTION"
        ? "RESTART_WITH_PROMPT"
        : verdict.status === "UNVERIFIED"
          ? "VALIDATE_FIRST"
          : verdict.status === "PARTIAL" || verdict.status === "FAILED"
            ? "SEND_PROMPT"
            : "PROCEED",
    why_bullets: verdict.findings.slice(0, 3),
    next_action:
      verdict.status === "WRONG_DIRECTION"
        ? "Restart with this prompt."
        : verdict.status === "PARTIAL" || verdict.status === "FAILED"
          ? "Send this prompt before continuing."
          : verdict.status === "UNVERIFIED"
            ? "Validate this before proceeding."
            : "Continue, no changes needed.",
    findings: verdict.findings,
    issues: verdict.issues,
    next_prompt: nextPromptOutput.next_prompt,
    prompt_strategy: nextPromptOutput.prompt_strategy,
    next_prompt_explanation:
      nextPromptOutput.next_prompt_explanation ||
      "This prompt focuses only on what still looks missing or risky.",
    expected_outcome:
      nextPromptOutput.expected_outcome ||
      (verdict.status === "WRONG_DIRECTION"
        ? "The assistant should return to the requested scope instead of continuing the drift."
        : verdict.status === "PARTIAL" || verdict.status === "FAILED"
          ? "The assistant should fix the unresolved part without redoing the whole solution."
          : "The assistant should validate the unproven part before you trust the answer."),
    stage_1: stage1,
    stage_2: stage2,
    verdict,
    next_prompt_output: nextPromptOutput,
    acceptance_checklist: [],
    checked_artifact_types: [],
    checked_artifacts: ["response"],
    unchecked_artifacts: ["DOM signals", "interaction telemetry", "popup telemetry", "live runtime in the workspace"],
    blocked_or_unproven_items: verdict.issues.slice(0, 6),
    deep_criterion_verifications: [],
    contradiction_count: 0,
    review_contract: {
      version: "v1",
      target_signature: "",
      goal: intent.goal,
      criteria: []
    },
    response_summary: parsed.response_summary,
    helpful_feedback: {
      helpful: null,
      next_prompt_success: null
    },
    used_fallback_intent: usedFallbackIntent,
    token_usage_total: tokenUsageTotal
  })
}

chrome.runtime.onMessage.addListener((message: ProxyRequestMessage | AfterPipelineMessage, _sender, sendResponse) => {
  if (!message) {
    return false
  }

  if (message.type === "PROMPT_OPTIMIZER_AFTER_PIPELINE") {
    void (async () => {
      try {
        const result = await runAfterPipeline(message.payload)
        sendResponse({ ok: true, result })
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "After evaluation failed"
        })
      }
    })()

    return true
  }

  if (message.type !== "PROMPT_OPTIMIZER_PROXY") {
    return false
  }

  void (async () => {
    let lastError: unknown = null

    for (const base of getApiBases()) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

        const response = await fetch(`${base}${message.path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: message.body,
          signal: controller.signal
        })

        clearTimeout(timeoutId)
        const text = await response.text()
        sendResponse({
          ok: response.ok,
          status: response.status,
          text
        })
        return
      } catch (error) {
        lastError = error
      }
    }

    sendResponse({
      ok: false,
      status: 0,
      text: lastError instanceof Error ? lastError.message : "Unknown proxy error"
    })
  })()

  return true
})
