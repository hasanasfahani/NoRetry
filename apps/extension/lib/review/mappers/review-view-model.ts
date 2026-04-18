import type { AfterAnalysisResult } from "@prompt-optimizer/shared/src/schemas"
import type { ReviewPopupViewModel } from "../../../components/review-popup/review/review-types"
import type { PopupAction, PopupTone } from "../../../components/review-popup/shared/types"
import type { ReviewContract } from "../contracts"
import { guardrailList, guardrailText } from "../guardrails"
import type { ReviewPopupMode } from "../types"
import type { ReviewTaskType } from "../services/review-task-type"
import { isAnswerQualityTask } from "../services/review-task-type"

const PROMPT_QUALITY_CHECKLIST_LABELS = new Set([
  "The generated prompt preserves the user’s core goal",
  "The generated prompt preserves important constraints",
  "The generated prompt is structured and clear",
  "The generated prompt is usable as a send-ready prompt"
])

const PROMPT_ARTIFACT_ANALYSIS_NOTES = [
  "This was reviewed as a generated prompt artifact, not as a proof-of-fix task.",
  "The generated prompt should be judged on goal preservation, constraint coverage, structure, and send-ready quality."
]

function hasAnswerQualityAnalysisNote(result: AfterAnalysisResult) {
  return result.stage_2.analysis_notes.some(
    (item) =>
      PROMPT_ARTIFACT_ANALYSIS_NOTES.includes(item) ||
      /reviewed as an?.*(?:usability|quality|generated deliverable).*not as an implementation proof task/i.test(item) ||
      /reviewed as an?.*not as a proof-of-fix task/i.test(item) ||
      /judged on .* not on implementation artifacts/i.test(item)
  )
}

function usesAnswerQualityWording(result: AfterAnalysisResult, taskType: ReviewTaskType) {
  return (
    isAnswerQualityTask(taskType) ||
    result.acceptance_checklist.some((item) => PROMPT_QUALITY_CHECKLIST_LABELS.has(item.label)) ||
    hasAnswerQualityAnalysisNote(result)
  )
}

function toneForStatus(status: AfterAnalysisResult["status"]): PopupTone {
  switch (status) {
    case "SUCCESS":
      return "success"
    case "PARTIAL":
      return "warning"
    case "FAILED":
    case "WRONG_DIRECTION":
      return "danger"
    default:
      return "info"
  }
}

function quickStatusLabel(status: AfterAnalysisResult["status"], qualityTask: boolean) {
  if (qualityTask) {
    switch (status) {
      case "SUCCESS":
        return "Looks good"
      case "PARTIAL":
        return "Needs review"
      case "FAILED":
      case "WRONG_DIRECTION":
        return "Not usable yet"
      default:
        return "Needs review"
    }
  }

  switch (status) {
    case "SUCCESS":
      return "Looks good"
    case "PARTIAL":
      return "Needs review"
    case "FAILED":
      return "Not usable yet"
    case "WRONG_DIRECTION":
      return "Not usable yet"
    default:
      return "Needs review"
  }
}

function deepStatusLabel(status: AfterAnalysisResult["status"], qualityTask: boolean) {
  if (qualityTask) {
    switch (status) {
      case "SUCCESS":
        return "Looks good"
      case "PARTIAL":
        return "Needs review"
      case "FAILED":
      case "WRONG_DIRECTION":
        return "Not usable yet"
      default:
        return "Needs review"
    }
  }

  switch (status) {
    case "SUCCESS":
      return "Looks good"
    case "PARTIAL":
      return "Needs review"
    case "FAILED":
      return "Not usable yet"
    case "WRONG_DIRECTION":
      return "Not usable yet"
    default:
      return "Needs review"
  }
}

function confidenceLabel(confidence: AfterAnalysisResult["confidence"], qualityTask: boolean) {
  if (qualityTask) {
    switch (confidence) {
      case "high":
        return "Usable"
      case "medium":
        return "Needs review"
      default:
        return "Weak"
    }
  }

  switch (confidence) {
    case "high":
      return "Verified"
    case "medium":
      return "Not proven"
    default:
      return "Unreliable"
  }
}

function rankConfidence(confidence: AfterAnalysisResult["confidence"]) {
  switch (confidence) {
    case "high":
      return 3
    case "medium":
      return 2
    default:
      return 1
  }
}

