import type { FailureType } from "./failure-taxonomy"
import type { ReviewRequirement } from "./contracts"

export type RetryStrategy =
  | "narrow_scope"
  | "fix_failed_constraints_only"
  | "request_proof_only"
  | "request_missing_sections_only"
  | "restart_with_clean_prompt"
  | "verify_before_continue"
  | "validate"

export function chooseRetryStrategy(input: {
  failureTypes: FailureType[]
  topFailures: ReviewRequirement[]
}): RetryStrategy {
  const { failureTypes, topFailures } = input
  const outputOnlyFailures =
    topFailures.length > 0 &&
    topFailures.every((item) => ["output_section", "deliverable"].includes(item.type) && item.status !== "contradicted")
  if (!topFailures.length) return "validate"
  if (failureTypes.includes("wrong_direction")) return "restart_with_clean_prompt"
  if (failureTypes.includes("proof_missing")) return "request_proof_only"
  if (failureTypes.includes("missing_required_output") && outputOnlyFailures) return "request_missing_sections_only"
  if (topFailures.filter((item) => item.priority === "P1").length >= 2) return "fix_failed_constraints_only"
  if (failureTypes.includes("scope_drift")) return "narrow_scope"
  return "fix_failed_constraints_only"
}
