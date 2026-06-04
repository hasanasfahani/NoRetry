import {
  DEEP_ANALYSIS_V2_ANALYSIS_VERSION,
  DEEP_ANALYSIS_V2_VERSION,
  DeepAnalysisV2RequestSchema,
  DeepAnalysisV2ResultSchema,
  hashDeepAnalysisV2Text,
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
  provider: "deepseek" | "kimi"
  status: DeepAnalysisV2ProviderStatus
}

type RunDeepAnalysisV2Options = {
  callJson?: (systemPrompt: string, userPrompt: string, maxTokens: number, signal?: AbortSignal) => Promise<string | null>
  callKimiJson?: (systemPrompt: string, userPrompt: string, maxTokens: number, signal?: AbortSignal) => Promise<string | null>
  callDeepSeekJson?: (systemPrompt: string, userPrompt: string, maxTokens: number, signal?: AbortSignal) => Promise<string | null>
  now?: () => number
  hardTimeoutMs?: number
  deepSeekFastFailureTimeoutMs?: number
  retryDelayMs?: number
}

const COMPLETION_CTA = "After you finish, confirm which requirements were completed and suggest the next step."
const ANALYSIS_UNAVAILABLE_PROMPT =
  "Review the previous answer against my original requirement. Check if it stayed within scope, avoided backend/storage work, confirmed completion, and suggested the next phase."
const DEFAULT_DEEP_ANALYSIS_V2_HARD_TIMEOUT_MS = 30_000
const DEEP_ANALYSIS_V2_DEEPSEEK_FAST_FAILURE_TIMEOUT_MS = 30_000
const DEEP_ANALYSIS_V2_MAX_OUTPUT_TOKENS = 700
const DEEP_ANALYSIS_V2_REPAIR_OUTPUT_TOKENS = 800
const DEEP_ANALYSIS_V2_RETRY_DELAY_MIN_MS = 300
const DEEP_ANALYSIS_V2_RETRY_DELAY_MAX_MS = 700
const DEEP_ANALYSIS_V2_MIN_RETRY_BUDGET_MS = 500
type DeepAnalysisV2FallbackReason = NonNullable<DeepAnalysisV2ProviderMetadata["fallbackReason"]>
type DeepAnalysisV2DeepSeekFailureReason = NonNullable<DeepAnalysisV2ProviderMetadata["deepSeekFailureReason"]>

const DEEP_ANALYSIS_V2_SYSTEM_PROMPT = [
  "Compare the user prompt with the assistant answer.",
  "Return exactly two tagged sections and no markdown:",
  "<decision_json>{\"verdict\":\"success|partial|wrong|unclear\",\"score\":0,\"issues\":[],\"passed\":[],\"missing\":[],\"ignored_external_validation\":[],\"item_results\":[],\"phase_completion_claimed\":false,\"classification_audit\":[],\"prompt_intent\":\"implement_next_step|ask_for_next_step|confirm_missing_requirements|review_before_advancing\",\"assistant_suggested_next_move\":\"\",\"next_step_requirements\":[],\"blocked_scope\":[]}</decision_json>",
  "<next_prompt>Full next prompt as normal plain text.</next_prompt>",
  "Keep decision_json small. Do not put the full next prompt inside JSON. The next_prompt section is required and must be non-empty.",
  "Judge only whether the assistant answer satisfies the submitted prompt.",
  "Explicit negative instructions count as requirements; obeying them is success, not missing work.",
  "Trust explicit assistant completion claims as evidence unless they contradict the prompt, omit a requirement, or admit a core item is not implemented.",
  "If the answer says a requirement, deliverable, or acceptance criterion is completed, implemented, passed, validated, or evidenced, count it as satisfied.",
  "Do not require screenshots, files, browser proof, or real-user proof unless the prompt explicitly says that proof is mandatory before continuing.",
  "If the assistant only says external/manual/user testing remains while implementation requirements are claimed complete, do not fail the implementation rows for lack of external proof.",
  "Classify checklist items that depend on real users, customers, stakeholders, production data, interviews, surveys, business metrics, live experiments, or approvals as ignored_external_validation.",
  "Do not classify app acceptance criteria as external validation just because they mention users, devices, timing, or two sessions; app behavior such as 'two users see updates within 2 seconds' is app_acceptance_criteria.",
  "Examples: 'A/B test shows lift', '5 customer interviews', 'chef approves suggestions', and 'screen recording across two phones' are external_validation. 'QR scan loads under 3 seconds', 'two users see updates within 2 seconds', and 'recommendations appear within 500ms' are app_acceptance_criteria.",
  "When input.checklistItems is non-empty, item_results is required with one object per checklist item: {\"id\":\"...\",\"text\":\"...\",\"classification\":\"implementation_requirement|app_acceptance_criteria|external_validation\",\"status\":\"pass|missing|unclear|ignored\",\"reason\":\"...\"}.",
  "For item_results, external_validation rows must use status ignored and must also appear in ignored_external_validation.",
  "Do not include ignored_external_validation items in missing, and do not let them block success or next phase prompts.",
  "Set phase_completion_claimed true only when the assistant explicitly says the current phase is complete, completed, closed out, done, or ready for the next phase.",
  "If phase_completion_claimed is true but actionable checklist rows are missing or unclear, still advance the project tracker: generate the next phase prompt and include a short carryover section with only the missing/unclear current-phase items.",
  "classification_audit should briefly explain why ignored rows are external validation and why app behavior/timing rows were not ignored. Do not invent audit notes if unsure.",
  "Use unclear only when a core requirement is omitted, contradicted, or explicitly described as incomplete/unverified.",
  "Separate current-task completion from future-step quality; a bad future suggestion should narrow next_prompt, not fail completed current work.",
  "If current work passes and the submitted prompt/project context has phase-by-phase instructions, identify the next phase from that text and generate next_prompt for that phase only.",
  "For a next phase prompt, use that phase's goal, build scope, out-of-scope, data/state, deliverables, acceptance criteria, and validation proof when available.",
  "Do not ask the assistant to suggest the safest next step when the next phase is already present in the submitted prompt or project context.",
  "blocked_scope must not include data/state, storage, or implementation details explicitly approved for the next phase.",
  "If no next step is suggested and no next phase exists in the prompt/context, next_prompt may ask the assistant to suggest the safest next step.",
  `The <next_prompt> section must end with: ${COMPLETION_CTA}`
].join("\n")

function nowIso() {
  return new Date().toISOString()
}

function buildAnalysisIdentity(input: DeepAnalysisV2Request, completedAt = nowIso()) {
  const submittedPromptHash = input.submittedPromptHash || hashDeepAnalysisV2Text(input.promptText)
  const assistantAnswerHash = input.assistantAnswerHash || hashDeepAnalysisV2Text(input.responseText)
  const analysisId = hashDeepAnalysisV2Text([
    DEEP_ANALYSIS_V2_ANALYSIS_VERSION,
    input.surface,
    input.threadId ?? "",
    input.messageId ?? "",
    submittedPromptHash,
    assistantAnswerHash,
    completedAt
  ].join("::"))

  return {
    analysisId,
    analysisVersion: DEEP_ANALYSIS_V2_ANALYSIS_VERSION,
    analysisState: "v2_ready" as const,
    threadId: input.threadId,
    messageId: input.messageId,
    submittedPromptHash,
    assistantAnswerHash,
    surface: input.surface,
    createdAt: completedAt,
    completedAt
  }
}

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

function uniqueStrings(items: string[], max = 8) {
  const seen = new Set<string>()
  const output: string[] = []
  for (const item of items.map(normalize).filter(Boolean)) {
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(item)
    if (output.length >= max) break
  }
  return output
}

function isNextMoveV2Prompt(promptText: string) {
  return (
    /\bafter you finish,\s*confirm\b/i.test(promptText) &&
    /\b(?:feature brief|large feature brief|bug report|change brief|scope rules|planning rules|please implement this new small feature only|please fix this bug only|please make this small change only|implement a focused feature)\b/i.test(promptText)
  )
}

function splitPromptSections(promptText: string) {
  const sections: Record<string, string[]> = {}
  let current = "intro"
  for (const rawLine of promptText.split("\n")) {
    const line = normalize(rawLine)
    if (!line) continue
    const heading = line.match(/^([A-Z][A-Za-z\s/-]+):$/)
    if (heading?.[1]) {
      current = normalizeLower(heading[1])
      sections[current] = sections[current] ?? []
      continue
    }
    sections[current] = sections[current] ?? []
    sections[current].push(line)
  }
  return sections
}

function stripPromptBullet(value: string) {
  return normalize(value.replace(/^[-*]\s+/, "").replace(/^(?:Bug|Steps to reproduce|Expected behavior|Actual behavior|Screenshot|Change|Feature|Goal|Build scope)\s*:\s*/i, ""))
}

function isConcreteNextMoveRequirement(value: string) {
  const text = normalize(value)
  if (!text) return false
  if (/^(?:please\s+)?(?:implement|fix|make)\s+this\s+(?:new\s+small\s+feature|bug|small\s+change)\s+only\.?$/i.test(text)) return false
  if (/^(?:after you finish|scope rules|planning rules|feature brief|bug report|change brief|large feature brief)\b/i.test(text)) return false
  if (/^(?:what changed|which requested details|how i can manually test|any risks|root cause|files changed|how the fix was verified)\b/i.test(text)) return false
  if (/^do not\b/i.test(text)) return false
  return /\b(?:add|implement|fix|make|display|show|preserve|keep|include|let|allow|ensure|appear|save|update|work|complete|generate|create)\b/i.test(text)
}

function extractNextMoveV2PromptRequirements(promptText: string): DeepAnalysisV2Requirement[] {
  if (!isNextMoveV2Prompt(promptText)) return []

  const beforeConfirmation = promptText.split(/\n\s*After you finish,\s*confirm\s*:/i)[0] ?? promptText
  const beforeScope = beforeConfirmation.split(/\n\s*(?:Scope rules|Planning rules)\s*:/i)[0] ?? beforeConfirmation
  const sections = splitPromptSections(beforeConfirmation)
  const sectionLines = [
    ...(sections["feature brief"] ?? []),
    ...(sections["large feature brief"] ?? []),
    ...(sections["bug report"] ?? []),
    ...(sections["change brief"] ?? [])
  ]
  const paragraphLines = splitSentences(beforeScope).filter((line) => !/^[A-Z][A-Za-z\s/-]+:$/.test(line))
  const preserveScopeLines = (sections["scope rules"] ?? []).filter((line) => /^(?:preserve|keep existing|keep all existing)/i.test(stripPromptBullet(line)))
  const items = uniqueStrings(
    [...sectionLines, ...paragraphLines, ...preserveScopeLines]
      .map(stripPromptBullet)
      .filter(isConcreteNextMoveRequirement),
    8
  )

  return uniqueRequirements(
    items.map((text, index) => ({
      id: `next_move_${index + 1}`,
      text,
      source: "submitted_prompt" as const
    }))
  )
}

