import * as z from "zod"
import { env, runtimeFlags } from "./env"

const AnalyticsEventNameSchema = z.enum([
  "extension_opened",
  "surface_detected",
  "surface_unsupported",
  "popup_closed",
  "project_context_viewed",
  "project_context_missing_shown",
  "context_request_submitted",
  "context_markdown_import_started",
  "context_markdown_import_succeeded",
  "context_markdown_import_failed",
  "project_memory_available",
  "project_planning_opened",
  "project_planning_intake_started",
  "project_planning_intake_completed",
  "prd_generation_started",
  "prd_generation_succeeded",
  "prd_generation_failed",
  "prd_generation_retried",
  "prd_prompt_submitted",
  "project_tracker_enabled",
  "project_tracker_phase_started",
  "project_tracker_phase_completed",
  "project_tracker_completed",
  "answer_analysis_opened",
  "deep_analysis_started",
  "deep_analysis_succeeded",
  "deep_analysis_failed",
  "deep_analysis_retried",
  "deep_analysis_result_viewed",
  "deep_analysis_next_prompt_generated",
  "deep_analysis_next_prompt_submitted",
  "testing_gate_shown",
  "testing_gate_answered",
  "testing_prompt_generated",
  "testing_prompt_submitted",
  "testing_completed_confirmed",
  "next_move_opened",
  "next_move_description_edited",
  "next_move_path_selected",
  "next_move_questions_started",
  "next_move_questions_succeeded",
  "next_move_questions_failed",
  "next_move_questions_retried",
  "next_move_question_answered",
  "next_move_all_questions_answered",
  "next_move_prompt_generation_started",
  "next_move_prompt_generation_succeeded",
  "next_move_prompt_generation_failed",
  "next_move_prompt_submitted",
  "prompt_submit_started",
  "prompt_submit_succeeded",
  "prompt_submit_failed",
  "prompt_written_to_composer",
  "llm_request_started",
  "llm_request_succeeded",
  "llm_request_failed",
  "llm_provider_attempted",
  "llm_provider_failed",
  "llm_json_repair_attempted",
  "llm_json_repair_succeeded",
  "llm_json_repair_failed"
])

const AnalyticsParamsSchema = z.object({
  surface: z.enum(["replit", "chatgpt", "lovable", "unknown"]).optional(),
  feature_area: z
    .enum(["project_context", "project_planning", "deep_analysis", "next_move", "prompt_submit", "reliability"])
    .optional(),
  status: z.enum(["started", "success", "failed", "timeout"]).optional(),
  error_reason: z.string().max(80).optional(),
  duration_ms: z.number().int().nonnegative().max(600000).optional(),
  provider_winner: z.enum(["openai", "kimi", "deepseek", "none"]).optional(),
  provider_attempted: z.enum(["openai", "kimi", "deepseek"]).optional(),
  has_project_context: z.boolean().optional(),
  tracker_enabled: z.boolean().optional(),
  tracker_phase_index: z.number().int().nonnegative().max(100).optional(),
  next_move_path: z.enum(["small_feature", "large_feature", "bug_fix", "small_change"]).optional(),
  question_count: z.number().int().nonnegative().max(20).optional(),
  answered_count: z.number().int().nonnegative().max(20).optional(),
  retry_count: z.number().int().nonnegative().max(20).optional()
})

export const AnalyticsEventRequestSchema = z.object({
  client_id: z.string().min(8).max(128).regex(/^[a-zA-Z0-9._:-]+$/),
  user_id: z.string().min(8).max(128).regex(/^[a-zA-Z0-9._:-]+$/).optional(),
  events: z.array(z.object({
    name: AnalyticsEventNameSchema,
    params: AnalyticsParamsSchema.default({})
  })).min(1).max(12)
})

export type AnalyticsEventRequest = z.infer<typeof AnalyticsEventRequestSchema>

export async function sendAnalyticsEvents(input: AnalyticsEventRequest) {
  if (!runtimeFlags.enableGa4Analytics) {
    return { success: true, skipped: true, reason: "disabled" as const }
  }

  const response = await fetch(
    `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(env.GA4_MEASUREMENT_ID ?? "")}&api_secret=${encodeURIComponent(env.GA4_API_SECRET ?? "")}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: input.client_id,
        user_id: input.user_id,
        non_personalized_ads: true,
        events: input.events.map((event) => ({
          name: event.name,
          params: {
            engagement_time_msec: 1,
            ...event.params
          }
        }))
      })
    }
  )

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`GA4 request failed with ${response.status}${text ? `: ${text.slice(0, 240)}` : ""}`)
  }

  return { success: true, skipped: false, reason: null }
}
