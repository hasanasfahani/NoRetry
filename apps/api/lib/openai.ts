import { env, runtimeFlags } from "./env"

type OpenAiResponsesResponse = {
  output_text?: string
  output?: Array<{
    type?: string
    content?: Array<{
      type?: string
      text?: string
    }>
  }>
}

type OpenAiJsonOptions = {
  temperature?: number
}

function readOpenAiResponseText(json: OpenAiResponsesResponse) {
  const directText = json.output_text?.trim()
  if (directText) return directText

  return json.output
    ?.flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && item.text)
    .map((item) => item.text?.trim() ?? "")
    .join("\n")
    .trim() ?? ""
}

export async function callOpenAiJson(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 700,
  signal?: AbortSignal,
  options?: OpenAiJsonOptions
) {
  if (runtimeFlags.useMocks || !env.OPENAI_API_KEY) return null

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      instructions: `${systemPrompt}\nReturn JSON only. Do not add markdown, comments, or explanation.`,
      input: userPrompt,
      temperature: options?.temperature ?? 0.1,
      max_output_tokens: maxTokens
    }),
    signal
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI request failed with ${response.status}: ${errorText}`)
  }

  const json = (await response.json()) as OpenAiResponsesResponse
  const text = readOpenAiResponseText(json)
  if (!text) return null

  return text.replace(/```(?:json)?|```/g, "").trim()
}

export async function callOpenAiText(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 700,
  signal?: AbortSignal,
  options?: OpenAiJsonOptions
) {
  if (runtimeFlags.useMocks || !env.OPENAI_API_KEY) return null

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      instructions: systemPrompt,
      input: userPrompt,
      temperature: options?.temperature ?? 0.2,
      max_output_tokens: maxTokens
    }),
    signal
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI request failed with ${response.status}: ${errorText}`)
  }

  const json = (await response.json()) as OpenAiResponsesResponse
  const text = readOpenAiResponseText(json)
  if (!text) return null

  return text.replace(/```(?:json)?|```/g, "").trim()
}
