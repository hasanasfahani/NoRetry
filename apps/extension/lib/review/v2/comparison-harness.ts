import type { ClarificationQuestion } from "@prompt-optimizer/shared/src/schemas"
import type { ReviewPromptModeV2RequestType } from "./request-types"
import type { ReviewPromptModeV2Validation } from "./prompt-mode-v2-assembly"

export type PromptModeComparisonCase = {
  id: string
  label: string
  taskType: ReviewPromptModeV2RequestType
  promptText: string
  beforeIntent: "BUILD" | "DEBUG" | "REFACTOR" | "EXPLAIN" | "DESIGN_UI" | "OTHER"
  legacy: {
    questions: Array<{
      id: string
      label: string
      helper: string
      options: string[]
      answer: string
    }>
  }
  v2: {
    clarifyingAnswer?: string
    answers: Array<{
      sectionId?: string
      questionIdContains?: string
      answer: string | string[]
      other?: string
    }>
  }
}

export type PromptModeComparisonPromptResult = {
  questions: Array<{ label: string; helper: string }>
  promptDraft: string
  validation?: ReviewPromptModeV2Validation | null
}

export type PromptModeComparisonScores = {
  questionRelevance: number
  redundancy: number
  promptQuality: number
  unresolvedGaps: number
  usefulness: number
  likelyRetryReduction: number
  userFriction: number
}

export type PromptModeComparisonSummary = {
  legacy: PromptModeComparisonScores
  v2: PromptModeComparisonScores
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function hasAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text))
}

function inferCaseSignals(promptText: string) {
  const normalized = normalize(promptText)
  return {
    mentionsOutput: hasAny(normalized, [/\boutput\b/, /\breturn\b/, /\bformat\b/, /\bfile\b/, /\bingredients\b/, /\binstructions\b/, /\bprompt\b/]),
    mentionsConstraints: hasAny(normalized, [/\bunder\b/, /\bmax\b/, /\bno\b/, /\bwithout\b/, /\bonly\b/, /\bmust\b/, /\brequire\b/]),
    mentionsEnvironment: hasAny(normalized, [/\bbrowser\b/, /\bproduction\b/, /\bextension\b/, /\bframework\b/, /\bplatform\b/, /\benvironment\b/]),
    mentionsProblem: hasAny(normalized, [/\berror\b/, /\bbug\b/, /\bfail\b/, /\bproblem\b/, /\bexpected\b/, /\bactual\b/]),
    mentionsAudience: hasAny(normalized, [/\baudience\b/, /\buser\b/, /\bcustomer\b/, /\bteam\b/])
  }
}

function questionLooksRelevant(question: { label: string; helper?: string }, promptText: string) {
  const combined = normalize(`${question.label} ${question.helper ?? ""}`)
  const promptSignals = inferCaseSignals(promptText)

  if (questionLooksGeneric(question)) return false
  if (promptSignals.mentionsConstraints && hasAny(combined, [/\bconstraint\b/, /\btime\b/, /\bformat\b/, /\bpreserve\b/, /\boutput\b/])) return true
  if (promptSignals.mentionsEnvironment && hasAny(combined, [/\benvironment\b/, /\bplatform\b/, /\btarget\b/, /\bshipping\b/, /\bcontext\b/])) return true
  if (promptSignals.mentionsProblem && hasAny(combined, [/\bactual\b/, /\bexpected\b/, /\bevidence\b/, /\bfix\b/, /\bproof\b/])) return true
  if (promptSignals.mentionsAudience && hasAny(combined, [/\bcontext\b/, /\baudience\b/, /\buser\b/, /\bbusiness\b/])) return true
  return hasAny(combined, [/\bgoal\b/, /\brequirement\b/, /\bconstraint\b/, /\bformat\b/, /\bcomplete\b/])
}

function questionLooksGeneric(question: { label: string; helper?: string }) {
  const combined = normalize(`${question.label} ${question.helper ?? ""}`)
  return hasAny(combined, [
    /\bwhat matters most\b/,
    /\bwhat should the next prompt lock down first\b/,
    /\bwhat should the ai create first\b/,
    /\banything else\b/
  ])
}

