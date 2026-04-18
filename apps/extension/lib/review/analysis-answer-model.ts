import type { AnalysisArtifactFamily } from "./analysis-artifact-family"
import { detectAnalysisArtifactFamily } from "./analysis-artifact-family"
import type { AnalysisQuantitativeObservation } from "./analysis-semantics"
import { buildAnalysisAnswerSlots, type AnalysisSlotValue } from "./analysis-slot-extractors"
import {
  hasIngredientsSection,
  hasInstructionSection,
  hasMacroBreakdown,
  hasMarkdownTable,
  parseQuantitativeObservations,
  parseResponseBudgetRange,
  parseResponseCaloriesPerServing,
  parseResponseServingCount,
  parseResponseMinutes,
  parseResponseProteinGrams
} from "./constraint-extractors"

export type AnalysisAnswerModel = {
  artifactFamily: AnalysisArtifactFamily
  rawAnswer: string
  wordCount: number
  hasTable: boolean
  hasIngredients: boolean
  hasInstructions: boolean
  hasMacroBreakdown: boolean
  hasCalorieInfo: boolean
  servingCount: { min: number; max: number } | null
  minutes: number | null
  caloriesPerServing: number | null
  proteinGrams: number | null
  budgetRange: { min: number; max: number } | null
  quantitativeObservations: AnalysisQuantitativeObservation[]
  subjectLine: string | null
  exactUtcTimeOptions: string[]
  hasApology: boolean
  asksForConfirmation: boolean
  mentionsCalendarUpdate: boolean
  formalTone: boolean
  hasSmallTalk: boolean
  explicitlyNoSpice: boolean
  dairyFreeSignals: boolean
  hasCodeBlocks: boolean
  mentionedFiles: string[]
  hasVerificationSignals: boolean
  hasRootCauseSignals: boolean
  slots: AnalysisSlotValue[]
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeLower(value: string) {
  return normalize(value).toLowerCase()
}

function extractUtcTimeOptions(responseText: string) {
  return Array.from(
    new Set(
      (responseText.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\s*utc\b/gi) ?? []).map((item) => normalize(item))
    )
  ).slice(0, 6)
}

function extractSubjectLine(responseText: string) {
  const match = responseText.match(/\*\*subject:\*\*\s*(.+)|^subject:\s*(.+)$/im)
  return normalize(match?.[1] || match?.[2] || "")
}

function buildSyntheticObservations(params: {
  rawAnswer: string
  wordCount: number
  servingCount: { min: number; max: number } | null
  minutes: number | null
  caloriesPerServing: number | null
  proteinGrams: number | null
  budgetRange: { min: number; max: number } | null
  mentionedFiles: string[]
}) {
  const observations: AnalysisQuantitativeObservation[] = [
    {
      sourceText: "Overall answer length",
      dimension: "words",
      scope: "per_answer",
      min: params.wordCount,
      max: params.wordCount,
      unit: "words"
    }
  ]

  if (params.servingCount) {
    observations.push({
      sourceText: "Parsed serving count",
      dimension: "servings",
      scope: "artifact_total",
      min: params.servingCount.min,
      max: params.servingCount.max,
      unit: "servings"
    })
  }
  if (params.minutes != null) {
    observations.push({
      sourceText: "Parsed time",
      dimension: "time",
      scope: "artifact_total",
      min: params.minutes,
      max: params.minutes,
      unit: "minutes"
    })
  }
  if (params.caloriesPerServing != null) {
    observations.push({
      sourceText: "Parsed calories per serving",
      dimension: "calories",
      scope: "per_serving",
      min: params.caloriesPerServing,
      max: params.caloriesPerServing,
      unit: "kcal"
    })
  }
  if (params.proteinGrams != null) {
    observations.push({
      sourceText: "Parsed protein per serving",
      dimension: "protein",
      scope: "per_serving",
      min: params.proteinGrams,
      max: params.proteinGrams,
      unit: "g"
    })
  }
  if (params.budgetRange) {
    observations.push({
      sourceText: "Parsed budget per serving",
      dimension: "budget",
      scope: "per_serving",
      min: params.budgetRange.min,
      max: params.budgetRange.max,
      unit: "usd"
    })
  }
  if (params.mentionedFiles.length) {
    observations.push({
      sourceText: "Mentioned files count",
      dimension: "files",
      scope: "per_answer",
      min: params.mentionedFiles.length,
      max: params.mentionedFiles.length,
      unit: "files"
    })
  }

  return observations
}

