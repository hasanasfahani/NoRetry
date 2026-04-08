import { RefinePromptRequestSchema } from "@prompt-optimizer/shared"
import { runPromptRefinement } from "../../../lib/diagnosis"
import { badRequest, ok, options, parseJson } from "../../../lib/http"

export function OPTIONS() {
  return options()
}

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, RefinePromptRequestSchema)
    const result = await runPromptRefinement(input)
    return ok(result)
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid request")
  }
}
