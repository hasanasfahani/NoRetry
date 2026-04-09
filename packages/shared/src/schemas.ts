import * as z from "zod"
import { PROMPT_INTENTS, STRENGTH_SCORES } from "./constants"

export const StrengthScoreSchema = z.enum(STRENGTH_SCORES)
export const PromptIntentSchema = z.enum(PROMPT_INTENTS)
export const PromptSurfaceSchema = z.enum(["REPLIT", "CHATGPT"])
export const AfterTaskTypeSchema = z.enum(["debug", "build", "refactor", "explain"])
export const AfterStatusSchema = z.enum(["SUCCESS", "PARTIAL", "FAILED", "UNVERIFIED"])
export const AfterConfidenceSchema = z.enum(["low", "medium", "high"])
export const AttemptPlatformSchema = z.enum(["chatgpt", "replit"])
export const AttemptStatusSchema = z.enum(["draft", "submitted", "analyzed"])
export const UnifiedTaskTypeSchema = z.enum(["debug", "build", "refactor", "explain", "create_ui", "other"])
export const VerdictStatusSchema = z.enum([
  "SUCCESS",
  "LIKELY_SUCCESS",
  "PARTIAL",
  "FAILED",
  "WRONG_DIRECTION",
  "UNVERIFIED"
])

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

export const AfterIntentSchema = z.object({
  goal: z.string(),
  task_type: AfterTaskTypeSchema,
  acceptance_criteria: z.array(z.string()).max(5).default([])
})

export const AttemptIntentSchema = z.object({
  task_type: UnifiedTaskTypeSchema,
  goal: z.string(),
  constraints: z.array(z.string()).max(6).default([]),
  acceptance_criteria: z.array(z.string()).max(6).default([])
})

export const AttemptSchema = z.object({
  attempt_id: z.string(),
  platform: AttemptPlatformSchema,
  raw_prompt: z.string(),
  optimized_prompt: z.string(),
  intent: AttemptIntentSchema,
  status: AttemptStatusSchema,
  created_at: z.string(),
  submitted_at: z.string().nullable().optional(),
  response_text: z.string().nullable().optional(),
  response_message_id: z.string().nullable().optional(),
  analysis_result: z.unknown().nullable().optional(),
  token_usage_total: z.number().int().min(0).default(0),
  stage_cache: z.record(z.unknown()).default({})
})

export const ArtifactSummarySchema = z.object({
  response_length: z.number().int().min(0),
  contains_code: z.boolean(),
  mentioned_files: z.array(z.string()).max(20).default([]),
  claims_success: z.boolean(),
  uncertainty_detected: z.boolean()
})

export const ResponsePreprocessorOutputSchema = z.object({
  response_text: z.string(),
  response_length: z.number().int().min(0),
  first_excerpt: z.string(),
  last_excerpt: z.string(),
  key_paragraphs: z.array(z.string()).max(2).default([]),
  has_code_blocks: z.boolean(),
  mentioned_files: z.array(z.string()).max(20).default([]),
  certainty_signals: z.array(z.string()).max(6).default([]),
  uncertainty_signals: z.array(z.string()).max(6).default([]),
  success_signals: z.array(z.string()).max(6).default([]),
  failure_signals: z.array(z.string()).max(6).default([])
})

export const Stage1OutputSchema = z.object({
  assistant_action_summary: z.string(),
  claimed_evidence: z.array(z.string()).max(4).default([]),
  response_mode: z.enum(["implemented", "suggested", "explained", "uncertain"]),
  scope_assessment: z.enum(["narrow", "moderate", "broad"])
})

export const Stage2OutputSchema = z.object({
  addressed_criteria: z.array(z.string()).max(6).default([]),
  missing_criteria: z.array(z.string()).max(6).default([]),
  constraint_risks: z.array(z.string()).max(6).default([]),
  problem_fit: z.enum(["correct", "partial", "wrong_direction"]),
  analysis_notes: z.array(z.string()).max(4).default([])
})

export const VerdictOutputSchema = z.object({
  status: VerdictStatusSchema,
  confidence: AfterConfidenceSchema,
  confidence_reason: z.string().max(180).default(""),
  findings: z.array(z.string()).max(3).default([]),
  issues: z.array(z.string()).max(6).default([])
})

export const NextPromptOutputSchema = z.object({
  next_prompt: z.string(),
  prompt_strategy: z.enum(["validate", "fix_missing", "narrow_scope", "retry_cleanly"])
})

export const AfterAnalysisResultSchema = z.object({
  status: VerdictStatusSchema,
  confidence: AfterConfidenceSchema,
  confidence_reason: z.string().max(180).default(""),
  inspection_depth: z.enum(["summary_only", "targeted_text", "targeted_code"]).default("summary_only"),
  findings: z.array(z.string()).max(3).default([]),
  issues: z.array(z.string()).max(6).default([]),
  next_prompt: z.string(),
  prompt_strategy: z.enum(["validate", "fix_missing", "narrow_scope", "retry_cleanly"]),
  stage_1: Stage1OutputSchema,
  stage_2: Stage2OutputSchema,
  verdict: VerdictOutputSchema,
  next_prompt_output: NextPromptOutputSchema,
  response_summary: ResponsePreprocessorOutputSchema,
  used_fallback_intent: z.boolean().default(false),
  token_usage_total: z.number().int().min(0).default(0)
})

