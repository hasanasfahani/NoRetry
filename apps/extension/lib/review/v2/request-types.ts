export type ReviewPromptModeV2RequestType =
  | "creation"
  | "modification"
  | "problem_solving"
  | "product_thinking"
  | "shipping"
  | "prompt_optimization"

export type ReviewPromptModeV2TemplateKind = "creation" | "modification" | "problem_solving"

export type ReviewPromptModeV2IntentConfidence = "high" | "medium" | "low"

export type ReviewPromptModeV2TaskTypeChip = {
  type: ReviewPromptModeV2RequestType
  label: string
  suggested: boolean
  reason: string
}

export const REVIEW_PROMPT_MODE_V2_TYPE_LABELS: Record<ReviewPromptModeV2RequestType, string> = {
  creation: "Creation",
  modification: "Modification",
  problem_solving: "Problem-solving",
  product_thinking: "Product thinking",
  shipping: "Shipping",
  prompt_optimization: "Prompt optimization"
}

export function resolvePromptModeV2TemplateKind(
  taskType: ReviewPromptModeV2RequestType | null | undefined
): ReviewPromptModeV2TemplateKind {
  switch (taskType) {
    case "modification":
      return "modification"
    case "problem_solving":
      return "problem_solving"
    case "creation":
    case "product_thinking":
    case "shipping":
    case "prompt_optimization":
    default:
      return "creation"
  }
}