export function buildAnalysisAnswerModel(params: {
  responseText: string
  promptText: string
  taskFamily: string
}): AnalysisAnswerModel {
  const rawAnswer = params.responseText.trim()
  const normalized = normalizeLower(rawAnswer)
  const wordCount = rawAnswer.split(/\s+/).filter(Boolean).length
  const servingCount = parseResponseServingCount(rawAnswer)
  const minutes = parseResponseMinutes(rawAnswer)
  const caloriesPerServing = parseResponseCaloriesPerServing(rawAnswer)
  const proteinGrams = parseResponseProteinGrams(rawAnswer)
  const budgetRange = parseResponseBudgetRange(rawAnswer)
  const mentionedFiles = rawAnswer.match(/\b[\w./-]+\.(?:ts|tsx|js|jsx|css|html|json|md|py|rb|go|rs)\b/g)?.slice(0, 8) ?? []
  const extractedObservations = parseQuantitativeObservations(rawAnswer)
  const syntheticObservations = buildSyntheticObservations({
    rawAnswer,
    wordCount,
    servingCount,
    minutes,
    caloriesPerServing,
    proteinGrams,
    budgetRange,
    mentionedFiles
  })

  const model: AnalysisAnswerModel = {
    artifactFamily: detectAnalysisArtifactFamily({
      promptText: params.promptText,
      responseText: rawAnswer,
      taskFamily: params.taskFamily
    }),
    rawAnswer,
    wordCount,
    hasTable: hasMarkdownTable(rawAnswer),
    hasIngredients: hasIngredientsSection(rawAnswer),
    hasInstructions: hasInstructionSection(rawAnswer),
    hasMacroBreakdown: hasMacroBreakdown(rawAnswer),
    hasCalorieInfo: /\bcalories?\b|\bkcal\b/i.test(rawAnswer),
    servingCount,
    minutes,
    caloriesPerServing,
    proteinGrams,
    budgetRange,
    quantitativeObservations: [...extractedObservations, ...syntheticObservations],
    subjectLine: extractSubjectLine(rawAnswer) || null,
    exactUtcTimeOptions: extractUtcTimeOptions(rawAnswer),
    hasApology: /\bapolog(?:y|ies|ize|ise)\b|\bsorry\b/.test(normalized),
    asksForConfirmation: /\bconfirm\b|\bconfirmation\b|\blet me know\b/.test(normalized),
    mentionsCalendarUpdate: /\bupdate the calendar invite\b|\bupdate the invite\b|\bcalendar invite\b/.test(normalized),
    formalTone: /\bdear\b|\bkindly\b|\bplease\b/.test(normalized) || /\bformal\b/.test(normalized),
    hasSmallTalk: /\bhope you are well\b|\bhope you're well\b|\btrust you are well\b|\bhow are you\b/.test(normalized),
    explicitlyNoSpice: /\bno spice\b|\bno-spice\b|\b0 spice\b|\bzero spice\b/.test(normalized),
    dairyFreeSignals: /\bdairy-free\b/.test(normalized) || !/\bcheese\b|\bmilk\b|\bcream\b|\byogurt\b|\bbutter\b/.test(normalized),
    hasCodeBlocks: /```/.test(rawAnswer),
    mentionedFiles,
    hasVerificationSignals: /\btest\b|\bverify\b|\bverified\b|\bsmoke\b|\bregression\b|\bpassed\b/.test(normalized),
    hasRootCauseSignals: /\broot cause\b|\bcaused by\b|\bbecause\b|\bissue was\b|\bproblem was\b/.test(normalized),
    slots: []
  }

  model.slots = buildAnalysisAnswerSlots(model)
  return model
}
