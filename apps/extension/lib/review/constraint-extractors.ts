import type { ResponsePreprocessorOutput } from "@prompt-optimizer/shared/src/schemas"
import {
  canonicalizeAnalysisUnit,
  detectAnalysisDimensionFromText,
  detectAnalysisScope,
  type AnalysisQuantitativeObservation
} from "./analysis-semantics"

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function hasMeasuredIngredientList(responseText: string) {
  const lines = responseText.split("\n")
  const measuredLines = lines.filter((line) =>
    /^\s*[*-]\s+/.test(line) &&
    /\b(?:\d+(?:[./]\d+)?|½|¼|¾|one|two|three)\s*(?:c|cup|cups|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|g|grams?|ml)\b/i.test(line)
  )
  return measuredLines.length >= 2
}

function hasOrderedSteps(responseText: string) {
  return /\n\s*1\.\s+/.test(responseText) || /\n\s*step\s*1\b/i.test(responseText)
}

export function hasMarkdownTable(responseText: string) {
  const lines = responseText.split("\n").map((line) => line.trim())
  let rowCount = 0
  for (const line of lines) {
    if (!/\|/.test(line)) continue
    if (/^\|?[\s:-]+\|[\s|:-]+$/.test(line)) continue
    rowCount += 1
    if (rowCount >= 2) return true
  }
  return false
}

export function parseResponseServingCount(responseText: string) {
  const match = responseText.match(/\bservings?\s*:\s*(\d+)(?:\s*[-–]\s*(\d+))?/i)
  if (match) {
    return {
      min: Number(match[1]),
      max: match[2] ? Number(match[2]) : Number(match[1])
    }
  }

  if (/\bsingle[-\s]?serving\b|\bserves?\s+1\b|\bfor\s+1\s+person\b|\b1\s+serving\b/i.test(responseText)) {
    return { min: 1, max: 1 }
  }

  const personMatch = responseText.match(/\b(?:serves?|for)\s+(\d+)(?:\s*[-–]\s*(\d+))?\s+(?:people|persons?)\b/i)
  if (personMatch) {
    return {
      min: Number(personMatch[1]),
      max: personMatch[2] ? Number(personMatch[2]) : Number(personMatch[1])
    }
  }

  return null
}

export function parseResponseMinutes(responseText: string) {
  const labeled = responseText.match(/\btime\s*:\s*(\d+)(?:\s*[-–]\s*(\d+))?\s*(?:minutes?|mins?)\b/i)
  if (labeled) return labeled[2] ? Number(labeled[2]) : Number(labeled[1])
  const inline = responseText.match(/\b(\d+)(?:\s*[-–]\s*(\d+))?\s*(?:minutes?|mins?)\b/i)
  if (!inline) return null
  return inline[2] ? Number(inline[2]) : Number(inline[1])
}

export function parseResponseCaloriesPerServing(responseText: string) {
  const labeled =
    responseText.match(/\b(?:total\s+)?calories?\s*:\s*~?\s*(\d+)(?:\s*(?:kcal|cal))?\b/i) ??
    responseText.match(/\b(?:total\s+)?calories?\s+per\s+serving\s*:\s*~?\s*(\d+)(?:\s*(?:kcal|cal))?\b/i)
  if (labeled) return Number(labeled[1])
  const inline =
    responseText.match(/\b~?\s*(\d+)\s*(?:kcal|calories?)\b/i) ??
    responseText.match(/\(\s*[^)]*~?\s*(\d+)\s*(?:kcal|calories?)[^)]*\)/i)
  return inline ? Number(inline[1]) : null
}

export function parseResponseProteinGrams(responseText: string) {
  const match = responseText.match(/\bprotein\s*:\s*(\d+)\s*g\b/i)
  return match ? Number(match[1]) : null
}

export function parseResponseBudgetRange(responseText: string) {
  const labeledRange =
    responseText.match(/\b(?:cost|budget|price)(?:\s+per\s+serving)?\s*:\s*\$?\s*(\d+(?:\.\d+)?)\s*[-–]\s*\$?\s*(\d+(?:\.\d+)?)/i) ??
    responseText.match(/\$\s*(\d+(?:\.\d+)?)\s*[-–]\s*\$?\s*(\d+(?:\.\d+)?)(?:\s+per\s+serving)?/i)
  if (labeledRange) {
    return {
      min: Number(labeledRange[1]),
      max: Number(labeledRange[2])
    }
  }

  const labeledExact =
    responseText.match(/\b(?:cost|budget|price)(?:\s+per\s+serving)?\s*:\s*\$?\s*(\d+(?:\.\d+)?)/i) ??
    responseText.match(/\$\s*(\d+(?:\.\d+)?)(?:\s+per\s+serving)?/i)
  if (labeledExact) {
    const value = Number(labeledExact[1])
    return {
      min: value,
      max: value
    }
  }

  return null
}

