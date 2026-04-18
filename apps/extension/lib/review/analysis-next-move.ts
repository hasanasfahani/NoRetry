import type { AnalysisRequestModel } from "./analysis-request-model"
import type { ReviewAnalysisJudgment } from "./contracts"

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function artifactLabel(requestModel: AnalysisRequestModel) {
  switch (requestModel.artifactFamily) {
    case "prompt_for_coding_tool":
      return "coding prompt"
    case "bug_fix":
      return "fix answer"
    case "code_change":
      return "code change request"
    case "implementation_plan":
      return "implementation plan"
    case "spec":
      return "spec"
    case "verification":
      return "verification answer"
    case "email":
      return "email"
    case "recipe":
      return "recipe"
    case "code":
      return "solution"
    case "plan":
      return "plan"
    case "rewrite":
      return "rewrite"
    case "debug":
      return "fix answer"
    default:
      return "answer"
  }
}

export function buildBaselineNextMove(input: {
  requestModel?: AnalysisRequestModel
  working: string[]
  gaps: string[]
  noRetryNeeded?: boolean
}) {
  if (input.noRetryNeeded || input.gaps.length === 0) {
    return "No retry needed. The visible answer already covers the requested parts."
  }
  if (input.requestModel?.specificity.broadPromptLikely && input.gaps.length <= 1) {
    return "No retry needed. The visible answer already covers the broad request well enough."
  }
  return [
    "Revise the answer so it fixes only these remaining issues:",
    ...input.gaps.slice(0, 3).map((item) => `- ${item}`),
    "Preserve everything else that already works.",
    input.requestModel ? requestModelOutputHint(input.requestModel) : "Return only the updated answer."
  ].join("\n")
}

export function buildValidatedNextMove(input: {
  requestModel: AnalysisRequestModel
  judgments: ReviewAnalysisJudgment[]
  noRetryNeeded?: boolean
}) {
  const unresolved = input.judgments.filter((judgment) => judgment.status !== "met")
  const actionable = unresolved.filter(
    (judgment) => judgment.confidence === "high" || judgment.usefulness >= 72 || judgment.status === "contradicted"
  )
  if (input.noRetryNeeded || unresolved.length === 0 || (input.requestModel.specificity.broadPromptLikely && actionable.length === 0)) {
    return "No retry needed. The visible answer already covers the requested parts."
  }

  const top = (actionable.length ? actionable : unresolved).slice(0, 3)
  const outputHint = requestModelOutputHint(input.requestModel)
  const target = artifactLabel(input.requestModel)

  const lines = [
    `Revise the ${target} so it fixes only these remaining issues:`,
    ...top.map((judgment) => `- ${normalize(judgment.label)}`),
    "Preserve everything else that already works.",
    outputHint
  ].filter(Boolean)

  return lines.join("\n")
}

function requestModelOutputHint(requestModel: AnalysisRequestModel) {
  if (requestModel.plainOutputPreferred) {
    return "Return only the updated answer as plain text."
  }

  const outputText = [...requestModel.outputRequirements, ...requestModel.acceptanceCriteria].join(" ").toLowerCase()
  if (requestModel.artifactFamily === "prompt_for_coding_tool") return "Return only the updated coding prompt."
  if (requestModel.artifactFamily === "bug_fix" || requestModel.artifactFamily === "code_change") {
    return "Return only the updated answer, including the exact fix and validation details."
  }
  if (/\btable\b/.test(outputText)) return "Return only the updated answer in the requested table format."
  if (/\binstructions?\b|\bstep-by-step\b/.test(outputText)) return "Return only the updated answer in the requested format."
  return "Return only the updated answer."
}
