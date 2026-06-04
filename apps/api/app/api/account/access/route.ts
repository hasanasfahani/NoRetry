import { NextResponse } from "next/server"
import { getAccountAccessSnapshot } from "../../../../lib/account-access-service"
import { requireAuthenticatedUser } from "../../../../lib/require-auth"

export async function GET(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser(request)
    const snapshot = await getAccountAccessSnapshot(user.id)
    return NextResponse.json(snapshot)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized"
    return NextResponse.json({ error: message }, { status: 401 })
  }
}
