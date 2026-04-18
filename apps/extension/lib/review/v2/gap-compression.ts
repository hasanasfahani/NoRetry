import type { ReviewPromptModeV2Question } from "../types"
import type { ReviewPromptModeV2RequestType } from "./request-types"
import type { ReviewPromptModeV2SectionState, ReviewPromptModeV2SectionStatus } from "./section-schemas"

export type ReviewPromptModeV2MergeConfidence = "high" | "medium" | "low"

export type ReviewPromptModeV2MergeResult = {
  sections: ReviewPromptModeV2SectionState[]
  additionalNotes: string[]
}

type NoteMapping = {
  note: string
  targetSectionId: string | null
  confidence: ReviewPromptModeV2MergeConfidence
  reason: string
}

type SectionKeywordMap = Record<string, string[]>

const BASE_SECTION_KEYWORDS: SectionKeywordMap = {
  goal: ["goal", "outcome", "create", "build", "write", "generate", "compose", "main thing"],
  context: ["context", "background", "who", "audience", "user", "customer", "where used", "source material"],
  requirements: ["must include", "required", "include", "need", "must have", "feature", "ingredient", "part"],
  constraints: ["constraint", "under", "within", "max", "minimum", "at least", "do not", "avoid", "limit", "only"],
  output_format: ["format", "return", "output", "section", "bullet", "table", "matrix", "code block", "copy-ready"],
  definition_of_complete: ["complete", "done when", "success", "definition of complete", "ready", "finish line"],
  note_box: ["note", "keep in mind", "watch out", "important"],
  current_state: ["current", "existing", "right now", "today", "baseline"],
  requested_change: ["change", "modify", "update", "replace", "add", "remove", "revise"],
  scope_boundaries: ["scope", "out of scope", "only", "do not touch", "limit"],
  preserve_rules: ["preserve", "keep", "without breaking", "do not change", "stay the same"],
  expected_behavior: ["expected", "should", "working", "supposed to"],
  actual_behavior: ["actual", "instead", "currently", "fails", "error", "bug"],
  evidence: ["evidence", "log", "trace", "screenshot", "repro", "steps"],
  environment_context: ["environment", "browser", "runtime", "framework", "platform", "version"],
  desired_ai_help: ["help", "diagnose", "fix", "plan", "verify", "want from the ai"],
  fix_proof: ["proof", "verify", "test", "check", "confirmed fixed"],
  objective: ["objective", "goal", "trying to achieve"],
  product_context: ["product", "feature", "roadmap", "launch", "surface"],
  user_business_context: ["user", "customer", "business", "revenue", "market", "stakeholder"],
  decision_problem: ["decision", "problem", "should we", "trade-off", "choose"],
  requirements_considerations: ["consideration", "requirement", "must weigh", "important factor"],
  tradeoffs_constraints: ["trade-off", "constraint", "limit", "risk", "tension"],
  desired_output: ["recommendation", "memo", "framework", "output", "deliverable"],
  current_status: ["status", "blocked", "ready", "rough", "qa"],
  target_environment: ["production", "staging", "environment", "platform", "browser extension", "mobile", "api"],
  release_requirements: ["release", "ship", "launch", "checklist", "approval", "qa sign-off"],
  known_risks: ["risk", "blocker", "issue", "regression", "dependency"],
  needed_output: ["plan", "checklist", "risk review", "ship-ready prompt", "needed output"],
  readiness_check: ["readiness", "smoke test", "operational", "core functionality"],
  post_ship_verification: ["post-ship", "after launch", "monitor", "rollback", "verify after shipping"],
  purpose: ["for", "used to", "purpose", "meant to"],
  current_failure: ["failure", "too vague", "wrong", "not working", "problem"],
  desired_improvement: ["improve", "better", "clearer", "more reliable", "shorter"],
  execution_context: ["context", "chat model", "coding assistant", "research assistant", "high-stakes"]
}

const TASK_TYPE_SECTION_ORDER: Record<ReviewPromptModeV2RequestType, string[]> = {
  creation: ["goal", "context", "requirements", "constraints", "output_format", "definition_of_complete"],
  modification: ["current_state", "requested_change", "scope_boundaries", "preserve_rules", "output_format", "definition_of_complete"],
  problem_solving: ["expected_behavior", "actual_behavior", "evidence", "environment_context", "desired_ai_help", "fix_proof"],
  product_thinking: [
    "objective",
    "product_context",
    "user_business_context",
    "decision_problem",
    "requirements_considerations",
    "tradeoffs_constraints",
    "desired_output",
    "definition_of_complete"
  ],
  shipping: [
    "current_status",
    "target_environment",
    "release_requirements",
    "known_risks",
    "needed_output",
    "readiness_check",
    "post_ship_verification",
    "definition_of_complete"
  ],
  prompt_optimization: ["purpose", "current_failure", "desired_improvement", "execution_context", "output_format"]
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))]
}

