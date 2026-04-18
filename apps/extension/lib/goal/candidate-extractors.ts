import type { GoalCandidate, GoalCandidateSourceField } from "./candidate-types"

const KNOWN_CUISINES = [
  "syrian",
  "mediterranean",
  "middle eastern",
  "lebanese",
  "greek",
  "italian",
  "mexican",
  "asian",
  "japanese",
  "korean",
  "thai",
  "indian"
]

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function stripTrailingPunctuation(value: string) {
  return normalizeText(value).replace(/[.:;\s]+$/, "")
}

function findNumericConstraintMatch(text: string, unitPattern: string) {
  const patterns = [
    new RegExp(
      String.raw`\b(?:under|less than|<=?|≤|up to|at most|max(?:imum)?|no more than)\s*\d+\s*(?:${unitPattern})\b`,
      "i"
    ),
    new RegExp(
      String.raw`\b\d+\s*(?:${unitPattern})\s*(?:max(?:imum)?|or less|or fewer)\b`,
      "i"
    ),
    new RegExp(
      String.raw`\b(?:at least|>=?|≥|minimum|min(?:imum)?|no less than)\s*\d+\s*(?:${unitPattern})\b`,
      "i"
    ),
    new RegExp(
      String.raw`\b\d+\s*(?:${unitPattern})\s*(?:minimum|min|or more)\b`,
      "i"
    ),
    new RegExp(String.raw`\b\d+\s*(?:-|–|to)\s*\d+\s*(?:${unitPattern})\b`, "i"),
    new RegExp(String.raw`\b\d+\s*(?:${unitPattern})\b`, "i")
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)?.[0]
    if (match) return match
  }

  return null
}

function parseBoundedNumericValue(text: string, contextText = "") {
  const normalizedText = normalizeText(text)
  const normalizedContext = normalizeText(contextText || text)
  const combined = `${normalizedContext} ${normalizedText}`.trim()

  const rangeMatch = normalizedText.match(/(\d+)\s*(?:-|–|to)\s*(\d+)/)
  if (rangeMatch) {
    return {
      min: Number(rangeMatch[1]),
      max: Number(rangeMatch[2])
    }
  }

  const upperMatch =
    combined.match(/(?:under|less than|<=?|≤|up to|at most|max(?:imum)?|no more than)\s*(\d+)/i) ??
    normalizedText.match(/(\d+)\s*(?:kcal|calories?|minutes?|mins?|hours?|hrs?|g|grams?)\s*(?:max(?:imum)?|or less|or fewer)\b/i)
  if (upperMatch) {
    const numeric = upperMatch[1] ?? upperMatch[0]?.match(/\d+/)?.[0]
    if (numeric) {
      return {
        max: Number(numeric)
      }
    }
  }

  const lowerMatch =
    combined.match(/(?:at least|>=?|≥|minimum|min(?:imum)?|no less than)\s*(\d+)/i) ??
    normalizedText.match(/(\d+)\s*(?:kcal|calories?|minutes?|mins?|hours?|hrs?|g|grams?)\s*(?:minimum|min|or more)\b/i)
  if (lowerMatch) {
    const numeric = lowerMatch[1] ?? lowerMatch[0]?.match(/\d+/)?.[0]
    if (numeric) {
      return {
        min: Number(numeric)
      }
    }
  }

  const exactDirectiveMatch = combined.match(/(?:exact(?:ly)?|precisely)\s*(\d+)/i)
  if (exactDirectiveMatch) {
    return {
      exact: Number(exactDirectiveMatch[1])
    }
  }

  const contextualNumericMatch = normalizedText.match(/\b(\d+)\b/)
  if (contextualNumericMatch) {
    if (/\b(?:under|less than|up to|at most|max(?:imum)?|no more than)\b/i.test(normalizedContext)) {
      return {
        max: Number(contextualNumericMatch[1])
      }
    }
    if (/\b(?:at least|minimum|min(?:imum)?|no less than)\b/i.test(normalizedContext)) {
      return {
        min: Number(contextualNumericMatch[1])
      }
    }
  }

  const underMatch = normalizedText.match(/(?:under|less than|<=?|≤)\s*(\d+)/i)
  if (underMatch) {
    return {
      max: Number(underMatch[1])
    }
  }

  const exactMatch = normalizedText.match(/\b(\d+)\b/)
  if (exactMatch) {
    return {
      exact: Number(exactMatch[1])
    }
  }

  return undefined
}

