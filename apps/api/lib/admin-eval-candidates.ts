import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import * as z from "zod"

export const EvalCandidateStatusSchema = z.enum([
  "pending",
  "accepted",
  "rejected",
  "needs_edit",
  "product_rule_issue"
])

const SignalSnapshotSchema = z
  .object({
    source: z.enum(["ai", "local_heuristic", "none"]).optional(),
    kind: z.string().optional(),
    nextMoveType: z.string().optional(),
    currentStepClaim: z.string().optional(),
    confidenceLevel: z.string().optional(),
    targetLabel: z.string().nullable().optional(),
    targetPhaseNumber: z.number().nullable().optional()
  })
  .passthrough()
  .nullable()
  .default(null)

const DecisionSnapshotSchema = z
  .object({
    status: z.string(),
    recommendationKind: z.string(),
    title: z.string(),
    primaryCtaLabel: z.string()
  })
  .passthrough()
  .nullable()
  .default(null)

const SimpleNextPromptDecisionSnapshotSchema = z
  .object({
    version: z.string(),
    status: z.enum(["needs_confirmation", "ready_for_next_prompt"]),
    rolloutMode: z.enum(["off", "shadow", "on"]).optional(),
    applied: z.boolean().optional(),
    requirementStatus: z.enum(["pass", "needs_confirmation"]),
    confirmedCount: z.number().int().nonnegative(),
    missingCount: z.number().int().nonnegative(),
    missingRequirements: z.array(z.string()).default([]),
    optimizedPrompt: z.string().default(""),
    assistantSuggestedNextMove: z.string().nullable().default(null)
  })
  .passthrough()
  .nullable()
  .default(null)

const DeepAnalysisV2DecisionSnapshotSchema = z
  .object({
    version: z.string(),
    analysisId: z.string().optional(),
    analysisVersion: z.string().optional(),
    analysisState: z.enum(["idle", "quick_check_ready", "v2_running", "v2_ready", "v2_unavailable", "stale"]).optional(),
    analysisMode: z.enum(["standard", "large_input_checkpoint"]).optional(),
    threadId: z.string().optional(),
    messageId: z.string().optional(),
    submittedPromptHash: z.string().optional(),
    assistantAnswerHash: z.string().optional(),
    surface: z.enum(["chatgpt", "replit", "lovable", "unknown"]).optional(),
    completedAt: z.string().optional(),
    rolloutMode: z.enum(["off", "shadow", "on"]).optional(),
    applied: z.boolean().optional(),
    provider: z.enum(["openai", "kimi", "deepseek", "fallback", "none"]),
    model: z.string().optional(),
    latencyMs: z.number().int().nonnegative().optional(),
    providerAttempted: z.enum(["openai", "kimi", "deepseek", "none"]).optional(),
    fallbackReason: z.string().optional(),
    failureMessage: z.string().optional(),
    kimiLatencyMs: z.number().int().nonnegative().optional(),
    deepSeekAttempted: z.boolean().optional(),
    deepSeekLatencyMs: z.number().int().nonnegative().optional(),
    deepSeekFailureReason: z.string().optional(),
    overallStatus: z.enum(["pass", "needs_confirmation", "risky", "fail", "unavailable"]),
    confidence: z.enum(["low", "medium", "high"]),
    requirementCount: z.number().int().nonnegative(),
    missingCount: z.number().int().nonnegative(),
    assistantSuggestedNextMove: z.string().nullable().default(null),
    nextStepSource: z.enum(["assistant_suggestion", "project_memory", "system_inferred", "unavailable"]).optional(),
    nextStepRequirements: z.array(z.string()).optional(),
    blockedScope: z.array(z.string()).optional(),
    promptIntent: z
      .enum(["implement_next_step", "confirm_missing_requirements", "ask_for_next_step", "review_before_advancing"])
      .optional(),
    generatedPrompt: z.string().default("")
  })
  .passthrough()
  .nullable()
  .default(null)

const DeepAnalysisV2ComparisonSnapshotSchema = z
  .object({
    v1Decision: z.string().nullable().default(null),
    v2Decision: z.string(),
    agreement: z.enum(["agree", "disagree", "unknown"]),
    provider: z.enum(["openai", "kimi", "deepseek", "fallback", "none"]),
    latencyMs: z.number().int().nonnegative().optional(),
    generatedPrompt: z.string().default("")
  })
  .passthrough()
  .nullable()
  .default(null)

