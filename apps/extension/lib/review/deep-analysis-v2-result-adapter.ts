import type { AfterAnalysisResult } from "@prompt-optimizer/shared/src/schemas"
import type { DeepAnalysisV2Result } from "./deep-analysis-v2-contract"

function statusForV2(status: DeepAnalysisV2Result["overallStatus"]): AfterAnalysisResult["status"] {
  switch (status) {
    case "pass":
      return "SUCCESS"
    case "needs_confirmation":
    case "risky":
      return "PARTIAL"
    case "fail":
      return "FAILED"
    case "unavailable":
      return "UNVERIFIED"
    default:
      return "UNVERIFIED"
  }
}

function decisionForV2(status: DeepAnalysisV2Result["overallStatus"]): AfterAnalysisResult["decision"] {
  switch (status) {
    case "pass":
      return "Safe to proceed"
    case "fail":
      return "Needs refinement"
    case "risky":
      return "Not enough proof"
    case "unavailable":
      return "Not enough proof"
    default:
      return "Needs refinement"
  }
}

function recommendedActionForV2(
  status: DeepAnalysisV2Result["overallStatus"]
): AfterAnalysisResult["recommended_action"] {
  switch (status) {
    case "pass":
      return "SEND_PROMPT"
    case "risky":
      return "VALIDATE_FIRST"
    case "fail":
      return "RESTART_WITH_PROMPT"
    case "unavailable":
      return "VALIDATE_FIRST"
    default:
      return "SEND_PROMPT"
  }
}

function promptStrategyForV2(status: DeepAnalysisV2Result["overallStatus"]): AfterAnalysisResult["prompt_strategy"] {
  switch (status) {
    case "pass":
      return "validate"
    case "fail":
      return "fix_missing"
    case "risky":
      return "narrow_scope"
    case "unavailable":
      return "narrow_scope"
    default:
      return "fix_missing"
  }
}

function checklistStatusForV2(status: DeepAnalysisV2Result["requirementMatches"][number]["status"]) {
  switch (status) {
    case "pass":
      return "met" as const
    case "missing":
      return "missed" as const
    default:
      return "not_sure" as const
  }
}

