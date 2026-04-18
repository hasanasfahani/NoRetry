import type { GoalContract } from "../goal/types"
import { buildAnalysisAnswerModel } from "./analysis-answer-model"
import { extractEvidenceSpans } from "./analysis-evidence-spans"
import { ANALYSIS_JUDGE_PROMPT_VERSION, runAnalysisLlmJudge } from "./analysis-llm-judge"
import { buildBaselineNextMove, buildValidatedNextMove } from "./analysis-next-move"
import { buildAnalysisRequestModel } from "./analysis-request-model"
import { validateAnalysisJudgeResult } from "./analysis-judge-validator"
import { rankAnalysisJudgments } from "./analysis-usefulness-ranking"
import { buildSlotJudgments } from "./analysis-slot-extractors"
import type { ReviewAnalysisDebugPayload, ReviewAnalysisJudgment, ReviewContract } from "./contracts"
import type { ReviewTaskType } from "./services/review-task-type"

type PromptSectionKey =
  | "taskGoal"
  | "requirements"
  | "constraints"
  | "acceptanceCriteria"
  | "actualOutputToEvaluate"

export type AnalysisPromptContract = {
  taskGoal: string[]
  requirements: string[]
  constraints: string[]
  acceptanceCriteria: string[]
  actualOutputToEvaluate: string[]
}

export type AnalysisPromptSectionOutput = {
  promptLabel: string
  promptText: string
  promptNote: string
  nextMoveShort: string
  copyPromptText: string
  contract: AnalysisPromptContract
  working: string[]
  gaps: string[]
  debug: ReviewAnalysisDebugPayload
}

type BuildAnalysisPromptSectionInput = {
  promptText: string
  responseText: string
  taskFamily: ReviewTaskType
  goalContract: GoalContract | null
  reviewContract: ReviewContract | null
  attemptAcceptanceCriteria?: string[]
  refineNextMovePrompt?: (input: {
    prompt: string
    answers: Record<string, string>
    taskType: ReviewTaskType
  }) => Promise<string | null>
}

type ContractEvidence = {
  status: "pass" | "fail" | "unclear" | "contradicted"
  summary: string
}

const STRUCTURED_SECTION_PATTERNS: Array<{
  key: PromptSectionKey | "outputFormat"
  pattern: RegExp
}> = [
  { key: "taskGoal", pattern: /^task\s*\/\s*goal$/i },
  { key: "taskGoal", pattern: /^goal$/i },
  { key: "requirements", pattern: /^key requirements?$/i },
  { key: "requirements", pattern: /^requirements?$/i },
  { key: "constraints", pattern: /^constraints?$/i },
  { key: "acceptanceCriteria", pattern: /^acceptance criteria$/i },
  { key: "acceptanceCriteria", pattern: /^definition of complete$/i },
  { key: "actualOutputToEvaluate", pattern: /^actual output to evaluat(?:e|ion)$/i },
  { key: "outputFormat", pattern: /^output format$/i }
]

const CONSTRAINT_TYPES = new Set([
  "count",
  "numeric_target",
  "tool_method",
  "exclusion",
  "diet",
  "storage",
  "budget",
  "constraint"
])

const OUTPUT_TYPES = new Set(["output_section", "output"])

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeLower(value: string) {
  return normalizeText(value).toLowerCase()
}

function cleanPromptForAnalysisContract(promptText: string) {
  const normalized = promptText
    .replace(/([^\n])(?=(?:Task\s*\/\s*goal|Goal|Key requirements?|Requirements?|Constraints?|Acceptance criteria|Definition of complete|Actual output to evaluat(?:e|ion)|Output format)\s*:)/gi, "$1\n")
    .replace(/\r\n/g, "\n")
    .trim()

  const headingMatch = normalized.match(/(?:^|\n)(Task\s*\/\s*goal|Goal|Key requirements?|Requirements?|Constraints?|Acceptance criteria|Definition of complete|Actual output to evaluat(?:e|ion)|Output format)\s*:/i)
  if (!headingMatch || headingMatch.index == null) {
    return {
      cleanedPrompt: normalized,
      leadingPreamble: ""
    }
  }

  const leading = normalized.slice(0, headingMatch.index).trim()
  return {
    cleanedPrompt: normalized.slice(headingMatch.index).trim(),
    leadingPreamble: leading
  }
}

function uniqueItems(values: Array<string | null | undefined>) {
  const seen = new Set<string>()
  const items: string[] = []

  for (const raw of values) {
    const value = normalizeText(raw ?? "")
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    items.push(value)
  }

  return items
}

function splitSectionValue(value: string) {
  return value
    .split(/\n+/)
    .flatMap((line) => {
      const trimmed = line.trim()
      if (!trimmed) return []
      if (/^\s*[-*]\s+/.test(trimmed)) return [trimmed.replace(/^\s*[-*]\s+/, "")]
      return trimmed
        .split(/;|(?:\.\s+(?=[A-Z]))/)
        .map((item) => item.trim())
        .filter(Boolean)
    })
}

function extractTaskGoalSignals(taskGoalItems: string[]) {
  const requirements: string[] = []
  const constraints: string[] = []
  const acceptanceCriteria: string[] = []
  const actualOutputToEvaluate: string[] = []

  for (const taskGoal of taskGoalItems) {
    const text = taskGoal.trim()
    if (!text) continue

    const pushMatches = (pattern: RegExp, target: string[]) => {
      for (const match of text.matchAll(pattern)) {
        const value = normalizeText(match[0] ?? "")
        if (value) target.push(value)
      }
    }

    pushMatches(/\b\d+-day-per-week\b[^,.]*/gi, requirements)
    pushMatches(/\bintermediate lifter\b[^,.]*/gi, requirements)
    pushMatches(/\busing only free weights\b/gi, constraints)
    pushMatches(/\bavoid [^,.]+/gi, constraints)
    pushMatches(/\binclude [^,.]*cardio bursts?[^,.]*/gi, requirements)
    pushMatches(/\bemphasize [^,.]+/gi, requirements)
    pushMatches(/\bprogress by [^,.]+/gi, acceptanceCriteria)
    pushMatches(/\bdeloads? only if [^,.]+/gi, acceptanceCriteria)
    pushMatches(/\bdeliver [^.]*(?:table|list|json|html|bullets?|outline)[^.]*/gi, actualOutputToEvaluate)
    pushMatches(/\bexercise list with [^,.]+/gi, actualOutputToEvaluate)
    pushMatches(/\btotal time per session[^,.]+/gi, acceptanceCriteria)
    pushMatches(/\bday\s*\([^)]*\)/gi, actualOutputToEvaluate)
  }

  return {
    requirements: uniqueItems(requirements),
    constraints: uniqueItems(constraints),
    acceptanceCriteria: uniqueItems(acceptanceCriteria),
    actualOutputToEvaluate: uniqueItems(actualOutputToEvaluate)
  }
}

