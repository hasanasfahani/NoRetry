import type { GoalContract } from "../goal/types"
import type { PromptContract } from "./contracts"
import { buildPromptRenderPlan } from "./prompt-sections"

function renderSection(title: string, items: string[]) {
  if (!items.length) return ""
  if (title === "Task / goal" && items.length === 1) {
    return `${title}:\n${items[0]}`
  }

  return `${title}:\n${items.map((item) => `- ${item}`).join("\n")}`
}

export function buildPromptContractFromGoalContract(contract: GoalContract): PromptContract {
  const plan = buildPromptRenderPlan(contract)
  return {
    goalContract: contract,
    sections: plan.sections,
    renderedPrompt: plan.sections.map((section) => renderSection(section.title, section.items)).filter(Boolean).join("\n\n")
  }
}

export function renderPromptFromGoalContract(contract: GoalContract) {
  return buildPromptContractFromGoalContract(contract).renderedPrompt
}
