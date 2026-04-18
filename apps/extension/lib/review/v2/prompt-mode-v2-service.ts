import { analyzePromptLocally } from "@prompt-optimizer/shared/src/analyzePrompt"
import type { AnalyzePromptResponse } from "@prompt-optimizer/shared/src/schemas"
import { normalizeGoalContract } from "../../goal/goal-normalizer"
import type { GoalContract } from "../../goal/types"
import type { ReviewPromptModeV2Question, ReviewPromptModeV2State } from "../types"
import type {
  ReviewPromptModeV2IntentConfidence,
  ReviewPromptModeV2RequestType,
  ReviewPromptModeV2TaskTypeChip
} from "./request-types"
import { REVIEW_PROMPT_MODE_V2_TYPE_LABELS, resolvePromptModeV2TemplateKind } from "./request-types"
import {
  buildPromptModeV2SectionStates,
  REVIEW_PROMPT_MODE_V2_SECTION_SCHEMAS,
  type ReviewPromptModeV2QuestionTemplate,
  type ReviewPromptModeV2SectionState
} from "./section-schemas"
import { computePromptModeV2QuestionPriorityOrder, mergePromptModeV2Answer } from "./gap-compression"
import { buildGroundedPromptModeV2Question, buildPromptModeV2FollowupQuestion } from "./question-grounding"
import { buildPromptModeV2QuestionBrief } from "./question-briefs"

export type PromptModeV2IntentAssessment = {
  goalContract: GoalContract
  localAnalysis: AnalyzePromptResponse
  likelyTaskTypes: ReviewPromptModeV2TaskTypeChip[]
  confidence: ReviewPromptModeV2IntentConfidence
  clarifyingQuestion: string | null
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function buildChip(type: ReviewPromptModeV2RequestType, reason: string, suggested = true): ReviewPromptModeV2TaskTypeChip {
  return {
    type,
    label: REVIEW_PROMPT_MODE_V2_TYPE_LABELS[type],
    suggested,
    reason
  }
}

function uniqueChips(chips: ReviewPromptModeV2TaskTypeChip[]) {
  const seen = new Set<ReviewPromptModeV2RequestType>()
  return chips.filter((chip) => {
    if (seen.has(chip.type)) return false
    seen.add(chip.type)
    return true
  })
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))]
}

function inferLikelyTaskTypes(params: {
  promptText: string
  goalContract: GoalContract
  localAnalysis: AnalyzePromptResponse
}) {
  const { promptText, goalContract, localAnalysis } = params
  const normalizedPrompt = normalize(promptText)
  const chips: ReviewPromptModeV2TaskTypeChip[] = []

  if (/\bfix\b|\bdebug\b|\bproblem\b|\berror\b|\bwhy\b|\bissue\b|\bbroken\b/.test(normalizedPrompt) || localAnalysis.intent === "DEBUG") {
    chips.push(buildChip("problem_solving", "The request reads like a concrete problem or bug to solve."))
  }

  if (/\bedit\b|\bmodify\b|\bupdate\b|\bchange\b|\brefactor\b|\bimprove\b|\bpolish\b|\brevise\b|\brewrite\b/.test(normalizedPrompt)) {
    chips.push(buildChip("modification", "The request focuses on changing or refining something existing."))
  }

  if (
    goalContract.deliverableType === "prompt" ||
    goalContract.deliverableType === "recipe" ||
    goalContract.deliverableType === "html_file" ||
    goalContract.deliverableType === "recommendation" ||
    goalContract.deliverableType === "research" ||
    /\bship\b|\blaunch\b|\brelease\b|\bdeploy\b|\bgo live\b|\bhand off\b|\bqa\b/.test(normalizedPrompt) ||
    /\bstrategy\b|\broadmap\b|\bpositioning\b|\bproduct\b|\bpricing\b|\bgtm\b|\bgrowth\b/.test(normalizedPrompt) ||
    /\bprompt\b|\brewrite this prompt\b|\boptimi[sz]e this prompt\b/.test(normalizedPrompt) ||
    /\bcreate\b|\bbuild\b|\bwrite\b|\bgenerate\b|\bcompose\b|\bdraft\b|\bmake\b/.test(normalizedPrompt) ||
    localAnalysis.intent === "BUILD"
  ) {
    chips.push(buildChip("creation", "The request is asking for a new deliverable or first draft."))
  }

  if (!chips.length) {
    chips.push(
      buildChip("creation", "This looks like a request for a concrete output."),
      buildChip("problem_solving", "This may be asking the AI to resolve a specific issue."),
      buildChip("modification", "This may be asking for a change to something existing.")
    )
  }

  return uniqueChips(chips).slice(0, 3)
}