function detectStructuredSection(label: string) {
  const normalized = label.trim()
  for (const entry of STRUCTURED_SECTION_PATTERNS) {
    if (entry.pattern.test(normalized)) return entry.key
  }
  return null
}

function extractStructuredPromptSections(promptText: string) {
  const buckets: Record<PromptSectionKey | "outputFormat", string[]> = {
    taskGoal: [],
    requirements: [],
    constraints: [],
    acceptanceCriteria: [],
    actualOutputToEvaluate: [],
    outputFormat: []
  }

  let current: PromptSectionKey | "outputFormat" | null = null
  for (const rawLine of promptText.split("\n")) {
    const line = rawLine.trim()
    if (!line) continue

    const headingMatch = line.match(/^([^:\n]+):\s*(.*)$/)
    if (headingMatch) {
      const detected = detectStructuredSection(headingMatch[1] ?? "")
      if (detected) {
        current = detected
        const inlineValue = headingMatch[2]?.trim()
        if (inlineValue) buckets[detected].push(inlineValue)
        continue
      }
    }

    if (!current) continue
    buckets[current].push(line)
  }

  return {
    taskGoal: splitSectionValue(buckets.taskGoal.join("\n")),
    requirements: splitSectionValue(buckets.requirements.join("\n")),
    constraints: splitSectionValue(buckets.constraints.join("\n")),
    acceptanceCriteria: splitSectionValue(buckets.acceptanceCriteria.join("\n")),
    actualOutputToEvaluate: splitSectionValue(buckets.actualOutputToEvaluate.join("\n")),
    outputFormat: splitSectionValue(buckets.outputFormat.join("\n"))
  }
}

function buildAnalysisPromptContract(params: {
  promptText: string
  goalContract: GoalContract | null
  attemptAcceptanceCriteria?: string[]
}) {
  const cleanedPrompt = cleanPromptForAnalysisContract(params.promptText)
  const structured = extractStructuredPromptSections(cleanedPrompt.cleanedPrompt)
  const goalContract = params.goalContract
  const taskGoalSignals = extractTaskGoalSignals(structured.taskGoal)

  const taskGoal = uniqueItems([
    cleanedPrompt.leadingPreamble,
    ...structured.taskGoal,
    goalContract?.userGoal,
    goalContract?.deliverableType ? `Deliverable: ${goalContract.deliverableType}` : ""
  ])

  const requirements = uniqueItems([
    ...structured.requirements,
    ...taskGoalSignals.requirements
  ])

  const constraints = uniqueItems([
    ...structured.constraints,
    ...taskGoalSignals.constraints,
    ...(goalContract?.hardConstraints.map((item) => item.label) ?? [])
  ])

  const acceptanceCriteria = uniqueItems([
    ...structured.acceptanceCriteria,
    ...taskGoalSignals.acceptanceCriteria,
    ...(params.attemptAcceptanceCriteria ?? []),
    ...(goalContract?.outputRequirements ?? [])
  ])

  const actualOutputToEvaluate = uniqueItems([
    ...structured.actualOutputToEvaluate,
    ...taskGoalSignals.actualOutputToEvaluate,
    ...structured.outputFormat,
    goalContract?.deliverableType ? `Expected output: ${goalContract.deliverableType}` : ""
  ])

  return {
    taskGoal,
    requirements,
    constraints,
    acceptanceCriteria,
    actualOutputToEvaluate
  } satisfies AnalysisPromptContract
}

function sectionKeysForRequirement(requirement: ReviewContract["requirements"][number]): PromptSectionKey[] {
  if (requirement.type === "deliverable") return ["taskGoal", "actualOutputToEvaluate"]
  if (CONSTRAINT_TYPES.has(requirement.type)) return ["constraints"]
  if (OUTPUT_TYPES.has(requirement.type)) return ["acceptanceCriteria", "actualOutputToEvaluate"]
  return ["requirements"]
}

function stripTrailingPunctuation(value: string) {
  return value.replace(/[.:\s]+$/, "").trim()
}

function evidenceText(requirement: ReviewContract["requirements"][number]) {
  return stripTrailingPunctuation(requirement.evidence[0] || requirement.label)
}

function semanticRequirementText(requirement: ReviewContract["requirements"][number], mode: "working" | "gap") {
  const label = requirement.label
  const lower = label.toLowerCase()
  const expectation = stripTrailingPunctuation(String(requirement.expected ?? ""))

  if (/requested deliverable type is present|requested answer type is present|requested rewrite output is present/.test(lower)) {
    return mode === "working"
      ? "The answer already matches the requested deliverable"
      : "Return the requested deliverable type more clearly"
  }

  if (/ingredients section is present/.test(lower)) {
    return mode === "working" ? "The answer already includes an ingredients section" : "Add the ingredients section"
  }

  if (/step-by-step instructions are present/.test(lower)) {
    return mode === "working" ? "The answer already includes step-by-step instructions" : "Add step-by-step instructions"
  }

  if (/macro breakdown is present/.test(lower)) {
    return mode === "working" ? "The answer already includes a macro breakdown" : "Add the macro breakdown"
  }

  if (/calorie information is present/.test(lower)) {
    return mode === "working" ? "The answer already includes calorie information" : "Add calorie information"
  }

  if (/full html file output is present/.test(lower)) {
    return mode === "working" ? "The answer already returns the full HTML file" : "Return the full HTML file"
  }

  if (/serving count matches/.test(lower)) {
    return mode === "working"
      ? `The serving count already matches ${expectation || "the request"}`
      : `Make the serving count match ${expectation || "the request"}`
  }

  if (/time constraint matches/.test(lower)) {
    return mode === "working"
      ? `The time target already matches ${expectation || "the request"}`
      : `Make the time target match ${expectation || "the request"}`
  }

  if (/calorie target matches/.test(lower)) {
    return mode === "working"
      ? `The calorie target already matches ${expectation || "the request"}`
      : `Make the calorie target match ${expectation || "the request"}`
  }

  if (/calorie budget compatibility is preserved/.test(lower)) {
    return mode === "working"
      ? `The answer already fits the requested calorie budget`
      : `Make the answer fit the requested calorie budget`
  }

  if (/protein target matches/.test(lower)) {
    return mode === "working"
      ? `The protein target already matches ${expectation || "the request"}`
      : `Make the protein target match ${expectation || "the request"}`
  }

  if (/high-protein requirement is preserved/.test(lower)) {
    return mode === "working" ? "The answer already stays high-protein" : "Keep the answer high-protein"
  }

  if (/tool or method constraint matches/.test(lower)) {
    return mode === "working"
      ? `The method already matches ${expectation || "the request"}`
      : `Make the method match ${expectation || "the request"}`
  }

  if (/exclusion is preserved/.test(lower)) {
    return mode === "working"
      ? `The answer already preserves this exclusion: ${expectation || label}`
      : `Preserve this exclusion: ${expectation || label}`
  }

  if (/diet requirement is preserved/.test(lower)) {
    return mode === "working"
      ? `The answer already preserves this diet rule: ${expectation || label}`
      : `Preserve this diet rule: ${expectation || label}`
  }

  if (/cuisine or style requirement is preserved/.test(lower)) {
    return mode === "working"
      ? `The answer already preserves this cuisine or style: ${expectation || label}`
      : `Preserve this cuisine or style: ${expectation || label}`
  }

  if (/freshness or leftovers requirement is preserved/.test(lower)) {
    return mode === "working"
      ? `The answer already preserves this freshness rule: ${expectation || label}`
      : `Preserve this freshness rule: ${expectation || label}`
  }

  if (/audience requirement is preserved/.test(lower)) {
    return mode === "working" ? "The answer already matches the intended audience" : "Match the intended audience more clearly"
  }

  if (/tone requirement is preserved|concise tone or style requirement is preserved/.test(lower)) {
    return mode === "working" ? "The answer already matches the requested tone" : "Match the requested tone more clearly"
  }

  return mode === "working" ? sentenceCase(evidenceText(requirement)) : sentenceCase(stripTrailingPunctuation(label))
}

