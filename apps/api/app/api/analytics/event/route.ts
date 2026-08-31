import {
  AnalyticsEventRequestSchema,
  sendAnalyticsEvents,
  type AnalyticsEventRequest
} from "../../../../lib/analytics"
import { badRequest, ok, options, parseJson } from "../../../../lib/http"

export function OPTIONS() {
  return options()
}

export async function POST(request: Request) {
  try {
    const input = await parseJson<AnalyticsEventRequest>(request, AnalyticsEventRequestSchema)
    const result = await sendAnalyticsEvents(input)
    return ok(result)
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid analytics event")
  }
}
