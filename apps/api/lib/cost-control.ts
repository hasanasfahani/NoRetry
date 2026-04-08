import { DETECTION_THRESHOLDS } from "@prompt-optimizer/shared"

const sessionDiagnosisWindow = new Map<string, number[]>()

export function trimForBudget(value: string, maxChars: number) {
  return value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value
}

export function canRunDiagnosis(sessionId: string) {
  // Rate limiting lives at the session level so a single noisy Replit thread cannot burn diagnosis budget.
  const now = Date.now()
  const hourAgo = now - 1000 * 60 * 60
  const current = (sessionDiagnosisWindow.get(sessionId) ?? []).filter((timestamp) => timestamp > hourAgo)
  if (current.length >= DETECTION_THRESHOLDS.afterRateLimitPerHour) {
    sessionDiagnosisWindow.set(sessionId, current)
    return false
  }

  current.push(now)
  sessionDiagnosisWindow.set(sessionId, current)
  return true
}
