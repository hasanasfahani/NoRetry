import type { AfterAnalysisResult } from "@prompt-optimizer/shared/src/schemas"
import type { ReviewPopupViewModel } from "../../components/review-popup/review/review-types"
import type {
  DeepAnalysisV2ComparisonTelemetryRecord,
  DeepAnalysisV2TelemetrySnapshotRecord,
  NextMoveDecisionSnapshotRecord,
  SimpleNextPromptTelemetrySnapshotRecord,
  NextMoveSignalSnapshotRecord,
  NextMoveTelemetryEventRecord
} from "../storage"
import type { AssistantNextStepSignal } from "./assistant-next-step-signal"
import type { ReviewContract } from "./contracts"
import { mapDeepAnalysisV2ToNormalizedDecision } from "./deep-analysis-v2-decision-adapter"
import { getReviewAnalysisContext } from "./services/review-analysis"
import type { ReviewPopupMode, ReviewTarget } from "./types"

function signalSnapshot(signal: AssistantNextStepSignal | null | undefined): NextMoveSignalSnapshotRecord | null {
  if (!signal) return null
  return {
    source: signal.source,
    kind: signal.kind,
    nextMoveType: signal.nextMoveType,
    currentStepClaim: signal.currentStepClaim,
    confidenceLevel: signal.confidenceLevel,
    targetLabel: signal.targetLabel ?? null,
    targetPhaseNumber: signal.targetPhaseNumber ?? null
  }
}

function decisionSnapshot(viewModel: ReviewPopupViewModel): NextMoveDecisionSnapshotRecord | null {
  const decision = viewModel.nextMoveDecision
  if (!decision) return null

  return {
    status: decision.status,
    recommendationKind: decision.recommendation.kind,
    title: decision.recommendation.title,
    primaryCtaLabel: decision.recommendation.primaryCtaLabel
  }
}

function simpleNextPromptSnapshot(
  contract: ReviewContract | null | undefined
): SimpleNextPromptTelemetrySnapshotRecord | null {
  const simpleDecision = contract?.analysisDebug?.smart?.simpleNextPromptDecision
  if (!simpleDecision) return null

  return {
    version: simpleDecision.version,
    status: simpleDecision.status,
    rolloutMode: contract?.analysisDebug?.smart?.simpleNextPromptRolloutMode,
    applied: contract?.analysisDebug?.smart?.simpleNextPromptApplied,
    requirementStatus: simpleDecision.requirementCheck.status,
    confirmedCount: simpleDecision.requirementCheck.confirmed.length,
    missingCount: simpleDecision.requirementCheck.missingConfirmation.length,
    missingRequirements: simpleDecision.requirementCheck.missingConfirmation.map((item) => item.text),
    optimizedPrompt: simpleDecision.optimizedPrompt,
    assistantSuggestedNextMove: simpleDecision.assistantSuggestedNextMove?.normalizedText ?? null
  }
}

function deepAnalysisV2Snapshot(result: AfterAnalysisResult): DeepAnalysisV2TelemetrySnapshotRecord | null {
  const context = getReviewAnalysisContext(result)
  const analysis = context?.deepAnalysisV2
  if (!analysis) return null
  const normalized = mapDeepAnalysisV2ToNormalizedDecision(analysis)

  return {
    version: normalized.version,
    analysisId: normalized.analysisId,
    analysisVersion: normalized.analysisVersion,
    analysisState: normalized.analysisState,
    analysisMode: normalized.analysisMode,
    threadId: normalized.threadId,
    messageId: normalized.messageId,
    submittedPromptHash: normalized.submittedPromptHash,
    assistantAnswerHash: normalized.assistantAnswerHash,
    surface: normalized.surface,
    completedAt: normalized.completedAt,
    rolloutMode: context.deepAnalysisV2RolloutMode,
    applied: context.deepAnalysisV2Applied,
    provider: normalized.providerMetadata.provider,
    model: normalized.providerMetadata.model,
    latencyMs: normalized.providerMetadata.latencyMs,
    providerAttempted: normalized.providerMetadata.providerAttempted,
    fallbackReason: normalized.providerMetadata.fallbackReason,
    failureMessage: normalized.providerMetadata.failureMessage,
    kimiLatencyMs: normalized.providerMetadata.kimiLatencyMs,
    deepSeekAttempted: normalized.providerMetadata.deepSeekAttempted,
    deepSeekLatencyMs: normalized.providerMetadata.deepSeekLatencyMs,
    deepSeekFailureReason: normalized.providerMetadata.deepSeekFailureReason,
    overallStatus: normalized.status,
    confidence: normalized.confidence,
    requirementCount: normalized.requirementCount,
    missingCount: normalized.missingCount,
    assistantSuggestedNextMove: normalized.assistantSuggestedNextMove,
    nextStepSource: normalized.nextStepSource,
    nextStepRequirements: normalized.nextStepRequirements,
    blockedScope: normalized.blockedScope,
    promptIntent: normalized.promptIntent,
    generatedPrompt: normalized.generatedPrompt
  }
}

