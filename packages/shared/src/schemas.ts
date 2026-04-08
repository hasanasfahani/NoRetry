import * as z from "zod"
import { PROMPT_INTENTS, STRENGTH_SCORES } from "./constants"

export const StrengthScoreSchema = z.enum(STRENGTH_SCORES)
export const PromptIntentSchema = z.enum(PROMPT_INTENTS)
export const PromptSurfaceSchema = z.enum(["REPLIT", "CHATGPT"])

export const SessionSummarySchema = z.object({
  sessionId: z.string(),
  lastPrompts: z.array(z.string()).max(3).default([]),
  lastOptimizedPrompts: z.array(z.string()).max(3).default([]),
  lastIntent: PromptIntentSchema.optional(),
  retryCount: z.number().int().min(0).default(0),
  lastIssueDetected: z.string().nullable().default(null),
  lastProbableStatus: z.enum(["SUCCESS", "FAILURE", "UNKNOWN"]).default("UNKNOWN")
})

export const AnalyzePromptRequestSchema = z.object({
  prompt: z.string(),
  surface: PromptSurfaceSchema.optional(),
  sessionSummary: SessionSummarySchema.partial().optional()
})

export const ClarificationQuestionSchema = z.object({
  id: z.string(),
  label: z.string(),
  helper: z.string(),
  mode: z.enum(["single", "multi"]),
  options: z.array(z.string()).min(2).max(6).default([])
})

export const AnalyzePromptResponseSchema = z.object({
  score: StrengthScoreSchema,
  intent: PromptIntentSchema,
  missing_elements: z.array(z.string()).max(4),
  suggestions: z.array(z.string()).max(4),
  rewrite: z.string().nullable(),
  clarification_questions: z.array(ClarificationQuestionSchema).max(10).default([]),
  draft_prompt: z.string().nullable().default(null),
  question_source: z.enum(["AI", "FALLBACK", "NONE"]).default("NONE"),
  ai_available: z.boolean().default(false)
})

export const ExtendQuestionsRequestSchema = z.object({
  prompt: z.string(),
  surface: PromptSurfaceSchema.optional(),
  intent: PromptIntentSchema,
  existing_questions: z.array(ClarificationQuestionSchema).max(10).default([]),
  answers: z.record(z.union([z.string(), z.array(z.string())])).default({}),
  sessionSummary: SessionSummarySchema.partial().optional()
})

export const ExtendQuestionsResponseSchema = z.object({
  clarification_questions: z.array(ClarificationQuestionSchema).max(3).default([]),
  ai_available: z.boolean().default(false)
})

export const RefinePromptRequestSchema = z.object({
  prompt: z.string(),
  surface: PromptSurfaceSchema.optional(),
  intent: PromptIntentSchema,
  answers: z.record(z.union([z.string(), z.array(z.string())])),
  sessionSummary: SessionSummarySchema.partial().optional()
})

export const RefinePromptResponseSchema = z.object({
  improved_prompt: z.string(),
  notes: z.array(z.string()).max(3).default([])
})

export const DetectionFlagsSchema = z.object({
  retry_pattern: z.boolean().default(false),
  error_detected: z.boolean().default(false),
  scope_drift: z.boolean().default(false),
  possible_vagueness: z.boolean().default(false),
  looping_behavior: z.boolean().default(false),
  overreach_detected: z.boolean().default(false)
})

export const DetectOutcomeRequestSchema = z.object({
  session_id: z.string(),
  prompt_id: z.string(),
  original_prompt: z.string().optional(),
  optimized_prompt: z.string().nullable().optional(),
  strength_score: StrengthScoreSchema.optional(),
  final_sent_prompt: z.string(),
  prompt_intent: PromptIntentSchema,
  output_snippet: z.string().max(500).default(""),
  error_summary: z.string().max(300).nullable().optional(),
  retry_count: z.number().int().min(0).default(0),
  changed_files_count: z.number().int().min(0).default(0),
  changed_file_paths_summary: z.array(z.string()).max(20).default([]),
  timestamps: z.object({
    promptSentAt: z.string(),
    evaluatedAt: z.string()
  })
})

export const DetectOutcomeResponseSchema = z.object({
  outcome_event_id: z.string(),
  detection_flags: DetectionFlagsSchema,
  probable_status: z.enum(["SUCCESS", "FAILURE", "UNKNOWN"]),
  should_suggest_diagnosis: z.boolean(),
  success_reasons: z.array(z.string()).max(3),
  concise_issue: z.string().nullable()
})

export const DiagnoseFailureRequestSchema = z.object({
  session_id: z.string(),
  prompt_id: z.string(),
  outcome_event_id: z.string().optional(),
  final_sent_prompt: z.string(),
  prompt_intent: PromptIntentSchema,
  output_snippet: z.string().max(500).default(""),
  error_summary: z.string().max(300).nullable().optional(),
  changed_files_count: z.number().int().min(0).default(0),
  changed_file_paths_summary: z.array(z.string()).max(20).default([]),
  detection_flags: DetectionFlagsSchema,
  sessionSummary: SessionSummarySchema.partial().optional()
})

export const DiagnoseFailureResponseSchema = z.object({
  why_it_likely_failed: z.array(z.string()).max(2),
  what_the_ai_likely_misunderstood: z.string(),
  what_to_fix_next_time: z.array(z.string()).max(3),
  improved_retry_prompt: z.string().nullable(),
  source_type: z.enum(["LLM", "CACHE"]),
  token_estimate: z.number().int().min(0)
})

export const FeedbackRequestSchema = z.object({
  outcome_event_id: z.string(),
  feedback_type: z.enum(["WORKED", "DID_NOT_WORK"])
})

export type AnalyzePromptRequest = z.infer<typeof AnalyzePromptRequestSchema>
export type AnalyzePromptResponse = z.infer<typeof AnalyzePromptResponseSchema>
export type ClarificationQuestion = z.infer<typeof ClarificationQuestionSchema>
export type ExtendQuestionsRequest = z.infer<typeof ExtendQuestionsRequestSchema>
export type ExtendQuestionsResponse = z.infer<typeof ExtendQuestionsResponseSchema>
export type RefinePromptRequest = z.infer<typeof RefinePromptRequestSchema>
export type RefinePromptResponse = z.infer<typeof RefinePromptResponseSchema>
export type DetectOutcomeRequest = z.infer<typeof DetectOutcomeRequestSchema>
export type DetectOutcomeResponse = z.infer<typeof DetectOutcomeResponseSchema>
export type DiagnoseFailureRequest = z.infer<typeof DiagnoseFailureRequestSchema>
export type DiagnoseFailureResponse = z.infer<typeof DiagnoseFailureResponseSchema>
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>
export type SessionSummary = z.infer<typeof SessionSummarySchema>
export type PromptIntent = z.infer<typeof PromptIntentSchema>
export type PromptSurface = z.infer<typeof PromptSurfaceSchema>
export type StrengthScore = z.infer<typeof StrengthScoreSchema>
export type DetectionFlags = z.infer<typeof DetectionFlagsSchema>
