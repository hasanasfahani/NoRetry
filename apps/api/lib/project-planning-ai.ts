import {
  GenerateProjectPlanningDraftResponseSchema,
  PROJECT_PLANNING_DRAFT_PROVIDER_TIMEOUT_MS,
  PROJECT_PLANNING_PROVIDER_TIMEOUT_MS,
  ProjectPlanningPrdSectionStatusSchema,
  ProjectPlanningPrdSnapshotSchema,
  ProjectPlanningQuestionSchema,
  ProjectPlanningSectionKeySchema,
  type AnalyzeProjectPlanningRequest,
  type AnalyzeProjectPlanningResponse,
  type GeneratedPrdDraftPayload,
  type GenerateProjectPlanningDraftRequest,
  type GenerateProjectPlanningDraftResponse,
  type ProjectPlanningCoverageReportPayload,
  type ProjectPlanningCriteriaBucketPayload,
  type ProjectPlanningCriteriaKey,
  type ProjectPlanningCriteriaStatus,
  type ProjectPlanningDiagnosticsPayload,
  type ProjectPlanningPrdSnapshotPayload,
  type ProjectPlanningSectionKey,
  type ProjectPlanningQuestionPayload
} from "@prompt-optimizer/shared"
import * as z from "zod"
import { callDeepSeekJson } from "./deepseek"
import { callKimiJson } from "./kimi"
import { env } from "./env"

type ProjectPlanningOutputQualityStatus = ProjectPlanningDiagnosticsPayload["outputQualityStatus"]
type ProjectPlanningProviderAttempt = NonNullable<ProjectPlanningDiagnosticsPayload["providerAttempts"]>[number]
type ProjectPlanningProvider = {
  name: "Kimi" | "DeepSeek"
  configured: boolean
  call: (signal: AbortSignal) => Promise<string | null>
  repairJson?: (input: { raw: string; schemaDescription: string; signal: AbortSignal }) => Promise<string | null>
}
type ProjectPlanningRetryError = Error & { retryCount?: number }
type ProjectPlanningPromptKind = NonNullable<ProjectPlanningDiagnosticsPayload["promptKind"]>
type ProjectPlanningRequestMetadata = Pick<
  ProjectPlanningDiagnosticsPayload,
  "descriptionPreview" | "descriptionHash" | "projectLabel" | "promptKind"
>
type ProjectPlanningJsonParseResult = {
  data: unknown
  malformedJson: boolean
  repairAttempted: boolean
  repairSucceeded: boolean
}

const PROJECT_PLANNING_PROVIDER_MAX_ATTEMPTS = 2
const PROJECT_PLANNING_RETRY_DELAY_MS = 350
const PROJECT_PLANNING_ANALYSIS_MAX_TOKENS = 480
const PROJECT_PLANNING_DRAFT_MAX_TOKENS = 1_100
const PROJECT_PLANNING_REPAIR_MAX_TOKENS = 700
const PROJECT_PLANNING_REPAIR_MIN_REMAINING_MS = 1_500

export class ProjectPlanningAiError extends Error {
  diagnostics: ProjectPlanningDiagnosticsPayload

  constructor(message: string, diagnostics: ProjectPlanningDiagnosticsPayload) {
    super(message)
    this.name = "ProjectPlanningAiError"
    this.diagnostics = diagnostics
  }
}

class ProjectPlanningMalformedJsonError extends Error {
  repairAttempted: boolean
  repairSucceeded: boolean

  constructor(message = "Model response contained malformed JSON") {
    super(message)
    this.name = "ProjectPlanningMalformedJsonError"
    this.repairAttempted = false
    this.repairSucceeded = false
  }
}

function getJsonRepairMetadata(error: unknown) {
  return error instanceof ProjectPlanningMalformedJsonError
    ? {
        malformedJson: true,
        repairAttempted: error.repairAttempted,
        repairSucceeded: error.repairSucceeded
      }
    : {
        malformedJson: false,
        repairAttempted: false,
        repairSucceeded: false
      }
}

function buildJsonRepairPrompt(schemaDescription: string, raw: string) {
  return [
    "Convert the following content into valid JSON matching this schema.",
    "Return JSON only. Do not add markdown, comments, or explanation.",
    "",
    "Schema:",
    schemaDescription,
    "",
    "Content:",
    raw.slice(0, 8000)
  ].join("\n")
}

function hashProjectPlanningDescription(description: string) {
  let hash = 5381
  for (let index = 0; index < description.length; index += 1) {
    hash = ((hash << 5) + hash) ^ description.charCodeAt(index)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

function buildProjectPlanningRequestMetadata(input: {
  description: string
  projectLabel: string
  promptKind: ProjectPlanningPromptKind
}): ProjectPlanningRequestMetadata {
  const normalizedDescription = input.description.replace(/\s+/g, " ").trim()

  return {
    descriptionPreview: normalizedDescription.slice(0, 80),
    descriptionHash: hashProjectPlanningDescription(input.description),
    projectLabel: input.projectLabel,
    promptKind: input.promptKind
  }
}

function createPlanningDiagnostics(input: {
  aiAvailable: boolean
  fallbackUsed?: boolean
  providerName: string | null
  durationMs: number
  metadata?: ProjectPlanningRequestMetadata
  malformedJson?: boolean
  repairAttempted?: boolean
  repairSucceeded?: boolean
  errorReason?: string
  outputQualityStatus: ProjectPlanningOutputQualityStatus
  providerAttempts?: ProjectPlanningProviderAttempt[]
}): ProjectPlanningDiagnosticsPayload {
  return {
    aiAvailable: input.aiAvailable,
    fallbackUsed: input.fallbackUsed ?? false,
    providerName: input.providerName,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    descriptionPreview: input.metadata?.descriptionPreview,
    descriptionHash: input.metadata?.descriptionHash,
    projectLabel: input.metadata?.projectLabel,
    promptKind: input.metadata?.promptKind,
    malformedJson: input.malformedJson,
    repairAttempted: input.repairAttempted,
    repairSucceeded: input.repairSucceeded,
    errorReason: input.errorReason,
    outputQualityStatus: input.outputQualityStatus,
    providerAttempts: input.providerAttempts
  }
}

function selectProjectPlanningProvider(input: {
  provider: "kimi" | "deepseek"
  hasKimiApiKey: boolean
  hasDeepSeekApiKey: boolean
  systemPrompt: string
  userPrompt: string
  maxTokens: number
}): ProjectPlanningProvider {
  if (input.provider === "deepseek") {
    return {
      name: "DeepSeek",
      configured: input.hasDeepSeekApiKey,
      call: (signal: AbortSignal) =>
        callDeepSeekJson(input.systemPrompt, input.userPrompt, input.maxTokens, signal, { responseFormatJson: true }),
      repairJson: ({ raw, schemaDescription, signal }) =>
        callDeepSeekJson(
          "Convert malformed content into valid JSON only.",
          buildJsonRepairPrompt(schemaDescription, raw),
          PROJECT_PLANNING_REPAIR_MAX_TOKENS,
          signal,
          { responseFormatJson: true }
        )
    }
  }

  return {
    name: "Kimi",
    configured: input.hasKimiApiKey,
    call: (signal: AbortSignal) =>
      callKimiJson(input.systemPrompt, input.userPrompt, input.maxTokens, signal, { responseFormatJson: true }),
    repairJson: ({ raw, schemaDescription, signal }) =>
      callKimiJson(
        "Convert malformed content into valid JSON only.",
        buildJsonRepairPrompt(schemaDescription, raw),
        PROJECT_PLANNING_REPAIR_MAX_TOKENS,
        signal,
        { responseFormatJson: true }
      )
  }
}

function buildProjectPlanningRaceProviders(input: {
  hasKimiApiKey: boolean
  hasDeepSeekApiKey: boolean
  systemPrompt: string
  userPrompt: string
  maxTokens: number
}): ProjectPlanningProvider[] {
  const providers: ProjectPlanningProvider[] = []

  if (input.hasKimiApiKey) {
    providers.push({
      name: "Kimi",
      configured: true,
      call: (signal: AbortSignal) =>
        callKimiJson(input.systemPrompt, input.userPrompt, input.maxTokens, signal, { responseFormatJson: true }),
      repairJson: ({ raw, schemaDescription, signal }) =>
        callKimiJson(
          "Convert malformed content into valid JSON only.",
          buildJsonRepairPrompt(schemaDescription, raw),
          PROJECT_PLANNING_REPAIR_MAX_TOKENS,
          signal,
          { responseFormatJson: true }
        )
    })
  }

  if (input.hasDeepSeekApiKey) {
    providers.push({
      name: "DeepSeek",
      configured: true,
      call: (signal: AbortSignal) =>
        callDeepSeekJson(input.systemPrompt, input.userPrompt, input.maxTokens, signal, { responseFormatJson: true }),
      repairJson: ({ raw, schemaDescription, signal }) =>
        callDeepSeekJson(
          "Convert malformed content into valid JSON only.",
          buildJsonRepairPrompt(schemaDescription, raw),
          PROJECT_PLANNING_REPAIR_MAX_TOKENS,
          signal,
          { responseFormatJson: true }
        )
    })
  }

  return providers
}

const QUESTIONNAIRE_GENERIC_PHRASES = [
  "who is this first version mainly for",
  "what should we intentionally leave out of the first release",
  "what would make this first release feel clearly successful",
  "what build constraints should this first version respect",
  "the core flow works end to end",
  "the experience feels simple and clear",
  "keep the stack simple and easy to build",
  "avoid paid services or keep costs very low",
  "prefer web first",
  "no advanced analytics",
  "no admin dashboard"
]

const PRD_BANNED_PLACEHOLDER_PHRASES = [
  "core user pain",
  "main workflow",
  "planning brief",
  "first release should focus on the main user",
  "build the must-have flows and product behaviors",
  "deliver a first version that solves the main problem",
  "narrowest complete version needed to deliver the core value",
  "respect the current product boundaries",
  "the first release should work end to end",
  "generic fallback",
  "lightweight fallback"
]

const GENERIC_PHASE_PHRASES = [
  "core setup",
  "core foundation",
  "main experience",
  "main user flow",
  "validation and proof",
  "validation and finish",
  "set up the core structure",
  "build the primary user-facing flow",
  "tighten the experience"
]

const SNAPSHOT_PLACEHOLDER_PHRASES = [
  "none specified",
  "not specified",
  "not provided",
  "needs clarification",
  "still needs clarification",
  "n/a"
]

const DESCRIPTION_STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "allow",
  "already",
  "build",
  "could",
  "create",
  "first",
  "from",
  "have",
  "help",
  "into",
  "main",
  "make",
  "need",
  "needs",
  "only",
  "product",
  "project",
  "should",
  "simple",
  "that",
  "their",
  "them",
  "this",
  "user",
  "users",
  "version",
  "want",
  "with"
])

function parseLooseJson(raw: string): unknown {
  const cleaned = raw.trim()

  try {
    const parsed = JSON.parse(cleaned)
    if (typeof parsed === "string" && looksLikeJson(parsed)) {
      return parseLooseJson(parsed)
    }
    return parsed
  } catch {
    const startCandidates = [cleaned.indexOf("{"), cleaned.indexOf("[")].filter((index) => index >= 0)
    const start = startCandidates.length ? Math.min(...startCandidates) : -1
    if (start === -1) {
      throw new ProjectPlanningMalformedJsonError("Model response did not contain JSON")
    }

    for (let end = cleaned.length; end > start; end -= 1) {
      const slice = cleaned.slice(start, end).trim()
      if (!slice) continue

      try {
        return JSON.parse(slice)
      } catch {
        continue
      }
    }

    const repaired = repairLooseJsonText(cleaned, start)
    if (repaired) {
      try {
        return JSON.parse(repaired)
      } catch {
        // Keep the public error stable below.
      }
    }

    throw new ProjectPlanningMalformedJsonError()
  }
}

