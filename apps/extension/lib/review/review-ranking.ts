import type { ReviewContract, ReviewRequirement, ReviewRequirementStatus } from "./contracts"
import { failureRank, priorityRank } from "./priorities"

function statusRank(status: ReviewRequirementStatus) {
  switch (status) {
    case "contradicted":
      return 4
    case "fail":
      return 3
    case "unclear":
      return 2
    case "pass":
    default:
      return 1
  }
}

function sortRequirements(requirements: ReviewRequirement[]) {
  return requirements
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
    const leftRequirement = left.item
    const rightRequirement = right.item
    const failureDelta =
      failureRank({ status: rightRequirement.status, priority: rightRequirement.priority, type: rightRequirement.type }) -
      failureRank({ status: leftRequirement.status, priority: leftRequirement.priority, type: leftRequirement.type })
    if (failureDelta !== 0) return failureDelta
    const statusDelta = statusRank(rightRequirement.status) - statusRank(leftRequirement.status)
    if (statusDelta !== 0) return statusDelta
    const priorityDelta = priorityRank(rightRequirement.priority) - priorityRank(leftRequirement.priority)
    if (priorityDelta !== 0) return priorityDelta
    if (leftRequirement.type === "deliverable" && rightRequirement.type !== "deliverable") return -1
    if (rightRequirement.type === "deliverable" && leftRequirement.type !== "deliverable") return 1
    return left.index - right.index
  })
    .map(({ item }) => item)
}

export function rankReviewContract(contract: ReviewContract): ReviewContract {
  const rankedRequirements = sortRequirements(contract.requirements)
  const topFailures = rankedRequirements.filter((item) => item.status !== "pass").slice(0, 8)
  const topPasses = rankedRequirements.filter((item) => item.status === "pass").slice(0, 3)

  return {
    ...contract,
    requirements: rankedRequirements,
    topFailures,
    topPasses
  }
}
