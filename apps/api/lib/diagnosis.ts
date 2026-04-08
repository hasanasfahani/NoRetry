import {
  AFTER_SYSTEM_PROMPT,
  AnalyzePromptResponseSchema,
  DEFAULT_PATTERN_TEMPLATES,
  DiagnoseFailureResponseSchema,
  ExtendQuestionsResponseSchema,
  RefinePromptResponseSchema,
  buildAfterUserPrompt,
  buildBeforeUserPrompt,
  buildExtendQuestionsUserPrompt,
  buildLocalRefineNotes,
  buildPromptFromAnswers,
  buildRefineUserPrompt,
  detectIntent,
  derivePatternKey
} from "@prompt-optimizer/shared"
import { analyzePromptLocally } from "@prompt-optimizer/shared"
import type {
  AnalyzePromptRequest,
  DiagnoseFailureRequest,
  DiagnoseFailureResponse,
  ExtendQuestionsRequest,
  ExtendQuestionsResponse,
  RefinePromptRequest,
  RefinePromptResponse
} from "@prompt-optimizer/shared"
import { BEFORE_SYSTEM_PROMPT, EXTEND_QUESTIONS_SYSTEM_PROMPT, REFINE_SYSTEM_PROMPT } from "@prompt-optimizer/shared"
import { callDeepSeekJson } from "./deepseek"
import { runtimeFlags } from "./env"
import { getPatternCache, setPatternCache } from "./repository"
import { trimForBudget } from "./cost-control"

async function callStructuredJson<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: { parse: (data: unknown) => T },
  maxTokens = 700
): Promise<T | null> {
  const raw = await callDeepSeekJson(systemPrompt, trimForBudget(userPrompt, 5000), maxTokens)
  if (!raw) return null
  return schema.parse(JSON.parse(raw))
}

function normalizeScore(value: unknown): "LOW" | "MID" | "HIGH" {
  if (value === "LOW" || value === "MID" || value === "HIGH") return value
  if (typeof value === "number") {
    if (value >= 8) return "HIGH"
    if (value >= 5) return "MID"
    return "LOW"
  }
  if (typeof value === "string") {
    const upper = value.toUpperCase()
    if (upper.includes("HIGH")) return "HIGH"
    if (upper.includes("MID") || upper.includes("MED")) return "MID"
  }
  return "MID"
}

function normalizeIntent(value: unknown, prompt: string) {
  if (typeof value === "string") {
    const upper = value.toUpperCase()
    const allowed = ["BUILD", "DEBUG", "REFACTOR", "DESIGN_UI", "EXPLAIN", "PLAN", "OTHER"] as const
    const direct = allowed.find((item) => item === upper)
    if (direct) return direct
    if (upper.includes("DEBUG") || upper.includes("FIX")) return "DEBUG"
    if (upper.includes("BUILD") || upper.includes("CREATE")) return "BUILD"
    if (upper.includes("REFACTOR")) return "REFACTOR"
    if (upper.includes("DESIGN") || upper.includes("UI")) return "DESIGN_UI"
    if (upper.includes("EXPLAIN")) return "EXPLAIN"
    if (upper.includes("PLAN")) return "PLAN"
  }
  return detectIntent(prompt)
}

function toStringArray(value: unknown, limit: number) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === "string" ? item : null))
    .filter(Boolean)
    .slice(0, limit) as string[]
}

