import type { AnalysisAnswerModel } from "./analysis-answer-model"
import type { AnalysisJudgeResult } from "./analysis-llm-judge"
import type { AnalysisRequestModel } from "./analysis-request-model"
import {
  canonicalizeAnalysisUnit,
  detectNumericRange,
  detectAnalysisDimensionFromText,
  type AnalysisQuantitativeObservation,
  type AnalysisRequirementDimension,
  type AnalysisSemanticRequirement
} from "./analysis-semantics"
import { rankAnalysisJudgments } from "./analysis-usefulness-ranking"
import type { ReviewAnalysisJudgment } from "./contracts"

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function hasExplicitMinimumLanguage(text: string) {
  return /\bat least\b|\bminimum\b|>=|≥|\bno sooner than\b|\bnot less than\b|\bfrom\b.+\bto\b|\bbetween\b/.test(
    normalize(text)
  )
}

function hasFlexibleWindowLanguage(text: string, dimension: AnalysisRequirementDimension) {
  const lower = normalize(text)
  if (/\bwithin\b|\bup to\b|\bmax(?:imum)?\b|\bat most\b|\bno more than\b|\bunder\b|\bless than\b|\bfits inside\b/.test(lower)) {
    return true
  }

  if (dimension === "time") {
    return /\b(?:ready|prepared?|prepare|prep|cook(?:s|ed)?|takes?)\s+in\b/.test(lower)
  }

  if (dimension === "calories") {
    return /\b(?:fits?|stay|stays|keeps?)\s+(?:inside|within|under)\b|\bday\b|\bdaily\b/.test(lower)
  }

  if (dimension === "budget") {
    return /\b(?:fits?|stay|stays|keeps?)\s+(?:inside|within|under)\b|\bbudget\b|\bcost\b/.test(lower)
  }

  return false
}

function inferRequirementPolicy(requirement: AnalysisSemanticRequirement, requestModel: AnalysisRequestModel) {
  const numericRange = requirement.numericRange
  if (!numericRange) return { enforceMin: false, enforceMax: false }
  if (requirement.operator === "exact") return { enforceMin: true, enforceMax: true }
  if (requirement.operator === "min") return { enforceMin: true, enforceMax: false }
  if (requirement.operator === "max") return { enforceMin: false, enforceMax: true }

  const explicitMinimum = hasExplicitMinimumLanguage(requirement.sourceText)
  if (explicitMinimum) return { enforceMin: true, enforceMax: true }

  if (
    (requirement.dimension === "time" || requirement.dimension === "calories" || requirement.dimension === "budget") &&
    (hasFlexibleWindowLanguage(requirement.sourceText, requirement.dimension) ||
      requestModel.artifactFamily === "recipe" ||
      requestModel.specificity.broadPromptLikely ||
      requirement.scope === "per_day")
  ) {
    return { enforceMin: false, enforceMax: numericRange.max != null }
  }

  return {
    enforceMin: numericRange.min != null,
    enforceMax: numericRange.max != null
  }
}

function unitFamiliesMatch(requirementUnit: string | null, observationUnit: string | null) {
  const req = canonicalizeAnalysisUnit(requirementUnit)
  const obs = canonicalizeAnalysisUnit(observationUnit)
  if (!req || !obs) return true
  if (req === obs) return true

  const families = [
    ["kcal", "calories", "cal"],
    ["minutes", "hours", "seconds", "ms"],
    ["g", "kg", "mg", "lb", "oz"],
    ["ml", "l", "cups", "tbsp", "tsp"],
    ["servings", "people"],
    ["usd"],
    ["words", "tokens", "lines", "files"],
    ["px", "rem", "em"]
  ]

  return families.some((family) => family.includes(req) && family.includes(obs))
}

function extractQuantitativeObservations(
  dimension: AnalysisRequirementDimension,
  requirement: AnalysisSemanticRequirement,
  answerModel: AnalysisAnswerModel
) {
  return answerModel.quantitativeObservations.filter((observation) => {
    if (observation.dimension !== dimension && !(dimension === "generic_numeric")) return false
    if (!unitFamiliesMatch(requirement.numericRange?.unit ?? null, observation.unit)) return false
    return true
  })
}

