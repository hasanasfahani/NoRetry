import type {
  NextMoveEvalCase,
  NextMoveEvalDecisionSnapshot,
  NextMoveEvalRubricFailure,
  NextMoveEvalRubricResult,
  NextMoveEvalSelectedSignalSnapshot,
  NextMoveEvalSignalSnapshot
} from "./next-move-eval-types"

const ADVANCING_RECOMMENDATIONS = new Set([
  "start_next_phase",
  "continue_optional_enhancement",
  "move_to_next_task"
])

const REVIEW_RECOMMENDATIONS = new Set([
  "finish_missing_requirements",
  "fix_quality_issues",
  "clarify_product_decision",
  "review_before_advancing"
])

function normalize(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase()
}

function hasValidationNeed(testCase: NextMoveEvalCase) {
  const review = testCase.input.review
  const text = normalize(`${review.promptText ?? ""} ${review.recommendationText} ${review.decisionText}`)
  return (
    review.workflowState === "validation_needed" ||
    /\b(validate|validation|verify|browser|proof|test|launch|deploy|payment|payments)\b/.test(text)
  )
}

function hasMissingRequirementNeed(testCase: NextMoveEvalCase) {
  const review = testCase.input.review
  const text = normalize(`${review.promptText ?? ""} ${review.recommendationText} ${review.decisionText}`)
  return (
    review.analysisStatus === "FAILED" ||
    review.analysisStatus === "PARTIAL" ||
    review.workflowState === "implementation_underway" ||
    /\b(missing|finish|incomplete|broken|placeholder|still needs|not actually|does not actually)\b/.test(text)
  )
}

function hasClarificationNeed(testCase: NextMoveEvalCase, selected: NextMoveEvalSelectedSignalSnapshot) {
  return (
    testCase.input.review.analysisStatus === "WRONG_DIRECTION" ||
    testCase.input.review.workflowState === "blocked" ||
    selected.kind === "clarify_decision" ||
    selected.nextMoveType === "clarification_request"
  )
}

function addFailure(failures: NextMoveEvalRubricFailure[], rule: string, message: string) {
  failures.push({ rule, message })
}

function addPass(passedRules: string[], rule: string) {
  passedRules.push(rule)
}

function isAdvancing(decision: NextMoveEvalDecisionSnapshot) {
  return ADVANCING_RECOMMENDATIONS.has(decision.recommendationKind)
}

function isReviewing(decision: NextMoveEvalDecisionSnapshot) {
  return REVIEW_RECOMMENDATIONS.has(decision.recommendationKind)
}

export function evaluateNextMoveRubric(input: {
  testCase: NextMoveEvalCase
  aiSignal: NextMoveEvalSignalSnapshot | null
  selected: NextMoveEvalSelectedSignalSnapshot
  aiDecision: NextMoveEvalDecisionSnapshot
  fallbackDecision: NextMoveEvalDecisionSnapshot
}): NextMoveEvalRubricResult {
  const failures: NextMoveEvalRubricFailure[] = []
  const passedRules: string[] = []
  const { testCase, aiSignal, selected, aiDecision } = input
  const hardGate = testCase.expected.hardGate
  const validationNeeded = hasValidationNeed(testCase)
  const missingRequirementNeeded = !hardGate.requirementSatisfied && hasMissingRequirementNeed(testCase)
  const clarificationNeeded = hasClarificationNeed(testCase, selected)

  if (hardGate.mustBlockAdvancement) {
    const rule = "rubric.requirement_gate_blocks_advancement"
    if (isAdvancing(aiDecision)) {
      addFailure(
        failures,
        rule,
        `Requirement gate should block advancement because ${hardGate.rationale}; got ${aiDecision.status}/${aiDecision.recommendationKind}.`
      )
    } else {
      addPass(passedRules, rule)
    }
  }

  if (!hardGate.requirementSatisfied) {
    const rule = "rubric.unsatisfied_requirement_stays_in_review"
    if (!isReviewing(aiDecision)) {
      addFailure(
        failures,
        rule,
        `Unsatisfied requirement should keep the user in a review/fix path; got ${aiDecision.status}/${aiDecision.recommendationKind}.`
      )
    } else {
      addPass(passedRules, rule)
    }
  }

  if (validationNeeded) {
    const rule = "rubric.validation_needed_requires_review_before_advancing"
    if (aiDecision.recommendationKind !== "review_before_advancing") {
      addFailure(
        failures,
        rule,
        `Validation need should recommend review_before_advancing; got ${aiDecision.recommendationKind}.`
      )
    } else {
      addPass(passedRules, rule)
    }
  }

  if (
    missingRequirementNeeded &&
    !validationNeeded &&
    !clarificationNeeded &&
    testCase.expected.decision.recommendationKind === "finish_missing_requirements"
  ) {
    const rule = "rubric.missing_requirements_require_finish_path"
    if (aiDecision.recommendationKind !== "finish_missing_requirements") {
      addFailure(
        failures,
        rule,
        `Missing requirements should recommend finish_missing_requirements; got ${aiDecision.recommendationKind}.`
      )
    } else {
      addPass(passedRules, rule)
    }
  }

  if (aiSignal?.nextMoveType === "task_complete" && missingRequirementNeeded && !validationNeeded) {
    const rule = "rubric.completion_claim_cannot_override_missing_requirements"
    if (aiDecision.recommendationKind !== "finish_missing_requirements") {
      addFailure(
        failures,
        rule,
        `Assistant completion claim must not override missing requirements; got ${aiDecision.recommendationKind}.`
      )
    } else {
      addPass(passedRules, rule)
    }
  }

  if (aiSignal?.confidenceLevel === "low") {
    const rule = "rubric.low_confidence_ai_uses_fallback"
    if (selected.source !== "local_heuristic") {
      addFailure(
        failures,
        rule,
        `Low-confidence AI should use the local heuristic when available; selected ${selected.source}.`
      )
    } else {
      addPass(passedRules, rule)
    }
  }

  if (clarificationNeeded) {
    const rule = "rubric.clarification_blocks_implementation"
    if (aiDecision.recommendationKind !== "clarify_product_decision" || aiDecision.status !== "blocked") {
      addFailure(
        failures,
        rule,
        `Clarification need should block implementation; got ${aiDecision.status}/${aiDecision.recommendationKind}.`
      )
    } else {
      addPass(passedRules, rule)
    }
  }

  if (selected.kind === "offer_optional_enhancement" && !hardGate.requirementSatisfied) {
    const rule = "rubric.optional_enhancement_blocked_until_current_work_satisfied"
    if (aiDecision.recommendationKind === "continue_optional_enhancement") {
      addFailure(
        failures,
        rule,
        "Optional enhancement should not continue while the current requirement is unsatisfied."
      )
    } else {
      addPass(passedRules, rule)
    }
  }

  if (testCase.category === "clear_stop" && hardGate.requirementSatisfied) {
    const rule = "rubric.clear_stop_moves_to_next_task"
    if (aiDecision.recommendationKind !== "move_to_next_task") {
      addFailure(
        failures,
        rule,
        `Clear stop case should move the user to the next task; got ${aiDecision.recommendationKind}.`
      )
    } else {
      addPass(passedRules, rule)
    }
  }

  return { failures, passedRules }
}
