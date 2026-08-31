export const SIMPLE_NEXT_PROMPT_DECISION_VERSION = "simple-next-prompt-decision.v1"

export type SimpleRequirementConfirmationStatus = "confirmed" | "needs_confirmation"

export type SimpleRequirementSource = "submitted_prompt" | "project_memory" | "assistant_answer"

export type SimpleRequirementCategory =
  | "task_goal"
  | "required_output"
  | "scope_boundary"
  | "format"
  | "confirmation"
  | "next_step_request"

export type SimplePromptRequirement = {
  id: string
  text: string
  category: SimpleRequirementCategory
  source: "submitted_prompt"
  confirmationNeeded: true
  evidence: string[]
}

export type SimpleRequirementExtraction = {
  version: typeof SIMPLE_NEXT_PROMPT_DECISION_VERSION
  requirements: SimplePromptRequirement[]
  confidence: "high" | "medium" | "low"
  notes: string[]
}

export type SimpleRequirementConfirmation = {
  id: string
  text: string
  category: SimpleRequirementCategory
  source: SimpleRequirementSource
  status: SimpleRequirementConfirmationStatus
  evidence: string[]
}

export type SimpleRequirementCheck = {
  status: "pass" | "needs_confirmation"
  confirmed: SimpleRequirementConfirmation[]
  missingConfirmation: SimpleRequirementConfirmation[]
}

export type SimpleAssistantSuggestedNextMove = {
  rawText: string
  normalizedText: string
  confidence: "high" | "medium" | "low"
}

export type SimpleNextPromptDecisionStatus = "needs_confirmation" | "ready_for_next_prompt"

export type SimpleGeneratedPromptPolicy = {
  askAssistantToSuggestNextStep: true
  hideInternalReasoning: true
}

export type SimpleNextPromptDecision = {
  version: typeof SIMPLE_NEXT_PROMPT_DECISION_VERSION
  status: SimpleNextPromptDecisionStatus
  requirementCheck: SimpleRequirementCheck
  assistantSuggestedNextMove: SimpleAssistantSuggestedNextMove | null
  optimizedPrompt: string
  promptPolicy: SimpleGeneratedPromptPolicy
}