function scopesAlign(requirement: AnalysisSemanticRequirement, observation: AnalysisQuantitativeObservation) {
  if (requirement.scope === observation.scope) return true
  if (requirement.scope === "artifact_total") return true
  if (observation.scope === "artifact_total") return true
  if (
    (requirement.dimension === "calories" || requirement.dimension === "budget") &&
    (requirement.scope === "per_day" || requirement.sourceText.toLowerCase().includes("day")) &&
    observation.scope === "per_serving"
  ) {
    return true
  }
  return false
}

function requirementSatisfiedByObservation(
  requirement: AnalysisSemanticRequirement,
  observation: AnalysisQuantitativeObservation,
  requestModel: AnalysisRequestModel
) {
  const numericRange = requirement.numericRange
  if (!numericRange || !scopesAlign(requirement, observation)) return false

  const policy = inferRequirementPolicy(requirement, requestModel)
  const minSatisfied =
    !policy.enforceMin || numericRange.min == null || observation.max >= numericRange.min
  const maxSatisfied =
    !policy.enforceMax || numericRange.max == null || observation.min <= numericRange.max
  return minSatisfied && maxSatisfied
}

function dimensionRequirementsSatisfied(
  dimension: AnalysisRequirementDimension,
  requestModel: AnalysisRequestModel,
  answerModel: AnalysisAnswerModel
) {
  const requirements = requestModel.semanticRequirements.filter(
    (requirement) => requirement.dimension === dimension && requirement.numericRange
  )
  if (requirements.length === 0) return false

  return requirements.every((requirement) => {
    const observations = extractQuantitativeObservations(dimension, requirement, answerModel)
    if (!observations.length) return false
    return observations.some((observation) => requirementSatisfiedByObservation(requirement, observation, requestModel))
  })
}

function labelMapsToDimension(label: string): AnalysisRequirementDimension | null {
  const dimension = detectAnalysisDimensionFromText(label)
  return dimension === "generic" ? null : dimension
}

function numericRangesEquivalent(
  left: AnalysisSemanticRequirement["numericRange"] | null | undefined,
  right: AnalysisSemanticRequirement["numericRange"] | null | undefined
) {
  if (!left || !right) return false
  return (
    left.min === right.min &&
    left.max === right.max &&
    unitFamiliesMatch(left.unit ?? null, right.unit ?? null)
  )
}

function parseNumericRangeFromLabel(label: string) {
  const parsed = detectNumericRange(label)
  if (parsed) return parsed

  const exact = label.match(/"exact"\s*:\s*(\d+(?:\.\d+)?)/i)
  if (exact) {
    const value = Number(exact[1])
    return { min: value, max: value, unit: null }
  }

  const min = label.match(/"min"\s*:\s*(\d+(?:\.\d+)?)/i)
  const max = label.match(/"max"\s*:\s*(\d+(?:\.\d+)?)/i)
  const unit = label.match(/"unit"\s*:\s*"([^"]+)"/i)
  if (min || max) {
    return {
      min: min ? Number(min[1]) : null,
      max: max ? Number(max[1]) : null,
      unit: unit ? unit[1] : null
    }
  }

  return null
}

function dedupe(values: string[]) {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const value of values) {
    const key = normalize(value)
    if (!key || seen.has(key)) continue
    seen.add(key)
    kept.push(value.trim())
  }
  return kept
}

function normalizeJudgmentLabel(label: string) {
  return normalize(
    label
      .replace(/^(?:task\s*\/\s*goal|requirements?|constraints?|acceptance criteria|actual output)\s*:\s*/i, "")
      .replace(/^(?:missing or wrong|still unclear|contradiction):\s*/i, "")
      .replace(/^the answer already /i, "")
  )
}

