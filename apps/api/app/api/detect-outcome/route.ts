import { DetectOutcomeRequestSchema, detectOutcomeLocally } from "@prompt-optimizer/shared"
import { parseJson, ok, badRequest, options } from "../../../lib/http"
import { saveOutcomeEvent, savePromptEvent } from "../../../lib/repository"

export function OPTIONS() {
  return options()
}

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, DetectOutcomeRequestSchema)
    const result = detectOutcomeLocally(input)
    const outcomeEventId = crypto.randomUUID()

    await savePromptEvent({
      id: input.prompt_id,
      sessionId: input.session_id,
      originalPrompt: input.original_prompt ?? input.final_sent_prompt,
      optimizedPrompt: input.optimized_prompt ?? null,
      finalSentPrompt: input.final_sent_prompt,
      promptIntent: input.prompt_intent,
      strengthScore: input.strength_score ?? "MID"
    })

    await saveOutcomeEvent({
      id: outcomeEventId,
      promptEventId: input.prompt_id,
      outputSnippet: input.output_snippet,
      errorSummary: input.error_summary ?? null,
      retryCount: input.retry_count,
      changedFilesCount: input.changed_files_count,
      changedFilePathsSummary: input.changed_file_paths_summary,
      detectionFlags: result.detection_flags,
      probableStatus: result.probable_status
    })

    return ok({
      ...result,
      outcome_event_id: outcomeEventId
    })
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid request")
  }
}
