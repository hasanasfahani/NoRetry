export type AnalysisRequirementDimension =
  | "time"
  | "budget"
  | "servings"
  | "calories"
  | "protein"
  | "carbs"
  | "fat"
  | "fiber"
  | "sugar"
  | "sodium"
  | "percentage"
  | "weight"
  | "volume"
  | "length"
  | "temperature"
  | "words"
  | "tokens"
  | "lines"
  | "files"
  | "count"
  | "format"
  | "tooling"
  | "forbidden"
  | "tone"
  | "audience"
  | "proof"
  | "file_scope"
  | "change_scope"
  | "artifact"
  | "quality"
  | "generic_numeric"
  | "generic"

export type AnalysisRequirementScope =
  | "per_answer"
  | "per_serving"
  | "per_day"
  | "per_session"
  | "per_file"
  | "per_step"
  | "artifact_total"

export type AnalysisRequirementOperator =
  | "exact"
  | "max"
  | "min"
  | "range"
  | "contains"
  | "excludes"
  | "present"

export type AnalysisNumericRange = {
  min: number | null
  max: number | null
  unit: string | null
}

export type AnalysisSemanticRequirement = {
  sourceText: string
  dimension: AnalysisRequirementDimension
  scope: AnalysisRequirementScope
  operator: AnalysisRequirementOperator
  valueText: string
  numericRange?: AnalysisNumericRange
}

