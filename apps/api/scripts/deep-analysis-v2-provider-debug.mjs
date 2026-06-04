import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const apiRoot = path.resolve(scriptDir, "..")
const repoRoot = path.resolve(apiRoot, "../..")

function loadLocalEnvFile(filePath) {
  if (!existsSync(filePath)) return
  const file = readFileSync(filePath, "utf8")
  for (const line of file.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const separatorIndex = trimmed.indexOf("=")
    if (separatorIndex === -1) continue
    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()
    if (!(key in process.env)) process.env[key] = value
  }
}

function redact(value) {
  if (!value) return ""
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function messageContentFromBody(bodyText) {
  const json = safeJsonParse(bodyText)
  const content = json?.choices?.[0]?.message?.content
  return typeof content === "string" ? content : ""
}

async function postChatCompletion({ label, url, apiKey, body }) {
  const startedAt = Date.now()
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    })
    const bodyText = await response.text()
    const content = messageContentFromBody(bodyText)
    return {
      label,
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      contentLength: content.length,
      contentPreview: content.slice(0, 500),
      rawPreview: bodyText.slice(0, 1200)
    }
  } catch (error) {
    return {
      label,
      ok: false,
      status: null,
      latencyMs: Date.now() - startedAt,
      contentLength: 0,
      contentPreview: "",
      rawPreview: error instanceof Error ? error.message : String(error)
    }
  }
}

async function main() {
  loadLocalEnvFile(path.resolve(repoRoot, ".env.local"))
  loadLocalEnvFile(path.resolve(apiRoot, ".env.local"))

  const deepSeekApiKey = process.env.DEEPSEEK_API_KEY ?? ""
  const deepSeekModel = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash"
  const kimiApiKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY || ""
  const kimiModel = process.env.KIMI_MODEL || process.env.MOONSHOT_MODEL || "kimi-k2.6"

  const system =
    'Compare the user prompt with the assistant answer. Return JSON only: {"verdict":"success|partial|wrong|unclear","score":0,"issues":[],"missing":[],"next_prompt":""}. No markdown. next_prompt is required and must be non-empty.'
  const user = JSON.stringify({
    userPrompt:
      "Act like Replit’s coding agent. Phase 1 is booking form UI only. Do not add backend or storage yet. Reply briefly with what changed, confirm completion, and suggest the next phase.",
    assistantAnswer:
      "Completed Phase 1: Booking Form UI. Added responsive layout, booking fields, validation states, submit button UI, and no backend/storage. Phase 1 is done. Next phase: add validation logic and booking confirmation flow."
  })

  console.log(
    JSON.stringify(
      {
        deepSeekModel,
        kimiModel,
        hasDeepSeekKey: Boolean(deepSeekApiKey),
        deepSeekKeyPreview: redact(deepSeekApiKey),
        hasKimiKey: Boolean(kimiApiKey),
        kimiKeyPreview: redact(kimiApiKey)
      },
      null,
      2
    )
  )

  const checks = []
  if (deepSeekApiKey) {
    checks.push(
      postChatCompletion({
        label: "deepseek_with_response_format",
        url: "https://api.deepseek.com/chat/completions",
        apiKey: deepSeekApiKey,
        body: {
          model: deepSeekModel,
          temperature: 0.1,
          max_tokens: 450,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user }
          ]
        }
      }),
      postChatCompletion({
        label: "deepseek_without_response_format",
        url: "https://api.deepseek.com/chat/completions",
        apiKey: deepSeekApiKey,
        body: {
          model: deepSeekModel,
          temperature: 0.1,
          max_tokens: 450,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user }
          ]
        }
      })
    )
  }

  if (kimiApiKey) {
    checks.push(
      postChatCompletion({
        label: "kimi_with_thinking_disabled",
        url: "https://api.moonshot.ai/v1/chat/completions",
        apiKey: kimiApiKey,
        body: {
          model: kimiModel,
          temperature: 0.6,
          max_tokens: 450,
          thinking: { type: "disabled" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user }
          ]
        }
      }),
      postChatCompletion({
        label: "kimi_without_thinking",
        url: "https://api.moonshot.ai/v1/chat/completions",
        apiKey: kimiApiKey,
        body: {
          model: kimiModel,
          temperature: 1,
          max_tokens: 450,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user }
          ]
        }
      })
    )
  }

  const results = await Promise.all(checks)
  console.log(JSON.stringify(results, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
