import { options, ok, unauthorized } from "../../../lib/http"
import { requireAuthenticatedUser } from "../../../lib/require-auth"
import { listProjectStates } from "../../../lib/project-service"

export async function GET(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser(request)
    return ok(await listProjectStates(user.id))
  } catch (error) {
    return unauthorized(error instanceof Error ? error.message : "Unauthorized")
  }
}

export const OPTIONS = options
