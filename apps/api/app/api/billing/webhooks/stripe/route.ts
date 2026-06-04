import { NextResponse } from "next/server"
import { runtimeFlags } from "../../../../../lib/env"

export async function POST() {
  return NextResponse.json(
    {
      provider: "stripe",
      enabled: runtimeFlags.enableBilling,
      message: runtimeFlags.enableBilling
        ? "Stripe webhook handling is not implemented yet."
        : "Billing is not enabled yet."
    },
    {
      status: runtimeFlags.enableBilling ? 501 : 403
    }
  )
}