export type AnalysisQuantitativeObservation = {
  sourceText: string
  dimension: AnalysisRequirementDimension
  scope: AnalysisRequirementScope
  min: number
  max: number
  unit: string | null
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeLower(value: string) {
  return normalize(value).toLowerCase()
}

export function canonicalizeAnalysisUnit(rawUnit: string | null | undefined) {
  const unit = normalizeLower(rawUnit ?? "")
  if (!unit) return null
  if (unit === "$" || unit === "usd" || unit === "dollars" || unit === "dollar") return "usd"
  if (unit === "calorie" || unit === "calories" || unit === "cal" || unit === "kcal") return "kcal"
  if (unit === "minute" || unit === "minutes" || unit === "min" || unit === "mins") return "minutes"
  if (unit === "hour" || unit === "hours" || unit === "hr" || unit === "hrs") return "hours"
  if (unit === "second" || unit === "seconds" || unit === "sec" || unit === "secs") return "seconds"
  if (unit === "millisecond" || unit === "milliseconds" || unit === "ms") return "ms"
  if (unit === "gram" || unit === "grams" || unit === "g") return "g"
  if (unit === "kilogram" || unit === "kilograms" || unit === "kg") return "kg"
  if (unit === "milligram" || unit === "milligrams" || unit === "mg") return "mg"
  if (unit === "pound" || unit === "pounds" || unit === "lb" || unit === "lbs") return "lb"
  if (unit === "ounce" || unit === "ounces" || unit === "oz") return "oz"
  if (unit === "milliliter" || unit === "milliliters" || unit === "ml") return "ml"
  if (unit === "liter" || unit === "liters" || unit === "l") return "l"
  if (unit === "cup" || unit === "cups") return "cups"
  if (unit === "tablespoon" || unit === "tablespoons" || unit === "tbsp") return "tbsp"
  if (unit === "teaspoon" || unit === "teaspoons" || unit === "tsp") return "tsp"
  if (unit === "serving" || unit === "servings") return "servings"
  if (unit === "person" || unit === "persons" || unit === "people") return "people"
  if (unit === "word" || unit === "words") return "words"
  if (unit === "token" || unit === "tokens") return "tokens"
  if (unit === "line" || unit === "lines") return "lines"
  if (unit === "file" || unit === "files") return "files"
  if (unit === "pixel" || unit === "pixels" || unit === "px") return "px"
  if (unit === "rem") return "rem"
  if (unit === "em") return "em"
  if (unit === "percent" || unit === "percentage" || unit === "%") return "%"
  if (unit === "degree" || unit === "degrees" || unit === "°c") return "c"
  if (unit === "°f") return "f"
  return unit
}

export function detectAnalysisScope(text: string): AnalysisRequirementScope {
  const lower = normalizeLower(text)
  if (/\bper serving\b|\bsingle[-\s]?serving\b|\bfor 1 person\b|\bserves?\s+\d+\b/.test(lower)) return "per_serving"
  if (/\bper day\b|\bdaily\b|\btotal day\b|\bkcal day\b|\bday plan\b/.test(lower)) return "per_day"
  if (/\bper session\b/.test(lower)) return "per_session"
  if (/\bper file\b|\bfull file\b|\bfile output\b/.test(lower)) return "per_file"
  if (/\bper step\b|\beach step\b/.test(lower)) return "per_step"
  if (/\bper answer\b|\bin the answer\b/.test(lower)) return "per_answer"
  return "artifact_total"
}

function parseBound(raw: string | undefined) {
  if (!raw) return null
  return Number(raw.replace(/,/g, ""))
}

export function detectNumericRange(text: string): AnalysisNumericRange | null {
  const lower = normalizeLower(text)
  const rangeAfter = lower.match(/(?:\$)?(\d[\d,]*(?:\.\d+)?)\s*[-–]\s*(?:\$)?(\d[\d,]*(?:\.\d+)?)\s*(%|percent(?:age)?|kcal|calories?|cal|minutes?|mins?|hours?|hrs?|hr|seconds?|secs?|sec|ms|servings?|people|persons?|words?|tokens?|lines?|files?|usd|\$|g|grams?|kg|kilograms?|mg|milligrams?|lb|lbs|oz|ounces?|ml|milliliters?|l|liters?|cups?|tbsp|tablespoons?|tsp|teaspoons?|px|rem|em|°c|°f)?/i)
  if (rangeAfter) {
    return {
      min: parseBound(rangeAfter[1]),
      max: parseBound(rangeAfter[2]),
      unit: canonicalizeAnalysisUnit(rangeAfter[3] ?? null)
    }
  }

  const rangeBefore = lower.match(/(?:\$)?(\d[\d,]*(?:\.\d+)?)\s*(%|percent(?:age)?|kcal|calories?|cal|minutes?|mins?|hours?|hrs?|hr|seconds?|secs?|sec|ms|servings?|people|persons?|words?|tokens?|lines?|files?|usd|\$|g|grams?|kg|kilograms?|mg|milligrams?|lb|lbs|oz|ounces?|ml|milliliters?|l|liters?|cups?|tbsp|tablespoons?|tsp|teaspoons?|px|rem|em|°c|°f)\s*[-–]\s*(?:\$)?(\d[\d,]*(?:\.\d+)?)/i)
  if (rangeBefore) {
    return {
      min: parseBound(rangeBefore[1]),
      max: parseBound(rangeBefore[3]),
      unit: canonicalizeAnalysisUnit(rangeBefore[2] ?? null)
    }
  }

  const max = lower.match(/(?:under|less than|<=|≤|max(?:imum)?|at most|up to|within)\s*(?:\$)?(\d[\d,]*(?:\.\d+)?)\s*(%|percent(?:age)?|kcal|calories?|cal|minutes?|mins?|hours?|hrs?|hr|seconds?|secs?|sec|ms|servings?|people|persons?|words?|tokens?|lines?|files?|usd|\$|g|grams?|kg|kilograms?|mg|milligrams?|lb|lbs|oz|ounces?|ml|milliliters?|l|liters?|cups?|tbsp|tablespoons?|tsp|teaspoons?|px|rem|em|°c|°f)?/i)
  if (max) {
    return {
      min: null,
      max: parseBound(max[1]),
      unit: canonicalizeAnalysisUnit(max[2] ?? null)
    }
  }

  const min = lower.match(/(?:at least|min(?:imum)?|>=|≥)\s*(?:\$)?(\d[\d,]*(?:\.\d+)?)\s*(%|percent(?:age)?|kcal|calories?|cal|minutes?|mins?|hours?|hrs?|hr|seconds?|secs?|sec|ms|servings?|people|persons?|words?|tokens?|lines?|files?|usd|\$|g|grams?|kg|kilograms?|mg|milligrams?|lb|lbs|oz|ounces?|ml|milliliters?|l|liters?|cups?|tbsp|tablespoons?|tsp|teaspoons?|px|rem|em|°c|°f)?/i)
  if (min) {
    return {
      min: parseBound(min[1]),
      max: null,
      unit: canonicalizeAnalysisUnit(min[2] ?? null)
    }
  }

  const exact =
    lower.match(/\b(?:exactly)\s*(?:\$)?(\d[\d,]*(?:\.\d+)?)\s*(%|percent(?:age)?|kcal|calories?|cal|minutes?|mins?|hours?|hrs?|hr|seconds?|secs?|sec|ms|servings?|people|persons?|words?|tokens?|lines?|files?|usd|\$|g|grams?|kg|kilograms?|mg|milligrams?|lb|lbs|oz|ounces?|ml|milliliters?|l|liters?|cups?|tbsp|tablespoons?|tsp|teaspoons?|px|rem|em|°c|°f)?\b/i) ??
    lower.match(/\bfor\s+(\d[\d,]*(?:\.\d+)?)\s*(servings?|people|persons?|words?|tokens?|lines?|files?)\b/i)
  if (exact) {
    const value = parseBound(exact[1])
    return {
      min: value,
      max: value,
      unit: canonicalizeAnalysisUnit(exact[2] ?? null)
    }
  }

  return null
}

function inferDimensionFromUnit(unit: string | null): AnalysisRequirementDimension | null {
  switch (canonicalizeAnalysisUnit(unit)) {
    case "minutes":
    case "hours":
    case "seconds":
    case "ms":
      return "time"
    case "usd":
      return "budget"
    case "servings":
    case "people":
      return "servings"
    case "kcal":
      return "calories"
    case "%":
      return "percentage"
    case "g":
    case "kg":
    case "mg":
    case "lb":
    case "oz":
      return "weight"
    case "ml":
    case "l":
    case "cups":
    case "tbsp":
    case "tsp":
      return "volume"
    case "px":
    case "rem":
    case "em":
      return "length"
    case "words":
      return "words"
    case "tokens":
      return "tokens"
    case "lines":
      return "lines"
    case "files":
      return "files"
    default:
      return null
  }
}

export function detectAnalysisDimensionFromText(text: string): AnalysisRequirementDimension {
  const lower = normalizeLower(text)
  if (/\bminutes?\b|\bmins?\b|\bhours?\b|\bhrs?\b|\bhr\b|\bseconds?\b|\bsecs?\b|\bsec\b|\bms\b/.test(lower)) return "time"
  if (/\$\s*\d|\busd\b|\bbudget\b|\bcost\b|\bprice\b/.test(lower)) return "budget"
  if (/\bserving\b|\bserves?\b|\bperson\b|\bpeople\b/.test(lower)) return "servings"
  if (/\bkcal\b|\bcalories?\b|\bcal\b/.test(lower)) return "calories"
  if (/\bprotein\b/.test(lower)) return "protein"
  if (/\bnet carbs?\b|\bcarbohydrates?\b|\bcarbs?\b/.test(lower)) return "carbs"
  if (/\bfat\b/.test(lower)) return "fat"
  if (/\bfiber\b/.test(lower)) return "fiber"
  if (/\bsugar\b/.test(lower)) return "sugar"
  if (/\bsodium\b/.test(lower)) return "sodium"
  if (/\bpercent(?:age)?\b|%/.test(lower)) return "percentage"
  if (/\bwords?\b/.test(lower)) return "words"
  if (/\btokens?\b/.test(lower)) return "tokens"
  if (/\blines?\b/.test(lower)) return "lines"
  if (/\bfiles?\b/.test(lower) && /\b\d/.test(lower)) return "files"
  if (/\bpx\b|\brem\b|\bem\b|\bwidth\b|\bheight\b/.test(lower)) return "length"
  if (/\bml\b|\bliters?\b|\bl\b|\bcups?\b|\btbsp\b|\btablespoons?\b|\btsp\b|\bteaspoons?\b/.test(lower)) return "volume"
  if (/\bgrams?\b|\bg\b|\bkg\b|\bmg\b|\blb\b|\boz\b|\bounces?\b/.test(lower)) return "weight"
  if (/\b°c\b|\b°f\b|\bcelsius\b|\bfahrenheit\b/.test(lower)) return "temperature"
  if (/\bcount\b|\bnumber of\b/.test(lower)) return "count"
  if (/\btable\b|\bjson\b|\bhtml\b|\bbullet\b|\bformat\b|\bingredients\b|\binstructions?\b|\bmacros?\b/.test(lower)) return "format"
  if (/\bmicrowave\b|\bknife\b|\bbowl\b|\bfree weights?\b|\btool\b|\bmethod\b|\bonly use\b/.test(lower)) return "tooling"
  if (/\bdo not use\b|\bavoid\b|\bwithout\b|\bno leftovers?\b|\bno heat\b|\bno spice\b|\bgluten[-\s]?free\b|\bdairy[-\s]?free\b/.test(lower)) return "forbidden"
  if (/\bformal\b|\bconcise\b|\bno small[-\s]?talk\b|\btone\b|\bstyle\b/.test(lower)) return "tone"
  if (/\binternal team\b|\baudience\b|\bfor executives\b|\bfor beginners\b/.test(lower)) return "audience"
  if (/\btest\b|\bverify\b|\bproof\b|\bsmoke test\b|\bregression\b|\bworks if\b/.test(lower)) return "proof"
  if (/\bfile\b|\bfiles\b|\bcomponent\b|\bpage\b|\broute\b|\bapi\b|\bendpoint\b|\bmodule\b/.test(lower)) return "file_scope"
  if (/\bonly change\b|\bdo not change\b|\bpreserve\b|\bscope\b|\btouch\b|\bmodify\b|\brefactor\b|\bupdate\b/.test(lower)) return "change_scope"
  if (/\bemail\b|\brecipe\b|\bprompt\b|\bplan\b|\bproposal\b|\breport\b|\bbug fix\b|\bimplementation\b/.test(lower)) return "artifact"
  if (/\bclear\b|\busable\b|\bproduction-ready\b|\bready to send\b|\bquality\b/.test(lower)) return "quality"

  const numeric = detectNumericRange(text)
  const fromUnit = inferDimensionFromUnit(numeric?.unit ?? null)
  if (fromUnit) return fromUnit
  if (numeric) return "generic_numeric"
  return "generic"
}

function detectOperator(text: string, dimension: AnalysisRequirementDimension): AnalysisRequirementOperator {
  const lower = normalizeLower(text)
  if (/\bdo not use\b|\bavoid\b|\bwithout\b|\bexclude\b/.test(lower)) return "excludes"
  if (/\binclude\b|\bprovide\b|\breturn\b|\bmust contain\b/.test(lower) && dimension === "format") return "contains"
  const numeric = detectNumericRange(text)
  if (numeric?.min != null && numeric?.max != null) return numeric.min === numeric.max ? "exact" : "range"
  if (numeric?.max != null) return "max"
  if (numeric?.min != null) return "min"
  return "present"
}

export function buildSemanticRequirement(text: string): AnalysisSemanticRequirement {
  const dimension = detectAnalysisDimensionFromText(text)
  const scope = detectAnalysisScope(text)
  const numericRange = detectNumericRange(text) ?? undefined
  return {
    sourceText: normalize(text),
    dimension,
    scope,
    operator: detectOperator(text, dimension),
    valueText: normalize(text),
    numericRange
  }
}

export function buildSemanticRequirements(values: string[]) {
  return values.map((value) => buildSemanticRequirement(value))
}