function markerForChecklist(
  status: AfterAnalysisResult["acceptance_checklist"][number]["status"],
  mode: ReviewPopupMode,
  taskType: ReviewTaskType
) {
  if (taskType === "debug" && mode === "quick") {
    if (status === "met") return "not_verified"
    if (status === "not_sure") return "not_verified"
    return "missing"
  }

  if (mode === "quick") {
    if (status === "met") return "verified"
    if (status === "not_sure") return "not_verified"
    return "missing"
  }

  if (status === "met") return "verified"
  if (status === "not_sure") return "blocked"
  return "missing"
}

function checklistLabel(
  item: AfterAnalysisResult["acceptance_checklist"][number],
  mode: ReviewPopupMode,
  taskType: ReviewTaskType
) {
  void mode
  void taskType
  if (item.status === "met") return `${item.label} (Confirmed)`
  if (item.status === "not_sure") return `${item.label} (Not proven)`
  return `${item.label} (Missing)`
}

function buildDecision(result: AfterAnalysisResult, mode: ReviewPopupMode, taskType: ReviewTaskType, qualityTask: boolean) {
  const debugContinuation = taskType === "debug" && result.prompt_strategy === "narrow_scope"
  const unresolvedItems = result.acceptance_checklist.filter((item) => item.status !== "met")
  const confirmedCount = result.acceptance_checklist.length - unresolvedItems.length

  if (debugContinuation) {
    return mode === "deep"
      ? "This fix hasn’t been proven yet"
      : "Confirm one runtime checkpoint before trusting this fix"
  }

  if (qualityTask) {
    if (result.status === "SUCCESS") {
      return mode === "deep" ? "Safe to use as-is" : "Looks good"
    }

    return mode === "deep" ? "Looks right, but key parts are unclear" : "Improve the answer before relying on it"
  }

  const strategy = result.prompt_strategy
  if (mode === "deep") {
    if (result.status === "WRONG_DIRECTION") return "This answer targets the wrong goal"
    if (result.status === "FAILED") return "Key checklist items are still missing"
    if (result.status === "PARTIAL") {
      return confirmedCount === 0
        ? "Key checklist items are still unproven"
        : "Some checklist items look right, but aren’t proven yet"
    }
  }
  if (result.status === "SUCCESS") {
    return mode === "deep" ? "Looks correct — based on visible proof" : "Looks ready to continue"
  }
  if (strategy === "fix_missing") return "Missing a key piece — don’t proceed yet"
  if (strategy === "narrow_scope") return "Too broad — focus on what actually matters"
  return mode === "deep" ? "This may be wrong — don’t trust it yet" : "Validate this before proceeding"
}

function buildRecommendation(result: AfterAnalysisResult, mode: ReviewPopupMode, taskType: ReviewTaskType, qualityTask: boolean) {
  const debugContinuation = taskType === "debug" && result.prompt_strategy === "narrow_scope"

  if (debugContinuation) {
    return mode === "deep"
      ? "Check what actually happens in runtime before changing anything else."
      : "Check the most likely runtime gap before changing more code."
  }

  if (qualityTask) {
    if (result.status === "SUCCESS") {
      return mode === "deep"
        ? "You can use this as-is."
        : "Continue, no changes needed."
    }

    return mode === "deep"
      ? "Fix the unclear or missing parts before using this."
      : "Ask for the missing step or clarification only."
  }

  if (result.status === "SUCCESS") {
    return mode === "deep"
      ? "Proceed, but only trust what’s clearly supported."
      : "Keep moving, but stay alert for anything still lightly supported."
  }

  if (mode === "deep") {
    if (result.status === "WRONG_DIRECTION") return "Start fresh with the right target before proceeding."
    if (result.status === "FAILED") return "Resolve the missing proof before moving forward."
    if (taskType === "verification") return "Prove the missing points before trusting this."
    if (taskType === "debug") return "Check what actually happens in runtime before changing anything else."
    return "Complete the missing proof before trusting this."
  }

  switch (result.prompt_strategy) {
    case "fix_missing":
      return "Ask for the missing piece — not a full rewrite"
    case "narrow_scope":
      return "Focus only on what’s still unresolved"
    default:
      return "Use a lighter validation step before building further."
  }
}

