import type { ReviewPopupViewModel } from "../../components/review-popup/review/review-types"
import type { PopupTone } from "../../components/review-popup/shared/types"
import type { NextMoveDecision, NextMoveDecisionStatus, NextMoveRecommendationKind } from "./next-move-decision"
import type { DeepAnalysisV2OverallStatus, DeepAnalysisV2Result } from "./deep-analysis-v2-contract"

type MapDeepAnalysisV2ToReviewViewModelInput = {
  analysis: DeepAnalysisV2Result
  mode?: "quick" | "deep"
  onCopyPrompt?: () => void
}

function toneForStatus(status: DeepAnalysisV2OverallStatus): PopupTone {
  switch (status) {
    case "pass":
      return "success"
    case "needs_confirmation":
    case "risky":
      return "warning"
    case "fail":
      return "danger"
    case "unavailable":
      return "warning"
    default:
      return "info"
  }
}

function hasCarryover(analysis: DeepAnalysisV2Result) {
  return (
    analysis.phaseAdvanceBasis === "phase_completion_claimed_with_carryover" ||
    (analysis.ignoredExternalValidation ?? []).length > 0
  )
}

function isReadyForTesting(analysis: DeepAnalysisV2Result) {
  if (analysis.overallStatus !== "pass") return false
  if (analysis.confidence === "low") return false
  if ((analysis.actionableMissingItems ?? []).length > 0) return false
  if (!allVisibleRequirementsPassed(analysis)) return false
  if (isFinalMvpReviewAnalysis(analysis)) return false
  if (analysis.nextStepSource === "project_memory" && analysis.promptIntent === "implement_next_step") return false
  return true
}

function isFinalMvpReviewAnalysis(analysis: DeepAnalysisV2Result) {
  return (
    analysis.phaseAdvanceBasis === "tracker_completed_final_review" ||
    /^all tracked implementation phases are complete\./i.test(analysis.generatedPrompt.trim())
  )
}

function allVisibleRequirementsPassed(analysis: DeepAnalysisV2Result) {
  const visible = visibleRequirementMatches(analysis)
  return visible.length === 0 || visible.every((match) => match.status === "pass")
}

function displayExplanation(analysis: DeepAnalysisV2Result) {
  if (isReadyForTesting(analysis)) {
    return "The implementation looks complete. Validate it before adding new scope."
  }

  if (analysis.overallStatus === "pass" && isFinalMvpReviewAnalysis(analysis) && allVisibleRequirementsPassed(analysis)) {
    return "Project Tracker completed all tracked phases. Run the final MVP review and testing prompt before adding new scope."
  }

  return analysis.userExplanation
}

function displayRecommendedNextMove(analysis: DeepAnalysisV2Result) {
  if (isReadyForTesting(analysis)) {
    return "Confirm whether testing is complete, then choose the next move."
  }

  if (analysis.overallStatus === "pass" && isFinalMvpReviewAnalysis(analysis)) {
    return "Run the final MVP review prompt and then complete user testing."
  }

  return analysis.recommendedNextMove
}

function badgeLabel(analysis: DeepAnalysisV2Result) {
  const status = analysis.overallStatus
  if (isReadyForTesting(analysis)) {
    return "Ready for testing"
  }

  if (status === "pass" && isFinalMvpReviewAnalysis(analysis)) {
    return "Ready for final MVP review"
  }

  if (status === "pass" && hasCarryover(analysis)) {
    return "Ready with carryover"
  }

  switch (status) {
    case "pass":
      return "Looks good"
    case "needs_confirmation":
      return "Needs confirmation"
    case "risky":
      return "Needs review"
    case "fail":
      return "Not ready"
    case "unavailable":
      return "Analysis unavailable"
    default:
      return "Needs review"
  }
}

function decisionStatus(status: DeepAnalysisV2OverallStatus): NextMoveDecisionStatus {
  switch (status) {
    case "pass":
      return "ready_for_next_phase"
    case "needs_confirmation":
      return "incomplete"
    case "risky":
      return "risky"
    case "fail":
      return "blocked"
    case "unavailable":
      return "risky"
    default:
      return "risky"
  }
}

function recommendationKind(status: DeepAnalysisV2OverallStatus): NextMoveRecommendationKind {
  switch (status) {
    case "pass":
      return "start_next_phase"
    case "needs_confirmation":
    case "fail":
      return "finish_missing_requirements"
    case "risky":
    case "unavailable":
      return "review_before_advancing"
    default:
      return "review_before_advancing"
  }
}

function ctaLabel(status: DeepAnalysisV2OverallStatus) {
  switch (status) {
    case "pass":
      return "Submit next prompt"
    case "needs_confirmation":
      return "Confirm requirements"
    case "fail":
      return "Finish missing requirements"
    case "risky":
      return "Review before advancing"
    case "unavailable":
      return "Try deep analysis again"
    default:
      return "Review before advancing"
  }
}

