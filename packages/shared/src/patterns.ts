import type { DiagnoseFailureRequest } from "./schemas"

export type PatternKey =
  | "vague_prompt"
  | "missing_constraints"
  | "too_broad_task"
  | "scope_drift"
  | "execution_error"
  | "repeated_retry_loop"
  | "ambiguous_intent"

export function derivePatternKey(input: DiagnoseFailureRequest): PatternKey {
  if (input.error_summary || input.detection_flags.error_detected) return "execution_error"
  if (input.detection_flags.looping_behavior) return "repeated_retry_loop"
  if (input.detection_flags.scope_drift) return "scope_drift"
  if (input.detection_flags.overreach_detected) return "too_broad_task"
  if (input.detection_flags.possible_vagueness) return "vague_prompt"
  if (input.prompt_intent === "OTHER") return "ambiguous_intent"
  return "missing_constraints"
}

export const DEFAULT_PATTERN_TEMPLATES: Record<PatternKey, Omit<import("./schemas").DiagnoseFailureResponse, "token_estimate">> = {
  vague_prompt: {
    why_it_likely_failed: ["The request was specific, but the wording left room for a generic response."],
    what_the_ai_likely_misunderstood: "It likely understood the theme of the ask, not the exact deliverable or constraints.",
    what_to_fix_next_time: [
      "Name the exact file or surface to change.",
      "State the expected output format.",
      "Add one constraint about what not to touch."
    ],
    improved_retry_prompt: "Update only the named file/component, keep the scope narrow, and return the exact change needed for the requested behavior.",
    source_type: "CACHE"
  },
  missing_constraints: {
    why_it_likely_failed: ["The task was underspecified, so the agent had to guess boundaries."],
    what_the_ai_likely_misunderstood: "It likely assumed a broader scope or different success criteria than you intended.",
    what_to_fix_next_time: [
      "Say what success looks like.",
      "Add a boundary such as only one file or one behavior.",
      "Mention any existing code or constraint to preserve."
    ],
    improved_retry_prompt: "Make the smallest change needed, preserve existing behavior outside this scope, and explain your plan before editing.",
    source_type: "CACHE"
  },
  too_broad_task: {
    why_it_likely_failed: ["The request was simple, but the resulting actions expanded into a larger refactor."],
    what_the_ai_likely_misunderstood: "It likely interpreted the task as permission to restructure adjacent parts of the app.",
    what_to_fix_next_time: [
      "Limit the agent to a file or directory.",
      "Say no refactors unless required.",
      "Ask for a minimal patch only."
    ],
    improved_retry_prompt: "Only make the minimum patch required for this task. Do not refactor unrelated files, rename modules, or change configs unless strictly necessary.",
    source_type: "CACHE"
  },
  scope_drift: {
    why_it_likely_failed: ["The visible file changes suggest the agent moved beyond the likely intended scope."],
    what_the_ai_likely_misunderstood: "It likely treated related files as part of the task even though the ask was narrower.",
    what_to_fix_next_time: [
      "Name the exact files it may edit.",
      "Add a line saying leave other files untouched.",
      "Ask for a short plan first if the change might spread."
    ],
    improved_retry_prompt: "Restrict edits to the specified files only. If additional files seem necessary, stop and explain why before changing them.",
    source_type: "CACHE"
  },
  execution_error: {
    why_it_likely_failed: ["A visible run, build, or test error interrupted the task."],
    what_the_ai_likely_misunderstood: "It likely missed the real failure point or changed code without validating the broken path.",
    what_to_fix_next_time: [
      "Include the exact error message or failing command.",
      "Ask it to debug before attempting broader fixes.",
      "Request a minimal root-cause fix plus verification steps."
    ],
    improved_retry_prompt: "Debug this specific error first, explain the root cause in one sentence, then make the smallest fix and verify the failing path.",
    source_type: "CACHE"
  },
  repeated_retry_loop: {
    why_it_likely_failed: ["Repeated retries suggest the agent is reusing the same wrong assumptions."],
    what_the_ai_likely_misunderstood: "It likely keeps optimizing around symptoms instead of the actual constraint or failure mode.",
    what_to_fix_next_time: [
      "Mention what already failed.",
      "Tell it what approach not to repeat.",
      "Restate the expected final behavior."
    ],
    improved_retry_prompt: "Do not repeat the previous approach. The last attempts did not solve the issue. Re-evaluate the root cause, keep scope minimal, and verify the requested behavior.",
    source_type: "CACHE"
  },
  ambiguous_intent: {
    why_it_likely_failed: ["The request did not clearly signal whether you wanted a plan, explanation, or implementation."],
    what_the_ai_likely_misunderstood: "It likely picked the wrong mode of help for the prompt.",
    what_to_fix_next_time: [
      "Start with a verb like build, debug, refactor, explain, or plan.",
      "Name the expected deliverable.",
      "Add one success criterion."
    ],
    improved_retry_prompt: "Intent: build/debug/refactor/explain. Complete that exact job only, keep the response concise, and target the specified deliverable.",
    source_type: "CACHE"
  }
}
