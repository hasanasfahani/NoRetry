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
const AFTER_CRITERION_LABEL_MAX = 240
const AFTER_PROJECT_CONTEXT_MAX = 4000
const AFTER_CURRENT_STATE_MAX = 3000
const AFTER_ERROR_SUMMARY_MAX = 300
const AFTER_CHANGED_FILE_MAX = 180
const AFTER_ARTIFACT_SOURCE_MAX = 80
const AFTER_ARTIFACT_SCOPE_MAX = 80
const AFTER_ARTIFACT_CONTENT_MAX = 12000

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

function limitText(value: string, maxLength: number) {
  const normalized = value.trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`
}

function sanitizeAfterPipelineRequest(input: AfterPipelineRequest): AfterPipelineRequest {
  const responseSummary = input.response_summary
  const artifactContext = input.artifact_context

  return {
    ...input,
    response_summary: {
      ...responseSummary,
      key_paragraphs: responseSummary.key_paragraphs.slice(0, 2),
      mentioned_files: responseSummary.mentioned_files.slice(0, 20),
      change_claims: responseSummary.change_claims.slice(0, 4),
      validation_signals: responseSummary.validation_signals.slice(0, 4),
      certainty_signals: responseSummary.certainty_signals.slice(0, 6),
      uncertainty_signals: responseSummary.uncertainty_signals.slice(0, 6),
      success_signals: responseSummary.success_signals.slice(0, 6),
      failure_signals: responseSummary.failure_signals.slice(0, 6)
    },
    baseline_acceptance_criteria: (input.baseline_acceptance_criteria ?? [])
      .map((item) => limitText(item, AFTER_CRITERION_LABEL_MAX))
      .slice(0, 6),
    baseline_acceptance_checklist: (input.baseline_acceptance_checklist ?? []).slice(0, 6).map((item) => ({
      ...item,
      label: limitText(item.label, AFTER_CRITERION_LABEL_MAX)
    })),
    baseline_review_contract:
      input.baseline_review_contract
        ? {
            ...input.baseline_review_contract,
            criteria: input.baseline_review_contract.criteria.slice(0, 6).map((item, index) => ({
              ...item,
              label: limitText(item.label, AFTER_CRITERION_LABEL_MAX),
              priority: Math.max(1, Math.min(item.priority || index + 1, 6))
            }))
          }
        : input.baseline_review_contract,
    project_context: limitText(input.project_context ?? "", AFTER_PROJECT_CONTEXT_MAX),
    current_state: limitText(input.current_state ?? "", AFTER_CURRENT_STATE_MAX),
    error_summary: input.error_summary ? limitText(input.error_summary, AFTER_ERROR_SUMMARY_MAX) : input.error_summary,
    changed_file_paths_summary: (input.changed_file_paths_summary ?? [])
      .map((item) => limitText(item, AFTER_CHANGED_FILE_MAX))
      .slice(0, 20),
    artifact_context:
      artifactContext
        ? {
            ...artifactContext,
            artifacts: artifactContext.artifacts.slice(0, 40).map((artifact) => ({
              ...artifact,
              source: limitText(artifact.source, AFTER_ARTIFACT_SOURCE_MAX),
              surface_scope: limitText(artifact.surface_scope ?? "", AFTER_ARTIFACT_SCOPE_MAX),
              content: limitText(artifact.content ?? "", AFTER_ARTIFACT_CONTENT_MAX)
            }))
          }
        : artifactContext
  }
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
  return post("/api/analyze-after", sanitizeAfterPipelineRequest(input), (value) => value as AfterPipelineResponse)
}

export async function generateAfterNextQuestion(input: AfterNextQuestionRequest): Promise<AfterNextQuestionResponse> {
  return post("/api/after-next-question", input, (value) => value as AfterNextQuestionResponse)
}
