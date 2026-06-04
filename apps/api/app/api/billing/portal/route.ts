import { CreateBillingPortalRequestSchema, type CreateBillingPortalRequest } from "@prompt-optimizer/shared"
import { badRequest, ok, options, parseJson, unauthorized } from "../../../../lib/http"
import { createBillingPortalSession } from "../../../../lib/billing-service"
import { requireAuthenticatedUser } from "../../../../lib/require-auth"

export function OPTIONS() {
  return options()
}

export async function POST(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser(request)
    const input = await parseJson<CreateBillingPortalRequest>(request, CreateBillingPortalRequestSchema)
    return ok(await createBillingPortalSession(user.id, input))
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create billing portal session"
    return /unauthorized/i.test(message) ? unauthorized(message) : badRequest(message)
  }
}