function extractFallbackRequirements(promptText: string): DeepAnalysisV2Requirement[] {
  const nextMoveRequirements = extractNextMoveV2PromptRequirements(promptText)
  if (nextMoveRequirements.length) return nextMoveRequirements

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

function isUiOnlyPhaseRequest(input: DeepAnalysisV2Request) {
  const prompt = normalizeLower(`${input.promptText}\n${input.currentState}`)
  return /\bphase\s+\d+\b/.test(prompt) && /\b(?:ui only|frontend-only|front[- ]?end only|visual|list ui|screen ui|form ui|page ui)\b/.test(prompt)
}

function textMentionsPrematureInfrastructure(value: string) {
  return /\b(?:backend|api endpoint|database|storage|persist(?:ence|ent|ed)?|real(?:\s+\w+){0,3}\s+data|data source|server(?:-side)?|auth(?:entication)?|payments?|checkout|email sending|notification sending|file uploads?)\b/i.test(
    value
  )
}

function answerHasVerificationBlocker(value: string) {
  const claimsCompletion = answerClaimsTaskCompletion(value)
  const admitsCoreIncomplete =
    /\b(?:not implemented|not built|not done|incomplete|still missing|still incomplete|failed|not working)\b/i.test(value)
  const externalValidationOnly =
    /\b(?:external|real[- ]world|user|customer|student|manual|device[- ]level).{0,90}\b(?:test|testing|validation|proof|session|shadow|unmoderated)\b/i.test(value) &&
    /\b(?:requires?|needed|still needed|outside|cannot be confirmed inside|must be performed)\b/i.test(value)

  if (claimsCompletion && externalValidationOnly && !admitsCoreIncomplete) return false
  if (claimsCompletion && !admitsCoreIncomplete) return false

  return /\b(?:can't|cannot|can not|unable to)\s+(?:honestly\s+)?(?:confirm|verify)\b|\b(?:not\s+verified|unverified)\b|\bdo not move to (?:the )?next phase\b|\bdon't move to (?:the )?next phase\b|\bdo not continue\b/i.test(
    value
  )
}

function answerClaimsTaskCompletion(value: string) {
  const text = normalizeLower(value)
  const isConditionalCompletion =
    /\bif\b[\s\S]{0,120}\b(?:complete|completed|implemented|done|passed|validated|evidenced|closed out)\b/.test(text) ||
    /\bshould be done\b/.test(text)
  const hasStrongExplicitCompletion =
    /\b(?:phase\s+\d+|current phase|implementation|task)\s+(?:implementation\s+)?(?:is\s+)?(?:complete|completed|implemented|done|closed out)\b/.test(text) ||
    /\b(?:complete|completed|implemented|done|closed out)\s*:\s*(?:phase\s+\d+|current phase|implementation|task)\b/.test(text)
  if (isConditionalCompletion && !hasStrongExplicitCompletion) return false

  return /\b(?:phase\s+\d+|current phase|task|implementation|requirements?|acceptance criteria|deliverables?)\b[\s\S]{0,180}\b(?:complete|completed|implemented|done|passed|validated|evidenced|closed out)\b/i.test(value) ||
    /\b(?:complete|completed|implemented|done|passed|validated|evidenced|closed out)\b[\s\S]{0,180}\b(?:phase\s+\d+|current phase|task|implementation|requirements?|acceptance criteria|deliverables?)\b/i.test(value)
}

function inferBlockedScopeFromRequest(input: DeepAnalysisV2Request, assistantSuggestedNextMove: string | null) {
  if (!isUiOnlyPhaseRequest(input)) return []
  const combinedNext = normalize(`${assistantSuggestedNextMove ?? ""}\n${input.responseText}`)
  if (!textMentionsPrematureInfrastructure(combinedNext)) return []

  const blocked: string[] = []
  if (/\bbackend|server(?:-side)?\b/i.test(combinedNext)) blocked.push("backend")
  if (/\bapi(?: endpoint)?\b/i.test(combinedNext)) blocked.push("API endpoint")
  if (/\bdatabase\b/i.test(combinedNext)) blocked.push("database")
  if (/\bstorage|persist(?:ence|ent|ed)?\b/i.test(combinedNext)) blocked.push("storage")
  if (/\breal(?:\s+\w+){0,3}\s+data|data source\b/i.test(combinedNext)) blocked.push("real data source")
  if (/\bauth(?:entication)?\b/i.test(combinedNext)) blocked.push("authentication")
  if (/\bpayments?|checkout\b/i.test(combinedNext)) blocked.push("payments")
  if (/\bemail sending\b/i.test(combinedNext)) blocked.push("email sending")
  if (/\bnotification sending\b/i.test(combinedNext)) blocked.push("notification sending")
  if (/\bfile uploads?\b/i.test(combinedNext)) blocked.push("file uploads")
  return [...new Set(blocked)]
}

function splitBlockedScopeItems(value: string) {
  return value
    .split(/\s*,\s*|\s+\bor\b\s+|\s+\band\b\s+/i)
    .map((item) => normalize(item.replace(/\byet\b/gi, "").replace(/\.$/, "")))
    .map((item) => item.replace(/^(?:or|and|a|an|the)\s+/i, ""))
    .filter(Boolean)
}

function explicitBlockedScopeFromPrompt(promptText: string) {
  const blocked: string[] = []
  const patterns = [
    /\bdo not add\s+([^.!?\n]+)/gi,
    /\bdon't add\s+([^.!?\n]+)/gi,
    /\bno\s+([^.!?\n]*?(?:backend|api|database|storage|auth|authentication|email sending|payments?|checkout|server|real data|external data|file uploads?)[^.!?\n]*)/gi
  ]

  for (const pattern of patterns) {
    for (const match of promptText.matchAll(pattern)) {
      blocked.push(...splitBlockedScopeItems(match[1] ?? ""))
    }
  }

  return blocked
}

function mergeBlockedScope(...groups: string[][]) {
  const output: string[] = []
  for (const item of groups.flat().map(normalize).filter(Boolean)) {
    const duplicate = output.some(
      (existing) =>
        normalizeLower(existing) === normalizeLower(item) ||
        normalizeLower(existing).includes(normalizeLower(item)) ||
        normalizeLower(item).includes(normalizeLower(existing))
    )
    if (!duplicate) output.push(item)
  }
  return output.slice(0, 12)
}

function blockedScopeIsInfrastructureOrHardProductScope(value: string) {
  const text = normalizeLower(value)
  if (!text) return false
  if (/\b(?:next phase suggestions?|suggesting next phase|next-step suggestions?|implementation code|code inclusion|next phase advancement)\b/.test(text)) {
    return false
  }
  if (/\b(?:backend|api(?: endpoint)?|database|storage|persist(?:ence|ent|ed)?|real(?:\s+\w+){0,3}\s+data|data source|external data|server(?:-side)?|auth(?:entication)?|payments?|checkout|email sending|notification sending|file uploads?)\b/.test(text)) {
    return true
  }
  if (/\b(?:creation\/editing forms|creation forms|editing forms|edit|update|delete|remove|archive|complete|toggle|deletion|analytics|real notification logic)\b/.test(text)) {
    return true
  }
  return false
}

function sanitizeBlockedScope(blockedScope: string[]) {
  return blockedScope.map(normalize).filter(blockedScopeIsInfrastructureOrHardProductScope).slice(0, 8)
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
  const identity = buildAnalysisIdentity(input)
  const requirements = extractFallbackRequirements(input.promptText)
  const requirementMatches = requirements.map((requirement) => matchFallbackRequirement(requirement, input.responseText))
  const missing = requirementMatches.filter((match) => match.status !== "pass")
  const assistantSuggestedNextMove = extractAssistantSuggestedNextMove(input.responseText)
  const allRequirementsPass = missing.length === 0
  const cannotVerify = answerHasVerificationBlocker(input.responseText)
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
  const nextStepRequirements = promptIntent === "implement_next_step"
    ? generatedPrompt
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("- "))
        .map((line) => line.replace(/^-\s*/, ""))
        .filter((line) => !/^do not\b/i.test(line))
        .slice(0, 8)
    : []
  const blockedScope = allRequirementsPass
    ? mergeBlockedScope(
        generatedPrompt
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => /^do not\b/i.test(line))
          .map((line) => line.replace(/\.$/, ""))
          .slice(0, 8),
        explicitBlockedScopeFromPrompt(input.promptText),
        inferBlockedScopeFromRequest(input, assistantSuggestedNextMove)
      )
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

  const normalizedResult = normalizeDeepAnalysisV2Consistency({
    version: DEEP_ANALYSIS_V2_VERSION,
    ...identity,
    analysisMode: "standard",
    requirements,
    requirementMatches,
    ignoredExternalValidation: [],
    actionableMissingItems: missing.map((match) => match.requirementText),
    phaseAdvanceBasis: "",
    phaseCompletionClaimed: answerClaimsTaskCompletion(input.responseText),
    classificationAudit: [],
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
  })
  return normalizedResult
}

