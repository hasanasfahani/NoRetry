import { analyzePromptLocally } from "@prompt-optimizer/shared/src/analyzePrompt"
import { detectOutcomeLocally as detectOutcomeLocallyFromRules } from "@prompt-optimizer/shared/src/detection"
import {
  AnalyzeProjectPlanningRequestSchema,
  AnalyzeProjectPlanningResponseSchema,
  GenerateProjectPlanningDraftRequestSchema,
  GenerateProjectPlanningDraftResponseSchema,
  PROJECT_PLANNING_CLIENT_TIMEOUT_MS,
  PROJECT_PLANNING_DRAFT_CLIENT_TIMEOUT_MS,
  ProjectPlanningDiagnosticsSchema,
  type AnalyzeProjectPlanningRequest,
  type AnalyzeProjectPlanningResponse,
  type GenerateProjectPlanningDraftRequest,
  type GenerateProjectPlanningDraftResponse,
  type ProjectPlanningDiagnosticsPayload
} from "@prompt-optimizer/shared"
import {
  DEEP_ANALYSIS_V2_CLIENT_TIMEOUT_MS,
  DeepAnalysisV2RequestSchema,
  DeepAnalysisV2ResultSchema,
  type DeepAnalysisV2Request,
  type DeepAnalysisV2Result
} from "@prompt-optimizer/shared/src/deep-analysis-v2"
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
import type { NextMoveEvalCandidateRecord } from "./storage"

const analyzePromptFallback = analyzePromptLocally
const detectOutcomeFallback = detectOutcomeLocallyFromRules

const API_BASE = process.env.PLASMO_PUBLIC_API_BASE_URL || "https://noretry.vercel.app"
const USE_DIRECT_HOSTED_FETCH = API_BASE.startsWith("https://")
const REQUEST_TIMEOUT_MS = USE_DIRECT_HOSTED_FETCH ? 45000 : 8000
const PROJECT_PLANNING_TIMEOUT_MS = PROJECT_PLANNING_CLIENT_TIMEOUT_MS
const PROJECT_PLANNING_DRAFT_TIMEOUT_MS = PROJECT_PLANNING_DRAFT_CLIENT_TIMEOUT_MS
const DEEP_ANALYSIS_V2_TIMEOUT_MS = DEEP_ANALYSIS_V2_CLIENT_TIMEOUT_MS
const AFTER_CRITERION_LABEL_MAX = 240
const AFTER_PROJECT_CONTEXT_MAX = 4000
const AFTER_CURRENT_STATE_MAX = 3000
const AFTER_ERROR_SUMMARY_MAX = 300
const AFTER_CHANGED_FILE_MAX = 180
const AFTER_ARTIFACT_SOURCE_MAX = 80
const AFTER_ARTIFACT_SCOPE_MAX = 80
const AFTER_ARTIFACT_CONTENT_MAX = 12000
const ANALYTICS_CLIENT_ID_KEY = "reeva_analytics_client_id"

export type AnalyticsEventName =
  | "extension_opened"
  | "surface_detected"
  | "surface_unsupported"
  | "popup_closed"
  | "project_context_viewed"
  | "project_context_missing_shown"
  | "context_request_submitted"
  | "context_markdown_import_started"
  | "context_markdown_import_succeeded"
  | "context_markdown_import_failed"
  | "project_memory_available"
  | "project_planning_opened"
  | "project_planning_intake_started"
  | "project_planning_intake_completed"
  | "prd_generation_started"
  | "prd_generation_succeeded"
  | "prd_generation_failed"
  | "prd_generation_retried"
  | "prd_prompt_submitted"
  | "project_tracker_enabled"
  | "project_tracker_phase_started"
  | "project_tracker_phase_completed"
  | "project_tracker_completed"
  | "answer_analysis_opened"
  | "deep_analysis_started"
  | "deep_analysis_succeeded"
  | "deep_analysis_failed"
  | "deep_analysis_retried"
  | "deep_analysis_result_viewed"
  | "deep_analysis_next_prompt_generated"
  | "deep_analysis_next_prompt_submitted"
  | "testing_gate_shown"
  | "testing_gate_answered"
  | "testing_prompt_generated"
  | "testing_prompt_submitted"
  | "testing_completed_confirmed"
  | "next_move_opened"
  | "next_move_description_edited"
  | "next_move_path_selected"
  | "next_move_questions_started"
  | "next_move_questions_succeeded"
  | "next_move_questions_failed"
  | "next_move_questions_retried"
  | "next_move_question_answered"
  | "next_move_all_questions_answered"
  | "next_move_prompt_generation_started"
  | "next_move_prompt_generation_succeeded"
  | "next_move_prompt_generation_failed"
  | "next_move_prompt_submitted"
  | "prompt_copied"
  | "prompt_copy_failed"
  | "prompt_submit_started"
  | "prompt_submit_succeeded"
  | "prompt_submit_failed"
  | "prompt_written_to_composer"
  | "llm_request_started"
  | "llm_request_succeeded"
  | "llm_request_failed"
  | "llm_provider_attempted"
  | "llm_provider_failed"
  | "llm_json_repair_attempted"
  | "llm_json_repair_succeeded"
  | "llm_json_repair_failed"

