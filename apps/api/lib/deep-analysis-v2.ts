import {
  DEEP_ANALYSIS_V2_VERSION,
  DeepAnalysisV2RequestSchema,
  DeepAnalysisV2ResultSchema,
  type DeepAnalysisV2Request,
  type DeepAnalysisV2ProviderMetadata,
  type DeepAnalysisV2Requirement,
  type DeepAnalysisV2RequirementMatch,
  type DeepAnalysisV2Result
} from "@prompt-optimizer/shared/src/deep-analysis-v2"
import { trimForBudget } from "./cost-control"
import { callDeepSeekJson } from "./deepseek"
import { env, runtimeFlags } from "./env"
import { callKimiJson } from "./kimi"

type DeepAnalysisV2ProviderStatus = "success" | "empty" | "invalid" | "failed" | "mocked"

export type DeepAnalysisV2ProviderAttempt = {
  provider: "kimi"
  status: DeepAnalysisV2ProviderStatus
}

type RunDeepAnalysisV2Options = {
  callJson?: (systemPrompt: string, userPrompt: string, maxTokens: number) => Promise<string | null>
  callKimiJson?: (systemPrompt: string, userPrompt: string, maxTokens: number) => Promise<string | null>
  callDeepSeekJson?: (systemPrompt: string, userPrompt: string, maxTokens: number) => Promise<string | null>
  now?: () => number
  hardTimeoutMs?: number
  deepSeekFastFailureTimeoutMs?: number
}

const COMPLETION_CTA = "After you finish, confirm which requirements were completed and suggest the next step."
const DEFAULT_DEEP_ANALYSIS_V2_HARD_TIMEOUT_MS = 15_000
const DEEP_ANALYSIS_V2_DEEPSEEK_FAST_FAILURE_TIMEOUT_MS = 8_000
type DeepAnalysisV2FallbackReason = NonNullable<DeepAnalysisV2ProviderMetadata["fallbackReason"]>
type DeepAnalysisV2DeepSeekFailureReason = NonNullable<DeepAnalysisV2ProviderMetadata["deepSeekFailureReason"]>

const DEEP_ANALYSIS_V2_SYSTEM_PROMPT = [
  "You are Deep Analysis v2 for reeva AI, a browser extension for non-technical users building with AI coding agents.",
  "Your job: compare the user's submitted prompt against the assistant answer, decide what is satisfied, identify the assistant's suggested next move, and write the safest next prompt.",
  "Return one JSON object only. Do not use markdown or code fences.",
  "Use camelCase keys exactly matching the requested schema.",
  "Treat the user's prompt as the source of truth.",
  "If the assistant suggests a next step that is too early for the project phase, record that suggestion but recommend the safer next move.",
  `Every generatedPrompt must end with: ${COMPLETION_CTA}`
].join("\n")

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeLower(value: string) {
  return normalize(value).toLowerCase()
}

function slugify(value: string) {
  return normalize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "requirement"
}

function uniqueRequirements(items: DeepAnalysisV2Requirement[]) {
  const seen = new Set<string>()
  const output: DeepAnalysisV2Requirement[] = []
  for (const item of items) {
    const text = normalize(item.text)
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push({
      ...item,
      id: item.id || slugify(text),
      text
    })
  }
  return output.slice(0, 12)
}