function configuredHardTimeoutMs() {
  const raw = env.DEEP_ANALYSIS_V2_HARD_TIMEOUT_MS
  if (!raw) return DEFAULT_DEEP_ANALYSIS_V2_HARD_TIMEOUT_MS
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 1_000
    ? Math.min(parsed, DEFAULT_DEEP_ANALYSIS_V2_HARD_TIMEOUT_MS)
    : DEFAULT_DEEP_ANALYSIS_V2_HARD_TIMEOUT_MS
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

function isRecoverableProviderMessage(message: string) {
  const normalizedMessage = normalizeLower(message)
  if (
    /\b(?:400|401|403)\b/.test(normalizedMessage) ||
    /\b(?:bad request|unauthorized|forbidden|auth(?:entication)? error|invalid api key|missing api key|invalid[_ -]?config|invalid temperature|safety refusal|refusal)\b/.test(
      normalizedMessage
    )
  ) {
    return false
  }
  return /\b(?:429|rate[_ -]?limit|too many requests|max organization concurrency|concurrency|500|502|503|504|5xx|fetch failed|network error|econnreset|etimedout|temporar(?:y|ily)|transient)\b/.test(
    normalizedMessage
  )
}

function isRecoverableProviderFailure(failure: Extract<ProviderAttemptResult, { status: "failed" }>) {
  if (failure.reason === "empty_response") return true
  if (failure.reason !== "provider_error") return false
  return isRecoverableProviderMessage(failure.message)
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

function estimateTokens(...parts: string[]) {
  return Math.max(1, Math.ceil(parts.join("").length / 4))
}

function buildDoNotLine(blockedScope: string[]) {
  const items = blockedScope
    .map((item) =>
      normalize(item)
        .replace(/^do not\s+/i, "")
        .replace(/[.。]+$/, "")
        .replace(/\s+yet$/i, "")
    )
    .filter(Boolean)
  if (!items.length) return ""
  const verbItems = items.map((item) => {
    if (/^(edit|update|delete|remove|archive|complete|toggle)(?:\b|\/)/i.test(item)) return item
    return /^(add|connect|create|store|save|implement|change|modify|deploy|enable)\b/i.test(item) ? item : `add ${item}`
  })
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

function promptLooksLikeConfirmation(value: string) {
  return /\b(?:before we move forward|confirm (?:these|which|the|whether)|for each one|completed, with evidence|not completed yet)\b/i.test(value)
}

function promptLooksLikeReview(value: string) {
  return /\b(?:cannot verify|can't verify|not verified|provide concrete proof|visible evidence|screenshot|test results|do not start the next phase|do not move)\b/i.test(value)
}

function resultHasVerificationBlocker(result: DeepAnalysisV2Result) {
  const text = [
    result.recommendedNextMove,
    result.generatedPrompt,
    result.userExplanation,
    result.assistantSuggestedNextMove ?? "",
    ...result.requirementMatches.map((match) => `${match.requirementText} ${match.note} ${match.evidence.join(" ")}`)
  ].join("\n")
  return promptLooksLikeReview(text)
}

function removeSafeFutureQualifier(value: string) {
  return normalizeLower(value)
    .replace(/\bbefore\s+(?:connecting|adding|integrating|using)\b[\s\S]*$/i, "")
    .replace(/\bwithout\s+(?:connecting|adding|integrating|using)\b[\s\S]*$/i, "")
    .replace(/\bno\s+(?:backend|api|database|storage|auth|authentication|payments?|checkout|email sending|notification sending|file uploads?)\b[\s\S]*$/i, "")
    .trim()
}

function blockedScopeConflictsWithRequirement(requirement: string, blockedScope: string[]) {
  const normalizedRequirement = removeSafeFutureQualifier(requirement)
  if (/\b(?:real(?:\s+\w+){0,3}\s+data|data source)\b/.test(normalizedRequirement) && blockedScope.some((scope) => /\b(?:real data|data source|storage|database|backend)\b/i.test(scope))) {
    return true
  }
  if (/\b(?:backend|api endpoint|database|storage|persist(?:ence|ent|ed)?|server(?:-side)?)\b/.test(normalizedRequirement) && blockedScope.some((scope) => /\b(?:backend|api|database|storage|persist|server|real data|data source)\b/i.test(scope))) {
    return true
  }
  return blockedScope.some((scope) => {
    const normalizedScope = normalizeLower(scope)
      .replace(/^do not\s+/i, "")
      .replace(/\byet\b/g, "")
      .trim()
    if (!normalizedScope) return false
    if (normalizedRequirement.includes(normalizedScope)) return true
    return false
  })
}

function buildImplementNextStepPrompt(result: DeepAnalysisV2Result, nextStepRequirements: string[]) {
  const lines = [
    "Please implement the best next step now:",
    ...nextStepRequirements.map((item) => `- ${item}`)
  ]
  const doNotLine = buildDoNotLine(result.blockedScope)
  if (doNotLine) lines.push("", doNotLine)
  return lines.join("\n")
}

function buildAskForNextStepPrompt(blockedScope: string[] = []) {
  const lines = [
    "Before implementing more, suggest the safest next step based on the completed work and current project state.",
    "",
    "Include:",
    "- What should be done next",
    "- What should not be done yet",
    "- How we will know it is complete"
  ]
  const doNotLine = buildDoNotLine(blockedScope)
  if (doNotLine) lines.push("", doNotLine)
  return lines.join("\n")
}

function capitalizeFirst(value: string) {
  const trimmed = value.trim()
  return trimmed ? `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}` : trimmed
}

const OBJECT_MANAGEMENT_NOUN_STOPWORDS = new Set([
  "action",
  "actions",
  "archive",
  "auth",
  "backend",
  "basic",
  "behavior",
  "behaviour",
  "client",
  "complete",
  "create",
  "creation",
  "crud",
  "delete",
  "display",
  "edit",
  "frontend",
  "interaction",
  "interactions",
  "local",
  "manage",
  "management",
  "new",
  "remove",
  "state",
  "toggle",
  "ui",
  "update",
  "user",
  "users",
  "with"
])

function singularizeObjectNoun(value: string) {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, "")
  if (!cleaned || OBJECT_MANAGEMENT_NOUN_STOPWORDS.has(cleaned)) return null
  if (cleaned.endsWith("ies") && cleaned.length > 3) return `${cleaned.slice(0, -3)}y`
  if (cleaned.endsWith("s") && !cleaned.endsWith("ss") && cleaned.length > 3) return cleaned.slice(0, -1)
  return cleaned
}

function pluralizeObjectNoun(value: string) {
  if (/[^aeiou]y$/i.test(value)) return `${value.slice(0, -1)}ies`
  if (/(s|x|z|ch|sh)$/i.test(value)) return `${value}es`
  return `${value}s`
}

function objectManagementRequirement(noun: string) {
  const singular = singularizeObjectNoun(noun) ?? "item"
  return `Add local/in-memory ${singular} creation and display new ${pluralizeObjectNoun(singular)} in the ${singular} list`
}

function objectManagementDeferredScope(_text: string) {
  const blocked: string[] = ["edit/update", "delete/remove", "archive", "complete/toggle"]
  blocked.push("backend", "database", "auth", "storage", "payments")
  return blocked
}

function inferObjectManagementNoun(text: string) {
  const patterns = [
    /\bcrud\s+(?:for|on)?\s*([a-z][a-z0-9-]*)\b/gi,
    /\b([a-z][a-z0-9-]*)\s+(?:management|actions?|interactions?)\b/gi,
    /\b([a-z][a-z0-9-]*)s?\s+(?:editable|removable|deletable|updatable|archivable)\b/gi,
    /\b(?:create|creating|add|adding|edit|editing|update|updating|delete|deleting|remove|removing|archive|archiving|complete|completing|toggle|toggling)\s+(?:new\s+)?([a-z][a-z0-9-]*)\b/gi
  ]

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const noun = singularizeObjectNoun(match[1] ?? "")
      if (noun) return noun
    }
  }

  return null
}

function inferObjectManagementLabelNoun(text: string) {
  const patterns = [
    /\bcrud\s+(?:for|on)?\s*([a-z][a-z0-9-]*)\b/gi,
    /\b([a-z][a-z0-9-]*)\s+(?:management|actions?|interactions?)\b/gi
  ]

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const noun = singularizeObjectNoun(match[1] ?? "")
      if (noun) return noun
    }
  }

  return null
}

function hasObjectManagementBundle(text: string) {
  const normalized = normalizeLower(text)
  const hasManagementWord = Boolean(inferObjectManagementLabelNoun(normalized))
  const categoryCount = [
    hasManagementWord,
    /\b(?:create|creating|creation|add|adding)\b/.test(normalized),
    /\b(?:edit|editing|editable|update|updating|updatable)\b/.test(normalized),
    /\b(?:delete|deleting|deletion|remove|removing|removable)\b/.test(normalized),
    /\b(?:archive|archiving|archivable)\b/.test(normalized),
    /\b(?:complete|completion|toggle|toggling|uncomplete)\b/.test(normalized)
  ].filter(Boolean).length

  return hasManagementWord || categoryCount >= 2
}

function makeNextStepRequirementFrontendSafe(value: string) {
  const text = normalize(value)
  if (hasObjectManagementBundle(text)) {
    return objectManagementRequirement(inferObjectManagementNoun(text) ?? "item")
  }
  if (/\bsaved\b/i.test(text) && /\b(?:preview|list|local state|in-memory|frontend|front-end|client-side)\b/i.test(text)) {
    const rewritten = text.replace(/\bsaved\b/gi, "newly added")
    return /\b(?:in-memory|local state|frontend|front-end|client-side)\b/i.test(rewritten)
      ? rewritten
      : `${rewritten} using in-memory state only`
  }
  return text
}

function narrowBroadCrudRequirements(items: string[], contextText = "") {
  const combined = normalize([contextText, ...items].join(" "))
  if (!hasObjectManagementBundle(combined)) {
    return { items, blockedScope: [], changed: false }
  }

  return {
    items: [objectManagementRequirement(inferObjectManagementNoun(combined) ?? "item")],
    blockedScope: objectManagementDeferredScope(combined),
    changed: true
  }
}

function isLlmPhaseHandoffPrompt(result: DeepAnalysisV2Result, generatedPrompt: string) {
  return (
    result.overallStatus === "pass" &&
    result.promptIntent === "implement_next_step" &&
    /\bphase\s+\d+\b/i.test(result.assistantSuggestedNextMove ?? "") &&
    /\bphase\s+\d+\b/i.test(generatedPrompt) &&
    /\b(?:acceptance criteria|validation proof|validate)\b/i.test(generatedPrompt)
  )
}

function repairGeneratedPrompt(result: DeepAnalysisV2Result): DeepAnalysisV2Result {
  const missingRequirementCount = result.requirementMatches.filter((match) => match.status !== "pass").length
  const hasPhaseCompletionCarryover = result.phaseAdvanceBasis === "phase_completion_claimed_with_carryover"
  let blockedScope = sanitizeBlockedScope(result.blockedScope)
  const hasVerificationBlocker = resultHasVerificationBlocker(result)
  const narrowedNextStepRequirements = narrowBroadCrudRequirements(result.nextStepRequirements
    .map(makeNextStepRequirementFrontendSafe)
    .filter(Boolean)
    .filter((item) => !blockedScopeConflictsWithRequirement(item, blockedScope))
    .slice(0, 8), result.assistantSuggestedNextMove ?? "")
  blockedScope = sanitizeBlockedScope(mergeBlockedScope(blockedScope, narrowedNextStepRequirements.blockedScope))
  const rawNextStepRequirements = narrowedNextStepRequirements.items
  const assistantSuggestionIsSafe =
    Boolean(result.assistantSuggestedNextMove) &&
    !blockedScopeConflictsWithRequirement(result.assistantSuggestedNextMove ?? "", blockedScope)
  const overallStatus = hasVerificationBlocker
    ? "risky"
    : missingRequirementCount && result.overallStatus === "pass" && !hasPhaseCompletionCarryover
      ? "needs_confirmation"
      : result.overallStatus
  let promptIntent: DeepAnalysisV2Result["promptIntent"] =
    hasVerificationBlocker
      ? "review_before_advancing"
      : overallStatus === "pass"
      ? assistantSuggestionIsSafe || rawNextStepRequirements.length > 0
        ? "implement_next_step"
        : "ask_for_next_step"
      : result.promptIntent === "review_before_advancing"
        ? "review_before_advancing"
        : "confirm_missing_requirements"
  let normalizedNextStepRequirements =
    promptIntent === "implement_next_step"
      ? rawNextStepRequirements.length
        ? rawNextStepRequirements
        : assistantSuggestionIsSafe && result.assistantSuggestedNextMove
          ? [makeNextStepRequirementFrontendSafe(capitalizeFirst(result.assistantSuggestedNextMove))]
          : []
      : []
  const narrowedNormalizedRequirements = narrowBroadCrudRequirements(normalizedNextStepRequirements, result.assistantSuggestedNextMove ?? "")
  if (narrowedNormalizedRequirements.changed) {
    normalizedNextStepRequirements = narrowedNormalizedRequirements.items
    blockedScope = sanitizeBlockedScope(mergeBlockedScope(blockedScope, narrowedNormalizedRequirements.blockedScope))
  }
  if (promptIntent === "implement_next_step" && !normalizedNextStepRequirements.length) {
    promptIntent = "ask_for_next_step"
    normalizedNextStepRequirements = []
  }
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
    const preserveLlmPhasePrompt = isLlmPhaseHandoffPrompt(result, generatedPrompt)
    const shouldRebuildPrompt =
      !preserveLlmPhasePrompt &&
      (
        !generatedPrompt ||
        promptLooksLikeConfirmation(generatedPrompt) ||
        promptLooksLikeReview(generatedPrompt) ||
        narrowedNextStepRequirements.changed ||
        narrowedNormalizedRequirements.changed
      )

    if (shouldRebuildPrompt) {
      generatedPrompt = buildImplementNextStepPrompt({ ...result, blockedScope }, normalizedNextStepRequirements)
    } else {
      generatedPrompt = appendMissingActionItems(generatedPrompt, normalizedNextStepRequirements)
    }

    if (blockedScope.length && !/\bdo not\b/i.test(generatedPrompt)) {
      const doNotLine = buildDoNotLine(blockedScope)
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
      "Do not add new scope yet.",
      "",
      "After confirming, suggest what the next step should be."
    ].join("\n")
  } else if (promptIntent === "ask_for_next_step") {
    if (!generatedPrompt || promptLooksLikeConfirmation(generatedPrompt) || promptLooksLikeReview(generatedPrompt)) {
      generatedPrompt = buildAskForNextStepPrompt(blockedScope)
    }
  } else if (promptIntent === "review_before_advancing") {
    if (!generatedPrompt || !promptLooksLikeReview(generatedPrompt)) {
      generatedPrompt = [
        "Before moving forward, provide concrete proof that the current step works.",
        "",
        "Include visible evidence, test results, a preview URL, screenshot, or the relevant code.",
        "If anything is unverified, say what remains and do not start the next phase yet."
      ].join("\n")
    }
  }

  return {
    ...result,
    overallStatus,
    nextStepSource,
    promptIntent,
    nextStepRequirements: normalizedNextStepRequirements,
    blockedScope,
    generatedPrompt:
      promptIntent === "confirm_missing_requirements"
        ? generatedPrompt.trim()
        : ensurePromptEndsWithCta(generatedPrompt, COMPLETION_CTA)
  }
}

