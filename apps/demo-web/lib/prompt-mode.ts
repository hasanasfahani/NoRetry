import type { AnalyzePromptResponse, ClarificationQuestion } from "@prompt-optimizer/shared"

const OTHER_OPTION = "Other"

function stripTrailingPunctuation(value: string) {
  return value.trim().replace(/[.:;\s]+$/, "")
}

function normalizeBulletText(value: string) {
  const trimmed = stripTrailingPunctuation(value)
  if (!trimmed) return ""
  return /[.!?]$/.test(value.trim()) ? value.trim() : `${trimmed}.`
}

function normalizeExclusionTarget(value: string) {
  const trimmed = value
    .toLowerCase()
    .replace(/\b(?:and|or|but|while|that|which|keep|with|for|to|so|because)\b.*$/i, "")
    .replace(/\b(?:ingredient|ingredients|item|items)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()

  return trimmed
}

function pluralizeConstraintTarget(value: string) {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return ""
  if (trimmed.endsWith("ies") || trimmed.endsWith("oes")) return trimmed
  if (trimmed.endsWith("y") && !/[aeiou]y$/.test(trimmed)) return `${trimmed.slice(0, -1)}ies`
  if (trimmed.endsWith("o")) return `${trimmed}es`
  if (trimmed.endsWith("s")) return trimmed
  return `${trimmed}s`
}

function preferredExclusionTarget(value: string) {
  const normalizedTarget = normalizeExclusionTarget(value)
  if (!normalizedTarget) return ""
  if (/\b(?:dairy|gluten|soy)\b/.test(normalizedTarget) && !normalizedTarget.includes(" ")) return normalizedTarget
  if (!normalizedTarget.includes(" ")) return pluralizeConstraintTarget(normalizedTarget)
  return normalizedTarget
}

function splitIngredientList(value: string) {
  return value
    .split(/,|\/|\band\b/gi)
    .map((item) => normalizeExclusionTarget(item))
    .filter(Boolean)
}

function extractExclusionTargets(text: string) {
  const extracted = new Set<string>()
  const source = text.replace(/[()\n]/g, " ")
  const patterns = [
    /\b(?:without|no|exclude|excluding|avoid)\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,3})/gi,
    /\bdo not use\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,3})/gi,
    /\b([a-z][a-z-]*)-free\b/gi
  ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const target = normalizeExclusionTarget(match[1] ?? "")
      if (target) extracted.add(target)
    }
  }

  const dislikePatterns = [
    /\b(?:any\s+ingredients\s+you\s+dislike\??|ingredients\s+you\s+dislike\??|disliked\s+ingredients?\??|ingredients\s+to\s+avoid\??|avoid(?:ing)?\s+ingredients?\??)\s*[:\-]\s*([^\n.]+)/gi
  ]

  for (const pattern of dislikePatterns) {
    for (const match of source.matchAll(pattern)) {
      for (const item of splitIngredientList(match[1] ?? "")) {
        extracted.add(item)
      }
    }
  }

  return [...extracted]
}

function formatExplicitExclusionConstraint(target: string) {
  const normalizedTarget = preferredExclusionTarget(target)
  if (!normalizedTarget) return ""

  if (/\b(?:dairy|nut|egg|gluten|soy)\b/.test(normalizedTarget) && !normalizedTarget.includes(" ")) {
    return `Keep it ${normalizedTarget}-free.`
  }

  return `Do not use ${normalizedTarget}.`
}

function dedupeCaseInsensitive(items: string[]) {
  const seen = new Set<string>()
  const output: string[] = []
  for (const item of items.map((entry) => entry.trim()).filter(Boolean)) {
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(item)
  }
  return output
}

function looksLikeOutputFormatHint(value: string) {
  const normalized = value.toLowerCase()
  return /step-by-step|steps|ingredients|quantities|html|css|javascript|json|table|bullets|outline|calories|per serving|format|output|list only/.test(
    normalized
  )
}

function looksLikeStyleHint(value: string) {
  const normalized = value.toLowerCase()
  return /clean|polished|professional|readable|realistic|natural|home kitchen|weekday|usable|starter|clear|concise/.test(normalized)
}