export type AnalyticsEventParams = {
  surface?: "replit" | "chatgpt" | "lovable" | "unknown"
  feature_area?: "project_context" | "project_planning" | "deep_analysis" | "next_move" | "prompt_submit" | "reliability"
  status?: "started" | "success" | "failed" | "timeout"
  error_reason?: string
  duration_ms?: number
  provider_winner?: "openai" | "kimi" | "deepseek" | "none"
  provider_attempted?: "openai" | "kimi" | "deepseek"
  has_project_context?: boolean
  tracker_enabled?: boolean
  tracker_phase_index?: number
  next_move_path?: "small_feature" | "large_feature" | "bug_fix" | "small_change"
  question_count?: number
  answered_count?: number
  retry_count?: number
}

class ApiRequestError extends Error {
  status?: number
  payload: unknown

  constructor(message: string, status?: number, payload?: unknown) {
    super(message)
    this.name = "ApiRequestError"
    this.status = status
    this.payload = payload
  }
}

function parseErrorPayload(text: string) {
  if (!text.trim()) return null

  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function buildRequestError(prefix: string, status?: number, text = "") {
  const payload = parseErrorPayload(text)
  const messageFromPayload =
    payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : text

  return new ApiRequestError(
    `${prefix}${status ? ` with ${status}` : ""}${messageFromPayload ? `: ${messageFromPayload}` : ""}`,
    status,
    payload
  )
}

function toWellFormedJsonString(value: string) {
  let output = ""

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const nextCode = value.charCodeAt(index + 1)
      if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
        output += value[index] + value[index + 1]
        index += 1
      } else {
        output += "\uFFFD"
      }
      continue
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      output += "\uFFFD"
      continue
    }

    output += value[index]
  }

  return output
}

export function getProjectPlanningDiagnosticsFromError(error: unknown): ProjectPlanningDiagnosticsPayload | null {
  const payload = error instanceof ApiRequestError ? error.payload : null
  if (!payload || typeof payload !== "object" || !("diagnostics" in payload)) return null

  const parsed = ProjectPlanningDiagnosticsSchema.safeParse((payload as { diagnostics?: unknown }).diagnostics)
  return parsed.success ? parsed.data : null
}

function getApiBases() {
  const bases = [API_BASE]
  if (API_BASE.includes("localhost")) {
    bases.push(API_BASE.replace("localhost", "127.0.0.1"))
  }

  return [...new Set(bases)]
}

