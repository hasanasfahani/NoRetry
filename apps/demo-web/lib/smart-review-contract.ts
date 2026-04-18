import { preprocessResponse, type ResponsePreprocessorOutput } from "@prompt-optimizer/shared"
import { normalizeGoalContract } from "../../extension/lib/goal/goal-normalizer"
import { buildAnalysisPromptSection } from "../../extension/lib/review/analysis-prompt-section"
import type { ReviewContract } from "../../extension/lib/review/contracts"
import type { ReviewTaskType } from "./review-task-type"

export async function buildSmartReviewContract(input: {
  promptText: string
  responseText: string
  taskType: ReviewTaskType
}): Promise<ReviewContract> {
  const promptText = input.promptText.trim()
  const responseText = input.responseText.trim()
  const goalContract = normalizeGoalContract({
    promptText,
    taskFamily: input.taskType
  })
  const responseSummary = preprocessResponse(responseText) as ResponsePreprocessorOutput

  const analysisPromptSection = await buildAnalysisPromptSection({
    promptText,
    responseText,
    taskFamily: input.taskType,
    goalContract,
    reviewContract: null,
    attemptAcceptanceCriteria: []
  })

  return {
    taskFamily: input.taskType,
    checklistSource: "informational_generic",
    sanitizationChanges: [],
    overallDecision: "",
    recommendation: "",
    confidence: analysisPromptSection.debug.smart.judgments.some((item) => item.status !== "met") ? "medium" : "high",
    confidenceNote: "",
    confidenceReasons: [],
    failureTypes: [],
    evidenceSummary: {
      items: [],
      counts: {
        claimed: 0,
        evidenced: 0,
        contradicted: 0,
        unclear: 0
      }
    },
    attemptMemory: null,
    requirements: [],
    topFailures: [],
    topPasses: [],
    missingItems: [],
    whyItems: [],
    proofSummary: "",
    checkedItems: [],
    uncheckedItems: [],
    promptLabel: analysisPromptSection.promptLabel,
    promptText: analysisPromptSection.promptText,
    promptNote: analysisPromptSection.promptNote,
    copyPromptText: analysisPromptSection.copyPromptText,
    nextMoveShort: analysisPromptSection.nextMoveShort,
    feedbackPrompt: "",
    analysisDebug: analysisPromptSection.debug
  }
}
