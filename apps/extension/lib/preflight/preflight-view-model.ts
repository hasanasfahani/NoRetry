import type { ReviewSignalState } from "../review/types"
import type { PreflightAssessment } from "./preflight-risk-engine"

export function mapPreflightAssessmentToTypingSignal(input: {
  assessment: PreflightAssessment
  promptKey: string | null
}): ReviewSignalState {
  const { assessment, promptKey } = input
  const tooltip = assessment.topSignal?.label || "Shape this prompt before sending"
  return {
    state: "typing",
    tooltip,
    ariaLabel: `Review signal: ${tooltip}`,
    targetKey: promptKey
  }
}
