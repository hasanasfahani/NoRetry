import type { GoalCandidate } from "./candidate-types"
import { isCalorieValue, isCountRangeValue, isDurationValue, isExactCountValue, isRangeLike } from "./value-shape-guards"

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function hasTimeUnits(value: string) {
  return /\b(?:minutes?|mins?|hours?|hrs?)\b/i.test(value)
}

function hasServingUnits(value: string) {
  return /\b(?:person|people|meal|meals|servings?)\b/i.test(value)
}

function looksLikeBudget(value: string) {
  return /\b(?:low|moderate|cheap|budget-friendly|budget)\b/i.test(value)
}

function looksLikeStorage(value: string) {
  return /\b(?:leftovers?|eat fresh|freezer-friendly|meal prep|cold later)\b/i.test(value)
}

function looksLikeOutputRequirement(value: string) {
  return /\b(?:ingredients?|steps?|instructions?|macros?|calories?|sections?|html|json|table)\b/i.test(value)
}

function isWholeSentence(candidate: GoalCandidate) {
  const source = candidate.sourceText.trim()
  const match = candidate.matchedText.trim()
  return source.length > 80 && source === match
}

export function validateSlotCompatibility(candidate: GoalCandidate) {
  const matched = candidate.matchedText
  const normalized = normalizeText(matched)

  switch (candidate.slot) {
    case "servings":
      if (looksLikeOutputRequirement(candidate.sourceText) && /\bper serving\b/i.test(candidate.sourceText)) {
        return { compatible: false, reason: "output_sentence_not_servings" }
      }
      if (!hasServingUnits(matched)) return { compatible: false, reason: "servings_requires_serving_units" }
      if (isCalorieValue(candidate.value)) return { compatible: false, reason: "servings_rejects_calorie_ranges" }
      if (candidate.value != null && !isExactCountValue(candidate.value) && !isCountRangeValue(candidate.value)) {
        return { compatible: false, reason: "servings_requires_count_shape" }
      }
      return { compatible: true, reason: "servings_shape_valid" }
    case "time":
      if (!hasTimeUnits(matched)) return { compatible: false, reason: "time_requires_duration_units" }
      if (isCalorieValue(candidate.value)) return { compatible: false, reason: "time_rejects_calorie_ranges" }
      if (candidate.value != null && !isDurationValue(candidate.value)) return { compatible: false, reason: "time_requires_duration_shape" }
      return { compatible: true, reason: "time_shape_valid" }
    case "calories":
      if (!/\b(?:calories?|kcal)\b/i.test(matched)) return { compatible: false, reason: "calories_requires_calorie_units" }
      if (candidate.value != null && !isCalorieValue(candidate.value)) return { compatible: false, reason: "calories_requires_calorie_shape" }
      return { compatible: true, reason: "calorie_shape_valid" }
    case "budget":
      if (isWholeSentence(candidate)) return { compatible: false, reason: "whole_goal_not_budget" }
      if (!looksLikeBudget(matched)) return { compatible: false, reason: "budget_requires_budget_language" }
      return { compatible: true, reason: "budget_language_valid" }
    case "storage":
      if (isWholeSentence(candidate)) return { compatible: false, reason: "whole_goal_not_storage" }
      if (!looksLikeStorage(matched)) return { compatible: false, reason: "storage_requires_storage_language" }
      return { compatible: true, reason: "storage_language_valid" }
    case "output_requirement":
      if (!looksLikeOutputRequirement(matched)) return { compatible: false, reason: "output_requirement_requires_output_language" }
      return { compatible: true, reason: "output_requirement_valid" }
    default:
      if (candidate.slot === "generic" && normalized.length > 60) {
        return { compatible: false, reason: "generic_too_broad" }
      }
      if (candidate.value != null && isRangeLike(candidate.value) && candidate.slot !== "protein" && candidate.slot !== "count") {
        return { compatible: true, reason: "range_shape_allowed" }
      }
      return { compatible: true, reason: "slot_compatible" }
  }
}
