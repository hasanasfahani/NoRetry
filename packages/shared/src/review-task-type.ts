import type { Attempt } from "./schemas"

export type ReviewTaskType =
  | "implementation"
  | "creation"
  | "writing"
  | "debug"
  | "verification"
  | "instructional"
  | "explanatory"
  | "advice"
  | "ideation"

const INSTRUCTIONAL_PATTERNS = [/\bhow to\b/i, /\binstructions?\b/i, /\bsteps?\b/i, /\binstall\b/i, /\bsetup\b/i, /\bset up\b/i, /\bconfigure\b/i, /\bload unpacked\b/i]
const EXPLANATORY_PATTERNS = [/\bexplain\b/i, /\bwhy\b/i, /\bwhat is\b/i, /\bhow does\b/i, /\bwalk me through\b/i, /\bteach me\b/i, /\bdescribe\b/i, /\bclarify\b/i]
const ADVICE_PATTERNS = [/\bideas?\b/i, /\bsuggestions?\b/i, /\bsuggest\b/i, /\brecommend\b/i, /\brecommend(?:ation|ations)?\b/i, /\bwhat should i\b/i, /\bwhat can i\b/i, /\bbest way\b/i, /\bbest match\b/i, /\bexact product\b/i, /\bbuy online\b/i, /\bonline today\b/i, /\bhealthy meal\b/i, /\bmeal ideas?\b/i, /\bweekday meals?\b/i, /\bbusy weekdays?\b/i]
const IDEATION_PATTERNS = [/\bbrainstorm\b/i, /\bconcepts?\b/i, /\boptions?\b/i, /\bthemes?\b/i, /\bangles?\b/i, /\bname ideas?\b/i, /\btaglines?\b/i]
const CREATION_PATTERNS = [/\bcreate\b/i, /\bgenerate\b/i, /\bbuild\b/i, /\bmake\b/i, /\bdesign\b/i, /\bwebsite code\b/i, /\bhtml\b/i, /\bcss\b/i, /\bjavascript\b/i, /\blanding page\b/i, /\bportfolio\b/i, /\bcv\b/i, /\bresume\b/i, /\bcomponent\b/i, /\btemplate\b/i]
const WRITING_PATTERNS = [/\brewrite\b/i, /\brephrase\b/i, /\bpolish\b/i, /\bwrite me\b/i, /\bmake this sound\b/i, /\bsound more professional\b/i, /\bimprove this message\b/i, /\bdraft\b/i, /\bwrite a\b/i, /\bemail\b/i, /\bmessage\b/i, /\bcover letter\b/i, /\bcaption\b/i, /\bbio\b/i, /\bsummarize\b/i, /\bexecutive summary\b/i, /\bwrite (?:a|an)\s+summary\b/i]
const VERIFICATION_PATTERNS = [/\bverify\b/i, /\bvalidate\b/i, /\bconfirm\b/i, /\bcheck whether\b/i, /\bis this\b/i, /\breview\b/i]
const DEBUG_PATTERNS = [/\bdebug\b/i, /\bfix\b/i, /\berror\b/i, /\bbug\b/i, /\bfailing\b/i, /\bstill\b/i, /\bnot visible\b/i, /\bnot showing\b/i, /\bnot working\b/i, /\bdoesn'?t work\b/i, /\bmissing\b/i, /\bcan'?t see\b/i, /\bicon\b/i, /\blauncher\b/i, /\bcontent script\b/i, /\bselector\b/i, /\bdom\b/i]
const GENERATION_VERB_PATTERNS = [/\bgive me\b/i, /\bprovide\b/i, /\bwrite me\b/i, /\bwrite (?:a|an)\b/i, /\bdraft\b/i, /\bsuggest\b/i]
const CREATION_GENERATION_VERB_PATTERNS = [/\bgive me\b/i, /\bprovide\b/i, /\bwrite me\b/i, /\bwrite (?:a|an)\b/i, /\bdraft\b/i, /\bgenerate\b/i, /\bcreate\b/i, /\bbuild\b/i, /\bmake\b/i]
const WRITING_DELIVERABLE_PATTERNS = [/\bemail\b/i, /\bmessage\b/i, /\bcover letter\b/i, /\bcaption\b/i, /\bbio\b/i, /\bexecutive summary\b/i, /\bsummary\b/i]
const CREATION_DELIVERABLE_PATTERNS = [/\bprompt\b/i, /\brecipe\b/i, /\bmeal\b/i, /\blunch\b/i, /\bdinner\b/i, /\bbreakfast\b/i, /\bsnack\b/i, /\bmenu\b/i, /\boutline\b/i, /\bplan\b/i, /\bitinerary\b/i, /\bagenda\b/i, /\bchecklist\b/i]
const PROMPT_DELIVERABLE_PATTERNS = [/\bprompt\b/i, /\bresearch prompt\b/i, /\bcode prompt\b/i, /\brewrite prompt\b/i, /\bgenerate(?:d)? prompt\b/i, /\bsend-ready prompt\b/i]
const ADVICE_DELIVERABLE_PATTERNS = [/\bproduct\b/i, /\bdrink\b/i, /\bmix\b/i, /\btea\b/i, /\bcoffee\b/i, /\bsupplement\b/i, /\boption\b/i, /\bbrand\b/i]
const STRUCTURED_PROMPT_SECTION_PATTERNS = [/task\s*\/\s*goal:/i, /key requirements:/i, /constraints:/i, /output format:/i, /quality bar\s*\/\s*style guardrails:/i]

function matchesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value))
}

