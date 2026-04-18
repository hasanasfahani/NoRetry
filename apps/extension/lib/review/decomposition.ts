import type { ResponsePreprocessorOutput } from "@prompt-optimizer/shared/src/schemas"
import type { GoalContract, GoalConstraint } from "../goal/types"
import type { ReviewRequirement } from "./contracts"
import {
  hasCodeArtifactResponse,
  hasFullHtmlFile,
  hasIngredientsSection,
  hasInstructionSection,
  hasMacroBreakdown,
  hasRecipeDeliverable,
  hasResearchSupport,
  isRewriteArtifactResponse,
  responseIncludesRiceIngredient,
  responseIncludesTextureTips,
  responseMentionsRiceQuantity,
} from "./constraint-extractors"
import { matchConstraintEvidence, matchOutputRequirementEvidence } from "./evidence-matchers"
import { priorityForConstraintType } from "./priorities"
import { sanitizeReviewRequirement } from "./sanitizers"

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeConstraintSemanticKey(constraint: GoalConstraint) {
  const label = normalizeText(constraint.label)
    .toLowerCase()
    .replace(/\bkeep it\b/g, "")
    .replace(/\bdo not use\b/g, "")
    .replace(/\bavoid\b/g, "")
    .replace(/\b([a-z]+)[-\s]?free\b/g, "$1")
    .replace(/[()]/g, "")
    .trim()
  return `${constraint.type}:${label}`
}

function isDailyBudgetConstraint(constraint: GoalConstraint) {
  return constraint.type === "calories" && /\bper day\b|\bdaily\b|\bkcal day\b|\bday\b/i.test(constraint.label) && !/\bper serving\b/i.test(constraint.label)
}

function responseMatchesExactCount(mode: "one_exact" | "single", responseText: string) {
  const bullets = responseText.match(/(^|\n)\s*[-*]\s+/g)?.length ?? 0
  if (mode === "one_exact") {
    const hasSingleBestMatch = /\bbest match\s*:\s*(?:\n\s*[-*]\s+.+){1}/i.test(responseText)
    return (hasSingleBestMatch || bullets <= 1) && !/\boptions\b|\bseveral\b|\bmultiple\b/i.test(responseText)
  }
  return bullets <= 1
}

function buildRequirement(params: {
  id: string
  label: string
  type: string
  priority: ReviewRequirement["priority"]
  status: ReviewRequirement["status"]
  expected?: string | number
  actual?: string | number
  evidence?: string[]
}): ReviewRequirement {
  const requirement: ReviewRequirement = {
    id: params.id,
    label: normalizeText(params.label),
    type: params.type,
    priority: params.priority,
    status: params.status,
    expected: params.expected,
    actual: params.actual,
    evidence: (params.evidence ?? []).map(normalizeText).filter(Boolean)
  }
  return sanitizeReviewRequirement(requirement) ?? requirement
}

function buildConstraintRequirement(constraint: GoalConstraint, responseText: string, responseSummary: ResponsePreprocessorOutput): ReviewRequirement {
  const priority = priorityForConstraintType(constraint.type)
  const result = matchConstraintEvidence(constraint, responseText, responseSummary)
  const family =
    constraint.type === "servings" || constraint.type === "count"
      ? "count"
      : constraint.type === "time" || constraint.type === "calories" || constraint.type === "protein"
        ? "numeric_target"
        : constraint.type === "method" || constraint.type === "technology"
          ? "tool_method"
          : constraint.type === "exclusion"
            ? "exclusion"
            : constraint.type === "diet" || constraint.type === "cuisine"
              ? "diet"
              : constraint.type === "storage"
                ? "storage"
                : constraint.type === "budget"
                  ? "budget"
                  : "constraint"
  const label =
    constraint.type === "count"
      ? `Requested count matches (${constraint.label})`
      : constraint.type === "servings"
        ? `Serving count matches (${constraint.label})`
        : constraint.type === "time"
          ? `Time constraint matches (${constraint.label})`
          : constraint.type === "calories"
            ? isDailyBudgetConstraint(constraint)
              ? `Calorie budget compatibility is preserved (${constraint.label})`
              : `Calorie target matches (${constraint.label})`
            : constraint.type === "protein" && constraint.value === "high"
              ? "High-protein requirement is preserved"
              : constraint.type === "protein"
                ? `Protein target matches (${constraint.label})`
                : constraint.type === "method"
                  ? `Tool or method constraint matches (${constraint.label})`
                  : constraint.type === "technology"
                    ? `${constraint.label} requirement is present`
                    : constraint.type === "exclusion"
                      ? `Exclusion is preserved (${constraint.label})`
                      : constraint.type === "diet"
                        ? `Diet requirement is preserved (${constraint.label})`
                        : constraint.type === "cuisine"
                          ? `Cuisine or style requirement is preserved (${constraint.label})`
                          : constraint.type === "storage"
                            ? `Freshness or leftovers requirement is preserved (${constraint.label})`
                            : constraint.label
  return buildRequirement({
    id: constraint.id,
    label,
    type: family,
    priority,
    status: result.status,
    expected: typeof constraint.value === "object" && constraint.value ? JSON.stringify(constraint.value) : constraint.label,
    actual: result.actual,
    evidence: result.evidence
  })
}

