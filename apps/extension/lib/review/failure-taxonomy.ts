import type { ReviewContract, ReviewRequirement } from "./contracts"

export type FailureType =
  | "wrong_direction"
  | "hard_constraint_violation"
  | "missing_required_output"
  | "proof_missing"
  | "unverifiable_claim"
  | "shallow_patch"
  | "format_only_compliance"
  | "regression_risk"
  | "scope_drift"

function hasPriorityFailure(requirements: ReviewRequirement[], priority: ReviewRequirement["priority"]) {
  return requirements.some((item) => item.priority === priority && item.status !== "pass")
}

export function classifyFailureTypes(input: {
  taskFamily: string
  requirements: ReviewRequirement[]
  topFailures: ReviewRequirement[]
  topPasses: ReviewRequirement[]
}): FailureType[] {
  const { taskFamily, requirements, topFailures, topPasses } = input
  const failureTypes: FailureType[] = []

  if (topFailures.some((item) => item.status === "contradicted" && ["deliverable", "method", "technology", "cuisine"].includes(item.type))) {
    failureTypes.push("wrong_direction")
  }
  if (hasPriorityFailure(requirements, "P1")) {
    failureTypes.push("hard_constraint_violation")
  }
  if (topFailures.some((item) => item.priority === "P2")) {
    failureTypes.push("missing_required_output")
  }
  if (["debug", "verification"].includes(taskFamily) && topFailures.some((item) => item.status === "unclear")) {
    failureTypes.push("proof_missing")
  }
  if (["debug", "verification", "creation"].includes(taskFamily) && topPasses.some((item) => item.evidence.length === 0)) {
    failureTypes.push("unverifiable_claim")
  }
  if (["debug", "verification"].includes(taskFamily) && topPasses.length > 0 && topFailures.length > 0) {
    failureTypes.push("shallow_patch")
  }
  if (topPasses.length >= 2 && hasPriorityFailure(requirements, "P1")) {
    failureTypes.push("format_only_compliance")
  }
  if (["debug", "verification", "creation"].includes(taskFamily) && topFailures.length >= 3) {
    failureTypes.push("regression_risk")
  }
  if (topFailures.length >= 4 && new Set(topFailures.map((item) => item.type)).size >= 3) {
    failureTypes.push("scope_drift")
  }

  return [...new Set(failureTypes)]
}

export function summarizeFailureTypes(failureTypes: FailureType[]): string[] {
  return failureTypes.map((type) => {
    switch (type) {
      case "wrong_direction":
        return "The answer is aimed at the wrong target."
      case "hard_constraint_violation":
        return "A hard requirement is broken."
      case "missing_required_output":
        return "A required output section is missing."
      case "proof_missing":
        return "The answer does not show enough proof."
      case "unverifiable_claim":
        return "Some claims sound right but are not clearly evidenced."
      case "shallow_patch":
        return "The fix looks shallow relative to the problem."
      case "format_only_compliance":
        return "The answer matches format more than substance."
      case "regression_risk":
        return "There is a visible risk of breaking nearby behavior."
      case "scope_drift":
        return "The answer drifted away from the requested scope."
    }
  })
}
