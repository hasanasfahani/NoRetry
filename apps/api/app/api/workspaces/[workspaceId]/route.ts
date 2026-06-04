import { ok, options, unauthorized } from "../../../../lib/http"
import { requireAuthenticatedUser } from "../../../../lib/require-auth"
import { getWorkspaceDetail } from "../../../../lib/workspace-service"

export function OPTIONS() {
  return options()
}

export async function GET(request: Request, context: { params: { workspaceId: string } }) {
  try {
    const { user } = await requireAuthenticatedUser(request)
    return ok(await getWorkspaceDetail(user.id, context.params.workspaceId))
  } catch (error) {
    return unauthorized(error instanceof Error ? error.message : "Unauthorized")
  }
}
