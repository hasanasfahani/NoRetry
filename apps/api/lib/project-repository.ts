import { Prisma } from "@prisma/client"
import { runtimeFlags } from "./env"
import { prisma } from "./prisma"

type ProjectRecord = {
  id: string
  userId: string
  projectKey: string
  projectLabel: string
  source: "REPLIT" | "CHATGPT" | "LOVABLE" | "MANUAL"
  createdAt: string
  updatedAt: string
}

type ProjectMemorySnapshotRecord = {
  id: string
  projectId: string
  projectContext: string
  currentState: string
  importedContextRawMarkdown: string | null
  structuredMemoryJson: unknown | null
  memoryDepth: string | null
  contextStatus: string | null
  version: number
  createdAt: string
  updatedAt: string
}

type ProjectPreferenceRecord = {
  id: string
  projectId: string
  collaborationMode: string
  proofPreference: string
  explanationStyle: string
  scopePreference: string
  createdAt: string
  updatedAt: string
}

type ProjectContextImportRecord = {
  id: string
  projectId: string
  rawMarkdown: string
  parsedSummaryJson: unknown | null
  importedAt: string
}

type ProjectProgressRecord = {
  id: string
  projectId: string
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
  createdAt: string
  updatedAt: string
}

type ProjectActivityLogRecord = {
  id: string
  projectId: string
  eventType: string
  payloadJson: unknown | null
  createdAt: string
}

const memoryStore = {
  projectsById: new Map<string, ProjectRecord>(),
  projectsByUserAndKey: new Map<string, ProjectRecord>(),
  memorySnapshotsByProjectId: new Map<string, ProjectMemorySnapshotRecord[]>(),
  preferencesByProjectId: new Map<string, ProjectPreferenceRecord>(),
  contextImportsByProjectId: new Map<string, ProjectContextImportRecord[]>(),
  progressByProjectId: new Map<string, ProjectProgressRecord>(),
  activityLogsByProjectId: new Map<string, ProjectActivityLogRecord[]>()
}

function nowIso() {
  return new Date().toISOString()
}

function projectCompositeKey(userId: string, projectKey: string) {
  return `${userId}::${projectKey}`
}

function mapProjectRecord(project: {
  id: string
  userId: string
  projectKey: string
  projectLabel: string
  source: string
  createdAt: Date | string
  updatedAt: Date | string
}): ProjectRecord {
  return {
    ...project,
    source: project.source as ProjectRecord["source"],
    createdAt: project.createdAt instanceof Date ? project.createdAt.toISOString() : project.createdAt,
    updatedAt: project.updatedAt instanceof Date ? project.updatedAt.toISOString() : project.updatedAt
  }
}

function mapMemorySnapshotRecord(snapshot: {
  id: string
  projectId: string
  projectContext: string
  currentState: string
  importedContextRawMarkdown: string | null
  structuredMemoryJson: unknown | null
  memoryDepth: string | null
  contextStatus: string | null
  version: number
  createdAt: Date | string
  updatedAt: Date | string
}): ProjectMemorySnapshotRecord {
  return {
    ...snapshot,
    createdAt: snapshot.createdAt instanceof Date ? snapshot.createdAt.toISOString() : snapshot.createdAt,
    updatedAt: snapshot.updatedAt instanceof Date ? snapshot.updatedAt.toISOString() : snapshot.updatedAt
  }
}

function mapPreferenceRecord(preference: {
  id: string
  projectId: string
  collaborationMode: string
  proofPreference: string
  explanationStyle: string
  scopePreference: string
  createdAt: Date | string
  updatedAt: Date | string
}): ProjectPreferenceRecord {
  return {
    ...preference,
    createdAt: preference.createdAt instanceof Date ? preference.createdAt.toISOString() : preference.createdAt,
    updatedAt: preference.updatedAt instanceof Date ? preference.updatedAt.toISOString() : preference.updatedAt
  }
}

function mapContextImportRecord(record: {
  id: string
  projectId: string
  rawMarkdown: string
  parsedSummaryJson: unknown | null
  importedAt: Date | string
}): ProjectContextImportRecord {
  return {
    ...record,
    importedAt: record.importedAt instanceof Date ? record.importedAt.toISOString() : record.importedAt
  }
}

function mapProjectProgressRecord(record: {
  id: string
  projectId: string
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
  createdAt: Date | string
  updatedAt: Date | string
}): ProjectProgressRecord {
  return {
    ...record,
    createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt,
    updatedAt: record.updatedAt instanceof Date ? record.updatedAt.toISOString() : record.updatedAt
  }
}

function mapProjectActivityLogRecord(record: {
  id: string
  projectId: string
  eventType: string
  payloadJson: unknown | null
  createdAt: Date | string
}): ProjectActivityLogRecord {
  return {
    ...record,
    createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt
  }
}

