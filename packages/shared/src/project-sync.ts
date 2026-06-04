import * as z from "zod"

export const ProjectSourceSchema = z.enum(["REPLIT", "CHATGPT", "LOVABLE", "MANUAL"])
export const ProjectMemoryDepthSchema = z.enum(["quick", "deep"])
export const ProjectContextStatusSchema = z.enum(["missing", "active", "stale", "conflicted"])
export const ProjectCollaborationModeSchema = z.enum(["fast", "careful", "plan_first"])
export const ProjectProofPreferenceSchema = z.enum(["standard", "proof_required", "files_first"])
export const ProjectExplanationStyleSchema = z.enum(["plain_language", "technical"])
export const ProjectScopePreferenceSchema = z.enum(["narrow", "balanced"])
export const ProjectProgressSurfaceSchema = z.enum(["answer_mode", "prompt_mode"])

export const ProjectPreferenceSettingsSchema = z.object({
  collaborationMode: ProjectCollaborationModeSchema,
  proofPreference: ProjectProofPreferenceSchema,
  explanationStyle: ProjectExplanationStyleSchema,
  scopePreference: ProjectScopePreferenceSchema
})

export const ProjectMemorySnapshotPayloadSchema = z.object({
  projectContext: z.string(),
  currentState: z.string(),
  importedContextRawMarkdown: z.string().nullable().optional(),
  structuredMemoryJson: z.unknown().nullable().optional(),
  memoryDepth: ProjectMemoryDepthSchema.nullable().optional(),
  contextStatus: ProjectContextStatusSchema.nullable().optional(),
  version: z.number().int().positive().optional(),
  updatedAt: z.string().optional()
})

export const ProjectContextImportPayloadSchema = z.object({
  rawMarkdown: z.string(),
  parsedSummaryJson: z.unknown().nullable().optional(),
  importedAt: z.string().optional()
})

export const ProjectProgressPayloadSchema = z.object({
  activeSurface: ProjectProgressSurfaceSchema.nullable().optional(),
  currentWorkflowState: z.string().nullable().optional(),
  promptModeSessionKey: z.string().nullable().optional(),
  promptModeStateJson: z.unknown().nullable().optional(),
  latestPromptDraft: z.string().nullable().optional(),
  latestReviewTargetIdentity: z.string().nullable().optional(),
  latestReviewSummaryJson: z.unknown().nullable().optional(),
  onboardingStateJson: z.unknown().nullable().optional(),
  planningStateJson: z.unknown().nullable().optional(),
  version: z.number().int().positive().optional(),
  updatedAt: z.string().optional()
})

export const ProjectActivityPayloadSchema = z.object({
  eventType: z.string().trim().min(1).max(160),
  payloadJson: z.unknown().nullable().optional(),
  createdAt: z.string().optional()
})

export const ProjectStateSchema = z.object({
  id: z.string(),
  projectKey: z.string(),
  projectLabel: z.string(),
  source: ProjectSourceSchema,
  updatedAt: z.string(),
  memory: ProjectMemorySnapshotPayloadSchema.extend({
    id: z.string(),
    createdAt: z.string()
  }).nullable(),
  preferences: ProjectPreferenceSettingsSchema.extend({
    id: z.string(),
    updatedAt: z.string(),
    createdAt: z.string()
  }).nullable(),
  progress: ProjectProgressPayloadSchema.extend({
    id: z.string(),
    createdAt: z.string()
  }).nullable(),
  latestContextImport: ProjectContextImportPayloadSchema.extend({
    id: z.string()
  }).nullable()
})

export const ProjectListItemSchema = z.object({
  id: z.string(),
  projectKey: z.string(),
  projectLabel: z.string(),
  source: ProjectSourceSchema,
  updatedAt: z.string()
})

export const ProjectListResponseSchema = z.object({
  projects: z.array(ProjectListItemSchema)
})

export const UpsertProjectMemoryRequestSchema = z.object({
  projectLabel: z.string().trim().min(1).max(240),
  source: ProjectSourceSchema.default("REPLIT"),
  projectContext: z.string(),
  currentState: z.string(),
  importedContextRawMarkdown: z.string().nullable().optional(),
  structuredMemoryJson: z.unknown().nullable().optional(),
  memoryDepth: ProjectMemoryDepthSchema.nullable().optional(),
  contextStatus: ProjectContextStatusSchema.nullable().optional(),
  version: z.number().int().positive().optional()
})

export const UpsertProjectPreferencesRequestSchema = z.object({
  projectLabel: z.string().trim().min(1).max(240),
  source: ProjectSourceSchema.default("REPLIT"),
  preferences: ProjectPreferenceSettingsSchema
})

export const CreateProjectContextImportRequestSchema = z.object({
  projectLabel: z.string().trim().min(1).max(240),
  source: ProjectSourceSchema.default("REPLIT"),
  rawMarkdown: z.string().min(1),
  parsedSummaryJson: z.unknown().nullable().optional()
})

export const UpsertProjectProgressRequestSchema = z.object({
  projectLabel: z.string().trim().min(1).max(240),
  source: ProjectSourceSchema.default("REPLIT"),
  progress: ProjectProgressPayloadSchema.omit({
    updatedAt: true
  })
})

export const CreateProjectActivityRequestSchema = z.object({
  projectLabel: z.string().trim().min(1).max(240),
  source: ProjectSourceSchema.default("REPLIT"),
  activity: ProjectActivityPayloadSchema.omit({
    createdAt: true
  })
})

export type ProjectSource = z.infer<typeof ProjectSourceSchema>
export type ProjectMemoryDepth = z.infer<typeof ProjectMemoryDepthSchema>
export type ProjectContextStatus = z.infer<typeof ProjectContextStatusSchema>
export type ProjectProgressSurface = z.infer<typeof ProjectProgressSurfaceSchema>
export type ProjectPreferenceSettingsPayload = z.infer<typeof ProjectPreferenceSettingsSchema>
export type ProjectMemorySnapshotPayload = z.infer<typeof ProjectMemorySnapshotPayloadSchema>
export type ProjectContextImportPayload = z.infer<typeof ProjectContextImportPayloadSchema>
export type ProjectProgressPayload = z.infer<typeof ProjectProgressPayloadSchema>
export type ProjectActivityPayload = z.infer<typeof ProjectActivityPayloadSchema>
export type ProjectState = z.infer<typeof ProjectStateSchema>
export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>
export type UpsertProjectMemoryRequest = z.infer<typeof UpsertProjectMemoryRequestSchema>
export type UpsertProjectPreferencesRequest = z.infer<typeof UpsertProjectPreferencesRequestSchema>
export type CreateProjectContextImportRequest = z.infer<typeof CreateProjectContextImportRequestSchema>
export type UpsertProjectProgressRequest = z.infer<typeof UpsertProjectProgressRequestSchema>
export type CreateProjectActivityRequest = z.infer<typeof CreateProjectActivityRequestSchema>
