import type { GoalCandidate } from "./candidate-types"

function sourceRank(sourceField: GoalCandidate["sourceField"]) {
  switch (sourceField) {
    case "key_requirements":
      return 5
    case "constraints":
      return 4
    case "output_format":
      return 4
    case "required_inputs":
      return 4
    case "answers":
      return 3
    case "task_goal":
      return 2
    default:
      return 1
  }
}

function confidenceRank(confidence: GoalCandidate["confidence"]) {
  switch (confidence) {
    case "high":
      return 3
    case "medium":
      return 2
    default:
      return 1
  }
}

function extractorRank(extractor: string) {
  if (extractor.includes("generic")) return 1
  if (extractor.includes("keyword")) return 2
  if (extractor.includes("pattern")) return 3
  return 2
}

function matchSpecificityRank(candidate: GoalCandidate) {
  const text = candidate.matchedText.toLowerCase()
  if (/\b(?:under|less than|<=?|≤|up to|at most|max(?:imum)?|no more than|at least|>=?|≥|minimum|min(?:imum)?|no less than)\b/.test(text)) return 4
  if (/\b\d+\s*(?:-|–|to)\s*\d+\b/.test(text)) return 3
  if (/\bexact(?:ly)?\b|\bprecisely\b/.test(text)) return 2
  if (/\bfull\b|\bonly\b/.test(text)) return 2
  return 1
}

export function compareCandidateStrength(left: GoalCandidate, right: GoalCandidate) {
  const sourceDelta = sourceRank(right.sourceField) - sourceRank(left.sourceField)
  if (sourceDelta !== 0) return sourceDelta
  const confidenceDelta = confidenceRank(right.confidence) - confidenceRank(left.confidence)
  if (confidenceDelta !== 0) return confidenceDelta
  const specificityDelta = matchSpecificityRank(right) - matchSpecificityRank(left)
  if (specificityDelta !== 0) return specificityDelta
  return extractorRank(right.extractor) - extractorRank(left.extractor)
}
