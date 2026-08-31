import type { DeepAnalysisV2Result } from "./deep-analysis-v2-contract"

export function mapDeepAnalysisV2ToNormalizedDecision(analysis: DeepAnalysisV2Result) {
  return {
    version: analysis.version,
    analysisId: analysis.analysisId,
    analysisVersion: analysis.analysisVersion,
    analysisState: analysis.analysisState,
    analysisMode: analysis.analysisMode,
    threadId: analysis.threadId,
    messageId: analysis.messageId,
    submittedPromptHash: analysis.submittedPromptHash,
    assistantAnswerHash: analysis.assistantAnswerHash,
    surface: analysis.surface,
    completedAt: analysis.completedAt,
    status: analysis.overallStatus,
    confidence: analysis.confidence,
    promptIntent: analysis.promptIntent,
    nextStepSource: analysis.nextStepSource,
    nextStepRequirements: analysis.nextStepRequirements,
    blockedScope: analysis.blockedScope,
    generatedPrompt: analysis.generatedPrompt,
    assistantSuggestedNextMove: analysis.assistantSuggestedNextMove,
    providerMetadata: analysis.providerMetadata,
    requirementCount: analysis.requirementMatches.length || analysis.requirements.length,
    missingCount: analysis.requirementMatches.filter((item) => item.status !== "pass").length
  }
}
