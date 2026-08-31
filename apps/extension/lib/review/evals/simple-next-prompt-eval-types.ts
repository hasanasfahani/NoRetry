import type { SimpleNextPromptDecisionStatus } from "../simple-next-prompt-decision"

export type SimpleNextPromptEvalCategory =
  | "requirement_match"
  | "needs_confirmation"
  | "next_prompt"
  | "scope_guard"
  | "regression"

export type SimpleNextPromptEvalExpectation = {
  status: SimpleNextPromptDecisionStatus
  requirementStatus: "pass" | "needs_confirmation"
  missingIncludes?: string[]
  missingExcludes?: string[]
  promptIncludes?: string[]
  promptExcludes?: string[]
  promptEndsWith?: string
  suggestedNextMoveIncludes?: string[]
}

export type SimpleNextPromptEvalCase = {
  id: string
  title: string
  category: SimpleNextPromptEvalCategory
  input: {
    promptText: string
    responseText: string
  }
  expected: SimpleNextPromptEvalExpectation
  rubric: {
    must: string[]
    rejectIf?: string[]
  }
  notes?: string
}
