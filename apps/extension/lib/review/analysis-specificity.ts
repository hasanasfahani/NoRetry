import type { AnalysisPromptContract } from "./analysis-prompt-section"
import type { AnalysisSemanticRequirement } from "./analysis-semantics"

export type AnalysisRequestSpecificity = {
  score: number
  band: "low" | "medium" | "high"
  broadPromptLikely: boolean
  literalRequestFirst: boolean
  structuredRequest: boolean
  explicitProofRequested: boolean
  explicitVerificationRequested: boolean
  explicitExactnessRequested: boolean
  explicitFileScopeRequested: boolean
  explicitChangeScopeRequested: boolean
  explicitOutputFormatRequested: boolean
  explicitConstraintBurden: boolean
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function countMatches(text: string, patterns: RegExp[]) {
  return patterns.reduce((count, pattern) => (pattern.test(text) ? count + 1 : count), 0)
}

export function buildAnalysisRequestSpecificity(input: {
  promptText: string
  promptContract: AnalysisPromptContract
  semanticRequirements: AnalysisSemanticRequirement[]
}) {
  const promptText = normalize(input.promptText)
  const { promptContract, semanticRequirements } = input

  const requirementCount =
    promptContract.requirements.length +
    promptContract.constraints.length +
    promptContract.acceptanceCriteria.length +
    promptContract.actualOutputToEvaluate.length
  const structuredRequest =
    promptContract.taskGoal.length > 0 ||
    requirementCount > 0

  const explicitProofRequested = /\bproof\b|\bprove\b|\bshow (?:that )?it works\b|\bwhy it works\b/.test(promptText)
  const explicitVerificationRequested =
    explicitProofRequested ||
    /\bverify\b|\bverification\b|\btest steps\b|\bsmoke\b|\bregression\b|\bvalidation\b/.test(promptText)
  const explicitExactnessRequested =
    /\bexact\b|\bexactly\b|\bline[-\s]?by[-\s]?line\b|\bverbatim\b|\bprecise\b|\bitemized\b/.test(promptText)
  const explicitFileScopeRequested =
    /\bfile\b|\bfiles\b|\bpath\b|\bpaths\b|\bline\b|\blines\b|\bdiff\b|\bpatch\b/.test(promptText)
  const explicitChangeScopeRequested =
    /\bonly change\b|\bdo not change\b|\bpreserve\b|\bunrelated\b|\bscope\b/.test(promptText)
  const explicitOutputFormatRequested =
    promptContract.actualOutputToEvaluate.length > 0 ||
    /\boutput format\b|\breturn only\b|\bjson\b|\btable\b|\bbullets?\b|\blist\b|\bsubject\b/.test(promptText)
  const explicitConstraintBurden =
    semanticRequirements.length >= 3 ||
    promptContract.constraints.length >= 2 ||
    countMatches(promptText, [/\bunder \d+\s+words?\b/, /\bwithin\b/, /\bmust\b/, /\bdo not\b/, /\bonly\b/]) >= 2

  let score = 0
  score += Math.min(requirementCount * 10, 40)
  score += Math.min(semanticRequirements.length * 6, 24)
  score += explicitVerificationRequested ? 12 : 0
  score += explicitExactnessRequested ? 10 : 0
  score += explicitFileScopeRequested ? 8 : 0
  score += explicitChangeScopeRequested ? 8 : 0
  score += explicitOutputFormatRequested ? 8 : 0
  score += explicitConstraintBurden ? 8 : 0
  score += structuredRequest ? 6 : 0

  const band = score >= 60 ? "high" : score >= 28 ? "medium" : "low"
  const broadPromptLikely =
    band === "low" &&
    !explicitVerificationRequested &&
    !explicitExactnessRequested &&
    !explicitFileScopeRequested &&
    !explicitChangeScopeRequested

  return {
    score,
    band,
    broadPromptLikely,
    literalRequestFirst: broadPromptLikely || band === "medium",
    structuredRequest,
    explicitProofRequested,
    explicitVerificationRequested,
    explicitExactnessRequested,
    explicitFileScopeRequested,
    explicitChangeScopeRequested,
    explicitOutputFormatRequested,
    explicitConstraintBurden
  } satisfies AnalysisRequestSpecificity
}