function looksLikeJson(value: string) {
  const trimmed = value.trim()
  return trimmed.startsWith("{") || trimmed.startsWith("[")
}

function repairLooseJsonText(raw: string, start: number) {
  const candidate = raw
    .slice(start)
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim()

  if (!candidate) return null

  const repaired = candidate
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
    .trim()

  return repaired || null
}

async function parseProjectPlanningJsonWithRepair(input: {
  raw: string
  provider: ProjectPlanningProvider
  schemaDescription: string
  signal: AbortSignal
  startedAt: number
  timeoutMs: number
}): Promise<ProjectPlanningJsonParseResult> {
  try {
    return {
      data: parseLooseJson(input.raw),
      malformedJson: false,
      repairAttempted: false,
      repairSucceeded: false
    }
  } catch (error) {
    if (!(error instanceof ProjectPlanningMalformedJsonError)) {
      throw error
    }

    const elapsedMs = Date.now() - input.startedAt
    const remainingMs = input.timeoutMs - elapsedMs
    if (!input.provider.repairJson || remainingMs < PROJECT_PLANNING_REPAIR_MIN_REMAINING_MS || input.signal.aborted) {
      throw error
    }

    try {
      const repairedRaw = await input.provider.repairJson({
        raw: input.raw,
        schemaDescription: input.schemaDescription,
        signal: input.signal
      })
      if (!repairedRaw) {
        throw new ProjectPlanningMalformedJsonError("JSON repair returned an empty response")
      }

      return {
        data: parseLooseJson(repairedRaw),
        malformedJson: true,
        repairAttempted: true,
        repairSucceeded: true
      }
    } catch (repairError) {
      const malformedError =
        repairError instanceof ProjectPlanningMalformedJsonError
          ? repairError
          : new ProjectPlanningMalformedJsonError(
              repairError instanceof Error ? repairError.message : "JSON repair failed"
            )
      malformedError.repairAttempted = true
      malformedError.repairSucceeded = false
      throw malformedError
    }
  }
}

function isRecoverableProjectPlanningError(error: unknown) {
  if (!(error instanceof Error)) return true
  const message = error.message.toLowerCase()

  if (message.includes("401") || message.includes("403") || message.includes("unauthorized")) return false
  if (message.includes("invalid api key") || message.includes("bad request")) return false
  if (message.includes("safety") || message.includes("refusal")) return false

  return (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("network") ||
    message.includes("fetch failed") ||
    message.includes("empty response") ||
    /\b5\d\d\b/.test(message)
  )
}

function delayWithAbort(ms: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(new Error("aborted"))

  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", abort)
      resolve()
    }, ms)

    function abort() {
      clearTimeout(timeoutId)
      reject(new Error("aborted"))
    }

    signal.addEventListener("abort", abort, { once: true })
  })
}

async function callProviderWithOneRetry(provider: ProjectPlanningProvider, signal: AbortSignal) {
  let lastError: unknown = null
  let retryCount = 0

  for (let attempt = 1; attempt <= PROJECT_PLANNING_PROVIDER_MAX_ATTEMPTS; attempt += 1) {
    try {
      const raw = await provider.call(signal)
      if (!raw) {
        throw new Error(`${provider.name} returned an empty response.`)
      }
      return { raw, retryCount }
    } catch (error) {
      lastError = error
      if (signal.aborted || attempt >= PROJECT_PLANNING_PROVIDER_MAX_ATTEMPTS) break
      if (!isRecoverableProjectPlanningError(error)) break

      retryCount += 1
      await delayWithAbort(PROJECT_PLANNING_RETRY_DELAY_MS, signal)
    }
  }

  const error: ProjectPlanningRetryError =
    lastError instanceof Error ? lastError : new Error(`${provider.name} planning request failed.`)
  error.retryCount = retryCount
  throw error
}

function getRetryCountFromError(error: unknown) {
  return error instanceof Error && typeof (error as ProjectPlanningRetryError).retryCount === "number"
    ? (error as ProjectPlanningRetryError).retryCount
    : 0
}

