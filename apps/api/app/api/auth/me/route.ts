import { ok, options, unauthorized } from "../../../../lib/http"
import { readBearerToken } from "../../../../lib/auth"
import { resolveAuthenticatedUser } from "../../../../lib/auth-service"

export function OPTIONS() {
  return options()
}

export async function GET(request: Request) {
  try {
    const token = readBearerToken(request)
    const { user } = await resolveAuthenticatedUser(token)
    return ok({ user })
  } catch (error) {
    return unauthorized(error instanceof Error ? error.message : "Unauthorized")
  }
}
