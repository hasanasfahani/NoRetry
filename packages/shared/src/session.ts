import { DETECTION_THRESHOLDS } from "./constants"
import type { SessionSummary } from "./schemas"

export function summarizeSessionMemory(memory: Partial<SessionSummary> | undefined): Partial<SessionSummary> | undefined {
  if (!memory) return undefined
  return {
    sessionId: memory.sessionId ?? "local-session",
    lastPrompts: (memory.lastPrompts ?? []).slice(-DETECTION_THRESHOLDS.sessionPromptLimit),
    lastOptimizedPrompts: (memory.lastOptimizedPrompts ?? []).slice(-DETECTION_THRESHOLDS.sessionPromptLimit),
    lastIntent: memory.lastIntent,
    retryCount: memory.retryCount ?? 0,
    lastIssueDetected: memory.lastIssueDetected ?? null,
    lastProbableStatus: memory.lastProbableStatus ?? "UNKNOWN"
  }
}
