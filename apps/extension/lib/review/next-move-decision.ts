import type { AfterAnalysisResult } from "@prompt-optimizer/shared/src/schemas"
import type { AssistantNextStepSignal } from "./assistant-next-step-signal"
import { buildNextPhasePrompt, type ReviewPhaseProgress } from "./phase-progress"
import type { ReviewWorkflowState } from "./workflow-state"

export type NextMoveDecisionStatus =
  | "complete"
  | "incomplete"
  | "risky"
  | "blocked"
  | "ready_for_next_phase"

export type NextMoveRecommendationKind =
  | "start_next_phase"
  | "continue_optional_enhancement"
  | "finish_missing_requirements"
  | "fix_quality_issues"
  | "clarify_product_decision"
  | "move_to_next_task"
  | "review_before_advancing"

export type NextMoveDecision = {
  status: NextMoveDecisionStatus
  recommendation: {
    kind: NextMoveRecommendationKind
    title: string
    message: string
    assistantContext?: string
    nextStepGuidance?: string
    primaryCtaLabel: string
    secondaryCtaLabel?: string
  }
  reason: string
  confidence: number
  assistantPrompt: {
    title: string
    body: string | null
    mode: "review_first" | "informational_only"
  }
}

export type AssistantSignalFirstDecision = {
  source: "assistant_signal"
  signalKind: AssistantNextStepSignal["kind"]
  decision: NextMoveDecision
}

type BuildNextMoveDecisionInput = {
  analysisStatus: AfterAnalysisResult["status"]
  confidence: AfterAnalysisResult["confidence"]
  workflowState?: ReviewWorkflowState | null
  noRetryRecommended: boolean
  decisionText: string
  recommendationText: string
  promptLabel: string
  promptText: string
  phaseProgress?: ReviewPhaseProgress | null
  assistantSuggestedNextStep?: string | null
  assistantNextStepSignal?: AssistantNextStepSignal | null
}

function confidenceScore(confidence: AfterAnalysisResult["confidence"]) {
  switch (confidence) {
    case "high":
      return 0.92
    case "medium":
      return 0.68
    default:
      return 0.42
  }
}

function informationalPrompt(title: string, body: string | null = null): NextMoveDecision["assistantPrompt"] {
  return {
    title,
    body,
    mode: "informational_only"
  }
}

function reviewPrompt(title: string, body: string): NextMoveDecision["assistantPrompt"] {
  return {
    title,
    body: body.trim() || null,
    mode: body.trim() ? "review_first" : "informational_only"
  }
}

function looksLikeValidationPrompt(promptText: string, recommendationText: string) {
  const normalized = `${promptText} ${recommendationText}`.toLowerCase()
  return /\b(proof|validate|verification|confirm|re-check|check)\b/.test(normalized)
}

function looksLikeMissingRequirementPrompt(promptText: string, recommendationText: string) {
  const normalized = `${promptText} ${recommendationText}`.toLowerCase()
  return /\bmissing\b|\bfinish\b|\bremaining\b|\bincomplete\b|\bstill needs?\b|\bstill need to\b|\bone more pass\b|\bnot complete\b|\bcomplete (?:the|this|current|remaining|missing)\b/.test(normalized)
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase()
}

function reviewPromptOrFallback(title: string, body: string | null | undefined, fallbackTitle: string, fallbackBody: string) {
  const normalized = (body ?? "").trim()
  if (normalized) return reviewPrompt(title, normalized)
  return reviewPrompt(fallbackTitle, fallbackBody)
}

function isCurrentRequestSatisfied(input: BuildNextMoveDecisionInput) {
  const blocked =
    input.analysisStatus === "FAILED" ||
    input.analysisStatus === "WRONG_DIRECTION" ||
    input.workflowState === "blocked"
  const needsValidation =
    input.workflowState === "validation_needed" ||
    looksLikeValidationPrompt(input.promptText, input.recommendationText)
  const missingWork =
    input.analysisStatus !== "SUCCESS" ||
    input.workflowState === "implementation_underway" ||
    looksLikeMissingRequirementPrompt(input.promptText, input.recommendationText)

  return input.noRetryRecommended && !blocked && !needsValidation && !missingWork
}

