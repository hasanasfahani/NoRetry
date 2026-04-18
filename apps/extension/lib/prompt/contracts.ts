import type { GoalContract } from "../goal/types"

export type PromptRenderSection = {
  title: string
  items: string[]
}

export type PromptContract = {
  goalContract: GoalContract
  sections: PromptRenderSection[]
  renderedPrompt: string
}

export type PromptRenderPlan = {
  contract: GoalContract
  sections: PromptRenderSection[]
}