function inferIntentConfidence(params: {
  promptText: string
  goalContract: GoalContract
  localAnalysis: AnalyzePromptResponse
  likelyTaskTypes: ReviewPromptModeV2TaskTypeChip[]
}): ReviewPromptModeV2IntentConfidence {
  const { promptText, goalContract, localAnalysis, likelyTaskTypes } = params
  const normalizedPrompt = normalize(promptText)

  const hasDeliverable = Boolean(goalContract.deliverableType)
  const hardConstraintCount = goalContract.hardConstraints.length
  const multipleStrongSignals = likelyTaskTypes.length >= 2
  const lowSignalPrompt = normalizedPrompt.split(/\s+/).filter(Boolean).length < 5

  if (hasDeliverable && hardConstraintCount >= 2 && localAnalysis.score >= 70) return "high"
  if (lowSignalPrompt || (!hasDeliverable && hardConstraintCount === 0) || !multipleStrongSignals) return "low"
  return "medium"
}

function buildClarifyingQuestion(params: {
  confidence: ReviewPromptModeV2IntentConfidence
  likelyTaskTypes: ReviewPromptModeV2TaskTypeChip[]
  goalContract: GoalContract
}) {
  const { confidence, likelyTaskTypes, goalContract } = params
  if (confidence !== "low") return null

  if (!goalContract.deliverableType && !goalContract.hardConstraints.length) {
    return "What are you mainly trying to accomplish with this request before we start filling sections?"
  }

  const firstType = likelyTaskTypes[0]?.label ?? "task"
  return `Before we build sections, what is the main outcome you want from this ${firstType.toLowerCase()} request?`
}

function buildQuestionId(taskType: ReviewPromptModeV2RequestType, sectionId: string, template: ReviewPromptModeV2QuestionTemplate) {
  return `pmv2:${taskType}:${sectionId}:${template.id}`
}

function buildBriefQuestionId(taskType: ReviewPromptModeV2RequestType, sectionId: string, focusId: string) {
  return `pmv2:${taskType}:${sectionId}:${focusId}`
}

function questionAlreadyAnswered(question: ReviewPromptModeV2Question, state: Pick<ReviewPromptModeV2State, "answerState" | "otherAnswerState">) {
  const raw = state.answerState[question.id]
  if (Array.isArray(raw)) {
    const hasOther = raw.includes("Other")
    return raw.some((item) => item && item !== "Other") || (hasOther && Boolean(state.otherAnswerState[question.id]?.trim()))
  }
  if (typeof raw === "string") {
    if (raw === "Other") return Boolean(state.otherAnswerState[question.id]?.trim())
    return Boolean(raw.trim())
  }
  return false
}

function buildQuestionFromTemplate(params: {
  taskType: ReviewPromptModeV2RequestType
  promptText: string
  goalContract: GoalContract | null
  section: ReviewPromptModeV2SectionState
  template: ReviewPromptModeV2QuestionTemplate
  additionalNotes: string[]
}): ReviewPromptModeV2Question {
  const { taskType, section, template } = params
  const brief = buildPromptModeV2QuestionBrief({
    taskType,
    promptText: params.promptText,
    goalContract: params.goalContract,
    section,
    additionalNotes: params.additionalNotes,
    depth: "primary"
  })

  if (brief) {
    return {
      id: buildBriefQuestionId(taskType, section.id, brief.focusId),
      sectionId: section.id,
      sectionLabel: section.label,
      label: brief.label,
      helper: brief.helper,
      mode: brief.mode,
      options: brief.options,
      depth: "primary"
    }
  }

  return buildGroundedPromptModeV2Question({
    taskType,
    promptText: params.promptText,
    goalContract: params.goalContract,
    section,
    template,
    additionalNotes: params.additionalNotes,
    id: buildQuestionId(taskType, section.id, template)
  })
}

function hasAnsweredPrimaryTemplates(params: {
  taskType: ReviewPromptModeV2RequestType
  section: ReviewPromptModeV2SectionState
  templates: ReviewPromptModeV2QuestionTemplate[]
  promptText: string
  goalContract: GoalContract | null
  additionalNotes: string[]
  state: Pick<ReviewPromptModeV2State, "answerState" | "otherAnswerState">
}) {
  return params.templates.every((template) =>
    questionAlreadyAnswered(
      buildQuestionFromTemplate({
        taskType: params.taskType,
        promptText: params.promptText,
        goalContract: params.goalContract,
        section: params.section,
        template,
        additionalNotes: params.additionalNotes
      }),
      params.state
    )
  )
}

