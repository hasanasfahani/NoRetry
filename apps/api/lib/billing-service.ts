import type {
  BillingOverview,
  BillingPlan,
  CreateBillingPortalRequest,
  CreateBillingPortalResponse,
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResponse
} from "@prompt-optimizer/shared"
import { billingEnv, runtimeFlags } from "./env"
import { createDisabledBillingProvider } from "./billing-provider"
import { findActiveSubscriptionForUser } from "./account-access-repository"

const plans: BillingPlan[] = [
  {
    key: "free",
    label: "Free",
    description: "Guest-first personal usage with local-first project help.",
    interval: "month",
    amountCents: 0,
    currency: "USD",
    availability: "active",
    features: ["Local-first extension use", "Personal auth", "Project sync prep"]
  },
  {
    key: "pro",
    label: "Pro",
    description: "Future paid plan for higher limits, billing, and deeper account usage.",
    interval: "month",
    amountCents: 1900,
    currency: "USD",
    availability: runtimeFlags.enableBilling ? "preview" : "inactive",
    features: ["Future billing portal", "Future usage limits", "Future premium support"]
  },
  {
    key: "team",
    label: "Team",
    description: "Future workspace plan for shared memory, billing, and collaboration.",
    interval: "month",
    amountCents: 4900,
    currency: "USD",
    availability: runtimeFlags.enableBilling ? "preview" : "inactive",
    features: ["Future workspaces", "Future shared project memory", "Future team billing"]
  }
]

function billingProviderName() {
  return runtimeFlags.enableBilling && billingEnv.stripeSecretKey ? "stripe" : "none"
}

export async function getBillingOverview(userId: string): Promise<BillingOverview> {
  const subscription = await findActiveSubscriptionForUser(userId)
  return {
    enabled: runtimeFlags.enableBilling,
    provider: billingProviderName(),
    scope: "personal",
    activePlanKey: subscription?.planKey ?? "free",
    subscriptionStatus: subscription?.status ?? "INACTIVE",
    plans,
    canManageBilling: runtimeFlags.enableBilling,
    canStartCheckout: runtimeFlags.enableBilling,
    publishableKeyConfigured: Boolean(billingEnv.stripePublishableKey),
    updatedAt: new Date().toISOString()
  }
}

export async function createCheckoutSession(
  userId: string,
  input: CreateCheckoutSessionRequest
): Promise<CreateCheckoutSessionResponse> {
  if (!runtimeFlags.enableBilling) {
    return createDisabledBillingProvider().createCheckoutSession(userId, input)
  }

  return createDisabledBillingProvider().createCheckoutSession(userId, input)
}

export async function createBillingPortalSession(
  userId: string,
  input: CreateBillingPortalRequest
): Promise<CreateBillingPortalResponse> {
  if (!runtimeFlags.enableBilling) {
    return createDisabledBillingProvider().createBillingPortalSession(userId, input)
  }

  return createDisabledBillingProvider().createBillingPortalSession(userId, input)
}