function isGenericStyleGuardrail(value: string) {
  const normalized = value.toLowerCase().replace(/\s+/g, " ").trim()
  return (
    normalized === "keep the request clear, specific, and easy for the ai assistant to follow." ||
    normalized === "keep the request clear, specific, and easy for the ai assistant to follow"
  )
}

function looksLikeConstraint(value: string) {
  const normalized = value.toLowerCase()
  return /no |without |exclude|only|under |less|stovetop|minutes?|servings?|for \d+|limit|keep|must|do not|avoid|[a-z-]+-free/.test(
    normalized
  )
}

function buildSection(title: string, items: string[]) {
  if (!items.length) return ""
  return `${title}:\n${items.map((item) => `- ${normalizeBulletText(item)}`).join("\n")}`
}

function buildFallbackQuestionOptions(intent: AnalyzePromptResponse["intent"]) {
  switch (intent) {
    case "DEBUG":
      return {
        label: "What should the next step confirm first?",
        helper: "Pick the first runtime checkpoint the next prompt should verify before changing more code.",
        options: ["The extension loads", "The content script attaches", "The target element is detected", "The UI renders visibly", OTHER_OPTION]
      }
    case "BUILD":
      return {
        label: "What matters most in the first draft?",
        helper: "Pick the first quality bar the next prompt should optimize for.",
        options: ["Correct structure first", "Requested format first", "Usable starter content", "Minimal starter only", OTHER_OPTION]
      }
    case "EXPLAIN":
      return {
        label: "What should the next answer optimize first?",
        helper: "Pick the most important quality bar for the next explanation.",
        options: ["Direct answer first", "Clear steps", "Stronger examples", "Tighter scope", OTHER_OPTION]
      }
    default:
      return {
        label: "What should the next prompt lock down first?",
        helper: "Pick the first thing the next prompt should make explicit.",
        options: ["Exact output", "Key constraint", "Success criteria", "Scope limit", OTHER_OPTION]
      }
  }
}

function extractPromptSignals(prompt: string) {
  const normalized = prompt.trim()
  const lower = normalized.toLowerCase()
  const keyRequirements: string[] = []
  const constraints: string[] = []
  const requiredInputs: string[] = []
  const outputFormat: string[] = []
  const style: string[] = []

  if (/\bhtml\b/i.test(normalized)) keyRequirements.push("Use HTML.")
  if (/\bcss\b/i.test(normalized)) keyRequirements.push("Include CSS.")
  if (/\bjavascript\b|\bjs\b/i.test(normalized)) keyRequirements.push("Include JavaScript only if needed.")
  if (/\bcv\b|\bresume\b/i.test(normalized)) keyRequirements.push("Keep the output focused on a basic CV website starter.")

  const servingMatch = normalized.match(/(\d+)[-\s]?servings?/i)
  if (servingMatch) constraints.push(`Make it for ${servingMatch[1]} servings.`)

  const minuteMatch = normalized.match(/(\d+)[-\s]?minute/i)
  if (minuteMatch) constraints.push(`Keep it to ${minuteMatch[1]} minutes or less.`)

  if (/\bstovetop\b/i.test(normalized)) constraints.push("Use stovetop only.")
  if (/\blow[-\s]?carb\b/i.test(normalized)) constraints.push("Keep it low-carb.")
  for (const target of extractExclusionTargets(normalized)) {
    const formatted = formatExplicitExclusionConstraint(target)
    if (formatted) constraints.push(formatted)
  }

  if (/\bingredients?\b/i.test(lower)) outputFormat.push("Include ingredients with quantities.")
  if (/step[-\s]?by[-\s]?step|instructions/i.test(lower)) outputFormat.push("Include step-by-step instructions.")
  if (/calories?\s+per\s+serving|list only the total calories per serving/i.test(lower)) {
    outputFormat.push("List only the total calories per serving.")
  }

  if (/\bmeal\b|\brecipe\b|\blunch\b|\bdinner\b/i.test(lower)) {
    requiredInputs.push("Assume a normal home kitchen unless the prompt says otherwise.")
    style.push("Keep it practical for real weekday use.")
  }

  if (/\bprofessional\b/i.test(lower)) style.push("Use a professional tone.")
  if (/\bpolished\b/i.test(lower)) style.push("Keep the output polished and presentation-ready.")
  if (/\bbasic\b/i.test(lower)) style.push("Keep the result simple and easy to use.")

  return {
    keyRequirements: dedupeCaseInsensitive(keyRequirements),
    constraints: dedupeCaseInsensitive(constraints),
    requiredInputs: dedupeCaseInsensitive(requiredInputs),
    outputFormat: dedupeCaseInsensitive(outputFormat),
    style: dedupeCaseInsensitive(style)
  }
}