function normalizeQuestions(value: unknown) {
  if (!Array.isArray(value)) return []

  return value
    .map((item, index) => {
      if (typeof item === "string") {
        return {
          id: `question_${index + 1}`,
          label: item,
          helper: "Choose the option that best matches your situation.",
          mode: "single" as const,
          options: ["Option 1", "Option 2"]
        }
      }

      if (!item || typeof item !== "object") return null
      const record = item as Record<string, unknown>
      const options = toStringArray(record.options, 6)
      if (options.length < 2) return null

      const mode = record.mode === "multi" ? "multi" : "single"
      const rawId = typeof record.id === "string" && record.id.trim() ? record.id : `question_${index + 1}`
      const id = rawId.toLowerCase().replace(/[^a-z0-9]+/g, "_")
      const label =
        typeof record.label === "string" && record.label.trim()
          ? record.label.trim()
          : typeof record.question === "string" && record.question.trim()
            ? record.question.trim()
            : null

      if (!label) return null

      return {
        id,
        label,
        helper:
          typeof record.helper === "string" && record.helper.trim()
            ? record.helper.trim()
            : "Choose the option that best matches your situation.",
        mode,
        options
      }
    })
    .filter(
      (
        question
      ): question is {
        id: string
        label: string
        helper: string
        mode: "single" | "multi"
        options: string[]
      } => Boolean(question)
    )
    .slice(0, 10)
}

function dedupeQuestions(questions: ReturnType<typeof normalizeQuestions>, existingQuestions: { id: string; label: string }[] = []) {
  const existingKeys = new Set(
    existingQuestions.flatMap((question) => [question.id.toLowerCase(), question.label.trim().toLowerCase()])
  )
  const seen = new Set<string>()

  return questions.filter((question) => {
    const questionKey = `${question.id}:${question.label}`.toLowerCase()
    const duplicate =
      seen.has(questionKey) ||
      existingKeys.has(question.id.toLowerCase()) ||
      existingKeys.has(question.label.trim().toLowerCase())

    if (duplicate) return false

    seen.add(questionKey)
    return true
  })
}

function buildPopupFollowUpQuestions(
  prompt: string,
  existingQuestions: { id: string; label: string }[],
  answers: Record<string, string | string[]>
) {
  const existingKeys = new Set(
    existingQuestions.flatMap((question) => [question.id.toLowerCase(), question.label.trim().toLowerCase()])
  )

  const hasAnswered = (questionId: string, matchers: RegExp[] = []) => {
    const value = answers[questionId]
    const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : []
    const joined = values.join(" ").toLowerCase()
    return values.length > 0 || matchers.some((pattern) => pattern.test(joined))
  }

  const candidates = [
    {
      id: "popup_screen_state",
      label: "Where does the popup fail on screen?",
      helper: "Pick the closest visible layout problem.",
      mode: "single" as const,
      options: ["Never appears anywhere", "Appears cut off", "Appears behind other UI", "Appears in the wrong place"],
      skip: () => hasAnswered("popup_failure_mode", [/off-screen|wrong place|nothing appears/])
    },
    {
      id: "popup_content_goal",
      label: "What should the popup show once it opens?",
      helper: "Choose the main content that should be visible.",
      mode: "single" as const,
      options: ["AI questions only", "Questions and generated prompt", "Generated prompt only", "A different flow"],
      skip: () => hasAnswered("popup_expected_flow", [/questions|generated prompt|replace/])
    },
    {
      id: "popup_blocking_step",
      label: "Which step is breaking the experience most?",
      helper: "Choose the part you want fixed first.",
      mode: "single" as const,
      options: ["Opening the popup", "Keeping the popup stable", "Generating the new prompt", "Replacing the Replit prompt"],
      skip: () => false
    },
    {
      id: "popup_success_signal",
      label: "What should count as a successful fix?",
      helper: "Choose the clearest outcome you want after the change.",
      mode: "single" as const,
      options: ["Popup opens in the right place", "Questions stay stable", "Generated prompt stays editable", "Full flow works end to end"],
      skip: () => false
    },
    {
      id: "popup_trigger_context",
      label: "When do you expect this flow to start?",
      helper: "Choose the entry point that should trigger it.",
      mode: "single" as const,
      options: ["After clicking the badge", "After typing in Replit", "After answering questions", "After clicking Generate"],
      skip: () => hasAnswered("popup_trigger", [/clicking the badge|typing|clicking generate/])
    }
  ]

  return candidates
    .filter((question) => !existingKeys.has(question.id) && !existingKeys.has(question.label.toLowerCase()) && !question.skip())
    .slice(0, 3)
}

