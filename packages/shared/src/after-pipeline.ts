import type {
  AttemptIntent,
  ClarificationQuestion,
  PromptIntent,
  ResponsePreprocessorOutput,
  UnifiedTaskType
} from "./schemas"

const FILE_REGEX = /\b[\w./-]+\.(?:js|ts|tsx|jsx|css|scss|json|md|py|rb|java|go|rs|html)\b/gi
const CERTAINTY_REGEX = /\b(done|implemented|fixed|resolved|validated|confirmed|working|completed)\b/gi
const UNCERTAINTY_REGEX = /\b(maybe|might|should|could|try|possibly|perhaps|likely)\b/gi
const SUCCESS_REGEX = /\b(fixed|resolved|done|implemented|working|completed|validated)\b/gi
const FAILURE_REGEX = /\b(error|failed|failure|broken|exception|traceback|unable|cannot|can't|doesn't work)\b/gi
const CHANGE_CLAIM_REGEX =
  /\b(i\s+(?:changed|updated|fixed|added|removed|moved|reworked|patched|persisted|guarded|hooked|rewired)|(?:changed|updated|fixed|added|removed|moved|reworked|patched|persisted|guarded|hooked|rewired)\s+(?:the|this|that|these)|(?:three|two|several)\s+things\s+were\s+changed)\b/i
const VALIDATION_SIGNAL_REGEX =
  /\b(test(?:ed|ing)?|verified|validated|confirmed|no console errors|survive(?:s|d)? spa navigation|works offline|manual reload|reloaded|retested|passed)\b/i

function dedupe(items: string[], limit = 6) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, limit)
}

function limitText(value: string, limit: number) {
  if (value.length <= limit) return value
  return `${value.slice(0, limit - 1).trimEnd()}…`
}

function conciseGoal(value: string) {
  return limitText(value.trim(), 140)
}

function normalizePromptText(value: string) {
  return value.replace(/\r/g, "").replace(/\t/g, " ").replace(/\s+/g, " ").trim()
}

function cleanCriterionText(value: string) {
  const trimmed = value
    .replace(/^[-*•]\s*/, "")
    .replace(/^and\s+/i, "")
    .replace(/^then\s+/i, "")
    .replace(/^that\s+/i, "")
    .replace(/^it\s+should\s+/i, "")
    .replace(/^the answer should\s+/i, "")
    .replace(/^should\s+/i, "")
    .replace(/^must\s+/i, "")
    .replace(/^please\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:]\s*$/, "")
    .trim()

  if (!trimmed) return ""
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

function hasMeaningfulCriterionContent(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (normalized.length < 8) return false

  const tokens = normalized
    .split(" ")
    .filter(Boolean)
    .filter((token) => token.length >= 3)

  if (tokens.length < 2) return false
  if (["the", "this", "that", "these", "those"].includes(tokens[0]) && tokens.length < 3) return false

  return true
}

function splitExplicitClauses(source: string) {
  return source
    .replace(/[–—]/g, " - ")
    .split(/\n+|;\s+|•|(?<=:)\s*-\s+|\s+-\s+(?=[A-Z@a-z])/)
    .map((item) => cleanCriterionText(item))
    .filter(Boolean)
}

function isExplicitCriterionClause(value: string) {
  const lowered = value.toLowerCase()

  if (lowered.length < 6) return false
  if (/^(write|add|extend|create|build|make)\b/.test(lowered)) return false

  return (
    /^(return|output|keep|use|include|list|show|set|force|print|open|opens|hide|hides|same|max-|min-|under|within|without|no |do not|don't|works|work offline|right-clicking|tooltip|page|font-size)/.test(
      lowered
    ) ||
    /\b(return only|no explanations|no other ui changes|same width|max-height|font-size|works offline|code block|markdown code block)\b/.test(
      lowered
    )
  )
}

