import type { AnalysisAnswerModel } from "./analysis-answer-model"
import type { AnalysisRequestModel } from "./analysis-request-model"
import type { ReviewAnalysisJudgment } from "./contracts"

const SECTION_WEIGHT: Record<ReviewAnalysisJudgment["section"], number> = {
  constraints: 90,
  acceptanceCriteria: 84,
  actualOutputToEvaluate: 80,
  requirements: 72,
  taskGoal: 64
}

const STATUS_WEIGHT: Record<ReviewAnalysisJudgment["status"], number> = {
  contradicted: 38,
  missing: 30,
  unclear: 18,
  met: 2
}

const CONFIDENCE_WEIGHT: Record<ReviewAnalysisJudgment["confidence"], number> = {
  high: 12,
  medium: 7,
  low: 2
}

const HIGH_VALUE_PATTERNS = [
  /\btable\b/i,
  /\binstructions?\b/i,
  /\bingredients?\b/i,
  /\bmacros?\b/i,
  /\bcalories?\b/i,
  /\bsubject\b/i,
  /\bconfirm\b/i,
  /\bcalendar\b/i,
  /\bgluten\b/i,
  /\bdairy\b/i,
  /\bminutes?\b/i,
  /\bserving\b/i,
  /\bprotein\b/i
]

export function scoreAnalysisJudgmentUsefulness(input: {
  judgment: ReviewAnalysisJudgment
  requestModel: AnalysisRequestModel
  answerModel: AnalysisAnswerModel
}) {
  const { judgment } = input
  const { specificity } = input.requestModel
  const label = judgment.label.toLowerCase()
  let score = SECTION_WEIGHT[judgment.section] + STATUS_WEIGHT[judgment.status] + CONFIDENCE_WEIGHT[judgment.confidence]

  if (judgment.status !== "met" && HIGH_VALUE_PATTERNS.some((pattern) => pattern.test(judgment.label))) {
    score += 12
  }

  if (judgment.status !== "met" && judgment.requestEvidence.length > 0) {
    score += 8
  }

  if (judgment.status === "contradicted" && judgment.answerEvidence.length > 0) {
    score += 6
  }

  if (judgment.status === "unclear" && judgment.answerEvidence.length === 0) {
    score -= 4
  }

  if (input.requestModel.plainOutputPreferred && /\bemail box\b|\bboxed\b|\bcontainer\b/i.test(judgment.label)) {
    score += 5
  }

  if (input.answerModel.hasTable && /\btable\b/i.test(judgment.label) && judgment.status !== "met") {
    score -= 10
  }

  if (!specificity.explicitVerificationRequested && /\bproof\b|\bverify\b|\bverification\b|\btest steps\b|\bregression\b/.test(label)) {
    score -= specificity.broadPromptLikely ? 40 : 18
  }

  if (!specificity.explicitFileScopeRequested && /\bfile\b|\bfiles\b|\bline\b|\blines\b|\bdiff\b|\bpatch\b/.test(label)) {
    score -= specificity.broadPromptLikely ? 36 : 16
  }

  if (!specificity.explicitChangeScopeRequested && /\bonly change\b|\bdo not change\b|\bpreserve\b|\bunrelated\b/.test(label)) {
    score -= specificity.broadPromptLikely ? 28 : 12
  }

  if (!specificity.explicitExactnessRequested && /\bexact change\b|\bexact fix\b|\bitemized\b|\bmore clearly\b/.test(label)) {
    score -= specificity.broadPromptLikely ? 34 : 14
  }

  if (specificity.broadPromptLikely && /\bdeliverable type\b|\bmore clearly\b|\brequested deliverable\b/.test(label)) {
    score -= 32
  }

  if (specificity.broadPromptLikely && judgment.status === "unclear" && judgment.confidence !== "high") {
    score -= 14
  }

  return score
}

export function rankAnalysisJudgments(input: {
  judgments: ReviewAnalysisJudgment[]
  requestModel: AnalysisRequestModel
  answerModel: AnalysisAnswerModel
}) {
  return input.judgments
    .map((judgment) => ({
      ...judgment,
      usefulness: scoreAnalysisJudgmentUsefulness({
        judgment,
        requestModel: input.requestModel,
        answerModel: input.answerModel
      })
    }))
    .sort((left, right) => right.usefulness - left.usefulness || left.label.localeCompare(right.label))
}