function buildMissingItems(result: AfterAnalysisResult, mode: ReviewPopupMode, taskType: ReviewTaskType) {
  const stageMissing = result.stage_2.missing_criteria
    .slice(0, mode === "deep" ? 2 : 3)
    .map((item) => (mode === "deep" ? item : `${item} (not clearly proven yet)`))
  if (stageMissing.length) return stageMissing

  const checklistMissing = result.acceptance_checklist
    .filter((item) => item.status !== "met")
    .slice(0, mode === "deep" ? 2 : 3)
    .map((item) => checklistLabel(item, mode, taskType))
  if (checklistMissing.length) return checklistMissing

  return result.issues.slice(0, 3)
}

function buildWhyItems(result: AfterAnalysisResult) {
  const candidates = [...result.findings, ...result.stage_2.analysis_notes]
  const unique = Array.from(new Set(candidates.map((item) => item.trim()).filter(Boolean)))
  return unique.slice(0, 3)
}

function buildProofChecked(result: AfterAnalysisResult, mode: ReviewPopupMode, taskType: ReviewTaskType, qualityTask: boolean) {
  if (taskType === "debug") {
    const codeEvidence = result.stage_1.claimed_evidence.slice(0, 3)
    if (codeEvidence.length) return codeEvidence

    return [
      mode === "deep"
        ? "Code changes were described, but runtime verification is still thin."
        : "Checked: the assistant described code changes or the intended fix."
    ]
  }

  if (qualityTask) {
    const addressed = result.stage_2.addressed_criteria.slice(0, 3)
    if (addressed.length) return addressed

    return [
      mode === "deep"
        ? "The answer was checked for clarity, completeness, and major omissions."
        : "The answer was checked for directness and basic usability."
    ]
  }

  const fromStage = result.stage_1.claimed_evidence.slice(0, 3)
  if (fromStage.length) return fromStage

  const fromSummary = result.response_summary.change_claims.slice(0, 3)
  if (fromSummary.length) return fromSummary

  return [
    mode === "deep"
      ? "The answer explains an approach, but no concrete result proof was shown."
      : "The answer describes an approach."
  ]
}

function buildProofMissing(result: AfterAnalysisResult, mode: ReviewPopupMode, taskType: ReviewTaskType, qualityTask: boolean) {
  if (taskType === "debug") {
    const missing = result.stage_2.missing_criteria.slice(0, 5)
    if (missing.length) return missing

    return [
      mode === "deep"
        ? "Live runtime confirmation is still missing."
        : "Not checked: the runtime result is still not confirmed."
    ]
  }

  if (qualityTask) {
    const missing = result.stage_2.missing_criteria.slice(0, 3)
    if (missing.length) return missing

    return [
      mode === "deep"
        ? "No major omissions or unsafe steps stood out in this review."
        : "No obvious missing step stood out in this quick read."
    ]
  }

  const missing = result.stage_2.missing_criteria.slice(0, 3)
  if (missing.length) {
    return missing.map((item) =>
      mode === "deep" ? `No concrete proof was shown for: ${item}.` : item
    )
  }

  return [
    mode === "deep"
      ? "The answer explains the fix, but not the outcome."
      : "Some proof is still lightweight in this quick read."
  ]
}

function buildQuickToDeepDelta(quick: AfterAnalysisResult | null, deep: AfterAnalysisResult, qualityTask: boolean) {
  if (!quick) {
    return qualityTask
      ? "Deep review used the same checklist with a stricter completeness and clarity check."
      : "Deep review used the same checklist with stronger proof expectations."
  }

  const quickConfidence = rankConfidence(quick.confidence)
  const deepConfidence = rankConfidence(deep.confidence)
  const unresolvedQuick = quick.acceptance_checklist.filter((item) => item.status !== "met").length
  const unresolvedDeep = deep.acceptance_checklist.filter((item) => item.status !== "met").length

  if (quick.status !== deep.status || quickConfidence !== deepConfidence) {
    return `Deep review tightened the result from ${quick.status.toLowerCase()} (${quick.confidence}) to ${deep.status.toLowerCase()} (${deep.confidence}).`
  }

  if (unresolvedDeep !== unresolvedQuick) {
    return `Deep review kept the same direction, but changed the unresolved count from ${unresolvedQuick} to ${unresolvedDeep}.`
  }

  return qualityTask
    ? "Deep review kept the same checklist but judged it with a stricter completeness standard."
    : "Deep review kept the same checklist but judged it with stronger proof standards."
}

