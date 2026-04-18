import type { AnalysisAnswerModel } from "./analysis-answer-model"
import type { AnalysisRequestModel } from "./analysis-request-model"
import { extractEvidenceSpans } from "./analysis-evidence-spans"
import { getAnalysisSlotSchemas, type AnalysisSlotSchema } from "./analysis-slot-schemas"
import type { ReviewAnalysisJudgment } from "./contracts"

export type AnalysisSlotValue = {
  id: string
  label: string
  content: string[]
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeLower(value: string) {
  return normalize(value).toLowerCase()
}

function unique(values: string[]) {
  return [...new Set(values.map((item) => normalize(item)).filter(Boolean))]
}

function sectionValues(requestModel: AnalysisRequestModel, section: AnalysisSlotSchema["section"]) {
  switch (section) {
    case "taskGoal":
      return requestModel.taskGoal
    case "requirements":
      return requestModel.requirements
    case "constraints":
      return requestModel.constraints
    case "acceptanceCriteria":
      return requestModel.acceptanceCriteria
    case "actualOutputToEvaluate":
      return requestModel.outputRequirements
  }
}

export function buildAnalysisRequestSlots(requestModel: AnalysisRequestModel) {
  return getAnalysisSlotSchemas(requestModel.artifactFamily).map((schema) => {
    const values = sectionValues(requestModel, schema.section)
      .filter((value) => schema.keywords.some((keyword) => normalizeLower(value).includes(keyword)))
    return {
      id: schema.id,
      label: schema.label,
      content: unique(values)
    } satisfies AnalysisSlotValue
  })
}

function buildAnswerSlotContent(schema: AnalysisSlotSchema, answerModel: AnalysisAnswerModel) {
  const raw = answerModel.rawAnswer
  const lower = normalizeLower(raw)
  switch (schema.id) {
    case "subject":
      return answerModel.subjectLine ? [answerModel.subjectLine] : []
    case "times":
      return answerModel.exactUtcTimeOptions
    case "confirmation":
      return answerModel.asksForConfirmation ? ["Confirmation request present"] : []
    case "calendar":
      return answerModel.mentionsCalendarUpdate ? ["Calendar update present"] : []
    case "ingredients":
      return answerModel.hasIngredients ? ["Ingredients section present"] : []
    case "steps":
      return answerModel.hasInstructions ? ["Instructions present"] : []
    case "macros":
      return answerModel.hasMacroBreakdown || answerModel.hasCalorieInfo ? ["Macros/calories present"] : []
    case "servings":
      return answerModel.servingCount ? [`Servings ${answerModel.servingCount.min}-${answerModel.servingCount.max}`] : []
    case "time":
      return answerModel.minutes != null ? [`${answerModel.minutes} minutes`] : []
    case "proof":
      return /\btest\b|\bverify\b|\bverified\b|\bsmoke\b|\bregression\b|\bworks when\b/.test(lower) ? ["Verification or proof present"] : []
    case "file_scope":
      return raw.match(/\b[\w./-]+\.(?:ts|tsx|js|jsx|css|html|json|md)\b/g)?.slice(0, 4) ?? []
    case "target_artifact":
      return raw.match(/\bcomponent\b|\bpage\b|\bendpoint\b|\bfunction\b|\bpatch\b|\bdiff\b|\bprompt\b/gi)?.slice(0, 4) ?? []
    case "expected_behavior":
      return /\bshould\b|\bexpected\b/.test(lower) ? ["Expected behavior stated"] : []
    case "actual_behavior":
      return /\bactual\b|\bcurrently\b|\binstead\b/.test(lower) ? ["Actual behavior stated"] : []
    case "repro":
      return /\bsteps?\b|\brepro\b|\bafter clicking\b|\bon load\b/.test(lower) ? ["Reproduction details present"] : []
    case "environment":
      return raw.match(/\b(?:chrome|firefox|safari|react|next\.js|node|extension|api|mobile|desktop)\b/gi)?.slice(0, 4) ?? []
    case "change_scope":
      return /\bonly change\b|\bdo not change\b|\bpreserve\b/.test(lower) ? ["Scope boundary stated"] : []
    case "acceptance":
    case "done":
      return /\bacceptance\b|\bdefinition of complete\b|\bsuccess\b|\bdone\b/.test(lower) ? ["Acceptance or done condition stated"] : []
    default:
      return []
  }
}

export function buildAnalysisAnswerSlots(answerModel: AnalysisAnswerModel) {
  return getAnalysisSlotSchemas(answerModel.artifactFamily).map((schema) => ({
    id: schema.id,
    label: schema.label,
    content: unique(buildAnswerSlotContent(schema, answerModel))
  }))
}

export function buildSlotJudgments(input: {
  requestModel: AnalysisRequestModel
  answerModel: AnalysisAnswerModel
}): ReviewAnalysisJudgment[] {
  const requestSlots = buildAnalysisRequestSlots(input.requestModel)
  const answerSlots = buildAnalysisAnswerSlots(input.answerModel)
  const answerMap = new Map(answerSlots.map((slot) => [slot.id, slot]))
  const schemas = getAnalysisSlotSchemas(input.requestModel.artifactFamily)

  return requestSlots
    .filter((slot) => slot.content.length > 0)
    .map((slot, index) => {
      const schema = schemas.find((item) => item.id === slot.id)
      const answerSlot = answerMap.get(slot.id)
      const matched = Boolean(answerSlot?.content.length)
      const requestEvidence = extractEvidenceSpans({
        text: input.requestModel.rawPrompt,
        source: "request",
        queries: slot.content
      }).slice(0, 3)
      const answerEvidence = extractEvidenceSpans({
        text: input.answerModel.rawAnswer,
        source: "answer",
        queries: slot.content
      }).slice(0, 3)
      return {
        id: `slot-${index + 1}-${slot.id}`,
        section: schema?.section ?? "requirements",
        label: slot.label,
        status: matched ? "met" : "unclear",
        confidence: matched ? "high" : "medium",
        usefulness: schema?.importance ?? 70,
        rationale: matched
          ? `${slot.label} is explicitly present in the answer.`
          : `${slot.label} is requested but not clearly visible in the answer.`,
        requestEvidence,
        answerEvidence
      } satisfies ReviewAnalysisJudgment
    })
}
