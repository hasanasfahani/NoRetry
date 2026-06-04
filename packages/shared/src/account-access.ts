import * as z from "zod"

export const WorkspaceStatusSchema = z.enum(["ACTIVE", "ARCHIVED", "DISABLED"])
export const WorkspaceMemberRoleSchema = z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"])
export const SubscriptionProviderSchema = z.enum(["STRIPE", "MANUAL"])
export const SubscriptionStatusSchema = z.enum([
  "INACTIVE",
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "CANCELED",
  "INCOMPLETE",
  "EXPIRED"
])
export const EntitlementSourceSchema = z.enum(["PLAN", "MANUAL", "PROMO", "TRIAL", "SYSTEM"])
export const UsageLedgerStatusSchema = z.enum(["PENDING", "POSTED", "VOIDED"])

export const AccessScopeSchema = z.enum(["personal", "workspace"])
export const PlanKeySchema = z.enum(["free", "pro", "team"])
export const FeatureKeySchema = z.enum([
  "project_sync",
  "progress_sync",
  "usage_metering",
  "billing_portal",
  "subscription_checkout",
  "team_workspaces",
  "shared_project_memory",
  "priority_support"
])

export const WorkspaceSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string().nullable(),
  status: WorkspaceStatusSchema,
  role: WorkspaceMemberRoleSchema,
  memberCount: z.number().int().nonnegative().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
})

export const SubscriptionSummarySchema = z.object({
  id: z.string().nullable(),
  scope: AccessScopeSchema,
  provider: SubscriptionProviderSchema.nullable(),
  status: SubscriptionStatusSchema,
  planKey: PlanKeySchema,
  currentPeriodStart: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean()
})

export const EntitlementSummarySchema = z.object({
  key: FeatureKeySchema,
  enabled: z.boolean(),
  source: EntitlementSourceSchema,
  value: z.string(),
  expiresAt: z.string().nullable()
})

export const UsageSummaryItemSchema = z.object({
  featureKey: FeatureKeySchema,
  used: z.number().int().nonnegative(),
  limit: z.number().int().positive().nullable(),
  remaining: z.number().int().nullable(),
  status: UsageLedgerStatusSchema.default("POSTED")
})

export const AccountAccessSnapshotSchema = z.object({
  subjectScope: AccessScopeSchema,
  activeWorkspaceId: z.string().nullable(),
  workspaces: z.array(WorkspaceSummarySchema),
  subscription: SubscriptionSummarySchema,
  entitlements: z.array(EntitlementSummarySchema),
  usage: z.array(UsageSummaryItemSchema),
  billingEnabled: z.boolean(),
  teamsEnabled: z.boolean(),
  meteringEnabled: z.boolean(),
  updatedAt: z.string()
})

export const CreateWorkspaceRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9-]+$/).nullable().optional()
})

export const UpdateWorkspaceMemberRequestSchema = z.object({
  role: WorkspaceMemberRoleSchema
})

export const RecordUsageEventRequestSchema = z.object({
  scope: AccessScopeSchema.default("personal"),
  workspaceId: z.string().nullable().optional(),
  projectKey: z.string().nullable().optional(),
  featureKey: FeatureKeySchema,
  quantity: z.number().int().positive().default(1),
  eventType: z.string().trim().min(1).max(120),
  metadataJson: z.unknown().nullable().optional()
})

export const CreateCheckoutSessionRequestSchema = z.object({
  scope: AccessScopeSchema.default("personal"),
  workspaceId: z.string().nullable().optional(),
  planKey: PlanKeySchema,
  successUrl: z.string().url(),
  cancelUrl: z.string().url()
})

export const CreateBillingPortalRequestSchema = z.object({
  scope: AccessScopeSchema.default("personal"),
  workspaceId: z.string().nullable().optional(),
  returnUrl: z.string().url()
})

export type WorkspaceStatus = z.infer<typeof WorkspaceStatusSchema>
export type WorkspaceMemberRole = z.infer<typeof WorkspaceMemberRoleSchema>
export type SubscriptionProvider = z.infer<typeof SubscriptionProviderSchema>
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>
export type EntitlementSource = z.infer<typeof EntitlementSourceSchema>
export type UsageLedgerStatus = z.infer<typeof UsageLedgerStatusSchema>
export type AccessScope = z.infer<typeof AccessScopeSchema>
export type PlanKey = z.infer<typeof PlanKeySchema>
export type FeatureKey = z.infer<typeof FeatureKeySchema>
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>
export type SubscriptionSummary = z.infer<typeof SubscriptionSummarySchema>
export type EntitlementSummary = z.infer<typeof EntitlementSummarySchema>
export type UsageSummaryItem = z.infer<typeof UsageSummaryItemSchema>
export type AccountAccessSnapshot = z.infer<typeof AccountAccessSnapshotSchema>
export type CreateWorkspaceRequest = z.infer<typeof CreateWorkspaceRequestSchema>
export type UpdateWorkspaceMemberRequest = z.infer<typeof UpdateWorkspaceMemberRequestSchema>
export type RecordUsageEventRequest = z.infer<typeof RecordUsageEventRequestSchema>
export type CreateCheckoutSessionRequest = z.infer<typeof CreateCheckoutSessionRequestSchema>
export type CreateBillingPortalRequest = z.infer<typeof CreateBillingPortalRequestSchema>