function extractFallbackRequirements(promptText: string): DeepAnalysisV2Requirement[] {
  const requirements: DeepAnalysisV2Requirement[] = []
  const phaseGoalMatch = promptText.match(/\bphase\s+(\d+)\s+goal\s*:\s*([^.\n]+)/i)
  if (phaseGoalMatch?.[1] && phaseGoalMatch[2]) {
    requirements.push({
      id: `phase_${phaseGoalMatch[1]}_goal`,
      text: `Complete Phase ${phaseGoalMatch[1]}: ${normalize(phaseGoalMatch[2])}.`,
      source: "submitted_prompt"
    })
  }
  if (/\b(?:ui only|form ui only|booking form ui only|visual form)\b/i.test(promptText)) {
    requirements.push({
      id: "ui_only_scope",
      text: "Keep this step scoped to UI only.",
      source: "submitted_prompt"
    })
  }
  if (/\b(?:create|build|add|implement)\s+(?:a\s+)?(?:signup|sign-up|sign in|sign-in|login|auth)\s+(?:ui|screen|form|flow)\b/i.test(promptText)) {
    requirements.push({
      id: "auth_ui",
      text: "Create the requested authentication UI.",
      source: "submitted_prompt"
    })
  }
  if (/\bvalidat(?:e|ion)|required fields?\b/i.test(promptText)) {
    requirements.push({ id: "validate_required_fields", text: "Validate required fields.", source: "submitted_prompt" })
  }
  if (/\bprevent\s+empty\s+submissions?\b|\bempty-submit\b/i.test(promptText)) {
    requirements.push({ id: "prevent_empty_submission", text: "Prevent empty submissions.", source: "submitted_prompt" })
  }
  if (/\bshow\s+errors?\b|\berror messages?\b|\berror states?\b/i.test(promptText)) {
    requirements.push({ id: "show_errors", text: "Show errors.", source: "submitted_prompt" })
  }
  if (/\bconfirmation\s+summary\b|\bbooking summary\b|\bsummary after\b/i.test(promptText)) {
    requirements.push({ id: "confirmation_summary", text: "Display a confirmation summary.", source: "submitted_prompt" })
  }
  if (/\breply very briefly\b|\bbrief(?:ly)?\b/i.test(promptText)) {
    requirements.push({ id: "brief", text: "Reply briefly.", source: "submitted_prompt" })
  }
  if (/\bdo not include code\b|\bno code\b/i.test(promptText)) {
    requirements.push({ id: "no_code", text: "Do not include code.", source: "submitted_prompt" })
  }
  if (/\bsay what you changed\b|\btell me what you changed\b/i.test(promptText)) {
    requirements.push({ id: "say_changed", text: "Say what changed.", source: "submitted_prompt" })
  }
  const phaseCompleteMatch = promptText.match(/\bconfirm\s+phase\s+(\d+)\s+is\s+(?:done|complete|completed)\b/i)
  if (phaseCompleteMatch?.[1]) {
    requirements.push({
      id: `confirm_phase_${phaseCompleteMatch[1]}_complete`,
      text: `Confirm Phase ${phaseCompleteMatch[1]} is complete.`,
      source: "submitted_prompt"
    })
  }
  if (/\b(?:tell me|suggest|say)\s+(?:what\s+)?(?:the\s+)?next\s+(?:phase|step)\b/i.test(promptText)) {
    requirements.push({ id: "suggest_next_step", text: "Suggest the next step.", source: "submitted_prompt" })
  }
  if (/\b(?:write|provide|generate|include)\s+(?:the\s+)?code\s+for\s+phase\s+(\d+)\b/i.test(promptText)) {
    const phaseNumber = promptText.match(/\bphase\s+(\d+)\b/i)?.[1] ?? "1"
    requirements.push({ id: `phase_${phaseNumber}_code`, text: `Provide code for Phase ${phaseNumber}.`, source: "submitted_prompt" })
  }

  return uniqueRequirements(requirements)
}

function splitSentences(value: string) {
  return value
    .split(/(?<=[.!?])\s+|\n+/)
    .map(normalize)
    .filter(Boolean)
}

function findEvidence(responseText: string, pattern: RegExp) {
  const sentence = splitSentences(responseText).find((item) => pattern.test(item))
  return sentence ? [sentence] : []
}