function sentenceCase(value: string) {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function normalizeSemanticKey(value: string) {
  return normalizeText(
    value
      .replace(/^(?:task\s*\/\s*goal|requirements?|constraints?|acceptance criteria|actual output)\s*:\s*/i, "")
      .replace(/^task\s*\/\s*goal extracted:\s*/i, "")
      .replace(/^requirements still need explicit evidence:\s*/i, "")
      .replace(/^constraints still need explicit evidence:\s*/i, "")
      .replace(/^acceptance criteria still need explicit evidence:\s*/i, "")
      .replace(/^actual output still needs explicit evidence:\s*/i, "")
      .replace(/^(?:still unclear|missing or wrong|contradiction):\s*/i, "")
      .replace(/^the answer already /i, "")
      .replace(/^the serving count already matches /i, "")
      .replace(/^make the serving count match /i, "")
      .replace(/^the time target already matches /i, "")
      .replace(/^make the time target match /i, "")
      .replace(/^the calorie target already matches /i, "")
      .replace(/^make the calorie target match /i, "")
      .replace(/^the answer already fits the requested calorie budget$/i, "calorie budget")
      .replace(/^make the answer fit the requested calorie budget$/i, "calorie budget")
      .replace(/^the answer already preserves this diet rule:\s*/i, "")
      .replace(/^preserve this exclusion:\s*/i, "")
      .replace(/^the answer already preserves this exclusion:\s*/i, "")
      .replace(/^do not use\s+/i, "")
      .replace(/^avoid\s+/i, "")
      .replace(/\b([a-z]+)[-\s]?free\b/gi, "$1")
  )
}

function dedupeSemanticItems(values: string[]) {
  const kept: string[] = []
  const seenKeys: string[] = []

  for (const value of values) {
    const key = normalizeSemanticKey(value)
    if (!key) continue
    const overlaps = seenKeys.some((existing) => existing === key || existing.includes(key) || key.includes(existing))
    if (overlaps) continue
    seenKeys.push(key)
    kept.push(value)
  }

  return kept
}

function summarizeWorking(requirement: ReviewContract["requirements"][number]) {
  return sentenceCase(semanticRequirementText(requirement, "working"))
}

function summarizeGap(requirement: ReviewContract["requirements"][number]) {
  const semantic = semanticRequirementText(requirement, "gap")
  if (requirement.status === "contradicted") {
    return `Contradiction: ${semantic}`
  }
  if (requirement.status === "unclear") {
    return `Still unclear: ${semantic}`
  }
  return `Missing or wrong: ${semantic}`
}

function buildSectionEvidence(reviewContract: ReviewContract | null) {
  const working: Record<PromptSectionKey, string[]> = {
    taskGoal: [],
    requirements: [],
    constraints: [],
    acceptanceCriteria: [],
    actualOutputToEvaluate: []
  }
  const gaps: Record<PromptSectionKey, string[]> = {
    taskGoal: [],
    requirements: [],
    constraints: [],
    acceptanceCriteria: [],
    actualOutputToEvaluate: []
  }

  if (!reviewContract) {
    return { working, gaps }
  }

  for (const requirement of reviewContract.requirements) {
    const targets = sectionKeysForRequirement(requirement)
    const summary =
      requirement.status === "pass"
        ? summarizeWorking(requirement)
        : summarizeGap(requirement)

    for (const key of targets) {
      if (requirement.status === "pass") working[key].push(summary)
      else gaps[key].push(summary)
    }
  }

  return {
    working: {
      taskGoal: dedupeSemanticItems(uniqueItems(working.taskGoal)),
      requirements: dedupeSemanticItems(uniqueItems(working.requirements)),
      constraints: dedupeSemanticItems(uniqueItems(working.constraints)),
      acceptanceCriteria: dedupeSemanticItems(uniqueItems(working.acceptanceCriteria)),
      actualOutputToEvaluate: dedupeSemanticItems(uniqueItems(working.actualOutputToEvaluate))
    },
    gaps: {
      taskGoal: dedupeSemanticItems(uniqueItems(gaps.taskGoal)),
      requirements: dedupeSemanticItems(uniqueItems(gaps.requirements)),
      constraints: dedupeSemanticItems(uniqueItems(gaps.constraints)),
      acceptanceCriteria: dedupeSemanticItems(uniqueItems(gaps.acceptanceCriteria)),
      actualOutputToEvaluate: dedupeSemanticItems(uniqueItems(gaps.actualOutputToEvaluate))
    }
  }
}

function buildWorkingBullets(contract: AnalysisPromptContract, evidence: ReturnType<typeof buildSectionEvidence>) {
  const extractedTaskGoal =
    contract.taskGoal.length &&
    evidence.working.taskGoal.length === 0 &&
    normalizeText(contract.taskGoal[0]).length <= 120
      ? `Task / goal extracted: ${contract.taskGoal[0]}`
      : ""

  return dedupeSemanticItems(uniqueItems([
    ...evidence.working.taskGoal.map((item) => `Task / goal: ${item}`),
    ...evidence.working.requirements.map((item) => `Requirements: ${item}`),
    ...evidence.working.constraints.map((item) => `Constraints: ${item}`),
    ...evidence.working.acceptanceCriteria.map((item) => `Acceptance criteria: ${item}`),
    ...evidence.working.actualOutputToEvaluate.map((item) => `Actual output: ${item}`),
    extractedTaskGoal
  ])).slice(0, 10)
}

function buildGapBullets(contract: AnalysisPromptContract, evidence: ReturnType<typeof buildSectionEvidence>) {
  const allWorkingKeys = [
    ...evidence.working.taskGoal,
    ...evidence.working.requirements,
    ...evidence.working.constraints,
    ...evidence.working.acceptanceCriteria,
    ...evidence.working.actualOutputToEvaluate
  ].map(normalizeSemanticKey)

  const isAlreadyCovered = (value: string) => {
    const key = normalizeSemanticKey(value)
    return allWorkingKeys.some((workingKey) => workingKey === key || workingKey.includes(key) || key.includes(workingKey))
  }

  const fallbackContractGaps = [
    contract.requirements.length &&
    evidence.gaps.requirements.length === 0 &&
    evidence.working.requirements.length === 0 &&
    !isAlreadyCovered(contract.requirements[0])
      ? `Requirements still need explicit evidence: ${contract.requirements[0]}`
      : "",
    contract.constraints.length &&
    evidence.gaps.constraints.length === 0 &&
    evidence.working.constraints.length === 0 &&
    !isAlreadyCovered(contract.constraints[0])
      ? `Constraints still need explicit evidence: ${contract.constraints[0]}`
      : "",
    contract.acceptanceCriteria.length &&
    evidence.gaps.acceptanceCriteria.length === 0 &&
    evidence.working.acceptanceCriteria.length === 0 &&
    !isAlreadyCovered(contract.acceptanceCriteria[0])
      ? `Acceptance criteria still need explicit evidence: ${contract.acceptanceCriteria[0]}`
      : "",
    contract.actualOutputToEvaluate.length &&
    evidence.gaps.actualOutputToEvaluate.length === 0 &&
    evidence.working.actualOutputToEvaluate.length === 0 &&
    !isAlreadyCovered(contract.actualOutputToEvaluate[0])
      ? `Actual output still needs explicit evidence: ${contract.actualOutputToEvaluate[0]}`
      : ""
  ]

  return dedupeSemanticItems(uniqueItems([
    ...evidence.gaps.taskGoal.map((item) => `Task / goal: ${item}`),
    ...evidence.gaps.requirements.map((item) => `Requirements: ${item}`),
    ...evidence.gaps.constraints.map((item) => `Constraints: ${item}`),
    ...evidence.gaps.acceptanceCriteria.map((item) => `Acceptance criteria: ${item}`),
    ...evidence.gaps.actualOutputToEvaluate.map((item) => `Actual output: ${item}`),
    ...fallbackContractGaps
  ])).slice(0, 10)
}

function parseJudgmentSection(label: string): ReviewAnalysisJudgment["section"] {
  const normalized = normalizeLower(label)
  if (normalized.startsWith("task / goal:")) return "taskGoal"
  if (normalized.startsWith("requirements:")) return "requirements"
  if (normalized.startsWith("constraints:")) return "constraints"
  if (normalized.startsWith("acceptance criteria:")) return "acceptanceCriteria"
  if (normalized.startsWith("actual output:")) return "actualOutputToEvaluate"
  return "requirements"
}

function stripJudgmentLabel(label: string) {
  return normalizeText(
    label
      .replace(/^(?:task\s*\/\s*goal|requirements?|constraints?|acceptance criteria|actual output)\s*:\s*/i, "")
      .replace(/^(?:missing or wrong|still unclear|contradiction):\s*/i, "")
  )
}

function parseJudgmentStatus(label: string): ReviewAnalysisJudgment["status"] {
  if (/:\s*contradiction:/i.test(label) || /^contradiction:/i.test(stripJudgmentLabel(label))) return "contradicted"
  if (/:\s*still unclear:/i.test(label) || /^still unclear:/i.test(stripJudgmentLabel(label))) return "unclear"
  if (/:\s*missing or wrong:/i.test(label) || /^missing or wrong:/i.test(stripJudgmentLabel(label))) return "missing"
  return "met"
}

function baseConfidenceForStatus(status: ReviewAnalysisJudgment["status"]): ReviewAnalysisJudgment["confidence"] {
  if (status === "contradicted") return "high"
  if (status === "missing") return "medium"
  if (status === "unclear") return "low"
  return "high"
}

function sectionContractItems(contract: AnalysisPromptContract, section: ReviewAnalysisJudgment["section"]) {
  switch (section) {
    case "taskGoal":
      return contract.taskGoal
    case "requirements":
      return contract.requirements
    case "constraints":
      return contract.constraints
    case "acceptanceCriteria":
      return contract.acceptanceCriteria
    case "actualOutputToEvaluate":
      return contract.actualOutputToEvaluate
  }
}

function buildBaselineJudgments(params: {
  working: string[]
  gaps: string[]
  promptText: string
  responseText: string
  contract: AnalysisPromptContract
}) {
  const allLabels = [...params.working, ...params.gaps]
  const judgments: ReviewAnalysisJudgment[] = []

  allLabels.forEach((rawLabel, index) => {
    const section = parseJudgmentSection(rawLabel)
    const cleanedLabel = stripJudgmentLabel(rawLabel)
    const sectionItems = sectionContractItems(params.contract, section)
    const requestQueries = [cleanedLabel, ...sectionItems].filter(Boolean)
    const answerQueries = [cleanedLabel, ...sectionItems].filter(Boolean)
    const status = parseJudgmentStatus(rawLabel)
    const requestEvidence = extractEvidenceSpans({
      text: params.promptText,
      source: "request",
      queries: requestQueries
    }).slice(0, 3)
    const answerEvidence = extractEvidenceSpans({
      text: params.responseText,
      source: "answer",
      queries: answerQueries
    }).slice(0, 3)

    judgments.push({
      id: `baseline-${index + 1}`,
      section,
      label: cleanedLabel || rawLabel,
      status,
      confidence: baseConfidenceForStatus(status),
      usefulness: 0,
      rationale:
        status === "met"
          ? "Visible evidence indicates this part is already satisfied."
          : status === "contradicted"
            ? "Visible evidence directly conflicts with this requirement."
            : status === "missing"
              ? "This requirement is not visibly satisfied yet."
              : "This requirement may be satisfied, but the visible evidence is not strong enough.",
      requestEvidence,
      answerEvidence
    })
  })

  return judgments
}

function hasMarkdownTable(responseText: string) {
  const lines = responseText.split("\n").map((line) => line.trim())
  return lines.filter((line) => /\|/.test(line) && !/^\|?[\s:-]+\|[\s|:-]+$/.test(line)).length >= 2
}

function countStructuredSteps(responseText: string) {
  return responseText.match(/(?:^|\n)\s*\d+\.\s+/g)?.length ?? 0
}

function hasIngredientsSignals(responseText: string) {
  return /(?:^|\n)\s{0,3}(?:#{1,6}|[>*-]+)?\s*(?:[^\w\n]{0,4}\s*)?ingredients?\b(?:\s*[:(]|\s*$)/im.test(responseText)
}

function hasInstructionSignals(responseText: string) {
  return /(?:^|\n)\s{0,3}(?:#{1,6}|[>*-]+)?\s*(?:[^\w\n]{0,4}\s*)?(?:instructions?|method|step[-\s]?by[-\s]?step)\b(?:\s*[:(]|\s*$)/im.test(responseText) || countStructuredSteps(responseText) >= 2
}

function hasMacroSignals(responseText: string) {
  return /\bprotein\b|\bcarbohydrates?\b|\bnet carbs?\b|\bfat\b|\bfiber\b/i.test(responseText)
}

function parseResponseServingCount(responseText: string) {
  const explicit = responseText.match(/\bservings?\s*:\s*(\d+)(?:\s*[-–]\s*(\d+))?/i)
  if (explicit) {
    return {
      min: Number(explicit[1]),
      max: explicit[2] ? Number(explicit[2]) : Number(explicit[1])
    }
  }

  if (/\bsingle[-\s]?serving\b|\b1 serving\b|\bfor 1 person\b/i.test(responseText)) {
    return { min: 1, max: 1 }
  }

  return null
}

function parseResponseCalories(responseText: string) {
  const labeled =
    responseText.match(/\b(?:total\s+)?calories?\s*:\s*~?\s*(\d+)(?:\s*(?:kcal|cal))?\b/i) ??
    responseText.match(/\b(?:total\s+)?calories?\s+per\s+serving\s*:\s*~?\s*(\d+)(?:\s*(?:kcal|cal))?\b/i)
  if (labeled) return Number(labeled[1])
  return null
}

function dailyBudgetFromText(text: string) {
  const lower = normalizeLower(text)
  if (!/\b(?:per day|daily|kcal day|calorie day|fits inside .* day)\b/.test(lower)) return null
  const range = lower.match(/(\d+)\s*[-–]\s*(\d+)\s*(?:kcal|calories)/)
  if (range) return { min: Number(range[1]), max: Number(range[2]) }
  const capped = lower.match(/(?:under|less than|<=|≤|max(?:imum)?)\s*(\d+)\s*(?:kcal|calories)/)
  if (capped) return { min: null, max: Number(capped[1]) }
  return null
}

function perServingTargetFromText(text: string) {
  const lower = normalizeLower(text)
  if (dailyBudgetFromText(text)) return null
  const range = lower.match(/(\d+)\s*[-–]\s*(\d+)\s*(?:kcal|calories)(?:\s+per\s+serving)?\b/)
  if (range) return { min: Number(range[1]), max: Number(range[2]) }
  const capped = lower.match(/(?:under|less than|<=|≤|max(?:imum)?)\s*(\d+)\s*(?:kcal|calories)\b/)
  if (capped) return { min: null, max: Number(capped[1]) }
  return null
}

function cardioBurstCount(responseText: string) {
  return responseText.match(/\bcardio burst\b/gi)?.length ?? 0
}

function hasMonWedFriSchedule(responseText: string) {
  const normalized = normalizeText(responseText).toLowerCase()
  return /\bmon\b/.test(normalized) && /\bwed\b/.test(normalized) && /\bfri\b/.test(normalized)
}

function directEvidenceForContractItem(section: PromptSectionKey, item: string, responseText: string): ContractEvidence | null {
  const normalizedItem = normalizeLower(item)
  const haystack = normalizeText(responseText).toLowerCase()

  if (!normalizedItem) return null

  if (normalizedItem.includes("table")) {
    return {
      status: hasMarkdownTable(responseText) ? "pass" : "fail",
      summary: hasMarkdownTable(responseText) ? "The answer already uses a table format" : "Return the answer in a table"
    }
  }

  if (normalizedItem.includes("ingredients")) {
    return {
      status: hasIngredientsSignals(responseText) ? "pass" : "unclear",
      summary: hasIngredientsSignals(responseText) ? "The answer already includes an ingredients section" : "Add the ingredients section"
    }
  }

  if (normalizedItem.includes("step-by-step") || normalizedItem.includes("instructions")) {
    return {
      status: hasInstructionSignals(responseText) ? "pass" : "unclear",
      summary: hasInstructionSignals(responseText) ? "The answer already includes step-by-step instructions" : "Add step-by-step instructions"
    }
  }

  if (normalizedItem.includes("macro")) {
    return {
      status: hasMacroSignals(responseText) ? "pass" : "unclear",
      summary: hasMacroSignals(responseText) ? "The answer already includes a macro breakdown" : "Add the macro breakdown"
    }
  }

  if (normalizedItem.includes("calories per serving")) {
    const calories = parseResponseCalories(responseText)
    return {
      status: calories != null ? "pass" : "unclear",
      summary: calories != null ? "The answer already includes calorie information" : "Add calorie information"
    }
  }

  if (normalizedItem.includes("single-serving") || normalizedItem.includes("single serving") || normalizedItem.includes("1 serving")) {
    const servingCount = parseResponseServingCount(responseText)
    const pass = servingCount?.min === 1 && servingCount.max === 1
    return {
      status: pass ? "pass" : "unclear",
      summary: pass ? "The answer already matches a single serving" : "Make the serving count explicitly single-serving"
    }
  }

  if (normalizedItem.includes("do not use spice") || normalizedItem.includes("0 spice") || normalizedItem.includes("no spice")) {
    const contradicted = /\bspicy\b|\bchili\b|\bjalapeño\b|\bjalapeno\b|\bpepper flakes\b|\bhot sauce\b/.test(haystack)
    const preserved = /\bno spice\b|\bno-spice\b|\bzero spice\b|\b0 spice\b/.test(haystack) || !contradicted
    return {
      status: contradicted ? "contradicted" : preserved ? "pass" : "unclear",
      summary: contradicted ? "Remove spice from the recipe" : "The answer already avoids spice"
    }
  }

  if (normalizedItem.includes("dairy-free") || normalizedItem === "dairy") {
    const contradicted = /\bcheese\b|\bmilk\b|\bcream\b|\byogurt\b|\bbutter\b/.test(haystack) && !/\bdairy-free\b/.test(haystack)
    const preserved = /\bdairy-free\b/.test(haystack) || (!contradicted && !/\bcheese\b|\bmilk\b|\bcream\b|\byogurt\b|\bbutter\b/.test(haystack))
    return {
      status: contradicted ? "contradicted" : preserved ? "pass" : "unclear",
      summary: contradicted ? "Remove dairy from the answer" : "The answer already preserves dairy-free requirements"
    }
  }

  const dailyBudget = dailyBudgetFromText(normalizedItem)
  if (dailyBudget) {
    const calories = parseResponseCalories(responseText)
    if (calories == null) {
      return {
        status: "unclear",
        summary: "Clarify that the recipe fits the requested daily calorie budget"
      }
    }
    return {
      status: calories <= dailyBudget.max ? "pass" : "contradicted",
      summary: calories <= dailyBudget.max
        ? "The answer already fits the requested daily calorie budget"
        : `Lower the calories so the recipe fits within a ${dailyBudget.max} kcal day`
    }
  }

  const perServingCalories = perServingTargetFromText(normalizedItem)
  if (perServingCalories) {
    const calories = parseResponseCalories(responseText)
    if (calories == null) {
      return {
        status: "unclear",
        summary: "Add calorie information"
      }
    }
    const pass = (perServingCalories.min == null || calories >= perServingCalories.min) && calories <= perServingCalories.max
    return {
      status: pass ? "pass" : "contradicted",
      summary: pass
        ? "The answer already matches the requested calorie target"
        : `Make the calories match ${normalizedItem}`
    }
  }

  if (normalizedItem.includes("3-day-per-week") || normalizedItem.includes("day (mon/wed/fri)") || normalizedItem.includes("mon/wed/fri")) {
    return {
      status: hasMonWedFriSchedule(responseText) ? "pass" : "unclear",
      summary: hasMonWedFriSchedule(responseText) ? "The answer already includes Mon/Wed/Fri sessions" : "Show all three Mon/Wed/Fri sessions clearly"
    }
  }

  if (normalizedItem.includes("intermediate lifter")) {
    const pass = /\bintermediate\b|\b6[-–]24 months\b/.test(haystack)
    return {
      status: pass ? "pass" : "unclear",
      summary: pass ? "The answer already targets an intermediate lifter" : "Clarify that the program is for an intermediate lifter"
    }
  }

  if (normalizedItem.includes("free weights")) {
    const pass = /\bdumbbell\b|\bdb\b|\bbarbell\b|\bfree[-\s]?weights?\b/.test(haystack) && !/\bcable\b|\bmachine\b|\bleg press\b|\bsmith\b/.test(haystack)
    const contradicted = /\bcable\b|\bmachine\b|\bleg press\b|\bsmith\b/.test(haystack)
    return {
      status: contradicted ? "contradicted" : pass ? "pass" : "unclear",
      summary: contradicted
        ? "Use only free-weight movements"
        : pass
          ? "The answer already stays within free-weight movements"
          : "Make the exercise selection explicitly free-weight only"
    }
  }

  if (normalizedItem.includes("knee-heavy")) {
    const pass = /\bknee[-\s]?friendly\b|\bno squats?\b|\bno lunges?\b|\bhip[-\s]?dominant\b/.test(haystack)
    const contradicted = /\bsquat\b|\blunge\b|\bleg press\b|\bstep-up\b/.test(haystack) && !pass
    return {
      status: contradicted ? "contradicted" : pass ? "pass" : "unclear",
      summary: contradicted
        ? "Remove knee-heavy movements"
        : pass
          ? "The answer already avoids knee-heavy movements"
          : "Make the knee-heavy restriction more explicit"
    }
  }

  if (normalizedItem.includes("glute")) {
    const pass = /\bglute\b|\bhip thrust\b|\bglute bridge\b|\bhip abduction\b/.test(haystack)
    return {
      status: pass ? "pass" : "unclear",
      summary: pass ? "The answer already emphasizes glute development" : "Make glute emphasis more explicit"
    }
  }

  if (normalizedItem.includes("cardio burst")) {
    const bursts = cardioBurstCount(responseText)
    return {
      status: bursts >= 2 ? "pass" : bursts === 1 ? "unclear" : "fail",
      summary: bursts >= 2 ? "The answer already includes two cardio bursts per week" : "Include two short cardio bursts per week"
    }
  }

  if (normalizedItem.includes("progress by adding reps before load") || normalizedItem.includes("rep-first")) {
    const pass = /\badd reps\b/.test(haystack) && /\b(top of the range|increase weight|increase load|then increase)\b/.test(haystack)
    return {
      status: pass ? "pass" : "unclear",
      summary: pass ? "The answer already explains rep-first progression before load" : "Explain rep-first progression before load"
    }
  }

  if (normalizedItem.includes("deload") || normalizedItem.includes("progress stalls")) {
    const pass = /\bdeload\b/.test(haystack) && /\bstall|stalls|fail to add reps|if needed\b/.test(haystack)
    return {
      status: pass ? "pass" : "unclear",
      summary: pass ? "The answer already explains when to deload" : "Explain that deloads happen only if progress stalls"
    }
  }

  if (normalizedItem.includes("sets × reps") || normalizedItem.includes("sets x reps") || normalizedItem.includes("exercise list")) {
    const pass = /\b\d+\s*[×x]\s*\d+/.test(responseText) || /\bsets?\s*[×x]\s*reps?\b/i.test(responseText)
    return {
      status: pass ? "pass" : "unclear",
      summary: pass ? "The answer already shows exercises with sets × reps" : "Show the exercise list with sets × reps"
    }
  }

  if (normalizedItem.includes("30 min") || normalizedItem.includes("30-minute") || normalizedItem.includes("total time per session")) {
    const pass = /≤\s*30\s*min|\b30[-\s]?min\b|\b30 minutes?\b/.test(responseText)
    return {
      status: pass ? "pass" : "unclear",
      summary: pass ? "The answer already keeps each session within 30 minutes" : "Make the 30-minute session limit explicit"
    }
  }

  if (section === "actualOutputToEvaluate" && normalizedItem.includes("expected output:")) {
    return null
  }

  return null
}

function buildDirectContractEvidence(contract: AnalysisPromptContract, responseText: string) {
  const working: Record<PromptSectionKey, string[]> = {
    taskGoal: [],
    requirements: [],
    constraints: [],
    acceptanceCriteria: [],
    actualOutputToEvaluate: []
  }
  const gaps: Record<PromptSectionKey, string[]> = {
    taskGoal: [],
    requirements: [],
    constraints: [],
    acceptanceCriteria: [],
    actualOutputToEvaluate: []
  }

  const register = (section: PromptSectionKey, item: string) => {
    const evidence = directEvidenceForContractItem(section, item, responseText)
    if (!evidence) return
    if (evidence.status === "pass") working[section].push(evidence.summary)
    else gaps[section].push(evidence.summary)
  }

  for (const item of contract.taskGoal) register("taskGoal", item)
  for (const item of contract.requirements) register("requirements", item)
  for (const item of contract.constraints) register("constraints", item)
  for (const item of contract.acceptanceCriteria) register("acceptanceCriteria", item)
  for (const item of contract.actualOutputToEvaluate) register("actualOutputToEvaluate", item)

  return {
    working: {
      taskGoal: dedupeSemanticItems(working.taskGoal),
      requirements: dedupeSemanticItems(working.requirements),
      constraints: dedupeSemanticItems(working.constraints),
      acceptanceCriteria: dedupeSemanticItems(working.acceptanceCriteria),
      actualOutputToEvaluate: dedupeSemanticItems(working.actualOutputToEvaluate)
    },
    gaps: {
      taskGoal: dedupeSemanticItems(gaps.taskGoal),
      requirements: dedupeSemanticItems(gaps.requirements),
      constraints: dedupeSemanticItems(gaps.constraints),
      acceptanceCriteria: dedupeSemanticItems(gaps.acceptanceCriteria),
      actualOutputToEvaluate: dedupeSemanticItems(gaps.actualOutputToEvaluate)
    }
  }
}

function mergeEvidenceLayers(
  contractEvidence: ReturnType<typeof buildSectionEvidence>,
  directEvidence: ReturnType<typeof buildDirectContractEvidence>
) {
  const filterSatisfiedGaps = (workingItems: string[], gapItems: string[]) => {
    const workingKeys = workingItems.map(normalizeSemanticKey)
    return gapItems.filter((item) => {
      const key = normalizeSemanticKey(item)
      return !workingKeys.some((workingKey) => workingKey === key || workingKey.includes(key) || key.includes(workingKey))
    })
  }

  const merge = (key: PromptSectionKey, kind: "working" | "gaps") =>
    dedupeSemanticItems([
      ...contractEvidence[kind][key],
      ...directEvidence[kind][key]
    ])

  const working = {
    taskGoal: merge("taskGoal", "working"),
    requirements: merge("requirements", "working"),
    constraints: merge("constraints", "working"),
    acceptanceCriteria: merge("acceptanceCriteria", "working"),
    actualOutputToEvaluate: merge("actualOutputToEvaluate", "working")
  }

  const gaps = {
    taskGoal: filterSatisfiedGaps(working.taskGoal, merge("taskGoal", "gaps")),
    requirements: filterSatisfiedGaps(working.requirements, merge("requirements", "gaps")),
    constraints: filterSatisfiedGaps(working.constraints, merge("constraints", "gaps")),
    acceptanceCriteria: filterSatisfiedGaps(working.acceptanceCriteria, merge("acceptanceCriteria", "gaps")),
    actualOutputToEvaluate: filterSatisfiedGaps(working.actualOutputToEvaluate, merge("actualOutputToEvaluate", "gaps"))
  }

  return {
    working,
    gaps
  }
}

function buildRefinementPrompt(params: {
  contract: AnalysisPromptContract
  judgments: ReviewAnalysisJudgment[]
  responseText: string
}) {
  const { contract, judgments, responseText } = params
  const unresolved = judgments.filter((judgment) => judgment.status !== "met").slice(0, 4)
  const sections = [
    `Prompt version: ${ANALYSIS_JUDGE_PROMPT_VERSION}`,
    "Rewrite the next retry prompt so it fixes only the highest-value unresolved parts of the latest assistant answer.",
    contract.taskGoal.length ? `Task / goal\n${contract.taskGoal.map((item) => `- ${item}`).join("\n")}` : "",
    contract.requirements.length ? `Requirements\n${contract.requirements.map((item) => `- ${item}`).join("\n")}` : "",
    contract.constraints.length ? `Constraints\n${contract.constraints.map((item) => `- ${item}`).join("\n")}` : "",
    contract.acceptanceCriteria.length ? `Acceptance criteria\n${contract.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}` : "",
    contract.actualOutputToEvaluate.length
      ? `Actual output to evaluate\n${contract.actualOutputToEvaluate.map((item) => `- ${item}`).join("\n")}`
      : "",
    unresolved.length
      ? `Validated unresolved judgments\n${unresolved.map((item) => `- ${item.label} (${item.status}, usefulness ${item.usefulness})`).join("\n")}`
      : "",
    `Latest assistant answer excerpt\n${responseText.trim().slice(0, 900)}`,
    "Action\nAsk only for the unresolved parts. Do not repeat met items. Do not mention internal analysis. Keep the retry narrow and actionable.",
    "Return only the new next prompt text."
  ].filter(Boolean)

  return sections.join("\n\n")
}

function responseLooksCutOff(responseText: string) {
  const trimmed = responseText.trim()
  if (!trimmed) return false

  const fenceCount = (trimmed.match(/```/g) ?? []).length
  if (fenceCount % 2 === 1) return true

  if (/[,:;(\[{<\-–—]$/.test(trimmed)) return true

  const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean)
  const lastLine = lines.at(-1) ?? ""
  if (/\|\s*$/.test(lastLine) && hasMarkdownTable(trimmed)) return true

  return false
}

function normalizedContractText(contract: AnalysisPromptContract) {
  return [
    ...contract.taskGoal,
    ...contract.requirements,
    ...contract.constraints,
    ...contract.acceptanceCriteria,
    ...contract.actualOutputToEvaluate
  ]
    .map((item) => normalizeSemanticKey(item))
    .filter(Boolean)
}

function hasOnlyAllowedLabeledItems(nextMove: string, contract: AnalysisPromptContract) {
  const allowed = normalizedContractText(contract)
  const labeledSections = [
    { label: "Keep these constraints:", items: contract.constraints },
    {
      label: "Meet these output requirements:",
      items: [...contract.acceptanceCriteria, ...contract.actualOutputToEvaluate]
    }
  ]

  for (const section of labeledSections) {
    const match = nextMove.match(new RegExp(`${section.label}\\s*([\\s\\S]+?)(?:\\n\\n|$)`, "i"))
    if (!match) continue
    const bullets = match[1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^-\s+/.test(line))
      .map((line) => normalizeSemanticKey(line.replace(/^-\s+/, "")))
      .filter(Boolean)

    if (!bullets.length) continue

    const allowedSection = section.items
      .map((item) => normalizeSemanticKey(item))
      .filter(Boolean)

    for (const bullet of bullets) {
      const known = [...allowedSection, ...allowed].some(
        (item) => item === bullet || item.includes(bullet) || bullet.includes(item)
      )
      if (!known) return false
    }
  }

  return true
}

function shouldRejectGeneratedNextMove(params: {
  nextMove: string
  working: string[]
  gaps: string[]
  responseText: string
  contract: AnalysisPromptContract
}) {
  const nextMove = normalizeText(params.nextMove)
  const response = normalizeText(params.responseText)
  const gapText = normalizeText(params.gaps.join(" ; "))
  const workingText = normalizeText(params.working.join(" ; "))

  if (!nextMove) return true
  if (!hasOnlyAllowedLabeledItems(params.nextMove, params.contract)) return true
  if (!responseLooksCutOff(params.responseText) && /\b(?:cut off|truncated|cut short|unfinished|stopped after)\b/.test(nextMove)) {
    return true
  }
  if (hasMarkdownTable(params.responseText) && /\b(?:finish|complete|fill in)\b.*\b(?:table|column|friday|mon|wed|fri)\b/.test(nextMove)) return true
  if (/\bfriday\b/.test(response) && /\bfinish\b.*\bfriday\b/.test(nextMove) && !/\bfriday\b/.test(gapText)) return true
  if (/\bingredients section\b/.test(workingText) && /\badd\b.*\bingredients\b/.test(nextMove)) return true
  if (/\bstep-by-step instructions\b/.test(workingText) && /\badd\b.*\binstructions?\b/.test(nextMove)) return true
  if (/\brequested deliverable\b|\bmatches the requested deliverable\b/.test(workingText) && /\brequested deliverable\b/.test(nextMove)) return true
  if (/\bsingle serving\b|\bserving count already matches\b/.test(workingText) && /\bserving count\b/.test(nextMove)) return true
  if (/\bavoids spice\b|\bno spice\b/.test(workingText) && /\bspice\b/.test(nextMove)) return true
  if (/\brequested daily calorie budget\b|\bfits the requested calorie budget\b/.test(workingText) && /\bcalorie target\b|\b1500\b|\b1800\b/.test(nextMove)) return true
  if (/\btable format\b|\buses a table\b/.test(workingText) && /\breturn\b.*\btable\b/.test(nextMove) && !/\btable\b/.test(gapText)) return true
  if (/\bextra text\b/.test(nextMove) && !/\bextra text\b/.test(normalizedContractText(params.contract).join(" "))) return true
  return false
}

function shortenNextMove(value: string) {
  const normalized = normalizeText(value)
  if (normalized.length <= 160) return normalized
  return `${normalized.slice(0, 157)}...`
}

export async function buildAnalysisPromptSection(input: BuildAnalysisPromptSectionInput): Promise<AnalysisPromptSectionOutput> {
  const contract = buildAnalysisPromptContract({
    promptText: input.promptText,
    goalContract: input.goalContract,
    attemptAcceptanceCriteria: input.attemptAcceptanceCriteria
  })
  const contractEvidence = buildSectionEvidence(input.reviewContract)
  const directEvidence = buildDirectContractEvidence(contract, input.responseText)
  const evidence = mergeEvidenceLayers(contractEvidence, directEvidence)
  const working = buildWorkingBullets(contract, evidence)
  const gaps = buildGapBullets(contract, evidence)
  const requestModel = buildAnalysisRequestModel({
    promptText: input.promptText,
    promptContract: contract,
    goalContract: input.goalContract,
    taskFamily: input.taskFamily
  })
  const answerModel = buildAnalysisAnswerModel({
    responseText: input.responseText,
    promptText: input.promptText,
    taskFamily: input.taskFamily
  })
  const baselineJudgments = rankAnalysisJudgments({
    judgments: [
      ...buildBaselineJudgments({
        working,
        gaps,
        promptText: input.promptText,
        responseText: input.responseText,
        contract
      }),
      ...buildSlotJudgments({
        requestModel,
        answerModel
      })
    ],
    requestModel,
    answerModel
  })
  const baselineNextMove = buildBaselineNextMove({
    requestModel,
    working,
    gaps
  })

  const llmJudgeResult = await runAnalysisLlmJudge({
    requestModel,
    answerModel,
    working,
    gaps,
    baselineVerdicts: baselineJudgments,
    taskType: input.taskFamily,
    judgePrompt: input.refineNextMovePrompt
      ? ({ prompt, answers, taskType }) =>
          input.refineNextMovePrompt!({
            prompt,
            answers,
            taskType: taskType as ReviewTaskType
          })
      : undefined
  })

  const validatedJudge = validateAnalysisJudgeResult({
    judgeResult: llmJudgeResult,
    requestModel,
    answerModel,
    baselineWorking: working,
    baselineGaps: gaps,
    baselineNextMove,
    baselineJudgments
  })

  const smartNextMove = buildValidatedNextMove({
    requestModel,
    judgments: validatedJudge.verdicts,
    noRetryNeeded: validatedJudge.noRetryNeeded
  })

  const refinementPrompt = buildRefinementPrompt({
    contract,
    judgments: validatedJudge.verdicts,
    responseText: input.responseText
  })

  const refineAnswers = {
    task_goal: contract.taskGoal.join(" | "),
    requirements: contract.requirements.join(" | "),
    constraints: contract.constraints.join(" | "),
    acceptance_criteria: contract.acceptanceCriteria.join(" | "),
    actual_output_to_evaluate: contract.actualOutputToEvaluate.join(" | "),
    ranked_unresolved: validatedJudge.verdicts
      .filter((judgment) => judgment.status !== "met")
      .slice(0, 5)
      .map((judgment) => `${judgment.label} (${judgment.status}, usefulness ${judgment.usefulness})`)
      .join(" | "),
    action: "Return a narrow retry prompt that fixes only the unresolved items."
  }

  let refined: string | null = null
  if (input.refineNextMovePrompt && !validatedJudge.noRetryNeeded) {
    try {
      refined = await input.refineNextMovePrompt({
        prompt: refinementPrompt,
        answers: refineAnswers,
        taskType: input.taskFamily
      })
    } catch {
      refined = null
    }
  }

  const refinedPrompt = normalizeText(refined || "")
  const candidateNextMove = refinedPrompt || validatedJudge.nextMove || smartNextMove
  const normalizedNextMove = shouldRejectGeneratedNextMove({
    nextMove: candidateNextMove,
    working: validatedJudge.working,
    gaps: validatedJudge.gaps,
    responseText: input.responseText,
    contract
  })
    ? smartNextMove
    : candidateNextMove

  const debug: ReviewAnalysisDebugPayload = {
    promptVersion: validatedJudge.promptVersion,
    selectedPath: validatedJudge.selectedPath,
    comparisonSummary:
      validatedJudge.selectedPath === "smart"
        ? `Smart analysis selected over baseline using ${validatedJudge.verdicts.filter((item) => item.status !== "met").length} ranked unresolved judgments.`
        : "Baseline analysis kept because the smart judge was unavailable or insufficiently grounded.",
    baseline: {
      working,
      gaps,
      nextMove: baselineNextMove,
      judgments: baselineJudgments
    },
    smart: {
      working: validatedJudge.working,
      gaps: validatedJudge.gaps,
      nextMove: normalizedNextMove,
      judgments: validatedJudge.verdicts,
      judgeNotes: validatedJudge.judgeNotes,
      validatorNotes: validatedJudge.validatorNotes
    }
  }

  return {
    promptLabel: "Next move",
    promptText: normalizedNextMove,
    promptNote: "",
    nextMoveShort: shortenNextMove(normalizedNextMove),
    copyPromptText: normalizedNextMove,
    contract,
    working: validatedJudge.working,
    gaps: validatedJudge.gaps,
    debug
  }
}