export const EvalCandidateSchema = z
  .object({
    candidateId: z.string().min(1),
    status: EvalCandidateStatusSchema.default("pending"),
    reasons: z.array(z.string()).default([]),
    sourceEventIds: z.array(z.string()).default([]),
    projectKey: z.string().optional(),
    projectLabel: z.string().optional(),
    promptText: z.string().default(""),
    responseText: z.string().default(""),
    taskType: z.string().default("unknown"),
    analysisStatus: z.string().default("unknown"),
    confidence: z.string().default("unknown"),
    workflowState: z.string().nullable().optional(),
    finalDecision: DecisionSnapshotSchema,
    selectedSignal: SignalSnapshotSchema,
    aiSignal: SignalSnapshotSchema,
    localSignal: SignalSnapshotSchema,
    signalSource: z.enum(["ai", "local_heuristic", "none"]).default("none"),
    signalAgreement: z.enum(["agree", "disagree", "ai_only", "local_only", "none"]).default("none"),
    simpleNextPromptDecision: SimpleNextPromptDecisionSnapshotSchema,
    deepAnalysisV2Decision: DeepAnalysisV2DecisionSnapshotSchema,
    deepAnalysisV2Comparison: DeepAnalysisV2ComparisonSnapshotSchema,
    suggestedExpectedDecision: DecisionSnapshotSchema,
    reviewerNote: z.string().optional(),
    expectedDecisionNote: z.string().optional(),
    rubricNote: z.string().optional(),
    createdAt: z.string().default(() => new Date().toISOString()),
    updatedAt: z.string().default(() => new Date().toISOString())
  })
  .passthrough()

export const EvalCandidateUpsertRequestSchema = z.object({
  source: z.enum(["admin", "extension"]).default("admin"),
  replace: z.boolean().default(false),
  candidates: z.array(EvalCandidateSchema)
})

export type EvalCandidateRecord = z.infer<typeof EvalCandidateSchema>
export type EvalCandidateUpsertSource = z.infer<typeof EvalCandidateUpsertRequestSchema>["source"]

const CANDIDATE_STORE_PATH = resolve(process.cwd(), ".tmp/admin-next-move-eval-candidates.json")

async function readCandidateStore() {
  try {
    const file = await readFile(CANDIDATE_STORE_PATH, "utf8")
    const parsed = JSON.parse(file) as unknown
    const candidates = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { candidates?: unknown[] }).candidates)
        ? (parsed as { candidates: unknown[] }).candidates
        : []
    return z.array(EvalCandidateSchema).parse(candidates)
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return []
    throw error
  }
}

async function writeCandidateStore(candidates: EvalCandidateRecord[]) {
  await mkdir(dirname(CANDIDATE_STORE_PATH), { recursive: true })
  await writeFile(
    CANDIDATE_STORE_PATH,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        candidates
      },
      null,
      2
    )
  )
}

function preserveReviewFields(existing: EvalCandidateRecord, incoming: EvalCandidateRecord, source: EvalCandidateUpsertSource) {
  if (source === "admin") return incoming

  return {
    ...incoming,
    status: existing.status === "pending" ? incoming.status : existing.status,
    reviewerNote: existing.reviewerNote || incoming.reviewerNote,
    expectedDecisionNote: existing.expectedDecisionNote || incoming.expectedDecisionNote,
    rubricNote: existing.rubricNote || incoming.rubricNote,
    updatedAt: existing.updatedAt > incoming.updatedAt ? existing.updatedAt : incoming.updatedAt
  }
}

export async function listAdminEvalCandidates() {
  return readCandidateStore()
}

export async function upsertAdminEvalCandidates(input: {
  candidates: EvalCandidateRecord[]
  source: EvalCandidateUpsertSource
  replace?: boolean
}) {
  const existing = await readCandidateStore()
  const byId = input.replace ? new Map<string, EvalCandidateRecord>() : new Map(existing.map((candidate) => [candidate.candidateId, candidate]))
  const now = new Date().toISOString()

  for (const candidate of input.candidates) {
    const normalizedCandidate = {
      ...candidate,
      updatedAt: candidate.updatedAt || now
    }
    const previous = byId.get(candidate.candidateId)
    byId.set(
      candidate.candidateId,
      previous
        ? preserveReviewFields(previous, { ...previous, ...normalizedCandidate }, input.source)
        : normalizedCandidate
    )
  }

  const next = Array.from(byId.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 500)
  await writeCandidateStore(next)
  return next
}
