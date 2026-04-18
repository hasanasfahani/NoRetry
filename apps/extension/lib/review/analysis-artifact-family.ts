import type { GoalContract } from "../goal/types"
import type { ReviewTaskType } from "./services/review-task-type"

export type AnalysisArtifactFamily =
  | "prompt_for_coding_tool"
  | "bug_fix"
  | "code_change"
  | "implementation_plan"
  | "spec"
  | "verification"
  | "email"
  | "recipe"
  | "code"
  | "rewrite"
  | "plan"
  | "schedule_program"
  | "research_summary"
  | "debug"
  | "generic_text"

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function familyFromGoalContract(goalContract: GoalContract | null) {
  const deliverable = goalContract?.deliverableType?.toLowerCase() ?? ""
  if (deliverable === "recipe") return "recipe" as const
  if (deliverable === "html_file") return "code" as const
  if (deliverable === "rewrite") return "rewrite" as const
  if (deliverable === "research") return "research_summary" as const
  if (deliverable === "plan") return "implementation_plan" as const
  return null
}

export function detectAnalysisArtifactFamily(params: {
  promptText: string
  responseText?: string
  goalContract?: GoalContract | null
  taskFamily?: ReviewTaskType | string
}): AnalysisArtifactFamily {
  const prompt = normalize(params.promptText)
  const response = normalize(params.responseText ?? "")
  const familyFromGoal = familyFromGoalContract(params.goalContract ?? null)
  if (familyFromGoal) return familyFromGoal

  if (/\bwrite\b.+\bprompt\b|\bsend-ready coding prompt\b|\bprompt for (?:a )?coding tool\b/.test(prompt) && /\bcursor\b|\bclaude\b|\breplit\b|\bcoding tool\b|\bvibe coding\b/.test(prompt)) {
    return "prompt_for_coding_tool"
  }

  if (params.taskFamily === "verification") return "verification"
  if (params.taskFamily === "debug") return "bug_fix"

  const combined = `${prompt} ${response}`
  const softwareSignals = /\breact\b|\bnext\.?js\b|\btypescript\b|\bjavascript\b|\bpython\b|\bapi\b|\bendpoint\b|\bcomponent\b|\bpage\b|\broute\b|\bcss\b|\bhtml\b|\bfile\b|\bfiles\b|\btest\b|\bprompt\b|\breplit\b|\bcursor\b|\bclaude\b|\bbolt\b/.test(combined)
  if (/\bverify\b|\bvalidation\b|\bsmoke test\b|\bregression\b/.test(prompt) && softwareSignals) return "verification"
  if (/\bbug\b|\bfix\b|\berror\b|\bbroken\b|\bissue\b|\bnot working\b/.test(prompt) && softwareSignals) return "bug_fix"
  if (/\bimplementation plan\b|\brollout plan\b|\bplan the implementation\b|\bphases?\b|\broadmap\b/.test(prompt) && softwareSignals) return "implementation_plan"
  if (/\bspec\b|\brequirements?\b|\bacceptance criteria\b|\bdefinition of complete\b/.test(prompt) && softwareSignals) return "spec"
  if (/\bprompt\b/.test(prompt) && /\bcursor\b|\bclaude\b|\breplit\b|\bvibe coding\b|\bcoding tool\b/.test(prompt)) return "prompt_for_coding_tool"
  if (/\bmodify\b|\bupdate\b|\bchange\b|\brefactor\b|\bonly change\b|\bdo not change\b/.test(prompt) && softwareSignals) return "code_change"
  if (softwareSignals && /\bbuild\b|\bimplement\b|\bcreate\b|\bwrite\b|\bgenerate\b/.test(prompt)) return "prompt_for_coding_tool"
  if (/\bsubject:\b|\bdear team\b|\bdear all\b|\bemail\b|\bmeeting\b/.test(combined)) return "email"
  if (/\brecipe\b|\bingredients\b|\bcalories\b|\bmacros?\b|\bserving\b|\blunch\b|\bdinner\b/.test(combined)) return "recipe"
  if (/\bhtml\b|\bcss\b|\bjavascript\b|<!doctype html>|<html\b|```(?:html|css|js|ts|tsx)/.test(combined)) return "code"
  if (/\brewrite\b|\brephrase\b|\bmake this sound\b/.test(prompt)) return "rewrite"
  if (/\bprogram\b|\bplan\b|\bstrategy\b|\broadmap\b|\bchecklist\b/.test(prompt)) {
    if (/\bday\b|\bweek\b|\bsession\b|\bworkout\b|\bgym\b/.test(prompt)) return "schedule_program"
    return "plan"
  }
  if (/\bresearch\b|\bsources?\b|\bcitations?\b/.test(combined)) return "research_summary"
  return "generic_text"
}
