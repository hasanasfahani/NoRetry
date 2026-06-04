import {
  type NextMoveInterpretationRequest,
  NextMoveInterpretationRequestSchema,
  runNextMoveInterpretation
} from "../../../../lib/next-move-interpretation"
import { badRequest, ok, options, parseJson } from "../../../../lib/http"

export function OPTIONS() {
  return options()
}

export async function POST(request: Request) {
  try {
    const input = await parseJson<NextMoveInterpretationRequest>(request, NextMoveInterpretationRequestSchema)
    const result = await runNextMoveInterpretation(input)
    return ok(result)
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid request")
  }
}
