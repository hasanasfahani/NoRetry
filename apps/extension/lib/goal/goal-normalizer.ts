import { createGoalContract } from "./goal-contract"
import type { GoalConstraint, GoalContract, GoalContractInput, GoalPreference } from "./types"
import { extractGoalCandidatesFromEntry, looksLikeFreeformSignal } from "./candidate-extractors"
import { validateGoalCandidates } from "./candidate-validator"
import type { GoalCandidateSourceField } from "./candidate-types"
import { resolveCanonicalCandidates } from "./canonical-resolver"
import { createEmptyNormalizationTrace } from "./normalization-trace"
import { sanitizeAssumption, sanitizeGoalContract, sanitizeOutputRequirement, sanitizePreferenceLabel, sanitizeConstraintLabel } from "../review/sanitizers"

const SECTION_HEADINGS = [
  "Task / goal",
  "Key requirements",
  "Constraints",
  "Required inputs or ingredients",
  "Output format",
  "Quality bar / style guardrails"
] as const

const GENERIC_ASSUMPTION_PATTERNS = [
  /\bassume a normal home kitchen unless the prompt says otherwise\b/i
]

const GENERIC_STYLE_PATTERNS = [
  /\bkeep the request clear, specific, and easy for the ai assistant to follow\b/i,
  /\breturn something directly usable as a strong first draft\b/i
]

type StructuredSections = Partial<Record<(typeof SECTION_HEADINGS)[number], string[]>>

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function stripTrailingPunctuation(value: string) {
  return normalizeText(value).replace(/[.:;\s]+$/, "")
}

