import { env, runtimeFlags } from "./env"

type DeepSeekMessageResponse = {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

export async function callDeepSeekJson(systemPrompt: string, userPrompt: string, maxTokens = 700) {
  if (runtimeFlags.useMocks || !env.DEEPSEEK_API_KEY) return null

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: env.DEEPSEEK_MODEL,
      temperature: 0.2,
      max_tokens: maxTokens,
      response_format: {
        type: "json_object"
      },
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userPrompt
        }
      ]
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`DeepSeek request failed with ${response.status}: ${errorText}`)
  }

  const json = (await response.json()) as DeepSeekMessageResponse
  const text = json.choices?.[0]?.message?.content?.trim()
  if (!text) return null

  return text.replace(/```json|```/g, "").trim()
}
