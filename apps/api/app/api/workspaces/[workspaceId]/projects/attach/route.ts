import {
  AttachProjectToWorkspaceRequestSchema,
  type AttachProjectToWorkspaceRequest
} from "@prompt-optimizer/shared"
import { badRequest, ok, options, parseJson, unauthorized } from "../../../../../../lib/http"
import { requireAuthenticatedUser } from "../../../../../../lib/require-auth"
import { addProjectToWorkspace } from "../../../../../../lib/workspace-service"

export function OPTIONS() {
  return options()
}

export async function POST(
  request: Request,
  context: { params: { workspaceId: string } }
) {
  try {
    const { user } = await requireAuthenticatedUser(request)
    const input = await parseJson<AttachProjectToWorkspaceRequest>(request, AttachProjectToWorkspaceRequestSchema)
    return ok(await addProjectToWorkspace(user.id, context.params.workspaceId, input.projectKey))
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to attach project to workspace"
    return /unauthorized/i.test(message) ? unauthorized(message) : badRequest(message)
  }
}
