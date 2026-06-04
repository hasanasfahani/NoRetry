import { readBearerToken } from "./auth"
import { resolveAuthenticatedUser } from "./auth-service"

export async function requireAuthenticatedUser(request: Request) {
  const token = readBearerToken(request)
  const { user, sessionId } = await resolveAuthenticatedUser(token)
  return {
    accessToken: token,
    sessionId,
    user
  }
}
