import {
  AfterNextQuestionResponseSchema,
  type AfterNextQuestionRequest,
  type ClarificationQuestion
} from "@prompt-optimizer/shared"
import { callDeepSeekJson } from "./deepseek"
import { callKimiJson } from "./kimi"

function dedupe(items: string[], limit = 5) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, limit)
}

function mergeUniqueQuestions(existing: ClarificationQuestion[], incoming: ClarificationQuestion[]) {
  const seen = new Set(existing.map((question) => question.id))
  return incoming.filter((question) => !seen.has(question.id))
}

function fallbackQuestionBatch(input: AfterNextQuestionRequest) {
  const level = input.request_kind === "expand_level" ? input.current_level : input.current_level + (input.asked_questions.length ? 1 : 0)
  const issue = input.analysis.issues[0] || input.analysis.findings[0] || "the main gap"
  const codeAnswer =
    input.analysis.response_summary.has_code_blocks || input.analysis.response_summary.mentioned_files.length > 0
  const planningGoal = input.planning_goal.trim()

  const levelCandidates: Record<number, ClarificationQuestion[]> = {
    1: [
      {
        id: "after_goal_focus",
        label: "What should the next step accomplish first?",
        helper: "Pick the most important outcome for the very next prompt.",
        mode: "single",
        options: ["Fix the missing part", "Validate the result", "Tighten the scope", "Improve quality", "Other"]
      }
    ],
    2: [
      {
        id: "after_level2_style",
        label: "What kind of answer do you want next?",
        helper: "Choose the response style that will help you most.",
        mode: "single",
        options: codeAnswer
          ? ["Code only", "Minimal patch", "Code with short notes", "Proof plus code", "Other"]
          : ["Final answer only", "Short bullets", "Step-by-step", "Validate each requirement", "Other"]
      },
      {
        id: "after_level2_scope",
        label: planningGoal
          ? `How should the next prompt move toward: ${planningGoal}?`
          : `How should the next prompt handle ${issue}?`,
        helper: "Choose how tightly NoRetry should steer the next response.",
        mode: "single",
        options: ["Address it directly", "Ask for proof", "Keep scope very tight", "Retry cleanly", "Other"]
      }
    ],
    3: [
      {
        id: "after_level3_guardrail",
        label: "What guardrail matters most for the next prompt?",
        helper: "Pick the main constraint NoRetry should enforce.",
        mode: "single",
        options: ["No unrelated changes", "Keep it concise", "Explain the reasoning", "Validate before claiming success", "Other"]
      }
    ]
  }

  const candidates = levelCandidates[level] ?? [
    {
      id: `after_level${level}_finish`,
      label: "What should NoRetry optimize in the next prompt?",
      helper: "Choose the final steering direction for the next step.",
      mode: "single",
      options: ["Accuracy", "Speed", "Proof", "Scope control", "Other"]
    }
  ]

  const questions = mergeUniqueQuestions(input.asked_questions, candidates).slice(0, input.request_kind === "expand_level" ? 1 : 2)

  return AfterNextQuestionResponseSchema.parse({
    questions,
    next_level: level,
    ai_available: false
  })
}

async function callStructuredJson(systemPrompt: string, userPrompt: string, maxTokens = 420) {
  const kimi = await callKimiJson(systemPrompt, userPrompt, maxTokens)
  if (kimi) return kimi
  return callDeepSeekJson(systemPrompt, userPrompt, maxTokens)
}

