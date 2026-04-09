import type {
  AfterEvaluationResult,
  AfterHeuristicResult,
  AfterIntent,
  AfterLlmRequest,
  AfterLlmResponse,
  AfterStatus,
  ArtifactSummary,
  ClarificationQuestion,
  PromptIntent
} from "./schemas"

const FILE_REGEX = /\b[\w./-]+\.(?:js|ts|tsx|jsx|css|scss|json|md|py|rb|java|go|rs|html)\b/gi
const SUCCESS_REGEX = /\b(fixed|resolved|done|completed|implemented|working|shipped)\b/i
const UNCERTAINTY_REGEX = /\b(maybe|might|try|possibly|perhaps|should|could)\b/i
const ERROR_REGEX = /\b(error|failed|failure|exception|traceback)\b/i

function dedupe(items: string[], limit = 5) {
  return [...new Set(items.filter(Boolean))].slice(0, limit)
}

function mapPromptIntent(intent: PromptIntent | undefined): AfterIntent["task_type"] {
  switch (intent) {
    case "DEBUG":
      return "debug"
    case "BUILD":
    case "DESIGN_UI":
    case "PLAN":
      return "build"
    case "REFACTOR":
      return "refactor"
    case "EXPLAIN":
      return "explain"
    default:
      return "build"
  }
}

export function buildAfterIntent(
  originalPrompt: string,
  optimizedPrompt: string | null | undefined,
  promptIntent: PromptIntent | undefined,
  questions: ClarificationQuestion[] = [],
  answers: Record<string, string | string[]> = {}
): AfterIntent {
  const acceptance: string[] = []

  for (const question of questions) {
    const value = answers[question.id]
    const selected = Array.isArray(value) ? value : typeof value === "string" ? [value] : []
    if (!selected.length) continue

    const label = question.label.toLowerCase()
    if (
      label.includes("success") ||
      label.includes("expected") ||
      label.includes("outcome") ||
      label.includes("goal") ||
      label.includes("result")
    ) {
      acceptance.push(...selected)
    }
  }

  if (!acceptance.length) {
    acceptance.push("The response should directly address the requested goal.")
  }

  return {
    goal: (optimizedPrompt || originalPrompt).trim(),
    task_type: mapPromptIntent(promptIntent),
    acceptance_criteria: dedupe(acceptance, 5)
  }
}

export function summarizeArtifact(responseText: string): ArtifactSummary {
  return {
    response_length: responseText.length,
    contains_code: /```|(?:const|let|var|function|class|interface)\s+\w+/i.test(responseText),
    mentioned_files: dedupe(responseText.match(FILE_REGEX) ?? [], 20),
    claims_success: SUCCESS_REGEX.test(responseText),
    uncertainty_detected: UNCERTAINTY_REGEX.test(responseText)
  }
}

export function runAfterHeuristics(intent: AfterIntent, summary: ArtifactSummary, responseText: string): AfterHeuristicResult {
  const flags: string[] = []

  if (ERROR_REGEX.test(responseText)) {
    flags.push("error_detected")
  }

  if (
    intent.acceptance_criteria.length > 0 &&
    !intent.acceptance_criteria.some((item) => responseText.toLowerCase().includes(item.toLowerCase().slice(0, 24)))
  ) {
    flags.push("missing_validation")
  }

  if (summary.claims_success && !summary.contains_code && summary.mentioned_files.length === 0) {
    flags.push("low_evidence")
  }

  if ((intent.task_type === "build" || intent.task_type === "debug") && summary.response_length < 300) {
    flags.push("likely_incomplete")
  }

  if (summary.mentioned_files.length >= 8) {
    flags.push("scope_drift")
  }

  if (!summary.contains_code && summary.mentioned_files.length === 0 && !summary.claims_success) {
    flags.push("no_artifacts")
  }

  let preliminary_status: AfterStatus = "SUCCESS"

  if (flags.includes("error_detected")) {
    preliminary_status = "FAILED"
  } else if (flags.includes("no_artifacts")) {
    preliminary_status = "UNVERIFIED"
  } else if (flags.length > 0) {
    preliminary_status = "PARTIAL"
  }

  return {
    preliminary_status,
    heuristic_flags: dedupe(flags, 10)
  }
}

export function shouldRunAfterLlm(heuristic: AfterHeuristicResult) {
  return heuristic.preliminary_status !== "SUCCESS" || heuristic.heuristic_flags.length > 0
}

export function extractRelevantSnippets(responseText: string) {
  return responseText
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .filter((chunk) => /error|failed|fixed|updated|file|```|success|done|resolved/i.test(chunk))
    .slice(0, 2)
    .map((chunk) => chunk.slice(0, 280))
}

