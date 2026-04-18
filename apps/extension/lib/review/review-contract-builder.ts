import type { ResponsePreprocessorOutput } from "@prompt-optimizer/shared/src/schemas"
import type { GoalContract } from "../goal/types"
import { buildAttemptMemory } from "../session/attempt-memory"
import { buildReviewRequirements } from "./decomposition"
import type { ReviewContract } from "./contracts"
import { buildEvidenceSummary } from "./evidence-model"
import { classifyFailureTypes, summarizeFailureTypes } from "./failure-taxonomy"
import { applyReviewContractGuardrails } from "./guardrails"
import { buildNextMove } from "./next-move-builder"
import { rankReviewContract } from "./review-ranking"
import { sanitizeStringList, sanitizeUserFacingText } from "./sanitizers"

function decisionFromFailures(failureCount: number, contradictionCount: number) {
  if (failureCount === 0) return "The answer satisfies the main visible requirements."
  if (contradictionCount > 0) return "The answer breaks one or more hard requirements."
  return "The answer is usable in parts, but key requirements are still unclear or missing."
}

function confidenceFromFailures(failureCount: number, contradictionCount: number): ReviewContract["confidence"] {
  if (failureCount === 0) return "high"
  if (contradictionCount > 0 || failureCount >= 3) return "low"
  return "medium"
}

function buildRecommendation(
  topFailures: ReviewContract["topFailures"],
  failureTypes: ReviewContract["failureTypes"],
  attemptMemory: ReviewContract["attemptMemory"]
) {
  if (attemptMemory?.repeatedFailureTypes.length) {
    return `You keep hitting the same issue: ${attemptMemory.repeatedFailureTypes[0].replace(/_/g, " ")}. Narrow the retry to that gap only.`
  }
  if (failureTypes.includes("wrong_direction")) return "Restart from the correct target before retrying."
  if (failureTypes.includes("hard_constraint_violation")) return "Fix the hard requirement mismatches before using this."
  if (failureTypes.includes("missing_required_output")) return "Add the missing required parts before using this."
  if (!topFailures.length) return "You can use this as-is."
  const highestPriority = topFailures[0]?.priority ?? "P4"
  if (highestPriority === "P1") return "Fix the hard requirement mismatches before using this."
  if (highestPriority === "P2") return "Add the missing required parts before using this."
  return "Tighten the weak parts before relying on this."
}

function buildConfidenceNote(
  confidence: ReviewContract["confidence"],
  topFailures: ReviewContract["topFailures"],
  failureTypes: ReviewContract["failureTypes"],
  evidenceSummary: ReviewContract["evidenceSummary"]
) {
  if (confidence === "high") return "The visible answer satisfies the key requirements without a major contradiction."
  if (failureTypes.includes("proof_missing")) return "The answer still lacks visible proof for important requirements."
  if (evidenceSummary.counts.claimed > 0 && evidenceSummary.counts.evidenced === 0) {
    return "Some claims are present, but visible supporting evidence is still thin."
  }
  if (topFailures.some((item) => item.status === "contradicted")) {
    return "One or more hard requirements are directly contradicted by the visible answer."
  }
  return "Some visible requirements are still missing or unclear."
}

function buildWhyItems(topFailures: ReviewContract["topFailures"], topPasses: ReviewContract["topPasses"]) {
  if (!topFailures.length) {
    return sanitizeStringList(
      topPasses
        .slice(0, 3)
        .map((item) => item.evidence[0] || `${item.label} is visibly covered.`)
    )
  }

  return sanitizeStringList(
    topFailures
      .slice(0, 3)
      .map((item) => item.evidence[0] || `${item.label} is not visibly satisfied.`)
  )
}

function buildCheckedItems(topPasses: ReviewContract["topPasses"]) {
  return sanitizeStringList(topPasses.slice(0, 3).map((item) => item.evidence[0] || `${item.label} is covered.`))
}

function buildUncheckedItems(topFailures: ReviewContract["topFailures"], failureTypes: ReviewContract["failureTypes"]) {
  return sanitizeStringList(
    [...summarizeFailureTypes(failureTypes), ...topFailures
      .slice(0, 5)
      .map((item) => item.evidence[0] || item.label)]
  )
}