function normalizeTextForQuality(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function extractDescriptionTerms(description: string) {
  const seen = new Set<string>()
  const terms: string[] = []

  for (const term of normalizeTextForQuality(description).split(/\s+/)) {
    if (term.length < 4 || DESCRIPTION_STOP_WORDS.has(term) || seen.has(term)) continue
    seen.add(term)
    terms.push(term)
  }

  return terms.slice(0, 12)
}

function questionText(question: ProjectPlanningQuestionPayload) {
  return [question.label, question.helper, ...(question.options ?? [])].join(" ")
}

function validateQuestionnaireSpecificity(input: {
  description: string
  questions: ProjectPlanningQuestionPayload[]
  groundingText?: string
}) {
  const questions = input.questions
  if (!questions.length && input.description.trim().length < 500) {
    return "The questionnaire did not ask any missing-information questions for a brief project idea."
  }

  if (questions.length < 2 && input.description.trim().length < 500) {
    return "The questionnaire did not ask enough missing-information questions for a brief project idea."
  }

  const combinedText = normalizeTextForQuality([
    questions.map(questionText).join(" "),
    input.groundingText ?? ""
  ].join(" "))
  const genericMatches = QUESTIONNAIRE_GENERIC_PHRASES.filter((phrase) =>
    combinedText.includes(normalizeTextForQuality(phrase))
  )

  if (genericMatches.length >= 2) {
    return "The questionnaire was too generic and looked like a fallback template."
  }

  const descriptionTerms = extractDescriptionTerms(input.description)
  if (descriptionTerms.length >= 2) {
    const matchedTerms = descriptionTerms.filter((term) => combinedText.includes(term))
    if (matchedTerms.length === 0) {
      return "The questionnaire did not reflect concrete terms from the project description."
    }
  }

  return null
}

function snapshotSectionText(snapshot: ProjectPlanningPrdSnapshotPayload) {
  return CRITERIA_ORDER
    .map((key) => {
      const section = snapshot[key]
      return [key, section.status, section.draft, ...section.missing].join(" ")
    })
    .join(" ")
}

function validatePrdSnapshotSpecificity(input: {
  description: string
  snapshot: ProjectPlanningPrdSnapshotPayload
}) {
  const meaningfulSections = CRITERIA_ORDER.filter((key) => {
    const section = input.snapshot[key]
    return section.status !== "missing" && Boolean(section.draft.trim())
  })

  if (!meaningfulSections.length) {
    return "The PRD snapshot did not fill or partially fill any section from the project description."
  }

  const combinedSnapshotText = normalizeTextForQuality(snapshotSectionText(input.snapshot))
  const placeholderPhrase = [...PRD_BANNED_PLACEHOLDER_PHRASES, ...SNAPSHOT_PLACEHOLDER_PHRASES]
    .filter((phrase) => normalizeTextForQuality(phrase).length > 3)
    .find((phrase) => combinedSnapshotText.includes(normalizeTextForQuality(phrase)))

  if (placeholderPhrase) {
    return `The PRD snapshot used placeholder language: "${placeholderPhrase}".`
  }

  const descriptionTerms = extractDescriptionTerms(input.description)
  if (descriptionTerms.length >= 2) {
    const matchedTerms = descriptionTerms.filter((term) => combinedSnapshotText.includes(term))
    if (matchedTerms.length === 0) {
      return "The PRD snapshot did not reflect concrete terms from the project description."
    }
  }

  return null
}

function draftSectionText(draft: GeneratedPrdDraftPayload) {
  return draft.sections.map((section) => `${section.title}\n${section.body}`).join("\n\n")
}

function draftPhaseText(draft: GeneratedPrdDraftPayload) {
  return draft.implementationPhases
    .map((phase) =>
      [
        phase.title,
        phase.goal,
        ...phase.deliverables,
        ...phase.acceptanceCriteria
      ].join(" ")
    )
    .join(" ")
}

function validatePrdSpecificity(input: {
  description: string
  resolvedDraftInputs: ReturnType<typeof buildResolvedDraftInputs>
  draft: GeneratedPrdDraftPayload
}) {
  const malformedPhase = input.draft.implementationPhases.find(
    (phase) =>
      !phase.title.trim() ||
      !phase.goal.trim() ||
      phase.deliverables.length === 0 ||
      phase.acceptanceCriteria.length === 0
  )

  if (malformedPhase) {
    return "The PRD implementation phases were incomplete or malformed."
  }

  const combinedDraftText = normalizeTextForQuality([
    draftSectionText(input.draft),
    draftPhaseText(input.draft),
    input.draft.summary
  ].join(" "))
  const bannedPhrase = PRD_BANNED_PLACEHOLDER_PHRASES.find((phrase) =>
    combinedDraftText.includes(normalizeTextForQuality(phrase))
  )

  if (bannedPhrase) {
    return `The PRD used placeholder language: "${bannedPhrase}".`
  }

  const descriptionTerms = extractDescriptionTerms(input.description)
  if (descriptionTerms.length >= 2) {
    const matchedTerms = descriptionTerms.filter((term) => combinedDraftText.includes(term))
    if (matchedTerms.length === 0) {
      return "The PRD did not preserve concrete terms from the original project description."
    }
  }

  const answerTerms = extractDescriptionTerms(
    input.resolvedDraftInputs.clarifiedAnswers
      .map((answer) => stringifyDraftAnswerValue(answer.resolvedAnswer))
      .filter(Boolean)
      .join(" ")
  )

  if (answerTerms.length >= 2) {
    const matchedAnswerTerms = answerTerms.filter((term) => combinedDraftText.includes(term))
    if (matchedAnswerTerms.length === 0) {
      return "The PRD did not incorporate concrete terms from the clarified answers."
    }
  }

  const weakPhase = input.draft.implementationPhases.find((phase) => {
    const text = normalizeTextForQuality([
      phase.title,
      phase.goal,
      ...phase.deliverables,
      ...phase.acceptanceCriteria
    ].join(" "))
    const hasGenericPhrase = GENERIC_PHASE_PHRASES.some((phrase) => text.includes(normalizeTextForQuality(phrase)))
    const phaseDescriptionMatches = descriptionTerms.filter((term) => text.includes(term)).length
    const phaseAnswerMatches = answerTerms.filter((term) => text.includes(term)).length

    return hasGenericPhrase && phaseDescriptionMatches + phaseAnswerMatches === 0
  })

  if (weakPhase) {
    return `Implementation phase "${weakPhase.title}" was too generic.`
  }

  return null
}

export const projectPlanningAiTestInternals = {
  buildProjectPlanningAnalysisPromptInput,
  buildProjectPlanningDraftPromptInput,
  buildProjectPlanningRequestMetadata,
  buildCoverageFromPrdSnapshot,
  buildCompactDraftContext,
  buildDraftFromCompactPrd,
  buildPrdFieldsFromCompactDraft,
  buildProjectPlanningDraftResponseFromCompactData,
  buildProjectPlanningRaceProviders,
  buildPrdSnapshotFromCompactSections,
  buildPrdSnapshotFromCoverageReport,
  buildQuestionsFromCompactTuples,
  buildResolvedDraftInputs,
  createPlanningDiagnostics,
  runProjectPlanningAnalysisProviderRace,
  runProjectPlanningDraftProviderRace,
  validatePrdSpecificity,
  validatePrdSnapshotSpecificity,
  validateQuestionnaireSpecificity,
  selectProjectPlanningProvider
}

function buildProjectPlanningAnalysisPromptInput(input: AnalyzeProjectPlanningRequest) {
  const systemPrompt = "Return JSON only. Fill PRD gaps from the user idea; ask domain-specific missing-info questions."
  const userPrompt = [
    JSON.stringify({ projectLabel: input.projectLabel, description: input.description }),
    "Keys=problem,target_user,goal_outcome,scope,core_requirements,non_goals,constraints,success_criteria,assumptions_risks.",
    'Shape={"summary":"","sections":[{"key":"scope","status":"filled|partial|missing","draft":"known <=90 chars","missing":["gap"]}],"questions":[{"id":"","section":"scope","question":"...?","why":"","mode":"single|multi","options":["choice","choice","Other"]}]}',
    "Rules: sections has all 9 keys once. questions has 3-4 items for biggest gaps. section must be an exact Key. No freeform. Use concrete users, data, actions, permissions, workflows, edge cases, success signals."
  ].join("\n")

  return {
    systemPrompt,
    userPrompt,
    maxTokens: PROJECT_PLANNING_ANALYSIS_MAX_TOKENS
  }
}

function buildProjectPlanningDraftPromptInput(input: {
  projectLabel: string
  compactDraftContext: ReturnType<typeof buildCompactDraftContext>
}) {
  const systemPrompt = "Return one valid JSON object only. Build a concrete MVP PRD from the intake."
  const userPrompt = [
    JSON.stringify({
      projectLabel: input.projectLabel,
      ...compactDraftPromptContext(input.compactDraftContext)
    }),
    'Shape={"title":"string","overview":"string","problem":"string","targetUser":"string","goal":"string","scope":"string","requirements":["string"],"nonGoals":["string"],"constraints":["string"],"successCriteria":["string"],"assumptionsRisks":["string"],"phase1Title":"string","phase1Goal":"string","phase1BuildScope":["string"],"phase1OutOfScope":["string"],"phase1DataState":["string"],"phase1Deliverables":["string"],"phase1AcceptanceCriteria":["string"],"phase1ValidationProof":["string"],"phase2Title":"string","phase2Goal":"string","phase2BuildScope":["string"],"phase2OutOfScope":["string"],"phase2DataState":["string"],"phase2Deliverables":["string"],"phase2AcceptanceCriteria":["string"],"phase2ValidationProof":["string"],"phase3Title":"string","phase3Goal":"string","phase3BuildScope":["string"],"phase3OutOfScope":["string"],"phase3DataState":["string"],"phase3Deliverables":["string"],"phase3AcceptanceCriteria":["string"],"phase3ValidationProof":["string"]}',
    "Rules: arrays only for list fields. intake wins. Infer gaps in assumptionsRisks. requirements=4; nonGoals/constraints/successCriteria/assumptionsRisks=2 each. Exactly 3 implementation phases. Per phase: buildScope=2, outOfScope=1, dataState=1, implementation deliverables=2, implementation acceptanceCriteria=2, agent-verifiable validationProof=1. No cohorts, studies, app-store/public beta, business reports, or real-user metrics in phase fields. Keep every item under 14 words. Phase 1 is the smallest usable foundation; later phases do not duplicate it. Avoid generic placeholder wording. Use domain entities, actions, states, success signals."
  ].join("\n")

  return {
    systemPrompt,
    userPrompt,
    maxTokens: PROJECT_PLANNING_DRAFT_MAX_TOKENS
  }
}

function truncatePromptValue(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized.length > maxLength ? normalized.slice(0, maxLength - 1).trimEnd() : normalized
}

function compactDraftPromptContext(context: ReturnType<typeof buildCompactDraftContext>) {
  const intake = Object.fromEntries(
    Object.entries({
      appIdea: truncatePromptValue(context.intake.appIdea, 320),
      targetUsers: truncatePromptValue(context.intake.targetUsers, 140),
      problem: truncatePromptValue(context.intake.problem, 140),
      firstVersion: truncatePromptValue(context.intake.firstVersion, 180),
      skipForNow: truncatePromptValue(context.intake.skipForNow, 120),
      anythingElse: truncatePromptValue(context.intake.anythingElse, 140)
    }).filter(([, value]) => Boolean(value))
  )
  const hasIntake = Object.keys(intake).length > 0

  const promptContext = {
    desc: truncatePromptValue(context.desc, hasIntake ? 320 : 700),
    intake,
    s: context.s.map(([key, status, draft, missing]) => [
      key,
      status,
      truncatePromptValue(draft, hasIntake ? 36 : 60),
      truncatePromptValue(missing, hasIntake ? 24 : 35)
    ]),
    ...(hasIntake ? {} : { mvp: truncatePromptValue(context.mvp, 80) }),
    a: (hasIntake ? [] : context.a).map((answer) => ({
      f: answer.f,
      q: truncatePromptValue(answer.q, 50),
      ans: truncatePromptValue(answer.ans, 70)
    }))
  }

  return promptContext
}

function resolveDraftAnswerValue(input: {
  answer: string | string[] | undefined
  other?: string
}) {
  const other = input.other?.trim() ?? ""

  if (Array.isArray(input.answer)) {
    return input.answer
      .map((value) => (value === "Other" ? other : value))
      .map((value) => value.trim())
      .filter(Boolean)
  }

  if (typeof input.answer === "string") {
    const value = input.answer === "Other" ? other : input.answer
    return value.trim()
  }

  return ""
}

function stringifyDraftAnswerValue(value: string | string[]) {
  if (Array.isArray(value)) return value.join("; ")
  return value
}

function buildResolvedDraftInputs(input: GenerateProjectPlanningDraftRequest) {
  const intakeFields = {
    appIdea: input.intakeFields?.appIdea || input.description,
    targetUsers: input.intakeFields?.targetUsers ?? "",
    problem: input.intakeFields?.problem ?? "",
    firstVersion: input.intakeFields?.firstVersion ?? "",
    skipForNow: input.intakeFields?.skipForNow ?? "",
    anythingElse: input.intakeFields?.anythingElse ?? ""
  }
  const clarifiedAnswers = input.questions.map((question) => {
    const rawAnswer = input.answerState[question.id]
    const customAnswer = input.otherAnswerState[question.id]?.trim() ?? ""
    const resolvedAnswer = resolveDraftAnswerValue({
      answer: rawAnswer,
      other: customAnswer
    })

    return {
      criterion: question.criterion,
      fillsSections: question.fillsSections,
      question: question.label,
      selectedAnswer: rawAnswer ?? null,
      customAnswer: customAnswer || null,
      resolvedAnswer
    }
  })

  const scopeAnswer = clarifiedAnswers.find((answer) => answer.fillsSections.includes("scope"))
  const scopeBucket = input.coverageReport.buckets.find((bucket) => bucket.key === "scope")
  const inferredMvpScope =
    stringifyDraftAnswerValue(scopeAnswer?.resolvedAnswer ?? "") ||
    scopeBucket?.resolvedValue ||
    "Assume the smallest useful MVP that can deliver the product's core value."

  return {
    originalDescription: input.description,
    intakeFields,
    inferredMvpScope,
    clarifiedAnswers,
    coverageValues: input.coverageReport.buckets.map((bucket) => ({
      criterion: bucket.key,
      status: bucket.status,
      resolvedValue: bucket.resolvedValue
    }))
  }
}

function buildCompactSnapshotForDraft(snapshot: ProjectPlanningPrdSnapshotPayload) {
  return CRITERIA_ORDER.map((key) => {
    const section = snapshot[key]
    return [
      key,
      section.status,
      section.draft,
      section.missing.slice(0, 2).join("; ")
    ]
  })
}

function buildPrdSnapshotFromCoverageReport(
  coverageReport: ProjectPlanningCoverageReportPayload
): ProjectPlanningPrdSnapshotPayload {
  const snapshot = ProjectPlanningPrdSnapshotSchema.parse(undefined)

  for (const bucket of coverageReport.buckets) {
    snapshot[bucket.key] = {
      status: bucket.status === "present" ? "filled" : bucket.status === "partial" ? "partial" : "missing",
      draft: bucket.status === "missing" ? "" : bucket.resolvedValue,
      missing: bucket.status === "missing" ? [bucket.resolvedValue] : []
    }
  }

  return snapshot
}

function buildCompactDraftContext(
  input: ReturnType<typeof buildResolvedDraftInputs>,
  snapshot: ProjectPlanningPrdSnapshotPayload
) {
  return {
    desc: input.originalDescription,
    intake: input.intakeFields,
    s: buildCompactSnapshotForDraft(snapshot),
    mvp: input.inferredMvpScope,
    a: input.clarifiedAnswers
      .map((answer) => ({
        f: answer.fillsSections,
        q: answer.question,
        ans: stringifyDraftAnswerValue(answer.resolvedAnswer)
      }))
      .filter((answer) => answer.ans)
  }
}

async function callStructuredJson<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: { parse: (data: unknown) => T },
  maxTokens: number
): Promise<{ data: T; diagnostics: ProjectPlanningDiagnosticsPayload }> {
  const primaryProvider = selectProjectPlanningProvider({
    provider: env.PROJECT_PLANNING_PROVIDER,
    hasKimiApiKey: Boolean(env.KIMI_API_KEY),
    hasDeepSeekApiKey: Boolean(env.DEEPSEEK_API_KEY),
    systemPrompt,
    userPrompt,
    maxTokens
  })

  if (!primaryProvider.configured) {
    throw new ProjectPlanningAiError(
      `${primaryProvider.name} is selected for Project Planning but is not configured.`,
      createPlanningDiagnostics({
        aiAvailable: false,
        providerName: primaryProvider.name,
        durationMs: 0,
        errorReason: "provider_not_configured",
        outputQualityStatus: "not_checked"
      })
    )
  }

  const controller = new AbortController()
  const startedAt = Date.now()
  const timeoutId = setTimeout(() => controller.abort(), PROJECT_PLANNING_PROVIDER_TIMEOUT_MS)

  try {
    const { raw, retryCount } = await callProviderWithOneRetry(primaryProvider, controller.signal)
    return {
      data: schema.parse(parseLooseJson(raw)),
      diagnostics: createPlanningDiagnostics({
        aiAvailable: true,
        providerName: primaryProvider.name,
        durationMs: Date.now() - startedAt,
        outputQualityStatus: "passed",
        providerAttempts: [
          {
            providerName: primaryProvider.name,
            durationMs: Date.now() - startedAt,
            status: "success",
            retryCount,
            outputQualityStatus: "passed"
          }
        ]
      })
    }
  } catch (error) {
    const durationMs = Date.now() - startedAt
    const timedOut = controller.signal.aborted
    const message = timedOut
      ? `${primaryProvider.name} timed out after ${PROJECT_PLANNING_PROVIDER_TIMEOUT_MS / 1000}s.`
      : error instanceof Error
        ? `${primaryProvider.name} planning request failed: ${error.message}`
        : `${primaryProvider.name} planning request failed.`

    if (controller.signal.aborted) {
      throw new ProjectPlanningAiError(
        message,
        createPlanningDiagnostics({
          aiAvailable: false,
          providerName: primaryProvider.name,
          durationMs,
          errorReason: "provider_timeout",
          outputQualityStatus: "not_checked",
          providerAttempts: [
            {
              providerName: primaryProvider.name,
              durationMs,
              status: "timeout",
              retryCount: getRetryCountFromError(error),
              errorReason: "provider_timeout",
              outputQualityStatus: "not_checked"
            }
          ]
        })
      )
    }

    throw new ProjectPlanningAiError(
      message,
      createPlanningDiagnostics({
        aiAvailable: false,
        providerName: primaryProvider.name,
        durationMs,
        errorReason: error instanceof Error ? error.message : "provider_error",
        outputQualityStatus: "failed",
        providerAttempts: [
          {
            providerName: primaryProvider.name,
            durationMs,
            status: "failed",
            retryCount: getRetryCountFromError(error),
            errorReason: error instanceof Error ? error.message : "provider_error",
            outputQualityStatus: "failed"
          }
        ]
      })
    )
  } finally {
    clearTimeout(timeoutId)
  }
}