function fallbackSuggestionAlignment(input: {
  suggestion: string | null | undefined
  recommendationKind: NextMoveRecommendationKind
  nextPhaseLabel?: string | null
}) {
  const suggestion = normalizeText(input.suggestion)
  if (!suggestion) return { aligned: false, conflicting: false, message: "" }

  const nextPhaseLabel = normalizeText(input.nextPhaseLabel)
  const mentionsNextPhase =
    /\b(next phase|phase \d+|move on|continue to the next)\b/.test(suggestion) ||
    (nextPhaseLabel ? suggestion.includes(nextPhaseLabel) : false)
  const mentionsFixCurrent = /\b(finish|complete|fix|address|implement|missing|remaining)\b/.test(suggestion)
  const mentionsReview = /\b(review|verify|validate|check|confirm|test)\b/.test(suggestion)
  const mentionsDecision = /\b(clarify|decide|confirm scope|need input|question)\b/.test(suggestion)

  switch (input.recommendationKind) {
    case "start_next_phase":
      return mentionsNextPhase
        ? {
            aligned: true,
            conflicting: false,
            message: `The assistant also points toward ${input.nextPhaseLabel || "the next phase"}.`
          }
        : mentionsFixCurrent || mentionsReview || mentionsDecision
          ? {
              aligned: false,
              conflicting: true,
              message:
                "The assistant suggested a different immediate next step, but the safer move is to advance only when this phase looks complete."
            }
          : { aligned: false, conflicting: false, message: "" }
    case "finish_missing_requirements":
    case "fix_quality_issues":
      return mentionsFixCurrent || mentionsReview
        ? {
            aligned: true,
            conflicting: false,
            message: "The assistant is pointing toward more work on the current task, which matches the safer next step."
          }
        : mentionsNextPhase
          ? {
              aligned: false,
              conflicting: true,
              message:
                "The assistant is already pointing ahead, but the current task still needs more work before moving on."
            }
          : { aligned: false, conflicting: false, message: "" }
    case "clarify_product_decision":
      return mentionsDecision
        ? {
            aligned: true,
            conflicting: false,
            message: "The assistant also signals that a product decision or clarification is still needed."
          }
        : mentionsNextPhase || mentionsFixCurrent
          ? {
              aligned: false,
              conflicting: true,
              message:
                "The assistant suggested continuing execution, but the safer next step is to clarify the decision first."
            }
          : { aligned: false, conflicting: false, message: "" }
    case "review_before_advancing":
      return mentionsReview
        ? {
            aligned: true,
            conflicting: false,
            message: "The assistant also points toward verification before moving forward."
          }
        : mentionsNextPhase
          ? {
              aligned: false,
              conflicting: true,
              message:
                "The assistant suggested moving ahead, but the safer next step is to verify the current work first."
            }
          : { aligned: false, conflicting: false, message: "" }
    case "move_to_next_task":
      return mentionsNextPhase || mentionsFixCurrent || mentionsReview || mentionsDecision
        ? {
            aligned: false,
            conflicting: true,
            message:
              "The assistant suggested another immediate action, but this task already looks complete enough to let you choose the next task."
          }
        : { aligned: false, conflicting: false, message: "" }
    default:
      return { aligned: false, conflicting: false, message: "" }
  }
}