function buildIntentDefaults(intent: AnalyzePromptResponse["intent"]) {
  switch (intent) {
    case "DEBUG":
      return {
        outputFormat: ["Show the next diagnostic or fix path clearly."],
        style: ["Keep the scope narrow and testable."]
      }
    case "BUILD":
      return {
        outputFormat: ["Return something directly usable as a strong first draft."],
        style: ["Keep the result clean, practical, and easy to build from."]
      }
    case "EXPLAIN":
      return {
        outputFormat: ["Organize the answer so it is easy to follow."],
        style: ["Use direct, natural wording instead of filler."]
      }
    default:
      return {
        outputFormat: [],
        style: []
      }
  }
}

export function buildPromptModeFallbackQuestions(params: {
  promptText: string
  localAnalysis: AnalyzePromptResponse
}) {
  const { promptText, localAnalysis } = params
  const promptSnippet = promptText.trim().slice(0, 72)
  const template = buildFallbackQuestionOptions(localAnalysis.intent)
  const question: ClarificationQuestion = {
    id: `prompt-${crypto.randomUUID()}`,
    label: template.label,
    helper: `${template.helper} Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
    mode: "single",
    options: template.options
  }

  return {
    questionHistory: [question]
  }
}

export function formatPromptModeStructuredDraft(params: {
  sourcePrompt: string
  planningGoal: string
  refinedPrompt: string
  localAnalysis: AnalyzePromptResponse
  answeredPath: string[]
  constraints: string[]
}) {
  const { sourcePrompt, planningGoal, refinedPrompt, localAnalysis, answeredPath, constraints } = params
  const promptSignals = extractPromptSignals(sourcePrompt)
  const intentDefaults = buildIntentDefaults(localAnalysis.intent)

  const taskLine = normalizeBulletText(refinedPrompt || planningGoal || sourcePrompt)

  const keyRequirements = dedupeCaseInsensitive([
    ...answeredPath.filter((item) => !looksLikeConstraint(item) && !looksLikeOutputFormatHint(item) && !looksLikeStyleHint(item)),
    ...promptSignals.keyRequirements
  ]).map(normalizeBulletText)

  const preservedConstraints = dedupeCaseInsensitive([
    ...constraints,
    ...answeredPath.filter((item) => looksLikeConstraint(item)),
    ...promptSignals.constraints
  ]).map(normalizeBulletText)

  const requiredInputs = dedupeCaseInsensitive(promptSignals.requiredInputs).map(normalizeBulletText)

  const outputFormat = dedupeCaseInsensitive([
    ...answeredPath.filter((item) => looksLikeOutputFormatHint(item)),
    ...promptSignals.outputFormat,
    ...intentDefaults.outputFormat
  ]).map(normalizeBulletText)

  const style = dedupeCaseInsensitive([
    ...answeredPath.filter((item) => looksLikeStyleHint(item)),
    ...promptSignals.style,
    ...intentDefaults.style
  ])
    .filter((item) => !isGenericStyleGuardrail(item))
    .map(normalizeBulletText)

  return [
    `Task / goal:\n${taskLine}`,
    buildSection("Key requirements", keyRequirements),
    buildSection("Constraints", preservedConstraints),
    buildSection("Required inputs or ingredients", requiredInputs),
    buildSection("Output format", outputFormat),
    buildSection("Quality bar / style guardrails", style)
  ]
    .filter(Boolean)
    .join("\n\n")
}