export const AfterHeuristicResultSchema = z.object({
  preliminary_status: AfterStatusSchema,
  heuristic_flags: z.array(z.string()).max(10).default([])
})

export const AfterEvaluationResultSchema = z.object({
  status: AfterStatusSchema,
  confidence: AfterConfidenceSchema,
  findings: z.array(z.string()).max(3).default([]),
  issues: z.array(z.string()).max(5).default([]),
  next_prompt: z.string(),
  source: z.enum(["HEURISTIC", "LLM", "HEURISTIC_PLUS_LLM"]).default("HEURISTIC")
})

export const AfterLlmRequestSchema = z.object({
  intent: AfterIntentSchema,
  artifact_summary: ArtifactSummarySchema,
  snippets: z.array(z.string()).max(2).default([]),
  heuristic_flags: z.array(z.string()).max(10).default([])
})

export const AfterLlmResponseSchema = z.object({
  status: z.enum(["SUCCESS", "PARTIAL", "FAILED", "UNVERIFIED", "WRONG_DIRECTION"]),
  confidence: AfterConfidenceSchema,
  findings: z.array(z.string()).max(3).default([]),
  issues: z.array(z.string()).max(5).default([]),
  next_prompt: z.string()
})

export const IntentExtractionOutputSchema = z.object({
  task_type: UnifiedTaskTypeSchema,
  goal: z.string(),
  constraints: z.array(z.string()).max(6).default([]),
  acceptance_criteria: z.array(z.string()).max(6).default([])
})

export const AfterStage1RequestSchema = z.object({
  intent_goal: z.string(),
  task_type: UnifiedTaskTypeSchema,
  response_summary: ResponsePreprocessorOutputSchema
})

export const AfterStage2RequestSchema = z.object({
  intent: AttemptIntentSchema,
  stage_1: Stage1OutputSchema,
  response_excerpts: z.array(z.string()).max(3).default([])
})

export const AfterStage3RequestSchema = z.object({
  intent: AttemptIntentSchema,
  stage_1: Stage1OutputSchema,
  stage_2: Stage2OutputSchema,
  response_summary: ResponsePreprocessorOutputSchema
})

export const AfterStage4RequestSchema = z.object({
  optimized_prompt: z.string(),
  intent: AttemptIntentSchema,
  verdict: VerdictOutputSchema,
  missing_criteria: z.array(z.string()).max(6).default([]),
  constraint_risks: z.array(z.string()).max(6).default([])
})

export const AfterPipelineRequestSchema = z.object({
  attempt: AttemptSchema,
  response_summary: ResponsePreprocessorOutputSchema,
  response_text_fallback: z.string().default(""),
  deep_analysis: z.boolean().default(false)
})

export const AfterPipelineResponseSchema = AfterAnalysisResultSchema

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
export type AfterTaskType = z.infer<typeof AfterTaskTypeSchema>
export type AfterStatus = z.infer<typeof AfterStatusSchema>
export type AfterConfidence = z.infer<typeof AfterConfidenceSchema>
export type AfterIntent = z.infer<typeof AfterIntentSchema>
export type ArtifactSummary = z.infer<typeof ArtifactSummarySchema>
export type AfterHeuristicResult = z.infer<typeof AfterHeuristicResultSchema>
export type AfterEvaluationResult = z.infer<typeof AfterEvaluationResultSchema>
export type AfterLlmRequest = z.infer<typeof AfterLlmRequestSchema>
export type AfterLlmResponse = z.infer<typeof AfterLlmResponseSchema>
export type AttemptPlatform = z.infer<typeof AttemptPlatformSchema>
export type AttemptStatus = z.infer<typeof AttemptStatusSchema>
export type UnifiedTaskType = z.infer<typeof UnifiedTaskTypeSchema>
export type VerdictStatus = z.infer<typeof VerdictStatusSchema>
export type AttemptIntent = z.infer<typeof AttemptIntentSchema>
export type Attempt = z.infer<typeof AttemptSchema>
export type ResponsePreprocessorOutput = z.infer<typeof ResponsePreprocessorOutputSchema>
export type Stage1Output = z.infer<typeof Stage1OutputSchema>
export type Stage2Output = z.infer<typeof Stage2OutputSchema>
export type VerdictOutput = z.infer<typeof VerdictOutputSchema>
export type NextPromptOutput = z.infer<typeof NextPromptOutputSchema>
export type AfterAnalysisResult = z.infer<typeof AfterAnalysisResultSchema>
export type IntentExtractionOutput = z.infer<typeof IntentExtractionOutputSchema>
export type AfterStage1Request = z.infer<typeof AfterStage1RequestSchema>
export type AfterStage2Request = z.infer<typeof AfterStage2RequestSchema>
export type AfterStage3Request = z.infer<typeof AfterStage3RequestSchema>
export type AfterStage4Request = z.infer<typeof AfterStage4RequestSchema>
export type AfterPipelineRequest = z.infer<typeof AfterPipelineRequestSchema>
export type AfterPipelineResponse = z.infer<typeof AfterPipelineResponseSchema>
