import type { PromptIntent } from "./schemas"

const INTENT_RULES: Array<{ intent: PromptIntent; patterns: RegExp[] }> = [
  { intent: "DEBUG", patterns: [/\bfix\b/i, /\bdebug\b/i, /\berror\b/i, /\bfailing\b/i, /\bbug\b/i] },
  { intent: "REFACTOR", patterns: [/\brefactor\b/i, /\bclean up\b/i, /\brestructure\b/i, /\bimprove code\b/i] },
  { intent: "DESIGN_UI", patterns: [/\bui\b/i, /\bux\b/i, /\bdesign\b/i, /\blanding page\b/i, /\bstyle\b/i] },
  { intent: "EXPLAIN", patterns: [/\bexplain\b/i, /\bwhy\b/i, /\bwalk me through\b/i, /\bteach\b/i] },
  { intent: "PLAN", patterns: [/\bplan\b/i, /\broadmap\b/i, /\bscope\b/i, /\bsteps\b/i, /\bmilestone\b/i] },
  { intent: "BUILD", patterns: [/\bbuild\b/i, /\bcreate\b/i, /\bimplement\b/i, /\badd\b/i, /\bship\b/i] }
]

export function detectIntent(prompt: string): PromptIntent {
  const normalized = prompt.trim()
  if (!normalized) return "OTHER"

  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return rule.intent
    }
  }

  return "OTHER"
}
