import * as z from "zod"
import {
  AccessScopeSchema,
  CreateWorkspaceRequestSchema,
  UpdateWorkspaceMemberRequestSchema,
  WorkspaceMemberRoleSchema,
  WorkspaceSummarySchema
} from "./account-access"
import { ProjectSourceSchema } from "./project-sync"

export const WorkspaceMemberSummarySchema = z.object({
  userId: z.string(),
  email: z.string().email().nullable(),
  firstName: z.string(),
  lastName: z.string(),
  displayName: z.string(),
  role: WorkspaceMemberRoleSchema,
  joinedAt: z.string(),
  lastUpdatedAt: z.string()
})

export const WorkspaceProjectSummarySchema = z.object({
  id: z.string(),
  projectKey: z.string(),
  projectLabel: z.string(),
  source: ProjectSourceSchema,
  ownerScope: AccessScopeSchema,
  updatedAt: z.string()
})

export const WorkspaceListEnvelopeSchema = z.object({
  enabled: z.boolean(),
  workspaces: z.array(WorkspaceSummarySchema),
  message: z.string().nullable(),
  updatedAt: z.string()
})

export const WorkspaceDetailSchema = z.object({
  enabled: z.boolean(),
  workspace: WorkspaceSummarySchema.nullable(),
  members: z.array(WorkspaceMemberSummarySchema),
  projects: z.array(WorkspaceProjectSummarySchema),
  canManageMembers: z.boolean(),
  canAttachProjects: z.boolean(),
  message: z.string().nullable(),
  updatedAt: z.string()
})

export const AttachProjectToWorkspaceRequestSchema = z.object({
  projectKey: z.string().trim().min(1).max(240)
})

export const WorkspaceActionResponseSchema = z.object({
  enabled: z.boolean(),
  message: z.string(),
  workspace: WorkspaceSummarySchema.nullable().optional(),
  project: WorkspaceProjectSummarySchema.nullable().optional(),
  updatedAt: z.string()
})

export type WorkspaceMemberSummary = z.infer<typeof WorkspaceMemberSummarySchema>
export type WorkspaceProjectSummary = z.infer<typeof WorkspaceProjectSummarySchema>
export type WorkspaceListEnvelope = z.infer<typeof WorkspaceListEnvelopeSchema>
export type WorkspaceDetail = z.infer<typeof WorkspaceDetailSchema>
export type AttachProjectToWorkspaceRequest = z.infer<typeof AttachProjectToWorkspaceRequestSchema>
export type WorkspaceActionResponse = z.infer<typeof WorkspaceActionResponseSchema>
