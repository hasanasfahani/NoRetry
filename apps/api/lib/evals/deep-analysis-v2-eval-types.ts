import type {
  DeepAnalysisV2NextStepSource,
  DeepAnalysisV2OverallStatus,
  DeepAnalysisV2PromptIntent
} from "@prompt-optimizer/shared/src/deep-analysis-v2"

export type DeepAnalysisV2EvalCategory =
  | "requirement_match"
  | "needs_confirmation"
  | "next_prompt"
  | "prompt_intent"
  | "scope_guard"
  | "regression"

export type DeepAnalysisV2EvalExpectation = {
  overallStatus: DeepAnalysisV2OverallStatus
  missingRequirementIncludes?: string[]
  missingRequirementExcludes?: string[]
  generatedPromptIncludes?: string[]
  generatedPromptExcludes?: string[]
  generatedPromptEndsWith?: string
  assistantSuggestedNextMoveIncludes?: string[]
  recommendedNextMoveIncludes?: string[]
  nextStepSource?: DeepAnalysisV2NextStepSource
  promptIntent?: DeepAnalysisV2PromptIntent
  nextStepRequirementsInclude?: string[]
  blockedScopeIncludes?: string[]
  provider?: "kimi" | "deepseek" | "fallback" | "none"
}

export type DeepAnalysisV2EvalCase = {
  id: string
  title: string
  category: DeepAnalysisV2EvalCategory
  input: {
    promptText: string
    responseText: string
    projectContext?: string
    currentState?: string
    taskType?: string
    surface?: "chatgpt" | "replit" | "lovable" | "unknown"
  }
  expected: DeepAnalysisV2EvalExpectation
  rubric: {
    must: string[]
    rejectIf?: string[]
  }
  notes?: string
}