function pushObservation(
  observations: AnalysisQuantitativeObservation[],
  sourceText: string,
  first: number,
  second: number | null,
  rawUnit: string | null
) {
  const unit = canonicalizeAnalysisUnit(rawUnit)
  const dimension = detectAnalysisDimensionFromText(`${sourceText} ${unit ?? ""}`)
  observations.push({
    sourceText: sourceText.trim(),
    dimension,
    scope: detectAnalysisScope(sourceText),
    min: first,
    max: second ?? first,
    unit
  })
}

export function parseQuantitativeObservations(responseText: string) {
  const observations: AnalysisQuantitativeObservation[] = []
  const lines = responseText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    const moneyRange = Array.from(
      line.matchAll(/\$\s*(\d[\d,]*(?:\.\d+)?)\s*[-–]\s*\$?\s*(\d[\d,]*(?:\.\d+)?)(?:\s+per\s+\w+)?/gi)
    )
    for (const match of moneyRange) {
      pushObservation(observations, line, Number(match[1].replace(/,/g, "")), Number(match[2].replace(/,/g, "")), "usd")
    }

    const moneyExact = Array.from(line.matchAll(/\$\s*(\d[\d,]*(?:\.\d+)?)(?:\s+per\s+\w+)?/gi))
    for (const match of moneyExact) {
      pushObservation(observations, line, Number(match[1].replace(/,/g, "")), null, "usd")
    }

    const quantified = Array.from(
      line.matchAll(
        /(\d[\d,]*(?:\.\d+)?)\s*[-–]?\s*(\d[\d,]*(?:\.\d+)?)?\s*(%|percent(?:age)?|kcal|calories?|cal|minutes?|mins?|hours?|hrs?|hr|seconds?|secs?|sec|ms|servings?|people|persons?|words?|tokens?|lines?|files?|g|grams?|kg|kilograms?|mg|milligrams?|lb|lbs|oz|ounces?|ml|milliliters?|l|liters?|cups?|tbsp|tablespoons?|tsp|teaspoons?|px|rem|em|°c|°f)\b/gi
      )
    )
    for (const match of quantified) {
      pushObservation(
        observations,
        line,
        Number(match[1].replace(/,/g, "")),
        match[2] ? Number(match[2].replace(/,/g, "")) : null,
        match[3]
      )
    }
  }

  const unique = new Map<string, AnalysisQuantitativeObservation>()
  for (const observation of observations) {
    const key = `${observation.dimension}|${observation.scope}|${observation.min}|${observation.max}|${observation.unit ?? ""}|${observation.sourceText.toLowerCase()}`
    if (!unique.has(key)) unique.set(key, observation)
  }

  return [...unique.values()]
}

export function hasIngredientsSection(responseText: string) {
  return (
    /(?:^|\n)\s{0,3}(?:#{1,6}|[>*-]+)?\s*(?:[^\w\n]{0,4}\s*)?ingredients?\b(?:\s*[:(]|\s*$)/im.test(responseText) ||
    hasMeasuredIngredientList(responseText)
  )
}

export function hasInstructionSection(responseText: string) {
  return (
    /(?:^|\n)\s{0,3}(?:#{1,6}|[>*-]+)?\s*(?:[^\w\n]{0,4}\s*)?(?:instructions?|method|step[-\s]?by[-\s]?step)\b(?:\s*[:(]|\s*$)/im.test(responseText) ||
    hasOrderedSteps(responseText)
  )
}

export function hasMacroBreakdown(responseText: string) {
  return /\bprotein\b|\bcarbohydrates?\b|\bnet carbs?\b|\bfat\b|\bfiber\b/i.test(responseText)
}

export function hasCalorieInfo(responseText: string) {
  return /\bcalories?\b|\bkcal\b/i.test(responseText)
}

export function hasHtmlStructure(responseText: string) {
  return /<!doctype html>|<html\b|<body\b|<head\b/i.test(responseText)
}

export function hasCssSignals(responseText: string) {
  return /\bstyle\s*=|<style\b|{[^}]*:[^}]*}/i.test(responseText)
}

export function hasFullHtmlFile(responseText: string) {
  return hasHtmlStructure(responseText) && /<\/html>/i.test(responseText)
}

export function hasCodeArtifactResponse(responseText: string, responseSummary: ResponsePreprocessorOutput) {
  return hasHtmlStructure(responseText) || hasCssSignals(responseText) || responseSummary.has_code_blocks || responseSummary.mentioned_files.length > 0
}

export function usesInlineCssOnly(responseText: string) {
  return hasFullHtmlFile(responseText) && /\bstyle\s*=/.test(responseText) && !/<style\b/i.test(responseText)
}

export function isRewriteArtifactResponse(responseText: string, responseSummary: ResponsePreprocessorOutput) {
  return !responseSummary.has_code_blocks && responseText.trim().length >= 20
}