async function runProjectPlanningAnalysisProviderRace(input: {
  description: string
  systemPrompt: string
  userPrompt: string
  maxTokens: number
  metadata?: ProjectPlanningRequestMetadata
  providers?: ProjectPlanningProvider[]
  timeoutMs?: number
}): Promise<AnalyzeProjectPlanningResponse> {
  const providers = input.providers ?? buildProjectPlanningRaceProviders({
    hasKimiApiKey: Boolean(env.KIMI_API_KEY),
    hasDeepSeekApiKey: Boolean(env.DEEPSEEK_API_KEY),
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    maxTokens: input.maxTokens
  })

  if (!providers.length) {
    throw new ProjectPlanningAiError(
      "AI planning provider is not configured.",
      createPlanningDiagnostics({
        aiAvailable: false,
          providerName: null,
          durationMs: 0,
          metadata: input.metadata,
          errorReason: "provider_not_configured",
          outputQualityStatus: "not_checked"
        })
    )
  }

  const startedAt = Date.now()
  const attempts: ProjectPlanningProviderAttempt[] = []
  const controllers = providers.map(() => new AbortController())
  const timeoutMs = input.timeoutMs ?? PROJECT_PLANNING_PROVIDER_TIMEOUT_MS

  return new Promise((resolve, reject) => {
    let settled = false
    let finishedCount = 0
    const timeoutId = setTimeout(() => {
      for (const controller of controllers) {
        controller.abort()
      }
    }, timeoutMs)

    const finishFailure = () => {
      if (settled || finishedCount < providers.length) return
      clearTimeout(timeoutId)

      const timedOut = attempts.some((attempt) => attempt.status === "timeout")
      reject(new ProjectPlanningAiError(
        timedOut
          ? `Project Planning providers timed out after ${timeoutMs / 1000}s.`
          : "Project Planning providers did not return valid requirements.",
        createPlanningDiagnostics({
          aiAvailable: false,
          providerName: null,
          durationMs: Date.now() - startedAt,
          metadata: input.metadata,
          errorReason: timedOut ? "provider_timeout" : "provider_error",
          malformedJson: attempts.some((attempt) => attempt.malformedJson),
          repairAttempted: attempts.some((attempt) => attempt.repairAttempted),
          repairSucceeded: attempts.some((attempt) => attempt.repairSucceeded),
          outputQualityStatus: attempts.some((attempt) => attempt.outputQualityStatus === "failed")
            ? "failed"
            : "not_checked",
          providerAttempts: attempts
        })
      ))
    }

    providers.forEach((provider, index) => {
      const controller = controllers[index]
      const providerStartedAt = Date.now()

      void callProviderWithOneRetry(provider, controller.signal)
        .then(async ({ raw, retryCount }) => {
          if (settled) return

          const parseResult = await parseProjectPlanningJsonWithRepair({
            raw,
            provider,
            schemaDescription: PROJECT_PLANNING_ANALYSIS_JSON_SCHEMA_DESCRIPTION,
            signal: controller.signal,
            startedAt,
            timeoutMs
          })
          const modelData = ProjectPlanningAnalysisModelSchema.parse(parseResult.data)
          const durationMs = Date.now() - providerStartedAt
          const nextAttempts: ProjectPlanningProviderAttempt[] = [
            ...attempts,
            {
              providerName: provider.name,
              durationMs,
              status: "success",
              retryCount,
              malformedJson: parseResult.malformedJson,
              repairAttempted: parseResult.repairAttempted,
              repairSucceeded: parseResult.repairSucceeded,
              outputQualityStatus: "passed"
            }
          ]
          providers.forEach((otherProvider, otherIndex) => {
            if (otherIndex === index) return
            if (attempts.some((attempt) => attempt.providerName === otherProvider.name)) return
            nextAttempts.push({
              providerName: otherProvider.name,
              durationMs: Date.now() - startedAt,
              status: "aborted",
              errorReason: "race_lost",
              outputQualityStatus: "not_checked"
            })
          })
          const diagnostics = createPlanningDiagnostics({
            aiAvailable: true,
            providerName: provider.name,
            durationMs: Date.now() - startedAt,
            metadata: input.metadata,
            malformedJson: parseResult.malformedJson,
            repairAttempted: parseResult.repairAttempted,
            repairSucceeded: parseResult.repairSucceeded,
            outputQualityStatus: "passed",
            providerAttempts: nextAttempts
          })
          const response = buildProjectPlanningAnalysisResponseFromModelData({
            description: input.description,
            modelData,
            diagnostics
          })

          settled = true
          clearTimeout(timeoutId)
          controllers.forEach((otherController, otherIndex) => {
            if (otherIndex !== index) otherController.abort()
          })
          resolve(response)
        })
        .catch((error) => {
          if (settled) return

          const durationMs = Date.now() - providerStartedAt
          const timedOut = controller.signal.aborted
          const qualityFailed = error instanceof ProjectPlanningAiError
          const jsonRepairMetadata = getJsonRepairMetadata(error)
          attempts.push({
            providerName: provider.name,
            durationMs,
            status: timedOut ? "timeout" : "failed",
            retryCount: getRetryCountFromError(error),
            ...jsonRepairMetadata,
            errorReason: timedOut
              ? "provider_timeout"
              : qualityFailed
                ? error.diagnostics.errorReason ?? error.message
                : error instanceof Error
                  ? error.message
                  : "provider_error",
            outputQualityStatus: qualityFailed
              ? error.diagnostics.outputQualityStatus
              : timedOut
                ? "not_checked"
                : "failed"
          })
          finishedCount += 1
          finishFailure()
        })
    })
  })
}

const CRITERIA_TITLES: Record<ProjectPlanningCriteriaKey, string> = {
  problem: "Problem",
  target_user: "Target user",
  goal_outcome: "Goal / outcome",
  scope: "Scope",
  core_requirements: "Core requirements",
  non_goals: "Non-goals",
  constraints: "Constraints",
  success_criteria: "Success criteria",
  assumptions_risks: "Assumptions / risks"
}

const CRITERIA_ORDER: ProjectPlanningCriteriaKey[] = [
  "problem",
  "target_user",
  "goal_outcome",
  "scope",
  "core_requirements",
  "non_goals",
  "constraints",
  "success_criteria",
  "assumptions_risks"
]

const PROJECT_PLANNING_ANALYSIS_JSON_SCHEMA_DESCRIPTION =
  '{"summary":"string","sections":[{"key":"problem|target_user|goal_outcome|scope|core_requirements|non_goals|constraints|success_criteria|assumptions_risks","status":"filled|partial|missing","draft":"string","missing":["string"]}],"questions":[{"id":"string","section":"scope","question":"string","why":"string","mode":"single|multi","options":["string","Other"]}]}'

const PROJECT_PLANNING_DRAFT_JSON_SCHEMA_DESCRIPTION =
  '{"title":"string","overview":"string","problem":"string","targetUser":"string","goal":"string","scope":"string","requirements":["string"],"nonGoals":["string"],"constraints":["string"],"successCriteria":["string"],"assumptionsRisks":["string"],"phase1Title":"string","phase1Goal":"string","phase1BuildScope":["string"],"phase1OutOfScope":["string"],"phase1DataState":["string"],"phase1Deliverables":["string"],"phase1AcceptanceCriteria":["string"],"phase1ValidationProof":["string"],"phase2Title":"string","phase2Goal":"string","phase2BuildScope":["string"],"phase2OutOfScope":["string"],"phase2DataState":["string"],"phase2Deliverables":["string"],"phase2AcceptanceCriteria":["string"],"phase2ValidationProof":["string"],"phase3Title":"string","phase3Goal":"string","phase3BuildScope":["string"],"phase3OutOfScope":["string"],"phase3DataState":["string"],"phase3Deliverables":["string"],"phase3AcceptanceCriteria":["string"],"phase3ValidationProof":["string"]}'

const CompactProjectPlanningAnalysisSchema = z.object({
  s: z.array(z.array(z.unknown()).max(4)).max(9).default([]),
  q: z.array(z.array(z.unknown()).max(6)).max(6).default([])
})

const ObjectProjectPlanningAnalysisSchema = z.object({
  summary: z.unknown().optional(),
  sections: z.array(z.object({
    key: z.unknown(),
    status: z.unknown().optional(),
    draft: z.unknown().optional(),
    missing: z.union([z.array(z.unknown()), z.unknown()]).optional()
  }).passthrough()).max(12),
  questions: z.array(z.object({
    id: z.unknown().optional(),
    section: z.unknown().optional(),
    sections: z.array(z.unknown()).optional(),
    fillsSections: z.array(z.unknown()).optional(),
    question: z.unknown().optional(),
    label: z.unknown().optional(),
    why: z.unknown().optional(),
    helper: z.unknown().optional(),
    mode: z.unknown().optional(),
    options: z.array(z.unknown()).optional()
  }).passthrough()).max(6)
})

const ProjectPlanningAnalysisModelSchema = z.union([
  ObjectProjectPlanningAnalysisSchema,
  z.object({
    s: z.array(z.array(z.unknown()).max(4)).max(9),
    q: z.array(z.array(z.unknown()).max(6)).max(6)
  })
])

const CompactProjectPlanningDraftSchema = z.object({
  d: z.union([
    z.array(z.unknown()).min(6).max(12),
    z.object({
      title: z.unknown().optional(),
      overview: z.unknown().optional(),
      problem: z.unknown().optional(),
      targetUser: z.unknown().optional(),
      target_user: z.unknown().optional(),
      goal: z.unknown().optional(),
      scope: z.unknown().optional()
    }).passthrough()
  ]),
  r: z.array(z.unknown()).min(3).max(6),
  n: z.array(z.unknown()).min(1).max(4),
  c: z.array(z.unknown()).min(1).max(4),
  sc: z.array(z.unknown()).min(2).max(4),
  ar: z.array(z.unknown()).min(1).max(4),
  p: z.array(z.array(z.unknown()).min(4).max(10)).min(2).max(3)
})

const FlatProjectPlanningDraftListValueSchema = z.union([z.string(), z.array(z.unknown())])

const NonEmptyDraftStringSchema = z.string().trim().min(1)

const FlatProjectPlanningDraftSchema = z.object({
  title: NonEmptyDraftStringSchema,
  overview: NonEmptyDraftStringSchema,
  problem: NonEmptyDraftStringSchema,
  targetUser: NonEmptyDraftStringSchema,
  goal: NonEmptyDraftStringSchema,
  scope: NonEmptyDraftStringSchema,
  requirements: FlatProjectPlanningDraftListValueSchema,
  nonGoals: FlatProjectPlanningDraftListValueSchema,
  constraints: FlatProjectPlanningDraftListValueSchema,
  successCriteria: FlatProjectPlanningDraftListValueSchema,
  assumptionsRisks: FlatProjectPlanningDraftListValueSchema,
  phase1Title: NonEmptyDraftStringSchema,
  phase1Goal: NonEmptyDraftStringSchema,
  phase1BuildScope: FlatProjectPlanningDraftListValueSchema.optional(),
  phase1OutOfScope: FlatProjectPlanningDraftListValueSchema.optional(),
  phase1DataState: FlatProjectPlanningDraftListValueSchema.optional(),
  phase1Deliverables: FlatProjectPlanningDraftListValueSchema,
  phase1AcceptanceCriteria: FlatProjectPlanningDraftListValueSchema,
  phase1ValidationProof: FlatProjectPlanningDraftListValueSchema.optional(),
  phase2Title: NonEmptyDraftStringSchema,
  phase2Goal: NonEmptyDraftStringSchema,
  phase2BuildScope: FlatProjectPlanningDraftListValueSchema.optional(),
  phase2OutOfScope: FlatProjectPlanningDraftListValueSchema.optional(),
  phase2DataState: FlatProjectPlanningDraftListValueSchema.optional(),
  phase2Deliverables: FlatProjectPlanningDraftListValueSchema,
  phase2AcceptanceCriteria: FlatProjectPlanningDraftListValueSchema,
  phase2ValidationProof: FlatProjectPlanningDraftListValueSchema.optional(),
  phase3Title: NonEmptyDraftStringSchema,
  phase3Goal: NonEmptyDraftStringSchema,
  phase3BuildScope: FlatProjectPlanningDraftListValueSchema.optional(),
  phase3OutOfScope: FlatProjectPlanningDraftListValueSchema.optional(),
  phase3DataState: FlatProjectPlanningDraftListValueSchema.optional(),
  phase3Deliverables: FlatProjectPlanningDraftListValueSchema,
  phase3AcceptanceCriteria: FlatProjectPlanningDraftListValueSchema,
  phase3ValidationProof: FlatProjectPlanningDraftListValueSchema.optional()
}).passthrough()