function extractStructuredTaskGoal(prompt: string) {
  const match = prompt.match(/task\s*\/\s*goal:\s*([\s\S]*?)(?:\n\s*\n|\n(?:key requirements|constraints|output format|quality bar\s*\/\s*style guardrails|style|requirements|output)\s*:|$)/i)
  return match?.[1]?.replace(/\s+/g, " ").trim() ?? ""
}

function buildPromptSearchText(prompt: string) {
  const structuredGoal = extractStructuredTaskGoal(prompt)
  return [prompt, structuredGoal].filter(Boolean).join("\n")
}

function buildGoalFirstSearchText(prompt: string) {
  return extractStructuredTaskGoal(prompt) || prompt
}

function looksLikeDirectWritingRequest(prompt: string) {
  return matchesAny(prompt, GENERATION_VERB_PATTERNS) && matchesAny(prompt, WRITING_DELIVERABLE_PATTERNS)
}

function looksLikeDirectCreationRequest(prompt: string) {
  return matchesAny(prompt, CREATION_GENERATION_VERB_PATTERNS) && matchesAny(prompt, CREATION_DELIVERABLE_PATTERNS)
}

function looksLikePromptDeliverableRequest(prompt: string) {
  return matchesAny(prompt, GENERATION_VERB_PATTERNS) && matchesAny(prompt, PROMPT_DELIVERABLE_PATTERNS)
}

export function looksLikeCreationRequestPrompt(prompt: string) {
  const searchText = buildPromptSearchText(prompt)
  const structuredPrompt = matchesAny(prompt, STRUCTURED_PROMPT_SECTION_PATTERNS)
  const recipeDeliverableSignal =
    /\b(?:recipe|meal|breakfast|lunch|dinner)\b/i.test(searchText) &&
    /\bingredients?\b/i.test(searchText) &&
    /\b(?:step[-\s]?by[-\s]?step|instructions?)\b/i.test(searchText)
  const fileOutputSignal =
    /\bfull html file\b/i.test(searchText) ||
    /\bready-to-save\b/i.test(searchText) ||
    /\binline css only\b/i.test(searchText) ||
    /\breturn the full file\b/i.test(searchText) ||
    /\bcode only\b/i.test(searchText)

  return (
    matchesAny(searchText, CREATION_PATTERNS) ||
    looksLikeDirectCreationRequest(searchText) ||
    recipeDeliverableSignal ||
    (structuredPrompt && (matchesAny(searchText, CREATION_PATTERNS) || fileOutputSignal))
  )
}

export function looksLikeAdviceRequestPrompt(prompt: string) {
  const searchText = buildPromptSearchText(prompt)
  const structuredPrompt = matchesAny(prompt, STRUCTURED_PROMPT_SECTION_PATTERNS)
  const adviceDirective =
    matchesAny(searchText, ADVICE_PATTERNS) ||
    (matchesAny(searchText, GENERATION_VERB_PATTERNS) && matchesAny(searchText, ADVICE_DELIVERABLE_PATTERNS))
  const shoppingSignal = /\b(one|single|exact)\s+(?:product|option)\b/i.test(searchText) || /\bbuy online\b|\bonline today\b/i.test(searchText)

  return adviceDirective && (matchesAny(searchText, ADVICE_DELIVERABLE_PATTERNS) || shoppingSignal || structuredPrompt)
}

export function isAnswerQualityTask(taskType: ReviewTaskType) {
  return taskType === "creation" || taskType === "writing" || taskType === "instructional" || taskType === "explanatory" || taskType === "advice" || taskType === "ideation"
}

export function classifyReviewTaskType(attempt: Pick<Attempt, "raw_prompt" | "optimized_prompt" | "intent">): ReviewTaskType {
  const prompt = (attempt.optimized_prompt || attempt.raw_prompt || attempt.intent.goal || "").trim()
  const searchText = buildPromptSearchText(prompt)
  const goalFirstSearchText = buildGoalFirstSearchText(prompt)
  const taskType = attempt.intent.task_type
  const unresolvedRuntimeIssue = matchesAny(searchText, DEBUG_PATTERNS) && /\bstill\b|\bnot\b|\bmissing\b|\bdoesn'?t\b|\bcan'?t\b|\bfailing\b/i.test(searchText)

  if (taskType === "create_ui" && unresolvedRuntimeIssue) return "debug"
  if (looksLikePromptDeliverableRequest(goalFirstSearchText)) return "creation"
  if (looksLikeAdviceRequestPrompt(goalFirstSearchText)) return "advice"
  if (looksLikeCreationRequestPrompt(goalFirstSearchText)) return "creation"
  if (matchesAny(goalFirstSearchText, WRITING_PATTERNS) || looksLikeDirectWritingRequest(goalFirstSearchText)) return "writing"
  if (matchesAny(goalFirstSearchText, VERIFICATION_PATTERNS)) return "verification"
  if (taskType === "create_ui" || taskType === "build") return "creation"
  if (taskType === "debug" || matchesAny(searchText, DEBUG_PATTERNS)) return "debug"
  if (matchesAny(searchText, INSTRUCTIONAL_PATTERNS)) return "instructional"
  if (matchesAny(searchText, EXPLANATORY_PATTERNS)) return "explanatory"
  if (looksLikePromptDeliverableRequest(searchText)) return "creation"
  if (looksLikeAdviceRequestPrompt(prompt)) return "advice"
  if (matchesAny(searchText, ADVICE_PATTERNS)) return "advice"
  if (matchesAny(searchText, IDEATION_PATTERNS)) return "ideation"
  if (looksLikeCreationRequestPrompt(prompt)) return "creation"
  if (matchesAny(searchText, WRITING_PATTERNS)) return "writing"
  if (looksLikeDirectWritingRequest(searchText)) return "writing"
  if (taskType === "explain") return "explanatory"
  return "implementation"
}
