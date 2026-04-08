import { FeedbackRequestSchema } from "@prompt-optimizer/shared"
import { parseJson, ok, badRequest, options } from "../../../lib/http"
import { saveFeedback } from "../../../lib/repository"

export function OPTIONS() {
  return options()
}

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, FeedbackRequestSchema)
    await saveFeedback(input.outcome_event_id, input.feedback_type)
    return ok({ success: true })
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid request")
  }
}