const ObjectProjectPlanningDraftSchema = z.object({
  title: z.unknown().optional(),
  overview: z.unknown().optional(),
  problem: z.unknown().optional(),
  targetUser: z.unknown().optional(),
  target_user: z.unknown().optional(),
  goal: z.unknown().optional(),
  scope: z.unknown().optional(),
  requirements: z.union([z.array(z.unknown()), z.unknown()]).optional(),
  nonGoals: z.union([z.array(z.unknown()), z.unknown()]).optional(),
  non_goals: z.union([z.array(z.unknown()), z.unknown()]).optional(),
  constraints: z.union([z.array(z.unknown()), z.unknown()]).optional(),
  successCriteria: z.union([z.array(z.unknown()), z.unknown()]).optional(),
  success_criteria: z.union([z.array(z.unknown()), z.unknown()]).optional(),
  assumptionsRisks: z.union([z.array(z.unknown()), z.unknown()]).optional(),
  assumptions_risks: z.union([z.array(z.unknown()), z.unknown()]).optional(),
  phases: z.array(z.object({
    title: z.unknown().optional(),
    name: z.unknown().optional(),
    goal: z.unknown().optional(),
    buildScope: z.union([z.array(z.unknown()), z.unknown()]).optional(),
    build_scope: z.union([z.array(z.unknown()), z.unknown()]).optional(),
    outOfScope: z.union([z.array(z.unknown()), z.unknown()]).optional(),
    out_of_scope: z.union([z.array(z.unknown()), z.unknown()]).optional(),
    dataState: z.union([z.array(z.unknown()), z.unknown()]).optional(),
    data_state: z.union([z.array(z.unknown()), z.unknown()]).optional(),
    deliverables: z.union([z.array(z.unknown()), z.unknown()]).optional(),
    acceptanceCriteria: z.union([z.array(z.unknown()), z.unknown()]).optional(),
    acceptance_criteria: z.union([z.array(z.unknown()), z.unknown()]).optional(),
    validationProof: z.union([z.array(z.unknown()), z.unknown()]).optional(),
    validation_proof: z.union([z.array(z.unknown()), z.unknown()]).optional()
  }).passthrough()).min(1).max(4)
})

const ProjectPlanningDraftModelSchema = z.union([
  FlatProjectPlanningDraftSchema,
  ObjectProjectPlanningDraftSchema,
  CompactProjectPlanningDraftSchema
])

type CompactProjectPlanningAnalysisPayload = z.infer<typeof CompactProjectPlanningAnalysisSchema>
type CompactProjectPlanningDraftPayload = z.infer<typeof CompactProjectPlanningDraftSchema>
type FlatProjectPlanningDraftPayload = z.infer<typeof FlatProjectPlanningDraftSchema>
type ProjectPlanningAnalysisModelPayload = z.infer<typeof ProjectPlanningAnalysisModelSchema>
type ProjectPlanningDraftModelPayload = z.infer<typeof ProjectPlanningDraftModelSchema>

function defaultCriteriaValue(key: ProjectPlanningCriteriaKey) {
  return `${CRITERIA_TITLES[key]} still needs clarification.`
}

function summarizeCoverage(buckets: ProjectPlanningCriteriaBucketPayload[]) {
  return {
    present: buckets.filter((bucket) => bucket.status === "present").length,
    partial: buckets.filter((bucket) => bucket.status === "partial").length,
    missing: buckets.filter((bucket) => bucket.status === "missing").length,
    conflicting: buckets.filter((bucket) => bucket.status === "conflicting").length
  }
}

function normalizeQuestionId(value: string, index: number) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
  return normalized || `planning_question_${index + 1}`
}

function parsePlanningSectionKey(value: unknown): ProjectPlanningSectionKey | null {
  const parsed = ProjectPlanningSectionKeySchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function parsePlanningSnapshotStatus(value: unknown, draft: string, missingText: string) {
  const parsed = ProjectPlanningPrdSectionStatusSchema.safeParse(value)
  if (parsed.success) return parsed.data
  if (draft.trim()) return "partial" as const
  return missingText.trim() ? "missing" as const : "missing" as const
}

function normalizeSnapshotDraft(value: string, status: "filled" | "partial" | "missing") {
  const trimmed = value.trim()
  const normalized = normalizeTextForQuality(trimmed)
  const isPlaceholder = SNAPSHOT_PLACEHOLDER_PHRASES.some((phrase) => normalized === normalizeTextForQuality(phrase))
  if (isPlaceholder) return ""
  return trimmed
}

function compactStringAt(values: unknown[], index: number): string {
  const value = values[index]
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.map((item: unknown) => compactStringAt([item], 0)).filter(Boolean).join("; ")
  return ""
}

function compactStringArrayAt(values: unknown[], index: number): string[] {
  const value = values[index]
  if (Array.isArray(value)) return value.map((item: unknown) => compactStringAt([item], 0)).filter(Boolean)
  const stringValue = compactStringAt(values, index)
  return stringValue ? [stringValue] : []
}

function objectStringArrayAt(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) return value.map((item) => compactStringAt([item], 0)).filter(Boolean)
    const stringValue = compactStringAt([value], 0)
    if (stringValue) return [stringValue]
  }

  return []
}

function splitDraftBulletText(value: string | unknown[]) {
  if (Array.isArray(value)) {
    return value.map((item) => compactStringAt([item], 0)).filter(Boolean)
  }

  const normalized = value.replace(/\r/g, "\n").trim()
  if (!normalized) return []

  const lineItems = normalized
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)

  if (lineItems.length > 1) return lineItems

  return normalized
    .split(/\s*;\s*/)
    .map((item) => item.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
}

function ensureDraftList(items: string[], fallback: string, min = 1, max = 4) {
  const normalized = items.map((item) => item.trim()).filter(Boolean).slice(0, max)
  while (normalized.length < min) {
    normalized.push(fallback)
  }
  return normalized
}

function optionalDraftList(value: string | unknown[] | undefined, max = 4) {
  return value ? splitDraftBulletText(value).slice(0, max) : []
}

function flatDraftToCompact(data: FlatProjectPlanningDraftPayload): CompactProjectPlanningDraftPayload {
  return CompactProjectPlanningDraftSchema.parse({
    d: {
      title: data.title,
      overview: data.overview,
      problem: data.problem,
      targetUser: data.targetUser,
      goal: data.goal,
      scope: data.scope
    },
    r: ensureDraftList(splitDraftBulletText(data.requirements), "Build the core MVP behavior described in the intake.", 3, 6),
    n: ensureDraftList(splitDraftBulletText(data.nonGoals), "Avoid unrelated features outside the stated first version.", 1, 4),
    c: ensureDraftList(splitDraftBulletText(data.constraints), "Keep the first release focused and practical.", 1, 4),
    sc: ensureDraftList(splitDraftBulletText(data.successCriteria), "The MVP works end to end for the target user.", 2, 4),
    ar: ensureDraftList(splitDraftBulletText(data.assumptionsRisks), "Some details were inferred from the intake and should be confirmed.", 1, 4),
    p: [
      [
        data.phase1Title,
        data.phase1Goal,
        optionalDraftList(data.phase1BuildScope, 3),
        optionalDraftList(data.phase1OutOfScope, 2),
        optionalDraftList(data.phase1DataState, 2),
        ensureDraftList(splitDraftBulletText(data.phase1Deliverables), "MVP deliverable for Phase 1", 1, 3),
        ensureDraftList(splitDraftBulletText(data.phase1AcceptanceCriteria), "Phase 1 is validated with concrete evidence", 1, 3),
        optionalDraftList(data.phase1ValidationProof, 2)
      ],
      [
        data.phase2Title,
        data.phase2Goal,
        optionalDraftList(data.phase2BuildScope, 3),
        optionalDraftList(data.phase2OutOfScope, 2),
        optionalDraftList(data.phase2DataState, 2),
        ensureDraftList(splitDraftBulletText(data.phase2Deliverables), "MVP deliverable for Phase 2", 1, 3),
        ensureDraftList(splitDraftBulletText(data.phase2AcceptanceCriteria), "Phase 2 is validated with concrete evidence", 1, 3),
        optionalDraftList(data.phase2ValidationProof, 2)
      ],
      [
        data.phase3Title,
        data.phase3Goal,
        optionalDraftList(data.phase3BuildScope, 3),
        optionalDraftList(data.phase3OutOfScope, 2),
        optionalDraftList(data.phase3DataState, 2),
        ensureDraftList(splitDraftBulletText(data.phase3Deliverables), "MVP deliverable for Phase 3", 1, 3),
        ensureDraftList(splitDraftBulletText(data.phase3AcceptanceCriteria), "Phase 3 is validated with concrete evidence", 1, 3),
        optionalDraftList(data.phase3ValidationProof, 2)
      ]
    ]
  })
}

function buildSupplementalDraftPhase(input: {
  index: number
  requirements: string[]
  successCriteria: string[]
}) {
  const titles = ["MVP Requirements", "Validation and Handoff", "First Release Readiness"]
  const requirement = input.requirements[input.index % Math.max(1, input.requirements.length)] || "Complete the next MVP capability"
  const success = input.successCriteria[input.index % Math.max(1, input.successCriteria.length)] || "The capability is verified against the PRD"
  return [
    `Phase ${input.index + 1} — ${titles[input.index - 1] ?? titles[titles.length - 1]}`,
    `Turn the PRD requirements into a working, testable product capability.`,
    [
      requirement,
      "User-facing behavior needed for the MVP",
      "Focused implementation without unrelated scope"
    ],
    [
      success,
      "The phase can be validated with concrete evidence",
      "The assistant waits for confirmation before moving on"
    ]
  ]
}

function analysisModelToCompact(data: ProjectPlanningAnalysisModelPayload): CompactProjectPlanningAnalysisPayload {
  if ("s" in data && "q" in data) return data

  return CompactProjectPlanningAnalysisSchema.parse({
    s: data.sections.map((section) => [
      compactStringAt([section.key], 0),
      compactStringAt([section.status], 0),
      compactStringAt([section.draft], 0),
      compactStringArrayAt([section.missing], 0).join("; ")
    ]),
    q: data.questions.map((question, index) => {
      const record = question as Record<string, unknown>
      const sectionList = objectStringArrayAt(record, ["sections", "fillsSections"])
      const section = compactStringAt([record.section], 0)
      return [
        compactStringAt([record.id], 0) || `planning_question_${index + 1}`,
        sectionList.length ? sectionList : section ? [section] : ["core_requirements"],
        compactStringAt([record.question], 0) || compactStringAt([record.label], 0),
        compactStringAt([record.why], 0) || compactStringAt([record.helper], 0),
        compactStringAt([record.mode], 0),
        compactStringArrayAt([record.options], 0)
      ]
    })
  })
}

