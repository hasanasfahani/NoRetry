export type DetectedAnalysisInputSize = "normal" | "large"
export type DetectedAnalysisMode = "standard" | "large_input_checkpoint"

export type DetectedLargeAnalysisInputSignal =
  | "long_prompt"
  | "prd_sections"
  | "multiple_implementation_phases"
  | "acceptance_criteria"
  | "validation_proof"
  | "phase_handoff"

export type AnalysisInputAssessment = {
  analysisInputSize: DetectedAnalysisInputSize
  analysisMode: DetectedAnalysisMode
  signals: DetectedLargeAnalysisInputSignal[]
  metrics: {
    characterCount: number
    prdSectionCount: number
    implementationPhaseCount: number
  }
}

const PRD_SECTION_PATTERNS = [
  /\bproduct overview\b/i,
  /\bproblem\b/i,
  /\btarget user\b/i,
  /\bprimary goal\b/i,
  /\bscope\b/i,
  /\bcore requirements\b/i,
  /\bnon-goals?\b/i,
  /\bconstraints\b/i,
  /\bsuccess criteria\b/i,
  /\bimplementation phases\b/i,
  /\bassumptions?\s*\/?\s*risks?\b/i
]

function countMatches(patterns: RegExp[], value: string) {
  return patterns.reduce((count, pattern) => count + (pattern.test(value) ? 1 : 0), 0)
}

function countImplementationPhases(value: string) {
  const matches = value.match(/\bphase\s+\d+\b|^[ \t]*[-*]\s+phase\b|^[ \t]*[A-Z][^\n:]{2,80}:\s+(?:Validate|Drive|Increase|Build|Create|Implement)\b/gim)
  return matches?.length ?? 0
}

export function assessAnalysisInput(promptText: string): AnalysisInputAssessment {
  const prompt = promptText.trim()
  const characterCount = prompt.length
  const prdSectionCount = countMatches(PRD_SECTION_PATTERNS, prompt)
  const implementationPhaseCount = countImplementationPhases(prompt)
  const signals: DetectedLargeAnalysisInputSignal[] = []

  if (characterCount >= 6000) signals.push("long_prompt")
  if (prdSectionCount >= 5) signals.push("prd_sections")
  if (implementationPhaseCount >= 2) signals.push("multiple_implementation_phases")
  if (/\bacceptance criteria\b/i.test(prompt)) signals.push("acceptance_criteria")
  if (/\bvalidation proof expected\b|\bvalidation proof\b/i.test(prompt)) signals.push("validation_proof")
  if (/\bone phase at a time\b|\bdo not start phase\s+\d+\b|\bwait for (?:the )?user'?s? confirmation\b|\bwait for my confirmation\b/i.test(prompt)) {
    signals.push("phase_handoff")
  }

  const isLarge =
    characterCount >= 6000 ||
    (characterCount >= 3000 && signals.length >= 3) ||
    (prdSectionCount >= 6 && implementationPhaseCount >= 2)

  return {
    analysisInputSize: isLarge ? "large" : "normal",
    analysisMode: isLarge ? "large_input_checkpoint" : "standard",
    signals,
    metrics: {
      characterCount,
      prdSectionCount,
      implementationPhaseCount
    }
  }
}
