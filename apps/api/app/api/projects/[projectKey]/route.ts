import { badRequest, ok, options, unauthorized } from "../../../../lib/http"
import { requireAuthenticatedUser } from "../../../../lib/require-auth"
import { getProjectState } from "../../../../lib/project-service"

type Params = {
  params: Promise<{
    projectKey: string
  }>
}

export async function GET(request: Request, context: Params) {
  try {
    const { user } = await requireAuthenticatedUser(request)
    const { projectKey } = await context.params
    const project = await getProjectState(user.id, decodeURIComponent(projectKey))
    if (!project) {
      return badRequest("Project not found.", 404)
    }
    return ok(project)
  } catch (error) {
    return unauthorized(error instanceof Error ? error.message : "Unauthorized")
  }
}

export const OPTIONS = options
