export type GoalConstraintValue =
  | string
  | number
  | {
      min?: number
      max?: number
      exact?: number
      unit?: string
    }

export type GoalConstraintType =
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

export type GoalConstraint = {
  id: string
  label: string
  type: GoalConstraintType
  value?: GoalConstraintValue
  source: "goal" | "structured" | "answers" | "constraints" | "output" | "heuristic"
  sourceField?: string
  matchedText?: string
  extractor?: string
  keptReason?: string
}

export type GoalPreference = {
  id: string
  label: string
  value?: string
  source: "goal" | "structured" | "answers" | "style" | "heuristic"
}

export type GoalContract = {
  taskFamily: string
  userGoal: string
  deliverableType?: string
  hardConstraints: GoalConstraint[]
  softPreferences: GoalPreference[]
  outputRequirements: string[]
  verificationExpectations: string[]
  assumptions: string[]
  riskFlags: string[]
  normalizationTrace?: unknown
}

export type GoalContractInput = {
  promptText: string
  taskFamily?: string
  answeredPath?: string[]
  constraints?: string[]
}