function buildCompactDeepAnalysisV2UserPrompt(input: DeepAnalysisV2Request) {
  const checklistItems = extractRequirementLevelChecklist(input.promptText).map((item) => ({
    id: item.id,
    text: item.text
  }))
  const compactInput = {
    taskType: input.taskType,
    surface: input.surface,
    projectContext: trimForBudget(input.projectContext, 500),
    currentState: trimForBudget(input.currentState, 300),
    userPrompt: trimForBudget(input.promptText, 1200),
    assistantAnswer: trimForBudget(input.responseText, 1800),
    checklistItems
  }

  return trimForBudget(
    JSON.stringify(
      {
        schema: {
          verdict: "success|partial|wrong|unclear",
          score: 0,
          issues: [],
          passed: [],
          missing: [],
          ignored_external_validation: [],
          item_results: [
            {
              id: "",
              text: "",
              classification: "implementation_requirement|app_acceptance_criteria|external_validation",
              status: "pass|missing|unclear|ignored",
              reason: ""
            }
          ],
          phase_completion_claimed: false,
          classification_audit: [],
          prompt_intent:
            "implement_next_step|ask_for_next_step|confirm_missing_requirements|review_before_advancing",
          assistant_suggested_next_move: "",
          next_step_requirements: [],
          blocked_scope: []
        },
        response_contract: [
          "Return exactly two tagged sections:",
          "<decision_json>{...schema above...}</decision_json>",
          "<next_prompt>Full next prompt as normal plain text, not JSON-escaped.</next_prompt>"
        ],
        rules: [
          "success = prompt requirements are confirmed by the answer.",
          "partial = missing/unclear confirmation.",
          "wrong = answer violates current scope or heads wrong way.",
          "unclear = a core requirement is omitted, contradicted, or explicitly incomplete.",
          "If the user said do not suggest a next step/phase and the answer does not suggest one, that requirement passed.",
          "Trust explicit completion claims as evidence: completed, implemented, passed, validated, verified, evidence, or closed out.",
          "For checklist rows, put a row in passed when the answer clearly claims that exact capability, deliverable, or acceptance criterion is done.",
          "Do not require screenshots, files, code references, browser proof, or real-user proof unless the prompt explicitly makes that proof mandatory before continuing.",
          "If the answer says external/manual/user testing remains but implementation requirements are complete, do not fail implementation rows only because external proof is pending.",
          "Use missing only when the row is omitted, contradicted, denied, or admitted incomplete.",
          "If forbidden work appears only as a future suggestion, do not mark current work wrong; block it in next_prompt.",
          "Only mark scope drift when forbidden work was claimed as already implemented or added.",
          "If current phase passes but suggested next step is too broad, next_prompt should narrow to the safest next step.",
          "If current work passes and phase-by-phase instructions exist, find the next phase in userPrompt/projectContext and generate next_prompt from that phase only.",
          "If userPrompt has REQUIREMENT-LEVEL CHECKLIST, put confirmed checklist rows in passed and missing/unclear rows in missing.",
          "If a checklist row depends on real users, customers, stakeholders, production data, interviews, surveys, business metrics, live experiments, or approvals, put it in ignored_external_validation instead of missing.",
          "Do not treat app behavior with timing, devices, or multiple users as external validation. Example: 'Two users see updates within 2 seconds' is app_acceptance_criteria, not external_validation.",
          "External examples: '5 customer interviews', 'A/B test shows lift', 'chef approves suggestions', 'app store rating', 'beta cohort retention', 'screen recording across two phones'.",
          "If only ignored_external_validation rows are unresolved, use verdict success and generate the next phase prompt.",
          "Set phase_completion_claimed true only when the assistant explicitly claims the current phase is complete/done/closed out/ready for next phase.",
          "If phase_completion_claimed is true and only actionable rows are missing/unclear, do not trap the user in the same phase: generate the next phase prompt and add a short carryover section listing only those missing/unclear rows.",
          "classification_audit should mention ignored external rows and confirm app behavior/timing rows were not ignored.",
          "When input.checklistItems is non-empty, return item_results with exactly one item per input.checklistItems row using the same id and text.",
          "Do not omit item_results for checklist items; if unsure, classify the row and use status unclear.",
          "Do not replace checklist rows with a generic item like 'match the submitted prompt requirements'.",
          "Do not use ask_for_next_step when the next phase is already present in userPrompt/projectContext.",
          "assistant_suggested_next_move should name the next phase/step when the answer says ready to start it.",
          "Do not put approved next-phase data/state or storage in blocked_scope.",
          "When current work passes and the next step is broad, make next_prompt concrete, small, and before irreversible infrastructure work.",
          "Write the full next prompt only inside the <next_prompt> section, not inside decision_json.",
          `The <next_prompt> section must end with: ${COMPLETION_CTA}`,
          "prompt_intent must match the safest next user action.",
          "next_step_requirements must list concrete work only when prompt_intent is implement_next_step.",
          "blocked_scope must list work the generated prompt should avoid for now."
        ],
        input: compactInput
      },
      null,
      0
    ),
    4200
  )
}

function buildMissingInputRecoveryDeepAnalysisV2UserPrompt(input: DeepAnalysisV2Request) {
  const checklistItems = extractRequirementLevelChecklist(input.promptText).map((item) => ({
    id: item.id,
    text: item.text
  }))
  const compactInput = {
    taskType: input.taskType,
    surface: input.surface,
    userPrompt: trimForBudget(input.promptText, 1600),
    assistantAnswer: trimForBudget(input.responseText, 2200),
    checklistItems
  }

  return trimForBudget(
    JSON.stringify(
      {
        recovery_mode: "missing_input_contradiction",
        critical_instruction: [
          "The submitted userPrompt and assistantAnswer below are present and non-empty.",
          "Do not claim that the prompt, answer, content, checklist, or inputs are missing.",
          "Compare userPrompt against assistantAnswer directly.",
          "If checklistItems is empty, infer requirements from userPrompt instead of asking for input.checklistItems."
        ],
        schema: {
          verdict: "success|partial|wrong|unclear",
          score: 0,
          issues: [],
          passed: [],
          missing: [],
          ignored_external_validation: [],
          item_results: [
            {
              id: "",
              text: "",
              classification: "implementation_requirement|app_acceptance_criteria|external_validation",
              status: "pass|missing|unclear|ignored",
              reason: ""
            }
          ],
          phase_completion_claimed: false,
          classification_audit: [],
          prompt_intent:
            "implement_next_step|ask_for_next_step|confirm_missing_requirements|review_before_advancing",
          assistant_suggested_next_move: "",
          next_step_requirements: [],
          blocked_scope: []
        },
        response_contract: [
          "Return exactly two tagged sections:",
          "<decision_json>{...schema above...}</decision_json>",
          "<next_prompt>Full next prompt as normal plain text, not JSON-escaped.</next_prompt>"
        ],
        rules: [
          "Evaluate only whether assistantAnswer satisfies userPrompt.",
          "Use success when the answer confirms the requested work and stays in scope.",
          "Use partial when important requested details are missing or unclear.",
          "Use wrong when the answer implements or recommends forbidden scope as completed work.",
          "Use unclear only when the answer itself is too vague to judge.",
          "When checklistItems is non-empty, return item_results with exactly one row per checklist item.",
          "When checklistItems is empty, leave item_results empty and use passed/missing lists inferred from userPrompt.",
          "Do not ask the user to provide the original prompt or assistant answer.",
          "Do not mention schema/rules JSON as missing input.",
          "Generate a useful next_prompt based on the verdict.",
          `The <next_prompt> section must end with: ${COMPLETION_CTA}`
        ],
        input: compactInput
      },
      null,
      0
    ),
    4200
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

type DeepAnalysisV2ProviderName = "deepseek" | "kimi"

type CompactDeepAnalysisVerdict = "success" | "partial" | "wrong" | "unclear"

type CompactDeepAnalysisResult = {
  verdict: CompactDeepAnalysisVerdict
  score: number
  issues: string[]
  passed: string[]
  missing: string[]
  ignored_external_validation: string[]
  item_results: CompactDeepAnalysisItemResult[]
  phase_completion_claimed: boolean
  classification_audit: string[]
  prompt_intent: DeepAnalysisV2Result["promptIntent"]
  assistant_suggested_next_move: string
  next_step_requirements: string[]
  blocked_scope: string[]
  next_prompt: string
}

type CompactDeepAnalysisItemResult = {
  id: string
  text: string
  classification: "implementation_requirement" | "app_acceptance_criteria" | "external_validation"
  status: "pass" | "missing" | "unclear" | "ignored"
  reason: string
}

function normalizeCompactVerdict(value: unknown): CompactDeepAnalysisVerdict | null {
  if (typeof value !== "string") return null
  const normalized = normalizeLower(value).replace(/[\s-]+/g, "_")
  if (["success", "pass", "passed", "complete", "completed", "ready", "ready_for_next_phase"].includes(normalized)) {
    return "success"
  }
  if (["partial", "needs_confirmation", "needs_confirm", "incomplete", "missing", "needs_work"].includes(normalized)) {
    return "partial"
  }
  if (["wrong", "fail", "failed", "failure", "risky", "blocked", "wrong_direction"].includes(normalized)) {
    return "wrong"
  }
  if (["unclear", "unknown", "unverified", "not_sure", "needs_review"].includes(normalized)) {
    return "unclear"
  }
  return null
}

type ProviderAttemptResult =
  | {
      status: "success"
      provider: DeepAnalysisV2ProviderName
      model: string
      latencyMs: number
      attemptCount: number
      retried: boolean
      jsonValid: true
      rawOutput: string
      outputTokenEstimate: number
      result: DeepAnalysisV2Result
    }
  | {
      status: "failed"
      provider: DeepAnalysisV2ProviderName
      model: string
      latencyMs: number
      attemptCount: number
      retried: boolean
      jsonValid: false
      timedOut: boolean
      reason: DeepAnalysisV2FallbackReason | DeepAnalysisV2DeepSeekFailureReason
      message: string
      outputTokenEstimate?: number
    }

function parseJsonWithOneRepair(raw: string): unknown {
  const cleaned = raw.trim().replace(/```(?:json)?|```/g, "").trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf("{")
    const end = cleaned.lastIndexOf("}")
    if (start === -1 || end <= start) throw new SyntaxError("Provider output did not contain a JSON object.")
    return JSON.parse(cleaned.slice(start, end + 1))
  }
}

function extractTaggedSection(raw: string, tag: "decision_json" | "next_prompt") {
  const pattern = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, "i")
  const match = raw.match(pattern)
  return match?.[1]?.trim() ?? ""
}

function extractTaggedProviderOutput(raw: string) {
  const decisionJson = extractTaggedSection(raw, "decision_json")
  const nextPrompt = extractTaggedSection(raw, "next_prompt")
  return {
    decisionJson: decisionJson || raw,
    nextPrompt: nextPrompt || ""
  }
}

function toStringArray(value: unknown, max = 8) {
  if (!Array.isArray(value)) return null
  const items = value.map((item) => (typeof item === "string" ? normalize(item) : "")).filter(Boolean)
  return items.slice(0, max)
}

function toItemResults(value: unknown, max = 12): CompactDeepAnalysisItemResult[] {
  if (!Array.isArray(value)) return []
  const output: CompactDeepAnalysisItemResult[] = []
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const id = typeof record.id === "string" ? normalize(record.id) : ""
    const text = typeof record.text === "string" ? normalize(record.text) : ""
    const classification = record.classification
    const status = record.status
    const reason = typeof record.reason === "string" ? normalize(record.reason) : ""
    if (!id || !text) continue
    if (
      classification !== "implementation_requirement" &&
      classification !== "app_acceptance_criteria" &&
      classification !== "external_validation"
    ) continue
    if (status !== "pass" && status !== "missing" && status !== "unclear" && status !== "ignored") continue
    output.push({ id, text, classification, status, reason })
    if (output.length >= max) break
  }
  return output
}