function buildFollowupQuestion(params: {
  taskType: ReviewPromptModeV2RequestType
  promptText: string
  goalContract: GoalContract | null
  section: ReviewPromptModeV2SectionState
  additionalNotes: string[]
}) {
  const nextAskedCount = params.section.askedCount + 1
  if (nextAskedCount > params.section.targetQuestionRange.max) return null
  const depth = nextAskedCount === 2 ? "secondary" : "tertiary"
  const brief = buildPromptModeV2QuestionBrief({
    taskType: params.taskType,
    promptText: params.promptText,
    goalContract: params.goalContract,
    section: params.section,
    additionalNotes: params.additionalNotes,
    depth
  })

  if (brief) {
    return {
      id: buildBriefQuestionId(params.taskType, params.section.id, `${brief.focusId}:${nextAskedCount}`),
      sectionId: params.section.id,
      sectionLabel: params.section.label,
      label: brief.label,
      helper: brief.helper,
      mode: brief.mode,
      options: brief.options,
      depth
    } satisfies ReviewPromptModeV2Question
  }

  return buildPromptModeV2FollowupQuestion({
    taskType: params.taskType,
    promptText: params.promptText,
    goalContract: params.goalContract,
    section: params.section,
    additionalNotes: params.additionalNotes,
    id: `pmv2:${params.taskType}:${params.section.id}:followup:${nextAskedCount}`,
    depth
  })
}

export function assessPromptModeV2Intent(params: { promptText: string; beforeIntent?: AnalyzePromptResponse["intent"] | null | undefined }) {
  const promptText = params.promptText.trim()
  const localAnalysis = analyzePromptLocally(promptText)
  const goalContract = normalizeGoalContract({
    promptText,
    taskFamily: localAnalysis.intent.toLowerCase()
  })
  const likelyTaskTypes = inferLikelyTaskTypes({
    promptText,
    goalContract,
    localAnalysis
  })
  const confidence = inferIntentConfidence({
    promptText,
    goalContract,
    localAnalysis,
    likelyTaskTypes
  })
  const clarifyingQuestion = buildClarifyingQuestion({
    confidence,
    likelyTaskTypes,
    goalContract
  })

  return {
    goalContract,
    localAnalysis,
    likelyTaskTypes,
    confidence,
    clarifyingQuestion
  } satisfies PromptModeV2IntentAssessment
}

export function initializePromptModeV2Sections(params: {
  taskType: ReviewPromptModeV2RequestType
  promptText: string
  goalContract: GoalContract | null
}) {
  return buildPromptModeV2SectionStates({
    ...params,
    taskType: resolvePromptModeV2TemplateKind(params.taskType)
  })
}

export function buildPromptModeV2NextQuestion(params: {
  taskType: ReviewPromptModeV2RequestType
  promptText: string
  goalContract: GoalContract | null
  sections: ReviewPromptModeV2SectionState[]
  additionalNotes: string[]
  state: Pick<ReviewPromptModeV2State, "answerState" | "otherAnswerState" | "clarifyingQuestion" | "clarifyingAnswer">
}) {
  const { taskType, sections, state, promptText, goalContract, additionalNotes } = params

  const templateKind = resolvePromptModeV2TemplateKind(taskType)
  const schemas = REVIEW_PROMPT_MODE_V2_SECTION_SCHEMAS[templateKind]
  const orderedSections = computePromptModeV2QuestionPriorityOrder(templateKind, sections)
  for (const section of orderedSections) {
    if (section.askedCount >= section.targetQuestionRange.max) continue
    const schema = schemas.find((item) => item.id === section.id)
    if (!schema) continue
    for (const template of schema.questionTemplates) {
      const question = buildQuestionFromTemplate({
        taskType,
        promptText,
        goalContract,
        section,
        template,
        additionalNotes
      })
      if (!questionAlreadyAnswered(question, state)) {
        return question
      }
    }

    if (
      hasAnsweredPrimaryTemplates({
        taskType,
        section,
        templates: schema.questionTemplates,
        promptText,
        goalContract,
        additionalNotes,
        state
      })
    ) {
      const followupQuestion = buildFollowupQuestion({
        taskType,
        promptText,
        goalContract,
        section,
        additionalNotes
      })
      if (followupQuestion && !questionAlreadyAnswered(followupQuestion, state)) {
        return followupQuestion
      }
    }
  }

  return null
}

export function updatePromptModeV2Sections(params: {
  taskType: ReviewPromptModeV2RequestType
  sections: ReviewPromptModeV2SectionState[]
  question: ReviewPromptModeV2Question
  answerValue: string | string[]
  otherValue?: string
  additionalNotes: string[]
}) {
  return mergePromptModeV2Answer({
    taskType: params.taskType,
    sections: params.sections,
    question: params.question,
    answerValue: params.answerValue,
    otherValue: params.otherValue,
    additionalNotes: params.additionalNotes
  })
}
