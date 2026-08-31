import * as z from "zod"
import { callDeepSeekJson } from "./deepseek"
import { runtimeFlags } from "./env"
import { callKimiJson } from "./kimi"
import { callOpenAiJson } from "./openai"
import { trimForBudget } from "./cost-control"

export const NextMoveInterpretationRequestSchema = z.object({
  prompt: z.string().min(1),
  answers: z.record(z.string()).default({}),
  taskType: z.string().default("creation")
})

export type NextMoveInterpretationRequest = z.infer<typeof NextMoveInterpretationRequestSchema>

export type NextMoveInterpretationResponse = {
  output: string | null
  ai_available: boolean
  provider: "openai" | "kimi" | "deepseek" | "none"
  attemptedProviders: Array<{
    provider: "openai" | "kimi" | "deepseek"
    status: "success" | "empty" | "failed"
  }>
}

const NEXT_MOVE_INTERPRETER_SYSTEM_PROMPT = [
  "You are a strict next-move intent interpreter.",
  "Return JSON only.",
  "Do not rewrite the user's prompt.",
  "Do not return markdown.",
  "Use the exact JSON shape requested in the user prompt."
].join("\n")

export async function runNextMoveInterpretation(
  input: NextMoveInterpretationRequest
): Promise<NextMoveInterpretationResponse> {
  if (runtimeFlags.useMocks) {
    return {
      output: null,
      ai_available: false,
      provider: "none",
      attemptedProviders: []
    }
  }

  const userPrompt = trimForBudget(
    [
      input.prompt,
      Object.keys(input.answers).length
        ? `Interpreter context:\n${JSON.stringify({
            taskType: input.taskType,
            answers: input.answers
          })}`
        : ""
    ]
      .filter(Boolean)
      .join("\n\n"),
    6500
  )

  const providers = [
    { name: "openai" as const, call: () => callOpenAiJson(NEXT_MOVE_INTERPRETER_SYSTEM_PROMPT, userPrompt, 520) },
    { name: "kimi" as const, call: () => callKimiJson(NEXT_MOVE_INTERPRETER_SYSTEM_PROMPT, userPrompt, 520) },
    { name: "deepseek" as const, call: () => callDeepSeekJson(NEXT_MOVE_INTERPRETER_SYSTEM_PROMPT, userPrompt, 520) }
  ]
  const attemptedProviders: NextMoveInterpretationResponse["attemptedProviders"] = []

  for (const provider of providers) {
    try {
      const output = await provider.call()
      if (!output) {
        attemptedProviders.push({
          provider: provider.name,
          status: "empty"
        })
        continue
      }
      attemptedProviders.push({
        provider: provider.name,
        status: "success"
      })
      return {
        output,
        ai_available: true,
        provider: provider.name,
        attemptedProviders
      }
    } catch {
      attemptedProviders.push({
        provider: provider.name,
        status: "failed"
      })
      continue
    }
  }

  return {
    output: null,
    ai_available: false,
    provider: "none",
    attemptedProviders
  }
}
