import { ExtendQuestionsRequestSchema, type ExtendQuestionsRequest } from "@prompt-optimizer/shared"
import { parseJson, ok, badRequest, options } from "../../../lib/http"
import { runExtendQuestions } from "../../../lib/diagnosis"

export function OPTIONS() {
  return options()
}

export async function POST(request: Request) {
  try {
    const input = await parseJson<ExtendQuestionsRequest>(request, ExtendQuestionsRequestSchema)
    const result = await runExtendQuestions(input)
    return ok(result)
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid request")
  }
}