function assistantIntentAlignment(input: {
  signal?: AssistantNextStepSignal | null
  suggestion?: string | null
  recommendationKind: NextMoveRecommendationKind
  nextPhaseLabel?: string | null
}) {
  const signal = input.signal
  if (!signal) {
    return fallbackSuggestionAlignment({
      suggestion: input.suggestion,
      recommendationKind: input.recommendationKind,
      nextPhaseLabel: input.nextPhaseLabel
    })
  }

  const targetLabel = signal.targetLabel || input.nextPhaseLabel || "the next step"

  switch (input.recommendationKind) {
    case "start_next_phase":
      if (
        (signal.kind === "approval_to_continue" || signal.kind === "start_next_phase") &&
        signal.currentStepClaim === "complete"
      ) {
        return {
          aligned: true,
          conflicting: false,
          message: `The assistant is also pointing toward ${targetLabel}.`
        }
      }
      if (
        signal.kind === "finish_missing_piece" ||
        signal.kind === "continue_current_work" ||
        signal.kind === "validate_or_test" ||
        signal.kind === "clarify_decision"
      ) {
        return {
          aligned: false,
          conflicting: true,
          message:
            "The assistant’s latest intent still points at the current step, so moving ahead would be premature."
        }
      }
      return { aligned: false, conflicting: false, message: "" }
    case "finish_missing_requirements":
    case "fix_quality_issues":
      if (
        signal.kind === "finish_missing_piece" ||
        (signal.kind === "continue_current_work" && signal.currentStepClaim !== "complete") ||
        signal.kind === "validate_or_test"
      ) {
        return {
          aligned: true,
          conflicting: false,
          message: "The assistant’s latest intent still points at finishing or tightening the current step."
        }
      }
      if (
        signal.kind === "approval_to_continue" ||
        signal.kind === "start_next_phase" ||
        signal.kind === "offer_optional_enhancement" ||
        signal.kind === "task_complete"
      ) {
        return {
          aligned: false,
          conflicting: true,
          message:
            "The assistant is already pointing ahead, but the current step still needs more work before you move on."
        }
      }
      return { aligned: false, conflicting: false, message: "" }
    case "clarify_product_decision":
      if (signal.kind === "clarify_decision") {
        return {
          aligned: true,
          conflicting: false,
          message: "The assistant is explicitly asking for a decision or confirmation before continuing."
        }
      }
      if (
        signal.kind === "approval_to_continue" ||
        signal.kind === "start_next_phase" ||
        signal.kind === "continue_current_work"
      ) {
        return {
          aligned: false,
          conflicting: true,
          message:
            "The assistant is trying to continue execution, but the safer next step is to clarify the decision first."
        }
      }
      return { aligned: false, conflicting: false, message: "" }
    case "review_before_advancing":
      if (signal.kind === "validate_or_test") {
        return {
          aligned: true,
          conflicting: false,
          message: "The assistant is also asking for validation before moving forward."
        }
      }
      if (signal.currentStepClaim === "partial" || signal.kind === "finish_missing_piece") {
        return {
          aligned: true,
          conflicting: false,
          message: "The assistant’s latest intent still implies the current step needs one more check."
        }
      }
      if (signal.kind === "approval_to_continue" || signal.kind === "start_next_phase") {
        return {
          aligned: false,
          conflicting: true,
          message:
            "The assistant is asking to move ahead, but the safer next step is to review the current work first."
        }
      }
      return { aligned: false, conflicting: false, message: "" }
    case "move_to_next_task":
      if (signal.kind === "task_complete" && signal.currentStepClaim === "complete") {
        return {
          aligned: true,
          conflicting: false,
          message: "The assistant is also signaling that the current task is wrapped up."
        }
      }
      if (signal.kind === "offer_optional_enhancement") {
        return {
          aligned: false,
          conflicting: true,
          message:
            "The assistant offered an optional follow-up step, so you can either take that step or move on to a new task."
        }
      }
      return { aligned: false, conflicting: false, message: "" }
    case "continue_optional_enhancement":
      if (signal.kind === "offer_optional_enhancement") {
        return {
          aligned: true,
          conflicting: false,
          message: "The assistant is offering a clear optional follow-up step."
        }
      }
      if (signal.kind === "task_complete") {
        return {
          aligned: false,
          conflicting: true,
          message:
            "The assistant only signaled completion, so an optional follow-up should stay clearly optional."
        }
      }
      return { aligned: false, conflicting: false, message: "" }
    default:
      return { aligned: false, conflicting: false, message: "" }
  }
}

function buildAssistantSignalMessage(prefix: string, signal: AssistantNextStepSignal) {
  if (!signal.rawPhrase) return prefix
  return prefix
}

function buildAssistantContext(signal: AssistantNextStepSignal, fallbackLabel?: string | null) {
  switch (signal.kind) {
    case "approval_to_continue":
      return `Assistant asked for approval to continue with ${fallbackLabel || "the next step"}.`
    case "start_next_phase":
      return `Assistant suggested starting ${fallbackLabel || "the next step"}.`
    case "validate_or_test":
      return "Assistant asked for validation before moving on."
    case "clarify_decision":
      return "Assistant asked for a decision or confirmation."
    case "finish_missing_piece":
      return "Assistant pointed out that the current step still needs more work."
    case "continue_current_work":
      return `Assistant suggested continuing the current build${fallbackLabel ? ` toward ${fallbackLabel}` : ""}.`
    case "task_complete":
      return "Assistant signaled that this task is complete."
    case "offer_optional_enhancement":
      return "Assistant offered an optional follow-up step."
    case "unknown":
    default:
      return signal.rawPhrase ? `Assistant’s latest next step: “${signal.rawPhrase}”` : ""
  }
}

function buildGenericContinuationPrompt(label: string, signal: AssistantNextStepSignal) {
  const target = label.trim() || "the next approved step"
  return [
    signal.requiresApproval ? `Continue with ${target} only.` : `Implement ${target} only.`,
    "Keep the work scoped to this next step.",
    "Do not broaden the implementation or jump ahead beyond it.",
    "Preserve the accepted work that is already in place."
  ]
    .filter(Boolean)
    .join("\n\n")
}

function buildOptionalEnhancementPrompt(signal: AssistantNextStepSignal) {
  const target = signal.rawPhrase.trim() || "the optional next step"
  return [
    `Continue with this optional next step only: ${target}`,
    "Keep the scope narrow and preserve the current working implementation.",
    "Do not broaden the build beyond this optional enhancement."
  ].join("\n\n")
}

function cleanPromptDetail(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim().replace(/\.$/, "")
}

