import type { GoalContract, GoalConstraint, GoalPreference } from "../goal/types"
import type { PromptRenderPlan, PromptRenderSection } from "./contracts"

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeSentence(value: string) {
  const trimmed = normalizeText(value)
  if (!trimmed) return ""
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

function dedupeStrings(values: string[]) {
  const seen = new Set<string>()
  const output: string[] = []
  for (const value of values.map(normalizeSentence).filter(Boolean)) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(value)
  }
  return output
}

function stripEmbeddedAcceptanceTail(value: string) {
  return value
    .replace(/\s+(?:Success|Success criteria|Acceptance criteria)\s*:\s*[\s\S]*$/i, "")
    .trim()
}

function renderConstraint(constraint: GoalConstraint) {
  switch (constraint.type) {
    case "exclusion":
      if (/\b(?:dairy|gluten|soy|nut|egg)\b/i.test(constraint.label)) {
        return normalizeSentence(`Keep it ${constraint.label.toLowerCase()}-free`)
      }
      return normalizeSentence(`Do not use ${constraint.label.toLowerCase()}`)
    case "servings":
    case "time":
    case "calories":
    case "protein":
    case "method":
    case "technology":
    case "output":
    case "diet":
    case "cuisine":
    case "count":
    case "budget":
    case "storage":
    case "platform":
    case "scope":
    case "generic":
    default:
      return normalizeSentence(constraint.label)
  }
}

function renderPreference(preference: GoalPreference) {
  return normalizeSentence(preference.value ? `${preference.label}: ${preference.value}` : preference.label)
}

function looksTechnicalPrompt(contract: GoalContract) {
  const combined = [
    contract.userGoal,
    contract.deliverableType ?? "",
    ...contract.hardConstraints.map((item) => item.label),
    ...contract.outputRequirements
  ]
    .join(" ")
    .toLowerCase()

  return /\b(replit|agent|code|coding|repo|repository|component|route|screen|api|database|schema|auth|frontend|backend|ui|ux|html|css|javascript|typescript|react|next|node|registration|form|dropdown|submit)\b/.test(
    combined
  )
}

export function buildPromptRenderSections(
  contract: GoalContract,
  options?: {
    acceptanceCriteria?: string[]
  }
): PromptRenderSection[] {
  const technicalPrompt = looksTechnicalPrompt(contract)
  const acceptanceCriteria = technicalPrompt ? dedupeStrings(options?.acceptanceCriteria ?? []) : []
  const taskGoal = acceptanceCriteria.length
    ? stripEmbeddedAcceptanceTail(normalizeSentence(contract.userGoal))
    : normalizeSentence(contract.userGoal)
  const keyRequirements = dedupeStrings([
    ...(contract.deliverableType === "html_file" ? ["Return the result as a full HTML file"] : []),
    ...contract.hardConstraints
      .filter((item) => item.type === "technology")
      .map(renderConstraint),
    ...contract.softPreferences
      .filter((item) => !/professional tone|polished|concise|friendly|clean|practical/i.test(item.label))
      .map(renderPreference),
    ...contract.hardConstraints
      .filter((item) => ["diet", "cuisine", "budget", "storage"].includes(item.type))
      .map(renderConstraint)
  ])

  const constraints = dedupeStrings(
    contract.hardConstraints
      .filter((item) => !["diet", "cuisine", "budget", "storage"].includes(item.type))
      .map(renderConstraint)
  )

  const requiredInputs = dedupeStrings(contract.assumptions)

  const outputFormat = dedupeStrings(contract.outputRequirements)

  const style = dedupeStrings(
    contract.softPreferences
      .filter((item) => /professional tone|polished|concise|friendly|clean|practical/i.test(item.label))
      .map(renderPreference)
  )

  const sections: PromptRenderSection[] = [
    {
      title: "Task / goal",
      items: [taskGoal]
    },
    {
      title: "Key requirements",
      items: keyRequirements
    },
    {
      title: "Constraints",
      items: constraints
    },
    {
      title: technicalPrompt ? "Implementation guardrails" : "Required inputs or ingredients",
      items: requiredInputs
    },
    {
      title: "Acceptance criteria",
      items: acceptanceCriteria
    },
    {
      title: technicalPrompt ? "Response expectations" : "Output format",
      items: outputFormat
    },
    {
      title: "Quality bar / style guardrails",
      items: style
    }
  ]

  return sections.filter((section) => section.items.length)
}

export function buildPromptRenderPlan(
  contract: GoalContract,
  options?: {
    acceptanceCriteria?: string[]
  }
): PromptRenderPlan {
  return {
    contract,
    sections: buildPromptRenderSections(contract, options)
  }
}
