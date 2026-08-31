import type { SimpleRequirementCheck, SimpleRequirementConfirmation } from "./simple-next-prompt-decision"

export const SIMPLE_CONFIRMATION_NEXT_STEP_CTA = "After confirming, suggest what the next step should be."

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function uniqueMissingConfirmations(missingConfirmation: SimpleRequirementConfirmation[]) {
  const seen = new Set<string>()
  const unique: SimpleRequirementConfirmation[] = []

  for (const item of missingConfirmation) {
    const key = normalize(item.text).toLowerCase()
    if (!key || seen.has(key)) {
      continue
    }

    seen.add(key)
    unique.push(item)
  }

  return unique
}

export function buildSimpleConfirmationPrompt(input: { requirementCheck: SimpleRequirementCheck }) {
  const missingConfirmation = uniqueMissingConfirmations(input.requirementCheck.missingConfirmation)

  if (!missingConfirmation.length) {
    return null
  }

  return [
    "Before we move forward, confirm these requirements from my last prompt:",
    "",
    ...missingConfirmation.map((item) => `- ${normalize(item.text)}`),
    "",
    "For each one, answer:",
    "- Completed, with evidence",
    "- Not completed yet, with what remains",
    "",
    "Do not add new scope yet.",
    "",
    SIMPLE_CONFIRMATION_NEXT_STEP_CTA
  ].join("\n")
}
