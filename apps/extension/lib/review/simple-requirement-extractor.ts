import {
  SIMPLE_NEXT_PROMPT_DECISION_VERSION,
  type SimplePromptRequirement,
  type SimpleRequirementCategory,
  type SimpleRequirementExtraction
} from "./simple-next-prompt-decision"

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function slugify(value: string) {
  return normalize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "requirement"
}

function evidenceSnippet(promptText: string, match: RegExpMatchArray | null, fallback: string) {
  if (!match?.[0]) return fallback
  const index = match.index ?? promptText.indexOf(match[0])
  if (index < 0) return normalize(match[0])

  const start = Math.max(0, index - 24)
  const end = Math.min(promptText.length, index + match[0].length + 24)
  return normalize(promptText.slice(start, end))
}

function makeRequirement(input: {
  key: string
  text: string
  category: SimpleRequirementCategory
  evidence: string
}): SimplePromptRequirement {
  return {
    id: `${input.category}_${slugify(input.key)}`,
    text: normalize(input.text),
    category: input.category,
    source: "submitted_prompt",
    confirmationNeeded: true,
    evidence: [normalize(input.evidence)].filter(Boolean)
  }
}

function pushUnique(requirements: SimplePromptRequirement[], requirement: SimplePromptRequirement) {
  const normalizedText = requirement.text.toLowerCase()
  if (requirements.some((item) => item.text.toLowerCase() === normalizedText || item.id === requirement.id)) return
  requirements.push(requirement)
}

function extractPhaseGoal(promptText: string, requirements: SimplePromptRequirement[]) {
  const phaseGoalMatch = promptText.match(/\bphase\s+(\d+)\s+goal\s*:\s*([^.\n]+)/i)
  if (phaseGoalMatch?.[1] && phaseGoalMatch[2]) {
    const phaseNumber = phaseGoalMatch[1]
    const goal = normalize(phaseGoalMatch[2])
    pushUnique(
      requirements,
      makeRequirement({
        key: `phase_${phaseNumber}_${goal}`,
        text: `Complete Phase ${phaseNumber}: ${goal}.`,
        category: "task_goal",
        evidence: evidenceSnippet(promptText, phaseGoalMatch, phaseGoalMatch[0])
      })
    )
  }

  const phaseShouldIncludeMatch = promptText.match(/\bphase\s+(\d+)\s+should\s+include\s+([^.\n]+)/i)
  if (phaseShouldIncludeMatch?.[1] && phaseShouldIncludeMatch[2]) {
    const phaseNumber = phaseShouldIncludeMatch[1]
    const goal = normalize(phaseShouldIncludeMatch[2])
    pushUnique(
      requirements,
      makeRequirement({
        key: `phase_${phaseNumber}_should_include_${goal}`,
        text: `Complete Phase ${phaseNumber}: include ${goal}.`,
        category: "task_goal",
        evidence: evidenceSnippet(promptText, phaseShouldIncludeMatch, phaseShouldIncludeMatch[0])
      })
    )
  }

  const uiOnlyMatch = promptText.match(/\b(?:ui only|form ui only|booking form ui only|visual form)\b/i)
  if (uiOnlyMatch) {
    pushUnique(
      requirements,
      makeRequirement({
        key: "ui_only_scope",
        text: "Keep this step scoped to UI only.",
        category: "scope_boundary",
        evidence: evidenceSnippet(promptText, uiOnlyMatch, uiOnlyMatch[0])
      })
    )
  }
}

function extractOutputFormatRequirements(promptText: string, requirements: SimplePromptRequirement[]) {
  const briefMatch = promptText.match(/\breply very briefly\b|\bbrief(?:ly)?\b/i)
  if (briefMatch) {
    pushUnique(
      requirements,
      makeRequirement({
        key: "brief_response",
        text: "Reply briefly.",
        category: "format",
        evidence: evidenceSnippet(promptText, briefMatch, briefMatch[0])
      })
    )
  }

  const noCodeMatch = promptText.match(/\bdo not include code\b|\bno code\b/i)
  if (noCodeMatch) {
    pushUnique(
      requirements,
      makeRequirement({
        key: "no_code",
        text: "Do not include code.",
        category: "format",
        evidence: evidenceSnippet(promptText, noCodeMatch, noCodeMatch[0])
      })
    )
  }

  const codingAgentMatch = promptText.match(/\bact like\s+([^.\n]+coding agent)\b/i)
  if (codingAgentMatch?.[1]) {
    pushUnique(
      requirements,
      makeRequirement({
        key: "coding_agent_style",
        text: `Respond like ${normalize(codingAgentMatch[1])}.`,
        category: "format",
        evidence: evidenceSnippet(promptText, codingAgentMatch, codingAgentMatch[0])
      })
    )
  }
}