function buildFinishCurrentStepPrompt(input: {
  signal?: AssistantNextStepSignal | null
  recommendationText: string
}) {
  const detail =
    (input.signal?.kind === "finish_missing_piece" || input.signal?.kind === "continue_current_work"
      ? cleanPromptDetail(input.signal.rawPhrase)
      : "") || cleanPromptDetail(input.recommendationText)

  return [
    "Stay on the current step only.",
    detail ? `Focus on this gap: ${detail}.` : "",
    "Finish the missing parts before moving on.",
    "Do not start the next step yet.",
    "Preserve the accepted work that is already in place."
  ]
    .filter(Boolean)
    .join("\n\n")
}

function buildClarificationPrompt(input: {
  signal?: AssistantNextStepSignal | null
  recommendationText: string
}) {
  const question =
    (input.signal?.kind === "clarify_decision" ? cleanPromptDetail(input.signal.rawPhrase) : "") ||
    cleanPromptDetail(input.recommendationText)

  return [
    question ? `Answer this before building more: ${question}.` : "Clarify the open product or scope decision before building more.",
    "Keep the response focused on the decision that is still needed.",
    "Do not implement more scope until that decision is clear."
  ]
    .filter(Boolean)
    .join("\n\n")
}

function buildValidationPrompt(input: {
  signal?: AssistantNextStepSignal | null
  recommendationText: string
}) {
  const detail =
    (input.signal?.kind === "validate_or_test" ? cleanPromptDetail(input.signal.rawPhrase) : "") ||
    cleanPromptDetail(input.recommendationText)

  return [
    "Before changing more, validate the current step with concrete proof.",
    detail ? `Focus on this validation need: ${detail}.` : "",
    "Show the exact checks, tests, or visible evidence that confirm the current step works.",
    "If anything is still unproven, say what remains and stop there."
  ]
    .filter(Boolean)
    .join("\n\n")
}

function buildFixQualityPrompt(input: {
  recommendationText: string
}) {
  const detail = cleanPromptDetail(input.recommendationText)

  return [
    "Tighten only the unclear or weak parts of the current answer.",
    detail ? `Focus on this gap: ${detail}.` : "",
    "Keep the same scope and preserve the accepted parts.",
    "Do not broaden the implementation."
  ]
    .filter(Boolean)
    .join("\n\n")
}

function resolvePhaseContinuationEnrichment(input: {
  signal: AssistantNextStepSignal
  phaseProgress?: ReviewPhaseProgress | null
}) {
  const phaseProgress = input.phaseProgress
  if (!phaseProgress?.hasPhasePlan || phaseProgress.isFinalPhase || phaseProgress.nextPhaseIndex === null) {
    return {
      nextPhasePrompt: null,
      nextPhaseLabel: input.signal.targetLabel?.trim() || "the next approved step",
      enrichedByPhasePlan: false
    }
  }

  const nextPhase = phaseProgress.phases[phaseProgress.nextPhaseIndex] ?? null
  const nextPhaseLabel = phaseProgress.nextPhaseLabel?.trim() || nextPhase?.title?.trim() || null
  const nextPhaseNumber = nextPhase ? nextPhase.index + 1 : phaseProgress.nextPhaseIndex + 1
  const signalPhaseNumber = input.signal.targetPhaseNumber
  const signalTarget = input.signal.targetLabel?.trim()
  const matchesPhasePlan =
    signalPhaseNumber == null ||
    signalPhaseNumber === nextPhaseNumber ||
    (signalTarget && nextPhaseLabel ? normalizeText(signalTarget) === normalizeText(nextPhaseLabel) : false)

  if (!matchesPhasePlan) {
    return {
      nextPhasePrompt: null,
      nextPhaseLabel: signalTarget || nextPhaseLabel || "the next approved step",
      enrichedByPhasePlan: false
    }
  }

  return {
    nextPhasePrompt: buildNextPhasePrompt(phaseProgress),
    nextPhaseLabel: nextPhaseLabel || signalTarget || "the next approved step",
    enrichedByPhasePlan: true
  }
}