function buildPromptActions(onSubmitPrompt: () => void): PopupAction[] {
  return [{ id: "submit", label: "Submit prompt", kind: "primary", onClick: onSubmitPrompt }]
}

function isNoRetryPrompt(prompt: string) {
  return /^no retry needed\./i.test(prompt.trim())
}

function deriveSmartStatusBadge(params: {
  promptText: string
  fallbackStatus: AfterAnalysisResult["status"]
  contract?: ReviewContract | null
}) {
  if (isNoRetryPrompt(params.promptText)) {
    return { label: "Looks good", tone: "success" as const }
  }

  const smartJudgments = params.contract?.analysisDebug?.smart.judgments ?? []
  const unresolved = smartJudgments.filter((item) => item.status !== "met")
  const hardFailures = unresolved.filter(
    (item) =>
      item.status === "contradicted" ||
      (item.status === "missing" && item.confidence === "high" && item.usefulness >= 78)
  )

  if (hardFailures.length > 0) {
    return { label: "Not usable yet", tone: "danger" as const }
  }

  if (unresolved.length > 0) {
    return { label: "Needs review", tone: "warning" as const }
  }

  return {
    label:
      params.fallbackStatus === "SUCCESS"
        ? "Looks good"
        : params.fallbackStatus === "PARTIAL"
          ? "Needs review"
          : "Not usable yet",
    tone:
      params.fallbackStatus === "SUCCESS"
        ? ("success" as const)
        : params.fallbackStatus === "PARTIAL"
          ? ("warning" as const)
          : ("danger" as const)
  }
}

function mapContractChecklistStatus(status: ReviewContract["requirements"][number]["status"]): ReviewPopupViewModel["checklistRows"][number]["status"] {
  switch (status) {
    case "pass":
      return "verified"
    case "unclear":
      return "blocked"
    default:
      return "missing"
  }
}