function questionCategory(question: { label: string; helper?: string }) {
  const combined = normalize(`${question.label} ${question.helper ?? ""}`)
  if (hasAny(combined, [/\bgoal\b/, /\boutcome\b/, /\bobjective\b/])) return "goal"
  if (hasAny(combined, [/\bcontext\b/, /\benvironment\b/, /\baudience\b/, /\buser\b/])) return "context"
  if (hasAny(combined, [/\brequirement\b/, /\bconstraint\b/, /\btime\b/, /\bpreserve\b/])) return "constraints"
  if (hasAny(combined, [/\boutput\b/, /\bformat\b/, /\bfile\b/, /\bingredients\b/, /\binstructions\b/])) return "output"
  if (hasAny(combined, [/\bproof\b/, /\bverify\b/, /\btest\b/])) return "proof"
  return "generic"
}

function computeQuestionRelevance(questions: Array<{ label: string; helper?: string }>, promptText: string) {
  if (!questions.length) return 0
  const relevant = questions.filter((question) => questionLooksRelevant(question, promptText)).length
  return Math.round((relevant / questions.length) * 100)
}

function computeRedundancy(questions: Array<{ label: string; helper?: string }>) {
  if (!questions.length) return 0
  const categories = questions.map(questionCategory)
  const duplicates = categories.length - new Set(categories).size
  return Math.round((duplicates / questions.length) * 100)
}

function computePromptQuality(promptDraft: string, promptText: string) {
  const normalizedDraft = normalize(promptDraft)
  const signals = inferCaseSignals(promptText)
  let score = 25
  if (/^task:/m.test(promptDraft)) score += 15
  if (/^before finalizing:/m.test(promptDraft)) score += 10
  if (signals.mentionsConstraints && /^constraints:/m.test(promptDraft)) score += 15
  if (signals.mentionsOutput && /^output format:/m.test(promptDraft)) score += 15
  if (signals.mentionsProblem && /^actual behavior:/m.test(promptDraft) && /^expected behavior:/m.test(promptDraft)) score += 20
  if (signals.mentionsAudience && /^context:/m.test(promptDraft)) score += 10
  if (normalizedDraft.includes("it is complete only if")) score += 10
  return Math.min(100, score)
}

function computeUnresolvedGapPenalty(validation: ReviewPromptModeV2Validation | null | undefined, promptDraft: string) {
  if (validation) {
    return Math.min(100, validation.missingItems.length * 20 + validation.contradictions.length * 25 + validation.assumedItems.length * 8)
  }

  const genericMarkers = (promptDraft.match(/Assumption:|Missing:|Contradiction:/g) ?? []).length
  return Math.min(100, genericMarkers * 18)
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function evaluatePromptModeComparison(params: {
  promptText: string
  result: PromptModeComparisonPromptResult
}) {
  const { promptText, result } = params
  const questionRelevance = computeQuestionRelevance(result.questions, promptText)
  const redundancy = computeRedundancy(result.questions)
  const promptQuality = computePromptQuality(result.promptDraft, promptText)
  const unresolvedGaps = computeUnresolvedGapPenalty(result.validation, result.promptDraft)
  const usefulness = clamp(Math.round(promptQuality * 0.55 + questionRelevance * 0.25 - unresolvedGaps * 0.2), 0, 100)
  const likelyRetryReduction = clamp(Math.round(usefulness * 0.6 + (100 - unresolvedGaps) * 0.4), 0, 100)
  const userFriction = clamp(Math.round(result.questions.length * 9 + redundancy * 0.4), 0, 100)

  return {
    questionRelevance,
    redundancy,
    promptQuality,
    unresolvedGaps,
    usefulness,
    likelyRetryReduction,
    userFriction
  } satisfies PromptModeComparisonScores
}

export function summarizePromptModeComparison(params: {
  promptText: string
  legacy: PromptModeComparisonPromptResult
  v2: PromptModeComparisonPromptResult
}) {
  return {
    legacy: evaluatePromptModeComparison({
      promptText: params.promptText,
      result: params.legacy
    }),
    v2: evaluatePromptModeComparison({
      promptText: params.promptText,
      result: params.v2
    })
  } satisfies PromptModeComparisonSummary
}

export function toLegacyClarificationQuestions(caseData: PromptModeComparisonCase) {
  return caseData.legacy.questions.map(
    (question) =>
      ({
        id: question.id,
        label: question.label,
        helper: question.helper,
        mode: "single",
        options: question.options
      }) satisfies ClarificationQuestion
  )
}