export function buildAssistantSignalFirstDecision(
  input: BuildNextMoveDecisionInput
): AssistantSignalFirstDecision | null {
  const signal = input.assistantNextStepSignal
  if (!signal) return null

  const confidence = Math.max(confidenceScore(input.confidence), signal.confidence)
  const phaseEnrichment = resolvePhaseContinuationEnrichment({
    signal,
    phaseProgress: input.phaseProgress
  })
  const nextPhasePrompt = phaseEnrichment.nextPhasePrompt
  const nextPhaseLabel = phaseEnrichment.nextPhaseLabel
  const clearlyBlocked =
    input.analysisStatus === "FAILED" ||
    input.analysisStatus === "WRONG_DIRECTION" ||
    input.workflowState === "blocked"
  const validationNeeded =
    input.workflowState === "validation_needed" ||
    looksLikeValidationPrompt(input.promptText, input.recommendationText)
  const missingWork =
    clearlyBlocked ||
    looksLikeMissingRequirementPrompt(input.promptText, input.recommendationText)
  const requestSatisfied =
    isCurrentRequestSatisfied(input) ||
    (signal.currentStepClaim === "complete" &&
      !clearlyBlocked &&
      !validationNeeded &&
      !missingWork)
  const holdCurrentStep =
    !requestSatisfied ||
    missingWork ||
    signal.currentStepClaim === "partial"

  switch (signal.kind) {
    case "approval_to_continue":
    case "start_next_phase":
      if (requestSatisfied) {
        const continuationPrompt = nextPhasePrompt || buildGenericContinuationPrompt(nextPhaseLabel, signal)
        const continuationTitle =
          phaseEnrichment.enrichedByPhasePlan && nextPhasePrompt
            ? `Implement ${nextPhaseLabel}`
            : `Continue with ${nextPhaseLabel}`
        const continuationCta =
          phaseEnrichment.enrichedByPhasePlan && nextPhasePrompt
            ? `Implement ${nextPhaseLabel}`
            : `Continue with ${nextPhaseLabel}`
        return {
          source: "assistant_signal",
          signalKind: signal.kind,
          decision: {
            status: "ready_for_next_phase",
            recommendation: {
              kind: "start_next_phase",
              title: "Ready for next phase",
              message: buildAssistantSignalMessage(
                `This step looks complete enough to move into ${nextPhaseLabel}.`,
                signal
              ),
              assistantContext: buildAssistantContext(signal, nextPhaseLabel),
              nextStepGuidance: `If you want to keep going, use the button below to continue only with ${nextPhaseLabel}.`,
              primaryCtaLabel: continuationCta
            },
            reason: input.decisionText,
            confidence,
            assistantPrompt: reviewPrompt(continuationTitle, continuationPrompt)
          }
        }
      }

      return {
        source: "assistant_signal",
        signalKind: signal.kind,
        decision: {
          status: validationNeeded ? "risky" : "incomplete",
          recommendation: {
            kind: validationNeeded ? "review_before_advancing" : "finish_missing_requirements",
            title: validationNeeded ? "Needs review" : "Finish current step first",
            message: buildAssistantSignalMessage(
              "The assistant is moving ahead too early. Finish or verify the current step before continuing.",
              signal
            ),
            assistantContext: buildAssistantContext(signal, nextPhaseLabel),
            nextStepGuidance: validationNeeded
              ? "Review the current step before you approve anything else."
              : "Use the button below to finish the missing parts before you move forward.",
            primaryCtaLabel: validationNeeded ? "Review before advancing" : "Finish missing requirements"
          },
          reason: input.decisionText,
          confidence,
          assistantPrompt: reviewPromptOrFallback(
            validationNeeded ? "Review before advancing" : "Finish missing requirements",
            validationNeeded
              ? buildValidationPrompt({
                  signal,
                  recommendationText: input.recommendationText
                })
              : buildFinishCurrentStepPrompt({
                  signal,
                  recommendationText: input.recommendationText
                }),
            validationNeeded ? "Validate the current step" : "Finish the current step first",
            validationNeeded
              ? buildValidationPrompt({
                  signal,
                  recommendationText: input.recommendationText
                })
              : buildFinishCurrentStepPrompt({
                  signal,
                  recommendationText: input.recommendationText
                })
          )
        }
      }
    case "validate_or_test":
      return {
        source: "assistant_signal",
        signalKind: signal.kind,
        decision: {
          status: "risky",
          recommendation: {
            kind: "review_before_advancing",
            title: "Validate before moving on",
            message: buildAssistantSignalMessage(
              "Validate the current work before you build further.",
              signal
            ),
            assistantContext: buildAssistantContext(signal),
            nextStepGuidance: "Use the button below to ask for proof, checks, or test evidence before you continue.",
            primaryCtaLabel: "Review before advancing"
          },
          reason: input.decisionText,
          confidence,
          assistantPrompt: reviewPromptOrFallback(
            "Review before advancing",
            buildValidationPrompt({
              signal,
              recommendationText: input.recommendationText
            }),
            "Validate the current step",
            buildValidationPrompt({
              signal,
              recommendationText: input.recommendationText
            })
          )
        }
      }
    case "clarify_decision":
      return {
        source: "assistant_signal",
        signalKind: signal.kind,
        decision: {
          status: "blocked",
          recommendation: {
            kind: "clarify_product_decision",
            title: "Decision needed",
            message: buildAssistantSignalMessage(
              "A decision or confirmation is still needed before more implementation happens.",
              signal
            ),
            assistantContext: buildAssistantContext(signal),
            nextStepGuidance: "Use the button below to answer the assistant’s question before building more.",
            primaryCtaLabel: "Clarify the next step"
          },
          reason: input.decisionText,
          confidence,
          assistantPrompt: reviewPromptOrFallback(
            "Clarify the next step",
            buildClarificationPrompt({
              signal,
              recommendationText: input.recommendationText
            }),
            "Clarify the next step",
            buildClarificationPrompt({
              signal,
              recommendationText: input.recommendationText
            })
          )
        }
      }
    case "continue_current_work":
      if (!holdCurrentStep && signal.currentStepClaim === "complete") {
        const continuationTarget = signal.targetLabel?.trim() || "the next step"
        return {
          source: "assistant_signal",
          signalKind: signal.kind,
          decision: {
            status: "ready_for_next_phase",
            recommendation: {
              kind: "start_next_phase",
              title: "Ready to continue",
              message: buildAssistantSignalMessage(
                `This step looks complete enough to continue with ${continuationTarget}.`,
                signal
              ),
              assistantContext: buildAssistantContext(signal, continuationTarget),
              nextStepGuidance: `If you want to keep going, use the button below to continue only with ${continuationTarget}.`,
              primaryCtaLabel: `Continue with ${continuationTarget}`
            },
            reason: input.decisionText,
            confidence,
            assistantPrompt: reviewPrompt(
              `Continue with ${continuationTarget}`,
              buildGenericContinuationPrompt(continuationTarget, signal)
            )
          }
        }
      }
      return {
        source: "assistant_signal",
        signalKind: signal.kind,
        decision: {
          status: holdCurrentStep ? "incomplete" : "risky",
          recommendation: {
            kind: holdCurrentStep ? "finish_missing_requirements" : "review_before_advancing",
            title: holdCurrentStep ? "Finish current step first" : "Needs review",
            message: buildAssistantSignalMessage(
              "Stay with the current step and finish it before moving on.",
              signal
            ),
            assistantContext: buildAssistantContext(signal),
            nextStepGuidance: holdCurrentStep
              ? "Use the button below to finish the current step before you move on."
              : "Give the current step a quick review before you continue.",
            primaryCtaLabel: holdCurrentStep ? "Finish missing requirements" : "Review before advancing"
          },
          reason: input.decisionText,
          confidence,
          assistantPrompt: reviewPromptOrFallback(
            holdCurrentStep ? "Finish missing requirements" : "Review before advancing",
            holdCurrentStep
              ? buildFinishCurrentStepPrompt({
                  signal,
                  recommendationText: input.recommendationText
                })
              : buildValidationPrompt({
                  signal,
                  recommendationText: input.recommendationText
                }),
            "Finish the current step",
            holdCurrentStep
              ? buildFinishCurrentStepPrompt({
                  signal,
                  recommendationText: input.recommendationText
                })
              : buildValidationPrompt({
                  signal,
                  recommendationText: input.recommendationText
                })
          )
        }
      }
    case "finish_missing_piece":
      return {
        source: "assistant_signal",
        signalKind: signal.kind,
        decision: {
          status: holdCurrentStep ? "incomplete" : "risky",
          recommendation: {
            kind: holdCurrentStep ? "finish_missing_requirements" : "review_before_advancing",
            title: holdCurrentStep ? "Finish current step first" : "Needs review",
            message: buildAssistantSignalMessage(
              "Stay with the current step and finish it before moving on.",
              signal
            ),
            assistantContext: buildAssistantContext(signal),
            nextStepGuidance: holdCurrentStep
              ? "Use the button below to finish the current step before you move on."
              : "Give the current step a quick review before you continue.",
            primaryCtaLabel: holdCurrentStep ? "Finish missing requirements" : "Review before advancing"
          },
          reason: input.decisionText,
          confidence,
          assistantPrompt: reviewPromptOrFallback(
            holdCurrentStep ? "Finish missing requirements" : "Review before advancing",
            holdCurrentStep
              ? buildFinishCurrentStepPrompt({
                  signal,
                  recommendationText: input.recommendationText
                })
              : buildValidationPrompt({
                  signal,
                  recommendationText: input.recommendationText
                }),
            "Finish the current step",
            holdCurrentStep
              ? buildFinishCurrentStepPrompt({
                  signal,
                  recommendationText: input.recommendationText
                })
              : buildValidationPrompt({
                  signal,
                  recommendationText: input.recommendationText
                })
          )
        }
      }
    case "task_complete":
      if (!requestSatisfied && missingWork) {
        return {
          source: "assistant_signal",
          signalKind: signal.kind,
          decision: {
            status: "incomplete",
            recommendation: {
              kind: "finish_missing_requirements",
              title: "Needs one more pass",
              message: buildAssistantSignalMessage(
                "The assistant says this is complete, but the current answer still misses required work.",
                signal
              ),
              assistantContext: buildAssistantContext(signal),
              nextStepGuidance: "Use the button below to finish the missing parts before you move on.",
              primaryCtaLabel: "Finish missing requirements"
            },
            reason: input.decisionText,
            confidence,
            assistantPrompt: reviewPromptOrFallback(
              "Finish missing requirements",
              buildFinishCurrentStepPrompt({
                signal,
                recommendationText: input.recommendationText
              }),
              "Finish missing requirements",
              buildFinishCurrentStepPrompt({
                signal,
                recommendationText: input.recommendationText
              })
            )
          }
        }
      }

      return {
        source: "assistant_signal",
        signalKind: signal.kind,
        decision: {
          status: requestSatisfied ? "complete" : "risky",
          recommendation: {
            kind: requestSatisfied ? "move_to_next_task" : "review_before_advancing",
            title: requestSatisfied ? "Looks complete" : "Needs review",
            message: requestSatisfied
              ? buildAssistantSignalMessage(
                  "This task looks complete. Type your next task, then reopen the extension and I’ll help shape it.",
                  signal
                )
              : buildAssistantSignalMessage(
                  "The assistant says this is complete, but it still needs a quick review before you move on.",
                  signal
                ),
            assistantContext: buildAssistantContext(signal),
            nextStepGuidance: requestSatisfied
              ? "Type your next task into the prompt box, then click the extension again when you want help shaping it."
              : "Give the current answer one quick review before you move on.",
            primaryCtaLabel: requestSatisfied ? "Type next task" : "Review before advancing"
          },
          reason: input.decisionText,
          confidence,
          assistantPrompt: requestSatisfied
            ? informationalPrompt(
                "Nothing critical missing — safe to proceed",
                "No retry needed. The visible answer already covers the requested parts."
            )
            : reviewPromptOrFallback(
                "Review before advancing",
                buildValidationPrompt({
                  signal,
                  recommendationText: input.recommendationText
                }),
                "Review before advancing",
                buildValidationPrompt({
                  signal,
                  recommendationText: input.recommendationText
                })
              )
        }
      }
    case "offer_optional_enhancement":
      return {
        source: "assistant_signal",
        signalKind: signal.kind,
        decision: {
          status: requestSatisfied ? "complete" : "risky",
          recommendation: {
            kind: requestSatisfied ? "continue_optional_enhancement" : "review_before_advancing",
            title: requestSatisfied ? "Optional next step" : "Needs review",
            message: buildAssistantSignalMessage(
              requestSatisfied
                ? "The current task looks complete, and the assistant is offering one optional next step if you want it."
                : "The assistant is offering another step, but the current work should be reviewed before you continue.",
              signal
            ),
            assistantContext: buildAssistantContext(signal),
            nextStepGuidance: requestSatisfied
              ? "Use the button below only if you want to take that optional follow-up step."
              : "Review the current step before you decide whether to take the optional follow-up.",
            primaryCtaLabel: requestSatisfied ? "Continue with optional step" : "Review before advancing",
            secondaryCtaLabel: requestSatisfied ? "Or move to a new task" : undefined
          },
          reason: input.decisionText,
          confidence,
          assistantPrompt: requestSatisfied
            ? reviewPrompt("Continue with optional step", buildOptionalEnhancementPrompt(signal))
            : reviewPromptOrFallback(
                "Review before advancing",
                buildValidationPrompt({
                  signal,
                  recommendationText: input.recommendationText
                }),
                "Review before advancing",
                buildValidationPrompt({
                  signal,
                  recommendationText: input.recommendationText
                })
              )
        }
      }
    case "unknown":
    default:
      return null
  }
}