function parseServingsValue(text: string, contextText = "") {
  if (/\bsingle[-\s]+(?:serving|meal)\b/i.test(text)) {
    return {
      exact: 1
    }
  }
  return parseBoundedNumericValue(text, contextText)
}

function parseTimeValue(text: string, contextText = "") {
  const value = parseBoundedNumericValue(text, contextText)
  return value ? { ...value, unit: "minutes" } : undefined
}

function parseCaloriesValue(text: string, contextText = "") {
  const value = parseBoundedNumericValue(text, contextText)
  return value ? { ...value, unit: "calories" } : undefined
}

function extractExclusionValues(text: string) {
  const matches = new Set<string>()
  const source = normalizeText(text)
  const patterns = [
    /\bwithout\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,3})/gi,
    /\bno\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,3})/gi,
    /\bexclude\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,3})/gi,
    /\bavoid\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,3})/gi,
    /\b([a-z][a-z-]*)-free\b/gi
  ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = stripTrailingPunctuation(match[1] ?? "")
      if (value) matches.add(value)
    }
  }

  const dislikeMatch = source.match(/\b(?:ingredients?\s+you\s+dislike|disliked\s+ingredients?|skip any foods)\??:\s*([^\n.]+)/i)
  if (dislikeMatch) {
    dislikeMatch[1]
      .split(/,|\/|\band\b/gi)
      .map((item) => stripTrailingPunctuation(item))
      .filter(Boolean)
      .forEach((item) => matches.add(item))
  }

  return [...matches]
}

function pushCandidate(
  output: GoalCandidate[],
  sourceField: GoalCandidateSourceField,
  sourceText: string,
  matchedText: string,
  slot: GoalCandidate["slot"],
  value: unknown,
  confidence: GoalCandidate["confidence"],
  extractor: string
) {
  const cleanedSource = normalizeText(sourceText)
  const cleanedMatch = stripTrailingPunctuation(matchedText)
  if (!cleanedSource || !cleanedMatch) return
  output.push({
    sourceField,
    sourceText: cleanedSource,
    matchedText: cleanedMatch,
    slot,
    value,
    confidence,
    extractor
  })
}

function extractLabeledValue(entry: string) {
  const labeledMatch = normalizeText(entry).match(/^([^:]+):\s*(.+)$/)
  if (!labeledMatch) return null
  return {
    labelText: labeledMatch[1].toLowerCase(),
    valueText: labeledMatch[2]
  }
}

function extractOutputCandidates(entry: string, sourceField: GoalCandidateSourceField, output: GoalCandidate[]) {
  const normalized = normalizeText(entry)
  const lowered = normalized.toLowerCase()
  const outputs = [
    /\bingredients?\b/i.test(normalized) ? "ingredients" : "",
    /\bstep[-\s]?by[-\s]?step\b|\binstructions?\b|\bsteps?\b/i.test(normalized) ? "step-by-step instructions" : "",
    /\bmacros?\b|\bmacro breakdown\b/i.test(normalized) ? "macros per serving" : "",
    /\bcalories?\b|\bkcal\b/i.test(normalized) ? "calories per serving" : "",
    /\bfull html file\b/i.test(normalized) ? "full HTML file" : "",
    /\bjson\b/i.test(normalized) ? "JSON output" : "",
    /\btable\b/i.test(normalized) ? "table output" : ""
  ].filter(Boolean)

  for (const requirement of outputs) {
    pushCandidate(output, sourceField, entry, requirement, "output_requirement", requirement, "high", "output_requirement_keywords")
  }

  if (outputs.length === 0 && /\bper serving\b/i.test(lowered)) {
    pushCandidate(output, sourceField, entry, "per serving", "output_requirement", "per serving", "medium", "output_requirement_per_serving")
  }
}

function extractTechnologyCandidates(entry: string, sourceField: GoalCandidateSourceField, output: GoalCandidate[]) {
  const normalized = normalizeText(entry)
  const technologies = [
    /\bhtml\b/i.test(normalized) ? "HTML" : "",
    /\bcss\b/i.test(normalized) ? "CSS" : "",
    /\bjavascript\b|\bjs\b/i.test(normalized) ? "JavaScript" : "",
    /\btypescript\b|\bts\b/i.test(normalized) ? "TypeScript" : "",
    /\breact\b/i.test(normalized) ? "React" : "",
    /\bnext\.?js\b/i.test(normalized) ? "Next.js" : "",
    /\bjson\b/i.test(normalized) ? "JSON" : ""
  ].filter(Boolean)

  for (const technology of technologies) {
    pushCandidate(output, sourceField, entry, technology, "technology", technology, "high", "technology_keyword")
  }
}