function draftModelToCompact(data: ProjectPlanningDraftModelPayload): CompactProjectPlanningDraftPayload {
  if ("phase1Title" in data && "phase1Deliverables" in data) return flatDraftToCompact(data)
  if ("d" in data && "r" in data && "p" in data) return data

  const record = data as Record<string, unknown>
  const requirements = ensureDraftList(
    objectStringArrayAt(record, ["requirements"]),
    "Build the core MVP behavior described in the intake.",
    3,
    6
  )
  const nonGoals = ensureDraftList(
    objectStringArrayAt(record, ["nonGoals", "non_goals"]),
    "Avoid unrelated features outside the stated first version.",
    1,
    4
  )
  const constraints = ensureDraftList(
    objectStringArrayAt(record, ["constraints"]),
    "Keep the first release focused and practical.",
    1,
    4
  )
  const successCriteria = ensureDraftList(
    objectStringArrayAt(record, ["successCriteria", "success_criteria"]),
    "The MVP works end to end for the target user.",
    2,
    4
  )
  const assumptionsRisks = ensureDraftList(
    objectStringArrayAt(record, ["assumptionsRisks", "assumptions_risks"]),
    "Some details were inferred from the intake and should be confirmed.",
    1,
    4
  )
  const phases = (Array.isArray(record.phases) ? record.phases : []).map((phase, index) => {
    const phaseRecord = phase && typeof phase === "object" && !Array.isArray(phase)
      ? phase as Record<string, unknown>
      : {}
    return [
      compactStringAt([phaseRecord.title], 0) || compactStringAt([phaseRecord.name], 0) || `Phase ${index + 1}`,
      compactStringAt([phaseRecord.goal], 0) || `Build the next MVP capability.`,
      objectStringArrayAt(phaseRecord, ["buildScope", "build_scope"]).slice(0, 3),
      objectStringArrayAt(phaseRecord, ["outOfScope", "out_of_scope"]).slice(0, 2),
      objectStringArrayAt(phaseRecord, ["dataState", "data_state"]).slice(0, 2),
      ensureDraftList(
        objectStringArrayAt(phaseRecord, ["deliverables"]),
        "MVP deliverable for this phase",
        1,
        3
      ),
      ensureDraftList(
        objectStringArrayAt(phaseRecord, ["acceptanceCriteria", "acceptance_criteria"]),
        "The phase is validated with concrete evidence",
        1,
        3
      ),
      objectStringArrayAt(phaseRecord, ["validationProof", "validation_proof"]).slice(0, 2)
    ]
  }).slice(0, 3)

  while (phases.length < 2) {
    phases.push(buildSupplementalDraftPhase({
      index: phases.length + 1,
      requirements,
      successCriteria
    }))
  }

  return CompactProjectPlanningDraftSchema.parse({
    d: {
      title: compactStringAt([record.title], 0),
      overview: compactStringAt([record.overview], 0),
      problem: compactStringAt([record.problem], 0),
      targetUser: compactStringAt([record.targetUser], 0) || compactStringAt([record.target_user], 0),
      goal: compactStringAt([record.goal], 0),
      scope: compactStringAt([record.scope], 0)
    },
    r: requirements,
    n: nonGoals,
    c: constraints,
    sc: successCriteria,
    ar: assumptionsRisks,
    p: phases
  })
}

function normalizeQuestion(question: ProjectPlanningQuestionPayload, index: number): ProjectPlanningQuestionPayload {
  const options = (question.options ?? []).map((option) => option.trim()).filter(Boolean)

  return {
    ...question,
    id: normalizeQuestionId(question.id, index),
    label: question.label.trim(),
    helper: question.helper.trim(),
    mode: question.mode === "freeform" ? "single" : question.mode,
    options: question.mode === "freeform"
      ? ["Yes, that fits", "No, take a different direction", "Other"]
      : options.length
        ? options.slice(0, 7)
        : [""]
  }
}

function buildFallbackCoverage(description: string): ProjectPlanningCoverageReportPayload {
  const normalized = description.toLowerCase()
  const makeBucket = (
    key: ProjectPlanningCriteriaKey,
    status: ProjectPlanningCriteriaStatus,
    resolvedValue: string
  ): ProjectPlanningCriteriaBucketPayload => ({
    key,
    title: CRITERIA_TITLES[key],
    status,
    confidence: status === "present" ? 0.82 : status === "partial" ? 0.56 : 0.2,
    evidenceSnippets: [],
    resolvedValue
  })

  const buckets: ProjectPlanningCriteriaBucketPayload[] = [
    makeBucket("problem", normalized.includes("because") || normalized.includes("need") ? "partial" : "missing", description),
    makeBucket("target_user", /\b(me|myself|customers?|users?|team|admins?)\b/.test(normalized) ? "partial" : "missing", description),
    makeBucket("goal_outcome", /\bshould|want|need|remind|allow|help\b/.test(normalized) ? "partial" : "missing", description),
    makeBucket("scope", /\bfirst|mvp|only|for now|just\b/.test(normalized) ? "partial" : "missing", "The first-release scope still needs clarification."),
    makeBucket("core_requirements", /\bmust|include|need|capture|remind\b/.test(normalized) ? "partial" : "missing", description),
    makeBucket("non_goals", /\bnot\b|\bavoid\b|\bout of scope\b/.test(normalized) ? "partial" : "missing", "The first-version non-goals still need clarification."),
    makeBucket("constraints", /\bexisting\b|\bpreserve\b|\bmust use\b/.test(normalized) ? "partial" : "missing", "The key constraints still need clarification."),
    makeBucket("success_criteria", /\bsuccess\b|\bdone\b|\bshould be able to\b/.test(normalized) ? "partial" : "missing", "The success criteria still need clarification."),
    makeBucket("assumptions_risks", /\bassum|risk|unknown|depends\b/.test(normalized) ? "partial" : "missing", "The main assumptions and risks still need clarification.")
  ]

  return {
    buckets,
    summary: summarizeCoverage(buckets)
  }
}

function buildCoverageFromPrdSnapshot(snapshot: ProjectPlanningPrdSnapshotPayload): ProjectPlanningCoverageReportPayload {
  const buckets: ProjectPlanningCriteriaBucketPayload[] = CRITERIA_ORDER.map((key) => {
    const section = snapshot[key]
    const status: ProjectPlanningCriteriaStatus =
      section.status === "filled" ? "present" : section.status === "partial" ? "partial" : "missing"
    const resolvedValue =
      section.draft.trim() ||
      section.missing.map((item) => item.trim()).filter(Boolean).join("; ") ||
      defaultCriteriaValue(key)

    return {
      key,
      title: CRITERIA_TITLES[key],
      status,
      confidence: status === "present" ? 0.85 : status === "partial" ? 0.55 : 0.2,
      evidenceSnippets: section.draft.trim() ? [section.draft.trim().slice(0, 220)] : [],
      resolvedValue
    }
  })

  return {
    buckets,
    summary: summarizeCoverage(buckets)
  }
}

function buildPrdSnapshotFromCompactSections(
  sections: z.infer<typeof CompactProjectPlanningAnalysisSchema>["s"]
): ProjectPlanningPrdSnapshotPayload {
  const snapshot = ProjectPlanningPrdSnapshotSchema.parse(undefined)

  for (const section of sections) {
    const rawKey = compactStringAt(section, 0)
    const rawStatus = compactStringAt(section, 1)
    const draft = compactStringAt(section, 2)
    const missingText = compactStringAt(section, 3)
    const key = parsePlanningSectionKey(rawKey)
    if (!key) continue

    const status = parsePlanningSnapshotStatus(rawStatus, draft, missingText)
    const missing = missingText
      .split(/[;,\n]/)
      .map((item) => item.trim())
      .filter((item) => {
        if (!item) return false
        const normalized = normalizeTextForQuality(item)
        return !SNAPSHOT_PLACEHOLDER_PHRASES.some((phrase) => normalized === normalizeTextForQuality(phrase))
      })
      .slice(0, 6)

    snapshot[key] = {
      status,
      draft: normalizeSnapshotDraft(draft, status),
      missing
    }
  }

  return snapshot
}

function getUnresolvedSnapshotSectionKeys(snapshot: ProjectPlanningPrdSnapshotPayload) {
  const unresolved = CRITERIA_ORDER.filter((key) => snapshot[key].status !== "filled")
  return unresolved.length ? unresolved : ["core_requirements" as const]
}

function buildQuestionsFromCompactTuples(
  questions: z.infer<typeof CompactProjectPlanningAnalysisSchema>["q"],
  fallbackSections: ProjectPlanningSectionKey[] = ["core_requirements"]
): ProjectPlanningQuestionPayload[] {
  return questions.map((question, index) => {
    const id = compactStringAt(question, 0)
    const rawFillsSections = compactStringArrayAt(question, 1)
    const label = compactStringAt(question, 2)
    const helper = compactStringAt(question, 3)
    const mode = compactStringAt(question, 4)
    const options = compactStringArrayAt(question, 5)
    const fillsSections = rawFillsSections
      .map(parsePlanningSectionKey)
      .filter((section): section is ProjectPlanningSectionKey => Boolean(section))

    return ProjectPlanningQuestionSchema.parse({
      id,
      fillsSections: fillsSections.length ? fillsSections : [fallbackSections[index] ?? fallbackSections[0] ?? "core_requirements"],
      label,
      helper,
      mode: mode === "multi" ? "multi" : "single",
      options
    })
  })
}

function buildProjectPlanningAnalysisResponseFromCompactData(input: {
  description: string
  compactData: CompactProjectPlanningAnalysisPayload
  diagnostics: ProjectPlanningDiagnosticsPayload
}): AnalyzeProjectPlanningResponse {
  const prdSnapshot = buildPrdSnapshotFromCompactSections(input.compactData.s)
  const snapshotQualityError = validatePrdSnapshotSpecificity({
    description: input.description,
    snapshot: prdSnapshot
  })
  if (snapshotQualityError) {
    throw new ProjectPlanningAiError(
      snapshotQualityError,
      {
        ...input.diagnostics,
        errorReason: "snapshot_quality_failed",
        outputQualityStatus: "failed"
      }
    )
  }

  const coverageReport = buildCoverageFromPrdSnapshot(prdSnapshot)
  const questions = buildQuestionsFromCompactTuples(input.compactData.q, getUnresolvedSnapshotSectionKeys(prdSnapshot))
    .map(normalizeQuestion)
    .filter((question) => (question.options ?? []).filter(Boolean).length >= 2)
    .slice(0, 5)
  const qualityError = validateQuestionnaireSpecificity({
    description: input.description,
    questions,
    groundingText: snapshotSectionText(prdSnapshot)
  })

  if (qualityError) {
    throw new ProjectPlanningAiError(
      qualityError,
      {
        ...input.diagnostics,
        errorReason: "questionnaire_quality_failed",
        outputQualityStatus: "failed"
      }
    )
  }

  return {
    coverageReport,
    prdSnapshot,
    questions,
    aiAvailable: true,
    diagnostics: input.diagnostics
  }
}

function buildProjectPlanningAnalysisResponseFromModelData(input: {
  description: string
  modelData: ProjectPlanningAnalysisModelPayload
  diagnostics: ProjectPlanningDiagnosticsPayload
}): AnalyzeProjectPlanningResponse {
  return buildProjectPlanningAnalysisResponseFromCompactData({
    description: input.description,
    compactData: analysisModelToCompact(input.modelData),
    diagnostics: input.diagnostics
  })
}

