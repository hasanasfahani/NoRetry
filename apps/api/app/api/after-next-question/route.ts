import { AfterNextQuestionRequestSchema, type AfterNextQuestionRequest } from "@prompt-optimizer/shared"
import { parseJson, ok, badRequest, options } from "../../../lib/http"
import { generateAfterNextQuestion } from "../../../lib/after-next-question"

export function OPTIONS() {
  return options()
}

export async function POST(request: Request) {
  try {
    const input = await parseJson<AfterNextQuestionRequest>(request, AfterNextQuestionRequestSchema)
    const result = await generateAfterNextQuestion(input)
    return ok(result)
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid request")
  }
}