function parseCompactProviderResult(raw: string): CompactDeepAnalysisResult {
  const tagged = extractTaggedProviderOutput(raw)
  const parsed = parseJsonWithOneRepair(tagged.decisionJson)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("Provider output was not a JSON object.")
  }
  const record = parsed as Record<string, unknown>
  const verdict = record.verdict
  const score = record.score
  const issues = toStringArray(record.issues, 6) ?? []
  const passed = toStringArray(record.passed, 8) ?? []
  const missing = toStringArray(record.missing, 6) ?? []
  const ignoredExternalValidation = toStringArray(record.ignored_external_validation, 8) ?? []
  const itemResults = toItemResults(record.item_results, 12)
  const phaseCompletionClaimed = record.phase_completion_claimed === true
  const classificationAudit = toStringArray(record.classification_audit, 8) ?? []
  const promptIntent = record.prompt_intent
  const assistantSuggestedNextMove =
    typeof record.assistant_suggested_next_move === "string" ? normalize(record.assistant_suggested_next_move) : ""
  const nextStepRequirements = toStringArray(record.next_step_requirements, 8)
  const blockedScope = toStringArray(record.blocked_scope, 8)
  const nextPromptFromJson = typeof record.next_prompt === "string" ? record.next_prompt.trim() : ""
  const nextPrompt = tagged.nextPrompt || nextPromptFromJson
  const normalizedVerdict = normalizeCompactVerdict(verdict)
  const normalizedScore =
    typeof score === "number" && Number.isFinite(score)
      ? score
      : normalizedVerdict === "success"
        ? 0.82
        : normalizedVerdict === "partial"
          ? 0.58
          : normalizedVerdict === "wrong"
            ? 0.28
            : 0.38
  const normalizedPromptIntent =
    promptIntent === "implement_next_step" ||
    promptIntent === "ask_for_next_step" ||
    promptIntent === "confirm_missing_requirements" ||
    promptIntent === "review_before_advancing"
      ? promptIntent
      : promptIntentForCompact({
          status: statusForCompactVerdict(normalizedVerdict ?? "unclear"),
          nextPrompt
        })

  if (!normalizedVerdict) {
    throw new SyntaxError("Provider verdict did not match the compact schema.")
  }

  return {
    verdict: normalizedVerdict,
    score: normalizedScore,
    issues,
    passed,
    missing,
    ignored_external_validation: ignoredExternalValidation,
    item_results: itemResults,
    phase_completion_claimed: phaseCompletionClaimed,
    classification_audit: classificationAudit,
    prompt_intent: normalizedPromptIntent,
    assistant_suggested_next_move: assistantSuggestedNextMove,
    next_step_requirements: nextStepRequirements ?? [],
    blocked_scope: blockedScope ?? [],
    next_prompt: nextPrompt
  }
}

function compactScoreToConfidence(score: number): DeepAnalysisV2Result["confidence"] {
  const normalizedScore = score > 1 ? score / 100 : score
  if (normalizedScore >= 0.78) return "high"
  if (normalizedScore >= 0.45) return "medium"
  return "low"
}

function responseLooksLikeNoCodeCompletionSummary(input: DeepAnalysisV2Request) {
  return (
    /\bdo not include code\b/i.test(input.promptText) &&
    /\b(?:built|created|implemented|added)\b/i.test(input.responseText) &&
    /\b(?:phase\s+\d+\s+)?(?:is\s+)?complete\b/i.test(input.responseText)
  )
}

function compactLooksLikeFalseCodeDoubt(compact: CompactDeepAnalysisResult) {
  const text = normalizeLower([
    ...compact.issues,
    ...compact.missing,
    compact.next_prompt
  ].join(" "))
  return /\b(?:actually built code|code was produced|no code was produced|would be built|summary of what would be built)\b/.test(text)
}

function statusForCompactVerdict(verdict: CompactDeepAnalysisVerdict): DeepAnalysisV2Result["overallStatus"] {
  switch (verdict) {
    case "success":
      return "pass"
    case "wrong":
      return "fail"
    case "unclear":
      return "risky"
    default:
      return "needs_confirmation"
  }
}

function promptIntentForCompact(input: {
  status: DeepAnalysisV2Result["overallStatus"]
  nextPrompt: string
}): DeepAnalysisV2Result["promptIntent"] {
  if (input.status === "pass") return input.nextPrompt ? "implement_next_step" : "ask_for_next_step"
  if (input.status === "risky") return "review_before_advancing"
  return "confirm_missing_requirements"
}

function promptLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

function nextStepRequirementsFromPrompt(value: string) {
  return promptLines(value)
    .filter((line) => /^[-*]\s+\S/.test(line))
    .map((line) => normalize(line.replace(/^[-*]\s+/, "")))
    .filter((line) => line && !/^do not\b/i.test(line) && line !== COMPLETION_CTA)
    .slice(0, 8)
}

function blockedScopeFromPrompt(value: string) {
  return promptLines(value)
    .filter((line) => /^do not\b/i.test(line))
    .map((line) => normalize(line.replace(/[.。]+$/, "")))
    .slice(0, 8)
}

function extractRequirementLevelChecklist(promptText: string): DeepAnalysisV2Requirement[] {
  const marker = "REQUIREMENT-LEVEL CHECKLIST"
  const markerIndex = promptText.indexOf(marker)
  if (markerIndex === -1) return []

  const afterMarker = promptText.slice(markerIndex + marker.length)
  const section = afterMarker.split(/\n(?:NEXT PHASE REQUIREMENTS|Decision rules:)/i)[0] ?? ""
  const items = promptLines(section)
    .filter((line) => /^[-*]\s+\S/.test(line))
    .map((line) => normalize(line.replace(/^[-*]\s+/, "")))
    .filter(Boolean)
    .slice(0, 10)

  return uniqueRequirements(
    items.map((text, index) => ({
      id: `project_tracker_check_${index + 1}`,
      text,
      source: "project_memory" as const
    }))
  )
}

function listContainsRequirement(list: string[], requirementText: string) {
  const requirement = normalizeLower(requirementText)
  return list.some((item) => {
    const normalized = normalizeLower(item)
    return normalized === requirement || normalized.includes(requirement) || requirement.includes(normalized)
  })
}

function isLikelyExternalValidationRequirement(value: string) {
  const text = normalizeLower(value)
  if (!text) return false
  return /\b(a\/b|ab test|cohort|interviews?|surveys?|customer tests?|user tests?|student tests?|student testers?|test users?|shadow sessions?|screen recordings?|app store|ratings?|dau|mau|retention|conversion|lift|approvals?|approves|approved|chef approves|stakeholders?|production data|business metrics?|pilots?|beta)\b/.test(text)
}

function sanitizeCompactIssues(issues: string[], request: DeepAnalysisV2Request) {
  const hasComparisonInput = Boolean(normalize(request.promptText) && normalize(request.responseText))
  return issues
    .map(normalize)
    .filter(Boolean)
    .filter((issue) => {
      if (!hasComparisonInput) return true
      return !/\bno user prompt or assistant answer provided\b/i.test(issue)
    })
    .slice(0, 6)
}

function validateCompactChecklistItemResults(compact: CompactDeepAnalysisResult, request: DeepAnalysisV2Request) {
  const checklist = extractRequirementLevelChecklist(request.promptText)
  if (!checklist.length) return
  if (compact.item_results.length < checklist.length) {
    throw new SyntaxError("Provider omitted required item_results for the checklist.")
  }
  for (const item of checklist) {
    const matched = compact.item_results.find(
      (result) => result.id === item.id || normalizeLower(result.text) === normalizeLower(item.text)
    )
    if (!matched) {
      throw new SyntaxError(`Provider omitted item_result for checklist item: ${item.id}.`)
    }
    if (matched.classification === "external_validation" && matched.status !== "ignored") {
      throw new SyntaxError(`Provider external_validation item_result must use ignored status: ${item.id}.`)
    }
    if (matched.classification === "external_validation" && !isLikelyExternalValidationRequirement(item.text)) {
      throw new SyntaxError(`Provider classified an actionable checklist item as external_validation: ${item.id}.`)
    }
  }
}

function isChecklistItemResultsValidationError(error: unknown) {
  return error instanceof Error && /\bitem_results\b|checklist item|external_validation/i.test(error.message)
}

function canSalvageCompactWithoutItemResults(compact: CompactDeepAnalysisResult) {
  return Boolean(
    compact.verdict &&
      (
        compact.next_prompt ||
        compact.next_step_requirements.length ||
        compact.assistant_suggested_next_move ||
        compact.issues.length ||
        compact.passed.length ||
        compact.missing.length
      )
  )
}

function buildItemResultsRepairPrompt(input: {
  request: DeepAnalysisV2Request
  originalJson: string
}) {
  const checklistItems = extractRequirementLevelChecklist(input.request.promptText).map((item) => ({
    id: item.id,
    text: item.text
  }))

  return trimForBudget(
    JSON.stringify({
      instruction:
        "Repair this Deep Analysis JSON. Return the full corrected JSON only. Add item_results with exactly one object for each checklist item. Keep existing verdict, passed, missing, ignored_external_validation, prompt intent, and next_prompt unless item_results requires moving external validation out of missing.",
      item_result_schema: {
        id: "same id as checklist item",
        text: "same text as checklist item",
        classification: "implementation_requirement|app_acceptance_criteria|external_validation",
        status: "pass|missing|unclear|ignored",
        reason: "short reason"
      },
      phase_completion_claimed_rule:
        "Set phase_completion_claimed true only if the assistant explicitly claims the current phase is complete, completed, closed out, done, or ready for the next phase.",
      classification_audit_rule:
        "Return classification_audit with short explanations for ignored external rows and any app behavior/timing rows that remain actionable.",
      external_validation_rule:
        "Rows that depend on real users, customers, stakeholders, production data, interviews, surveys, business metrics, live experiments, or approvals must be classification external_validation, status ignored, included in ignored_external_validation, and excluded from missing. If you classified a row as external, explain why it is not app behavior. If it is app behavior, reclassify it. Do not classify app behavior with timing, devices, or multiple users as external validation. Example: 'Two users see updates within 2 seconds' is app_acceptance_criteria.",
      checklist_items: checklistItems,
      assistant_answer: trimForBudget(input.request.responseText, 1200),
      original_json: trimForBudget(input.originalJson, 2500)
    }),
    5200
  )
}

function buildCompactJsonRepairPrompt(input: {
  request: DeepAnalysisV2Request
  originalJson: string
  errorMessage: string
}) {
  return trimForBudget(
    JSON.stringify({
      instruction:
        "Repair this Deep Analysis v2 provider output. Return exactly two tagged sections: <decision_json>{...}</decision_json><next_prompt>...</next_prompt>. Preserve the provider's intended judgment and next prompt where possible.",
      error: input.errorMessage,
      required_schema: {
        verdict: "success|partial|wrong|unclear",
        score: 0,
        issues: [],
        passed: [],
        missing: [],
        ignored_external_validation: [],
        item_results: [
          {
            id: "same id as checklist item",
            text: "same text as checklist item",
            classification: "implementation_requirement|app_acceptance_criteria|external_validation",
            status: "pass|missing|unclear|ignored",
            reason: "short reason"
          }
        ],
        phase_completion_claimed: false,
        classification_audit: [],
        prompt_intent: "implement_next_step|ask_for_next_step|confirm_missing_requirements|review_before_advancing",
        assistant_suggested_next_move: "",
        next_step_requirements: [],
        blocked_scope: [],
      },
      rules: [
        "Use item_results with exactly one object for each checklist item when checklist_items is non-empty.",
        "External validation rows must use classification external_validation, status ignored, appear in ignored_external_validation, and not block advancement.",
        "Do not classify app behavior/timing/device rows as external validation.",
        "If the assistant explicitly claims the current phase is complete, set phase_completion_claimed true.",
        `The <next_prompt> section must be non-empty and must end with: ${COMPLETION_CTA}`
      ],
      checklist_items: extractRequirementLevelChecklist(input.request.promptText).map((item) => ({
        id: item.id,
        text: item.text
      })),
      assistant_answer: trimForBudget(input.request.responseText, 1200),
      original_output: trimForBudget(input.originalJson, 2600)
    }),
    5600
  )
}