function buildFallbackQuestions(description: string): ProjectPlanningQuestionPayload[] {
  const normalized = description.toLowerCase()
  const questions: ProjectPlanningQuestionPayload[] = []

  if (!/\b(me|myself|customers?|users?|team|admins?)\b/.test(normalized)) {
    questions.push({
      id: "planning_target_user",
      criterion: "target_user",
      fillsSections: ["target_user"],
      label: "Who is this first version mainly for?",
      helper: "Keep it simple and name the main person this product is helping first.",
      mode: "single",
      options: ["Just me", "Customers", "My internal team", "Admins or operators", "Other"]
    })
  }

  if (!/\bnot\b|\bout of scope\b|\bavoid\b/.test(normalized)) {
    questions.push({
      id: "planning_non_goals",
      criterion: "non_goals",
      fillsSections: ["non_goals"],
      label: "What should we intentionally leave out of the first release?",
      helper: "This helps the PRD stay realistic and focused.",
      mode: "multi",
      options: ["No team sharing", "No advanced analytics", "No mobile app", "No admin dashboard", "Other"]
    })
  }

  questions.push({
    id: "planning_success_criteria",
    criterion: "success_criteria",
    fillsSections: ["success_criteria"],
    label: "What would make this first release feel clearly successful?",
    helper: "Think about the outcome you would want to see after using it.",
    mode: "multi",
    options: [
      "The core flow works end to end",
      "The experience feels simple and clear",
      "The reminders feel timely and trustworthy",
      "The product feels ready for everyday use",
      "Other"
    ]
  })

  questions.push({
    id: "planning_constraints",
    criterion: "constraints",
    fillsSections: ["constraints"],
    label: "What build constraints should this first version respect?",
    helper: "Think in terms of fast, practical product building with an AI-assisted tool.",
    mode: "multi",
    options: [
      "Keep the stack simple and easy to build",
      "Avoid paid services or keep costs very low",
      "Prefer web first",
      "Avoid complex custom backend work",
      "Use low-setup tools where possible",
      "Other"
    ]
  })

  return questions.slice(0, 5)
}

function buildFallbackDraft(input: GenerateProjectPlanningDraftRequest): GenerateProjectPlanningDraftResponse {
  const description = input.description.trim()
  const sections = [
    { id: "overview", title: "Product Overview", body: description },
    { id: "problem", title: "Problem", body: "The product needs to solve the core user pain described in the planning brief in a simple, focused first release." },
    { id: "target-user", title: "Target User", body: "The first release should focus on the main user described in the planning brief." },
    { id: "goal", title: "Primary Goal", body: "Deliver a first version that solves the main problem clearly and reliably without adding unrelated scope." },
    { id: "scope", title: "Scope", body: "Keep the first release focused on the narrowest complete version needed to deliver the core value." },
    { id: "requirements", title: "Core Requirements", body: "Build the must-have flows and product behaviors described in the planning brief and clarified answers." },
    { id: "non-goals", title: "Non-Goals", body: "Do not add extra features, nice-to-haves, or unrelated workflows unless they were explicitly clarified." },
    { id: "constraints", title: "Constraints", body: "Respect the current product boundaries, architecture, and delivery constraints described in the brief." },
    { id: "success", title: "Success Criteria", body: "The first release should work end to end, feel clear to the target user, and satisfy the clarified planning criteria." },
    { id: "implementation-phases", title: "Implementation Phases", body: "- Phase 1: Set up the core data and workflow needed for the main feature.\n- Phase 2: Build the primary user-facing experience.\n- Phase 3: Add validation, edge-case handling, and trust-building details.\n- Phase 4: Verify the flow against the success criteria before moving on." },
    { id: "assumptions-risks", title: "Assumptions / Risks", body: "The product still depends on any assumptions or missing details that were not fully resolved during planning." },
    { id: "implementation-handoff", title: "Implementation Handoff", body: buildImplementationHandoffBody() }
  ]

  const implementationPhases = [
    {
      id: "phase_1",
      title: "Phase 1 — Core setup",
      goal: "Set up the core structure needed for the main workflow.",
      buildScope: ["Define the core data/state shape", "Wire the smallest usable workflow path"],
      outOfScope: ["Do not start later-phase polish or optional features"],
      dataState: ["Core state needed to start and complete the main workflow"],
      deliverables: ["Core data shape or state", "Basic workflow wiring", "Narrow scope only"],
      acceptanceCriteria: ["The main workflow can be started", "No unrelated parts are changed"],
      validationProof: ["Show the main workflow can start with the expected state"]
    },
    {
      id: "phase_2",
      title: "Phase 2 — Main experience",
      goal: "Build the main user-facing flow for the first release.",
      buildScope: ["Build the primary user interaction", "Connect the UI to the Phase 1 workflow state"],
      outOfScope: ["Do not add unrelated secondary workflows"],
      dataState: ["State changes caused by the primary user actions"],
      deliverables: ["Primary UI and interaction flow", "Happy-path completion", "Clear user guidance"],
      acceptanceCriteria: ["A user can complete the main flow end to end", "The behavior matches the PRD scope"],
      validationProof: ["Show the happy path working end to end"]
    },
    {
      id: "phase_3",
      title: "Phase 3 — Validation and proof",
      goal: "Tighten the experience and validate it against the success criteria.",
      buildScope: ["Add validation and important edge-case handling", "Verify the first release against success criteria"],
      outOfScope: ["Do not expand the MVP scope"],
      dataState: ["Validation, empty, and edge-case states"],
      deliverables: ["Validation states", "Edge-case handling", "Concrete verification"],
      acceptanceCriteria: ["The success criteria are explicitly checked", "The implementation is validated before any next phase"],
      validationProof: ["List the concrete checks or tests completed"]
    }
  ]

  const submissionPrompt = [
    "Implement this PRD one phase at a time.",
    "",
    "Important sequencing rule:",
    "- Start with Phase 1 only.",
    "- Do not start Phase 2 until Phase 1 is finished and validated against its acceptance criteria.",
    "- After finishing the current phase, explain what changed and show concrete implementation validation proof before moving on.",
    "",
    "PRD",
    sections.map((section) => `${section.title}\n${section.body}`).join("\n\n"),
    "",
    "Implementation phases",
    implementationPhases
      .map(formatImplementationPhaseDetails)
      .join("\n\n"),
    "",
    "For this response, implement Phase 1 only."
  ].join("\n").trim()

  return {
    draft: {
      title: `${input.projectLabel} PRD draft`,
      summary: "This PRD draft was generated with a lightweight fallback because AI planning was unavailable.",
      sections,
      implementationPhases,
      submissionPrompt
    },
    aiAvailable: false,
    diagnostics: createPlanningDiagnostics({
      aiAvailable: false,
      fallbackUsed: true,
      providerName: null,
      durationMs: 0,
      errorReason: "debug_fallback_used",
      outputQualityStatus: "not_checked"
    })
  }
}