function extractConfirmationRequirements(promptText: string, requirements: SimplePromptRequirement[]) {
  const phaseCodeMatch = promptText.match(/\b(?:write|provide|generate|include)\s+(?:the\s+)?code\s+for\s+phase\s+(\d+)\b/i)
  if (phaseCodeMatch?.[1]) {
    pushUnique(
      requirements,
      makeRequirement({
        key: `provide_phase_${phaseCodeMatch[1]}_code`,
        text: `Provide code for Phase ${phaseCodeMatch[1]}.`,
        category: "required_output",
        evidence: evidenceSnippet(promptText, phaseCodeMatch, phaseCodeMatch[0])
      })
    )
  }

  const changedMatch = promptText.match(/\bsay what you changed\b|\btell me what you changed\b/i)
  if (changedMatch) {
    pushUnique(
      requirements,
      makeRequirement({
        key: "say_what_changed",
        text: "Say what changed.",
        category: "required_output",
        evidence: evidenceSnippet(promptText, changedMatch, changedMatch[0])
      })
    )
  }

  const phaseCompleteMatch = promptText.match(/\bconfirm\s+phase\s+(\d+)\s+is\s+(?:done|complete|completed)\b/i)
  if (phaseCompleteMatch?.[1]) {
    pushUnique(
      requirements,
      makeRequirement({
        key: `confirm_phase_${phaseCompleteMatch[1]}_complete`,
        text: `Confirm Phase ${phaseCompleteMatch[1]} is complete.`,
        category: "confirmation",
        evidence: evidenceSnippet(promptText, phaseCompleteMatch, phaseCompleteMatch[0])
      })
    )
  }

  const nextPhaseMatch = promptText.match(/\b(?:tell me|suggest|say)\s+(?:what\s+)?(?:the\s+)?next\s+(?:phase|step)\b/i)
  if (nextPhaseMatch) {
    pushUnique(
      requirements,
      makeRequirement({
        key: "suggest_next_step",
        text: "Suggest the next step.",
        category: "next_step_request",
        evidence: evidenceSnippet(promptText, nextPhaseMatch, nextPhaseMatch[0])
      })
    )
  }
}

function extractScopeBoundaries(promptText: string, requirements: SimplePromptRequirement[]) {
  const boundaries = [
    { pattern: /\bno backend\b|\bdo not connect (?:a )?backend\b/i, text: "Do not connect a backend yet.", key: "no_backend" },
    { pattern: /\bno saving\b|\bdo not save\b/i, text: "Do not add saving yet.", key: "no_saving" },
    { pattern: /\bno payment\b|\bno payments\b|\bdo not add payment\b/i, text: "Do not add payment yet.", key: "no_payment" }
  ]

  for (const boundary of boundaries) {
    const match = promptText.match(boundary.pattern)
    if (!match) continue
    pushUnique(
      requirements,
      makeRequirement({
        key: boundary.key,
        text: boundary.text,
        category: "scope_boundary",
        evidence: evidenceSnippet(promptText, match, match[0])
      })
    )
  }
}

export function extractSimplePromptRequirements(promptText: string): SimpleRequirementExtraction {
  const normalizedPrompt = normalize(promptText)
  const requirements: SimplePromptRequirement[] = []

  extractPhaseGoal(promptText, requirements)
  extractOutputFormatRequirements(promptText, requirements)
  extractConfirmationRequirements(promptText, requirements)
  extractScopeBoundaries(promptText, requirements)

  const confidence =
    requirements.length >= 4
      ? "high"
      : requirements.length >= 2
        ? "medium"
        : "low"

  const notes =
    requirements.length > 0
      ? [`Extracted ${requirements.length} explicit prompt requirement${requirements.length === 1 ? "" : "s"}.`]
      : ["No explicit confirmable requirements were found in the submitted prompt."]

  return {
    version: SIMPLE_NEXT_PROMPT_DECISION_VERSION,
    requirements,
    confidence,
    notes: normalizedPrompt ? notes : ["Prompt is empty."]
  }
}