function normalizePromptText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function buildPromptCardText(result: AfterAnalysisResult) {
  const basePrompt = (result.next_prompt_output?.next_prompt || result.next_prompt || "").trim()
  if (!basePrompt) return ""

  const focusItems = [
    ...result.stage_2.missing_criteria,
    ...result.acceptance_checklist
      .filter((item) => item.status !== "met")
      .map((item) => item.label)
  ]
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, all) => all.indexOf(item) === index)
    .slice(0, 3)

  if (!focusItems.length) return basePrompt

  const normalizedBasePrompt = normalizePromptText(basePrompt)
  const alreadyMentionsSpecificFocus = focusItems.some((item) =>
    normalizedBasePrompt.includes(normalizePromptText(item))
  )

  if (alreadyMentionsSpecificFocus) return basePrompt

  return `${basePrompt}\n\nFocus only on these items:\n${focusItems.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
}

export function mapAfterAnalysisToReviewViewModel(input: {
  result: AfterAnalysisResult
  reviewContract?: ReviewContract | null
  mode: ReviewPopupMode
  taskType: ReviewTaskType
  quickBaseline: AfterAnalysisResult | null
  onCopyPrompt: () => void
}): ReviewPopupViewModel {
  const { result, reviewContract, mode, taskType, quickBaseline, onCopyPrompt } = input
  const isDeep = mode === "deep"
  const contract = reviewContract && isAnswerQualityTask(taskType) ? reviewContract : null

  if (contract) {
    const guardedDecision = guardrailText(contract.overallDecision, contract.taskFamily) || contract.overallDecision
    const guardedRecommendation = guardrailText(contract.recommendation, contract.taskFamily) || contract.recommendation
    const guardedPromptText =
      guardrailText(contract.copyPromptText || contract.promptText, contract.taskFamily) ||
      guardrailText(contract.promptText, contract.taskFamily) ||
      contract.nextMoveShort
    const statusBadge = deriveSmartStatusBadge({
      promptText: guardedPromptText,
      fallbackStatus: result.status,
      contract
    })
    const hidePromptAction = isNoRetryPrompt(guardedPromptText)
    return {
      state: isDeep ? "deep_review" : "quick_review",
      mode,
      eyebrow: isDeep ? "Reality check" : "Quick review",
      title: "AI Answer Check",
      statusBadge,
      decision: guardedDecision,
      recommendedAction: guardedRecommendation,
      promptLabel: guardrailText(contract.promptLabel, contract.taskFamily) || "Next best move",
      prompt: guardedPromptText,
      promptNote: guardrailText(contract.promptNote, contract.taskFamily) || "",
      promptActions: hidePromptAction ? [] : buildPromptActions(onCopyPrompt),
      confidenceLabel: `Confidence: ${contract.confidence === "high" ? "Usable" : contract.confidence === "medium" ? "Needs review" : "Weak"}`,
      confidenceNote: guardrailText(contract.confidenceNote, contract.taskFamily) || contract.confidenceNote,
      confidenceReasons: guardrailList(contract.confidenceReasons, contract.taskFamily),
      missingItems: guardrailList(contract.missingItems, contract.taskFamily),
      whyItems: guardrailList(contract.whyItems, contract.taskFamily),
      proofSummary: guardrailText(contract.proofSummary, contract.taskFamily) || contract.proofSummary,
      checkedArtifacts: guardrailList(contract.checkedItems, contract.taskFamily),
      uncheckedArtifacts: guardrailList(contract.uncheckedItems, contract.taskFamily),
      checklistRows: contract.requirements.map((item) => ({
        id: `${mode}-${item.id}`,
        label: `${item.label} (${item.status === "pass" ? "Confirmed" : item.status === "unclear" ? "Unclear" : "Missing"})`,
        status: mapContractChecklistStatus(item.status)
      })),
      quickToDeepDelta: isDeep ? buildQuickToDeepDelta(quickBaseline, result, true) : "",
      feedbackPrompt: guardrailText(contract.feedbackPrompt, contract.taskFamily) || contract.feedbackPrompt
    }
  }

  const informationalTask = usesAnswerQualityWording(result, taskType)
  const noFollowUpNeeded = informationalTask && result.status === "SUCCESS"
  const guardTaskFamily = informationalTask ? taskType : "debug"
  const copyAlignedPrompt = (result.next_prompt_output?.next_prompt || result.next_prompt || "").trim()
  const informationalPrompt = informationalTask
    ? guardrailText(noFollowUpNeeded ? "Nothing critical missing — safe to proceed." : copyAlignedPrompt, guardTaskFamily) || ""
    : noFollowUpNeeded ? "Nothing critical missing — safe to proceed." : copyAlignedPrompt
  const hidePromptAction = noFollowUpNeeded || isNoRetryPrompt(informationalPrompt)

  return {
    state: isDeep ? "deep_review" : "quick_review",
    mode,
    eyebrow: isDeep ? "Reality check" : "Quick review",
    title: "AI Answer Check",
    statusBadge: {
      label: isDeep ? deepStatusLabel(result.status, informationalTask) : quickStatusLabel(result.status, informationalTask),
      tone: toneForStatus(result.status)
    },
    decision: informationalTask
      ? guardrailText(buildDecision(result, mode, taskType, informationalTask), guardTaskFamily) || buildDecision(result, mode, taskType, informationalTask)
      : buildDecision(result, mode, taskType, informationalTask),
    recommendedAction: informationalTask
      ? guardrailText(buildRecommendation(result, mode, taskType, informationalTask), guardTaskFamily) || buildRecommendation(result, mode, taskType, informationalTask)
      : buildRecommendation(result, mode, taskType, informationalTask),
    promptLabel: informationalTask
      ? guardrailText(noFollowUpNeeded ? "Nothing critical missing — safe to proceed" : isDeep ? "Next best move" : "Suggested action", guardTaskFamily) || "Next best move"
      : noFollowUpNeeded ? "Nothing critical missing — safe to proceed" : isDeep ? "Next best move" : "Suggested action",
    prompt: informationalPrompt,
    promptNote: informationalTask
      ? isDeep
        ? "Deep checks for missing steps, ambiguity, and major omissions."
        : "Quick checks whether the answer is direct, clear, and usable."
      : isDeep
        ? "Deep uses the same checklist with stronger proof expectations."
        : "Quick is a fast directional read.",
    promptActions: hidePromptAction ? [] : buildPromptActions(onCopyPrompt),
    confidenceLabel: `Confidence: ${confidenceLabel(result.confidence, informationalTask)}`,
    confidenceNote: result.confidence_reason || (
      informationalTask
        ? isDeep
          ? "Deep review is stricter about clarity and completeness."
          : "Quick review stays directional instead of overconfident."
        : isDeep
          ? "Deep checks what’s actually proven, not just explained"
          : "Quick review stays directional instead of overconfident."
    ),
    confidenceReasons: informationalTask
      ? guardrailList(result.confidence_reason ? [result.confidence_reason] : [], guardTaskFamily)
      : result.confidence_reason ? [result.confidence_reason] : [],
    missingItems: informationalTask ? guardrailList(buildMissingItems(result, mode, taskType), guardTaskFamily) : buildMissingItems(result, mode, taskType),
    whyItems: informationalTask ? guardrailList(buildWhyItems(result), guardTaskFamily) : buildWhyItems(result),
    proofSummary: taskType === "debug"
      ? "Code was changed, but real results aren’t shown"
      : informationalTask
      ? isDeep
        ? "Same checklist, stricter completeness check."
        : "Answer quality review."
      : isDeep
        ? "What’s explained vs what’s actually proven"
        : "Based on what the answer claims, not what’s proven",
    checkedArtifacts: informationalTask ? guardrailList(buildProofChecked(result, mode, taskType, informationalTask), guardTaskFamily) : buildProofChecked(result, mode, taskType, informationalTask),
    uncheckedArtifacts: informationalTask ? guardrailList(buildProofMissing(result, mode, taskType, informationalTask), guardTaskFamily) : buildProofMissing(result, mode, taskType, informationalTask),
    checklistRows: result.acceptance_checklist
      .filter((item) => !informationalTask || Boolean(guardrailText(item.label, guardTaskFamily)))
      .map((item, index) => ({
      id: `${mode}-${index}-${item.label}`,
      label: informationalTask
        ? `${guardrailText(item.label, guardTaskFamily) || item.label} (${item.status === "met" ? "Confirmed" : item.status === "not_sure" ? "Not proven" : "Missing"})`
        : checklistLabel(item, mode, taskType),
      status: markerForChecklist(item.status, mode, taskType)
    })),
    quickToDeepDelta: isDeep ? buildQuickToDeepDelta(quickBaseline, result, informationalTask) : "",
    feedbackPrompt: isDeep ? "Did this deeper review feel more useful?" : "Did this review help you avoid a bad retry?"
  }
}

export function buildReviewLoadingViewModel(mode: ReviewPopupMode): ReviewPopupViewModel {
  return {
    state: "loading",
    mode,
    eyebrow: mode === "deep" ? "Reality check" : "Quick review",
    title: "AI Answer Check",
    statusBadge: { label: "Preparing", tone: "info" },
    decision: "Checking if this answer actually holds up",
    recommendedAction: "Hold for a moment while the latest answer is checked.",
    promptLabel: "Prompt preview",
    prompt: "",
    promptActions: [],
    confidenceLabel: "Confidence: Pending",
    confidenceNote: "No verdict yet.",
    confidenceReasons: [],
    missingItems: [],
    whyItems: [],
    proofSummary: "",
    checkedArtifacts: [],
    uncheckedArtifacts: [],
    checklistRows: [],
    quickToDeepDelta: "",
    feedbackPrompt: "Did this review help?"
  }
}

export function buildReviewErrorViewModel(message: string, mode: ReviewPopupMode): ReviewPopupViewModel {
  return {
    state: "error",
    mode,
    eyebrow: mode === "deep" ? "Reality check" : "Quick review",
    title: "AI Answer Check",
    statusBadge: { label: "Review unavailable", tone: "danger" },
    decision: "Couldn’t verify this answer safely",
    recommendedAction: message,
    promptLabel: "Prompt preview",
    prompt: "",
    promptActions: [],
    confidenceLabel: "Confidence: Low",
    confidenceNote: "The review could not be completed safely.",
    confidenceReasons: [],
    missingItems: [],
    whyItems: [],
    proofSummary: "",
    checkedArtifacts: [],
    uncheckedArtifacts: [],
    checklistRows: [],
    quickToDeepDelta: "",
    feedbackPrompt: "Did this review help?",
    error: {
      title: "Review unavailable",
      body: message
    }
  }
}
