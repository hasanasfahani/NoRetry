import { AfterPipelineRequestSchema, type AfterPipelineRequest } from "@prompt-optimizer/shared"
import { analyzeAfterAttempt } from "../../../lib/after-analysis"
import { badRequest, ok, options, parseJson } from "../../../lib/http"

export async function OPTIONS() {
  return options()
}

export async function POST(request: Request) {
  try {
    const input: AfterPipelineRequest = await parseJson(request, AfterPipelineRequestSchema)
    const result = await analyzeAfterAttempt(input)
    return ok(result)
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid request")
  }
}