export function buildNextMoveDecision(input: BuildNextMoveDecisionInput): NextMoveDecision {
  const assistantSignalDecision = buildAssistantSignalFirstDecision(input)
  if (assistantSignalDecision) {
    return assistantSignalDecision.decision
  }

  const confidence = confidenceScore(input.confidence)
  const nextPhaseLabel = input.phaseProgress?.nextPhaseLabel?.trim() || "the next phase"
  const requestSatisfied = isCurrentRequestSatisfied(input)

  if (requestSatisfied) {
    const assistantSignal = assistantIntentAlignment({
      signal: input.assistantNextStepSignal,
      suggestion: input.assistantSuggestedNextStep,
      recommendationKind: "move_to_next_task",
      nextPhaseLabel
    })
    return {
      status: "complete",
      recommendation: {
        kind: "move_to_next_task",
        title: "Looks complete",
        message: [
          "This task looks complete. Type your next task into the prompt box, then click the extension icon again and I’ll help you shape the next step.",
          assistantSignal.message
        ]
          .filter(Boolean)
          .join(" "),
        nextStepGuidance:
          "Type your next task into the prompt box, then click the extension again when you want help shaping it.",
        primaryCtaLabel: "Type next task"
      },
      reason: input.decisionText,
      confidence,
      assistantPrompt: informationalPrompt(
        "Nothing critical missing — safe to proceed",
        "No retry needed. The visible answer already covers the requested parts."
      )
    }
  }

  if (input.analysisStatus === "WRONG_DIRECTION" || input.workflowState === "blocked") {
    const assistantSignal = assistantIntentAlignment({
      signal: input.assistantNextStepSignal,
      suggestion: input.assistantSuggestedNextStep,
      recommendationKind: "clarify_product_decision",
      nextPhaseLabel
    })
    return {
      status: "blocked",
      recommendation: {
        kind: "clarify_product_decision",
        title: "Decision needed",
        message: [input.recommendationText, assistantSignal.message].filter(Boolean).join(" "),
        nextStepGuidance: "Use the button below to answer the open question before building more.",
        primaryCtaLabel: "Clarify the next step"
      },
      reason: input.decisionText,
      confidence,
      assistantPrompt: reviewPrompt(
        "Clarify the next step",
        buildClarificationPrompt({
          signal: input.assistantNextStepSignal,
          recommendationText: input.recommendationText
        })
      )
    }
  }

  if (looksLikeValidationPrompt(input.promptText, input.recommendationText) || input.workflowState === "validation_needed") {
    const assistantSignal = assistantIntentAlignment({
      signal: input.assistantNextStepSignal,
      suggestion: input.assistantSuggestedNextStep,
      recommendationKind: "review_before_advancing",
      nextPhaseLabel
    })
    return {
      status: "risky",
      recommendation: {
        kind: "review_before_advancing",
        title: "Needs review",
        message: [input.recommendationText, assistantSignal.message].filter(Boolean).join(" "),
        nextStepGuidance: "Use the button below to ask for proof, checks, or validation before moving forward.",
        primaryCtaLabel: "Review before advancing"
      },
      reason: input.decisionText,
      confidence,
      assistantPrompt: reviewPrompt(
        "Review before advancing",
        buildValidationPrompt({
          signal: input.assistantNextStepSignal,
          recommendationText: input.recommendationText
        })
      )
    }
  }

  if (input.analysisStatus === "FAILED" || looksLikeMissingRequirementPrompt(input.promptText, input.recommendationText)) {
    const assistantSignal = assistantIntentAlignment({
      signal: input.assistantNextStepSignal,
      suggestion: input.assistantSuggestedNextStep,
      recommendationKind: "finish_missing_requirements",
      nextPhaseLabel
    })
    return {
      status: "incomplete",
      recommendation: {
        kind: "finish_missing_requirements",
        title: "Needs one more pass",
        message: [input.recommendationText, assistantSignal.message].filter(Boolean).join(" "),
        nextStepGuidance: "Use the button below to finish the missing parts before you move forward.",
        primaryCtaLabel: "Finish missing requirements"
      },
      reason: input.decisionText,
      confidence,
      assistantPrompt: reviewPrompt(
        "Finish missing requirements",
        buildFinishCurrentStepPrompt({
          signal: input.assistantNextStepSignal,
          recommendationText: input.recommendationText
        })
      )
    }
  }

  const assistantSignal = assistantIntentAlignment({
    signal: input.assistantNextStepSignal,
    suggestion: input.assistantSuggestedNextStep,
    recommendationKind: "fix_quality_issues",
    nextPhaseLabel
  })
  return {
    status: input.confidence === "low" ? "risky" : "incomplete",
    recommendation: {
      kind: "fix_quality_issues",
      title: input.confidence === "low" ? "Needs review" : "Needs one more pass",
      message: [input.recommendationText, assistantSignal.message].filter(Boolean).join(" "),
      nextStepGuidance:
        input.confidence === "low"
          ? "Give the current answer a quick review before you act on it."
          : "Use the button below to tighten the unclear parts before you continue.",
      primaryCtaLabel: input.confidence === "low" ? "Review before advancing" : "Fix the unclear parts"
    },
    reason: input.decisionText,
    confidence,
    assistantPrompt: reviewPrompt(
      input.confidence === "low" ? "Review before advancing" : "Fix the unclear parts",
      input.confidence === "low"
        ? buildValidationPrompt({
            signal: input.assistantNextStepSignal,
            recommendationText: input.recommendationText
          })
        : buildFixQualityPrompt({
            recommendationText: input.recommendationText
          })
    )
  }
}