function extractMethodCandidates(entry: string, sourceField: GoalCandidateSourceField, output: GoalCandidate[]) {
  const normalized = normalizeText(entry)
  const matches = [
    normalized.match(/\bmicrowave only\b/i)?.[0],
    normalized.match(/\buses? only a microwave\b/i)?.[0],
    normalized.match(/\bno blender\b/i)?.[0],
    normalized.match(/\binline css only\b/i)?.[0],
    normalized.match(/\boven(?:-cooked)?\b/i)?.[0],
    normalized.match(/\bstovetop only\b/i)?.[0]
  ].filter(Boolean) as string[]

  for (const match of matches) {
    pushCandidate(output, sourceField, entry, match, "method", stripTrailingPunctuation(match), "high", "method_keyword")
  }
}

export function looksLikeFreeformSignal(entry: string) {
  return /\bwithout\b|\bno\b|\bexclude\b|\bavoid\b|\bfree\b|\bservings?\b|\bperson\b|\bmeal\b|\bminutes?\b|\bmin\b|\bcalories?\b|\bkcal\b|\bprotein\b|\bmicrowave\b|\boven\b|\bstovetop\b|\bhtml\b|\bcss\b|\bjavascript\b|\btypescript\b|\breact\b|\bnext\.?js\b|\bjson\b|\bingredients?\b|\binstructions?\b|\bmacros?\b|\bprofessional\b|\bpolished\b|\bconcise\b|\bcomfort\b|\bcreamy\b/i.test(
    entry
  )
}