function hasCodeLikeOutput(responseText: string) {
  return /```|<!doctype html>|<html\b|<script\b|<style\b|function\s+\w+\s*\(|const\s+\w+\s*=|let\s+\w+\s*=|class\s+\w+\s*\{/i.test(
    responseText
  )
}

function removeFutureNextStepText(responseText: string) {
  return splitSentences(responseText)
    .filter((sentence) => !/\b(?:next phase|next step|next:|from here)\b/i.test(sentence))
    .join(" ")
}

function removeNegatedInfrastructureClaims(responseText: string) {
  return responseText
    .replace(/\([^)]*\bno\s+(?:backend|api|database|data storage|server|supabase|firebase|storage|local storage|saving|payment)[^)]*\)/gi, "")
    .replace(
      /\b(?:no|without|not|did\s+not|does\s+not|didn't|doesn't)\s+(?:real\s+)?(?:backend|api|database|data storage|server|supabase|firebase|storage|local storage|saving|payment)(?:\s+logic)?\b/gi,
      ""
    )
}

function matchFallbackRequirement(requirement: DeepAnalysisV2Requirement, responseText: string): DeepAnalysisV2RequirementMatch {
  const text = normalizeLower(requirement.text)
  const currentWorkText = removeNegatedInfrastructureClaims(removeFutureNextStepText(responseText))
  let evidence: string[] = []

  if (text.includes("do not include code")) {
    evidence = hasCodeLikeOutput(responseText) ? [] : ["No code block or code-like snippet detected."]
  } else if (text.includes("reply briefly")) {
    const wordCount = normalize(responseText).split(/\s+/).filter(Boolean).length
    evidence = wordCount > 0 && wordCount <= 90 ? [`Answer is brief at ${wordCount} words.`] : []
  } else if (text.includes("say what changed")) {
    evidence = findEvidence(responseText, /\b(created|built|added|implemented|updated|styled|changed)\b/i)
  } else if (text.includes("authentication ui")) {
    evidence = findEvidence(responseText, /\b(created|built|added|implemented|updated|styled)\b[^.?!\n]*(?:auth|login|sign[- ]?in|sign[- ]?up|signup|form|screen|ui)/i)
  } else if (text.includes("validate required fields")) {
    evidence = findEvidence(responseText, /\b(validat(?:ed|ion|e)|required fields?)\b/i)
  } else if (text.includes("prevent empty")) {
    evidence = findEvidence(responseText, /\b(prevent(?:ed)?|block(?:ed)?|stop(?:ped)?)\b[^.?!\n]*\bempty\s+submissions?\b|\bempty\s+submissions?\b[^.?!\n]*\b(prevent(?:ed)?|block(?:ed)?|stop(?:ped)?)\b/i)
  } else if (text.includes("show errors")) {
    evidence = findEvidence(responseText, /\b(error messages?|errors?|inline errors?|error states?)\b/i)
  } else if (text.includes("confirmation summary")) {
    evidence = findEvidence(responseText, /\b(confirmation summary|booking summary|summary after|confirmation screen|confirmation card)\b/i)
  } else if (text.includes("confirm phase")) {
    const phaseNumber = requirement.text.match(/\bphase\s+(\d+)\b/i)?.[1] ?? ""
    evidence = findEvidence(
      responseText,
      new RegExp(`\\bphase\\s+${phaseNumber}\\b[\\s\\S]{0,24}\\b(?:complete|completed|done)\\b`, "i")
    )
  } else if (text.includes("suggest the next step")) {
    evidence = findEvidence(responseText, /\b(?:next phase|next step|next:|next,|from here|i(?:'|’)d recommend|i(?:'|’)d suggest)\b/i)
  } else if (text.includes("ui only")) {
    const implementedBackend = /\b(?:created|built|implemented|connect(?:ed)?|wired|added)\b[^.?!\n]*(?:backend|api|database|data storage|server|supabase|firebase)\b/i.test(currentWorkText)
    const implementedSaving = /\b(?:created|built|implemented|connect(?:ed)?|wired|added|saved|stored)\b[^.?!\n]*(?:saving|storage|local storage|database|data storage|persist(?:ed|ence)?)\b/i.test(currentWorkText)
    evidence =
      !implementedBackend && !implementedSaving
        ? findEvidence(responseText, /\b(?:ui only|no backend|without backend|no backend logic|no database|no storage)\b/i)
        : []
    if (!evidence.length && !implementedBackend && !implementedSaving) {
      evidence = ["Answer describes current UI/form work without backend or storage implementation."]
    }
  } else if (text.includes("provide code")) {
    evidence = hasCodeLikeOutput(responseText) ? ["Code block or code-like output detected."] : []
  } else if (text.includes("phase") && /\b(ui|form|booking form|visual)\b/i.test(text)) {
    const goalEvidence = findEvidence(responseText, /\b(created|built|added|implemented|styled)\b[^.?!\n]*(?:form|field|ui|layout|screen)/i)
    const phaseEvidence = findEvidence(responseText, /\bphase\s+\d+\b[\s\S]{0,24}\b(?:complete|completed|done)\b/i)
    evidence = [...goalEvidence, ...phaseEvidence].slice(0, 2)
  }

  return {
    requirementId: requirement.id,
    requirementText: requirement.text,
    status: evidence.length ? "pass" : "missing",
    evidence,
    note: evidence.length ? "Confirmed by fallback matcher." : "Fallback matcher did not find clear confirmation."
  }
}

function extractAssistantSuggestedNextMove(responseText: string) {
  const lines = responseText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) =>
      normalize(line)
        .replace(/^#{1,6}\s*/, "")
        .replace(/^\*+\s*/, "")
        .replace(/\*+$/g, "")
        .trim()
    )
    .filter(Boolean)

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (/^next\s+(?:phase|step)\s*[:—-]?\s*$/i.test(line)) {
      const nextLine = lines[index + 1]
      if (nextLine) {
        return nextLine
          .replace(/^\*+|\*+$/g, "")
          .replace(/[.。]+$/, "")
          .trim()
      }
    }
  }

  const candidates = splitSentences(responseText)
    .map((sentence) => {
      const match = sentence.match(/(?:➡️\s*)?(?:\bnext\s+(?:phase|step)\b\s*[:—-]?|\bnext\s*[:—-]|\bfrom here\b\s*[:—-]?)/i)
      if (!match || match.index == null) return ""
      return sentence.slice(match.index).trim()
    })
    .filter(Boolean)
  const raw = candidates.at(-1) ?? ""
  return raw
    .replace(/^(?:➡️\s*)?/u, "")
    .replace(/^next\s+(?:phase|step)\s*[:—-]\s*/i, "")
    .replace(/^next\s*[:—-]\s*/i, "")
    .replace(/^from here\s*[:—-]\s*/i, "")
    .replace(/[.。]+$/, "")
    .trim() || null
}

function isBookingPhaseOneUiFlow(input: DeepAnalysisV2Request) {
  const combined = `${input.promptText}\n${input.responseText}`.toLowerCase()
  return (
    /\bbooking app\b/.test(combined) &&
    /\bphase\s+1\b/.test(combined) &&
    /\b(?:ui only|form ui only|booking form ui only|booking form ui|form ui)\b/.test(combined)
  )
}

function buildFallbackGeneratedPrompt(input: DeepAnalysisV2Request, suggestedNextMove: string | null, allRequirementsPass: boolean) {
  if (!allRequirementsPass) {
    const requirements = extractFallbackRequirements(input.promptText)
    const matches = requirements.map((requirement) => matchFallbackRequirement(requirement, input.responseText))
    const missing = matches.filter((match) => match.status !== "pass").map((match) => match.requirementText)
    return [
      "Before we move forward, confirm these requirements from my last prompt:",
      "",
      ...missing.map((item) => `- ${item}`),
      "",
      "For each one, answer:",
      "- Completed, with evidence",
      "- Not completed yet, with what remains",
      "",
      "Do not add new scope yet.",
      "",
      "After confirming, suggest what the next step should be."
    ].join("\n")
  }

  if (isBookingPhaseOneUiFlow(input)) {
    return [
      "Please implement the best next step now:",
      "- Add required field validation",
      "- Show clear error messages",
      "- Prevent empty submission",
      "- Show a booking confirmation summary",
      "",
      "Do not connect a backend yet.",
      "",
      COMPLETION_CTA
    ].join("\n")
  }

  if (!suggestedNextMove) {
    return [
      "Before implementing more, suggest the safest next step based on the completed work and current project state.",
      "",
      "Include:",
      "- What should be done next",
      "- What should not be done yet",
      "- How we will know it is complete",
      "",
      COMPLETION_CTA
    ].join("\n")
  }

  return [
    "Please implement the best next step now:",
    `- ${suggestedNextMove ? suggestedNextMove.charAt(0).toUpperCase() + suggestedNextMove.slice(1) : "Continue with the best next step"}`,
    "",
    COMPLETION_CTA
  ].join("\n")
}

export function buildDeepAnalysisV2Fallback(input: DeepAnalysisV2Request, latencyMs = 0): DeepAnalysisV2Result {
  const requirements = extractFallbackRequirements(input.promptText)
  const requirementMatches = requirements.map((requirement) => matchFallbackRequirement(requirement, input.responseText))
  const missing = requirementMatches.filter((match) => match.status !== "pass")
  const assistantSuggestedNextMove = extractAssistantSuggestedNextMove(input.responseText)
  const allRequirementsPass = missing.length === 0
  const cannotVerify = /\b(?:can't|cannot|can not|unable to)\s+verify\b|\bnot verified\b|\bdo not move to (?:the )?next phase\b|\bdon't move to (?:the )?next phase\b/i.test(input.responseText)
  let generatedPrompt = buildFallbackGeneratedPrompt(input, assistantSuggestedNextMove, allRequirementsPass)
  const promptIntent = allRequirementsPass
    ? cannotVerify
      ? "review_before_advancing"
      : assistantSuggestedNextMove
        ? "implement_next_step"
        : "ask_for_next_step"
    : cannotVerify
      ? "review_before_advancing"
      : "confirm_missing_requirements"
  if (cannotVerify) {
    generatedPrompt = [
      "Before moving forward, provide concrete proof that the current step works.",
      "",
      "Include visible evidence, test results, a preview URL, screenshot, or the relevant code.",
      "If anything is unverified, say what remains and do not start the next phase yet.",
      "",
      COMPLETION_CTA
    ].join("\n")
  }
  const nextStepRequirements = allRequirementsPass
    ? generatedPrompt
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("- "))
        .map((line) => line.replace(/^-\s*/, ""))
        .filter((line) => !/^do not\b/i.test(line))
        .slice(0, 8)
    : []
  const blockedScope = allRequirementsPass
    ? generatedPrompt
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^do not\b/i.test(line))
        .map((line) => line.replace(/\.$/, ""))
        .slice(0, 8)
    : []
  const recommendedNextMove = cannotVerify
    ? "Ask for concrete proof before moving to the next phase."
    : allRequirementsPass
    ? isBookingPhaseOneUiFlow(input)
      ? "Continue with validation and confirmation before backend work."
      : assistantSuggestedNextMove
        ? `Continue with ${assistantSuggestedNextMove}.`
        : "Continue with the best next step."
    : "Ask the assistant to confirm the missing requested requirements before continuing."

  return {
    version: DEEP_ANALYSIS_V2_VERSION,
    requirements,
    requirementMatches,
    overallStatus: cannotVerify ? "risky" : allRequirementsPass ? "pass" : "needs_confirmation",
    assistantSuggestedNextMove,
    recommendedNextMove,
    nextStepSource: assistantSuggestedNextMove ? "assistant_suggestion" : "unavailable",
    nextStepRequirements,
    blockedScope,
    promptIntent,
    generatedPrompt,
    confidence: requirements.length ? "medium" : "low",
    userExplanation: allRequirementsPass
      ? "The fallback matcher found confirmation for the requested requirements."
      : `The fallback matcher found ${missing.length} requested item${missing.length === 1 ? "" : "s"} needing confirmation.`,
    providerMetadata: {
      provider: "fallback",
      latencyMs,
      timedOut: false,
      usedFallback: true
    }
  }
}

function configuredHardTimeoutMs() {
  const raw = env.DEEP_ANALYSIS_V2_HARD_TIMEOUT_MS
  if (!raw) return DEFAULT_DEEP_ANALYSIS_V2_HARD_TIMEOUT_MS
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 1_000 ? parsed : DEFAULT_DEEP_ANALYSIS_V2_HARD_TIMEOUT_MS
}

function compactFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Unknown provider failure")
  return normalize(message).slice(0, 260)
}

function classifyProviderFailure(error: unknown): DeepAnalysisV2FallbackReason {
  if (error instanceof DeepAnalysisV2TimeoutError) return "timeout"
  if (error instanceof SyntaxError) return "invalid_json"
  const name = error && typeof error === "object" && "name" in error ? String((error as { name?: unknown }).name) : ""
  if (/zod/i.test(name)) return "invalid_json"
  return "provider_error"
}

function classifyDeepSeekFailure(error: unknown): DeepAnalysisV2DeepSeekFailureReason {
  const reason = classifyProviderFailure(error)
  return reason === "mocks_enabled" ? "unknown" : reason
}

function promptContains(value: string, expected: string) {
  const prompt = normalizeLower(value)
  const target = normalizeLower(expected)
  if (!target) return true
  if (prompt.includes(target)) return true
  const importantWords = target
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]/g, ""))
    .filter((word) => word.length >= 4 && !/^(with|that|this|from|into|after|before|should|would|could)$/.test(word))
  if (!importantWords.length) return true
  const matches = importantWords.filter((word) => prompt.includes(word)).length
  return matches >= Math.min(2, importantWords.length)
}

function ensurePromptEndsWithCta(prompt: string, cta: string) {
  const trimmed = prompt.trim()
  if (!trimmed) return cta
  if (trimmed.endsWith(cta)) return trimmed
  return `${trimmed}\n\n${cta}`
}

function buildDoNotLine(blockedScope: string[]) {
  const items = blockedScope.map((item) => normalize(item).replace(/^do not\s+/i, "").replace(/[.。]+$/, "")).filter(Boolean)
  if (!items.length) return ""
  const verbItems = items.map((item) => (/^(add|connect|create|store|save|implement|change|modify|deploy|enable)\b/i.test(item) ? item : `add ${item}`))
  if (verbItems.length === 1) return `Do not ${verbItems[0]} yet.`
  const head = verbItems.slice(0, -1).join(", ")
  return `Do not ${head}, or ${verbItems.at(-1)} yet.`
}

function appendMissingActionItems(prompt: string, items: string[]) {
  const missing = items.filter((item) => !promptContains(prompt, item))
  if (!missing.length) return prompt.trim()
  const lines = prompt.trim().split("\n")
  const ctaIndex = lines.findIndex((line) => line.trim() === COMPLETION_CTA)
  const insertion = missing.map((item) => `- ${item}`)
  if (ctaIndex === -1) {
    return [prompt.trim(), "", ...insertion].join("\n").trim()
  }
  return [...lines.slice(0, ctaIndex), ...insertion, "", ...lines.slice(ctaIndex)].join("\n").trim()
}

function repairGeneratedPrompt(result: DeepAnalysisV2Result): DeepAnalysisV2Result {
  const missingRequirementCount = result.requirementMatches.filter((match) => match.status !== "pass").length
  const hasConcreteNextStep =
    result.nextStepRequirements.length > 0 ||
    Boolean(result.generatedPrompt.trim())
  const overallStatus = missingRequirementCount && result.overallStatus === "pass" ? "needs_confirmation" : result.overallStatus
  const promptIntent =
    overallStatus === "pass"
      ? (result.promptIntent === "ask_for_next_step" || result.promptIntent === "implement_next_step") && hasConcreteNextStep
        ? result.promptIntent
        : result.assistantSuggestedNextMove
          ? "implement_next_step"
          : "ask_for_next_step"
      : result.promptIntent === "review_before_advancing"
        ? "review_before_advancing"
        : "confirm_missing_requirements"
  const nextStepSource =
    promptIntent === "ask_for_next_step"
      ? "unavailable"
      : result.assistantSuggestedNextMove && result.nextStepSource === "unavailable"
        ? "assistant_suggestion"
        : !result.assistantSuggestedNextMove && result.nextStepSource === "assistant_suggestion"
          ? "unavailable"
          : result.nextStepSource

  let generatedPrompt = result.generatedPrompt.trim()
  if (promptIntent === "implement_next_step") {
    const nextStepRequirements = result.nextStepRequirements
      .map(normalize)
      .filter(Boolean)
      .slice(0, 8)
    generatedPrompt = appendMissingActionItems(generatedPrompt || "Please implement the best next step now:", nextStepRequirements)

    if (result.blockedScope.length && !/\bdo not\b/i.test(generatedPrompt)) {
      const doNotLine = buildDoNotLine(result.blockedScope)
      if (doNotLine) generatedPrompt = `${generatedPrompt.trim()}\n\n${doNotLine}`
    }
  } else if (promptIntent === "confirm_missing_requirements" && !generatedPrompt) {
    const missing = result.requirementMatches.filter((match) => match.status !== "pass").map((match) => match.requirementText)
    generatedPrompt = [
      "Before we move forward, confirm these requirements from my last prompt:",
      "",
      ...missing.map((item) => `- ${item}`),
      "",
      "For each one, answer:",
      "- Completed, with evidence",
      "- Not completed yet, with what remains",
      "",
      "Do not add new scope yet."
    ].join("\n")
  } else if (promptIntent === "ask_for_next_step" && !generatedPrompt) {
    generatedPrompt = [
      "Before implementing more, suggest the safest next step based on the completed work and current project state.",
      "",
      "Include:",
      "- What should be done next",
      "- What should not be done yet",
      "- How we will know it is complete"
    ].join("\n")
  } else if (promptIntent === "review_before_advancing" && !generatedPrompt) {
    generatedPrompt = [
      "Before moving forward, provide concrete proof that the current step works.",
      "",
      "Include visible evidence, test results, a preview URL, screenshot, or the relevant code.",
      "If anything is unverified, say what remains and do not start the next phase yet."
    ].join("\n")
  }

  return {
    ...result,
    overallStatus,
    nextStepSource,
    promptIntent,
    nextStepRequirements: result.nextStepRequirements.map(normalize).filter(Boolean).slice(0, 8),
    blockedScope: result.blockedScope.map(normalize).filter(Boolean).slice(0, 8),
    generatedPrompt: ensurePromptEndsWithCta(generatedPrompt, COMPLETION_CTA)
  }
}

function buildKimiUserPrompt(input: DeepAnalysisV2Request) {
  const compactInput = {
    taskType: input.taskType,
    surface: input.surface,
    projectContext: trimForBudget(input.projectContext, 1200),
    currentState: trimForBudget(input.currentState, 800),
    submittedPrompt: trimForBudget(input.promptText, 2600),
    assistantAnswer: trimForBudget(input.responseText, 4200)
  }

  return trimForBudget(
    JSON.stringify(
      {
        schema: {
          version: DEEP_ANALYSIS_V2_VERSION,
          requirements: [{ id: "short_snake_case", text: "requirement from submitted prompt", source: "submitted_prompt" }],
          requirementMatches: [
            {
              requirementId: "same id",
              requirementText: "same requirement text",
              status: "pass | missing | unclear",
              evidence: ["short evidence from assistant answer"],
              note: "short reason"
            }
          ],
          overallStatus: "pass | needs_confirmation | risky | fail",
          assistantSuggestedNextMove: "string or null",
          recommendedNextMove: "short safest next action",
          nextStepSource: "assistant_suggestion | project_memory | system_inferred | unavailable",
          nextStepRequirements: ["concrete requirement for the generated prompt"],
          blockedScope: ["scope the next prompt must avoid"],
          promptIntent: "implement_next_step | confirm_missing_requirements | ask_for_next_step | review_before_advancing",
          generatedPrompt: `send-ready prompt ending with: ${COMPLETION_CTA}`,
          confidence: "low | medium | high",
          userExplanation: "one short explanation",
          providerMetadata: { provider: "kimi", timedOut: false, usedFallback: false }
        },
        decision_policy: [
          "Choose exactly one promptIntent.",
          "If requested requirements pass and a next move exists, use implement_next_step.",
          "If requested requirements pass and no next move exists, use ask_for_next_step unless project memory clearly gives the next move.",
          "If requested requirements are missing or unclear, use confirm_missing_requirements.",
          "If the answer says it cannot verify, needs proof, lacks app/code/screenshot, or says do not move forward, use review_before_advancing.",
          "nextStepSource must say where the recommended next move came from: assistant_suggestion, project_memory, system_inferred, or unavailable.",
          "Do not fake an assistant suggestion. Use assistantSuggestedNextMove:null when none exists."
        ],
        prompt_generation_policy: [
          "For implement_next_step: choose the smallest safe next step, then expand it into 3-6 concrete nextStepRequirements.",
          "For implement_next_step: generatedPrompt must include every nextStepRequirement as an actionable request.",
          "For implement_next_step: identify premature scope in blockedScope and include a clear Do not... line in generatedPrompt.",
          "For confirm_missing_requirements: generatedPrompt must ask for evidence on each missing/unclear requested requirement and must not add new scope.",
          "For ask_for_next_step: generatedPrompt must ask the assistant to suggest the safest next step, what not to do yet, and how to know it is complete.",
          "For review_before_advancing: generatedPrompt must ask for concrete proof, visible evidence, tests, URL, screenshot, or code before advancing.",
          "All generatedPrompt values must be short, action-only, user-sendable, and end exactly with the required CTA."
        ],
        rules: [
          "Do not mark a next-step suggestion as missing if the assistant says Next phase, Next step, or Next.",
          "Treat 'Phase 1 complete', 'Phase 1 ✅ Complete', and similar wording as phase completion.",
          "Treat 'no backend logic' or 'no backend added' as evidence that UI-only scope was respected.",
          "A future backend recommendation does not mean the current UI-only phase drifted.",
          "For a booking app after Phase 1 UI, prefer validation and confirmation before backend/data storage.",
          "When the assistant suggests broad work like state management, submission, storage, API, or backend, narrow the generated prompt to the smallest safe next step.",
          "Generated prompts must be short, action-only, and must not reveal hidden reasoning."
        ],
        input: compactInput
      },
      null,
      0
    ),
    9000
  )
}

class DeepAnalysisV2TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DeepAnalysisV2TimeoutError"
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new DeepAnalysisV2TimeoutError(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

function parseProviderResult(input: {
  output: string | null
  provider: "kimi" | "deepseek"
  model: string
  latencyMs: number
}): DeepAnalysisV2Result | null {
  if (!input.output) return null
  const parsed = JSON.parse(input.output) as unknown
  const result = DeepAnalysisV2ResultSchema.parse(parsed)
  return repairGeneratedPrompt({
    ...result,
    version: DEEP_ANALYSIS_V2_VERSION as DeepAnalysisV2Result["version"],
    providerMetadata: {
      ...result.providerMetadata,
      provider: input.provider,
      model: input.model,
      latencyMs: input.latencyMs,
      timedOut: false,
      usedFallback: false
    }
  })
}

export async function runDeepAnalysisV2(
  rawInput: DeepAnalysisV2Request,
  options: RunDeepAnalysisV2Options = {}
): Promise<DeepAnalysisV2Result> {
  const input = DeepAnalysisV2RequestSchema.parse(rawInput)
  const start = options.now?.() ?? Date.now()
  const elapsed = () => Math.max(0, (options.now?.() ?? Date.now()) - start)
  const fallback = (timedOut = false, metadata: Partial<DeepAnalysisV2ProviderMetadata> = {}) => {
    const result = buildDeepAnalysisV2Fallback(input, elapsed())
    return {
      ...result,
      providerMetadata: {
        ...result.providerMetadata,
        timedOut,
        ...metadata
      }
    }
  }

  if (runtimeFlags.useMocks && !options.callJson && !options.callKimiJson && !options.callDeepSeekJson) {
    return {
      ...fallback(false),
      providerMetadata: {
        provider: "fallback",
        latencyMs: elapsed(),
        timedOut: false,
        usedFallback: true,
        providerAttempted: "none",
        fallbackReason: env.KIMI_API_KEY ? "mocks_enabled" : "missing_key",
        failureMessage: env.KIMI_API_KEY
          ? "PROMPT_OPTIMIZER_USE_MOCKS is enabled, so Deep Analysis v2 used deterministic fallback."
          : "No Kimi/Moonshot API key is loaded, so Deep Analysis v2 used deterministic fallback."
      }
    }
  }

  const userPrompt = buildKimiUserPrompt(input)
  const hardTimeoutMs = options.hardTimeoutMs ?? configuredHardTimeoutMs()
  const deepSeekFastFailureTimeoutMs =
    options.deepSeekFastFailureTimeoutMs ?? DEEP_ANALYSIS_V2_DEEPSEEK_FAST_FAILURE_TIMEOUT_MS
  const kimiCall = options.callJson ?? options.callKimiJson ?? callKimiJson
  const deepSeekCall = options.callDeepSeekJson ?? callDeepSeekJson
  let kimiFailureReason: DeepAnalysisV2FallbackReason | null = null
  let kimiFailureMessage: string | null = null
  let kimiLatencyMs: number | undefined

  if (!options.callJson && !options.callKimiJson && !env.KIMI_API_KEY) {
    kimiFailureReason = "missing_key"
    kimiFailureMessage = "No Kimi/Moonshot API key is loaded."
    kimiLatencyMs = elapsed()
  } else {
    try {
      const output = await withTimeout(
        kimiCall(DEEP_ANALYSIS_V2_SYSTEM_PROMPT, userPrompt, 1800),
        hardTimeoutMs,
        "Kimi deep analysis v2"
      )
      kimiLatencyMs = elapsed()
      if (!output) {
        kimiFailureReason = "empty_response"
        kimiFailureMessage = "Kimi returned an empty response."
      } else {
        const parsed = parseProviderResult({
          output,
          provider: "kimi",
          model: env.KIMI_MODEL,
          latencyMs: elapsed()
        })
        if (parsed) return parsed
      }
    } catch (error) {
      kimiLatencyMs = elapsed()
      kimiFailureReason = classifyProviderFailure(error)
      kimiFailureMessage = compactFailureMessage(error)
      if (error instanceof DeepAnalysisV2TimeoutError) {
        return fallback(true, {
          providerAttempted: "kimi",
          fallbackReason: "timeout",
          failureMessage: kimiFailureMessage,
          kimiLatencyMs
        })
      }
    }
  }

  if (!options.callJson) {
    const deepSeekStart = elapsed()
    try {
      const output = await withTimeout(
        deepSeekCall(DEEP_ANALYSIS_V2_SYSTEM_PROMPT, userPrompt, 1800),
        deepSeekFastFailureTimeoutMs,
        "DeepSeek deep analysis v2"
      )
      const deepSeekLatencyMs = Math.max(0, elapsed() - deepSeekStart)
      if (!output) {
        return fallback(false, {
          providerAttempted: "kimi",
          fallbackReason: kimiFailureReason ?? "empty_response",
          failureMessage: kimiFailureMessage ?? "Primary provider returned no usable output.",
          kimiLatencyMs,
          deepSeekAttempted: true,
          deepSeekLatencyMs,
          deepSeekFailureReason: env.DEEPSEEK_API_KEY ? "empty_response" : "missing_key"
        })
      }
      const parsed = parseProviderResult({
        output,
        provider: "deepseek",
        model: env.DEEPSEEK_MODEL,
        latencyMs: elapsed()
      })
      if (parsed) return parsed
    } catch (error) {
      const deepSeekLatencyMs = Math.max(0, elapsed() - deepSeekStart)
      // DeepSeek is a fast-failure fallback only; deterministic fallback keeps the user moving.
      return fallback(false, {
        providerAttempted: "kimi",
        fallbackReason: kimiFailureReason ?? "provider_error",
        failureMessage: kimiFailureMessage ?? "Primary provider did not return a usable structured result.",
        kimiLatencyMs,
        deepSeekAttempted: true,
        deepSeekLatencyMs,
        deepSeekFailureReason: !env.DEEPSEEK_API_KEY ? "missing_key" : classifyDeepSeekFailure(error)
      })
    }
  }

  return fallback(false, {
    providerAttempted: "kimi",
    fallbackReason: kimiFailureReason ?? "unknown",
    failureMessage: kimiFailureMessage ?? "Primary provider did not return a usable structured result.",
    kimiLatencyMs
  })
}

export async function checkDeepAnalysisV2ProviderHealth(options: {
  timeoutMs?: number
  callJson?: (systemPrompt: string, userPrompt: string, maxTokens: number) => Promise<string | null>
  now?: () => number
} = {}) {
  const start = options.now?.() ?? Date.now()
  const elapsed = () => Math.max(0, (options.now?.() ?? Date.now()) - start)
  const timeoutMs = options.timeoutMs ?? 8_000

  if (runtimeFlags.useMocks && !options.callJson) {
    return {
      ok: false,
      provider: "fallback" as const,
      model: env.KIMI_MODEL,
      latencyMs: elapsed(),
      reason: env.KIMI_API_KEY ? "mocks_enabled" : "missing_key",
      message: env.KIMI_API_KEY
        ? "PROMPT_OPTIMIZER_USE_MOCKS is enabled."
        : "No Kimi/Moonshot API key is loaded."
    }
  }

  if (!env.KIMI_API_KEY && !options.callJson) {
    return {
      ok: false,
      provider: "kimi" as const,
      model: env.KIMI_MODEL,
      latencyMs: elapsed(),
      reason: "missing_key",
      message: "No Kimi/Moonshot API key is loaded."
    }
  }

  try {
    const output = await withTimeout(
      (options.callJson ?? callKimiJson)(
        "Return one JSON object only. No markdown.",
        JSON.stringify({ task: "health_check", expected: { ok: true } }),
        80
      ),
      timeoutMs,
      "Kimi health check"
    )
    if (!output) {
      return {
        ok: false,
        provider: "kimi" as const,
        model: env.KIMI_MODEL,
        latencyMs: elapsed(),
        reason: "empty_response",
        message: "Kimi returned an empty response."
      }
    }

    JSON.parse(output)
    return {
      ok: true,
      provider: "kimi" as const,
      model: env.KIMI_MODEL,
      latencyMs: elapsed(),
      reason: null,
      message: "Kimi returned valid JSON."
    }
  } catch (error) {
    return {
      ok: false,
      provider: "kimi" as const,
      model: env.KIMI_MODEL,
      latencyMs: elapsed(),
      reason: classifyProviderFailure(error),
      message: compactFailureMessage(error)
    }
  }
}
