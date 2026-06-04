import { UpdateWorkspaceMemberRequestSchema, type UpdateWorkspaceMemberRequest } from "@prompt-optimizer/shared"
import { badRequest, ok, options, parseJson, unauthorized } from "../../../../../../lib/http"
import { requireAuthenticatedUser } from "../../../../../../lib/require-auth"
import { changeWorkspaceMemberRole } from "../../../../../../lib/workspace-service"

export function OPTIONS() {
  return options()
}

export async function PATCH(
  request: Request,
  context: { params: { workspaceId: string; memberUserId: string } }
) {
  try {
    const { user } = await requireAuthenticatedUser(request)
    const input = await parseJson<UpdateWorkspaceMemberRequest>(request, UpdateWorkspaceMemberRequestSchema)
    return ok(
      await changeWorkspaceMemberRole(user.id, context.params.workspaceId, context.params.memberUserId, input)
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update workspace member"
    return /unauthorized/i.test(message) ? unauthorized(message) : badRequest(message)
  }
}
