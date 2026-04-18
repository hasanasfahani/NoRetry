import type { GoalConstraintType } from "../goal/types"
import type { ReviewRequirementPriority } from "./contracts"

export function priorityForConstraintType(type: GoalConstraintType): ReviewRequirementPriority {
  switch (type) {
    case "servings":
    case "time":
    case "calories":
    case "protein":
    case "method":
    case "technology":
    case "exclusion":
    case "diet":
    case "count":
      return "P1"
    case "output":
    case "platform":
      return "P2"
    case "cuisine":
    case "budget":
    case "storage":
    case "scope":
      return "P3"
    default:
      return "P4"
  }
}

export function priorityRank(priority: ReviewRequirementPriority) {
  switch (priority) {
    case "P1":
      return 4
    case "P2":
      return 3
    case "P3":
      return 2
    default:
      return 1
  }
}

export function failureRank(input: {
  status: "pass" | "fail" | "unclear" | "contradicted"
  priority: ReviewRequirementPriority
  type: string
}) {
  const { status, priority, type } = input
  if (status === "contradicted" && priority === "P1") return 50
  if ((status === "contradicted" || status === "fail") && priority === "P1") return 45
  if ((status === "fail" || status === "unclear") && type === "output_section") return 35
  if ((status === "contradicted" || status === "fail") && priority === "P2") return 30
  if ((status === "contradicted" || status === "fail") && priority === "P3") return 20
  if (status !== "pass") return 10
  return 0
}