const REQUIREMENT_CONFIRMATION_STOP_WORDS = new Set([
  "acceptance",
  "build",
  "complete",
  "completed",
  "criteria",
  "current",
  "deliverable",
  "deliverables",
  "expected",
  "phase",
  "proof",
  "requirement",
  "requirements",
  "scope",
  "status",
  "validation",
  "with"
])

function requirementKeywords(value: string) {
  return normalizeLower(value)
    .replace(/^(?:build scope|deliverables?|acceptance criteria|validation proof expected|validation proof|goal|data\/state needed)\s*:\s*/i, "")
    .split(/[^a-z0-9]+/g)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !REQUIREMENT_CONFIRMATION_STOP_WORDS.has(word))
    .slice(0, 8)
}

function answerContradictsRequirement(responseText: string, requirementText: string) {
  const answer = normalizeLower(responseText)
  const keywords = requirementKeywords(requirementText)
  if (!keywords.length) return false
  const negativePattern = /\b(?:not implemented|not built|not done|incomplete|still missing|still incomplete|failed|not working|still needed|requires external|requires actual|cannot be confirmed)\b/i
  for (const keyword of keywords) {
    const index = answer.indexOf(keyword)
    if (index === -1) continue
    const window = answer.slice(Math.max(0, index - 180), index + 260)
    if (negativePattern.test(window)) return true
  }
  return false
}

function answerConfirmsRequirement(responseText: string, requirementText: string) {
  if (answerContradictsRequirement(responseText, requirementText)) return false
  const answer = normalizeLower(responseText)
  const keywords = requirementKeywords(requirementText)
  if (!keywords.length) return false
  const hitCount = keywords.filter((keyword) => answer.includes(keyword)).length
  const neededHits = Math.min(2, keywords.length)
  if (hitCount < neededHits) return false

  const completionPattern =
    /\b(?:complete|completed|implemented|added|built|done|passed|validated|verified|evidence|evidenced|closed out|functional|works|working)\b/i
  if (answerClaimsTaskCompletion(responseText) && hitCount >= neededHits) return true
  return keywords.some((keyword) => {
    const index = answer.indexOf(keyword)
    if (index === -1) return false
    const window = answer.slice(Math.max(0, index - 180), index + 320)
    return completionPattern.test(window)
  })
}

function isLargeInputCheckpointPromptText(promptText: string) {
  return (
    /\b(?:before we move to the next phase|complete the phase checkpoint)\b/i.test(promptText) &&
    /\bcurrent phase\b/i.test(promptText) &&
    /\boriginal PRD\b/i.test(promptText) &&
    /\bvalidation proof\b/i.test(promptText) &&
    /\bnext step details\b/i.test(promptText) &&
    /\bdo not implement\b/i.test(promptText)
  )
}

function extractCheckpointPromptLine(promptText: string, label: "Current phase" | "Next unstarted phase from the PRD") {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = promptText.match(new RegExp(`^-\\s*${escaped}:\\s*(.+)$`, "im"))
  return normalize(match?.[1] ?? "")
}

function buildLargeInputCheckpointRepairPrompt(input: {
  promptText: string
  missingItems: string[]
  issue?: string
}) {
  const currentPhase = extractCheckpointPromptLine(input.promptText, "Current phase")
  const nextPhase = extractCheckpointPromptLine(input.promptText, "Next unstarted phase from the PRD")
  const missingItems = input.missingItems.map(normalize).filter(Boolean).slice(0, 8)
  const issue = normalize(input.issue ?? "")

  return [
    "Complete the phase checkpoint without implementing anything new.",
    "",
    currentPhase ? `Current phase: ${currentPhase}` : "",
    nextPhase ? `Next PRD phase: ${nextPhase}` : "",
    "",
    missingItems.length || issue ? "Pay special attention to these missing or unclear items:" : "",
    ...missingItems.map((item) => `- ${item}`),
    issue && !missingItems.some((item) => normalizeLower(item) === normalizeLower(issue)) ? `- ${issue}` : "",
    "",
    "For the current phase, answer:",
    "",
    "1. Completed requirements",
    "- List each requirement completed",
    "- Include concrete evidence for each",
    "",
    "2. Missing or incomplete requirements",
    "- List every missing or incomplete current-phase item",
    "- Explain exactly what remains",
    "",
    "3. Out-of-scope confirmation",
    "- Confirm you did not start later phases or forbidden scope",
    "",
    "4. Validation proof",
    "- Provide screenshots, preview URL, test output, or relevant code for each acceptance criterion",
    "- If proof is missing, say exactly what proof is still needed",
    "",
    "5. Next step details",
    nextPhase
      ? `- If the current phase is complete, provide the full detailed requirements for ${nextPhase}`
      : "- If the current phase is complete, provide the full detailed requirements for the next step or say there is no later PRD phase",
    "- If the current phase is incomplete, first finish the current phase and still restate the next-phase requirements for later",
    "- Include phase name, goal, build scope, out of scope, data/state needed, deliverables, acceptance criteria, and validation proof expected",
    "",
    "Do not implement the next phase yet.",
    "Wait for my confirmation."
  ]
    .filter((line, index, lines) => line || lines[index - 1])
    .join("\n")
    .trim()
}

function compactResultToDeepAnalysis(input: {
  compact: CompactDeepAnalysisResult
  request: DeepAnalysisV2Request
  provider: DeepAnalysisV2ProviderName
  model: string
  latencyMs: number
}): DeepAnalysisV2Result {
  const identity = buildAnalysisIdentity(input.request)
  const compactIssues = sanitizeCompactIssues(input.compact.issues, input.request)
  const responseHasVerificationBlocker = answerHasVerificationBlocker(input.request.responseText)
  const phaseCompletionClaimed = input.compact.phase_completion_claimed || answerClaimsTaskCompletion(input.request.responseText)
  const hasFalseCodeDoubt =
    responseLooksLikeNoCodeCompletionSummary(input.request) && compactLooksLikeFalseCodeDoubt(input.compact)
  let status = responseHasVerificationBlocker
    ? "risky"
    : hasFalseCodeDoubt
      ? "pass"
      : statusForCompactVerdict(input.compact.verdict)
  const assistantSuggestedNextMove =
    input.compact.assistant_suggested_next_move ||
    extractAssistantSuggestedNextMove(input.request.responseText)
  const isCheckpointPrompt = isLargeInputCheckpointPromptText(input.request.promptText)
  const missingItems = input.compact.missing.length ? input.compact.missing : status === "pass" ? [] : compactIssues
  const checkpointRepairPrompt =
    status === "pass" || !isCheckpointPrompt
      ? ""
      : buildLargeInputCheckpointRepairPrompt({
          promptText: input.request.promptText,
          missingItems,
          issue: compactIssues[0]
        })
  const generatedPrompt = checkpointRepairPrompt || input.compact.next_prompt.trim()
  const checklistRequirements = extractRequirementLevelChecklist(input.request.promptText)
  const itemResultIgnoredExternalValidation = input.compact.item_results
    .filter((item) => item.classification === "external_validation")
    .map((item) => item.text)
  const inferredExternalValidation = uniqueStrings([
    ...input.compact.missing,
    ...checklistRequirements.map((requirement) => requirement.text)
  ].filter(isLikelyExternalValidationRequirement), 8)
  const ignoredExternalValidation = uniqueStrings([
    ...input.compact.ignored_external_validation,
    ...itemResultIgnoredExternalValidation,
    ...inferredExternalValidation
  ], 8)
  const compactActionableMissingItems = input.compact.missing.filter((item) => !listContainsRequirement(ignoredExternalValidation, item))
  const actionableChecklistRequirements = checklistRequirements.filter(
    (requirement) => !listContainsRequirement(ignoredExternalValidation, requirement.text)
  )
  const actionableMissingFallbackItems = missingItems.filter((item) => !listContainsRequirement(ignoredExternalValidation, item))
  const nextMovePromptRequirements = extractNextMoveV2PromptRequirements(input.request.promptText)
  const requirements = checklistRequirements.length
    ? actionableChecklistRequirements
    : nextMovePromptRequirements.length
      ? nextMovePromptRequirements
    : actionableMissingFallbackItems.length
      ? actionableMissingFallbackItems.map((item, index) => ({
          id: slugify(item) || `missing_${index + 1}`,
          text: item,
          source: "submitted_prompt" as const
        }))
      : [
          {
            id: "submitted_prompt_requirements",
            text: "Match the submitted prompt requirements.",
            source: "submitted_prompt" as const
          }
        ]
  const requirementMatches: DeepAnalysisV2RequirementMatch[] = checklistRequirements.length
    ? requirements.map((requirement) => {
        const itemResult = input.compact.item_results.find(
          (item) => item.id === requirement.id || normalizeLower(item.text) === normalizeLower(requirement.text)
        )
        if (itemResult && itemResult.classification !== "external_validation") {
          const answerConfirmed = answerConfirmsRequirement(input.request.responseText, requirement.text)
          const resultStatus = itemResult.status === "ignored" ? "unclear" : itemResult.status
          const upgradedStatus = answerConfirmed ? "pass" : resultStatus
          return {
            requirementId: requirement.id,
            requirementText: requirement.text,
            status: upgradedStatus,
            evidence:
              upgradedStatus === "pass"
                ? [answerConfirmed ? "Assistant answer explicitly confirmed this current-phase checklist item." : "LLM analysis confirmed this current-phase checklist item."]
                : [],
            note: upgradedStatus === "pass" ? "" : itemResult.reason || compactIssues[0] || ""
          }
        }
        const isMissing = listContainsRequirement(input.compact.missing, requirement.text)
        const answerConfirmed = answerConfirmsRequirement(input.request.responseText, requirement.text)
        const isPassed = status === "pass" || listContainsRequirement(input.compact.passed, requirement.text) || answerConfirmed
        return {
          requirementId: requirement.id,
          requirementText: requirement.text,
          status: isMissing && !answerConfirmed ? "missing" : isPassed ? "pass" : "unclear",
          evidence:
            isPassed && (!isMissing || answerConfirmed)
              ? [answerConfirmed ? "Assistant answer explicitly confirmed this current-phase checklist item." : "LLM analysis confirmed this current-phase checklist item."]
              : [],
          note: (isMissing && !answerConfirmed) || !isPassed ? compactIssues[0] ?? "" : ""
        }
      })
    : requirements.map((requirement) => ({
        requirementId: requirement.id,
        requirementText: requirement.text,
        status: status === "pass" ? "pass" : input.compact.missing.includes(requirement.text) ? "missing" : "unclear",
        evidence: status === "pass" ? ["LLM analysis found the answer aligned with the submitted prompt."] : [],
        note: compactIssues[0] ?? ""
      }))
  const checklistConfirmedByAnswer =
    checklistRequirements.length > 0 &&
    requirementMatches.length > 0 &&
    requirementMatches.every((match) => match.status === "pass")
  const unresolvedRequirementTexts = requirementMatches
    .filter((match) => match.status !== "pass")
    .map((match) => match.requirementText)
  const actionableMissingItems = checklistRequirements.length
    ? uniqueStrings(unresolvedRequirementTexts, 8)
    : compactActionableMissingItems
  if (checklistConfirmedByAnswer && status !== "fail" && !responseHasVerificationBlocker) {
    status = "pass"
  }
  if (
    checklistRequirements.length > 0 &&
    unresolvedRequirementTexts.length === 0 &&
    requirementMatches.length > 0 &&
    requirementMatches.every((match) => match.status === "pass") &&
    status !== "fail" &&
    !responseHasVerificationBlocker
  ) {
    status = "pass"
  }
  const hasActionableCarryover =
    phaseCompletionClaimed &&
    status !== "fail" &&
    !responseHasVerificationBlocker &&
    (actionableMissingItems.length > 0 || requirementMatches.some((match) => match.status !== "pass"))
  if (hasActionableCarryover) {
    status = "pass"
  }
  const promptIntent = responseHasVerificationBlocker
    ? "review_before_advancing"
    : hasFalseCodeDoubt && assistantSuggestedNextMove
      ? "implement_next_step"
      : hasActionableCarryover
        ? "implement_next_step"
      : status === "pass" && input.compact.prompt_intent === "confirm_missing_requirements"
        ? "implement_next_step"
      : input.compact.prompt_intent
  const repairedPrompt = generatedPrompt ? ensurePromptEndsWithCta(generatedPrompt, COMPLETION_CTA) : ""
  const nextStepRequirements = input.compact.next_step_requirements.length
    ? input.compact.next_step_requirements
    : input.compact.prompt_intent === "implement_next_step"
      ? nextStepRequirementsFromPrompt(repairedPrompt)
      : []
  const blockedScope = sanitizeBlockedScope(mergeBlockedScope(
    input.compact.blocked_scope.length ? input.compact.blocked_scope : blockedScopeFromPrompt(repairedPrompt),
    explicitBlockedScopeFromPrompt(input.request.promptText),
    inferBlockedScopeFromRequest(input.request, assistantSuggestedNextMove)
  ))

  const normalizedResult = normalizeDeepAnalysisV2Consistency({
    version: DEEP_ANALYSIS_V2_VERSION,
    ...identity,
    analysisMode: "standard",
    requirements,
    requirementMatches,
    ignoredExternalValidation,
    actionableMissingItems,
    phaseAdvanceBasis: hasActionableCarryover
      ? "phase_completion_claimed_with_carryover"
      : status === "pass" && ignoredExternalValidation.length
        ? "all_non_external_requirements_passed"
        : status === "pass" && checklistConfirmedByAnswer
          ? "all_checklist_requirements_confirmed"
          : "",
    phaseCompletionClaimed,
    classificationAudit: input.compact.classification_audit,
    overallStatus: status,
    assistantSuggestedNextMove,
    recommendedNextMove:
      compactIssues[0] ??
      (status === "pass" ? "Use the generated next prompt." : "Resolve the missing or unclear requirements before continuing."),
    nextStepSource: assistantSuggestedNextMove ? "assistant_suggestion" : repairedPrompt ? "system_inferred" : "unavailable",
    nextStepRequirements,
    blockedScope,
    promptIntent,
    generatedPrompt: repairedPrompt,
    confidence:
      checklistConfirmedByAnswer && compactScoreToConfidence(input.compact.score) === "low"
        ? "medium"
        : compactScoreToConfidence(input.compact.score),
    userExplanation:
      compactIssues[0] ??
      (status === "pass" ? "The LLM analysis found the answer aligned with the submitted prompt." : "The LLM analysis found missing or unclear items."),
    providerMetadata: {
      provider: input.provider,
      model: input.model,
      latencyMs: input.latencyMs,
      timedOut: false,
      usedFallback: false,
      ...(input.provider === "deepseek" ? { deepSeekAttempted: true, deepSeekLatencyMs: input.latencyMs } : {}),
      ...(input.provider === "kimi" ? { kimiLatencyMs: input.latencyMs } : {})
    }
  })
  return checkpointRepairPrompt
    ? {
        ...normalizedResult,
        generatedPrompt: ensurePromptEndsWithCta(checkpointRepairPrompt, COMPLETION_CTA),
        nextStepRequirements: []
      }
    : normalizedResult
}