function primaryCtaLabel(analysis: DeepAnalysisV2Result) {
  if (analysis.overallStatus === "pass" && isFinalMvpReviewAnalysis(analysis)) {
    return "Submit final review prompt"
  }

  return ctaLabel(analysis.overallStatus)
}

function confidenceScore(confidence: DeepAnalysisV2Result["confidence"]) {
  switch (confidence) {
    case "high":
      return 0.92
    case "medium":
      return 0.68
    default:
      return 0.42
  }
}

function confidenceLabel(confidence: DeepAnalysisV2Result["confidence"]) {
  switch (confidence) {
    case "high":
      return "Confidence: High"
    case "medium":
      return "Confidence: Medium"
    default:
      return "Confidence: Low"
  }
}

function isGenericRequirementText(value: string) {
  const text = value.replace(/\s+/g, " ").trim().toLowerCase()
  return (
    text === "match the submitted prompt requirements." ||
    text === "match the submitted prompt requirements" ||
    text === "submitted prompt requirements" ||
    text === "match the prompt" ||
    text === "current phase requirements" ||
    text === "phase requirements"
  )
}

function visibleRequirementMatches(analysis: DeepAnalysisV2Result) {
  const nonGeneric = analysis.requirementMatches.filter((match) => !isGenericRequirementText(match.requirementText))
  if (nonGeneric.length > 0) return nonGeneric
  if (analysis.overallStatus === "pass") return []
  return analysis.requirementMatches
}

function requirementRows(analysis: DeepAnalysisV2Result): ReviewPopupViewModel["checklistRows"] {
  return visibleRequirementMatches(analysis).map((match) => ({
    id: `deep-v2-${match.requirementId}`,
    label: match.requirementText,
    status:
      match.status === "pass"
        ? "verified"
        : match.status === "missing"
          ? "missing"
          : "not_verified"
  }))
}

function missingItems(analysis: DeepAnalysisV2Result) {
  return visibleRequirementMatches(analysis)
    .filter((match) => match.status !== "pass")
    .map((match) => match.requirementText)
}

function checkedItems(analysis: DeepAnalysisV2Result) {
  return visibleRequirementMatches(analysis)
    .filter((match) => match.status === "pass")
    .map((match) => match.requirementText)
}

function evidenceItems(analysis: DeepAnalysisV2Result) {
  return visibleRequirementMatches(analysis)
    .flatMap((match) => match.evidence)
    .filter(Boolean)
    .slice(0, 4)
}

