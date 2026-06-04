import { DETECTION_THRESHOLDS } from "./constants"
import type { AnalyzePromptResponse, SessionSummary, StrengthScore } from "./schemas"
import { detectIntent } from "./intent"

function hasAny(prompt: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(prompt))
}

function dedupe(items: string[]) {
  return [...new Set(items)].slice(0, 4)
}

export function buildPromptFromAnswers(
  originalPrompt: string,
  answers: Record<string, string | string[]>
) {
  const lines = [originalPrompt.trim()]

  if (typeof answers.target_area === "string" && answers.target_area) {
    lines.push(`Target area: ${answers.target_area}.`)
  }

  if (Array.isArray(answers.constraints) && answers.constraints.length) {
    lines.push(`Constraints: ${answers.constraints.join(", ")}.`)
  }

  if (typeof answers.success === "string" && answers.success) {
    lines.push(`Success means: ${answers.success}.`)
  }

  if (typeof answers.error_detail === "string" && answers.error_detail.trim()) {
    lines.push(`Observed issue: ${answers.error_detail.trim()}.`)
  }

  if (typeof answers.ui_scope === "string" && answers.ui_scope) {
    lines.push(`Focus on: ${answers.ui_scope}.`)
  }

  lines.push("Keep the solution scoped, avoid unrelated changes, and explain any assumption before editing.")

  return lines.join(" ").replace(/\s+/g, " ").trim()
}

export function analyzePromptLocally(prompt: string, sessionSummary?: Partial<SessionSummary>): AnalyzePromptResponse {
  const trimmed = prompt.trim()

  if (!trimmed) {
    return {
      score: "LOW",
      intent: "OTHER",
      missing_elements: ["State the task you want Replit Agent to complete."],
      suggestions: ["Add the goal, files involved, and what success looks like."],
      rewrite: null,
      clarification_questions: [],
      draft_prompt: null,
      question_source: "NONE",
      ai_available: false
    }
  }

  const intent = detectIntent(trimmed)
  const informationalPrompt = hasAny(trimmed, [
    /\bsummar(?:ize|y)\b/i,
    /\boverview\b/i,
    /\bbrief\b/i,
    /\brecap\b/i,
    /\bkey points?\b/i,
    /\bshort summary\b/i,
    /\bexplain\b/i,
    /\bclarify\b/i
  ])
  const writingPrompt = hasAny(trimmed, [
    /\brewrite\b/i,
    /\bpolish\b/i,
    /\bdraft\b/i,
    /\bemail\b/i,
    /\bmessage\b/i,
    /\bcover letter\b/i,
    /\bcaption\b/i,
    /\bbio\b/i
  ])
  const missing: string[] = []
  const suggestions: string[] = []
  let points = 0

  if (trimmed.length >= 30) points += 1
  if (trimmed.length >= 120) points += 1
  if (trimmed.length >= DETECTION_THRESHOLDS.longPromptChars) points -= 1

  if (informationalPrompt) {
    if (hasAny(trimmed, [/\bproject\b/i, /\bfeature\b/i, /\btopic\b/i, /\bissue\b/i, /\bflow\b/i, /\bscreen\b/i])) {
      points += 1
    } else {
      missing.push("What topic or area should be summarized or explained")
      suggestions.push("Name the project, feature, topic, or area the answer should focus on.")
    }

    if (hasAny(trimmed, [/\bshort\b/i, /\bbrief\b/i, /\bbullet\b/i, /\bparagraph\b/i, /\bkey points?\b/i])) {
      points += 1
    } else {
      missing.push("Preferred summary format or depth")
      suggestions.push("Say whether you want a short paragraph, bullets, or key points only.")
    }
  } else if (writingPrompt) {
    if (hasAny(trimmed, [/\btone\b/i, /\baudience\b/i, /\bshort\b/i, /\blength\b/i, /\bprofessional\b/i])) {
      points += 1
    } else {
      missing.push("Tone, audience, or length preference")
      suggestions.push("Add the tone, audience, or length so the writing matches your goal.")
    }
  } else if (hasAny(trimmed, [/\bfile\b/i, /\bcomponent\b/i, /\broute\b/i, /\bfunction\b/i, /\bscreen\b/i])) {
    points += 1
  } else {
    missing.push("Relevant file, component, or area to change")
    suggestions.push("Name the file, route, component, or surface Replit should touch.")
  }

  if (informationalPrompt) {
    if (hasAny(trimmed, [/\bdo not\b/i, /\bkeep\b/i, /\bonly\b/i, /\bavoid\b/i, /\bwithout\b/i, /\bfocus on\b/i])) {
      points += 1
    }
  } else if (hasAny(trimmed, [/\bdo not\b/i, /\bkeep\b/i, /\bonly\b/i, /\bavoid\b/i, /\bwithout\b/i])) {
    points += 1
  } else {
    missing.push("Constraints or boundaries")
    suggestions.push("Add one or two limits so the agent does not overreach.")
  }

  if (informationalPrompt) {
    if (hasAny(trimmed, [/\bparagraph\b/i, /\bbullets?\b/i, /\bkey points?\b/i, /\bshort\b/i, /\bbrief\b/i])) {
      points += 1
    }
  } else if (hasAny(trimmed, [/\bsuccess\b/i, /\bshould\b/i, /\bexpected\b/i, /\bresult\b/i])) {
    points += 1
  } else {
    missing.push("Expected outcome")
    suggestions.push("Say what a correct result looks like or how to verify it.")
  }

  if (intent === "DEBUG" && !hasAny(trimmed, [/\berror\b/i, /\btrace\b/i, /\bfails\b/i, /\brepro\b/i])) {
    missing.push("Observed bug, error, or reproduction detail")
  }

  if (intent === "BUILD" && !hasAny(trimmed, [/\buser\b/i, /\bflow\b/i, /\bcta\b/i, /\bfeature\b/i])) {
    missing.push("User-facing behavior")
  }

  if (sessionSummary?.lastIssueDetected && !hasAny(trimmed, [/\blast attempt\b/i, /\bprevious\b/i, /\bthis time\b/i])) {
    suggestions.push("Mention what failed last attempt so Replit can avoid repeating it.")
  }

  const score: StrengthScore = points >= 4 ? "HIGH" : points >= 2 ? "MID" : "LOW"
  const conciseRewrite = [
    `Intent: ${intent}.`,
    trimmed,
    missing.length ? `Include: ${dedupe(missing).join("; ")}.` : "",
    "Keep changes scoped and explain any assumptions."
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 500)

  const draftPrompt = buildPromptFromAnswers(trimmed, {})

  return {
    score,
    intent,
    missing_elements: dedupe(missing),
    suggestions: dedupe(suggestions),
    rewrite: score === "HIGH" ? null : conciseRewrite,
    clarification_questions: [],
    draft_prompt: draftPrompt,
    question_source: "FALLBACK",
    ai_available: false
  }
}