function normalizeAnalyzeResponse(raw: unknown, prompt: string, fallback: ReturnType<typeof analyzePromptLocally>) {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const popupLike = /\bpopup\b|\bmodal\b|\bbadge\b|\bicon\b|\bprompt area\b|\bscreen\b/i.test(prompt)

  let questions = normalizeQuestions(record.clarification_questions)

  if (popupLike) {
    const popupSpecific = [
      {
        id: "popup_surface",
        label: "Which NoRetry UI are you referring to?",
        helper: "Pick the exact visible part that is failing.",
        mode: "single" as const,
        options: ["Centered popup modal", "Prompt-area badge/icon", "Issue banner", "Something else"]
      },
      {
        id: "popup_failure_mode",
        label: "What is the closest visible problem?",
        helper: "Choose the symptom you actually see.",
        mode: "single" as const,
        options: ["Nothing appears", "Appears off-screen", "Appears but content is wrong", "Appears but buttons do not work"]
      },
      {
        id: "popup_expected_flow",
        label: "What should the popup help you do?",
        helper: "Choose the parts of the flow that should happen there.",
        mode: "multi" as const,
        options: ["Ask clarifying questions", "Generate a better prompt", "Let me edit the new prompt", "Replace the prompt"]
      },
      {
        id: "popup_trigger",
        label: "When should it appear?",
        helper: "Choose how the flow should start.",
        mode: "single" as const,
        options: ["After clicking the badge", "Automatically after typing", "After clicking Complete", "Only after submit failures"]
      },
      {
        id: "popup_missing_detail",
        label: "Which missing detail matters most for the fix?",
        helper: "Choose the area the next prompt should clarify first.",
        mode: "single" as const,
        options: ["Exact screen/layout behavior", "Question flow and UX", "Button actions", "Prompt replacement behavior"]
      }
    ]

    const meaningfulQuestions = questions.filter(
      (question) => !/technology|framework|react|vue|jquery|vanilla/i.test(`${question.label} ${question.helper} ${question.options.join(" ")}`)
    )

    questions = meaningfulQuestions.length >= 3 ? meaningfulQuestions.slice(0, 4) : popupSpecific.slice(0, 4)
  }

  return AnalyzePromptResponseSchema.parse({
    score: normalizeScore(record.score),
    intent: normalizeIntent(record.intent, prompt),
    missing_elements: toStringArray(record.missing_elements, 4),
    suggestions: toStringArray(record.suggestions, 4),
    rewrite: typeof record.rewrite === "string" ? record.rewrite : fallback.rewrite,
    clarification_questions: questions,
    draft_prompt: typeof record.draft_prompt === "string" ? record.draft_prompt : fallback.draft_prompt,
    question_source: "AI",
    ai_available: true
  })
}

function normalizeRefineResponse(
  raw: unknown,
  fallback: RefinePromptResponse
): RefinePromptResponse {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}

  return RefinePromptResponseSchema.parse({
    improved_prompt:
      typeof record.improved_prompt === "string" && record.improved_prompt.trim()
        ? record.improved_prompt.trim()
        : typeof record.rewrite === "string" && record.rewrite.trim()
          ? record.rewrite.trim()
          : fallback.improved_prompt,
    notes: toStringArray(record.notes, 3).length ? toStringArray(record.notes, 3) : fallback.notes
  })
}