function buildPrompts(input: AfterNextQuestionRequest) {
  const orderedQuestions = [...input.asked_questions].sort(
    (left, right) =>
      (input.question_levels[left.id] ?? 99) - (input.question_levels[right.id] ?? 99) ||
      input.asked_questions.findIndex((question) => question.id === left.id) -
        input.asked_questions.findIndex((question) => question.id === right.id)
  )
  const askedLabels = orderedQuestions.map((question) => question.label).slice(-8)
  const answerPairs = orderedQuestions
    .map((question) => {
      const answer = input.answers[question.id]
      if (!answer) return ""
      const level = input.question_levels[question.id] ?? 1
      return `L${level} | ${question.label}: ${answer}`
    })
    .filter(Boolean)
    .slice(-8)
  const branchSummary = answerPairs.length
    ? answerPairs.join("\n")
    : input.planning_goal
      ? `L1 planning goal: ${input.planning_goal}`
      : ""

  const targetLevel = input.request_kind === "expand_level" ? input.current_level : input.current_level + (input.asked_questions.length ? 1 : 0)
  const isCodeAnswer =
    input.analysis.response_summary.has_code_blocks || input.analysis.response_summary.mentioned_files.length > 0

  const systemPrompt =
    "You generate decision-tree follow-up questions for planning the user's next prompt after an AI answer review. Return JSON only with keys questions and next_level. questions must be an array of 1 to 2 objects for request_kind next_level, or exactly 1 object for request_kind expand_level. Each object must include id, label, helper, mode, and options. mode must be 'single'. Each question must directly build on the full answered path and stay in the same branch. Do not ask speculative failure questions unless the verdict or issues explicitly suggest a failure. Prefer narrowing the user's intended next action, proof standard, scope, or output format. Do not repeat asked topics. Keep label under 110 chars and helper under 140 chars. Always include 4 concrete options plus Other."

  const userPrompt = JSON.stringify({
    submitted_prompt: input.attempt.raw_prompt,
    planning_goal: input.planning_goal,
    task_type: input.attempt.intent.task_type,
    verdict_status: input.analysis.status,
    findings: input.analysis.findings.slice(0, 3),
    issues: input.analysis.issues.slice(0, 3),
    analysis_summary: input.analysis.findings[0] ?? "",
    addressed_criteria: input.analysis.stage_2.addressed_criteria.slice(0, 5),
    missing_criteria: input.analysis.stage_2.missing_criteria.slice(0, 5),
    review_depth: input.analysis.inspection_depth,
    code_answer: isCodeAnswer,
    current_level: input.current_level,
    request_kind: input.request_kind,
    target_level: targetLevel,
    asked_questions: askedLabels,
    answers_so_far: answerPairs,
    branch_summary: branchSummary
  })

  return { systemPrompt, userPrompt, targetLevel }
}

function normalizeQuestions(rawQuestions: unknown) {
  if (!Array.isArray(rawQuestions)) return []

  const normalized = rawQuestions
    .filter((question): question is Record<string, unknown> => Boolean(question) && typeof question === "object")
    .map((question) => {
      const id = typeof question.id === "string" ? question.id.trim() : ""
      const label = typeof question.label === "string" ? question.label.trim() : ""
      const helper = typeof question.helper === "string" ? question.helper.trim() : ""

      if (!id || !label || !helper) return null

      return {
        id,
        label,
        helper,
        mode: "single" as const,
        options: dedupe(
          [
            ...(((question.options as unknown[]) ?? []).filter((item): item is string => typeof item === "string")),
            "Other"
          ],
          5
        )
      }
    })
    .filter(Boolean)

  return normalized as ClarificationQuestion[]
}

export async function generateAfterNextQuestion(input: AfterNextQuestionRequest) {
  const { systemPrompt, userPrompt, targetLevel } = buildPrompts(input)

  try {
    const raw = await callStructuredJson(systemPrompt, userPrompt, 420)
    if (!raw) {
      return fallbackQuestionBatch(input)
    }

    const parsed = JSON.parse(raw) as { questions?: unknown; next_level?: unknown }
    const normalizedQuestions = normalizeQuestions(parsed.questions)
    const mergedQuestions = mergeUniqueQuestions(input.asked_questions, normalizedQuestions).slice(
      0,
      input.request_kind === "expand_level" ? 1 : 2
    )

    if (!mergedQuestions.length) {
      return fallbackQuestionBatch(input)
    }

    return AfterNextQuestionResponseSchema.parse({
      questions: mergedQuestions,
      next_level: typeof parsed.next_level === "number" ? parsed.next_level : targetLevel,
      ai_available: true
    })
  } catch {
    return fallbackQuestionBatch(input)
  }
}