export async function listProjectsByUser(userId: string) {
  if (!runtimeFlags.enableDb || !prisma) {
    return [...memoryStore.projectsById.values()]
      .filter((project) => project.userId === userId)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  }

  const projects = await prisma.project.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" }
  })

  return projects.map(mapProjectRecord)
}

export async function findProjectByKey(userId: string, projectKey: string) {
  if (!runtimeFlags.enableDb || !prisma) {
    return memoryStore.projectsByUserAndKey.get(projectCompositeKey(userId, projectKey)) ?? null
  }

  const project = await prisma.project.findUnique({
    where: {
      userId_projectKey: {
        userId,
        projectKey
      }
    }
  })

  return project ? mapProjectRecord(project) : null
}

export async function upsertProject(input: {
  userId: string
  projectKey: string
  projectLabel: string
  source: "REPLIT" | "CHATGPT" | "LOVABLE" | "MANUAL"
}) {
  if (!runtimeFlags.enableDb || !prisma) {
    const composite = projectCompositeKey(input.userId, input.projectKey)
    const existing = memoryStore.projectsByUserAndKey.get(composite)
    const record: ProjectRecord = existing
      ? {
          ...existing,
          projectLabel: input.projectLabel,
          source: input.source,
          updatedAt: nowIso()
        }
      : {
          id: crypto.randomUUID(),
          userId: input.userId,
          projectKey: input.projectKey,
          projectLabel: input.projectLabel,
          source: input.source,
          createdAt: nowIso(),
          updatedAt: nowIso()
        }

    memoryStore.projectsById.set(record.id, record)
    memoryStore.projectsByUserAndKey.set(composite, record)
    return record
  }

  const project = await prisma.project.upsert({
    where: {
      userId_projectKey: {
        userId: input.userId,
        projectKey: input.projectKey
      }
    },
    create: input,
    update: {
      projectLabel: input.projectLabel,
      source: input.source
    }
  })

  return mapProjectRecord(project)
}

export async function createProjectMemorySnapshot(input: {
  projectId: string
  projectContext: string
  currentState: string
  importedContextRawMarkdown?: string | null
  structuredMemoryJson?: unknown | null
  memoryDepth?: string | null
  contextStatus?: string | null
  version?: number
}) {
  if (!runtimeFlags.enableDb || !prisma) {
    const existing = memoryStore.memorySnapshotsByProjectId.get(input.projectId) ?? []
    const latestVersion = existing[existing.length - 1]?.version ?? 0
    const record: ProjectMemorySnapshotRecord = {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      projectContext: input.projectContext,
      currentState: input.currentState,
      importedContextRawMarkdown: input.importedContextRawMarkdown ?? null,
      structuredMemoryJson: input.structuredMemoryJson ?? null,
      memoryDepth: input.memoryDepth ?? null,
      contextStatus: input.contextStatus ?? null,
      version: input.version ?? latestVersion + 1,
      createdAt: nowIso(),
      updatedAt: nowIso()
    }
    memoryStore.memorySnapshotsByProjectId.set(input.projectId, [...existing, record])
    return record
  }

  const snapshot = await prisma.projectMemorySnapshot.create({
    data: {
      projectId: input.projectId,
      projectContext: input.projectContext,
      currentState: input.currentState,
      importedContextRawMarkdown: input.importedContextRawMarkdown ?? null,
      structuredMemoryJson:
        input.structuredMemoryJson === undefined
          ? undefined
          : input.structuredMemoryJson === null
            ? Prisma.JsonNull
            : (input.structuredMemoryJson as Prisma.InputJsonValue),
      memoryDepth: input.memoryDepth ?? null,
      contextStatus: input.contextStatus ?? null,
      version: input.version
    }
  })

  return mapMemorySnapshotRecord(snapshot)
}

export async function findLatestProjectMemorySnapshot(projectId: string) {
  if (!runtimeFlags.enableDb || !prisma) {
    const snapshots = memoryStore.memorySnapshotsByProjectId.get(projectId) ?? []
    return snapshots[snapshots.length - 1] ?? null
  }

  const snapshot = await prisma.projectMemorySnapshot.findFirst({
    where: { projectId },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
  })

  return snapshot ? mapMemorySnapshotRecord(snapshot) : null
}

