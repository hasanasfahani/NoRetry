import type {
  CreateBillingPortalRequest,
  CreateBillingPortalResponse,
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResponse
} from "@prompt-optimizer/shared"

export type BillingProvider = {
  createCheckoutSession: (
    userId: string,
    input: CreateCheckoutSessionRequest
  ) => Promise<CreateCheckoutSessionResponse>
  createBillingPortalSession: (
    userId: string,
    input: CreateBillingPortalRequest
  ) => Promise<CreateBillingPortalResponse>
}

export function createDisabledBillingProvider(): BillingProvider {
  return {
    async createCheckoutSession(_userId, input) {
      return {
        enabled: false,
        provider: "none",
        checkoutUrl: null,
        message: "Billing is not enabled yet.",
        planKey: input.planKey,
        scope: input.scope
      }
    },
    async createBillingPortalSession(_userId, input) {
      return {
        enabled: false,
        provider: "none",
        portalUrl: null,
        message: "Billing portal is not enabled yet.",
        scope: input.scope
      }
    }
  }
}
