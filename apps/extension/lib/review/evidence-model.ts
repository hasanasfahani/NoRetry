import type { ReviewRequirement } from "./contracts"

export type RequirementEvidenceState = "claimed" | "evidenced" | "contradicted" | "unclear"

export type RequirementEvidence = {
  requirementId: string
  label: string
  state: RequirementEvidenceState
  support: string[]
}

export type ReviewEvidenceSummary = {
  items: RequirementEvidence[]
  counts: Record<RequirementEvidenceState, number>
}

function evidenceStateForRequirement(requirement: ReviewRequirement): RequirementEvidenceState {
  if (requirement.status === "contradicted") return "contradicted"
  if (requirement.status === "pass") return requirement.evidence.length > 0 ? "evidenced" : "claimed"
  if (requirement.status === "fail") return "unclear"
  return "unclear"
}

export function buildEvidenceSummary(requirements: ReviewRequirement[]): ReviewEvidenceSummary {
  const items = requirements.map((requirement) => ({
    requirementId: requirement.id,
    label: requirement.label,
    state: evidenceStateForRequirement(requirement),
    support: requirement.evidence
  }))

  const counts: Record<RequirementEvidenceState, number> = {
    claimed: 0,
    evidenced: 0,
    contradicted: 0,
    unclear: 0
  }

  for (const item of items) counts[item.state] += 1

  return {
    items,
    counts
  }
}
