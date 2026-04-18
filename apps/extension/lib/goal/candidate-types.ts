export type GoalCandidateSourceField =
  | "task_goal"
  | "key_requirements"
  | "constraints"
  | "required_inputs"
  | "output_format"
  | "quality_bar"
  | "answers"

export type GoalCandidateSlot =
  | "servings"
  | "time"
  | "calories"
  | "protein"
  | "method"
  | "technology"
  | "output"
  | "exclusion"
  | "diet"
  | "cuisine"
  | "count"
  | "budget"
  | "storage"
  | "platform"
  | "scope"
  | "generic"
  | "output_requirement"

export type GoalCandidate = {
  sourceField: GoalCandidateSourceField
  sourceText: string
  matchedText: string
  slot: GoalCandidateSlot
  value: unknown
  confidence: "high" | "medium" | "low"
  extractor: string
}

export type GoalCandidateValidation = {
  candidate: GoalCandidate
  kept: boolean
  reason: string
}
