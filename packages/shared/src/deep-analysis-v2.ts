import * as z from "zod"

export const DEEP_ANALYSIS_V2_VERSION = "deep-analysis-v2.v1"

export const DeepAnalysisV2RequirementStatusSchema = z.enum(["pass", "missing", "unclear"])
export const DeepAnalysisV2OverallStatusSchema = z.enum(["pass", "needs_confirmation", "risky", "fail"])
export const DeepAnalysisV2ConfidenceSchema = z.enum(["low", "medium", "high"])
export const DeepAnalysisV2NextStepSourceSchema = z.enum([
  "assistant_suggestion",
  "project_memory",
  "system_inferred",
  "unavailable"
])
export const DeepAnalysisV2PromptIntentSchema = z.enum([
  "implement_next_step",
  "confirm_missing_requirements",
  "ask_for_next_step",
  "review_before_advancing"
])

export const DeepAnalysisV2RequirementSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  source: z.enum(["submitted_prompt", "project_memory"]).default("submitted_prompt")
})

export const DeepAnalysisV2RequirementMatchSchema = z.object({
  requirementId: z.string().min(1),
  requirementText: z.string().min(1),
  status: DeepAnalysisV2RequirementStatusSchema,
  evidence: z.array(z.string()).max(3).default([]),
  note: z.string().default("")
})

export const DeepAnalysisV2ProviderMetadataSchema = z.object({
  provider: z.enum(["kimi", "deepseek", "fallback", "none"]),
  model: z.string().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  timedOut: z.boolean().default(false),
  usedFallback: z.boolean().default(false),
  providerAttempted: z.enum(["kimi", "deepseek", "none"]).optional(),
  fallbackReason: z
    .enum(["mocks_enabled", "missing_key", "timeout", "empty_response", "invalid_json", "provider_error", "unknown"])
    .optional(),
  failureMessage: z.string().optional(),
  kimiLatencyMs: z.number().int().nonnegative().optional(),
  deepSeekAttempted: z.boolean().optional(),
  deepSeekLatencyMs: z.number().int().nonnegative().optional(),
  deepSeekFailureReason: z
    .enum(["missing_key", "timeout", "empty_response", "invalid_json", "provider_error", "unknown"])
    .optional()
})

export const DeepAnalysisV2ResultSchema = z.object({
  version: z.literal(DEEP_ANALYSIS_V2_VERSION).default(DEEP_ANALYSIS_V2_VERSION),
  requirements: z.array(DeepAnalysisV2RequirementSchema).max(12).default([]),
  requirementMatches: z.array(DeepAnalysisV2RequirementMatchSchema).max(12).default([]),
  overallStatus: DeepAnalysisV2OverallStatusSchema,
  assistantSuggestedNextMove: z.string().nullable().default(null),
  recommendedNextMove: z.string().min(1),
  nextStepSource: DeepAnalysisV2NextStepSourceSchema.default("unavailable"),
  nextStepRequirements: z.array(z.string().min(1)).max(8).default([]),
  blockedScope: z.array(z.string().min(1)).max(8).default([]),
  promptIntent: DeepAnalysisV2PromptIntentSchema.default("review_before_advancing"),
  generatedPrompt: z.string().default(""),
  confidence: DeepAnalysisV2ConfidenceSchema,
  userExplanation: z.string().min(1),
  providerMetadata: DeepAnalysisV2ProviderMetadataSchema
})

export const DeepAnalysisV2RequestSchema = z.object({
  promptText: z.string().min(1),
  responseText: z.string().min(1),
  projectContext: z.string().default(""),
  currentState: z.string().default(""),
  taskType: z.string().default("creation"),
  surface: z.enum(["chatgpt", "replit", "lovable", "unknown"]).default("unknown")
})

export type DeepAnalysisV2RequirementStatus = z.infer<typeof DeepAnalysisV2RequirementStatusSchema>
export type DeepAnalysisV2OverallStatus = z.infer<typeof DeepAnalysisV2OverallStatusSchema>
export type DeepAnalysisV2Confidence = z.infer<typeof DeepAnalysisV2ConfidenceSchema>
export type DeepAnalysisV2NextStepSource = z.infer<typeof DeepAnalysisV2NextStepSourceSchema>
export type DeepAnalysisV2PromptIntent = z.infer<typeof DeepAnalysisV2PromptIntentSchema>
export type DeepAnalysisV2Requirement = z.infer<typeof DeepAnalysisV2RequirementSchema>
export type DeepAnalysisV2RequirementMatch = z.infer<typeof DeepAnalysisV2RequirementMatchSchema>
export type DeepAnalysisV2ProviderMetadata = z.infer<typeof DeepAnalysisV2ProviderMetadataSchema>
export type DeepAnalysisV2Result = z.infer<typeof DeepAnalysisV2ResultSchema>
export type DeepAnalysisV2Request = z.infer<typeof DeepAnalysisV2RequestSchema>

export function parseDeepAnalysisV2Result(value: unknown): DeepAnalysisV2Result {
  return DeepAnalysisV2ResultSchema.parse(value)
}
