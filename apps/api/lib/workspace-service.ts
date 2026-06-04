import type {
  CreateWorkspaceRequest,
  UpdateWorkspaceMemberRequest,
  WorkspaceActionResponse,
  WorkspaceDetail,
  WorkspaceListEnvelope
} from "@prompt-optimizer/shared"
import { runtimeFlags } from "./env"
import {
  attachProjectToWorkspace,
  createWorkspaceForOwner,
  findWorkspaceByIdForUser,
  listOwnedOrMemberWorkspaces,
  listWorkspaceMembers,
  listWorkspaceProjects,
  updateWorkspaceMemberRole
} from "./workspace-repository"

function disabledList(message = "Teams are not enabled yet."): WorkspaceListEnvelope {
  return {
    enabled: false,
    workspaces: [],
    message,
    updatedAt: new Date().toISOString()
  }
}

function disabledDetail(message = "Teams are not enabled yet."): WorkspaceDetail {
  return {
    enabled: false,
    workspace: null,
    members: [],
    projects: [],
    canManageMembers: false,
    canAttachProjects: false,
    message,
    updatedAt: new Date().toISOString()
  }
}

function disabledAction(message = "Teams are not enabled yet."): WorkspaceActionResponse {
  return {
    enabled: false,
    message,
    updatedAt: new Date().toISOString()
  }
}

export async function getWorkspaceList(userId: string): Promise<WorkspaceListEnvelope> {
  if (!runtimeFlags.enableTeams) return disabledList()

  const workspaces = await listOwnedOrMemberWorkspaces(userId)
  return {
    enabled: true,
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      status: workspace.status,
      role: workspace.ownerUserId === userId ? "OWNER" : "MEMBER",
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt
    })),
    message: null,
    updatedAt: new Date().toISOString()
  }
}

export async function getWorkspaceDetail(userId: string, workspaceId: string): Promise<WorkspaceDetail> {
  if (!runtimeFlags.enableTeams) return disabledDetail()

  const workspace = await findWorkspaceByIdForUser(workspaceId, userId)
  if (!workspace) {
    return disabledDetail("Workspace not found or not accessible.")
  }

  const [members, projects] = await Promise.all([listWorkspaceMembers(workspaceId), listWorkspaceProjects(workspaceId)])
  const ownerView = workspace.ownerUserId === userId

  return {
    enabled: true,
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      status: workspace.status,
      role: ownerView ? "OWNER" : "MEMBER",
      memberCount: members.length,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt
    },
    members: members.map((member) => ({
      userId: member.user.id,
      email: member.user.email,
      firstName: member.user.firstName,
      lastName: member.user.lastName,
      displayName: member.user.displayName ?? `${member.user.firstName} ${member.user.lastName}`.trim(),
      role: member.role,
      joinedAt: member.createdAt,
      lastUpdatedAt: member.updatedAt
    })),
    projects: projects.map((project) => ({
      id: project.id,
      projectKey: project.projectKey,
      projectLabel: project.projectLabel,
      source: project.source,
      ownerScope: "workspace",
      updatedAt: project.updatedAt
    })),
    canManageMembers: ownerView,
    canAttachProjects: ownerView,
    message: null,
    updatedAt: new Date().toISOString()
  }
}

export async function createWorkspace(userId: string, input: CreateWorkspaceRequest): Promise<WorkspaceActionResponse> {
  if (!runtimeFlags.enableTeams) return disabledAction()

  const workspace = await createWorkspaceForOwner({
    ownerUserId: userId,
    name: input.name,
    slug: input.slug ?? null
  })

  return {
    enabled: true,
    message: "Workspace created.",
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      status: workspace.status,
      role: "OWNER",
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt
    },
    updatedAt: new Date().toISOString()
  }
}

export async function changeWorkspaceMemberRole(
  actorUserId: string,
  workspaceId: string,
  memberUserId: string,
  input: UpdateWorkspaceMemberRequest
): Promise<WorkspaceActionResponse> {
  if (!runtimeFlags.enableTeams) return disabledAction()

  const workspace = await findWorkspaceByIdForUser(workspaceId, actorUserId)
  if (!workspace || workspace.ownerUserId !== actorUserId) {
    return disabledAction("Only workspace owners can manage members.")
  }

  const member = await updateWorkspaceMemberRole({
    workspaceId,
    userId: memberUserId,
    role: input.role
  })

  if (!member) {
    return disabledAction("Workspace member not found.")
  }

  return {
    enabled: true,
    message: "Workspace member updated.",
    updatedAt: new Date().toISOString()
  }
}

export async function addProjectToWorkspace(
  actorUserId: string,
  workspaceId: string,
  projectKey: string
): Promise<WorkspaceActionResponse> {
  if (!runtimeFlags.enableTeams) return disabledAction()

  const workspace = await findWorkspaceByIdForUser(workspaceId, actorUserId)
  if (!workspace || workspace.ownerUserId !== actorUserId) {
    return disabledAction("Only workspace owners can attach projects.")
  }

  const project = await attachProjectToWorkspace({
    workspaceId,
    projectKey,
    ownerUserId: actorUserId
  })

  if (!project) {
    return disabledAction("Project not found for this user.")
  }

  return {
    enabled: true,
    message: "Project attached to workspace.",
    project: {
      id: project.id,
      projectKey: project.projectKey,
      projectLabel: project.projectLabel,
      source: project.source,
      ownerScope: "workspace",
      updatedAt: project.updatedAt
    },
    updatedAt: new Date().toISOString()
  }
}
