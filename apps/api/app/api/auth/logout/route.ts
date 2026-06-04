import { LogoutAccountRequestSchema, type LogoutAccountRequest } from "@prompt-optimizer/shared"
import { parseJson, ok, options } from "../../../../lib/http"
import { logoutAccount } from "../../../../lib/auth-service"

export function OPTIONS() {
  return options()
}

export async function POST(request: Request) {
  const input = await parseJson<LogoutAccountRequest>(request, LogoutAccountRequestSchema).catch(() => ({ accessToken: "" }))
  const authorization = request.headers.get("authorization") ?? ""
  const token = input.accessToken?.trim() || authorization.replace(/^Bearer\s+/i, "").trim()
  const result = await logoutAccount(token)
  return ok(result)
}
