import type { AnalysisAnswerModel } from "./analysis-answer-model"
import type { AnalysisRequestModel } from "./analysis-request-model"
import type { ReviewAnalysisJudgment } from "./contracts"

export type ReviewFollowUpStrategyMode =
  | "no_retry"
  | "direct_revise"
  | "clarify_scope"
  | "validate_before_continue"
  | "plan_first"
  | "split_into_phases"

export type ReviewFollowUpStrategy = {
  mode: ReviewFollowUpStrategyMode
  reason: string
  topJudgments: ReviewAnalysisJudgment[]
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function artifactLabel(requestModel: AnalysisRequestModel) {
  switch (requestModel.artifactFamily) {
    case "prompt_for_coding_tool":
      return "coding prompt"
    case "bug_fix":
      return "fix answer"
    case "code_change":
      return "code change request"
    case "implementation_plan":
      return "implementation plan"
    case "spec":
      return "spec"
    case "verification":
      return "verification answer"
    case "email":
      return "email"
    case "recipe":
      return "recipe"
    case "code":
      return "solution"
    case "plan":
      return "plan"
    case "rewrite":
      return "rewrite"
    case "debug":
      return "fix answer"
    default:
      return "answer"
  }
}

function requestModelOutputHint(requestModel: AnalysisRequestModel) {
  if (requestModel.plainOutputPreferred) {
    return "Return only the updated answer as plain text."
  }

  const outputText = [...requestModel.outputRequirements, ...requestModel.acceptanceCriteria].join(" ").toLowerCase()
  if (requestModel.artifactFamily === "prompt_for_coding_tool") return "Return only the updated coding prompt."
  if (requestModel.artifactFamily === "bug_fix" || requestModel.artifactFamily === "code_change") {
    return "Return only the updated answer, including the exact fix and validation details."
  }
  if (/\btable\b/.test(outputText)) return "Return only the updated answer in the requested table format."
  if (/\binstructions?\b|\bstep-by-step\b/.test(outputText)) return "Return only the updated answer in the requested format."
  return "Return only the updated answer."
}

function codingLike(requestModel: AnalysisRequestModel) {
  return [
    "prompt_for_coding_tool",
    "bug_fix",
    "code_change",
    "implementation_plan",
    "spec",
    "verification",
    "code",
    "debug"
  ].includes(requestModel.artifactFamily)
}

function assistantSignalKind(answerModel: AnalysisAnswerModel) {
  return answerModel.nextStepSignal?.kind ?? "unknown"
}

function looksLikePhaseApprovalTransition(input: {
  requestModel: AnalysisRequestModel
  answerModel: AnalysisAnswerModel
}) {
  const prompt = input.requestModel.rawPrompt.toLowerCase()
  const suggestion = normalize(input.answerModel.suggestedNextStep ?? "").toLowerCase()
  const signal = input.answerModel.nextStepSignal
  const phaseScopedPrompt =
    /\bphase\s+\d+\b/.test(prompt) &&
    (/\bstart with phase\s+\d+\b/.test(prompt) ||
      /\bwrite (?:the )?code for phase\s+\d+\b/.test(prompt) ||
      /\bphase\s+\d+\s+should include\b/.test(prompt) ||
      /\bafter that,?\s+tell me what the next phase should be\b/.test(prompt) ||
      /\bdo not start phase\s+\d+\b/.test(prompt) ||
      /\bwait for my (?:approval|confirmation)\b/.test(prompt))
  const nextPhaseSignal =
    signal?.kind === "start_next_phase" ||
    signal?.kind === "approval_to_continue" ||
    signal?.nextMoveType === "continuation_offer"

  return (
    phaseScopedPrompt &&
    (nextPhaseSignal ||
      /\bmove to phase\s+\d+\b/.test(suggestion) ||
      /\bphase\s+\d+\s+should be\b/.test(suggestion))
  )
}

function assistantSignalSuggestsContinuation(answerModel: AnalysisAnswerModel) {
  const kind = assistantSignalKind(answerModel)
  return (
    kind === "approval_to_continue" ||
    kind === "start_next_phase" ||
    kind === "continue_current_work" ||
    kind === "finish_missing_piece" ||
    kind === "offer_optional_enhancement" ||
    kind === "task_complete"
  )
}

function assistantSignalSuggestsValidation(answerModel: AnalysisAnswerModel) {
  return assistantSignalKind(answerModel) === "validate_or_test"
}

function assistantSignalSuggestsClarification(answerModel: AnalysisAnswerModel) {
  return assistantSignalKind(answerModel) === "clarify_decision"
}

function isProofLike(judgment: ReviewAnalysisJudgment) {
  return /\bproof\b|\bverify\b|\bvalidation\b|\bvalidated\b|\btest\b|\btested\b|\bregression\b|\broot cause\b|\bsmoke\b/i.test(
    judgment.label
  )
}

function isScopeLike(judgment: ReviewAnalysisJudgment) {
  return /\bscope\b|\bpreserve\b|\bunrelated\b|\bwhat (?:it|you) will not change\b|\bleave untouched\b|\bfiles?\b|\bareas?\b|\bchange only\b|\bdo not change\b/i.test(
    judgment.label
  )
}

function isPlanLike(judgment: ReviewAnalysisJudgment) {
  return /\bplan\b|\bphases?\b|\bapproach\b|\brollout\b|\bsteps?\b/i.test(judgment.label)
}

function formatBulletLines(judgments: ReviewAnalysisJudgment[], limit = 3) {
  return judgments.slice(0, limit).map((judgment) => `- ${normalize(judgment.label)}`)
}

function topActionableJudgments(judgments: ReviewAnalysisJudgment[]) {
  const unresolved = judgments.filter((judgment) => judgment.status !== "met")
  const actionable = unresolved.filter(
    (judgment) => judgment.confidence === "high" || judgment.usefulness >= 72 || judgment.status === "contradicted"
  )
  return (actionable.length ? actionable : unresolved).slice(0, 4)
}

export function determineFollowUpStrategy(input: {
  requestModel: AnalysisRequestModel
  answerModel: AnalysisAnswerModel
  judgments: ReviewAnalysisJudgment[]
  noRetryNeeded?: boolean
}): ReviewFollowUpStrategy {
  const top = topActionableJudgments(input.judgments)
  const projectMemory = input.requestModel.projectMemory
  const contextPack = input.requestModel.projectContextPack
  const contextConflicted = contextPack.contextStatus === "conflicted"
  const contextStale = contextPack.contextStatus === "stale"

  if ((input.noRetryNeeded || top.length === 0) && !contextConflicted) {
    return {
      mode: "no_retry",
      reason: "The visible answer already covers the requested parts well enough to proceed.",
      topJudgments: []
    }
  }

  const proofJudgments = top.filter(isProofLike)
  const scopeJudgments = top.filter(isScopeLike)
  const planJudgments = top.filter(isPlanLike)
  const contradictedCount = top.filter((item) => item.status === "contradicted").length
  const unclearCount = top.filter((item) => item.status === "unclear").length
  const highUsefulnessCount = top.filter((item) => item.usefulness >= 82).length
  const sectionSpread = new Set(top.map((item) => item.section)).size
  const codingRequest = codingLike(input.requestModel)
  const validationBiased =
    projectMemory?.currentPhase === "validation" ||
    contextPack.definitionOfDone.length > 0 ||
    (projectMemory?.knownBadDirections ?? []).some((item) => /\bproof\b|\bvalidate\b|\bverification\b|\btest\b/i.test(item))
  const protectedScopePresent =
    contextPack.protectedAreas.length > 0 || contextPack.stableConstraints.length > 0
  const contextSuggestsPlanFirst =
    contextPack.aiDriftPatterns.length > 0 ||
    contextPack.relevantFiles.length >= 3 ||
    contextPack.userIntent.some((item) => /\bmust not\b|\bpreserve\b|\bdo not change\b/i.test(item))

  if (contextConflicted) {
    return {
      mode: "clarify_scope",
      reason: "The current request appears to conflict with saved protected scope or preserved project intent.",
      topJudgments: top.length ? top : input.judgments.slice(0, 3)
    }
  }

  if (
    codingLike(input.requestModel) &&
    looksLikePhaseApprovalTransition({
      requestModel: input.requestModel,
      answerModel: input.answerModel
    }) &&
    contradictedCount === 0
  ) {
    return {
      mode: "no_retry",
      reason: "The current phase looks complete and the assistant is explicitly waiting for approval before moving to the next phase.",
      topJudgments: []
    }
  }

  if (codingRequest && assistantSignalSuggestsValidation(input.answerModel) && contradictedCount === 0) {
    return {
      mode: "validate_before_continue",
      reason: "The assistant is explicitly pointing toward validation, so the next step should verify the current work before broader changes continue.",
      topJudgments: proofJudgments.length ? proofJudgments : top
    }
  }

  if (
    codingRequest &&
    assistantSignalSuggestsClarification(input.answerModel) &&
    contradictedCount === 0 &&
    unclearCount >= 1
  ) {
    return {
      mode: "clarify_scope",
      reason: "The assistant is asking for a decision or confirmation, so the next step should clarify that before broader implementation continues.",
      topJudgments: top
    }
  }

  if (
    codingRequest &&
    assistantSignalSuggestsContinuation(input.answerModel) &&
    contradictedCount === 0
  ) {
    if (proofJudgments.length >= 1) {
      return {
        mode: "validate_before_continue",
        reason: "The assistant is pointing toward continuing, but the current work still needs visible proof before it is safe to move on.",
        topJudgments: proofJudgments
      }
    }

    if (top.length > 0 && top.every((judgment) => isScopeLike(judgment) || isPlanLike(judgment))) {
      return {
        mode: "direct_revise",
        reason: "The assistant is already continuing the task, so the safer next step is a narrow revision instead of a broader planning loop.",
        topJudgments: top
      }
    }
  }

  if (
    proofJudgments.length >= 1 &&
    (proofJudgments.length >= Math.max(1, top.length - 1) ||
      input.requestModel.artifactFamily === "bug_fix" ||
      input.requestModel.artifactFamily === "verification" ||
      input.requestModel.artifactFamily === "debug") &&
    (!input.requestModel.specificity.broadPromptLikely || validationBiased)
  ) {
    return {
      mode: "validate_before_continue",
      reason: "The answer is close, but the missing signal is mainly proof or verification rather than a full rewrite.",
      topJudgments: proofJudgments
    }
  }

  if (codingRequest && (top.length >= 4 && sectionSpread >= 3 && (highUsefulnessCount >= 2 || contradictedCount >= 1))) {
    return {
      mode: "split_into_phases",
      reason: "The request looks too broad or risky to fix safely in one pass, so the next move should split the work into phases.",
      topJudgments: top
    }
  }

  if (
    codingRequest &&
    (
      scopeJudgments.length >= 1 ||
      planJudgments.length >= 1 ||
      contradictedCount >= 1 ||
      protectedScopePresent ||
      contextStale ||
      contextSuggestsPlanFirst ||
      input.requestModel.projectPreferences?.collaborationMode === "plan_first"
    )
  ) {
    return {
      mode: "plan_first",
      reason: contextStale
        ? "The saved project context looks stale, so the next step should realign scope and approach before broader implementation continues."
        : "The next step should lock scope and approach before broader implementation continues.",
      topJudgments: [...scopeJudgments, ...planJudgments].slice(0, 4).length
        ? [...scopeJudgments, ...planJudgments].slice(0, 4)
        : top
    }
  }

  if (input.requestModel.specificity.broadPromptLikely && unclearCount >= Math.max(1, top.length - 1)) {
    return {
      mode: "clarify_scope",
      reason: "The broad request still leaves the important target unclear, so the best next step is a clarification rather than a full retry.",
      topJudgments: top
    }
  }

  return {
    mode: "direct_revise",
    reason: "The unresolved issues are concrete enough that a narrow revision prompt is the best next move.",
    topJudgments: top
  }
}

export function buildStrategyNextMove(input: {
  requestModel: AnalysisRequestModel
  strategy: ReviewFollowUpStrategy
}) {
  const target = artifactLabel(input.requestModel)
  const outputHint = requestModelOutputHint(input.requestModel)

  switch (input.strategy.mode) {
    case "no_retry":
      return "No retry needed. The visible answer already covers the requested parts."
    case "clarify_scope":
      return [
        `Before rewriting the full ${target}, answer only these clarification points:`,
        ...formatBulletLines(input.strategy.topJudgments),
        "Keep the response focused on clarifying the target and boundaries only.",
        "Do not broaden the implementation yet."
      ].join("\n")
    case "validate_before_continue":
      return [
        `Do not rewrite the full ${target} yet. Validate only these still-unproven parts:`,
        ...formatBulletLines(input.strategy.topJudgments),
        "For each point, say what is verified, what is not verified yet, and what visible evidence supports it.",
        "If a point cannot be verified, say that plainly instead of claiming success."
      ].join("\n")
    case "plan_first":
      return [
        `Before making broader changes, return a short plan for the ${target} using these headings only:`,
        "- What I understood",
        "- What I will change",
        "- What I will not change",
        "- Risks or unknowns",
        "- Validation plan",
        "Anchor the plan to these unresolved points:",
        ...formatBulletLines(input.strategy.topJudgments),
        "Do not implement the full change yet."
      ].join("\n")
    case "split_into_phases":
      return [
        `Do not attempt the whole ${target} in one pass. Break it into phases first:`,
        "- Phase 1: smallest safe step",
        "- Phase 2: next scoped step",
        "- Validation after each phase",
        "Build the phases around these unresolved points:",
        ...formatBulletLines(input.strategy.topJudgments),
        "Keep each phase narrow and preserve everything else."
      ].join("\n")
    case "direct_revise":
    default:
      return [
        `Revise the ${target} so it fixes only these remaining issues:`,
        ...formatBulletLines(input.strategy.topJudgments),
        "Preserve everything else that already works.",
        outputHint
      ].join("\n")
  }
}

export function buildStrategyPromptNote(strategy: ReviewFollowUpStrategy) {
  switch (strategy.mode) {
    case "no_retry":
      return "No follow-up is needed."
    case "clarify_scope":
      return "Strategy: clarify the target and boundaries before asking for a broader rewrite."
    case "validate_before_continue":
      return "Strategy: ask for proof or validation before asking the AI to change more."
    case "plan_first":
      return "Strategy: lock the scope, protected areas, and validation plan before broader implementation."
    case "split_into_phases":
      return "Strategy: split the work into smaller safe phases instead of pushing one broad change."
    case "direct_revise":
    default:
      return "Strategy: ask only for the concrete missing parts."
  }
}

export function buildStrategyShortLabel(strategy: ReviewFollowUpStrategy) {
  switch (strategy.mode) {
    case "no_retry":
      return "No retry needed."
    case "clarify_scope":
      return "Clarify the target first."
    case "validate_before_continue":
      return "Ask for validation proof first."
    case "plan_first":
      return "Ask for a plan before broader changes."
    case "split_into_phases":
      return "Split the work into phases."
    case "direct_revise":
    default:
      return "Fix only the remaining gaps."
  }
}