function extractSectionClauses(prompt: string) {
  const normalized = normalizePromptText(prompt)
  const sectionMatches = [
    ...normalized.matchAll(/(?:so that|requirements?|success criteria|must-haves?)\s*:\s*(.+?)(?=(?:return only|output only|no explanations|no text outside|keep\b|do not\b|don't\b|$))/gi)
  ]

  return dedupe(
    sectionMatches
      .flatMap((match) => splitExplicitClauses(match[1] ?? ""))
      .filter(isExplicitCriterionClause),
    8
  )
}

function extractGlobalPromptRules(prompt: string) {
  const normalized = normalizePromptText(prompt)
  const patterns = [
    /\breturn only [^.]+/gi,
    /\boutput only [^.]+/gi,
    /\bno explanations?\b/gi,
    /\bno text outside [^.]+/gi,
    /\bkeep [^.]+ unchanged\b/gi,
    /\bkeep [^.]+ behaviour unchanged\b/gi,
    /\bkeep [^.]+ behavior unchanged\b/gi,
    /\bdo not [^.]+/gi,
    /\bdon't [^.]+/gi,
    /\buse [^.]+ works offline\b/gi,
    /\bworks offline\b/gi
  ]

  return dedupe(
    patterns
      .flatMap((pattern) => [...normalized.matchAll(pattern)].map((match) => cleanCriterionText(match[0] ?? "")))
      .filter(isExplicitCriterionClause),
    8
  )
}

function extractMinimalCoreTask(prompt: string) {
  const normalized = normalizePromptText(prompt)
  const core = normalized
    .split(/\bso that\b/i)[0]
    .split(/\breturn only\b/i)[0]
    .split(/\boutput only\b/i)[0]
    .trim()

  if (!core) return ""

  const shortened = cleanCriterionText(core)
  return limitText(shortened, 72)
}

function deriveAcceptanceCriteriaFromSubmittedPrompt(prompt: string) {
  const explicitClauses = extractSectionClauses(prompt)
  const outputRules = extractGlobalPromptRules(prompt)
  const combined = dedupe([...explicitClauses, ...outputRules], 6)
    .filter(hasMeaningfulCriterionContent)
    .map((item) => limitText(item, 72))

  if (combined.length) {
    return combined
  }

  const fallbackCoreTask = extractMinimalCoreTask(prompt)
  if (fallbackCoreTask && hasMeaningfulCriterionContent(fallbackCoreTask)) {
    return [fallbackCoreTask]
  }

  const fallbackGoal = conciseGoal(prompt.trim()) || "the user's latest request"
  return [`Solve: ${fallbackGoal}`]
}

function extractClaimSentences(normalized: string, matcher: RegExp, limit: number) {
  return dedupe(
    normalized
      .split(/(?<=[.!?])\s+|\n+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean)
      .filter((sentence) => matcher.test(sentence))
      .map((sentence) => limitText(sentence, 180)),
    limit
  )
}

export function mapPromptIntentToTaskType(intent: PromptIntent | undefined): UnifiedTaskType {
  switch (intent) {
    case "DEBUG":
      return "debug"
    case "BUILD":
    case "PLAN":
      return "build"
    case "REFACTOR":
      return "refactor"
    case "EXPLAIN":
      return "explain"
    case "DESIGN_UI":
      return "create_ui"
    default:
      return "other"
  }
}

export function buildAttemptIntentFromBefore(
  rawPrompt: string,
  optimizedPrompt: string,
  promptIntent: PromptIntent | undefined,
  questions: ClarificationQuestion[] = [],
  answers: Record<string, string | string[]> = {}
): AttemptIntent {
  const constraints: string[] = []
  const acceptance: string[] = []

  for (const question of questions) {
    const answer = answers[question.id]
    const selected = Array.isArray(answer) ? answer : typeof answer === "string" ? [answer] : []
    if (!selected.length) continue

    const label = question.label.toLowerCase()
    if (label.includes("constraint") || label.includes("limit") || label.includes("scope")) {
      constraints.push(...selected)
    }
    if (
      label.includes("success") ||
      label.includes("expected") ||
      label.includes("goal") ||
      label.includes("result") ||
      label.includes("outcome")
    ) {
      acceptance.push(...selected)
    }
  }

  return {
    task_type: mapPromptIntentToTaskType(promptIntent),
    goal: (optimizedPrompt || rawPrompt).trim(),
    constraints: dedupe(constraints, 6),
    acceptance_criteria: dedupe(
      acceptance.length
        ? acceptance
        : [`Prove the answer solved this goal: ${conciseGoal(optimizedPrompt || rawPrompt)}`],
      6
    )
  }
}

export function buildAttemptIntentFromSubmittedPrompt(
  submittedPrompt: string,
  promptIntent: PromptIntent | undefined
): AttemptIntent {
  const normalizedPrompt = submittedPrompt.trim()

  return {
    task_type: mapPromptIntentToTaskType(promptIntent),
    goal: normalizedPrompt,
    constraints: [],
    acceptance_criteria: deriveAcceptanceCriteriaFromSubmittedPrompt(normalizedPrompt)
  }
}

export function preprocessResponse(responseText: string): ResponsePreprocessorOutput {
  const normalized = responseText.trim()
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)

  const signalParagraphs = paragraphs
    .filter((part) => /error|failed|fixed|implemented|validated|updated|file|```/i.test(part))
    .slice(0, 2)

  return {
    response_text: normalized,
    response_length: normalized.length,
    first_excerpt: limitText(normalized.slice(0, 500), 500),
    last_excerpt: limitText(normalized.slice(Math.max(0, normalized.length - 500)), 500),
    key_paragraphs: signalParagraphs.length ? signalParagraphs.map((part) => limitText(part, 320)) : paragraphs.slice(0, 2).map((part) => limitText(part, 320)),
    has_code_blocks: /```/.test(normalized),
    mentioned_files: dedupe(normalized.match(FILE_REGEX) ?? [], 20),
    change_claims: extractClaimSentences(normalized, CHANGE_CLAIM_REGEX, 4),
    validation_signals: extractClaimSentences(normalized, VALIDATION_SIGNAL_REGEX, 4),
    certainty_signals: dedupe(normalized.match(CERTAINTY_REGEX) ?? [], 6),
    uncertainty_signals: dedupe(normalized.match(UNCERTAINTY_REGEX) ?? [], 6),
    success_signals: dedupe(normalized.match(SUCCESS_REGEX) ?? [], 6),
    failure_signals: dedupe(normalized.match(FAILURE_REGEX) ?? [], 6)
  }
}

export function buildResponseExcerpts(summary: ResponsePreprocessorOutput) {
  return dedupe(
    [summary.first_excerpt, ...summary.key_paragraphs, summary.last_excerpt].filter(Boolean),
    3
  )
}

export function compressGoal(goal: string) {
  return limitText(goal.trim(), 240)
}
