import type { ReviewSignalState } from "../review/types"
import type { PreflightAssessment } from "./preflight-risk-engine"
import type { ArchitectureConflictWarning } from "./preflight-signals"

export type ArchitectureConflictWarningViewModel = ArchitectureConflictWarning & {
  title: "Architecture conflict"
}

export function mapArchitectureConflictWarningToViewModel(
  warning: ArchitectureConflictWarning | null | undefined
): ArchitectureConflictWarningViewModel | null {
  try {
    if (!warning) return null
    return {
      title: "Architecture conflict",
      storedDecision: warning.storedDecision,
      conflictingRequest: warning.conflictingRequest,
      practicalConsequence: warning.practicalConsequence,
      choices: warning.choices.map((choice) => ({ ...choice }))
    }
  } catch {
    return null
  }
}

export function mapPreflightAssessmentToTypingSignal(input: {
  assessment: PreflightAssessment
  promptKey: string | null
}): ReviewSignalState {
  try {
    const { assessment, promptKey } = input
    const tooltip = assessment.topSignal?.label || "Shape this prompt before sending"
    const architectureWarning = mapArchitectureConflictWarningToViewModel(
      assessment.topSignal?.architectureWarning
    )
    return {
      state: "typing",
      tooltip,
      ariaLabel: `Review signal: ${tooltip}`,
      targetKey: promptKey,
      ...(architectureWarning ? { reason: architectureWarning.practicalConsequence } : {}),
      ...(assessment.engineerWarning ? { engineerWarning: assessment.engineerWarning } : {})
    }
  } catch {
    return {
      state: "typing",
      tooltip: "Shape this prompt before sending",
      ariaLabel: "Review signal: Shape this prompt before sending",
      targetKey: input.promptKey
    }
  }
}