export function buildAfterLlmRequest(intent: AfterIntent, artifact_summary: ArtifactSummary, responseText: string, heuristic_flags: string[]): AfterLlmRequest {
  return {
    intent,
    artifact_summary,
    snippets: extractRelevantSnippets(responseText),
    heuristic_flags: heuristic_flags.slice(0, 10)
  }
}

function mapLlmStatus(status: AfterLlmResponse["status"]): AfterStatus {
  if (status === "WRONG_DIRECTION") return "FAILED"
  return status
}

function buildHeuristicFindings(heuristic: AfterHeuristicResult, summary: ArtifactSummary) {
  const findings: string[] = []
  const issues: string[] = []

  if (heuristic.heuristic_flags.includes("error_detected")) {
    findings.push("The response contains an explicit error or failure signal.")
    issues.push("The task still appears to be failing.")
  }

  if (heuristic.heuristic_flags.includes("missing_validation")) {
    findings.push("The response does not validate the requested success criteria.")
    issues.push("Missing proof that the goal was actually met.")
  }

  if (heuristic.heuristic_flags.includes("low_evidence")) {
    findings.push("The response claims success without concrete implementation evidence.")
    issues.push("No files or code changes were referenced.")
  }

  if (heuristic.heuristic_flags.includes("likely_incomplete")) {
    findings.push("The response is very short for the task complexity.")
    issues.push("The answer may be incomplete.")
  }

  if (heuristic.heuristic_flags.includes("scope_drift")) {
    findings.push("The response mentions a broad set of files.")
    issues.push("The solution may have drifted beyond the requested scope.")
  }

  if (heuristic.heuristic_flags.includes("no_artifacts")) {
    findings.push("The response does not mention code, files, or clear action artifacts.")
    issues.push("There is not enough evidence to verify the result.")
  }

  if (!findings.length && summary.claims_success) {
    findings.push("The response looks consistent with a successful outcome.")
  }

  return {
    findings: dedupe(findings, 3),
    issues: dedupe(issues, 5)
  }
}

export function buildHeuristicNextPrompt(intent: AfterIntent, heuristic: AfterHeuristicResult, summary: ArtifactSummary) {
  const issueHints: string[] = []

  if (heuristic.heuristic_flags.includes("missing_validation")) {
    issueHints.push("verify the acceptance criteria explicitly")
  }
  if (heuristic.heuristic_flags.includes("low_evidence")) {
    issueHints.push("name the files changed or show the concrete code edit")
  }
  if (heuristic.heuristic_flags.includes("likely_incomplete")) {
    issueHints.push("finish the implementation end to end")
  }
  if (heuristic.heuristic_flags.includes("scope_drift")) {
    issueHints.push("keep the fix scoped to only the relevant files")
  }
  if (heuristic.heuristic_flags.includes("error_detected")) {
    issueHints.push("focus on the visible error first")
  }
  if (heuristic.heuristic_flags.includes("no_artifacts")) {
    issueHints.push("show what actually changed")
  }

  const prompt = [
    `You were trying to ${intent.goal}.`,
    issueHints.length ? `Please ${issueHints.join(", ")}.` : "Please verify the result with concrete evidence.",
    summary.contains_code ? "Keep the answer concise and grounded in the actual change." : "Reference the exact implementation steps or files."
  ]

  return prompt.join(" ").replace(/\s+/g, " ").trim()
}

export function combineAfterEvaluation(
  intent: AfterIntent,
  summary: ArtifactSummary,
  heuristic: AfterHeuristicResult,
  llm: AfterLlmResponse | null
): AfterEvaluationResult {
  const heuristicInsights = buildHeuristicFindings(heuristic, summary)

  if (!llm) {
    return {
      status: heuristic.preliminary_status,
      confidence:
        heuristic.preliminary_status === "SUCCESS"
          ? "high"
          : heuristic.preliminary_status === "FAILED"
            ? "high"
            : "medium",
      findings: heuristicInsights.findings,
      issues: heuristicInsights.issues,
      next_prompt: buildHeuristicNextPrompt(intent, heuristic, summary),
      source: "HEURISTIC"
    }
  }

  return {
    status: mapLlmStatus(llm.status),
    confidence: llm.confidence,
    findings: dedupe([...llm.findings, ...heuristicInsights.findings], 3),
    issues: dedupe([...llm.issues, ...heuristicInsights.issues], 5),
    next_prompt: llm.next_prompt || buildHeuristicNextPrompt(intent, heuristic, summary),
    source: "HEURISTIC_PLUS_LLM"
  }
}
