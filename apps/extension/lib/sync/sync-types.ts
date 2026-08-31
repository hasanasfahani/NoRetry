export type ProjectSyncStatus = "guest" | "local_only" | "syncing" | "synced" | "failed"

export type ProjectSyncState = {
  projectKey: string
  status: ProjectSyncStatus
  cloudProjectId?: string | null
  lastSyncedAt?: string | null
  lastRemoteUpdatedAt?: string | null
  errorMessage?: string | null
}
