import { Storage } from "@plasmohq/storage"
import type { ProjectSyncState } from "./sync-types"

const storage = new Storage({ area: "local" })
const PROJECT_SYNC_PREFIX = "reeva:project-sync:"

function getProjectSyncKey(projectKey: string) {
  return `${PROJECT_SYNC_PREFIX}${projectKey}`
}

export async function getProjectSyncState(projectKey: string) {
  return ((await storage.get<ProjectSyncState>(getProjectSyncKey(projectKey))) ?? null) as ProjectSyncState | null
}

export async function saveProjectSyncState(state: ProjectSyncState) {
  await storage.set(getProjectSyncKey(state.projectKey), state)
  return state
}

export async function clearProjectSyncState(projectKey: string) {
  await storage.remove(getProjectSyncKey(projectKey))
}
