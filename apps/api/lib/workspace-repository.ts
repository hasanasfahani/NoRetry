import { runtimeFlags } from "./env"
import { prisma } from "./prisma"

type WorkspaceRecord = {
  id: string
  ownerUserId: string
  name: string
  slug: string | null
  status: "ACTIVE" | "ARCHIVED" | "DISABLED"
  createdAt: string
  updatedAt: string
}

type WorkspaceMemberRecord = {
  id: string
  workspaceId: string
  userId: string
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER"
  createdAt: string
  updatedAt: string
  user: {
    id: string
    email: string | null
    firstName: string
    lastName: string
    displayName: string | null
  }
}

type WorkspaceProjectRecord = {
  id: string
  userId: string
  workspaceId: string | null
  projectKey: string
  projectLabel: string
  source: "REPLIT" | "CHATGPT" | "LOVABLE" | "MANUAL"
  updatedAt: string
}

const memoryStore = {
  workspacesById: new Map<string, WorkspaceRecord>(),
  membershipsByWorkspaceId: new Map<string, WorkspaceMemberRecord[]>()
}

function nowIso() {
  return new Date().toISOString()
}

function mapWorkspaceRecord(value: {
  id: string
  ownerUserId: string
  name: string
  slug: string | null
  status: string
  createdAt: Date | string
  updatedAt: Date | string
}): WorkspaceRecord {
  return {
    ...value,
    status: value.status as WorkspaceRecord["status"],
    createdAt: value.createdAt instanceof Date ? value.createdAt.toISOString() : value.createdAt,
    updatedAt: value.updatedAt instanceof Date ? value.updatedAt.toISOString() : value.updatedAt
  }
}

function mapWorkspaceMemberRecord(value: {
  id: string
  workspaceId: string
  userId: string
  role: string
  createdAt: Date | string
  updatedAt: Date | string
  user: {
    id: string
    email: string
    firstName: string
    lastName: string
    displayName: string | null
  }
}): WorkspaceMemberRecord {
  return {
    ...value,
    role: value.role as WorkspaceMemberRecord["role"],
    createdAt: value.createdAt instanceof Date ? value.createdAt.toISOString() : value.createdAt,
    updatedAt: value.updatedAt instanceof Date ? value.updatedAt.toISOString() : value.updatedAt
  }
}

function mapWorkspaceProjectRecord(value: {
  id: string
  userId: string
  workspaceId: string | null
  projectKey: string
  projectLabel: string
  source: string
  updatedAt: Date | string
}): WorkspaceProjectRecord {
  return {
    ...value,
    source: value.source as WorkspaceProjectRecord["source"],
    updatedAt: value.updatedAt instanceof Date ? value.updatedAt.toISOString() : value.updatedAt
  }
}

export async function listOwnedOrMemberWorkspaces(userId: string) {
  if (!runtimeFlags.enableDb || !prisma) {
    const owned = [...memoryStore.workspacesById.values()].filter((workspace) => workspace.ownerUserId === userId)
    const memberIds = [...memoryStore.membershipsByWorkspaceId.values()]
      .flat()
      .filter((member) => member.userId === userId)
      .map((member) => member.workspaceId)
    const memberSet = new Set(memberIds)
    const merged = new Map<string, WorkspaceRecord>()
    for (const workspace of owned) merged.set(workspace.id, workspace)
    for (const workspace of [...memoryStore.workspacesById.values()].filter((workspace) => memberSet.has(workspace.id))) {
      merged.set(workspace.id, workspace)
    }
    return [...merged.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  }

  const [owned, memberships] = await Promise.all([
    prisma.workspace.findMany({
      where: { ownerUserId: userId },
      orderBy: { updatedAt: "desc" }
    }),
    prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true }
    })
  ])

  const merged = new Map<string, WorkspaceRecord>()
  for (const workspace of owned) merged.set(workspace.id, mapWorkspaceRecord(workspace))
  for (const membership of memberships) merged.set(membership.workspaceId, mapWorkspaceRecord(membership.workspace))
  return [...merged.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}

export async function findWorkspaceByIdForUser(workspaceId: string, userId: string) {
  if (!runtimeFlags.enableDb || !prisma) {
    const workspace = memoryStore.workspacesById.get(workspaceId)
    if (!workspace) return null
    const memberships = memoryStore.membershipsByWorkspaceId.get(workspaceId) ?? []
    if (workspace.ownerUserId !== userId && !memberships.some((member) => member.userId === userId)) return null
    return workspace
  }

  const workspace = await prisma.workspace.findFirst({
    where: {
      id: workspaceId,
      OR: [{ ownerUserId: userId }, { members: { some: { userId } } }]
    }
  })

  return workspace ? mapWorkspaceRecord(workspace) : null
}

export async function listWorkspaceMembers(workspaceId: string) {
  if (!runtimeFlags.enableDb || !prisma) {
    return memoryStore.membershipsByWorkspaceId.get(workspaceId) ?? []
  }

  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          displayName: true
        }
      }
    },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }]
  })

  return members.map(mapWorkspaceMemberRecord)
}

export async function listWorkspaceProjects(workspaceId: string) {
  if (!runtimeFlags.enableDb || !prisma) {
    return []
  }

  const projects = await prisma.project.findMany({
    where: { workspaceId },
    orderBy: { updatedAt: "desc" }
  })

  return projects.map(mapWorkspaceProjectRecord)
}

export async function createWorkspaceForOwner(input: { ownerUserId: string; name: string; slug?: string | null }) {
  if (!runtimeFlags.enableDb || !prisma) {
    const workspace: WorkspaceRecord = {
      id: crypto.randomUUID(),
      ownerUserId: input.ownerUserId,
      name: input.name,
      slug: input.slug ?? null,
      status: "ACTIVE",
      createdAt: nowIso(),
      updatedAt: nowIso()
    }
    memoryStore.workspacesById.set(workspace.id, workspace)
    return workspace
  }

  const workspace = await prisma.workspace.create({
    data: {
      ownerUserId: input.ownerUserId,
      name: input.name,
      slug: input.slug ?? null,
      members: {
        create: {
          userId: input.ownerUserId,
          role: "OWNER"
        }
      }
    }
  })

  return mapWorkspaceRecord(workspace)
}

export async function updateWorkspaceMemberRole(input: {
  workspaceId: string
  userId: string
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER"
}) {
  if (!runtimeFlags.enableDb || !prisma) {
    return null
  }

  const member = await prisma.workspaceMember.update({
    where: {
      workspaceId_userId: {
        workspaceId: input.workspaceId,
        userId: input.userId
      }
    },
    data: {
      role: input.role
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          displayName: true
        }
      }
    }
  })

  return mapWorkspaceMemberRecord(member)
}

export async function attachProjectToWorkspace(input: {
  workspaceId: string
  projectKey: string
  ownerUserId: string
}) {
  if (!runtimeFlags.enableDb || !prisma) {
    return null
  }

  const project = await prisma.project.update({
    where: {
      userId_projectKey: {
        userId: input.ownerUserId,
        projectKey: input.projectKey
      }
    },
    data: {
      workspaceId: input.workspaceId
    }
  })

  return mapWorkspaceProjectRecord(project)
}
