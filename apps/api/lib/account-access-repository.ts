import { runtimeFlags } from "./env"
import { prisma } from "./prisma"

type WorkspaceSummaryRecord = {
  id: string
  name: string
  slug: string | null
  status: "ACTIVE" | "ARCHIVED" | "DISABLED"
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER"
  memberCount: number
  createdAt: string
  updatedAt: string
}

type SubscriptionRecord = {
  id: string
  scope: "personal" | "workspace"
  provider: "STRIPE" | "MANUAL" | null
  status: "INACTIVE" | "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "INCOMPLETE" | "EXPIRED"
  planKey: "free" | "pro" | "team"
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

type EntitlementRecord = {
  key: string
  value: string
  source: "PLAN" | "MANUAL" | "PROMO" | "TRIAL" | "SYSTEM"
  expiresAt: string | null
}

type UsageSummaryRecord = {
  featureKey: string
  used: number
}

const memoryStore = {
  workspacesByUserId: new Map<string, WorkspaceSummaryRecord[]>(),
  subscriptionsByUserId: new Map<string, SubscriptionRecord>(),
  entitlementsByUserId: new Map<string, EntitlementRecord[]>(),
  usageByUserId: new Map<string, UsageSummaryRecord[]>()
}

function iso(value: Date | string | null | undefined) {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : value
}

export async function listWorkspaceSummariesForUser(userId: string): Promise<WorkspaceSummaryRecord[]> {
  if (!runtimeFlags.enableDb || !prisma) {
    return memoryStore.workspacesByUserId.get(userId) ?? []
  }

  const [owned, memberships] = await Promise.all([
    prisma.workspace.findMany({
      where: { ownerUserId: userId },
      include: {
        _count: {
          select: { members: true }
        }
      },
      orderBy: { updatedAt: "desc" }
    }),
    prisma.workspaceMember.findMany({
      where: { userId },
      include: {
        workspace: {
          include: {
            _count: {
              select: { members: true }
            }
          }
        }
      },
      orderBy: {
        workspace: {
          updatedAt: "desc"
        }
      }
    })
  ])

  const records = new Map<string, WorkspaceSummaryRecord>()

  for (const workspace of owned) {
    records.set(workspace.id, {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      status: workspace.status,
      role: "OWNER",
      memberCount: workspace._count.members,
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString()
    })
  }

  for (const membership of memberships) {
    if (records.has(membership.workspaceId)) continue
    records.set(membership.workspaceId, {
      id: membership.workspace.id,
      name: membership.workspace.name,
      slug: membership.workspace.slug,
      status: membership.workspace.status,
      role: membership.role,
      memberCount: membership.workspace._count.members,
      createdAt: membership.workspace.createdAt.toISOString(),
      updatedAt: membership.workspace.updatedAt.toISOString()
    })
  }

  return [...records.values()].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
}

export async function findActiveSubscriptionForUser(userId: string): Promise<SubscriptionRecord | null> {
  if (!runtimeFlags.enableDb || !prisma) {
    return memoryStore.subscriptionsByUserId.get(userId) ?? null
  }

  const subscription = await prisma.subscription.findFirst({
    where: {
      userId,
      workspaceId: null,
      status: {
        in: ["ACTIVE", "TRIALING", "PAST_DUE", "INCOMPLETE", "CANCELED"]
      }
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
  })

  if (!subscription) return null

  const normalizedPlan =
    subscription.planKey === "pro" || subscription.planKey === "team" || subscription.planKey === "free"
      ? subscription.planKey
      : "free"

  return {
    id: subscription.id,
    scope: "personal",
    provider: subscription.provider,
    status: subscription.status,
    planKey: normalizedPlan,
    currentPeriodStart: iso(subscription.currentPeriodStart),
    currentPeriodEnd: iso(subscription.currentPeriodEnd),
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd
  }
}

export async function listEntitlementsForUser(userId: string): Promise<EntitlementRecord[]> {
  if (!runtimeFlags.enableDb || !prisma) {
    return memoryStore.entitlementsByUserId.get(userId) ?? []
  }

  const entitlements = await prisma.entitlement.findMany({
    where: {
      userId,
      workspaceId: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
  })

  return entitlements.map((entitlement) => ({
    key: entitlement.key,
    value: entitlement.value,
    source: entitlement.source,
    expiresAt: iso(entitlement.expiresAt)
  }))
}

export async function summarizePostedUsageForUser(userId: string): Promise<UsageSummaryRecord[]> {
  if (!runtimeFlags.enableDb || !prisma) {
    return memoryStore.usageByUserId.get(userId) ?? []
  }

  const grouped = await prisma.usageLedger.groupBy({
    by: ["featureKey"],
    where: {
      userId,
      workspaceId: null,
      status: "POSTED"
    },
    _sum: {
      quantity: true
    }
  })

  return grouped.map((entry) => ({
    featureKey: entry.featureKey,
    used: entry._sum.quantity ?? 0
  }))
}
