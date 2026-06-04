import { ok, options, unauthorized } from "../../../../lib/http"
import { getBillingOverview } from "../../../../lib/billing-service"
import { requireAuthenticatedUser } from "../../../../lib/require-auth"

export function OPTIONS() {
  return options()
}

export async function GET(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser(request)
    return ok(await getBillingOverview(user.id))
  } catch (error) {
    return unauthorized(error instanceof Error ? error.message : "Unauthorized")
  }
}
