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

function cleanCriterionText(value: string) {
  return value
    .replace(/^[-*•]\s*/, "")
    .replace(/^and\s+/i, "")
    .replace(/^then\s+/i, "")
    .replace(/^that\s+/i, "")
    .replace(/^it\s+should\s+/i, "")
    .replace(/^should\s+/i, "")
    .replace(/^must\s+/i, "")
    .replace(/^the answer should\s+/i, "")
    .replace(/^return\s+only\s+/i, "Return only ")
    .replace(/^keep\s+/i, "Keep ")
    .replace(/^use\s+/i, "Use ")
    .replace(/^no\s+/i, "No ")
    .replace(/\s+/g, " ")
    .trim()
}

function deriveAcceptanceCriteriaFromSubmittedPrompt(prompt: string) {
  const normalized = prompt
    .replace(/\r/g, "")
    .replace(/[–—]/g, "; ")
    .replace(/\n+/g, "\n")
    .trim()

  const matches = normalized.match(/so that:(.*?)(?:return only|no explanations|$)/is)
  const scopedSource = matches?.[1]?.trim() || normalized

  const rawClauses = scopedSource
    .split(/\n|;(?=\s)|•|(?<!\d)\.(?=\s+[A-Z@-])/)
    .map((item) => cleanCriterionText(item))
    .filter(Boolean)

  const focusedClauses = rawClauses.filter((item) => {
    const lowered = item.toLowerCase()
    return (
      lowered.length >= 6 &&
      !/^write\b/.test(lowered) &&
      !/^add\b/.test(lowered) &&
      !/^extend\b/.test(lowered) &&
      !/^create\b/.test(lowered) &&
      !/^build\b/.test(lowered)
    )
  })

  const explicitReturnRules = [
    /return only the complete updated html file(?: inside one markdown code block)?/i,
    /return only the code block/i,
    /no explanations/i,
    /keep the current .* unchanged/i,
    /use a lightweight, client-side model/i,
    /works offline/i
  ]
    .map((pattern) => normalized.match(pattern)?.[0] ?? "")
    .map((item) => cleanCriterionText(item))
    .filter(Boolean)

  const combined = dedupe([...focusedClauses, ...explicitReturnRules], 6)

  if (combined.length) {
    return combined.map((item) => limitText(item, 72))
  }

  return [`Solve: ${conciseGoal(normalized)}`]
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
