import { sendNextMoveEvalCandidates } from "../api"
import { getNextMoveEvalCandidates } from "../storage"

let syncTimer: ReturnType<typeof window.setTimeout> | null = null

export async function syncNextMoveEvalCandidatesToAdmin() {
  const candidates = await getNextMoveEvalCandidates()
  if (candidates.length === 0) return null
  return sendNextMoveEvalCandidates({ candidates })
}

export function scheduleNextMoveEvalCandidateSync(delayMs = 2000) {
  if (syncTimer) {
    window.clearTimeout(syncTimer)
  }

  syncTimer = window.setTimeout(() => {
    syncTimer = null
    void syncNextMoveEvalCandidatesToAdmin().catch(() => {
      // Telemetry sync is best-effort; local candidate storage remains the source of recovery.
    })
  }, delayMs)
}