function normalizeDeepAnalysisV2Consistency(result: DeepAnalysisV2Result): DeepAnalysisV2Result {
  return repairGeneratedPrompt(result)
}

function buildDeepAnalysisV2Unavailable(input: {
  request: DeepAnalysisV2Request
  latencyMs: number
  timedOut: boolean
  providerAttempted: "deepseek" | "kimi" | "none"
  fallbackReason: DeepAnalysisV2FallbackReason
  failureMessage: string
  kimiLatencyMs?: number
  deepSeekAttempted?: boolean
  deepSeekLatencyMs?: number
  deepSeekFailureReason?: DeepAnalysisV2DeepSeekFailureReason
}): DeepAnalysisV2Result {
  const identity = buildAnalysisIdentity(input.request)
  return {
    version: DEEP_ANALYSIS_V2_VERSION,
    ...identity,
    analysisState: "v2_unavailable",
    analysisMode: "standard",
    requirements: [],
    requirementMatches: [],
    ignoredExternalValidation: [],
    actionableMissingItems: [],
    phaseAdvanceBasis: "",
    phaseCompletionClaimed: false,
    classificationAudit: [],
    overallStatus: "unavailable",
    assistantSuggestedNextMove: null,
    recommendedNextMove:
      "AI analysis is currently unavailable because all providers failed or timed out. No fallback decision was generated. Please retry.",
    nextStepSource: "unavailable",
    nextStepRequirements: [],
    blockedScope: [],
    promptIntent: "review_before_advancing",
    generatedPrompt: ANALYSIS_UNAVAILABLE_PROMPT,
    confidence: "low",
    userExplanation:
      "AI analysis is currently unavailable because all providers failed or timed out. No fallback decision was generated. Please retry.",
    providerMetadata: {
      provider: "none",
      latencyMs: input.latencyMs,
      timedOut: input.timedOut,
      usedFallback: false,
      providerAttempted: input.providerAttempted,
      fallbackReason: input.fallbackReason,
      failureMessage: input.failureMessage,
      kimiLatencyMs: input.kimiLatencyMs,
      deepSeekAttempted: input.deepSeekAttempted,
      deepSeekLatencyMs: input.deepSeekLatencyMs,
      deepSeekFailureReason: input.deepSeekFailureReason
    }
  }
}

function logDeepAnalysisV2ProviderEvent(event: Record<string, unknown>) {
  console.info(JSON.stringify({ scope: "deep-analysis-v2", ...event }))
}

function retryDelayMs(overrideMs?: number) {
  if (typeof overrideMs === "number" && Number.isFinite(overrideMs)) return Math.max(0, Math.floor(overrideMs))
  return Math.floor(
    DEEP_ANALYSIS_V2_RETRY_DELAY_MIN_MS +
      Math.random() * (DEEP_ANALYSIS_V2_RETRY_DELAY_MAX_MS - DEEP_ANALYSIS_V2_RETRY_DELAY_MIN_MS + 1)
  )
}

async function delayWithAbort(ms: number, signal: AbortSignal) {
  if (ms <= 0) return
  if (signal.aborted) throw new Error("Provider retry aborted.")
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeoutId)
      signal.removeEventListener("abort", onAbort)
      reject(new Error("Provider retry aborted."))
    }
    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

async function runSingleProviderAttempt(input: {
  provider: DeepAnalysisV2ProviderName
  model: string
  call: (systemPrompt: string, userPrompt: string, maxTokens: number, signal?: AbortSignal) => Promise<string | null>
  request: DeepAnalysisV2Request
  systemPrompt: string
  userPrompt: string
  timeoutMs: number
  signal: AbortSignal
  latencyMs: () => number
  attemptCount: number
  retried: boolean
}): Promise<ProviderAttemptResult> {
  try {
    const output = await withTimeout(
      input.call(input.systemPrompt, input.userPrompt, DEEP_ANALYSIS_V2_MAX_OUTPUT_TOKENS, input.signal),
      input.timeoutMs,
      `${input.provider} deep analysis v2`
    )
    const latencyMs = input.latencyMs()
    const outputTokenEstimate = estimateTokens(output ?? "")
    if (!output || !output.trim()) {
      return {
        status: "failed",
        provider: input.provider,
        model: input.model,
        latencyMs,
        attemptCount: input.attemptCount,
        retried: input.retried,
        jsonValid: false,
        timedOut: false,
        reason: "empty_response",
        message: `${input.provider} returned an empty response.`,
        outputTokenEstimate
      }
    }

    try {
      let validatedOutput = output
      let validatedCompact: CompactDeepAnalysisResult
      try {
        validatedCompact = parseCompactProviderResult(output)
      } catch (parseError) {
        const remainingTimeoutMs = Math.max(1, input.timeoutMs - input.latencyMs())
        const repairPrompt = buildCompactJsonRepairPrompt({
          request: input.request,
          originalJson: output,
          errorMessage: parseError instanceof Error ? parseError.message : "Provider output did not match the compact schema."
        })
        const repairedOutput = await withTimeout(
          input.call(
            "Repair Deep Analysis v2 output. Return only <decision_json> and <next_prompt> tagged sections. No markdown.",
            repairPrompt,
            DEEP_ANALYSIS_V2_REPAIR_OUTPUT_TOKENS,
            input.signal
          ),
          remainingTimeoutMs,
          `${input.provider} deep analysis v2 compact JSON repair`
        )
        if (!repairedOutput?.trim()) {
          throw parseError
        }
        validatedCompact = parseCompactProviderResult(repairedOutput)
        validatedOutput = repairedOutput
      }
      try {
        validateCompactChecklistItemResults(validatedCompact, input.request)
      } catch (validationError) {
        if (!isChecklistItemResultsValidationError(validationError)) throw validationError
        const compactBeforeItemRepair = validatedCompact
        const outputBeforeItemRepair = validatedOutput
        const remainingTimeoutMs = Math.max(1, input.timeoutMs - input.latencyMs())
        const repairPrompt = buildItemResultsRepairPrompt({
          request: input.request,
          originalJson: output
        })
        try {
          const repairedOutput = await withTimeout(
            input.call(
              "Repair Deep Analysis v2 JSON. Return valid JSON only. No markdown.",
              repairPrompt,
              DEEP_ANALYSIS_V2_REPAIR_OUTPUT_TOKENS,
              input.signal
            ),
            remainingTimeoutMs,
            `${input.provider} deep analysis v2 item_results repair`
          )
          if (!repairedOutput?.trim()) {
            throw new SyntaxError("Provider item_results repair returned an empty response.")
          }
          validatedCompact = parseCompactProviderResult(repairedOutput)
          validateCompactChecklistItemResults(validatedCompact, input.request)
          validatedOutput = repairedOutput
        } catch (itemRepairError) {
          if (!canSalvageCompactWithoutItemResults(compactBeforeItemRepair)) {
            throw itemRepairError
          }
          validatedCompact = compactBeforeItemRepair
          validatedOutput = outputBeforeItemRepair
        }
      }
      const finalLatencyMs = input.latencyMs()
      const result = compactResultToDeepAnalysis({
        compact: validatedCompact,
        request: input.request,
        provider: input.provider,
        model: input.model,
        latencyMs: finalLatencyMs
      })
      const validatedOutputTokenEstimate = estimateTokens(validatedOutput)
      return {
        status: "success",
        provider: input.provider,
        model: input.model,
        latencyMs: finalLatencyMs,
        attemptCount: input.attemptCount,
        retried: input.retried,
        jsonValid: true,
        rawOutput: validatedOutput,
        outputTokenEstimate: validatedOutputTokenEstimate,
        result
      }
    } catch (error) {
      return {
        status: "failed",
        provider: input.provider,
        model: input.model,
        latencyMs: input.latencyMs(),
        attemptCount: input.attemptCount,
        retried: input.retried,
        jsonValid: false,
        timedOut: false,
        reason: "invalid_json",
        message: compactFailureMessage(error),
        outputTokenEstimate
      }
    }
  } catch (error) {
    return {
      status: "failed",
      provider: input.provider,
      model: input.model,
      latencyMs: input.latencyMs(),
      attemptCount: input.attemptCount,
      retried: input.retried,
      jsonValid: false,
      timedOut: error instanceof DeepAnalysisV2TimeoutError,
      reason: classifyProviderFailure(error),
      message: compactFailureMessage(error)
    }
  }
}

