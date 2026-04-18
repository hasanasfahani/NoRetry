import type { ResponsePreprocessorOutput } from "@prompt-optimizer/shared/src/schemas"
import type { GoalConstraint } from "../goal/types"
import {
  hasCalorieInfo,
  hasCssSignals,
  hasFullHtmlFile,
  hasHtmlStructure,
  hasIngredientsSection,
  hasInstructionSection,
  hasMarkdownTable,
  hasMacroBreakdown,
  hasResearchSupport,
  matchesCuisineConstraint,
  parseResponseCaloriesPerServing,
  parseResponseMinutes,
  parseResponseProteinGrams,
  parseResponseServingCount,
  responseContradictsExclusion,
  responseIncludesRiceIngredient,
  responseIncludesTextureTips,
  responseMentionsRiceQuantity,
  responsePreservesExclusion,
  responseUsesMethod,
  responseUsesTechnology
} from "./constraint-extractors"

export type EvidenceMatchResult = {
  status: "pass" | "fail" | "unclear" | "contradicted"
  actual?: string | number
  evidence: string[]
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function hasDailyBudgetScope(text: string) {
  const normalized = normalize(text)
  return /\bper day\b|\bdaily\b|\bkcal day\b|\bcalorie day\b|\bday\b/.test(normalized)
}

function hasPerServingScope(text: string) {
  const normalized = normalize(text)
  return /\bper serving\b|\bsingle[-\s]?serving\b|\b1 serving\b/.test(normalized)
}

function calorieMatches(constraint: GoalConstraint, actual: number | null): EvidenceMatchResult {
  if (actual == null) return { status: "unclear", evidence: [] }
  if (!constraint.value || typeof constraint.value === "string" || typeof constraint.value === "number") {
    return { status: "unclear", actual, evidence: [] }
  }

  if (hasDailyBudgetScope(constraint.label) && !hasPerServingScope(constraint.label)) {
    const max = constraint.value.max
    if (max == null) return { status: "unclear", actual, evidence: [] }
    return {
      status: actual <= max ? "pass" : "contradicted",
      actual,
      evidence: [`Response states ${actual} calories per serving, which fits within the daily budget ceiling of ${max}.`]
    }
  }

  return rangeMatches(constraint.value, actual)
}

function rangeMatches(expected: GoalConstraint["value"], actual: number | null): EvidenceMatchResult {
  if (actual == null) return { status: "unclear", evidence: [] }
  if (!expected || typeof expected === "string" || typeof expected === "number") {
    return { status: "unclear", actual, evidence: [] }
  }
  if (expected.exact != null) return { status: actual === expected.exact ? "pass" : "contradicted", actual, evidence: [] }
  if (expected.min != null && expected.max != null) return { status: actual >= expected.min && actual <= expected.max ? "pass" : "contradicted", actual, evidence: [] }
  if (expected.max != null) return { status: actual <= expected.max ? "pass" : "contradicted", actual, evidence: [] }
  if (expected.min != null) return { status: actual >= expected.min ? "pass" : "contradicted", actual, evidence: [] }
  return { status: "unclear", actual, evidence: [] }
}

function servingsMatch(expected: GoalConstraint["value"], responseText: string): EvidenceMatchResult {
  const actual = parseResponseServingCount(responseText)
  if (!actual) return { status: "unclear", evidence: [] }
  const actualValue = actual.max === actual.min ? actual.min : `${actual.min}-${actual.max}`
  if (!expected || typeof expected === "string" || typeof expected === "number") return { status: "unclear", actual: actualValue, evidence: [`Response declares ${actualValue} servings.`] }
  if (expected.exact != null) {
    return {
      status: actual.min === expected.exact && actual.max === expected.exact ? "pass" : "contradicted",
      actual: actualValue,
      evidence: [`Response declares ${actualValue} servings.`]
    }
  }
  if (expected.min != null && expected.max != null) {
    return {
      status: actual.min >= expected.min && actual.max <= expected.max ? "pass" : "contradicted",
      actual: actualValue,
      evidence: [`Response declares ${actualValue} servings.`]
    }
  }
  return { status: "unclear", actual: actualValue, evidence: [`Response declares ${actualValue} servings.`] }
}

export function matchConstraintEvidence(constraint: GoalConstraint, responseText: string, responseSummary: ResponsePreprocessorOutput): EvidenceMatchResult {
  if (constraint.type === "servings" || constraint.type === "count") return servingsMatch(constraint.value, responseText)
  if (constraint.type === "time") {
    const result = rangeMatches(constraint.value, parseResponseMinutes(responseText))
    return { ...result, evidence: result.actual != null ? [`Response states ${result.actual} minutes.`] : [] }
  }
  if (constraint.type === "calories") {
    const result = calorieMatches(constraint, parseResponseCaloriesPerServing(responseText))
    return {
      ...result,
      evidence: result.evidence.length
        ? result.evidence
        : result.actual != null
          ? [`Response states ${result.actual} calories per serving.`]
          : []
    }
  }
  if (constraint.type === "protein") {
    const actual = parseResponseProteinGrams(responseText)
    if (typeof constraint.value === "string" && constraint.value === "high") {
      const pass = actual == null ? /\bhigh[-\s]?protein\b/i.test(responseText) : actual >= 20
      return {
        status: pass ? "pass" : actual == null ? "unclear" : "contradicted",
        actual: actual ?? undefined,
        evidence: actual != null ? [`Response states ${actual}g protein.`] : []
      }
    }
    const result = rangeMatches(constraint.value, actual)
    return { ...result, evidence: actual != null ? [`Response states ${actual}g protein.`] : [] }
  }
  if (constraint.type === "method") {
    return {
      status: responseUsesMethod(constraint.label, responseText) ? "pass" : "contradicted",
      evidence: responseUsesMethod(constraint.label, responseText) ? [`Response uses ${constraint.label}.`] : []
    }
  }
  if (constraint.type === "technology") {
    return {
      status: responseUsesTechnology(constraint.label, responseText, responseSummary) ? "pass" : "contradicted",
      evidence: responseUsesTechnology(constraint.label, responseText, responseSummary) ? [`Response uses ${constraint.label}.`] : []
    }
  }
  if (constraint.type === "exclusion") {
    const target = String(constraint.value ?? constraint.label)
    const contradicted = responseContradictsExclusion(target, responseText)
    const preserved = responsePreservesExclusion(target, responseText)
    return {
      status: contradicted ? "contradicted" : preserved ? "pass" : "unclear",
      evidence: contradicted ? [`Response still includes or mentions ${target}.`] : preserved ? [`Response explicitly avoids ${target}.`] : []
    }
  }
  if (constraint.type === "diet") {
    const explicit = responseSummary.response_text.toLowerCase().includes(constraint.label.toLowerCase())
    const exclusionAligned = /-free\b|\b free\b/i.test(constraint.label)
      ? responsePreservesExclusion(constraint.label, responseText)
      : false
    return {
      status: explicit || exclusionAligned ? "pass" : "unclear",
      evidence: explicit || exclusionAligned ? [`Response explicitly preserves ${constraint.label}.`] : []
    }
  }
  if (constraint.type === "cuisine") {
    const match = matchesCuisineConstraint(constraint.label, responseText)
    return { status: match ? "pass" : "contradicted", evidence: match ? [`Response visibly matches ${constraint.label}.`] : [] }
  }
  if (constraint.type === "storage") {
    const haystack = responseSummary.response_text.toLowerCase()
    const pass = /eat fresh only/i.test(constraint.label) ? /\beat fresh\b|\bserve immediately\b/.test(haystack) : /\bleftovers?\b|\bmeal prep\b|\bfreezer\b/.test(haystack)
    return { status: pass ? "pass" : "unclear", evidence: pass ? [`Response addresses ${constraint.label}.`] : [] }
  }
  if (constraint.type === "budget") {
    const match = responseSummary.response_text.toLowerCase().includes(constraint.label.toLowerCase())
    return { status: match ? "pass" : "unclear", evidence: match ? [`Response addresses ${constraint.label}.`] : [] }
  }
  return {
    status: responseSummary.response_text.toLowerCase().includes(constraint.label.toLowerCase()) ? "pass" : "unclear",
    evidence: []
  }
}

export function matchOutputRequirementEvidence(outputRequirement: string, responseText: string): EvidenceMatchResult {
  const lower = outputRequirement.toLowerCase()
  if (lower.includes("table")) return { status: hasMarkdownTable(responseText) ? "pass" : "fail", evidence: hasMarkdownTable(responseText) ? ["A table is visibly present."] : [] }
  if (lower.includes("ingredients")) return { status: hasIngredientsSection(responseText) ? "pass" : "fail", evidence: hasIngredientsSection(responseText) ? ["Ingredients section is present."] : [] }
  if (lower.includes("step-by-step") || lower.includes("instructions")) return { status: hasInstructionSection(responseText) ? "pass" : "fail", evidence: hasInstructionSection(responseText) ? ["Instructions are present."] : [] }
  if (lower.includes("macro")) return { status: hasMacroBreakdown(responseText) ? "pass" : "fail", evidence: hasMacroBreakdown(responseText) ? ["Macro breakdown is present."] : [] }
  if (lower.includes("calories")) return { status: hasCalorieInfo(responseText) ? "pass" : "fail", evidence: hasCalorieInfo(responseText) ? ["Calories are present."] : [] }
  if (lower.includes("full html")) return { status: hasFullHtmlFile(responseText) ? "pass" : "fail", evidence: hasFullHtmlFile(responseText) ? ["Full HTML file is present."] : [] }
  if (lower.includes("html")) return { status: hasHtmlStructure(responseText) ? "pass" : "fail", evidence: hasHtmlStructure(responseText) ? ["HTML output is present."] : [] }
  if (lower.includes("css")) return { status: hasCssSignals(responseText) ? "pass" : "fail", evidence: hasCssSignals(responseText) ? ["CSS is present."] : [] }
  if (lower.includes("sources")) return { status: hasResearchSupport(responseText) ? "pass" : "fail", evidence: hasResearchSupport(responseText) ? ["Sources are present."] : [] }
  if (lower.includes("texture")) return { status: responseIncludesTextureTips(responseText) ? "pass" : "fail", evidence: responseIncludesTextureTips(responseText) ? ["Texture tips are present."] : [] }
  if (lower.includes("rice")) return { status: responseIncludesRiceIngredient(responseText) ? "pass" : "fail", evidence: responseIncludesRiceIngredient(responseText) ? ["Rice is present."] : [] }
  if (lower.includes("quantity")) return { status: responseMentionsRiceQuantity(responseText) ? "pass" : "fail", evidence: responseMentionsRiceQuantity(responseText) ? ["Exact rice quantity is present."] : [] }
  return { status: "unclear", evidence: [] }
}