function isImpossibleGapLabel(label: string, requestModel: AnalysisRequestModel, answerModel: AnalysisAnswerModel) {
  const requestText = normalize(requestModel.rawPrompt)
  const { specificity } = requestModel
  const hasBudgetRequirement = requestModel.semanticRequirements.some((item) => item.dimension === "budget")
  const hasServingRequirement = requestModel.semanticRequirements.some((item) => item.dimension === "servings")
  const hasPerDayCalories = requestModel.semanticRequirements.some(
    (item) => item.dimension === "calories" && item.scope === "per_day"
  )
  const wantsInstructionArtifact = /\bstep-by-step\b|\binstructions?\b|\bguide\b/.test(requestText)
  const lower = normalize(label)
  if (!lower) return true
  if (/\bis present\b/.test(lower)) return true
  if (specificity.broadPromptLikely && /\bdeliverable type\b|\brequested deliverable\b|\bmore clearly\b/.test(lower)) return true
  if (!specificity.explicitVerificationRequested && /\bproof\b|\bverify\b|\bverification\b|\btest steps\b|\bregression\b/.test(lower)) return true
  if (!specificity.explicitExactnessRequested && /\bexact change\b|\bexact fix\b|\bmore clearly\b|\bitemized\b/.test(lower)) return true
  if (!specificity.explicitFileScopeRequested && /\bexact files?\b|\bfile lines?\b|\bline that was added\b|\bline that was removed\b|\bline that was altered\b|\bdiff\b|\bpatch\b/.test(lower)) return true
  if (!specificity.explicitChangeScopeRequested && /\bonly change\b|\bdo not change\b|\bpreserve\b|\bunrelated logic\b/.test(lower)) return true
  if ((requestModel.artifactFamily === "prompt_for_coding_tool" || requestModel.artifactFamily === "code_change" || requestModel.artifactFamily === "bug_fix") && !wantsInstructionArtifact && /\bstep-by-step instructions\b|\binstructions?\b/.test(lower)) {
    return true
  }
  if (!hasServingRequirement && /\bserving count\b|\bservings?\b/.test(lower)) return true
  if (!hasBudgetRequirement && /\bbudget\b|\bcost\b|\$\d/.test(lower)) return true
  if (answerModel.hasTable && /\btable\b/.test(lower)) return true
  if (answerModel.hasIngredients && /\bingredients\b/.test(lower)) return true
  if (answerModel.hasInstructions && /\binstructions?\b|\bstep-by-step\b/.test(lower)) return true
  if (answerModel.hasMacroBreakdown && answerModel.hasCalorieInfo && /\bmacros?\b|\bmacro breakdown\b|\bmacros and calories\b/.test(lower)) return true
  if (answerModel.servingCount?.min === 1 && answerModel.servingCount.max === 1 && /\bserving count\b|\bsingle[-\s]?serving\b/.test(lower)) return true
  if (requestModel.noSmallTalk && !answerModel.hasSmallTalk && /\bsmall[-\s]?talk\b/.test(lower)) return true
  if (requestModel.styleConstraints.includes("plain inline output") && /\bemail box\b|\bboxed\b|\bcontainer\b/.test(lower)) return true
  if (hasPerDayCalories && /\b1500\b|\b1800\b/.test(lower) && /\bper serving\b|\bcalorie target\b|\bcalories\b/.test(lower)) return true
  const quantitativeDimension = labelMapsToDimension(label)
  const labelRange = parseNumericRangeFromLabel(label)
  if (quantitativeDimension && labelRange) {
    const dimensionRequirements = requestModel.semanticRequirements.filter(
      (requirement) => requirement.dimension === quantitativeDimension && requirement.numericRange
    )
    const matchingSameDimension = dimensionRequirements.some((requirement) =>
      numericRangesEquivalent(requirement.numericRange, labelRange)
    )
    if (!matchingSameDimension) {
      const matchedDifferentDimension = requestModel.semanticRequirements.some(
        (requirement) =>
          requirement.dimension !== quantitativeDimension &&
          numericRangesEquivalent(requirement.numericRange, labelRange)
      )
      if (matchedDifferentDimension) return true
    }
  }
  if (
    quantitativeDimension &&
    dimensionRequirementsSatisfied(quantitativeDimension, requestModel, answerModel)
  ) {
    return true
  }
  return false
}

