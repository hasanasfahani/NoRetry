import type { GoalContract } from "../goal/types"
import { buildPreflightSignals, type PreflightSignal } from "./preflight-signals"

export type PreflightRiskLevel = "low" | "medium" | "high"

export type PreflightAssessment = {
  riskLevel: PreflightRiskLevel
  signals: PreflightSignal[]
  topSignal: PreflightSignal | null
  summary: string
}

function riskLevelFromSignals(signals: PreflightSignal[]): PreflightRiskLevel {
  if (signals.some((signal) => signal.severity === "critical")) return "high"
  if (signals.length >= 2 || signals.some((signal) => signal.severity === "warning")) return "medium"
  return "low"
}

function buildSummary(signals: PreflightSignal[]) {
  if (!signals.length) return "Prompt looks specific enough to send."
  if (signals.length === 1) return signals[0].label
  return `${signals[0].label} ${signals[1].label}`.trim()
}

export function buildPreflightAssessment(input: { goalContract: GoalContract; promptText: string }): PreflightAssessment {
  const signals = buildPreflightSignals(input)
  return {
    riskLevel: riskLevelFromSignals(signals),
    signals,
    topSignal: signals[0] ?? null,
    summary: buildSummary(signals)
  }
}
