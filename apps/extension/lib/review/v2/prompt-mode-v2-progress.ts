import type { ReviewPromptModeV2Validation } from "./prompt-mode-v2-assembly"
import type { ReviewPromptModeV2SectionState } from "./section-schemas"

export type ReviewPromptModeV2StrengthLabel = "weak" | "moderate" | "good" | "great"

export type ReviewPromptModeV2ProgressState = {
  progressScore: number
  progressLabel: ReviewPromptModeV2StrengthLabel
  strengthScore: number
  strengthLabel: ReviewPromptModeV2StrengthLabel
  resolvedSectionCount: number
  totalSectionCount: number
  nextLevelLabel: ReviewPromptModeV2StrengthLabel | null
  meaningfulStepsToNextLevel: number
  summary: string
}

type ProgressContext = {
  sections: ReviewPromptModeV2SectionState[]
  questionHistoryLength: number
  validation: ReviewPromptModeV2Validation | null
  promptReady: boolean
}

const LEVEL_THRESHOLDS: Array<{ label: ReviewPromptModeV2StrengthLabel; min: number }> = [
  { label: "weak", min: 0 },
  { label: "moderate", min: 30 },
  { label: "good", min: 55 },
  { label: "great", min: 80 }
]

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function ratio(numerator: number, denominator: number) {
  if (denominator <= 0) return 0
  return numerator / denominator
}

function labelForScore(score: number): ReviewPromptModeV2StrengthLabel {
  if (score >= 80) return "great"
  if (score >= 55) return "good"
  if (score >= 30) return "moderate"
  return "weak"
}

function nextLevelForScore(score: number) {
  return LEVEL_THRESHOLDS.find((level) => level.min > score) ?? null
}

function countMeaningfulGaps(sections: ReviewPromptModeV2SectionState[], validation: ReviewPromptModeV2Validation | null) {
  const unresolvedSections = sections.filter((section) => section.status !== "resolved").length
  const missing = validation?.missingItems.length ?? 0
  const contradictions = validation?.contradictions.length ?? 0
  return unresolvedSections + missing + contradictions
}

export function computePromptModeV2ProgressState(ctx: ProgressContext): ReviewPromptModeV2ProgressState {
  const totalSectionCount = ctx.sections.length
  const resolvedSectionCount = ctx.sections.filter((section) => section.status === "resolved").length
  const partialSectionCount = ctx.sections.filter((section) => section.status === "partially_resolved").length
  const answeredQuestionCount = ctx.questionHistoryLength

  const sectionCoverage = ratio(resolvedSectionCount + partialSectionCount * 0.5, totalSectionCount)
  const answeredThresholdScore =
    answeredQuestionCount >= 6
      ? 1
      : answeredQuestionCount >= 4
        ? 0.78
        : answeredQuestionCount >= 2
          ? 0.5
          : answeredQuestionCount >= 1
            ? 0.28
            : 0

  const progressScore = Math.round(clamp((sectionCoverage * 0.6 + answeredThresholdScore * 0.4) * 100, 0, 100))
  const progressLabel = labelForScore(progressScore)

  const missingPenalty = Math.min(30, (ctx.validation?.missingItems.length ?? 0) * 8)
  const contradictionPenalty = Math.min(35, (ctx.validation?.contradictions.length ?? 0) * 12)
  const assumptionPenalty = Math.min(18, (ctx.validation?.assumedItems.length ?? 0) * 4)
  const completenessBoost = ctx.promptReady ? 8 : 0
  const strengthBase = Math.round(sectionCoverage * 100)
  const strengthScore = clamp(strengthBase + completenessBoost - missingPenalty - contradictionPenalty - assumptionPenalty, 0, 100)
  const strengthLabel = labelForScore(strengthScore)

  const nextLevel = nextLevelForScore(progressScore)
  const gapCount = countMeaningfulGaps(ctx.sections, ctx.validation)
  const meaningfulStepsToNextLevel = nextLevel
    ? Math.max(1, Math.min(gapCount || 1, Math.ceil((nextLevel.min - progressScore) / 12)))
    : 0

  const summary = nextLevel
    ? `Resolve about ${meaningfulStepsToNextLevel} more meaningful ${meaningfulStepsToNextLevel === 1 ? "gap" : "gaps"} to reach ${nextLevel.label}.`
    : "The key Prompt Mode v2 sections are now well covered."

  return {
    progressScore,
    progressLabel,
    strengthScore,
    strengthLabel,
    resolvedSectionCount,
    totalSectionCount,
    nextLevelLabel: nextLevel?.label ?? null,
    meaningfulStepsToNextLevel,
    summary
  }
}
