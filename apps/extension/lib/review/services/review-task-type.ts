import type { Attempt } from "@prompt-optimizer/shared/src/schemas"

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

const INSTRUCTIONAL_PATTERNS = [
  /\bhow to\b/i,
  /\binstructions?\b/i,
  /\bsteps?\b/i,
  /\binstall\b/i,
  /\bsetup\b/i,
  /\bset up\b/i,
  /\bconfigure\b/i,
  /\bload unpacked\b/i
]

const EXPLANATORY_PATTERNS = [
  /\bexplain\b/i,
  /\bwhy\b/i,
  /\bwhat is\b/i,
  /\bhow does\b/i,
  /\bwalk me through\b/i,
  /\bteach me\b/i,
  /\bdescribe\b/i
]

const ADVICE_PATTERNS = [
  /\bideas?\b/i,
  /\bsuggestions?\b/i,
  /\brecommend(?:ation|ations)?\b/i,
  /\bwhat should i\b/i,
  /\bwhat can i\b/i,
  /\bbest way\b/i,
  /\bhealthy meal\b/i,
  /\bmeal ideas?\b/i,
  /\bweekday meals?\b/i,
  /\bbusy weekdays?\b/i
]

const IDEATION_PATTERNS = [
  /\bbrainstorm\b/i,
  /\bconcepts?\b/i,
  /\boptions?\b/i,
  /\bthemes?\b/i,
  /\bangles?\b/i,
  /\bname ideas?\b/i,
  /\btaglines?\b/i
]

const CREATION_PATTERNS = [
  /\bcreate\b/i,
  /\bgenerate\b/i,
  /\bbuild\b/i,
  /\bmake\b/i,
  /\bdesign\b/i,
  /\bwebsite code\b/i,
  /\bhtml\b/i,
  /\bcss\b/i,
  /\bjavascript\b/i,
  /\blanding page\b/i,
  /\bportfolio\b/i,
  /\bcv\b/i,
  /\bresume\b/i,
  /\bcomponent\b/i,
  /\btemplate\b/i
]

const WRITING_PATTERNS = [
  /\brewrite\b/i,
  /\brephrase\b/i,
  /\bpolish\b/i,
  /\bwrite me\b/i,
  /\bmake this sound\b/i,
  /\bsound more professional\b/i,
  /\bimprove this message\b/i,
  /\bdraft\b/i,
  /\bwrite a\b/i,
  /\bemail\b/i,
  /\bmessage\b/i,
  /\bcover letter\b/i,
  /\bcaption\b/i,
  /\bbio\b/i,
  /\bsummary\b/i
]

const VERIFICATION_PATTERNS = [
  /\bverify\b/i,
  /\bvalidate\b/i,
  /\bconfirm\b/i,
  /\bcheck whether\b/i,
  /\bis this\b/i,
  /\breview\b/i
]

const DEBUG_PATTERNS = [
  /\bdebug\b/i,
  /\bfix\b/i,
  /\berror\b/i,
  /\bbug\b/i,
  /\bfailing\b/i,
  /\bstill\b/i,
  /\bnot visible\b/i,
  /\bnot showing\b/i,
  /\bnot working\b/i,
  /\bdoesn'?t work\b/i,
  /\bmissing\b/i,
  /\bcan'?t see\b/i,
  /\bicon\b/i,
  /\blauncher\b/i,
  /\bcontent script\b/i,
  /\bselector\b/i,
  /\bdom\b/i
]

const GENERATION_VERB_PATTERNS = [/\bgive me\b/i, /\bprovide\b/i, /\bwrite me\b/i, /\bdraft\b/i]
const WRITING_DELIVERABLE_PATTERNS = [/\bemail\b/i, /\bmessage\b/i, /\bcover letter\b/i, /\bcaption\b/i, /\bbio\b/i, /\bsummary\b/i]
const CREATION_DELIVERABLE_PATTERNS = [
  /\bprompt\b/i,
  /\brecipe\b/i,
  /\bmeal\b/i,
  /\blunch\b/i,
  /\bdinner\b/i,
  /\bbreakfast\b/i,
  /\bsnack\b/i,
  /\bmenu\b/i,
  /\boutline\b/i,
  /\bplan\b/i,
  /\bitinerary\b/i,
  /\bagenda\b/i,
  /\bchecklist\b/i
]

function matchesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value))
}

function looksLikeDirectWritingRequest(prompt: string) {
  return matchesAny(prompt, GENERATION_VERB_PATTERNS) && matchesAny(prompt, WRITING_DELIVERABLE_PATTERNS)
}

function looksLikeDirectCreationRequest(prompt: string) {
  return matchesAny(prompt, GENERATION_VERB_PATTERNS) && matchesAny(prompt, CREATION_DELIVERABLE_PATTERNS)
}

export function isAnswerQualityTask(taskType: ReviewTaskType) {
  return (
    taskType === "creation" ||
    taskType === "writing" ||
    taskType === "instructional" ||
    taskType === "explanatory" ||
    taskType === "advice" ||
    taskType === "ideation"
  )
}

export function classifyReviewTaskType(attempt: Pick<Attempt, "raw_prompt" | "optimized_prompt" | "intent">): ReviewTaskType {
  const prompt = (attempt.optimized_prompt || attempt.raw_prompt || attempt.intent.goal || "").trim()
  const taskType = attempt.intent.task_type
  const unresolvedRuntimeIssue =
    matchesAny(prompt, DEBUG_PATTERNS) &&
    /\bstill\b|\bnot\b|\bmissing\b|\bdoesn'?t\b|\bcan'?t\b|\bfailing\b/i.test(prompt)

  if (taskType === "create_ui" && unresolvedRuntimeIssue) return "debug"
  if (matchesAny(prompt, VERIFICATION_PATTERNS)) return "verification"
  if (taskType === "create_ui" || taskType === "build") return "creation"
  if (taskType === "debug" || matchesAny(prompt, DEBUG_PATTERNS)) return "debug"
  if (matchesAny(prompt, INSTRUCTIONAL_PATTERNS)) return "instructional"
  if (matchesAny(prompt, EXPLANATORY_PATTERNS)) return "explanatory"
  if (matchesAny(prompt, ADVICE_PATTERNS)) return "advice"
  if (matchesAny(prompt, IDEATION_PATTERNS)) return "ideation"
  if (matchesAny(prompt, WRITING_PATTERNS)) return "writing"
  if (looksLikeDirectWritingRequest(prompt)) return "writing"
  if (looksLikeDirectCreationRequest(prompt)) return "creation"
  if (matchesAny(prompt, CREATION_PATTERNS)) return "creation"
  if (taskType === "explain") return "explanatory"
  if (taskType === "brainstorm") return "ideation"

  return "implementation"
}
