import { RegisterAccountRequestSchema, type RegisterAccountRequest } from "@prompt-optimizer/shared"
import { parseJson, ok, badRequest, options } from "../../../../lib/http"
import { registerAccount } from "../../../../lib/auth-service"

export function OPTIONS() {
  return options()
}

export async function POST(request: Request) {
  try {
    const input = await parseJson<RegisterAccountRequest>(request, RegisterAccountRequestSchema)
    const result = await registerAccount(input, request.headers.get("user-agent"))
    return ok(result)
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Unable to register account")
  }
}