function createId(prefix: string, value: string) {
  return `${prefix}:${normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
}

function splitSectionItems(body: string) {
  return body
    .split("\n")
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean)
}

function extractStructuredSections(promptText: string): StructuredSections {
  const sections: StructuredSections = {}
  const headingPattern = new RegExp(`^(${SECTION_HEADINGS.map((heading) => heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}):\\s*$`, "gim")
  const matches = Array.from(promptText.matchAll(headingPattern))
  if (!matches.length) return sections

  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index]
    const next = matches[index + 1]
    const heading = current[1] as (typeof SECTION_HEADINGS)[number]
    const start = current.index! + current[0].length
    const end = next?.index ?? promptText.length
    const body = promptText.slice(start, end).trim()
    sections[heading] = splitSectionItems(body)
  }

  return sections
}

function inferTaskFamily(promptText: string, suppliedTaskFamily?: string) {
  if (suppliedTaskFamily) return suppliedTaskFamily
  const normalized = promptText.toLowerCase()
  if (/\brewrite\b|\brephrase\b|\bpolish\b/.test(normalized)) return "writing"
  if (/\brecipe\b|\blunch\b|\bdinner\b|\bmeal\b/.test(normalized)) return "creation"
  if (/\bhtml\b|\bcss\b|\bjavascript\b|\bwebsite\b|\bcomponent\b/.test(normalized)) return "creation"
  if (/\bprompt\b/.test(normalized)) return "creation"
  if (/\brecommend\b|\bsuggest\b|\bproduct\b/.test(normalized)) return "advice"
  if (/\bexplain\b|\bhow to\b|\binstructions?\b/.test(normalized)) return "instructional"
  return "other"
}

function inferDeliverableType(promptText: string) {
  const normalized = promptText.toLowerCase()
  if (/\brecipe\b|\blunch\b|\bdinner\b|\bmeal\b/.test(normalized)) return "recipe"
  if (/\bfull html file\b|\bhtml\b/.test(normalized)) return "html_file"
  if (/\brewrite\b|\brephrase\b|\bpolish\b/.test(normalized)) return "rewrite"
  if (/\bprompt\b/.test(normalized)) return "prompt"
  if (/\bresearch\b|\banalysis\b|\breport\b/.test(normalized)) return "research"
  if (/\brecommend\b|\bsuggest\b|\bproduct\b/.test(normalized)) return "recommendation"
  return undefined
}

function buildConstraint(type: GoalConstraint["type"], label: string, source: GoalConstraint["source"], value?: GoalConstraint["value"]): GoalConstraint | null {
  const cleaned = sanitizeConstraintLabel(stripTrailingPunctuation(label))
  if (!cleaned) return null
  if (/^(?:\d+|yes|no|none|non)$/i.test(cleaned)) return null
  return {
    id: createId(type, cleaned),
    label: cleaned,
    type,
    value,
    source
  }
}

function buildPreference(label: string, source: GoalPreference["source"], value?: string): GoalPreference | null {
  const cleaned = sanitizePreferenceLabel(stripTrailingPunctuation(label))
  if (!cleaned) return null
  if (GENERIC_STYLE_PATTERNS.some((pattern) => pattern.test(cleaned))) return null
  return {
    id: createId("preference", `${cleaned}:${value ?? ""}`),
    label: cleaned,
    value: value ? sanitizePreferenceLabel(stripTrailingPunctuation(value)) || undefined : undefined,
    source
  }
}

function inferImplicitSignals(promptText: string, hardConstraints: GoalConstraint[], softPreferences: GoalPreference[], outputRequirements: string[]) {
  const normalized = promptText.toLowerCase()
  const hasOutputRequirement = (pattern: RegExp) => outputRequirements.some((item) => pattern.test(item))

  if (/\bingredients?\b/i.test(promptText) && !hasOutputRequirement(/\bingredients?\b/i)) outputRequirements.push("Include ingredients with quantities")
  if ((/\bstep[-\s]?by[-\s]?step\b|\binstructions?\b/i.test(promptText)) && !hasOutputRequirement(/\bstep[-\s]?by[-\s]?step\b|\binstructions?\b/i)) outputRequirements.push("Include step-by-step instructions")
  if ((/\bmacros?\b|\bmacro breakdown\b/i.test(promptText)) && !hasOutputRequirement(/\bmacro/i)) outputRequirements.push("Include macros per serving")
  if ((/\bcalories?\b|\bkcal\b/i.test(promptText)) && !hasOutputRequirement(/\bcalories?\b|\bkcal\b/i)) outputRequirements.push("Include calories per serving")
  if ((/\b(?:full|complete|ready-to-save)\s+html file\b/i.test(promptText) || /\bready-to-save\b/i.test(promptText) && /\bhtml\b/i.test(promptText)) && !hasOutputRequirement(/\bfull html file\b/i)) {
    outputRequirements.push("Return the full HTML file")
  }
  if (/\bhtml\b/i.test(promptText) && !/\b(?:full|complete|ready-to-save)\s+html file\b/i.test(promptText) && !hasOutputRequirement(/\bhtml\b/i)) outputRequirements.push("Return HTML output")
  if (/\bcss\b/i.test(promptText) && !hasOutputRequirement(/\bcss\b/i)) outputRequirements.push("Include CSS in the result")

  if (/\bcreamy\b/i.test(normalized)) {
    const preference = buildPreference("Creamy texture", "heuristic", "creamy")
    if (preference) softPreferences.push(preference)
  }

  if (/\bcomfort\b/i.test(normalized)) {
    const preference = buildPreference("Comfort-food feel", "heuristic", "comfort")
    if (preference) softPreferences.push(preference)
  }
}

function extractFreeformEntries(promptText: string) {
  return promptText
    .split(/(?<=[.!?])\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function normalizeGoalContract(input: GoalContractInput): GoalContract {
  const promptText = input.promptText.trim()
  const taskFamily = inferTaskFamily(promptText, input.taskFamily)
  const sections = extractStructuredSections(promptText)
  const taskGoal = sections["Task / goal"]?.join(" ").trim() || promptText

  const hardConstraints: GoalConstraint[] = []
  const softPreferences: GoalPreference[] = []
  const outputRequirements: string[] = []
  const assumptions: string[] = []
  const trace = createEmptyNormalizationTrace()
  const allCandidates: ReturnType<typeof extractGoalCandidatesFromEntry> = []

  const collectEntryCandidates = (entry: string, sourceField: GoalCandidateSourceField) => {
    const normalized = normalizeText(entry)
    if (!normalized) return
    if (GENERIC_ASSUMPTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
      const assumption = sanitizeAssumption(stripTrailingPunctuation(normalized))
      if (assumption) assumptions.push(assumption)
      return
    }
    const extracted = extractGoalCandidatesFromEntry(entry, sourceField)
    trace.extractedCandidates.push(...extracted)
    allCandidates.push(...extracted)
  }

  for (const entry of sections["Key requirements"] ?? []) {
    collectEntryCandidates(entry, "key_requirements")
    const labeledMatch = normalizeText(entry).match(/^([^:]+):\s*(.+)$/)
    const labelText = labeledMatch?.[1]?.toLowerCase() ?? ""
    const valueText = labeledMatch ? labeledMatch[2] : normalizeText(entry)
    const lowerValue = valueText.toLowerCase()
    if (/\bgoal\b|\bpriority\b|\bvibe\b|\btexture preference\b|\btexture\b/i.test(labelText)) {
      const preference = buildPreference(valueText, "structured", stripTrailingPunctuation(valueText))
      if (preference) softPreferences.push(preference)
    }
    if (/\bstay fit\b|\bmuscle gain\b|\bweight loss\b|\bhealthy\b/i.test(lowerValue)) {
      const preference = buildPreference(valueText, "heuristic", stripTrailingPunctuation(valueText))
      if (preference) softPreferences.push(preference)
    }
  }
  for (const entry of sections["Constraints"] ?? []) {
    collectEntryCandidates(entry, "constraints")
  }
  for (const entry of sections["Output format"] ?? []) {
    collectEntryCandidates(entry, "output_format")
  }
  for (const entry of sections["Required inputs or ingredients"] ?? []) {
    collectEntryCandidates(entry, "required_inputs")
  }
  for (const entry of sections["Quality bar / style guardrails"] ?? []) {
    const preference = buildPreference(entry, "style")
    if (preference) softPreferences.push(preference)
  }

  for (const entry of input.answeredPath ?? []) {
    collectEntryCandidates(entry, "answers")
  }
  for (const entry of input.constraints ?? []) {
    collectEntryCandidates(entry, "constraints")
  }
  for (const entry of extractFreeformEntries(taskGoal)) {
    if (!looksLikeFreeformSignal(entry)) continue
    collectEntryCandidates(entry, "task_goal")
  }

  const { kept, decisions } = validateGoalCandidates(allCandidates)
  trace.validationDecisions = decisions
  const { canonical, trace: canonicalTrace } = resolveCanonicalCandidates(kept)
  trace.canonicalDecisions = canonicalTrace

  const sourceMap: Record<GoalCandidateSourceField, GoalConstraint["source"]> = {
    task_goal: "heuristic",
    key_requirements: "structured",
    constraints: "constraints",
    required_inputs: "structured",
    output_format: "output",
    quality_bar: "heuristic",
    answers: "answers"
  }

  for (const candidate of canonical) {
    const keptReason = trace.canonicalDecisions.find(
      (item) =>
        item.decision === "kept" &&
        item.slot === candidate.slot &&
        item.matchedSourceSpan === candidate.matchedText &&
        item.extractor === candidate.extractor
    )?.reason

    if (candidate.slot === "output_requirement") {
      const outputRequirement = sanitizeOutputRequirement(candidate.matchedText)
      if (outputRequirement) outputRequirements.push(outputRequirement)
      continue
    }

    const constraint = buildConstraint(
      candidate.slot as GoalConstraint["type"],
      candidate.matchedText,
      sourceMap[candidate.sourceField],
      candidate.value as GoalConstraint["value"]
    )
    if (constraint) {
      hardConstraints.push({
        ...constraint,
        sourceField: candidate.sourceField,
        matchedText: candidate.matchedText,
        extractor: candidate.extractor,
        keptReason
      })
    }
  }

  inferImplicitSignals(promptText, hardConstraints, softPreferences, outputRequirements)

  const riskFlags = []
  if (Object.keys(sections).length >= 3) riskFlags.push("structured_request")
  if (hardConstraints.length >= 3) riskFlags.push("constraint_rich")

  return sanitizeGoalContract(createGoalContract({
    taskFamily,
    userGoal: stripTrailingPunctuation(taskGoal),
    deliverableType: inferDeliverableType(promptText),
    hardConstraints,
    softPreferences,
    outputRequirements,
    verificationExpectations: [],
    assumptions: assumptions.filter((item) => !GENERIC_ASSUMPTION_PATTERNS.some((pattern) => pattern.test(item))),
    riskFlags,
    normalizationTrace: trace
  }))
}