export async function runBeforeAnalysis(input: AnalyzePromptRequest) {
  const local = analyzePromptLocally(input.prompt, input.sessionSummary)
  if (runtimeFlags.useMocks) {
    return {
      ...local,
      clarification_questions: [],
      question_source: "FALLBACK",
      ai_available: false
    }
  }

  const llmRaw = await callStructuredJson(BEFORE_SYSTEM_PROMPT, buildBeforeUserPrompt(input.prompt, input.sessionSummary, input.surface), {
    parse: (data: unknown) => data
  }, 420)

  if (!llmRaw) {
    return {
      ...local,
      clarification_questions: [],
      question_source: "FALLBACK",
      ai_available: false
    }
  }

  const normalized = normalizeAnalyzeResponse(llmRaw, input.prompt, local)
  return {
    ...normalized,
    question_source: normalized.clarification_questions.length ? "AI" : "NONE",
    ai_available: true
  }
}

export async function runPromptRefinement(input: RefinePromptRequest): Promise<RefinePromptResponse> {
  const fallback = {
    improved_prompt: buildPromptFromAnswers(input.prompt, input.answers),
    notes: buildLocalRefineNotes(input.intent)
  } satisfies RefinePromptResponse

  if (runtimeFlags.useMocks) {
    return fallback
  }

  const llmRaw = await callStructuredJson(REFINE_SYSTEM_PROMPT, buildRefineUserPrompt(input), {
    parse: (data: unknown) => data
  }, 520)

  if (!llmRaw) return fallback

  return normalizeRefineResponse(llmRaw, fallback)
}

export async function runExtendQuestions(input: ExtendQuestionsRequest): Promise<ExtendQuestionsResponse> {
  if (runtimeFlags.useMocks) {
    return ExtendQuestionsResponseSchema.parse({
      clarification_questions: [],
      ai_available: false
    })
  }

  const llmRaw = await callStructuredJson(EXTEND_QUESTIONS_SYSTEM_PROMPT, buildExtendQuestionsUserPrompt(input), {
    parse: (data: unknown) => data
  }, 260)

  if (!llmRaw) {
    return ExtendQuestionsResponseSchema.parse({
      clarification_questions: [],
      ai_available: false
    })
  }

  const record = llmRaw && typeof llmRaw === "object" ? (llmRaw as Record<string, unknown>) : {}
  const popupLike = /\bpopup\b|\bmodal\b|\bbadge\b|\bicon\b|\bprompt area\b|\bscreen\b/i.test(input.prompt)
  const llmQuestions = dedupeQuestions(normalizeQuestions(record.clarification_questions), input.existing_questions)
  const strongQuestions = llmQuestions.filter(
    (question) => !/technology|framework|react|vue|jquery|vanilla|experience level|experience|general/i.test(
      `${question.label} ${question.helper} ${question.options.join(" ")}`
    )
  )

  const clarificationQuestions =
    popupLike && strongQuestions.length < 3
      ? buildPopupFollowUpQuestions(input.prompt, input.existing_questions, input.answers)
      : strongQuestions.slice(0, 3)

  return ExtendQuestionsResponseSchema.parse({
    clarification_questions: clarificationQuestions,
    ai_available: true
  })
}

export async function runFailureDiagnosis(input: DiagnoseFailureRequest): Promise<DiagnoseFailureResponse> {
  const patternKey = derivePatternKey(input)
  const cached = await getPatternCache(patternKey)
  if (cached && cached.usageCount >= 2) {
    return {
      ...cached.template,
      source_type: "CACHE",
      token_estimate: 0
    }
  }

  const fallback = {
    ...DEFAULT_PATTERN_TEMPLATES[patternKey],
    token_estimate: 0
  } satisfies DiagnoseFailureResponse

  if (runtimeFlags.useMocks) {
    await setPatternCache(patternKey, fallback)
    return fallback
  }

  const llmResult = await callStructuredJson(
    AFTER_SYSTEM_PROMPT,
    buildAfterUserPrompt(input),
    DiagnoseFailureResponseSchema
  )

  const result = llmResult
    ? {
        ...llmResult,
        source_type: "LLM" as const,
        token_estimate: 1200
      }
    : fallback

  await setPatternCache(patternKey, result)
  return result
}
