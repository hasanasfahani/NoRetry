import type { AccountAccessSnapshot, EntitlementSummary, FeatureKey, UsageSummaryItem, WorkspaceSummary } from "@prompt-optimizer/shared"
import { runtimeFlags } from "./env"
import {
  findActiveSubscriptionForUser,
  listEntitlementsForUser,
  listWorkspaceSummariesForUser,
  summarizePostedUsageForUser
} from "./account-access-repository"

const featureCatalog: FeatureKey[] = [
  "project_sync",
  "progress_sync",
  "usage_metering",
  "billing_portal",
  "subscription_checkout",
  "team_workspaces",
  "shared_project_memory",
  "priority_support"
]

function makeDefaultEntitlements(): EntitlementSummary[] {
  return featureCatalog.map((featureKey) => ({
    key: featureKey,
    enabled: featureKey === "project_sync" || featureKey === "progress_sync",
    source: "SYSTEM",
    value: featureKey === "project_sync" || featureKey === "progress_sync" ? "enabled" : "disabled",
    expiresAt: null
  }))
}

function mergeEntitlements(defaults: EntitlementSummary[], overrides: { key: string; value: string; source: EntitlementSummary["source"]; expiresAt: string | null }[]) {
  const next = new Map<FeatureKey, EntitlementSummary>(defaults.map((entry) => [entry.key, entry]))

  for (const override of overrides) {
    if (!featureCatalog.includes(override.key as FeatureKey)) continue
    next.set(override.key as FeatureKey, {
      key: override.key as FeatureKey,
      enabled: override.value !== "disabled" && override.value !== "false" && override.value !== "0",
      source: override.source,
      value: override.value,
      expiresAt: override.expiresAt
    })
  }

  return featureCatalog.map((key) => next.get(key)!)
}

function usageLimitForFeature(featureKey: FeatureKey) {
  switch (featureKey) {
    case "project_sync":
    case "progress_sync":
      return null
    default:
      return null
  }
}

export async function getAccountAccessSnapshot(userId: string): Promise<AccountAccessSnapshot> {
  const [workspaces, subscription, persistedEntitlements, persistedUsage] = await Promise.all([
    listWorkspaceSummariesForUser(userId),
    findActiveSubscriptionForUser(userId),
    listEntitlementsForUser(userId),
    summarizePostedUsageForUser(userId)
  ])

  const entitlements = mergeEntitlements(makeDefaultEntitlements(), persistedEntitlements)
  const usageMap = new Map(persistedUsage.map((entry) => [entry.featureKey, entry.used]))

  const usage: UsageSummaryItem[] = featureCatalog.map((featureKey) => {
    const used = usageMap.get(featureKey) ?? 0
    const limit = usageLimitForFeature(featureKey)
    return {
      featureKey,
      used,
      limit,
      remaining: limit == null ? null : Math.max(limit - used, 0),
      status: "POSTED"
    }
  })

  const normalizedSubscription =
    subscription ??
    ({
      id: null,
      scope: "personal",
      provider: null,
      status: "INACTIVE",
      planKey: "free",
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false
    } as const)

  return {
    subjectScope: "personal",
    activeWorkspaceId: null,
    workspaces: workspaces as WorkspaceSummary[],
    subscription: normalizedSubscription,
    entitlements,
    usage,
    billingEnabled: runtimeFlags.enableBilling,
    teamsEnabled: runtimeFlags.enableTeams,
    meteringEnabled: false,
    updatedAt: new Date().toISOString()
  }
}