export function buildReviewRequirements(input: {
  goalContract: GoalContract
  responseText: string
  responseSummary: ResponsePreprocessorOutput
  taskFamily: string
}) {
  const { goalContract, responseText, responseSummary, taskFamily } = input
  const requirements: ReviewRequirement[] = []
  const seenRequirementKeys = new Set<string>()
  const seenConstraintKeys = new Set<string>()
  const pushRequirement = (requirement: ReviewRequirement) => {
    const key = `${requirement.type}:${requirement.label.toLowerCase()}`
    if (seenRequirementKeys.has(key)) return
    seenRequirementKeys.add(key)
    requirements.push(requirement)
  }
  const shouldReviewConstraint = (constraint: GoalConstraint) => {
    if (constraint.type === "scope" && /\b(?:lunch|dinner|breakfast|snack)\b/i.test(constraint.label)) return false
    const semanticKey = normalizeConstraintSemanticKey(constraint)
    if (seenConstraintKeys.has(semanticKey)) return false
    seenConstraintKeys.add(semanticKey)
    return true
  }

  if (goalContract.deliverableType === "recipe") {
    pushRequirement(
      buildRequirement({
        id: "deliverable:recipe",
        label: "Requested deliverable type is present",
        type: "deliverable",
        priority: "P1",
        status: hasRecipeDeliverable(responseText) ? "pass" : "fail",
        evidence: hasIngredientsSection(responseText) ? ["Ingredients section is present."] : []
      })
    )
  } else if (goalContract.deliverableType === "html_file") {
    pushRequirement(
      buildRequirement({
        id: "deliverable:html",
        label: "Requested deliverable type is present",
        type: "deliverable",
        priority: "P1",
        status: hasCodeArtifactResponse(responseText, responseSummary) ? "pass" : "fail",
        evidence: hasCodeArtifactResponse(responseText, responseSummary) ? ["A code artifact is visibly present."] : []
      })
    )
  } else if (goalContract.deliverableType === "rewrite") {
    pushRequirement(
      buildRequirement({
        id: "deliverable:rewrite",
        label: "Requested rewrite output is present",
        type: "deliverable",
        priority: "P1",
        status: isRewriteArtifactResponse(responseText, responseSummary) ? "pass" : "fail"
      })
    )
  } else if (goalContract.deliverableType === "research") {
    pushRequirement(
      buildRequirement({
        id: "deliverable:research",
        label: "Requested deliverable type is present",
        type: "deliverable",
        priority: "P1",
        status: responseText.trim().length >= 120 ? "pass" : "unclear"
      })
    )
  } else if (taskFamily === "advice") {
    pushRequirement(
      buildRequirement({
        id: "deliverable:advice",
        label: "Requested answer type is present",
        type: "deliverable",
        priority: "P1",
        status: responseText.trim().length >= 80 ? "pass" : "unclear"
      })
    )
  }

  if (/\bone exact product\b|\bone exact option\b|\bsingle exact product\b/i.test(goalContract.userGoal)) {
    pushRequirement(
      buildRequirement({
        id: "count:exact",
        label: "Requested count or exactness matches",
        type: "count",
        priority: "P1",
        status: responseMatchesExactCount("one_exact", responseText) ? "pass" : "contradicted"
      })
    )
  } else if (/\bone product\b|\bsingle product\b|\bone option\b|\bsingle option\b/i.test(goalContract.userGoal)) {
    pushRequirement(
      buildRequirement({
        id: "count:single",
        label: "Requested count or exactness matches",
        type: "count",
        priority: "P1",
        status: responseMatchesExactCount("single", responseText) ? "pass" : "contradicted"
      })
    )
  }

  for (const constraint of goalContract.hardConstraints.filter(shouldReviewConstraint)) {
    pushRequirement(buildConstraintRequirement(constraint, responseText, responseSummary))
  }

  for (const outputRequirement of goalContract.outputRequirements) {
    const result = matchOutputRequirementEvidence(outputRequirement, responseText)
    const lower = outputRequirement.toLowerCase()
    const label =
      lower.includes("ingredients")
        ? "Ingredients section is present"
        : lower.includes("step-by-step") || lower.includes("instructions")
          ? "Step-by-step instructions are present"
          : lower.includes("macro")
            ? "Macro breakdown is present"
            : lower.includes("calories")
              ? "Calorie information is present"
              : lower.includes("full html")
                ? "Full HTML file output is present"
                : outputRequirement
    pushRequirement(buildRequirement({
      id: `output:${lower.replace(/[^a-z0-9]+/g, "-")}`,
      label,
      type: "output_section",
      priority: "P2",
      status: result.status,
      evidence: result.evidence
    }))
  }

  if (goalContract.userGoal.toLowerCase().includes("rice")) {
    pushRequirement(buildRequirement({
      id: "ingredient:rice",
      label: "Requested grain or base ingredient is present (rice)",
      type: "ingredient",
      priority: "P1",
      status: responseIncludesRiceIngredient(responseText) ? "pass" : "fail"
    }))
  }

  if (/exact rice quantity/i.test(goalContract.userGoal)) {
    pushRequirement(buildRequirement({
      id: "ingredient:rice-quantity",
      label: "Exact rice quantity is confirmed",
      type: "ingredient",
      priority: "P1",
      status: responseMentionsRiceQuantity(responseText) ? "pass" : "fail"
    }))
  }

  if (/texture tips?|creamy/i.test(goalContract.userGoal)) {
    pushRequirement(buildRequirement({
      id: "output:texture-tips",
      label: "Texture or finish guidance is present",
      type: "output",
      priority: "P2",
      status: responseIncludesTextureTips(responseText) || /creamy|creaminess/i.test(responseText) ? "pass" : "fail"
    }))
  }

  if (/sources?|citations?/i.test(goalContract.userGoal)) {
    pushRequirement(buildRequirement({
      id: "output:sources",
      label: "Sources or supporting references are present",
      type: "output",
      priority: "P2",
      status: hasResearchSupport(responseText) ? "pass" : "fail"
    }))
  }

  for (const preference of goalContract.softPreferences) {
    const combined = `${preference.label} ${preference.value ?? ""}`.toLowerCase()
    if (/\bexecutives?\b|\bcustomers?\b|\bhiring managers?\b|\binvestors?\b/.test(combined)) {
      pushRequirement(buildRequirement({
        id: `audience:${preference.id}`,
        label: "Audience requirement is preserved",
        type: "audience",
        priority: "P3",
        status: /executive|board|leadership|review/i.test(responseText) ? "pass" : "unclear"
      }))
      continue
    }

    if (/\bprofessional\b|\bformal\b/.test(combined)) {
      pushRequirement(buildRequirement({
        id: `tone:${preference.id}`,
        label: "Tone requirement is preserved",
        type: "tone",
        priority: "P3",
        status: !/\b(?:hey|awesome|super|omg|lol|gonna|wanna)\b/i.test(responseText) ? "pass" : "unclear"
      }))
      continue
    }

    if (/\bconcise\b|\bbrief\b|\bshort\b/.test(combined)) {
      pushRequirement(buildRequirement({
        id: `concise:${preference.id}`,
        label: "Concise tone or style requirement is preserved",
        type: "tone",
        priority: "P3",
        status: responseText.trim().split(/\s+/).length <= 60 ? "pass" : "unclear"
      }))
      continue
    }
  }

  return requirements
}