function humanizeKey(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function buildNextMoveDecision(analysis: DeepAnalysisV2Result): NextMoveDecision {
  const carriesUnresolvedItems = hasCarryover(analysis)
  const finalReview = isFinalMvpReviewAnalysis(analysis)
  const readyForTesting = isReadyForTesting(analysis)
  const explanation = displayExplanation(analysis)
  const recommendedNextMove = displayRecommendedNextMove(analysis)
  return {
    status: decisionStatus(analysis.overallStatus),
    recommendation: {
      kind: recommendationKind(analysis.overallStatus),
      title:
        readyForTesting
          ? "Ready for testing"
          : analysis.overallStatus === "pass" && finalReview
          ? "Ready for final MVP review"
          : analysis.overallStatus === "pass"
          ? carriesUnresolvedItems
            ? "Ready with carryover"
            : "Ready for next step"
          : analysis.overallStatus === "unavailable"
            ? "Deep analysis unavailable"
            : ctaLabel(analysis.overallStatus),
      message: recommendedNextMove,
      nextStepGuidance: analysis.assistantSuggestedNextMove
        ? `Assistant suggested: ${analysis.assistantSuggestedNextMove}.`
        : undefined,
      primaryCtaLabel: primaryCtaLabel(analysis)
    },
    reason: explanation,
    confidence: confidenceScore(analysis.confidence),
    assistantPrompt: {
      title:
        readyForTesting
          ? "Testing checkpoint"
          : analysis.overallStatus === "pass" && finalReview
          ? "Final MVP review prompt"
          : analysis.overallStatus === "pass"
          ? "Next step prompt"
          : analysis.overallStatus === "unavailable"
            ? "No prompt generated"
            : "Follow-up prompt",
      body: readyForTesting ? null : analysis.generatedPrompt.trim() || null,
      mode: readyForTesting ? "informational_only" : analysis.generatedPrompt.trim() ? "review_first" : "informational_only"
    }
  }
}

export function mapDeepAnalysisV2ToReviewViewModel(
  input: MapDeepAnalysisV2ToReviewViewModelInput
): ReviewPopupViewModel {
  const analysis = input.analysis
  const rows = requirementRows(analysis)
  const missing = missingItems(analysis)
  const checked = checkedItems(analysis)
  const readyForTesting = isReadyForTesting(analysis)
  const nextMoveDecision = analysis.overallStatus === "unavailable" ? null : buildNextMoveDecision(analysis)
  const rawPrompt = analysis.generatedPrompt.trim()
  const prompt = readyForTesting ? "" : rawPrompt
  const explanation = displayExplanation(analysis)
  const recommendedNextMove = displayRecommendedNextMove(analysis)

  return {
    state: "deep_review",
    mode: input.mode ?? "deep",
    eyebrow: "Reality check",
    title: analysis.overallStatus === "unavailable" ? "Deep Analysis Unavailable" : "AI Answer Check",
    statusBadge: {
      label: badgeLabel(analysis),
      tone: toneForStatus(analysis.overallStatus)
    },
    decision: explanation,
    recommendedAction: recommendedNextMove,
    readyForTesting,
    requirementMatchSummary: {
      status: analysis.overallStatus === "unavailable" || missing.length ? "needs_confirmation" : "pass",
      confirmedCount: checked.length,
      missingCount: missing.length,
      rows
    },
    nextMoveDecision,
    nextMoveInterpreterNote:
      analysis.analysisMode === "large_input_checkpoint"
        ? "Deep Analysis v2 · large input checkpoint"
        : `Deep Analysis v2 · ${analysis.providerMetadata.provider}`,
    deepAnalysisV2Trace: {
      analysisId: analysis.analysisId,
      analysisState: analysis.analysisState,
      analysisMode: analysis.analysisMode,
      submittedPromptHash: analysis.submittedPromptHash,
      assistantAnswerHash: analysis.assistantAnswerHash,
      submittedPromptLength: analysis.submittedPromptLength ?? null,
      assistantAnswerLength: analysis.assistantAnswerLength ?? null,
      overallStatus: humanizeKey(analysis.overallStatus),
      confidence: confidenceLabel(analysis.confidence),
      providerName: analysis.providerMetadata.provider,
      providerModel: analysis.providerMetadata.model ?? null,
      durationMs: analysis.providerMetadata.latencyMs ?? null,
      timedOut: analysis.providerMetadata.timedOut,
      usedFallback: analysis.providerMetadata.usedFallback,
      providerAttempted: analysis.providerMetadata.providerAttempted ?? null,
      fallbackReason: analysis.providerMetadata.fallbackReason ?? null,
      failureMessage: analysis.providerMetadata.failureMessage ?? null,
      kimiLatencyMs: analysis.providerMetadata.kimiLatencyMs ?? null,
      deepSeekAttempted: analysis.providerMetadata.deepSeekAttempted ?? null,
      deepSeekLatencyMs: analysis.providerMetadata.deepSeekLatencyMs ?? null,
      deepSeekFailureReason: analysis.providerMetadata.deepSeekFailureReason ?? null,
      promptIntent: humanizeKey(analysis.promptIntent),
      nextStepSource: humanizeKey(analysis.nextStepSource),
      nextStepRequirements: analysis.nextStepRequirements.slice(0, 6),
      blockedScope: analysis.blockedScope.slice(0, 6),
      ignoredExternalValidation: (analysis.ignoredExternalValidation ?? []).slice(0, 8),
      actionableMissingItems: (analysis.actionableMissingItems ?? []).slice(0, 8),
      phaseAdvanceBasis: analysis.phaseAdvanceBasis,
      phaseCompletionClaimed: analysis.phaseCompletionClaimed,
      classificationAudit: analysis.classificationAudit.slice(0, 8),
      recommendedNextMove,
      generatedPrompt: analysis.generatedPrompt,
      requirementMatches: analysis.requirementMatches.slice(0, 12).map((match) => ({
        requirementText: match.requirementText,
        status: match.status,
        evidence: match.evidence.slice(0, 3),
        note: match.note
      }))
    },
    promptLabel: nextMoveDecision?.assistantPrompt.title ?? (prompt ? "Limited review prompt" : "No prompt generated"),
    prompt,
    promptNote: prompt
      ? "Use this prompt as the next action."
      : analysis.overallStatus === "unavailable"
        ? "This is a limited review prompt because the LLM analysis did not complete."
        : "No follow-up prompt was generated.",
    workflowState: null,
    workflowHelper: "",
    promptActions:
      prompt && input.onCopyPrompt && nextMoveDecision
        ? [{ id: "submit", label: nextMoveDecision.recommendation.primaryCtaLabel, kind: "primary", onClick: input.onCopyPrompt }]
        : [],
    confidenceLabel: confidenceLabel(analysis.confidence),
    confidenceNote: analysis.overallStatus === "unavailable"
      ? "Deep Analysis v2 is LLM-only. Both provider attempts failed or timed out, so no deep decision was made."
      : explanation,
    confidenceReasons: [explanation].filter(Boolean).slice(0, 3),
    missingItems: missing,
    whyItems: missing.length ? missing.slice(0, 3) : checked.slice(0, 3),
    proofSummary: evidenceItems(analysis).join(" ") || explanation,
    checkedArtifacts: checked,
    uncheckedArtifacts: missing.length ? missing : ["No critical missing items found."],
    checklistRows: rows,
    quickToDeepDelta: "",
    feedbackPrompt: prompt
  }
}
