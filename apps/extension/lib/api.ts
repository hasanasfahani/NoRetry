import { analyzePromptLocally } from "@prompt-optimizer/shared/src/analyzePrompt"
import { detectOutcomeLocally as detectOutcomeLocallyFromRules } from "@prompt-optimizer/shared/src/detection"
import type {
  AnalyzePromptRequest,
  AnalyzePromptResponse,
  AfterNextQuestionRequest,
  AfterNextQuestionResponse,
  AfterPipelineRequest,
  AfterPipelineResponse,
  DetectOutcomeRequest,
  DetectOutcomeResponse,
  DiagnoseFailureRequest,
  DiagnoseFailureResponse,
  ExtendQuestionsRequest,
  ExtendQuestionsResponse,
  RefinePromptRequest,
  RefinePromptResponse
} from "@prompt-optimizer/shared/src/schemas"

const analyzePromptFallback = analyzePromptLocally
const detectOutcomeFallback = detectOutcomeLocallyFromRules

const API_BASE = process.env.PLASMO_PUBLIC_API_BASE_URL || "https://noretry.vercel.app"
const USE_DIRECT_HOSTED_FETCH = API_BASE.startsWith("https://")
const REQUEST_TIMEOUT_MS = USE_DIRECT_HOSTED_FETCH ? 45000 : 8000

function getApiBases() {
  const bases = [API_BASE]
  if (API_BASE.includes("localhost")) {
    bases.push(API_BASE.replace("localhost", "127.0.0.1"))
  }

  return [...new Set(bases)]
}

function sanitizeForJson(value: unknown): unknown {
  if (typeof value === "string") {
    return typeof value.toWellFormed === "function" ? value.toWellFormed() : value
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForJson(item))
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, sanitizeForJson(entry)])
    )
  }

  return value
}

function encodeBase64Utf8(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function serializeBody(input: unknown) {
  const json = JSON.stringify(sanitizeForJson(input))
  if (USE_DIRECT_HOSTED_FETCH) {
    return json
  }
  return JSON.stringify({
    __po_encoded_body: encodeBase64Utf8(json)
  })
}

function normalizeFetchError(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return new Error("The AI request timed out before the server responded.")
    }
    return error
  }

  return new Error("Request failed")
}

async function postViaBackground<TInput, TOutput>(
  path: string,
  input: TInput,
  parseOutput: (value: unknown) => TOutput
) {
  const serializedBody = serializeBody(input)
  const response = await new Promise<{ ok: boolean; status?: number; text?: string }>((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "PROMPT_OPTIMIZER_PROXY",
        path,
        body: serializedBody
      },
      (message) => {
        const runtimeError = chrome.runtime.lastError
        if (runtimeError) {
          reject(new Error(`Background proxy unavailable: ${runtimeError.message}`))
          return
        }

        if (!message) {
          reject(new Error("Background proxy unavailable: empty response"))
          return
        }

        resolve(message)
      }
    )
  })

  if (!response?.ok) {
    throw new Error(`Background proxy failed with ${response?.status ?? 0}${response?.text ? `: ${response.text}` : ""}`)
  }

  return parseOutput(JSON.parse(response.text))
}

async function post<TInput, TOutput>(
  path: string,
  input: TInput,
  parseOutput: (value: unknown) => TOutput
) {
  const serializedBody = serializeBody(input)

  if (USE_DIRECT_HOSTED_FETCH) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: serializedBody,
        signal: controller.signal
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => "")
        throw new Error(`Request failed with ${response.status}${errorText ? `: ${errorText}` : ""}`)
      }

      return parseOutput(await response.json())
    } catch (error) {
      throw normalizeFetchError(error)
    } finally {
      window.clearTimeout(timeoutId)
    }
  }

  let proxyFailure = ""
  try {
    return await postViaBackground(path, input, parseOutput)
  } catch (proxyError) {
    proxyFailure = proxyError instanceof Error ? proxyError.message : "Background proxy failed"
    let lastError: unknown = proxyError

    for (const base of getApiBases()) {
      try {
        const controller = new AbortController()
        const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

        const response = await fetch(`${base}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: serializedBody,
          signal: controller.signal
        })

        window.clearTimeout(timeoutId)
        if (!response.ok) {
          const errorText = await response.text().catch(() => "")
          throw new Error(`Request failed with ${response.status}${errorText ? `: ${errorText}` : ""}`)
        }

        return parseOutput(await response.json())
      } catch (error) {
        lastError = normalizeFetchError(error)
      }
    }

    const directFailure = lastError instanceof Error ? lastError.message : "Direct fetch failed"
    throw new Error(`${proxyFailure} | Direct fetch failed: ${directFailure}`)
  }
}

export async function analyzePromptRemote(input: AnalyzePromptRequest): Promise<AnalyzePromptResponse> {
  return post("/api/analyze-prompt", input, (value) => value as AnalyzePromptResponse)
}

export async function analyzePrompt(input: AnalyzePromptRequest): Promise<AnalyzePromptResponse> {
  try {
    return await analyzePromptRemote(input)
  } catch {
    return analyzePromptFallback(input.prompt, input.sessionSummary)
  }
}

export async function detectOutcome(input: DetectOutcomeRequest): Promise<DetectOutcomeResponse> {
  try {
    return await post("/api/detect-outcome", input, (value) => value as DetectOutcomeResponse)
  } catch {
    return {
      ...detectOutcomeFallback(input),
      outcome_event_id: crypto.randomUUID()
    }
  }
}

export async function diagnoseFailure(input: DiagnoseFailureRequest): Promise<DiagnoseFailureResponse> {
  return post("/api/diagnose-failure", input, (value) => value as DiagnoseFailureResponse)
}

export async function refinePrompt(input: RefinePromptRequest): Promise<RefinePromptResponse> {
  return post("/api/refine-prompt", input, (value) => value as RefinePromptResponse)
}

export async function extendQuestions(input: ExtendQuestionsRequest): Promise<ExtendQuestionsResponse> {
  return post("/api/extend-questions", input, (value) => value as ExtendQuestionsResponse)
}

export async function sendFeedback(outcomeEventId: string, feedbackType: "WORKED" | "DID_NOT_WORK") {
  try {
    await post("/api/feedback", { outcome_event_id: outcomeEventId, feedback_type: feedbackType }, (value) => value as { success: boolean })
  } catch {
    return null
  }
}

export async function analyzeAfterAttempt(input: AfterPipelineRequest): Promise<AfterPipelineResponse> {
  return post("/api/analyze-after", input, (value) => value as AfterPipelineResponse)
}

export async function generateAfterNextQuestion(input: AfterNextQuestionRequest): Promise<AfterNextQuestionResponse> {
  return post("/api/after-next-question", input, (value) => value as AfterNextQuestionResponse)
}
