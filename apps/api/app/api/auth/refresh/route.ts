import { RefreshAccountRequestSchema, type RefreshAccountRequest } from "@prompt-optimizer/shared"
import { parseJson, ok, badRequest, options } from "../../../../lib/http"
import { refreshAccountSession } from "../../../../lib/auth-service"

export function OPTIONS() {
  return options()
}

export async function POST(request: Request) {
  try {
    const input = await parseJson<RefreshAccountRequest>(request, RefreshAccountRequestSchema)
    const result = await refreshAccountSession(input)
    return ok(result)
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Unable to refresh session", 401)
  }
}
