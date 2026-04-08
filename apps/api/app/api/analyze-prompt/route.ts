import { AnalyzePromptRequestSchema } from "@prompt-optimizer/shared"
import { parseJson, ok, badRequest, options } from "../../../lib/http"
import { runBeforeAnalysis } from "../../../lib/diagnosis"

export function OPTIONS() {
  return options()
}

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, AnalyzePromptRequestSchema)
    const result = await runBeforeAnalysis(input)
    return ok(result)
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid request")
  }
}
