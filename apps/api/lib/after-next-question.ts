import {
  AfterNextQuestionResponseSchema,
  type AfterNextQuestionRequest
} from "@prompt-optimizer/shared"
import { callDeepSeekJson } from "./deepseek"
import { callKimiJson } from "./kimi"

function dedupe(items: string[], limit = 6) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, limit)
}

function buildFallbackQuestion(input: AfterNextQuestionRequest) {
  const askedIds = new Set(input.asked_questions.map((question) => question.id))
  const issue = input.analysis.issues[0] || input.analysis.findings[0] || "the flagged gap"
  const codeAnswer =
    input.analysis.response_summary.has_code_blocks || input.analysis.response_summary.mentioned_files.length > 0

  const candidates = [
    {
      id: "after_focus",
      label: "What should the next step focus on first?",
      helper: "Pick the highest-value direction for the next prompt.",
      mode: "single" as const,
      options: ["Fix the missing part", "Ask for proof", "Narrow the scope", "Improve the result"]
    },
    {
      id: "after_issue",
      label: `How should NoRetry handle this concern: ${issue}?`,
      helper: "Choose the best way to address the main issue.",
      mode: "single" as const,
      options: ["Fix it directly", "Validate it clearly", "Explain it briefly", "Keep it tightly scoped"]
    },
    {
      id: "after_format",
      label: "What format should the next answer use?",
      helper: "Choose the response style you want from the AI.",
      mode: "single" as const,
      options: codeAnswer
        ? ["Code only", "Code with short notes", "Patch-style answer", "Checklist and code"]
        : ["Short answer only", "Structured bullets", "Detailed but concise", "Final answer only"]
    },
    {
      id: "after_scope",
      label: "How tightly should the next prompt constrain the scope?",
      helper: "Keep the next step focused enough for the result you want.",
      mode: "single" as const,
      options: ["Very tight scope", "Moderately tight", "Allow one improvement", "Focus on validation only"]
    }
  ]

  const nextQuestion = candidates.find((question) => !askedIds.has(question.id)) ?? null
  return AfterNextQuestionResponseSchema.parse({
    question: nextQuestion,
    ai_available: false
  })
}

async function callStructuredJson(systemPrompt: string, userPrompt: string, maxTokens = 260) {
  const kimi = await callKimiJson(systemPrompt, userPrompt, maxTokens)
  if (kimi) return kimi
  return callDeepSeekJson(systemPrompt, userPrompt, maxTokens)
}

function buildPrompts(input: AfterNextQuestionRequest) {
  const qaPairs = input.asked_questions
    .map((question) => {
      const answer = input.answers[question.id]
      return answer ? `Q: ${question.label}\nA: ${answer}` : ""
    })
    .filter(Boolean)
    .slice(0, 6)

  const systemPrompt =
    "You generate exactly one useful follow-up clarification question for planning the user's next prompt after an AI answer review. Return JSON only with keys: question. The question must include id, label, helper, mode, and options. Use mode 'single'. Provide 3 or 4 concrete options. The next question must depend on the latest known answers and should narrow the next action, not ask generic repeated questions. Do not ask about topics already covered. Keep label under 110 characters and helper under 140 characters."

  const userPrompt = JSON.stringify({
    submitted_prompt: input.attempt.raw_prompt,
    task_type: input.attempt.intent.task_type,
    verdict_status: input.analysis.status,
    findings: input.analysis.findings,
    issues: input.analysis.issues,
    asked_questions: input.asked_questions.map((question) => question.label),
    answers_so_far: qaPairs,
    code_answer:
      input.analysis.response_summary.has_code_blocks || input.analysis.response_summary.mentioned_files.length > 0
  })

  return { systemPrompt, userPrompt }
}

export async function generateAfterNextQuestion(input: AfterNextQuestionRequest) {
  const { systemPrompt, userPrompt } = buildPrompts(input)

  try {
    const raw = await callStructuredJson(systemPrompt, userPrompt, 260)
    if (!raw) {
      return buildFallbackQuestion(input)
    }

    const parsed = JSON.parse(raw) as { question?: unknown }
    const normalizedQuestion =
      parsed.question && typeof parsed.question === "object"
        ? {
            ...(parsed.question as Record<string, unknown>),
            options: dedupe(
              [
                ...((((parsed.question as Record<string, unknown>).options as unknown[]) ?? []).filter(
                  (item): item is string => typeof item === "string"
                )),
                "Other"
              ],
              5
            )
          }
        : null

    return AfterNextQuestionResponseSchema.parse({
      question: normalizedQuestion,
      ai_available: true
    })
  } catch {
    return buildFallbackQuestion(input)
  }
}