function decisionBucketFromRecommendation(kind: string | undefined) {
  if (!kind) return "unknown"
  return /start_next_phase|continue_optional_enhancement|move_to_next_task/i.test(kind) ? "advance" : "review"
}

function decisionBucketFromV2Status(status: DeepAnalysisV2TelemetrySnapshotRecord["overallStatus"]) {
  if (status === "unavailable") return "unknown"
  return status === "pass" ? "advance" : "review"
}

function deepAnalysisV2ComparisonSnapshot(input: {
  result: AfterAnalysisResult
  viewModel: ReviewPopupViewModel
}): DeepAnalysisV2ComparisonTelemetryRecord | null {
  const v2 = deepAnalysisV2Snapshot(input.result)
  if (!v2) return null

  const v1Decision = decisionSnapshot(input.viewModel)
  const v1Bucket = decisionBucketFromRecommendation(v1Decision?.recommendationKind)
  const v2Bucket = decisionBucketFromV2Status(v2.overallStatus)

  return {
    v1Decision: v1Decision ? `${v1Decision.status}/${v1Decision.recommendationKind}` : null,
    v2Decision: `${v2.overallStatus}/${v2.confidence}`,
    agreement: v1Bucket === "unknown" ? "unknown" : v1Bucket === v2Bucket ? "agree" : "disagree",
    provider: v2.provider,
    latencyMs: v2.latencyMs,
    generatedPrompt: v2.generatedPrompt
  }
}

export function buildNextMoveTelemetryEvent(input: {
  eventType: NextMoveTelemetryEventRecord["eventType"]
  target: ReviewTarget
  result: AfterAnalysisResult
  reviewContract: ReviewContract | null
  viewModel: ReviewPopupViewModel
  mode: ReviewPopupMode
  projectKey?: string
  projectLabel?: string
  userAction?: string
}): Omit<NextMoveTelemetryEventRecord, "eventId" | "createdAt"> {
  const smart = input.reviewContract?.analysisDebug?.smart
  return {
    eventType: input.eventType,
    projectKey: input.projectKey,
    projectLabel: input.projectLabel,
    attemptId: input.target.attempt.attempt_id,
    threadIdentity: input.target.threadIdentity,
    responseIdentity: input.target.responseIdentity,
    mode: input.mode,
    taskType: input.target.taskType,
    analysisStatus: input.result.status,
    confidence: input.result.confidence,
    workflowState: smart?.workflowState ?? null,
    promptText: input.target.attempt.optimized_prompt || input.target.attempt.raw_prompt || input.target.attempt.intent.goal || "",
    responseText: input.target.responseText,
    finalDecision: decisionSnapshot(input.viewModel),
    selectedSignal: signalSnapshot(smart?.assistantNextStepSignal),
    aiSignal: signalSnapshot(smart?.assistantNextStepSignalAi),
    localSignal: signalSnapshot(smart?.assistantNextStepSignalLocal),
    signalSource: smart?.assistantNextStepSignalSource ?? "none",
    signalAgreement: smart?.assistantNextStepSignalAgreement ?? "none",
    simpleNextPromptDecision: simpleNextPromptSnapshot(input.reviewContract),
    deepAnalysisV2Decision: deepAnalysisV2Snapshot(input.result),
    deepAnalysisV2Comparison: deepAnalysisV2ComparisonSnapshot({
      result: input.result,
      viewModel: input.viewModel
    }),
    userAction: input.userAction
  }
}