export async function buildReviewContract(input: {
  goalContract: GoalContract
  responseText: string
  responseSummary: ResponsePreprocessorOutput
  taskFamily: string
  sessionSummary?: {
    retryCount?: number
    lastIssueDetected?: string | null
  } | null
}): Promise<ReviewContract> {
  const { goalContract, responseText, responseSummary, taskFamily, sessionSummary } = input
  const requirements = buildReviewRequirements({
    goalContract,
    responseText,
    responseSummary,
    taskFamily
  })

  const provisional: ReviewContract = {
    taskFamily,
    checklistSource: "decomposed",
    sanitizationChanges: [],
    overallDecision: "",
    recommendation: "",
    confidence: "medium",
    confidenceNote: "",
    confidenceReasons: [],
    failureTypes: [],
    evidenceSummary: {
      items: [],
      counts: {
        claimed: 0,
        evidenced: 0,
        contradicted: 0,
        unclear: 0
      }
    },
    attemptMemory: null,
    requirements,
    topFailures: [],
    topPasses: [],
    missingItems: [],
    whyItems: [],
    proofSummary: "",
    checkedItems: [],
    uncheckedItems: [],
    promptLabel: "",
    promptText: "",
    promptNote: "",
    nextMoveShort: "",
    feedbackPrompt: "",
    analysisDebug: null
  }

  const ranked = rankReviewContract(provisional)
  const contradictionCount = ranked.topFailures.filter((item) => item.status === "contradicted").length
  const success = ranked.topFailures.length === 0
  const failureTypes = classifyFailureTypes({
    taskFamily,
    requirements: ranked.requirements,
    topFailures: ranked.topFailures,
    topPasses: ranked.topPasses
  })
  const evidenceSummary = buildEvidenceSummary(ranked.requirements)
  const attemptMemory = await buildAttemptMemory({
    sessionSummary: sessionSummary ?? null,
    currentFailureTypes: failureTypes,
    currentTopFailureLabels: ranked.topFailures.map((item) => item.label)
  })
  const nextMove = buildNextMove({
    topFailures: ranked.topFailures,
    failureTypes
  })
  const contract: ReviewContract = {
    ...ranked,
    overallDecision: decisionFromFailures(ranked.topFailures.length, contradictionCount),
    recommendation: buildRecommendation(ranked.topFailures, failureTypes, attemptMemory),
    confidence: confidenceFromFailures(ranked.topFailures.length, contradictionCount),
    confidenceNote: buildConfidenceNote(
      confidenceFromFailures(ranked.topFailures.length, contradictionCount),
      ranked.topFailures,
      failureTypes,
      evidenceSummary
    ),
    confidenceReasons: sanitizeStringList(
      ranked.topFailures.slice(0, 3).map((item) => sanitizeUserFacingText(item.label)).filter(Boolean)
    ),
    failureTypes,
    evidenceSummary,
    attemptMemory,
    missingItems: sanitizeStringList(ranked.topFailures.slice(0, 5).map((item) => item.label)),
    whyItems: buildWhyItems(ranked.topFailures, ranked.topPasses),
    proofSummary: success
      ? "Visible requirements are covered."
      : failureTypes.includes("proof_missing")
        ? "Proof is still missing for key requirements."
      : contradictionCount > 0
        ? "Hard contradictions were prioritized first."
        : "Missing or unclear visible requirements were prioritized first.",
    checkedItems: buildCheckedItems(ranked.topPasses),
    uncheckedItems: buildUncheckedItems(ranked.topFailures, failureTypes),
    promptLabel: nextMove.promptLabel,
    promptText: nextMove.promptText,
    promptNote: nextMove.promptNote,
    nextMoveShort: nextMove.nextMoveShort,
    feedbackPrompt:
      attemptMemory.progressState === "stalled"
        ? "This looks stalled. Did the next step get more specific?"
        : "Did this review make the next step clearer?",
    analysisDebug: null,
    retryStrategy: nextMove.retryStrategy
  }

  return applyReviewContractGuardrails(contract)
}
