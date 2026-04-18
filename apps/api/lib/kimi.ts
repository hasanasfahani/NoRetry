import { env, runtimeFlags } from "./env"

type KimiMessageResponse = {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

export async function callKimiJson(systemPrompt: string, userPrompt: string, maxTokens = 700) {
  if (runtimeFlags.useMocks || !env.KIMI_API_KEY) return null

  const response = await fetch("https://api.moonshot.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${env.KIMI_API_KEY}`
    },
    body: JSON.stringify({
      model: env.KIMI_MODEL,
      temperature: 0.2,
      max_tokens: maxTokens,
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
    throw new Error(`Kimi request failed with ${response.status}: ${errorText}`)
  }

  const json = (await response.json()) as KimiMessageResponse
  const text = json.choices?.[0]?.message?.content?.trim()
  if (!text) return null

  return text.replace(/```json|```/g, "").trim()
}

export async function callKimiText(systemPrompt: string, userPrompt: string, maxTokens = 700) {
  if (runtimeFlags.useMocks || !env.KIMI_API_KEY) return null

  const response = await fetch("https://api.moonshot.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${env.KIMI_API_KEY}`
    },
    body: JSON.stringify({
      model: env.KIMI_MODEL,
      temperature: 0.2,
      max_tokens: maxTokens,
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
    throw new Error(`Kimi request failed with ${response.status}: ${errorText}`)
  }

  const json = (await response.json()) as KimiMessageResponse
  const text = json.choices?.[0]?.message?.content?.trim()
  if (!text) return null

  return text.replace(/```(?:json)?|```/g, "").trim()
}
