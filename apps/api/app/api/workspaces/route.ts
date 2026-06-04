import { CreateWorkspaceRequestSchema, type CreateWorkspaceRequest } from "@prompt-optimizer/shared"
import { badRequest, ok, options, parseJson, unauthorized } from "../../../lib/http"
import { requireAuthenticatedUser } from "../../../lib/require-auth"
import { createWorkspace, getWorkspaceList } from "../../../lib/workspace-service"

export function OPTIONS() {
  return options()
}

export async function GET(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser(request)
    return ok(await getWorkspaceList(user.id))
  } catch (error) {
    return unauthorized(error instanceof Error ? error.message : "Unauthorized")
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser(request)
    const input = await parseJson<CreateWorkspaceRequest>(request, CreateWorkspaceRequestSchema)
    return ok(await createWorkspace(user.id, input))
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create workspace"
    return /unauthorized/i.test(message) ? unauthorized(message) : badRequest(message)
  }
}
