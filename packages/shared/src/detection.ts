import { DETECTION_THRESHOLDS } from "./constants"
import type { DetectOutcomeRequest, DetectOutcomeResponse, PromptIntent } from "./schemas"

const GENERIC_OUTPUT_PATTERNS = [
  /here('| i)s a general approach/i,
  /you can customize/i,
  /placeholder/i,
  /lorem ipsum/i,
  /basic example/i
]

function isSimplePrompt(intent: PromptIntent, prompt: string) {
  return intent === "DEBUG" || prompt.length < 180
}

function hasVisibleError(output: string, errorSummary?: string | null) {
  return Boolean(
    errorSummary ||
      /\bfailed\b/i.test(output) ||
      /\berror\b/i.test(output) ||
      /\bexception\b/i.test(output) ||
      /\btest(s)? failed\b/i.test(output)
  )
}

export function detectOutcomeLocally(input: DetectOutcomeRequest): DetectOutcomeResponse {
  const retryPattern = input.retry_count > 0
  const errorDetected = hasVisibleError(input.output_snippet, input.error_summary)
  const scopeDrift =
    input.changed_files_count >= DETECTION_THRESHOLDS.changedFilesBroadThreshold ||
    (isSimplePrompt(input.prompt_intent, input.final_sent_prompt) &&
      input.changed_files_count >= DETECTION_THRESHOLDS.changedFilesSimplePromptThreshold)
  const possibleVagueness =
    input.final_sent_prompt.length > 50 &&
    GENERIC_OUTPUT_PATTERNS.some((pattern) => pattern.test(input.output_snippet))
  const loopingBehavior = input.retry_count >= DETECTION_THRESHOLDS.loopRetryCount && !errorDetected
  const overreachDetected =
    isSimplePrompt(input.prompt_intent, input.final_sent_prompt) &&
    input.changed_file_paths_summary.some((file) => /package-lock|pnpm-lock|schema|config/i.test(file)) &&
    input.changed_files_count >= 3

  const detection_flags = {
    retry_pattern: retryPattern,
    error_detected: errorDetected,
    scope_drift: scopeDrift,
    possible_vagueness: possibleVagueness,
    looping_behavior: loopingBehavior,
    overreach_detected: overreachDetected
  }

  const issueCount = Object.values(detection_flags).filter(Boolean).length
  const probable_status =
    issueCount === 0 ? "SUCCESS" : errorDetected || loopingBehavior ? "FAILURE" : "UNKNOWN"
  const should_suggest_diagnosis =
    retryPattern || errorDetected || loopingBehavior || scopeDrift || overreachDetected

  const concise_issue =
    errorDetected
      ? "Visible error detected."
      : loopingBehavior
        ? "Repeated retries suggest the agent is stuck."
        : scopeDrift
          ? "Changes look broader than the request."
          : possibleVagueness
            ? "The output looks generic for a specific request."
            : null

  const success_reasons =
    probable_status === "SUCCESS"
      ? ["No visible error", "No retry pattern detected", "No broad-scope warning triggered"]
      : []

  return {
    outcome_event_id: `outcome-${Date.now()}`,
    detection_flags,
    probable_status,
    should_suggest_diagnosis,
    success_reasons,
    concise_issue
  }
}
