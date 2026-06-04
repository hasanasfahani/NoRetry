import type {
  CreateProjectActivityRequest,
  CreateProjectContextImportRequest,
  ProjectContextStatus,
  ProjectListResponse,
  ProjectMemoryDepth,
  ProjectPreferenceSettingsPayload,
  ProjectProgressPayload,
  ProjectState,
  UpsertProjectMemoryRequest,
  UpsertProjectProgressRequest,
  UpsertProjectPreferencesRequest
} from "@prompt-optimizer/shared"
import {
  createProjectActivityLog,
  createProjectContextImport,
  createProjectMemorySnapshot,
  findLatestProjectContextImport,
  findLatestProjectMemorySnapshot,
  findProjectByKey,
  findProjectPreference,
  findProjectProgress,
  listProjectsByUser,
  upsertProject,
  upsertProjectProgress,
  upsertProjectPreference
} from "./project-repository"

function mapMemoryDepth(value: string | null | undefined): ProjectMemoryDepth | null {
  return value === "quick" || value === "deep" ? value : null
}

function mapContextStatus(value: string | null | undefined): ProjectContextStatus | null {
  return value === "missing" || value === "active" || value === "stale" || value === "conflicted" ? value : null
}

function mapPreferences(value: {
  id: string
  collaborationMode: string
  proofPreference: string
  explanationStyle: string
  scopePreference: string
  updatedAt: string
  createdAt: string
} | null): (ProjectPreferenceSettingsPayload & { id: string; updatedAt: string; createdAt: string }) | null {
  if (!value) return null
  if (
    (value.collaborationMode !== "fast" && value.collaborationMode !== "careful" && value.collaborationMode !== "plan_first") ||
    (value.proofPreference !== "standard" &&
      value.proofPreference !== "proof_required" &&
      value.proofPreference !== "files_first") ||
    (value.explanationStyle !== "plain_language" && value.explanationStyle !== "technical") ||
    (value.scopePreference !== "narrow" && value.scopePreference !== "balanced")
  ) {
    return null
  }

  return value as ProjectPreferenceSettingsPayload & { id: string; updatedAt: string; createdAt: string }
}

function mapProgress(value: {
  id: string
  activeSurface: string | null
  currentWorkflowState: string | null
  promptModeSessionKey: string | null
  promptModeStateJson: unknown | null
  latestPromptDraft: string | null
  latestReviewTargetIdentity: string | null
  latestReviewSummaryJson: unknown | null
  onboardingStateJson: unknown | null
  planningStateJson: unknown | null
  version: number
  updatedAt: string
  createdAt: string
} | null): (ProjectProgressPayload & { id: string; updatedAt: string; createdAt: string }) | null {
  if (!value) return null
  if (
    value.activeSurface != null &&
    value.activeSurface !== "answer_mode" &&
    value.activeSurface !== "prompt_mode"
  ) {
    if (value.activeSurface !== "prompt_mode_v2") {
      return null
    }
  }

  return {
    ...value,
    activeSurface: value.activeSurface === "prompt_mode_v2" ? "prompt_mode" : (value.activeSurface as "answer_mode" | "prompt_mode" | null)
  }
}

async function buildProjectState(userId: string, projectKey: string): Promise<ProjectState | null> {
  const project = await findProjectByKey(userId, projectKey)
  if (!project) return null

  const [memory, preferences, progress, latestContextImport] = await Promise.all([
    findLatestProjectMemorySnapshot(project.id),
    findProjectPreference(project.id),
    findProjectProgress(project.id),
    findLatestProjectContextImport(project.id)
  ])

  return {
    id: project.id,
    projectKey: project.projectKey,
    projectLabel: project.projectLabel,
    source: project.source,
    updatedAt: project.updatedAt,
    memory: memory
      ? {
          ...memory,
          memoryDepth: mapMemoryDepth(memory.memoryDepth),
          contextStatus: mapContextStatus(memory.contextStatus)
        }
      : null,
    preferences: mapPreferences(preferences),
    progress: mapProgress(progress),
    latestContextImport
  }
}

export async function listProjectStates(userId: string): Promise<ProjectListResponse> {
  const projects = await listProjectsByUser(userId)
  return {
    projects: projects.map((project) => ({
      id: project.id,
      projectKey: project.projectKey,
      projectLabel: project.projectLabel,
      source: project.source,
      updatedAt: project.updatedAt
    }))
  }
}

export async function getProjectState(userId: string, projectKey: string) {
  return buildProjectState(userId, projectKey)
}

export async function saveProjectMemoryState(userId: string, projectKey: string, input: UpsertProjectMemoryRequest) {
  const project = await upsertProject({
    userId,
    projectKey,
    projectLabel: input.projectLabel,
    source: input.source
  })

  await createProjectMemorySnapshot({
    projectId: project.id,
    projectContext: input.projectContext,
    currentState: input.currentState,
    importedContextRawMarkdown: input.importedContextRawMarkdown ?? null,
    structuredMemoryJson: input.structuredMemoryJson ?? null,
    memoryDepth: input.memoryDepth ?? null,
    contextStatus: input.contextStatus ?? null,
    version: input.version
  })

  return buildProjectState(userId, projectKey)
}

export async function saveProjectPreferencesState(userId: string, projectKey: string, input: UpsertProjectPreferencesRequest) {
  const project = await upsertProject({
    userId,
    projectKey,
    projectLabel: input.projectLabel,
    source: input.source
  })

  await upsertProjectPreference({
    projectId: project.id,
    collaborationMode: input.preferences.collaborationMode,
    proofPreference: input.preferences.proofPreference,
    explanationStyle: input.preferences.explanationStyle,
    scopePreference: input.preferences.scopePreference
  })

  return buildProjectState(userId, projectKey)
}

export async function saveProjectContextImportState(
  userId: string,
  projectKey: string,
  input: CreateProjectContextImportRequest
) {
  const project = await upsertProject({
    userId,
    projectKey,
    projectLabel: input.projectLabel,
    source: input.source
  })

  await createProjectContextImport({
    projectId: project.id,
    rawMarkdown: input.rawMarkdown,
    parsedSummaryJson: input.parsedSummaryJson ?? null
  })

  return buildProjectState(userId, projectKey)
}

export async function saveProjectProgressState(userId: string, projectKey: string, input: UpsertProjectProgressRequest) {
  const project = await upsertProject({
    userId,
    projectKey,
    projectLabel: input.projectLabel,
    source: input.source
  })

  await upsertProjectProgress({
    projectId: project.id,
    activeSurface: input.progress.activeSurface ?? null,
    currentWorkflowState: input.progress.currentWorkflowState ?? null,
    promptModeSessionKey: input.progress.promptModeSessionKey ?? null,
    promptModeStateJson: input.progress.promptModeStateJson ?? null,
    latestPromptDraft: input.progress.latestPromptDraft ?? null,
    latestReviewTargetIdentity: input.progress.latestReviewTargetIdentity ?? null,
    latestReviewSummaryJson: input.progress.latestReviewSummaryJson ?? null,
    onboardingStateJson: input.progress.onboardingStateJson ?? null,
    planningStateJson: input.progress.planningStateJson ?? null,
    version: input.progress.version
  })

  return buildProjectState(userId, projectKey)
}

export async function saveProjectActivityState(userId: string, projectKey: string, input: CreateProjectActivityRequest) {
  const project = await upsertProject({
    userId,
    projectKey,
    projectLabel: input.projectLabel,
    source: input.source
  })

  return createProjectActivityLog({
    projectId: project.id,
    eventType: input.activity.eventType,
    payloadJson: input.activity.payloadJson ?? null
  })
}