function buildSubmissionPromptFromDraft(draft: Omit<GeneratedPrdDraftPayload, "submissionPrompt">) {
  const renderList = (label: string, items: string[]) => items.length
    ? `${label}:\n${items.map((item) => `- ${item}`).join("\n")}`
    : ""
  const prdSections = draft.sections.filter((section) => section.id !== "implementation-handoff")
  const handoffBody =
    draft.sections.find((section) => section.id === "implementation-handoff")?.body.trim() ||
    buildImplementationHandoffBody()

  return [
    "Implement this PRD one phase at a time.",
    "",
    draft.title,
    "",
    draft.summary,
    "",
    "Sections",
    prdSections.map((section) => `${section.title}\n${section.body}`).join("\n\n"),
    "",
    "Implementation phases",
    draft.implementationPhases
      .map(
        (phase) =>
          [
            phase.title,
            `Goal: ${phase.goal}`,
            renderList("Build scope", phase.buildScope),
            renderList("Out of scope for this phase", phase.outOfScope),
            renderList("Data/state needed", phase.dataState),
            renderList("Implementation deliverables", phase.deliverables),
            renderList("Implementation acceptance criteria", phase.acceptanceCriteria),
            renderList("Implementation validation proof expected", phase.validationProof)
          ].filter(Boolean).join("\n")
      )
      .join("\n\n"),
    "",
    "Implementation handoff",
    handoffBody
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim()
}

function buildImplementationHandoffBody() {
  return [
    "- Implement Phase 1 only in the first assistant response.",
    "- Do not start Phase 2 until Phase 1 is finished and validated against its acceptance criteria.",
    "- After finishing Phase 1, explain what changed and show concrete implementation validation proof.",
    "- Treat real-user studies, cohort metrics, public beta/app-store release, business reports, and stakeholder approvals as external validation or release work, not as coding deliverables.",
    "- Wait for the user's confirmation before starting the next phase."
  ].join("\n")
}

function formatBulletList(items: string[]) {
  return items.map((item) => `- ${item}`).join("\n")
}

function formatPhaseList(label: string, items: string[]) {
  return items.length ? `${label}:\n${formatBulletList(items)}` : ""
}

function formatImplementationPhaseDetails(phase: GeneratedPrdDraftPayload["implementationPhases"][number]) {
  return [
    phase.title,
    `Goal: ${phase.goal}`,
    formatPhaseList("Build scope", phase.buildScope),
    formatPhaseList("Out of scope for this phase", phase.outOfScope),
    formatPhaseList("Data/state needed", phase.dataState),
    formatPhaseList("Implementation deliverables", phase.deliverables),
    formatPhaseList("Implementation acceptance criteria", phase.acceptanceCriteria),
    formatPhaseList("Implementation validation proof expected", phase.validationProof)
  ].filter(Boolean).join("\n")
}

const PRD_DRAFT_FIELD_PLACEHOLDERS = new Set([
  "title",
  "overview",
  "problem",
  "target user",
  "targetuser",
  "target user",
  "target_user",
  "goal",
  "scope",
  "primary goal"
])

function compactObjectStringAt(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ""
  const record = value as Record<string, unknown>

  for (const key of keys) {
    const stringValue = compactStringAt([record[key]], 0)
    if (stringValue) return stringValue
  }

  return ""
}

function buildPrdFieldsFromCompactDraft(blueprint: z.infer<typeof CompactProjectPlanningDraftSchema>) {
  const draftFields = blueprint.d
  const isArrayDraft = Array.isArray(draftFields)

  return {
    title: isArrayDraft ? compactStringAt(draftFields, 0) : compactObjectStringAt(draftFields, ["title"]),
    overview: isArrayDraft ? compactStringAt(draftFields, 1) : compactObjectStringAt(draftFields, ["overview"]),
    problem: isArrayDraft ? compactStringAt(draftFields, 2) : compactObjectStringAt(draftFields, ["problem"]),
    targetUser: isArrayDraft
      ? compactStringAt(draftFields, 3)
      : compactObjectStringAt(draftFields, ["targetUser", "target_user", "target"]),
    goal: isArrayDraft ? compactStringAt(draftFields, 4) : compactObjectStringAt(draftFields, ["goal", "primaryGoal", "primary_goal"]),
    scope: isArrayDraft ? compactStringAt(draftFields, 5) : compactObjectStringAt(draftFields, ["scope"]),
    requirements: compactStringArrayAt([blueprint.r], 0),
    nonGoals: compactStringArrayAt([blueprint.n], 0),
    constraints: compactStringArrayAt([blueprint.c], 0),
    successCriteria: compactStringArrayAt([blueprint.sc], 0),
    assumptionsRisks: compactStringArrayAt([blueprint.ar], 0)
  }
}

function buildDraftFromCompactPrd(
  blueprint: z.infer<typeof CompactProjectPlanningDraftSchema>
): GeneratedPrdDraftPayload {
  const prd = buildPrdFieldsFromCompactDraft(blueprint)
  const implementationPhases = blueprint.p.map((phase, index) => {
    const hasDetailedPhaseShape = Array.isArray(phase[5]) || Array.isArray(phase[6]) || Array.isArray(phase[7])
    const buildScope = hasDetailedPhaseShape ? compactStringArrayAt(phase, 2).slice(0, 3) : []
    const outOfScope = hasDetailedPhaseShape ? compactStringArrayAt(phase, 3).slice(0, 2) : []
    const dataState = hasDetailedPhaseShape ? compactStringArrayAt(phase, 4).slice(0, 2) : []
    const deliverables = (hasDetailedPhaseShape
      ? compactStringArrayAt(phase, 5)
      : Array.isArray(phase[2])
        ? compactStringArrayAt(phase, 2)
        : [compactStringAt(phase, 2), compactStringAt(phase, 3)].filter(Boolean)
    ).slice(0, 3)
    const acceptanceCriteria = (hasDetailedPhaseShape
      ? compactStringArrayAt(phase, 6)
      : Array.isArray(phase[3])
        ? compactStringArrayAt(phase, 3)
        : [compactStringAt(phase, 4), compactStringAt(phase, 5)].filter(Boolean)
    ).slice(0, 3)
    const validationProof = hasDetailedPhaseShape ? compactStringArrayAt(phase, 7).slice(0, 2) : []

    return {
      id: `phase_${index + 1}`,
      title: compactStringAt(phase, 0),
      goal: compactStringAt(phase, 1),
      buildScope,
      outOfScope,
      dataState,
      deliverables,
      acceptanceCriteria,
      validationProof
    }
  })
  const draftWithoutSubmissionPrompt = {
    title: prd.title,
    summary: prd.overview,
    sections: [
      { id: "overview", title: "Product Overview", body: prd.overview },
      { id: "problem", title: "Problem", body: prd.problem },
      { id: "target-user", title: "Target User", body: prd.targetUser },
      { id: "goal", title: "Primary Goal", body: prd.goal },
      { id: "scope", title: "Scope", body: prd.scope },
      { id: "requirements", title: "Core Requirements", body: formatBulletList(prd.requirements) },
      { id: "non-goals", title: "Non-Goals", body: formatBulletList(prd.nonGoals) },
      { id: "constraints", title: "Constraints", body: formatBulletList(prd.constraints) },
      { id: "success", title: "Success Criteria", body: formatBulletList(prd.successCriteria) },
      {
        id: "implementation-phases",
        title: "Implementation Phases",
        body: implementationPhases
          .map((phase) => `- ${phase.title}: ${phase.goal}`)
          .join("\n")
      },
      { id: "assumptions-risks", title: "Assumptions / Risks", body: formatBulletList(prd.assumptionsRisks) },
      { id: "implementation-handoff", title: "Implementation Handoff", body: buildImplementationHandoffBody() }
    ],
    implementationPhases
  }

  return {
    ...draftWithoutSubmissionPrompt,
    submissionPrompt: buildSubmissionPromptFromDraft(draftWithoutSubmissionPrompt)
  }
}

function buildProjectPlanningDraftResponseFromCompactData(input: {
  description: string
  resolvedDraftInputs: ReturnType<typeof buildResolvedDraftInputs>
  compactData: CompactProjectPlanningDraftPayload
  diagnostics: ProjectPlanningDiagnosticsPayload
}): GenerateProjectPlanningDraftResponse {
  const draft = buildDraftFromCompactPrd(input.compactData)
  const parsedDraft = GenerateProjectPlanningDraftResponseSchema.shape.draft.parse(draft)
  const shiftedSection = parsedDraft.sections.find((section) =>
    PRD_DRAFT_FIELD_PLACEHOLDERS.has(normalizeTextForQuality(section.body))
  )
  if (shiftedSection) {
    throw new ProjectPlanningAiError(
      `The PRD draft mapped "${shiftedSection.body}" into ${shiftedSection.title}.`,
      {
        ...input.diagnostics,
        errorReason: "prd_section_mapping_failed",
        outputQualityStatus: "failed"
      }
    )
  }

  const qualityError = validatePrdSpecificity({
    description: input.description,
    resolvedDraftInputs: input.resolvedDraftInputs,
    draft: parsedDraft
  })

  if (qualityError) {
    throw new ProjectPlanningAiError(
      qualityError,
      {
        ...input.diagnostics,
        errorReason: "prd_quality_failed",
        outputQualityStatus: "failed"
      }
    )
  }

  return {
    draft: parsedDraft,
    aiAvailable: true,
    diagnostics: input.diagnostics
  }
}

function buildProjectPlanningDraftResponseFromModelData(input: {
  description: string
  resolvedDraftInputs: ReturnType<typeof buildResolvedDraftInputs>
  modelData: ProjectPlanningDraftModelPayload
  diagnostics: ProjectPlanningDiagnosticsPayload
}): GenerateProjectPlanningDraftResponse {
  return buildProjectPlanningDraftResponseFromCompactData({
    description: input.description,
    resolvedDraftInputs: input.resolvedDraftInputs,
    compactData: draftModelToCompact(input.modelData),
    diagnostics: input.diagnostics
  })
}

async function runProjectPlanningDraftProviderRace(input: {
  description: string
  resolvedDraftInputs: ReturnType<typeof buildResolvedDraftInputs>
  systemPrompt: string
  userPrompt: string
  maxTokens: number
  metadata?: ProjectPlanningRequestMetadata
  providers?: ProjectPlanningProvider[]
  timeoutMs?: number
}): Promise<GenerateProjectPlanningDraftResponse> {
  const providers = input.providers ?? buildProjectPlanningRaceProviders({
    hasKimiApiKey: Boolean(env.KIMI_API_KEY),
    hasDeepSeekApiKey: Boolean(env.DEEPSEEK_API_KEY),
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    maxTokens: input.maxTokens
  })

  if (!providers.length) {
    throw new ProjectPlanningAiError(
      "AI planning provider is not configured.",
      createPlanningDiagnostics({
        aiAvailable: false,
          providerName: null,
          durationMs: 0,
          metadata: input.metadata,
          errorReason: "provider_not_configured",
          outputQualityStatus: "not_checked"
        })
    )
  }

  const startedAt = Date.now()
  const attempts: ProjectPlanningProviderAttempt[] = []
  const controllers = providers.map(() => new AbortController())
  const timeoutMs = input.timeoutMs ?? PROJECT_PLANNING_PROVIDER_TIMEOUT_MS

  return new Promise((resolve, reject) => {
    let settled = false
    let finishedCount = 0
    const timeoutId = setTimeout(() => {
      for (const controller of controllers) {
        controller.abort()
      }
    }, timeoutMs)

    const finishFailure = () => {
      if (settled || finishedCount < providers.length) return
      clearTimeout(timeoutId)

      const timedOut = attempts.some((attempt) => attempt.status === "timeout")
      reject(new ProjectPlanningAiError(
        timedOut
          ? `Project Planning draft providers timed out after ${timeoutMs / 1000}s.`
          : "Project Planning draft providers did not return a valid PRD.",
        createPlanningDiagnostics({
          aiAvailable: false,
          providerName: null,
          durationMs: Date.now() - startedAt,
          metadata: input.metadata,
          errorReason: timedOut ? "provider_timeout" : "provider_error",
          malformedJson: attempts.some((attempt) => attempt.malformedJson),
          repairAttempted: attempts.some((attempt) => attempt.repairAttempted),
          repairSucceeded: attempts.some((attempt) => attempt.repairSucceeded),
          outputQualityStatus: attempts.some((attempt) => attempt.outputQualityStatus === "failed")
            ? "failed"
            : "not_checked",
          providerAttempts: attempts
        })
      ))
    }

    providers.forEach((provider, index) => {
      const controller = controllers[index]
      const providerStartedAt = Date.now()

      void callProviderWithOneRetry(provider, controller.signal)
        .then(async ({ raw, retryCount }) => {
          if (settled) return

          const parseResult = await parseProjectPlanningJsonWithRepair({
            raw,
            provider,
            schemaDescription: PROJECT_PLANNING_DRAFT_JSON_SCHEMA_DESCRIPTION,
            signal: controller.signal,
            startedAt,
            timeoutMs
          })
          const modelData = ProjectPlanningDraftModelSchema.parse(parseResult.data)
          const durationMs = Date.now() - providerStartedAt
          const nextAttempts: ProjectPlanningProviderAttempt[] = [
            ...attempts,
            {
              providerName: provider.name,
              durationMs,
              status: "success",
              retryCount,
              malformedJson: parseResult.malformedJson,
              repairAttempted: parseResult.repairAttempted,
              repairSucceeded: parseResult.repairSucceeded,
              outputQualityStatus: "passed"
            }
          ]
          providers.forEach((otherProvider, otherIndex) => {
            if (otherIndex === index) return
            if (attempts.some((attempt) => attempt.providerName === otherProvider.name)) return
            nextAttempts.push({
              providerName: otherProvider.name,
              durationMs: Date.now() - startedAt,
              status: "aborted",
              errorReason: "race_lost",
              outputQualityStatus: "not_checked"
            })
          })
          const diagnostics = createPlanningDiagnostics({
            aiAvailable: true,
            providerName: provider.name,
            durationMs: Date.now() - startedAt,
            metadata: input.metadata,
            malformedJson: parseResult.malformedJson,
            repairAttempted: parseResult.repairAttempted,
            repairSucceeded: parseResult.repairSucceeded,
            outputQualityStatus: "passed",
            providerAttempts: nextAttempts
          })
          const response = buildProjectPlanningDraftResponseFromModelData({
            description: input.description,
            resolvedDraftInputs: input.resolvedDraftInputs,
            modelData,
            diagnostics
          })

          settled = true
          clearTimeout(timeoutId)
          controllers.forEach((otherController, otherIndex) => {
            if (otherIndex !== index) otherController.abort()
          })
          resolve(response)
        })
        .catch((error) => {
          if (settled) return

          const durationMs = Date.now() - providerStartedAt
          const timedOut = controller.signal.aborted
          const qualityFailed = error instanceof ProjectPlanningAiError
          const jsonRepairMetadata = getJsonRepairMetadata(error)
          attempts.push({
            providerName: provider.name,
            durationMs,
            status: timedOut ? "timeout" : "failed",
            retryCount: getRetryCountFromError(error),
            ...jsonRepairMetadata,
            errorReason: timedOut
              ? "provider_timeout"
              : qualityFailed
                ? error.diagnostics.errorReason ?? error.message
                : error instanceof Error
                  ? error.message
                  : "provider_error",
            outputQualityStatus: qualityFailed
              ? error.diagnostics.outputQualityStatus
              : timedOut
                ? "not_checked"
                : "failed"
          })
          finishedCount += 1
          finishFailure()
        })
    })
  })
}

export async function runProjectPlanningAnalysis(
  input: AnalyzeProjectPlanningRequest
): Promise<AnalyzeProjectPlanningResponse> {
  const { systemPrompt, userPrompt, maxTokens } = buildProjectPlanningAnalysisPromptInput(input)

  return runProjectPlanningAnalysisProviderRace({
    description: input.description,
    systemPrompt,
    userPrompt,
    maxTokens,
    metadata: buildProjectPlanningRequestMetadata({
      description: input.description,
      projectLabel: input.projectLabel,
      promptKind: "requirements"
    })
  })
}

export async function runProjectPlanningDraft(
  input: GenerateProjectPlanningDraftRequest
): Promise<GenerateProjectPlanningDraftResponse> {
  const resolvedDraftInputs = buildResolvedDraftInputs(input)
  const prdSnapshot = input.prdSnapshot ?? buildPrdSnapshotFromCoverageReport(input.coverageReport)
  const compactDraftContext = buildCompactDraftContext(resolvedDraftInputs, prdSnapshot)
  const { systemPrompt, userPrompt, maxTokens } = buildProjectPlanningDraftPromptInput({
    projectLabel: input.projectLabel,
    compactDraftContext
  })

  return runProjectPlanningDraftProviderRace({
    description: input.description,
    resolvedDraftInputs,
    systemPrompt,
    userPrompt,
    maxTokens,
    metadata: buildProjectPlanningRequestMetadata({
      description: input.description,
      projectLabel: input.projectLabel,
      promptKind: "prd_draft"
    }),
    timeoutMs: PROJECT_PLANNING_DRAFT_PROVIDER_TIMEOUT_MS
  })
}