async function runProviderAttempt(input: {
  provider: DeepAnalysisV2ProviderName
  model: string
  call: (systemPrompt: string, userPrompt: string, maxTokens: number, signal?: AbortSignal) => Promise<string | null>
  request: DeepAnalysisV2Request
  systemPrompt: string
  userPrompt: string
  promptTokenEstimate: number
  timeoutMs: number
  signal: AbortSignal
  now?: () => number
  retryDelayMs?: number
}): Promise<ProviderAttemptResult> {
  const startedAt = input.now?.() ?? Date.now()
  const elapsed = () => Math.max(0, (input.now?.() ?? Date.now()) - startedAt)
  const remainingBudget = () => Math.max(0, input.timeoutMs - elapsed())
  const firstAttempt = await runSingleProviderAttempt({
    provider: input.provider,
    model: input.model,
    call: input.call,
    request: input.request,
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    timeoutMs: Math.max(1, remainingBudget()),
    signal: input.signal,
    latencyMs: elapsed,
    attemptCount: 1,
    retried: false
  })

  if (firstAttempt.status === "success" || !isRecoverableProviderFailure(firstAttempt)) {
    return firstAttempt
  }

  const delayMs = Math.min(retryDelayMs(input.retryDelayMs), Math.max(0, remainingBudget() - DEEP_ANALYSIS_V2_MIN_RETRY_BUDGET_MS))
  if (remainingBudget() <= DEEP_ANALYSIS_V2_MIN_RETRY_BUDGET_MS || input.signal.aborted) {
    return firstAttempt
  }

  logDeepAnalysisV2ProviderEvent({
    event: "provider_retry_scheduled",
    provider: input.provider,
    reason: firstAttempt.reason,
    latencyMs: firstAttempt.latencyMs,
    retryDelayMs: delayMs,
    remainingBudgetMs: remainingBudget(),
    promptTokenEstimate: input.promptTokenEstimate,
    outputTokenEstimate: firstAttempt.outputTokenEstimate
  })

  try {
    await delayWithAbort(delayMs, input.signal)
  } catch {
    return firstAttempt
  }

  if (remainingBudget() <= 0 || input.signal.aborted) return firstAttempt

  const retryAttempt = await runSingleProviderAttempt({
    provider: input.provider,
    model: input.model,
    call: input.call,
    request: input.request,
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    timeoutMs: Math.max(1, remainingBudget()),
    signal: input.signal,
    latencyMs: elapsed,
    attemptCount: 2,
    retried: true
  })

  return retryAttempt
}

async function firstValidProviderResult(input: {
  attempts: Array<{
    provider: DeepAnalysisV2ProviderName
    controller: AbortController
    promise: Promise<ProviderAttemptResult>
  }>
  promptTokenEstimate: number
}) {
  const pending = input.attempts.map((attempt) => ({
    provider: attempt.provider,
    promise: attempt.promise.then((result) => ({ provider: attempt.provider, result }))
  }))
  const failures: ProviderAttemptResult[] = []

  while (pending.length) {
    const settled = await Promise.race(pending.map((item) => item.promise))
    const index = pending.findIndex((item) => item.provider === settled.provider)
    if (index >= 0) pending.splice(index, 1)

    logDeepAnalysisV2ProviderEvent({
      event: "provider_attempt",
      provider: settled.result.provider,
      latencyMs: settled.result.latencyMs,
      attemptCount: settled.result.attemptCount,
      retried: settled.result.retried,
      success: settled.result.status === "success",
      timedOut: settled.result.status === "failed" ? settled.result.timedOut : false,
      jsonValid: settled.result.jsonValid,
      reason: settled.result.status === "failed" ? settled.result.reason : undefined,
      promptTokenEstimate: input.promptTokenEstimate,
      outputTokenEstimate: settled.result.outputTokenEstimate
    })

    if (settled.result.status === "success") {
      for (const attempt of input.attempts) {
        if (attempt.provider !== settled.result.provider) attempt.controller.abort()
      }
      logDeepAnalysisV2ProviderEvent({
        event: "provider_winner",
        provider: settled.result.provider,
        latencyMs: settled.result.latencyMs,
        attemptCount: settled.result.attemptCount,
        retried: settled.result.retried,
        promptTokenEstimate: input.promptTokenEstimate,
        outputTokenEstimate: settled.result.outputTokenEstimate
      })
      return { winner: settled.result, failures }
    }

    failures.push(settled.result)
  }

  return { winner: null, failures }
}

export async function runDeepAnalysisV2(
  rawInput: DeepAnalysisV2Request,
  options: RunDeepAnalysisV2Options = {}
): Promise<DeepAnalysisV2Result> {
  const input = DeepAnalysisV2RequestSchema.parse(rawInput)
  const start = options.now?.() ?? Date.now()
  const elapsed = () => Math.max(0, (options.now?.() ?? Date.now()) - start)
  const unavailable = (params: Omit<Parameters<typeof buildDeepAnalysisV2Unavailable>[0], "latencyMs" | "request">) =>
    buildDeepAnalysisV2Unavailable({ ...params, request: input, latencyMs: elapsed() })

  if (runtimeFlags.useMocks && !options.callJson && !options.callKimiJson && !options.callDeepSeekJson) {
    return unavailable({
      timedOut: false,
      providerAttempted: "none",
      fallbackReason: env.DEEPSEEK_API_KEY || env.KIMI_API_KEY ? "mocks_enabled" : "missing_key",
      failureMessage: env.DEEPSEEK_API_KEY || env.KIMI_API_KEY
        ? "PROMPT_OPTIMIZER_USE_MOCKS is enabled, so Deep Analysis v2 did not call an LLM."
        : "No DeepSeek or Kimi API key is loaded."
    })
  }

  const userPrompt =
    input.analysisModeHint === "missing_input_recovery"
      ? buildMissingInputRecoveryDeepAnalysisV2UserPrompt(input)
      : buildCompactDeepAnalysisV2UserPrompt(input)
  const promptTokenEstimate = estimateTokens(DEEP_ANALYSIS_V2_SYSTEM_PROMPT, userPrompt)
  const hardTimeoutMs = options.hardTimeoutMs ?? configuredHardTimeoutMs()
  const providerTimeoutMs = Math.min(
    hardTimeoutMs,
    options.deepSeekFastFailureTimeoutMs ?? DEEP_ANALYSIS_V2_DEEPSEEK_FAST_FAILURE_TIMEOUT_MS
  )
  const kimiCall = options.callKimiJson ?? callKimiJson
  const deepSeekCall = options.callJson ?? options.callDeepSeekJson ?? callDeepSeekJson

  const attempts: Array<{
    provider: DeepAnalysisV2ProviderName
    controller: AbortController
    promise: Promise<ProviderAttemptResult>
  }> = []

  const addAttempt = (
    provider: DeepAnalysisV2ProviderName,
    model: string,
    call: (systemPrompt: string, userPrompt: string, maxTokens: number, signal?: AbortSignal) => Promise<string | null>
  ) => {
    const controller = new AbortController()
    attempts.push({
      provider,
      controller,
      promise: runProviderAttempt({
        provider,
        model,
        call,
        request: input,
        systemPrompt: DEEP_ANALYSIS_V2_SYSTEM_PROMPT,
        userPrompt,
        promptTokenEstimate,
        timeoutMs: providerTimeoutMs,
        signal: controller.signal,
        now: options.now,
        retryDelayMs: options.retryDelayMs
      })
    })
  }

  if (options.callJson || options.callDeepSeekJson || env.DEEPSEEK_API_KEY) {
    addAttempt("deepseek", env.DEEPSEEK_MODEL, deepSeekCall)
  }
  if (!options.callJson && (options.callKimiJson || env.KIMI_API_KEY)) {
    addAttempt("kimi", env.KIMI_MODEL, kimiCall)
  }

  if (!attempts.length) {
    return unavailable({
      timedOut: false,
      providerAttempted: "none",
      fallbackReason: "missing_key",
      failureMessage: "No DeepSeek or Kimi API key is loaded."
    })
  }

  let raceResult: Awaited<ReturnType<typeof firstValidProviderResult>>
  try {
    raceResult = await withTimeout(
      firstValidProviderResult({ attempts, promptTokenEstimate }),
      hardTimeoutMs,
      "Deep Analysis v2 provider race"
    )
  } catch (error) {
    for (const attempt of attempts) attempt.controller.abort()
    const message = compactFailureMessage(error)
    logDeepAnalysisV2ProviderEvent({
      event: "provider_race_timeout",
      latencyMs: elapsed(),
      promptTokenEstimate,
      message
    })
    return unavailable({
      timedOut: true,
      providerAttempted: attempts[0]?.provider ?? "none",
      fallbackReason: "timeout",
      failureMessage: message
    })
  }

  if (raceResult.winner) return raceResult.winner.result

  const failedAttempts = raceResult.failures.filter(
    (failure): failure is Extract<ProviderAttemptResult, { status: "failed" }> => failure.status === "failed"
  )
  const deepSeekFailure = failedAttempts.find((item) => item.provider === "deepseek")
  const kimiFailure = failedAttempts.find((item) => item.provider === "kimi")
  const primaryFailure = deepSeekFailure ?? kimiFailure
  logDeepAnalysisV2ProviderEvent({
    event: "provider_race_failed",
    latencyMs: elapsed(),
    promptTokenEstimate,
    failures: raceResult.failures.map((failure) =>
      failure.status === "failed"
        ? {
            provider: failure.provider,
            reason: failure.reason,
            latencyMs: failure.latencyMs,
            attemptCount: failure.attemptCount,
            retried: failure.retried,
            timedOut: failure.timedOut,
            jsonValid: failure.jsonValid,
            outputTokenEstimate: failure.outputTokenEstimate
          }
        : { provider: failure.provider, latencyMs: failure.latencyMs, attemptCount: failure.attemptCount, retried: failure.retried, success: true }
    )
  })
  return unavailable({
    timedOut: raceResult.failures.some((failure) => failure.status === "failed" && failure.timedOut),
    providerAttempted: attempts[0]?.provider ?? "none",
    fallbackReason: failedAttempts.some((failure) => failure.timedOut) ? "timeout" : primaryFailure?.reason ?? "unknown",
    failureMessage: failedAttempts
      .map((failure) => `${failure.provider}: ${failure.message}`)
      .join(" | ") || "No provider returned a usable structured result.",
    kimiLatencyMs: kimiFailure?.latencyMs,
    deepSeekAttempted: attempts.some((attempt) => attempt.provider === "deepseek"),
    deepSeekLatencyMs: deepSeekFailure?.latencyMs,
    deepSeekFailureReason: deepSeekFailure?.reason as DeepAnalysisV2DeepSeekFailureReason | undefined
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
      model: env.DEEPSEEK_MODEL,
      latencyMs: elapsed(),
      reason: env.DEEPSEEK_API_KEY ? "mocks_enabled" : "missing_key",
      message: env.DEEPSEEK_API_KEY
        ? "PROMPT_OPTIMIZER_USE_MOCKS is enabled."
        : "No DeepSeek API key is loaded."
    }
  }

  if (!env.DEEPSEEK_API_KEY && !options.callJson) {
    return {
      ok: false,
      provider: "deepseek" as const,
      model: env.DEEPSEEK_MODEL,
      latencyMs: elapsed(),
      reason: "missing_key",
      message: "No DeepSeek API key is loaded."
    }
  }

  try {
    const output = await withTimeout(
      (options.callJson ?? callDeepSeekJson)(
        "Return one JSON object only. No markdown.",
        JSON.stringify({ task: "health_check", expected: { ok: true } }),
        80
      ),
      timeoutMs,
      "DeepSeek health check"
    )
    if (!output) {
      return {
        ok: false,
        provider: "deepseek" as const,
        model: env.DEEPSEEK_MODEL,
        latencyMs: elapsed(),
        reason: "empty_response",
        message: "DeepSeek returned an empty response."
      }
    }

    JSON.parse(output)
    return {
      ok: true,
      provider: "deepseek" as const,
      model: env.DEEPSEEK_MODEL,
      latencyMs: elapsed(),
      reason: null,
      message: "DeepSeek returned valid JSON."
    }
  } catch (error) {
    return {
      ok: false,
      provider: "deepseek" as const,
      model: env.DEEPSEEK_MODEL,
      latencyMs: elapsed(),
      reason: classifyDeepSeekFailure(error),
      message: compactFailureMessage(error)
    }
  }
}