export function extractGoalCandidatesFromEntry(entry: string, sourceField: GoalCandidateSourceField) {
  const normalized = normalizeText(entry)
  if (!normalized) return [] as GoalCandidate[]

  const output: GoalCandidate[] = []
  const labeled = extractLabeledValue(normalized)
  const labelText = labeled?.labelText ?? ""
  const valueText = labeled?.valueText ?? normalized
  const lowerValue = valueText.toLowerCase()

  for (const exclusion of extractExclusionValues(normalized)) {
    pushCandidate(output, sourceField, entry, exclusion, "exclusion", exclusion, labeled ? "high" : "medium", "exclusion_pattern")
  }

  const servingMatch =
    valueText.match(/\b\d+\s*(?:person|people|meal|meals|servings?)\b/i)?.[0] ??
    valueText.match(/\bfor\s+\d+\s*(?:person|people)\b/i)?.[0] ??
    valueText.match(/\bsingle[-\s]+(?:serving|meal)\b/i)?.[0] ??
    null
  if (
    /\bhow many people\b|\bhow many servings\b|\bhow many meals\b/i.test(labelText) ||
    /\bservings?\b|\bfor \d+ person\b|\b\d+ meal\b|\b1 meal\b|\bsingle[-\s]+serving\b|\bsingle[-\s]+meal\b/i.test(normalized) ||
    /^\d+\s*(?:person|people|meal|meals)\b/i.test(lowerValue) ||
    Boolean(servingMatch)
  ) {
    const matchedText = labeled ? valueText : servingMatch ?? valueText
    pushCandidate(
      output,
      sourceField,
      entry,
      matchedText,
      "servings",
      parseServingsValue(matchedText, labeled ? `${labelText} ${valueText}` : normalized),
      labeled ? "high" : "medium",
      "servings_pattern"
    )
  }

  const timeMatch = findNumericConstraintMatch(valueText, "hours?|hrs?|minutes?|mins?")
  if (/\bminutes?\b|\bmins?\b|\bhours?\b|\bhrs?\b/i.test(normalized) && timeMatch) {
    pushCandidate(
      output,
      sourceField,
      entry,
      timeMatch,
      "time",
      parseTimeValue(timeMatch, labeled ? `${labelText} ${valueText}` : normalized),
      labeled ? "high" : "medium",
      "time_pattern"
    )
  }

  const calorieMatch = findNumericConstraintMatch(valueText, "calories?|kcal")
  if (/\bcalories?\b|\bkcal\b/i.test(normalized) && calorieMatch) {
    pushCandidate(
      output,
      sourceField,
      entry,
      calorieMatch,
      "calories",
      parseCaloriesValue(calorieMatch, labeled ? `${labelText} ${valueText}` : normalized),
      labeled ? "high" : "medium",
      "calorie_pattern"
    )
  }

  if (/\bprotein\b/i.test(normalized)) {
    const proteinContext = labeled ? `${labelText} ${valueText}` : normalized
    const qualitativeProteinMatch = normalized.match(/\bhigh[-\s]?protein\b/i)?.[0] ?? null
    if (qualitativeProteinMatch) {
      pushCandidate(output, sourceField, entry, qualitativeProteinMatch, "protein", "high", labeled ? "high" : "medium", "protein_pattern")
    }

    const proteinTargetMatch =
      findNumericConstraintMatch(proteinContext, "(?:g|grams?)(?:\\s+protein)?") ??
      valueText.match(/\b\d+\s*(?:g|grams?)(?:\s+protein)?\b/i)?.[0] ??
      null
    if (proteinTargetMatch) {
      const boundedProtein = parseBoundedNumericValue(
        proteinTargetMatch,
        labeled && /\bprotein\b/i.test(labelText) ? `${labelText} ${proteinTargetMatch}` : proteinTargetMatch
      )
      pushCandidate(
        output,
        sourceField,
        entry,
        proteinTargetMatch,
        "protein",
        boundedProtein ? { ...boundedProtein, unit: "grams" } : undefined,
        labeled ? "high" : "medium",
        "protein_numeric_pattern"
      )
    }
  }

  extractMethodCandidates(entry, sourceField, output)
  extractTechnologyCandidates(entry, sourceField, output)

  const diets = [
    normalized.match(/\bvegan\b/i)?.[0],
    normalized.match(/\bvegetarian\b/i)?.[0],
    normalized.match(/\blow-carb\b/i)?.[0],
    normalized.match(/\bgluten-free\b/i)?.[0],
    normalized.match(/\bdairy-free\b/i)?.[0],
    normalized.match(/\begg-free\b/i)?.[0]
  ].filter(Boolean) as string[]
  for (const diet of diets) {
    pushCandidate(output, sourceField, entry, diet, "diet", stripTrailingPunctuation(diet), labeled ? "high" : "medium", "diet_keyword")
  }

  for (const cuisine of KNOWN_CUISINES.filter((item) => lowerValue.includes(item) || normalized.toLowerCase().includes(item))) {
    pushCandidate(output, sourceField, entry, cuisine, "cuisine", cuisine, labeled ? "high" : "medium", "cuisine_keyword")
  }

  if (/\bmoderate(?:-cost)?\b|\bbudget\b|\bcost\b/i.test(normalized)) {
    const budgetMatch = normalized.match(/\bmoderate(?:-cost)?\b/i)?.[0] ?? valueText
    pushCandidate(output, sourceField, entry, budgetMatch, "budget", stripTrailingPunctuation(budgetMatch), labeled ? "medium" : "low", "budget_keyword")
  }

  const storageMatch =
    normalized.match(/\beat fresh only\b/i)?.[0] ??
    normalized.match(/\bno leftovers\b/i)?.[0] ??
    normalized.match(/\bcold later\b/i)?.[0] ??
    normalized.match(/\bleftovers?\b/i)?.[0] ??
    null
  if (storageMatch) {
    pushCandidate(output, sourceField, entry, storageMatch, "storage", stripTrailingPunctuation(storageMatch), labeled ? "medium" : "low", "storage_keyword")
  }

  extractOutputCandidates(entry, sourceField, output)

  if (/\blunch\b|\bdinner\b|\bbreakfast\b|\bsnack\b/i.test(normalized)) {
    const scopeMatch = normalized.match(/\blunch\b|\bdinner\b|\bbreakfast\b|\bsnack\b/i)?.[0] ?? valueText
    pushCandidate(output, sourceField, entry, scopeMatch, "scope", stripTrailingPunctuation(scopeMatch), labeled ? "medium" : "low", "meal_scope_keyword")
  }

  if (output.length === 0 && labeled && valueText.length <= 40) {
    pushCandidate(output, sourceField, entry, valueText, "generic", stripTrailingPunctuation(valueText), "low", "generic_labeled_fallback")
  }

  if (
    output.length === 0 &&
    !labeled &&
    sourceField !== "task_goal" &&
    normalized.length <= 60
  ) {
    pushCandidate(output, sourceField, entry, normalized, "generic", stripTrailingPunctuation(normalized), "medium", "generic_structured_fallback")
  }

  return output
}
