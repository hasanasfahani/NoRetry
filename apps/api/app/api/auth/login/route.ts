import { LoginAccountRequestSchema, type LoginAccountRequest } from "@prompt-optimizer/shared"
import { parseJson, ok, badRequest, options } from "../../../../lib/http"
import { loginAccount } from "../../../../lib/auth-service"

export function OPTIONS() {
  return options()
}

export async function POST(request: Request) {
  try {
    const input = await parseJson<LoginAccountRequest>(request, LoginAccountRequestSchema)
    const result = await loginAccount(input, request.headers.get("user-agent"))
    return ok(result)
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Unable to sign in")
  }
}
