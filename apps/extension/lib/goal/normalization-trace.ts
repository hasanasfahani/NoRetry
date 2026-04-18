import type { GoalCandidate, GoalCandidateValidation } from "./candidate-types"

export type NormalizationTraceItem = {
  sourceField: GoalCandidate["sourceField"]
  sourceText: string
  matchedSourceSpan: string
  slot: GoalCandidate["slot"]
  extractor: string
  decision: "kept" | "dropped" | "merged"
  reason: string
}

export type GoalNormalizationTrace = {
  extractedCandidates: GoalCandidate[]
  validationDecisions: GoalCandidateValidation[]
  canonicalDecisions: NormalizationTraceItem[]
}

export function createEmptyNormalizationTrace(): GoalNormalizationTrace {
  return {
    extractedCandidates: [],
    validationDecisions: [],
    canonicalDecisions: []
  }
}