export async function upsertProjectPreference(input: {
  projectId: string
  collaborationMode: string
  proofPreference: string
  explanationStyle: string
  scopePreference: string
}) {
  if (!runtimeFlags.enableDb || !prisma) {
    const existing = memoryStore.preferencesByProjectId.get(input.projectId)
    const record: ProjectPreferenceRecord = existing
      ? {
          ...existing,
          collaborationMode: input.collaborationMode,
          proofPreference: input.proofPreference,
          explanationStyle: input.explanationStyle,
          scopePreference: input.scopePreference,
          updatedAt: nowIso()
        }
      : {
          id: crypto.randomUUID(),
          projectId: input.projectId,
          collaborationMode: input.collaborationMode,
          proofPreference: input.proofPreference,
          explanationStyle: input.explanationStyle,
          scopePreference: input.scopePreference,
          createdAt: nowIso(),
          updatedAt: nowIso()
        }

    memoryStore.preferencesByProjectId.set(input.projectId, record)
    return record
  }

  const preference = await prisma.projectPreference.upsert({
    where: { projectId: input.projectId },
    create: input,
    update: {
      collaborationMode: input.collaborationMode,
      proofPreference: input.proofPreference,
      explanationStyle: input.explanationStyle,
      scopePreference: input.scopePreference
    }
  })

  return mapPreferenceRecord(preference)
}

export async function findProjectPreference(projectId: string) {
  if (!runtimeFlags.enableDb || !prisma) {
    return memoryStore.preferencesByProjectId.get(projectId) ?? null
  }

  const preference = await prisma.projectPreference.findUnique({
    where: { projectId }
  })

  return preference ? mapPreferenceRecord(preference) : null
}

export async function createProjectContextImport(input: {
  projectId: string
  rawMarkdown: string
  parsedSummaryJson?: unknown | null
  importedAt?: string | null
}) {
  if (!runtimeFlags.enableDb || !prisma) {
    const existing = memoryStore.contextImportsByProjectId.get(input.projectId) ?? []
    const record: ProjectContextImportRecord = {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      rawMarkdown: input.rawMarkdown,
      parsedSummaryJson: input.parsedSummaryJson ?? null,
      importedAt: input.importedAt ?? nowIso()
    }
    memoryStore.contextImportsByProjectId.set(input.projectId, [...existing, record])
    return record
  }

  const record = await prisma.projectContextImport.create({
    data: {
      projectId: input.projectId,
      rawMarkdown: input.rawMarkdown,
      parsedSummaryJson:
        input.parsedSummaryJson === undefined
          ? undefined
          : input.parsedSummaryJson === null
            ? Prisma.JsonNull
            : (input.parsedSummaryJson as Prisma.InputJsonValue),
      importedAt: input.importedAt ? new Date(input.importedAt) : undefined
    }
  })

  return mapContextImportRecord(record)
}

export async function findLatestProjectContextImport(projectId: string) {
  if (!runtimeFlags.enableDb || !prisma) {
    const records = memoryStore.contextImportsByProjectId.get(projectId) ?? []
    return records[records.length - 1] ?? null
  }

  const record = await prisma.projectContextImport.findFirst({
    where: { projectId },
    orderBy: { importedAt: "desc" }
  })

  return record ? mapContextImportRecord(record) : null
}

