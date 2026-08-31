import {
  SIMPLE_NEXT_PROMPT_DECISION_VERSION,
  type SimpleNextPromptDecision
} from "./simple-next-prompt-decision"
import { buildSimpleConfirmationPrompt } from "./simple-confirmation-prompt"
import { buildSimpleNextStepPrompt, extractSimpleAssistantSuggestedNextMove } from "./simple-next-step-prompt"
import { checkSimpleRequirementConfirmations } from "./simple-requirement-confirmation"
import { extractSimplePromptRequirements } from "./simple-requirement-extractor"

export function buildSimpleNextPromptDecision(input: {
  promptText: string
  responseText: string
}): SimpleNextPromptDecision | null {
  const extraction = extractSimplePromptRequirements(input.promptText)
  if (!extraction.requirements.length) {
    return null
  }

  const requirementCheck = checkSimpleRequirementConfirmations({
    requirements: extraction.requirements,
    responseText: input.responseText
  })
  const assistantSuggestedNextMove = extractSimpleAssistantSuggestedNextMove(input.responseText)
  const optimizedPrompt =
    requirementCheck.status === "needs_confirmation"
      ? buildSimpleConfirmationPrompt({ requirementCheck }) ?? ""
      : buildSimpleNextStepPrompt({
          requirementCheck,
          promptText: input.promptText,
          responseText: input.responseText,
          suggestedNextMove: assistantSuggestedNextMove
        }) ?? ""

  return {
    version: SIMPLE_NEXT_PROMPT_DECISION_VERSION,
    status: requirementCheck.status === "needs_confirmation" ? "needs_confirmation" : "ready_for_next_prompt",
    requirementCheck,
    assistantSuggestedNextMove,
    optimizedPrompt,
    promptPolicy: {
      askAssistantToSuggestNextStep: true,
      hideInternalReasoning: true
    }
  }
}