function excerpt(value: string, max = 220) {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 1).trimEnd()}…`
}

export function mapDeepAnalysisV2ToAfterAnalysisResult(input: {
  analysis: DeepAnalysisV2Result
  responseText: string
}): AfterAnalysisResult {
  const { analysis, responseText } = input
  const missing = analysis.requirementMatches.filter((item) => item.status !== "pass")
  const confirmed = analysis.requirementMatches.filter((item) => item.status === "pass")
  const promptStrategy = promptStrategyForV2(analysis.overallStatus)
  const firstExcerpt = excerpt(responseText)
  const lastExcerpt = excerpt(responseText.slice(Math.max(0, responseText.length - 600)))
  const hasCarryover =
    analysis.phaseAdvanceBasis === "phase_completion_claimed_with_carryover" ||
    (analysis.ignoredExternalValidation ?? []).length > 0

  const result: AfterAnalysisResult & { deep_analysis_v2_snapshot?: DeepAnalysisV2Result } = {
    status: statusForV2(analysis.overallStatus),
    confidence: analysis.confidence,
    popup_state: "ANALYSIS_READY",
    review_mode_label: "Deep Analysis v2",
    review_mode_explainer: "One AI pass checks requirements, evidence, and the next prompt.",
    confidence_label: analysis.confidence === "high" ? "High" : analysis.confidence === "medium" ? "Medium" : "Low",
    confidence_trend: "flat",
    confidence_reason: excerpt(analysis.userExplanation, 180),
    confidence_reasons: [excerpt(analysis.userExplanation, 180)],
    inspection_depth: "targeted_text",
    decision: decisionForV2(analysis.overallStatus),
    decision_display_label:
      analysis.overallStatus === "pass"
        ? hasCarryover
          ? "Ready with carryover"
          : "Ready for next step"
        : "Needs confirmation",
    delta_from_quick: "",
    recommended_action: recommendedActionForV2(analysis.overallStatus),
    why_bullets: missing.length
      ? missing.map((item) => item.requirementText).slice(0, 3)
      : [analysis.recommendedNextMove].filter(Boolean).slice(0, 3),
    next_action: excerpt(analysis.recommendedNextMove, 180),
    findings: [
      analysis.userExplanation,
      ...confirmed.flatMap((item) => item.evidence)
    ].filter(Boolean).map((item) => excerpt(item)).slice(0, 3),
    issues: missing.map((item) => item.requirementText).slice(0, 6),
    next_prompt: analysis.generatedPrompt,
    prompt_strategy: promptStrategy,
    next_prompt_explanation: excerpt(analysis.recommendedNextMove, 220),
    expected_outcome: "The assistant confirms completed requirements and suggests the next step.",
    stage_1: {
      assistant_action_summary: "Responded to the submitted prompt.",
      claimed_evidence: confirmed.flatMap((item) => item.evidence).slice(0, 4),
      response_mode: analysis.overallStatus === "pass" ? "implemented" : "explained",
      scope_assessment: "narrow"
    },
    stage_2: {
      addressed_criteria: confirmed.map((item) => item.requirementText).slice(0, 6),
      missing_criteria: missing.map((item) => item.requirementText).slice(0, 6),
      constraint_risks: analysis.overallStatus === "risky" ? [analysis.recommendedNextMove].slice(0, 1) : [],
      problem_fit: analysis.overallStatus === "fail" ? "partial" : "correct",
      analysis_notes: [analysis.userExplanation].filter(Boolean).slice(0, 4)
    },
    verdict: {
      status: statusForV2(analysis.overallStatus),
      confidence: analysis.confidence,
      confidence_reason: excerpt(analysis.userExplanation, 180),
      findings: [
        analysis.userExplanation,
        ...confirmed.flatMap((item) => item.evidence)
      ].filter(Boolean).map((item) => excerpt(item)).slice(0, 3),
      issues: missing.map((item) => item.requirementText).slice(0, 6)
    },
    next_prompt_output: {
      next_prompt: analysis.generatedPrompt,
      prompt_strategy: promptStrategy,
      next_prompt_explanation: excerpt(analysis.recommendedNextMove, 220),
      expected_outcome: "The assistant confirms completed requirements and suggests the next step."
    },
    acceptance_checklist: analysis.requirementMatches.slice(0, 6).map((item, index) => ({
      label: item.requirementText,
      status: checklistStatusForV2(item.status),
      source: "submitted_prompt",
      layer: "core",
      priority: Math.min(index + 1, 6)
    })),
    checked_artifact_types: ["response_text"],
    checked_artifacts: confirmed.map((item) => item.requirementText).slice(0, 8),
    unchecked_artifacts: missing.map((item) => item.requirementText).slice(0, 8),
    blocked_or_unproven_items: missing.map((item) => item.requirementText).slice(0, 6),
    deep_criterion_verifications: [],
    contradiction_count: analysis.overallStatus === "fail" ? 1 : 0,
    review_contract: {
      version: "v1",
      target_signature: "",
      goal: "Match the submitted prompt requirements against the assistant answer.",
      criteria: analysis.requirements.slice(0, 6).map((item, index) => ({
        id: item.id,
        label: item.text,
        source: "submitted_prompt",
        layer: "core",
        priority: Math.min(index + 1, 6)
      }))
    },
    response_summary: {
      response_text: responseText,
      response_length: responseText.length,
      first_excerpt: firstExcerpt,
      last_excerpt: lastExcerpt,
      key_paragraphs: [firstExcerpt].filter(Boolean).slice(0, 2),
      has_code_blocks: /```/.test(responseText),
      mentioned_files: [],
      change_claims: [],
      validation_signals: [],
      certainty_signals: [],
      uncertainty_signals: [],
      success_signals: [],
      failure_signals: []
    },
    helpful_feedback: {
      helpful: null,
      next_prompt_success: null
    },
    used_fallback_intent: analysis.providerMetadata.usedFallback,
    token_usage_total: 0,
    deep_analysis_v2_snapshot: analysis
  }
  return result
}