function splitNoteContent(noteText: string) {
  return noteText
    .split(/\n+|[;]+|(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function keywordMatches(text: string, keywords: string[]) {
  return keywords.reduce((count, keyword) => (text.includes(keyword) ? count + 1 : count), 0)
}

function sectionKeywords(taskType: ReviewPromptModeV2RequestType, sectionId: string) {
  const base = BASE_SECTION_KEYWORDS[sectionId] ?? []
  if (taskType === "creation" && sectionId === "constraints") {
    return [...base, "under", "within", "oil", "heat", "calorie", "time", "method"]
  }
  if (taskType === "shipping" && sectionId === "target_environment") {
    return [...base, "browser", "extension", "production", "staging", "deploy"]
  }
  if (taskType === "problem_solving" && sectionId === "evidence") {
    return [...base, "stack trace", "output", "console", "screenshot"]
  }
  return base
}

function buildSnippet(question: ReviewPromptModeV2Question, text: string) {
  return `${question.label}: ${text.trim()}`
}

function findConflicts(existingValues: string[], questionLabel: string, nextText: string) {
  const prefix = `${questionLabel}:`
  return existingValues
    .filter((item) => item.startsWith(prefix) && normalize(item) !== normalize(`${prefix} ${nextText}`))
    .map((item) => `Conflicting input for ${questionLabel}: ${item.replace(prefix, "").trim()} vs ${nextText}`)
}

function buildUnresolvedGaps(section: ReviewPromptModeV2SectionState, contentCount: number, contradictions: string[]) {
  const nextGaps: string[] = []
  const remaining = Math.max(0, section.targetQuestionRange.min - contentCount)

  if (contradictions.length) {
    nextGaps.push("Resolve conflicting details before final prompt assembly.")
  }

  if (remaining > 0) {
    nextGaps.push(`Need ${remaining} more concrete detail${remaining === 1 ? "" : "s"} for ${section.label.toLowerCase()}.`)
  } else if (section.status === "partially_resolved") {
    nextGaps.push(`One or more details for ${section.label.toLowerCase()} still need tightening.`)
  }

  return uniqueStrings(nextGaps)
}

function deriveStatus(section: ReviewPromptModeV2SectionState, resolvedContent: string[], partialContent: string[], contradictions: string[]): ReviewPromptModeV2SectionStatus {
  if (contradictions.length) return "partially_resolved"
  const contentCount = resolvedContent.length + partialContent.length
  if (contentCount >= section.targetQuestionRange.min) return "resolved"
  if (contentCount > 0) return "partially_resolved"
  return "unresolved"
}

function mergeIntoSection(params: {
  section: ReviewPromptModeV2SectionState
  snippet: string
  confidence: ReviewPromptModeV2MergeConfidence
}) {
  const { section, snippet, confidence } = params
  const combinedExisting = uniqueStrings([...section.resolvedContent, ...section.partialContent, ...section.resolvedSignals])
  const questionLabel = snippet.split(":")[0] ?? section.label
  const snippetValue = snippet.includes(":") ? snippet.split(":").slice(1).join(":").trim() : snippet
  const contradictions = uniqueStrings([...section.contradictions, ...findConflicts(combinedExisting, questionLabel, snippetValue)])
  const resolvedContent =
    confidence === "high"
      ? uniqueStrings([...section.resolvedContent, snippet])
      : section.resolvedContent
  const partialContent =
    confidence === "high"
      ? uniqueStrings(section.partialContent)
      : uniqueStrings([...section.partialContent, snippet])
  const status = deriveStatus(section, resolvedContent, partialContent, contradictions)
  const contentCount = resolvedContent.length + partialContent.length

  return {
    ...section,
    askedCount: Math.min(Math.max(section.askedCount, contentCount), section.targetQuestionRange.max),
    resolvedSignals: uniqueStrings([...section.resolvedSignals, snippet]),
    resolvedContent,
    partialContent,
    contradictions,
    status,
    unresolvedGaps: buildUnresolvedGaps({ ...section, status }, contentCount, contradictions)
  } satisfies ReviewPromptModeV2SectionState
}

function mapNoteToSection(params: {
  note: string
  taskType: ReviewPromptModeV2RequestType
  sections: ReviewPromptModeV2SectionState[]
}): NoteMapping {
  const normalizedNote = normalize(params.note)
  const ranked = params.sections
    .filter((section) => section.id !== "note_box")
    .map((section) => ({
      sectionId: section.id,
      score: keywordMatches(normalizedNote, sectionKeywords(params.taskType, section.id))
    }))
    .sort((left, right) => right.score - left.score)

  const top = ranked[0]
  const second = ranked[1]
  if (!top || top.score <= 0) {
    return {
      note: params.note,
      targetSectionId: null,
      confidence: "low",
      reason: "No section had strong enough keyword overlap."
    }
  }

  if (top.score >= 2 && (!second || top.score >= second.score + 1)) {
    return {
      note: params.note,
      targetSectionId: top.sectionId,
      confidence: "high",
      reason: "The note strongly matched one section."
    }
  }

  if (top.score === 1 && (!second || second.score === 0)) {
    return {
      note: params.note,
      targetSectionId: top.sectionId,
      confidence: "medium",
      reason: "The note weakly matched one section but may need confirmation."
    }
  }

  return {
    note: params.note,
    targetSectionId: null,
    confidence: "low",
    reason: "The note overlapped multiple sections too ambiguously."
  }
}

function mergeNoteBox(params: {
  taskType: ReviewPromptModeV2RequestType
  sections: ReviewPromptModeV2SectionState[]
  question: ReviewPromptModeV2Question
  noteText: string
  additionalNotes: string[]
}) {
  let nextSections = params.sections
  let nextAdditionalNotes = [...params.additionalNotes]

  for (const note of splitNoteContent(params.noteText)) {
    const mapping = mapNoteToSection({
      note,
      taskType: params.taskType,
      sections: nextSections
    })

    if (!mapping.targetSectionId || mapping.confidence === "low") {
      nextAdditionalNotes = uniqueStrings([...nextAdditionalNotes, `${note} (not yet merged)`])
      continue
    }

    nextSections = nextSections.map((section) => {
      if (section.id !== mapping.targetSectionId) return section
      return mergeIntoSection({
        section,
        snippet: buildSnippet(params.question, note),
        confidence: mapping.confidence === "high" ? "high" : "medium"
      })
    })
  }

  nextSections = nextSections.map((section) =>
    section.id === "note_box"
      ? mergeIntoSection({
          section,
          snippet: buildSnippet(params.question, params.noteText),
          confidence: "medium"
        })
      : section
  )

  return {
    sections: nextSections,
    additionalNotes: uniqueStrings(nextAdditionalNotes)
  } satisfies ReviewPromptModeV2MergeResult
}

export function mergePromptModeV2Answer(params: {
  taskType: ReviewPromptModeV2RequestType
  sections: ReviewPromptModeV2SectionState[]
  question: ReviewPromptModeV2Question
  answerValue: string | string[]
  otherValue?: string
  additionalNotes: string[]
}) {
  const { question, otherValue = "" } = params
  const answerText =
    typeof params.answerValue === "string"
      ? params.answerValue.trim()
      : uniqueStrings([...params.answerValue, otherValue]).join(", ")

  if (!answerText) {
    return {
      sections: params.sections,
      additionalNotes: params.additionalNotes
    } satisfies ReviewPromptModeV2MergeResult
  }

  if (question.sectionId === "note_box") {
    return {
      sections: params.sections.map((section) => {
        if (section.id !== question.sectionId) return section
        return mergeIntoSection({
          section,
          snippet: buildSnippet(question, answerText),
          confidence: "high"
        })
      }),
      additionalNotes: params.additionalNotes
    } satisfies ReviewPromptModeV2MergeResult
  }

  return {
    sections: params.sections.map((section) => {
      if (section.id !== question.sectionId) return section
      return mergeIntoSection({
        section,
        snippet: buildSnippet(question, answerText),
        confidence: "high"
      })
    }),
    additionalNotes: params.additionalNotes
  } satisfies ReviewPromptModeV2MergeResult
}

export function computePromptModeV2QuestionPriorityOrder(taskType: ReviewPromptModeV2RequestType, sections: ReviewPromptModeV2SectionState[]) {
  const order = TASK_TYPE_SECTION_ORDER[taskType] ?? []
  return [...sections].sort((left, right) => {
    const leftIndex = order.indexOf(left.id)
    const rightIndex = order.indexOf(right.id)
    const leftBase = leftIndex === -1 ? order.length : leftIndex
    const rightBase = rightIndex === -1 ? order.length : rightIndex
    if (leftBase !== rightBase) return leftBase - rightBase
    const leftResolvedWeight = left.status === "unresolved" ? 0 : left.status === "partially_resolved" ? 1 : 2
    const rightResolvedWeight = right.status === "unresolved" ? 0 : right.status === "partially_resolved" ? 1 : 2
    if (leftResolvedWeight !== rightResolvedWeight) return leftResolvedWeight - rightResolvedWeight
    if (left.askedCount !== right.askedCount) return left.askedCount - right.askedCount
    return left.label.localeCompare(right.label)
  })
}