export async function upsertProjectProgress(input: {
  projectId: string
  activeSurface?: string | null
  currentWorkflowState?: string | null
  promptModeSessionKey?: string | null
  promptModeStateJson?: unknown | null
  latestPromptDraft?: string | null
  latestReviewTargetIdentity?: string | null
  latestReviewSummaryJson?: unknown | null
  onboardingStateJson?: unknown | null
  planningStateJson?: unknown | null
  version?: number
}) {
  if (!runtimeFlags.enableDb || !prisma) {
    const existing = memoryStore.progressByProjectId.get(input.projectId)
    const record: ProjectProgressRecord = existing
      ? {
          ...existing,
          activeSurface: input.activeSurface ?? null,
          currentWorkflowState: input.currentWorkflowState ?? null,
          promptModeSessionKey: input.promptModeSessionKey ?? null,
          promptModeStateJson: input.promptModeStateJson ?? null,
          latestPromptDraft: input.latestPromptDraft ?? null,
          latestReviewTargetIdentity: input.latestReviewTargetIdentity ?? null,
          latestReviewSummaryJson: input.latestReviewSummaryJson ?? null,
          onboardingStateJson: input.onboardingStateJson ?? null,
          planningStateJson: input.planningStateJson ?? null,
          version: input.version ?? existing.version + 1,
          updatedAt: nowIso()
        }
      : {
          id: crypto.randomUUID(),
          projectId: input.projectId,
          activeSurface: input.activeSurface ?? null,
          currentWorkflowState: input.currentWorkflowState ?? null,
          promptModeSessionKey: input.promptModeSessionKey ?? null,
          promptModeStateJson: input.promptModeStateJson ?? null,
          latestPromptDraft: input.latestPromptDraft ?? null,
          latestReviewTargetIdentity: input.latestReviewTargetIdentity ?? null,
          latestReviewSummaryJson: input.latestReviewSummaryJson ?? null,
          onboardingStateJson: input.onboardingStateJson ?? null,
          planningStateJson: input.planningStateJson ?? null,
          version: input.version ?? 1,
          createdAt: nowIso(),
          updatedAt: nowIso()
        }

    memoryStore.progressByProjectId.set(input.projectId, record)
    return record
  }

  const existing = await prisma.projectProgress.findUnique({
    where: { projectId: input.projectId }
  })

  if (!existing) {
    const created = await prisma.projectProgress.create({
      data: {
        projectId: input.projectId,
        activeSurface: input.activeSurface ?? null,
        currentWorkflowState: input.currentWorkflowState ?? null,
        promptModeSessionKey: input.promptModeSessionKey ?? null,
        promptModeStateJson:
          input.promptModeStateJson === undefined
            ? undefined
            : input.promptModeStateJson === null
              ? Prisma.JsonNull
              : (input.promptModeStateJson as Prisma.InputJsonValue),
        latestPromptDraft: input.latestPromptDraft ?? null,
        latestReviewTargetIdentity: input.latestReviewTargetIdentity ?? null,
        latestReviewSummaryJson:
          input.latestReviewSummaryJson === undefined
            ? undefined
            : input.latestReviewSummaryJson === null
              ? Prisma.JsonNull
              : (input.latestReviewSummaryJson as Prisma.InputJsonValue),
        onboardingStateJson:
          input.onboardingStateJson === undefined
            ? undefined
            : input.onboardingStateJson === null
              ? Prisma.JsonNull
              : (input.onboardingStateJson as Prisma.InputJsonValue),
        planningStateJson:
          input.planningStateJson === undefined
            ? undefined
            : input.planningStateJson === null
              ? Prisma.JsonNull
              : (input.planningStateJson as Prisma.InputJsonValue),
        version: input.version ?? 1
      }
    })

    return mapProjectProgressRecord(created)
  }

  const updated = await prisma.projectProgress.update({
    where: { projectId: input.projectId },
    data: {
      activeSurface: input.activeSurface ?? null,
      currentWorkflowState: input.currentWorkflowState ?? null,
      promptModeSessionKey: input.promptModeSessionKey ?? null,
      ...(input.promptModeStateJson === undefined
        ? {}
        : {
            promptModeStateJson:
              input.promptModeStateJson === null
                ? Prisma.JsonNull
                : (input.promptModeStateJson as Prisma.InputJsonValue)
          }),
      latestPromptDraft: input.latestPromptDraft ?? null,
      latestReviewTargetIdentity: input.latestReviewTargetIdentity ?? null,
      ...(input.latestReviewSummaryJson === undefined
        ? {}
        : {
            latestReviewSummaryJson:
              input.latestReviewSummaryJson === null
                ? Prisma.JsonNull
                : (input.latestReviewSummaryJson as Prisma.InputJsonValue)
          }),
      ...(input.onboardingStateJson === undefined
        ? {}
        : {
            onboardingStateJson:
              input.onboardingStateJson === null
                ? Prisma.JsonNull
                : (input.onboardingStateJson as Prisma.InputJsonValue)
          }),
      ...(input.planningStateJson === undefined
        ? {}
        : {
            planningStateJson:
              input.planningStateJson === null
                ? Prisma.JsonNull
                : (input.planningStateJson as Prisma.InputJsonValue)
          }),
      version: input.version ?? existing.version + 1
    }
  })

  return mapProjectProgressRecord(updated)
}

export async function findProjectProgress(projectId: string) {
  if (!runtimeFlags.enableDb || !prisma) {
    return memoryStore.progressByProjectId.get(projectId) ?? null
  }

  const record = await prisma.projectProgress.findUnique({
    where: { projectId }
  })

  return record ? mapProjectProgressRecord(record) : null
}

export async function createProjectActivityLog(input: {
  projectId: string
  eventType: string
  payloadJson?: unknown | null
}) {
  if (!runtimeFlags.enableDb || !prisma) {
    const existing = memoryStore.activityLogsByProjectId.get(input.projectId) ?? []
    const record: ProjectActivityLogRecord = {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      eventType: input.eventType,
      payloadJson: input.payloadJson ?? null,
      createdAt: nowIso()
    }
    memoryStore.activityLogsByProjectId.set(input.projectId, [...existing, record])
    return record
  }

  const record = await prisma.projectActivityLog.create({
    data: {
      projectId: input.projectId,
      eventType: input.eventType,
      payloadJson:
        input.payloadJson === undefined
          ? undefined
          : input.payloadJson === null
            ? Prisma.JsonNull
            : (input.payloadJson as Prisma.InputJsonValue)
    }
  })

  return mapProjectActivityLogRecord(record)
}
