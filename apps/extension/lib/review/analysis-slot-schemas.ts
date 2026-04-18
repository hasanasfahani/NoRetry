import type { AnalysisArtifactFamily } from "./analysis-artifact-family"

export type AnalysisSlotSchema = {
  id: string
  label: string
  section: "taskGoal" | "requirements" | "constraints" | "acceptanceCriteria" | "actualOutputToEvaluate"
  importance: number
  keywords: string[]
}

const SOFTWARE_PROMPT_SLOTS: AnalysisSlotSchema[] = [
  { id: "task_goal", label: "Task goal", section: "taskGoal", importance: 100, keywords: ["build", "implement", "create", "write", "generate"] },
  { id: "target_artifact", label: "Target artifact", section: "actualOutputToEvaluate", importance: 94, keywords: ["component", "page", "endpoint", "function", "prompt", "plan", "spec"] },
  { id: "file_scope", label: "Files or scope", section: "constraints", importance: 92, keywords: ["file", "files", "component", "page", "route", "module", "folder"] },
  { id: "change_scope", label: "Scope boundaries", section: "constraints", importance: 90, keywords: ["only change", "do not change", "preserve", "scope", "touch"] },
  { id: "acceptance", label: "Acceptance criteria", section: "acceptanceCriteria", importance: 96, keywords: ["acceptance", "definition of complete", "works when", "must pass"] },
  { id: "output_format", label: "Output format", section: "actualOutputToEvaluate", importance: 88, keywords: ["return", "output", "format", "code only", "diff", "patch"] },
  { id: "proof", label: "Proof or validation", section: "acceptanceCriteria", importance: 98, keywords: ["test", "verify", "proof", "smoke", "regression", "validate"] }
]

const BUG_FIX_SLOTS: AnalysisSlotSchema[] = [
  { id: "problem", label: "Problem", section: "taskGoal", importance: 100, keywords: ["bug", "issue", "broken", "error", "fails", "not working"] },
  { id: "expected_behavior", label: "Expected behavior", section: "acceptanceCriteria", importance: 98, keywords: ["expected", "should", "instead", "goal"] },
  { id: "actual_behavior", label: "Actual behavior", section: "requirements", importance: 98, keywords: ["actual", "currently", "instead", "observed"] },
  { id: "environment", label: "Environment", section: "constraints", importance: 84, keywords: ["browser", "device", "framework", "environment", "version"] },
  { id: "repro", label: "Reproduction steps", section: "requirements", importance: 92, keywords: ["repro", "steps", "when", "after clicking", "on load"] },
  { id: "proof", label: "Fix proof", section: "acceptanceCriteria", importance: 100, keywords: ["prove", "test", "verify", "smoke", "regression"] }
]

const IMPLEMENTATION_PLAN_SLOTS: AnalysisSlotSchema[] = [
  { id: "goal", label: "Goal", section: "taskGoal", importance: 100, keywords: ["goal", "objective", "build", "ship"] },
  { id: "steps", label: "Implementation steps", section: "requirements", importance: 94, keywords: ["steps", "plan", "sequence", "phases"] },
  { id: "dependencies", label: "Dependencies", section: "constraints", importance: 82, keywords: ["dependency", "dependencies", "before", "needs"] },
  { id: "risks", label: "Risks", section: "constraints", importance: 88, keywords: ["risk", "blocker", "concern"] },
  { id: "done", label: "Done condition", section: "acceptanceCriteria", importance: 96, keywords: ["done", "definition of complete", "success", "ship"] }
]

const SPEC_SLOTS: AnalysisSlotSchema[] = [
  { id: "goal", label: "Goal", section: "taskGoal", importance: 100, keywords: ["goal", "objective", "task"] },
  { id: "requirements", label: "Requirements", section: "requirements", importance: 96, keywords: ["requirements", "must", "include"] },
  { id: "constraints", label: "Constraints", section: "constraints", importance: 94, keywords: ["constraint", "avoid", "limit", "only"] },
  { id: "acceptance", label: "Acceptance criteria", section: "acceptanceCriteria", importance: 100, keywords: ["acceptance", "definition of complete", "success"] },
  { id: "output", label: "Output format", section: "actualOutputToEvaluate", importance: 90, keywords: ["output", "return", "format", "table", "json"] }
]

const RECIPE_SLOTS: AnalysisSlotSchema[] = [
  { id: "servings", label: "Serving count", section: "constraints", importance: 92, keywords: ["serving", "person", "serves"] },
  { id: "time", label: "Time limit", section: "constraints", importance: 90, keywords: ["minutes", "min", "time"] },
  { id: "ingredients", label: "Ingredients", section: "actualOutputToEvaluate", importance: 88, keywords: ["ingredients"] },
  { id: "steps", label: "Instructions", section: "actualOutputToEvaluate", importance: 90, keywords: ["instructions", "step-by-step", "method"] },
  { id: "macros", label: "Macros and calories", section: "acceptanceCriteria", importance: 88, keywords: ["macros", "calories", "protein"] }
]

const EMAIL_SLOTS: AnalysisSlotSchema[] = [
  { id: "subject", label: "Subject line", section: "actualOutputToEvaluate", importance: 90, keywords: ["subject"] },
  { id: "reason", label: "Reason", section: "requirements", importance: 90, keywords: ["reason", "because"] },
  { id: "times", label: "Time options", section: "requirements", importance: 94, keywords: ["time", "utc", "option"] },
  { id: "confirmation", label: "Confirmation ask", section: "acceptanceCriteria", importance: 92, keywords: ["confirm", "confirmation"] },
  { id: "calendar", label: "Calendar update", section: "acceptanceCriteria", importance: 88, keywords: ["calendar", "invite"] }
]

export function getAnalysisSlotSchemas(family: AnalysisArtifactFamily): AnalysisSlotSchema[] {
  switch (family) {
    case "prompt_for_coding_tool":
    case "code_change":
      return SOFTWARE_PROMPT_SLOTS
    case "bug_fix":
    case "verification":
      return BUG_FIX_SLOTS
    case "implementation_plan":
      return IMPLEMENTATION_PLAN_SLOTS
    case "spec":
      return SPEC_SLOTS
    case "recipe":
      return RECIPE_SLOTS
    case "email":
      return EMAIL_SLOTS
    default:
      return SPEC_SLOTS
  }
}
