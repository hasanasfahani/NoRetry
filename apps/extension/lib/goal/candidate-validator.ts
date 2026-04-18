import { sanitizeConstraintLabel, sanitizeOutputRequirement } from "../review/sanitizers"
import type { GoalCandidate, GoalCandidateValidation } from "./candidate-types"
import { validateSlotCompatibility } from "./slot-compatibility"

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function isWholeGoalLeak(candidate: GoalCandidate) {
  const source = normalizeText(candidate.sourceText)
  const match = normalizeText(candidate.matchedText)
  return (
    candidate.sourceField === "task_goal" &&
    source.length > 80 &&
    match === source
  )
}

function isOutputRequirementText(value: string) {
  return /\bingredients?\b|\binstructions?\b|\bsteps?\b|\bmacros?\b|\bcalories?\b|\bfull html file\b|\bjson\b|\btable\b/i.test(value)
}

function isDuplicateOfExisting(candidate: GoalCandidate, kept: GoalCandidate[]) {
  const key = `${candidate.slot}:${normalizeText(candidate.matchedText).toLowerCase()}`
  return kept.some((item) => `${item.slot}:${normalizeText(item.matchedText).toLowerCase()}` === key)
}

export function validateGoalCandidates(candidates: GoalCandidate[]) {
  const kept: GoalCandidate[] = []
  const decisions: GoalCandidateValidation[] = []

  for (const candidate of candidates) {
    const cleanedMatch =
      candidate.slot === "output_requirement"
        ? sanitizeOutputRequirement(candidate.matchedText)
        : sanitizeConstraintLabel(candidate.matchedText)

    if (!cleanedMatch) {
      decisions.push({ candidate, kept: false, reason: "sanitized_empty" })
      continue
    }

    const cleanedCandidate = { ...candidate, matchedText: cleanedMatch }

    if (isWholeGoalLeak(cleanedCandidate)) {
      decisions.push({ candidate: cleanedCandidate, kept: false, reason: "whole_goal_not_allowed" })
      continue
    }

    if (isOutputRequirementText(cleanedCandidate.sourceText) && /\bper serving\b/i.test(cleanedCandidate.sourceText) && cleanedCandidate.slot === "servings") {
      decisions.push({ candidate: cleanedCandidate, kept: false, reason: "output_requirement_not_servings" })
      continue
    }

    if (cleanedCandidate.slot === "generic" && cleanedCandidate.confidence === "low") {
      decisions.push({ candidate: cleanedCandidate, kept: false, reason: "low_confidence_generic" })
      continue
    }

    const slotValidation = validateSlotCompatibility(cleanedCandidate)
    if (!slotValidation.compatible) {
      decisions.push({ candidate: cleanedCandidate, kept: false, reason: slotValidation.reason })
      continue
    }

    if (isDuplicateOfExisting(cleanedCandidate, kept)) {
      decisions.push({ candidate: cleanedCandidate, kept: false, reason: "duplicate" })
      continue
    }

    kept.push(cleanedCandidate)
    decisions.push({ candidate: cleanedCandidate, kept: true, reason: "validated" })
  }

  return {
    kept,
    decisions
  }
}