function shouldDefaultNoRetry(input: {
  requestModel: AnalysisRequestModel
  judgments: ReviewAnalysisJudgment[]
  gaps: string[]
}) {
  const unresolved = input.judgments.filter((judgment) => judgment.status !== "met")
  if (unresolved.length === 0) return true
  if (!input.requestModel.specificity.broadPromptLikely) return false

  const blocking = unresolved.filter(
    (judgment) =>
      judgment.status === "contradicted" ||
      (judgment.status === "missing" && judgment.confidence === "high" && judgment.usefulness >= 78)
  )
  if (blocking.length > 0) return false

  const actionable = unresolved.filter(
    (judgment) =>
      judgment.confidence === "high" &&
      judgment.usefulness >= 72 &&
      !/\bproof\b|\bverify\b|\bverification\b|\bexact\b|\bfiles?\b|\blines?\b|\bdiff\b|\bpatch\b/i.test(judgment.label)
  )

  return actionable.length === 0 && input.gaps.length <= 1
}

function filterImpossibleGaps(gaps: string[], requestModel: AnalysisRequestModel, answerModel: AnalysisAnswerModel) {
  return gaps.filter((gap) => !isImpossibleGapLabel(gap, requestModel, answerModel))
}

function filterImpossibleJudgments(
  judgments: ReviewAnalysisJudgment[],
  requestModel: AnalysisRequestModel,
  answerModel: AnalysisAnswerModel,
  notes: string[]
) {
  return judgments.filter((judgment) => {
    const impossible = isImpossibleGapLabel(judgment.label, requestModel, answerModel)
    if (impossible) {
      notes.push(`Dropped impossible judgment: ${judgment.label}`)
    }
    return !impossible
  })
}

function filterGroundedJudgments(
  judgments: ReviewAnalysisJudgment[],
  baselineJudgments: ReviewAnalysisJudgment[],
  notes: string[],
  allowBaselineMatch: boolean
) {
  const baselineKeys = baselineJudgments.map((judgment) => normalizeJudgmentLabel(judgment.label))
  return judgments.filter((judgment) => {
    const key = normalizeJudgmentLabel(judgment.label)
    const grounded =
      judgment.requestEvidence.length > 0 ||
      judgment.answerEvidence.length > 0 ||
      (allowBaselineMatch &&
        baselineKeys.some((baselineKey) => baselineKey === key || baselineKey.includes(key) || key.includes(baselineKey)))
    if (!grounded) {
      notes.push(`Dropped ungrounded judgment: ${judgment.label}`)
    }
    return grounded
  })
}

function mergeJudgments(baselineJudgments: ReviewAnalysisJudgment[], judged: ReviewAnalysisJudgment[]) {
  if (!judged.length) return baselineJudgments

  const merged = new Map<string, ReviewAnalysisJudgment>()
  for (const judgment of baselineJudgments) {
    merged.set(normalizeJudgmentLabel(judgment.label), judgment)
  }
  for (const judgment of judged) {
    const key = normalizeJudgmentLabel(judgment.label)
    const existing = merged.get(key)
    merged.set(key, {
      ...(existing ?? judgment),
      ...judgment,
      usefulness: Math.max(existing?.usefulness ?? 0, judgment.usefulness),
      requestEvidence: judgment.requestEvidence.length ? judgment.requestEvidence : existing?.requestEvidence ?? [],
      answerEvidence: judgment.answerEvidence.length ? judgment.answerEvidence : existing?.answerEvidence ?? []
    })
  }
  return [...merged.values()]
}