export function hasRecipeDeliverable(responseText: string) {
  return (hasIngredientsSection(responseText) && hasInstructionSection(responseText)) || (hasMeasuredIngredientList(responseText) && hasOrderedSteps(responseText))
}

export function responseUsesTechnology(technology: string, responseText: string, responseSummary: ResponsePreprocessorOutput) {
  const normalized = normalize(technology)
  if (normalized === "html") return hasHtmlStructure(responseText)
  if (normalized === "css") return hasCssSignals(responseText)
  if (normalized === "javascript" || normalized === "js") return /\bfunction\b|=>|const\s+\w+\s*=|<script\b/i.test(responseText)
  if (normalized === "react") return /\bjsx\b|<\w+[^>]*>|useState|useEffect/i.test(responseText)
  if (normalized === "next.js" || normalized === "nextjs") return /\bnext\b|app\/|page\.tsx/i.test(responseText)
  if (normalized === "json") return /^{[\s\S]*}$/.test(responseText.trim()) || /\n\s*{\s*"/.test(responseText)
  return responseSummary.response_text.toLowerCase().includes(normalized)
}

function exclusionVariants(target: string) {
  const normalizedTarget = normalize(target)
  const plural = normalizedTarget.endsWith("s") ? normalizedTarget : `${normalizedTarget}s`
  const singular = normalizedTarget.endsWith("s") ? normalizedTarget.slice(0, -1) : normalizedTarget
  return [...new Set([normalizedTarget, singular, plural])].flatMap((variant) => [
    `without ${variant}`,
    `no ${variant}`,
    `exclude ${variant}`,
    `avoid ${variant}`,
    `do not use ${variant}`,
    `${variant}-free`,
    `${variant} free`
  ])
}

export function responsePreservesExclusion(target: string, responseText: string) {
  const haystack = normalize(responseText)
  const normalizedTarget = normalize(target)
  if (normalizedTarget.includes("knee-heavy")) {
    return (
      /\bknee[-\s]?friendly\b/.test(haystack) ||
      /\bno knee[-\s]?heavy\b/.test(haystack) ||
      /\bno squats?\b/.test(haystack) ||
      /\bno lunges?\b/.test(haystack) ||
      /\bhip[-\s]?dominant\b/.test(haystack)
    )
  }
  return exclusionVariants(target).some((variant) => haystack.includes(variant))
}

export function responseContradictsExclusion(target: string, responseText: string) {
  const haystack = normalize(responseText)
  const normalizedTarget = normalize(target)
  if (responsePreservesExclusion(target, responseText)) return false
  if (normalizedTarget.includes("knee-heavy")) {
    return /\bsquats?\b|\blunges?\b|\bleg press\b|\bstep-ups?\b/i.test(haystack)
  }
  const forms = exclusionVariants(target).map((variant) => variant.replace(/^(without|no|exclude|avoid|do not use)\s+/, "").replace(/-free| free$/, ""))
  return forms.some((form) => haystack.includes(form))
}

export function responseUsesMethod(method: string, responseText: string) {
  const normalizedMethod = normalize(method)
  const haystack = normalize(responseText)

  if (normalizedMethod.includes("microwave")) {
    return /\bmicrowave\b/.test(haystack) && !/\bskillet\b|\bstovetop\b|\bfrying pan\b|\boven\b/.test(haystack)
  }
  if (normalizedMethod.includes("oven")) {
    return /\boven\b|\bbake\b|\broast\b/.test(haystack)
  }
  if (normalizedMethod.includes("stovetop")) {
    return /\bstovetop\b|\bskillet\b|\bsauté\b|\bsaute\b|\bpan\b/.test(haystack)
  }
  if (normalizedMethod.includes("inline css")) {
    return usesInlineCssOnly(responseText)
  }

  return haystack.includes(normalizedMethod)
}

export function matchesCuisineConstraint(cuisine: string, responseText: string) {
  const normalizedCuisine = normalize(cuisine).replace(/\s+cuisine$/, "")
  return normalize(responseText).includes(normalizedCuisine)
}

export function responseIncludesRiceIngredient(responseText: string) {
  return /\brice\b/i.test(responseText) && !/\brice vinegar\b/i.test(responseText)
}

export function responseMentionsRiceQuantity(responseText: string) {
  return /\b\d+(?:\/\d+)?\s*(?:cup|cups|g|grams|tbsp|tablespoons?)\s+rice(?!\s+vinegar)\b/i.test(responseText)
}

export function responseIncludesTextureTips(responseText: string) {
  return /\btexture tips?\b|\bcreaminess\b|\bto keep it creamy\b|\bfinal texture\b/i.test(responseText)
}

export function hasResearchSupport(responseText: string) {
  return /\[[^\]]+\]:\s*https?:\/\//.test(responseText) || /\bsource\b|\bcitation\b/i.test(responseText)
}
