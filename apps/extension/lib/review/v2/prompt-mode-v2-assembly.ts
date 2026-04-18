import type { GoalContract } from "../../goal/types"
import type { ReviewPromptModeV2SectionState } from "./section-schemas"
import type { ReviewPromptModeV2RequestType } from "./request-types"
import { resolvePromptModeV2TemplateKind } from "./request-types"

export type ReviewPromptModeV2Validation = {
  missingItems: string[]
  assumedItems: string[]
  contradictions: string[]
}

export type ReviewPromptModeV2AssemblyResult = {
  promptDraft: string
  validation: ReviewPromptModeV2Validation
}

type AssemblyContext = {
  taskType: ReviewPromptModeV2RequestType
  sourcePrompt: string
  goalContract: GoalContract | null
  sections: ReviewPromptModeV2SectionState[]
  additionalNotes: string[]
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))]
}

function sectionById(sections: ReviewPromptModeV2SectionState[], id: string) {
  return sections.find((section) => section.id === id) ?? null
}

function stripQuestionPrefix(text: string) {
  return text.includes(":") ? text.split(":").slice(1).join(":").trim() : text.trim()
}

function materializeSection(section: ReviewPromptModeV2SectionState | null) {
  if (!section) return []
  return uniqueStrings([...section.resolvedContent, ...section.partialContent].map(stripQuestionPrefix))
}

function renderLines(items: string[]) {
  return items.map((item) => `- ${item}`)
}

function pushSection(lines: string[], title: string, values: string[]) {
  if (!values.length) return
  lines.push(`${title}:`)
  lines.push(...renderLines(values))
}

function pushSimpleHeaderSection(lines: string[], title: string, values: string[]) {
  if (!values.length) return
  lines.push(`${title}:`)
  lines.push(values.join("; "))
}

function buildValidation(ctx: AssemblyContext): ReviewPromptModeV2Validation {
  const missingItems = uniqueStrings(
    ctx.sections.flatMap((section) =>
      section.status === "unresolved" || section.unresolvedGaps.length ? section.unresolvedGaps : []
    )
  )
  const assumedItems = uniqueStrings([
    ...ctx.sections.flatMap((section) =>
      section.partialContent.length ? [`${section.label}: ${section.partialContent.map(stripQuestionPrefix).join("; ")}`] : []
    ),
    ...ctx.additionalNotes.map((note) => note.replace(/\s*\(not yet merged\)\s*$/i, ""))
  ])
  const contradictions = uniqueStrings(ctx.sections.flatMap((section) => section.contradictions))

  return {
    missingItems,
    assumedItems,
    contradictions
  }
}

function buildCreationPrompt(ctx: AssemblyContext, _validation: ReviewPromptModeV2Validation) {
  const lines: string[] = []
  const goal = materializeSection(sectionById(ctx.sections, "goal"))
  const context = materializeSection(sectionById(ctx.sections, "context"))
  const requirements = materializeSection(sectionById(ctx.sections, "requirements"))
  const constraints = materializeSection(sectionById(ctx.sections, "constraints"))
  const outputFormat = materializeSection(sectionById(ctx.sections, "output_format"))
  const complete = materializeSection(sectionById(ctx.sections, "definition_of_complete"))

  lines.push("Create")
  if (ctx.goalContract?.deliverableType) {
    lines.push(`- ${ctx.goalContract.deliverableType}`)
  } else if (goal.length) {
    lines.push(`- ${goal[0]}`)
  }
  pushSimpleHeaderSection(lines, "Goal", goal)
  pushSection(lines, "Context", context)
  pushSection(lines, "Requirements", requirements)
  pushSection(lines, "Constraints", constraints)
  pushSection(lines, "Output format", outputFormat)
  pushSimpleHeaderSection(lines, "Definition of complete", complete)
  return lines.join("\n")
}

function buildModificationPrompt(ctx: AssemblyContext, _validation: ReviewPromptModeV2Validation) {
  const lines: string[] = []
  const currentState = materializeSection(sectionById(ctx.sections, "current_state"))
  const requestedChange = materializeSection(sectionById(ctx.sections, "requested_change"))
  const scopeBoundaries = materializeSection(sectionById(ctx.sections, "scope_boundaries"))
  const preserveRules = materializeSection(sectionById(ctx.sections, "preserve_rules"))
  const outputFormat = materializeSection(sectionById(ctx.sections, "output_format"))
  const onlyChange = scopeBoundaries.filter((item) => !/\bdo not\b|\bwithout\b|\bpreserve\b|\bkeep\b/i.test(item))
  const doNotChange = uniqueStrings([
    ...scopeBoundaries.filter((item) => /\bdo not\b|\bwithout\b|\bpreserve\b|\bkeep\b/i.test(item)),
    ...preserveRules
      .filter((item) => !/\bexisting\b|\btone\b|\blayout\b|\bcompatibility\b/i.test(item))
      .map((item) => `Do not change ${item}`)
  ])
  const preserve = preserveRules

  lines.push("Task:")
  lines.push(`Modify the existing ${ctx.goalContract?.deliverableType ? ctx.goalContract.deliverableType : "file / feature / page / copy"}.`)
  pushSection(lines, "Current state", currentState)
  pushSection(lines, "Requested change", requestedChange)
  pushSection(lines, "Only change", onlyChange)
  pushSection(lines, "Do not change", doNotChange)
  pushSection(lines, "Preserve", preserve)
  pushSection(lines, "Output format", outputFormat)
  return lines.join("\n")
}

function buildProblemSolvingPrompt(ctx: AssemblyContext, validation: ReviewPromptModeV2Validation) {
  const lines: string[] = []
  pushSection(lines, "Task", [ctx.sourcePrompt])
  pushSection(lines, "Problem", uniqueStrings([
    ...materializeSection(sectionById(ctx.sections, "actual_behavior")),
    ...validation.missingItems.filter((item) => /problem|actual behavior/i.test(item))
  ]))
  pushSection(lines, "Expected behavior", materializeSection(sectionById(ctx.sections, "expected_behavior")))
  pushSection(lines, "Actual behavior", materializeSection(sectionById(ctx.sections, "actual_behavior")))
  pushSection(lines, "Evidence", materializeSection(sectionById(ctx.sections, "evidence")))
  pushSection(lines, "Environment", materializeSection(sectionById(ctx.sections, "environment_context")))
  pushSection(lines, "What I want", materializeSection(sectionById(ctx.sections, "desired_ai_help")))
  pushSection(lines, "Output format", materializeSection(sectionById(ctx.sections, "fix_proof")))
  return lines.join("\n")
}

export function assemblePromptModeV2Prompt(ctx: AssemblyContext): ReviewPromptModeV2AssemblyResult {
  const validation = buildValidation(ctx)
  let promptDraft = ""

  switch (resolvePromptModeV2TemplateKind(ctx.taskType)) {
    case "creation":
      promptDraft = buildCreationPrompt(ctx, validation)
      break
    case "modification":
      promptDraft = buildModificationPrompt(ctx, validation)
      break
    case "problem_solving":
      promptDraft = buildProblemSolvingPrompt(ctx, validation)
      break
  }

  return {
    promptDraft: promptDraft
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
      .join("\n")
      .trim(),
    validation
  }
}