function sanitizeForJson(value: unknown): unknown {
  if (typeof value === "string") {
    return toWellFormedJsonString(value)
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

function getAnalyticsClientId() {
  try {
    const existing = window.localStorage.getItem(ANALYTICS_CLIENT_ID_KEY)
    if (existing) return existing
    const next = `reeva.${crypto.randomUUID()}`
    window.localStorage.setItem(ANALYTICS_CLIENT_ID_KEY, next)
    return next
  } catch {
    return `reeva.${crypto.randomUUID()}`
  }
}

async function postViaBackground<TInput, TOutput>(
  path: string,
  input: TInput,
  parseOutput: (value: unknown) => TOutput,
  options?: { timeoutMs?: number }
) {
  const serializedBody = serializeBody(input)
  const response = await new Promise<{ ok: boolean; status?: number; text?: string }>((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "PROMPT_OPTIMIZER_PROXY",
        path,
        body: serializedBody,
        timeoutMs: options?.timeoutMs
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
    throw buildRequestError("Background proxy failed", response?.status ?? 0, response?.text ?? "")
  }

  return parseOutput(JSON.parse(response.text ?? ""))
}

async function post<TInput, TOutput>(
  path: string,
  input: TInput,
  parseOutput: (value: unknown) => TOutput,
  options?: { timeoutMs?: number }
) {
  const serializedBody = serializeBody(input)
  const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS

  if (USE_DIRECT_HOSTED_FETCH) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(new Error("Request timed out")), timeoutMs)

    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: serializedBody,
        signal: controller.signal
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => "")
        throw buildRequestError("Request failed", response.status, errorText)
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
    return await postViaBackground(path, input, parseOutput, options)
  } catch (proxyError) {
    proxyFailure = proxyError instanceof Error ? proxyError.message : "Background proxy failed"
    if (proxyError instanceof ApiRequestError && proxyError.status && proxyError.status >= 400) {
      throw proxyError
    }
    let lastError: unknown = proxyError

    for (const base of getApiBases()) {
      try {
        const controller = new AbortController()
        const timeoutId = window.setTimeout(() => controller.abort(new Error("Request timed out")), timeoutMs)

        const response = await fetch(`${base}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: serializedBody,
          signal: controller.signal
        })

        window.clearTimeout(timeoutId)
        if (!response.ok) {
          const errorText = await response.text().catch(() => "")
          throw buildRequestError("Request failed", response.status, errorText)
        }

        return parseOutput(await response.json())
      } catch (error) {
        lastError = normalizeFetchError(error)
      }
    }

    if (lastError instanceof ApiRequestError) {
      throw lastError
    }

    const directFailure = lastError instanceof Error ? lastError.message : "Direct fetch failed"
    throw new Error(`${proxyFailure} | Direct fetch failed: ${directFailure}`)
  }
}

export async function analyzePromptRemote(input: AnalyzePromptRequest): Promise<AnalyzePromptResponse> {
  return post("/api/analyze-prompt", input, (value) => value as AnalyzePromptResponse)
}

export function trackAnalyticsEvent(name: AnalyticsEventName, params: AnalyticsEventParams = {}) {
  void post(
    "/api/analytics/event",
    {
      client_id: getAnalyticsClientId(),
      events: [{ name, params }]
    },
    (value) => value as { success: boolean; skipped?: boolean },
    { timeoutMs: 3000 }
  ).catch(() => null)
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

export async function interpretNextMovePrompt(input: {
  prompt: string
  answers: Record<string, string>
  taskType: string
}): Promise<{
  output: string | null
  ai_available: boolean
  provider: "openai" | "kimi" | "deepseek" | "none"
  attemptedProviders?: Array<{
    provider: "openai" | "kimi" | "deepseek"
    status: "success" | "empty" | "failed"
  }>
}> {
  return post(
    "/api/review/next-move-interpret",
    input,
    (value) =>
      value as {
        output: string | null
        ai_available: boolean
        provider: "openai" | "kimi" | "deepseek" | "none"
        attemptedProviders?: Array<{
          provider: "openai" | "kimi" | "deepseek"
          status: "success" | "empty" | "failed"
        }>
      },
    { timeoutMs: USE_DIRECT_HOSTED_FETCH ? 45000 : 30000 }
  )
}

export async function analyzeDeepAnalysisV2(input: DeepAnalysisV2Request): Promise<DeepAnalysisV2Result> {
  return post(
    "/api/review/deep-analysis-v2",
    DeepAnalysisV2RequestSchema.parse(input),
    (value) => DeepAnalysisV2ResultSchema.parse(value),
    { timeoutMs: DEEP_ANALYSIS_V2_TIMEOUT_MS }
  )
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

// Legacy/internal helper for the retired LLM-generated questionnaire flow.
// The normal Project Planning UI now sends intake fields straight to draft generation.
export async function analyzeProjectPlanning(input: AnalyzeProjectPlanningRequest): Promise<AnalyzeProjectPlanningResponse> {
  return post(
    "/api/project-planning/analyze",
    AnalyzeProjectPlanningRequestSchema.parse(input),
    (value) => AnalyzeProjectPlanningResponseSchema.parse(value),
    { timeoutMs: PROJECT_PLANNING_TIMEOUT_MS }
  )
}

export async function generateProjectPlanningDraft(
  input: GenerateProjectPlanningDraftRequest
): Promise<GenerateProjectPlanningDraftResponse> {
  return post(
    "/api/project-planning/draft",
    GenerateProjectPlanningDraftRequestSchema.parse(input),
    (value) => GenerateProjectPlanningDraftResponseSchema.parse(value),
    { timeoutMs: PROJECT_PLANNING_DRAFT_TIMEOUT_MS }
  )
}

export async function sendNextMoveEvalCandidates(input: { candidates: NextMoveEvalCandidateRecord[] }) {
  return post(
    "/api/admin/eval-candidates",
    {
      source: "extension",
      replace: false,
      candidates: input.candidates
    },
    (value) => value as { success: boolean; total: number; updatedAt: string },
    { timeoutMs: 8000 }
  )
}
