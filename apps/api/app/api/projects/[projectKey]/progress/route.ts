import {
  UpsertProjectProgressRequestSchema,
  type UpsertProjectProgressRequest
} from "@prompt-optimizer/shared"
import { badRequest, options, ok, parseJson, unauthorized } from "../../../../../lib/http"
import { requireAuthenticatedUser } from "../../../../../lib/require-auth"
import { saveProjectProgressState } from "../../../../../lib/project-service"

type Params = {
  params: Promise<{
    projectKey: string
  }>
}

export async function PUT(request: Request, context: Params) {
  let userId = ""
  try {
    const { user } = await requireAuthenticatedUser(request)
    userId = user.id
  } catch (error) {
    return unauthorized(error instanceof Error ? error.message : "Unauthorized")
  }

  try {
    const { projectKey } = await context.params
    const body = await parseJson<UpsertProjectProgressRequest>(request, UpsertProjectProgressRequestSchema)
    return ok(await saveProjectProgressState(userId, decodeURIComponent(projectKey), body))
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid project progress payload.")
  }
}

export const OPTIONS = options
