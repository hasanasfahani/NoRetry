import * as z from "zod"
import {
  AccessScopeSchema,
  CreateBillingPortalRequestSchema,
  CreateCheckoutSessionRequestSchema,
  PlanKeySchema,
  SubscriptionStatusSchema
} from "./account-access"

export const BillingIntervalSchema = z.enum(["month", "year"])
export const BillingPlanAvailabilitySchema = z.enum(["inactive", "preview", "active"])

export const BillingPlanSchema = z.object({
  key: PlanKeySchema,
  label: z.string(),
  description: z.string(),
  interval: BillingIntervalSchema,
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  availability: BillingPlanAvailabilitySchema,
  features: z.array(z.string())
})

export const BillingOverviewSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(["stripe", "none"]),
  scope: AccessScopeSchema,
  activePlanKey: PlanKeySchema,
  subscriptionStatus: SubscriptionStatusSchema,
  plans: z.array(BillingPlanSchema),
  canManageBilling: z.boolean(),
  canStartCheckout: z.boolean(),
  publishableKeyConfigured: z.boolean(),
  updatedAt: z.string()
})

export const CreateCheckoutSessionResponseSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(["stripe", "none"]),
  checkoutUrl: z.string().url().nullable(),
  message: z.string(),
  planKey: PlanKeySchema,
  scope: AccessScopeSchema
})

export const CreateBillingPortalResponseSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(["stripe", "none"]),
  portalUrl: z.string().url().nullable(),
  message: z.string(),
  scope: AccessScopeSchema
})

export const StripeWebhookEnvelopeSchema = z.object({
  provider: z.literal("stripe"),
  signature: z.string().nullable(),
  rawBody: z.string()
})

export type BillingInterval = z.infer<typeof BillingIntervalSchema>
export type BillingPlanAvailability = z.infer<typeof BillingPlanAvailabilitySchema>
export type BillingPlan = z.infer<typeof BillingPlanSchema>
export type BillingOverview = z.infer<typeof BillingOverviewSchema>
export type CreateCheckoutSessionResponse = z.infer<typeof CreateCheckoutSessionResponseSchema>
export type CreateBillingPortalResponse = z.infer<typeof CreateBillingPortalResponseSchema>
export type StripeWebhookEnvelope = z.infer<typeof StripeWebhookEnvelopeSchema>
