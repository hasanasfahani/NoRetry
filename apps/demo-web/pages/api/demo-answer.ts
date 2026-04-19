import type { NextApiRequest, NextApiResponse } from "next"
import { callDeepSeekText } from "../../../api/lib/deepseek"
import { callKimiText } from "../../../api/lib/kimi"

function buildDemoAnswerSystemPrompt() {
  return [
    "You are reeva AI's demo answering assistant.",
    "Produce the best possible final answer to the user's request, not a sketch.",
    "Follow the user's goal, constraints, requested format, tone, and structure as closely as possible.",
    "If the user asks for a deliverable, return the deliverable itself directly.",
    "Do not use placeholders like [Company Name], [Budget], TBD, or TODO unless the user explicitly asked for a template.",
    "When the request is underspecified, make sensible concrete assumptions and keep moving instead of asking follow-up questions.",
    "Prefer complete, polished, useful output over vague summaries.",
    "Do not explain your reasoning unless the user asked for it.",
    "Do not mention internal systems, model names, APIs, or that this is a demo.",
    "Return only the answer content the user asked for."
  ].join(" ")
}

function computeMaxTokens(prompt: string) {
  const promptLength = prompt.trim().length
  if (promptLength > 3000) return 3400
  if (promptLength > 1800) return 2600
  if (promptLength > 900) return 1900
  return 1500
}

async function generateDemoAnswer(prompt: string) {
  const systemPrompt = buildDemoAnswerSystemPrompt()
  const maxTokens = computeMaxTokens(prompt)
  const providers = [
    () => callKimiText(systemPrompt, prompt, maxTokens),
    () => callDeepSeekText(systemPrompt, prompt, maxTokens)
  ]

  for (const callProvider of providers) {
    try {
      const answer = await callProvider()
      if (answer) return answer
    } catch {
      continue
    }
  }

  return null
}

export default async function handler(request: NextApiRequest, response: NextApiResponse) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST")
    return response.status(405).json({ error: "Method not allowed." })
  }

  const prompt = typeof request.body?.prompt === "string" ? request.body.prompt.trim() : ""

  if (!prompt) {
    return response.status(400).json({ error: "Prompt is required." })
  }

  try {
    const answer = await generateDemoAnswer(prompt)

    if (!answer) {
      return response.status(503).json({
        error: "AI answer generation is unavailable. Check the API configuration and mock-mode settings."
      })
    }

    return response.status(200).json({ answer })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate the answer."
    return response.status(502).json({ error: message })
  }
}