export function validateAnalysisJudgeResult(input: {
  judgeResult: AnalysisJudgeResult | null
  requestModel: AnalysisRequestModel
  answerModel: AnalysisAnswerModel
  baselineWorking: string[]
  baselineGaps: string[]
  baselineNextMove: string
  baselineJudgments: ReviewAnalysisJudgment[]
}) {
  const validatorNotes: string[] = []
  const filteredBaselineGaps = dedupe(filterImpossibleGaps(input.baselineGaps, input.requestModel, input.answerModel))
  const groundedBaselineJudgments = filterGroundedJudgments(
    input.baselineJudgments,
    [],
    validatorNotes,
    false
  )
  const possibleBaselineJudgments = filterImpossibleJudgments(
    groundedBaselineJudgments,
    input.requestModel,
    input.answerModel,
    validatorNotes
  )
  const baselineJudgments = rankAnalysisJudgments({
    judgments: possibleBaselineJudgments,
    requestModel: input.requestModel,
    answerModel: input.answerModel
  })
  const noRetryBaseline = filteredBaselineGaps.length === 0 || shouldDefaultNoRetry({
    requestModel: input.requestModel,
    judgments: baselineJudgments,
    gaps: filteredBaselineGaps
  })

  if (!input.judgeResult) {
    validatorNotes.push("Judge unavailable; using baseline analyzer.")
    const baselineWorking = dedupe(
      baselineJudgments.filter((judgment) => judgment.status === "met").map((judgment) => judgment.label)
    ).slice(0, 8)
    const baselineGaps = dedupe(
      filterImpossibleGaps(
        baselineJudgments.filter((judgment) => judgment.status !== "met").map((judgment) => judgment.label),
        input.requestModel,
        input.answerModel
      )
    ).slice(0, 8)
    return {
      working: baselineWorking.length ? baselineWorking : input.baselineWorking,
      gaps: baselineGaps.length || noRetryBaseline ? baselineGaps : filteredBaselineGaps,
      nextMove: "",
      noRetryNeeded: noRetryBaseline || baselineGaps.length === 0,
      verdicts: baselineJudgments,
      judgeNotes: [],
      validatorNotes,
      promptVersion: "baseline-only",
      selectedPath: "baseline" as const
    }
  }

  const groundedJudgments = filterGroundedJudgments(input.judgeResult.verdicts, baselineJudgments, validatorNotes, true)
  const possibleJudgments = filterImpossibleJudgments(
    groundedJudgments,
    input.requestModel,
    input.answerModel,
    validatorNotes
  )
  const mergedJudgments = rankAnalysisJudgments({
    judgments: mergeJudgments(baselineJudgments, possibleJudgments),
    requestModel: input.requestModel,
    answerModel: input.answerModel
  })

  const working = dedupe(
    input.judgeResult.working.length
      ? input.judgeResult.working
      : mergedJudgments.filter((judgment) => judgment.status === "met").map((judgment) => judgment.label)
  ).slice(0, 8)

  const gaps = dedupe(
    filterImpossibleGaps(
      input.judgeResult.gaps.length
        ? input.judgeResult.gaps
        : mergedJudgments.filter((judgment) => judgment.status !== "met").map((judgment) => judgment.label),
      input.requestModel,
      input.answerModel
    )
  ).slice(0, 8)

  const noRetryNeeded = input.judgeResult.noRetryNeeded || gaps.length === 0 || shouldDefaultNoRetry({
    requestModel: input.requestModel,
    judgments: mergedJudgments,
    gaps
  })
  if (noRetryNeeded) {
    validatorNotes.push("No retry needed after validated smart analysis.")
  }

  return {
    working: working.length ? working : input.baselineWorking,
    gaps: gaps.length || noRetryNeeded ? gaps : filteredBaselineGaps,
    nextMove: input.judgeResult.nextMove.trim() || input.baselineNextMove,
    noRetryNeeded,
    verdicts: mergedJudgments,
    judgeNotes: input.judgeResult.judgeNotes,
    validatorNotes,
    promptVersion: input.judgeResult.promptVersion,
    selectedPath: groundedJudgments.length ? ("smart" as const) : ("baseline" as const)
  }
}
