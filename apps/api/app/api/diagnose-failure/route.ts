import { DiagnoseFailureRequestSchema, type DiagnoseFailureRequest } from "@prompt-optimizer/shared"
import { parseJson, ok, badRequest, options } from "../../../lib/http"
import { runFailureDiagnosis } from "../../../lib/diagnosis"
import { saveDiagnosis } from "../../../lib/repository"
import { canRunDiagnosis } from "../../../lib/cost-control"

export function OPTIONS() {
  return options()
}

export async function POST(request: Request) {
  try {
    const input = await parseJson<DiagnoseFailureRequest>(request, DiagnoseFailureRequestSchema)
    if (!canRunDiagnosis(input.session_id)) {
      return badRequest("Diagnosis rate limit reached for this session.", 429)
    }
    const result = await runFailureDiagnosis(input)
    await saveDiagnosis(input.outcome_event_id ?? input.prompt_id, result)
    return ok(result)
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid request")
  }
}
