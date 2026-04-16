import type { AfterAnalysisResult, ResponsePreprocessorOutput, Stage1Output, Stage2Output, VerdictOutput } from "@prompt-optimizer/shared/src/schemas"
import type { ReviewTarget } from "../types"
import { isAnswerQualityTask, looksLikeAdviceRequestPrompt, looksLikeCreationRequestPrompt } from "./review-task-type"

export type ReviewAnalysisInput = {
  target: ReviewTarget
  mode: "quick" | "deep"
  quickBaseline: AfterAnalysisResult | null
}

export type ReviewAnalysisRunner = (input: ReviewAnalysisInput) => Promise<AfterAnalysisResult>

type CreateReviewAnalysisRunnerInput = {
  analyzeAfterAttempt: (input: {
    attempt: ReviewTarget["attempt"]
    response_summary: unknown
    response_text_fallback: string
    deep_analysis: boolean
    project_context: string
    current_state: string
    error_summary: string
    changed_file_paths_summary: string[]
  }) => Promise<AfterAnalysisResult>
  attachAnalysisResult: (
    attemptId: string,
    responseText: string,
    analysis: AfterAnalysisResult,
    responseMessageId?: string | null
  ) => Promise<unknown>
  preprocessResponse: (responseText: string) => unknown
  getProjectMemoryContext: () => {
    projectContext: string
    currentState: string
  }
  collectChangedFilesSummary: () => string[]
  collectVisibleErrorSummary: () => string
}

type RuntimeSignal = {
  label: string
  patterns: RegExp[]
  verified: boolean
}

const GOAL_STOPWORDS = new Set([
  "the",
  "this",
  "that",
  "with",
  "from",
  "into",
  "your",
  "their",
  "there",
  "please",
  "latest",
  "request",
  "response",
  "answer",
  "issue"
])

const WEAK_GOAL_PATTERNS = [
  /^solve(?: it| this| the problem)?$/i,
  /^fix(?: it| this| the problem)?$/i,
  /^make it work$/i,
  /^make it better$/i,
  /^handle it$/i,
  /^improve it$/i,
  /^solve the requested task$/i,
  /^the user's latest request$/i,
  /^the user’s latest request$/i
]

const PROMPT_ARTIFACT_SECTION_PATTERNS = [
  /task\s*\/\s*goal:/i,
  /key requirements:/i,
  /constraints:/i,
  /required inputs?(?: or ingredients)?:/i,
  /output format:/i,
  /quality bar\s*\/\s*style guardrails:/i,
  /style:/i,
  /requirements:/i,
  /output:/i
]

const PROMPT_ARTIFACT_CONTROL_PATTERNS = [
  /\bconstraints?:/i,
  /\bkey requirements?:/i,
  /\brequired inputs?(?: or ingredients)?:/i,
  /\boutput format:/i,
  /\bstyle:/i,
  /\btone:/i,
  /\bquality bar/i,
  /\bguardrails?:/i,
  /\breturn only\b/i,
  /\breturn\b.*\bonly\b/i,
  /\binclude\b/i,
  /\bpreserve\b/i,
  /\bavoid\b/i,
  /\bcode only\b/i
]

const PROMPT_ARTIFACT_DIRECTIVE_PATTERNS = [
  /^(?:task\s*\/\s*goal:\s*)?(?:give me|suggest|write|create|draft|generate|rewrite|research|compare|explain|outline|plan|analyze)\b/i,
  /^(?:task\s*\/\s*goal:\s*)?(?:you are|act as)\b/i,
  /^(?:task\s*\/\s*goal:\s*)?(?:return|provide|produce)\b/i
]

const PROOF_ORIENTED_CHECKLIST_PATTERNS = [
  /\bconcrete change or fix\b/i,
  /\bexact change\b/i,
  /\bproof the result works\b/i,
  /\bshows evidence the result works\b/i,
  /\bexplains how the change addresses the goal\b/i,
  /\bnames the concrete change or fix\b/i
]

const PROMPT_ARTIFACT_CHECKLIST_LABELS = [
  "The generated prompt preserves the user’s core goal",
  "The generated prompt preserves important constraints",
  "The generated prompt is structured and clear",
  "The generated prompt is usable as a send-ready prompt"
] as const

const KNOWN_CUISINES = [
  "syrian",
  "lebanese",
  "palestinian",
  "jordanian",
  "turkish",
  "greek",
  "italian",
  "mexican",
  "asian",
  "japanese",
  "korean",
  "thai",
  "indian",
  "american",
  "french",
  "spanish",
  "mediterranean",
  "middle eastern"
] as const

const NOISY_CONSTRAINT_PATTERNS = [
  /\breturn something directly usable as a strong first draft\b/i,
  /\bdirectly usable as a strong first draft\b/i,
  /\breturn something directly usable\b/i,
  /\bassume a normal home kitchen\b/i,
  /\bkeep it practical for real weekday use\b/i,
  /\bkeep the request clear, specific, and easy for the ai assistant to follow\b/i,
  /\bkeep the result simple and easy to use\b/i
]

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function singularizeConstraintTarget(value: string) {
  const trimmed = normalize(value)
  if (!trimmed) return ""
  if (trimmed.endsWith("ies") && trimmed.length > 4) return `${trimmed.slice(0, -3)}y`
  if (trimmed.endsWith("oes") && trimmed.length > 4) return trimmed.slice(0, -2)
  if (trimmed.endsWith("s") && !trimmed.endsWith("ss") && trimmed.length > 3) return trimmed.slice(0, -1)
  return trimmed
}

function pluralizeConstraintTarget(value: string) {
  const trimmed = normalize(value)
  if (!trimmed) return ""
  if (trimmed.endsWith("ies") || trimmed.endsWith("oes")) return trimmed
  if (trimmed.endsWith("y") && !/[aeiou]y$/.test(trimmed)) return `${trimmed.slice(0, -1)}ies`
  if (trimmed.endsWith("o")) return `${trimmed}es`
  if (trimmed.endsWith("s")) return trimmed
  return `${trimmed}s`
}

function normalizeExclusionTarget(value: string) {
  const trimmed = normalize(value)
    .replace(/\b(?:and|or|but|while|that|which|keep|with|for|to|so|because)\b.*$/i, "")
    .replace(/\b(?:ingredient|ingredients|item|items)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()

  if (!trimmed) return ""

  return trimmed
}

function preferredExclusionTarget(value: string) {
  const normalizedTarget = normalizeExclusionTarget(value)
  if (!normalizedTarget) return ""
  if (/\b(?:dairy|gluten|soy)\b/.test(normalizedTarget) && !normalizedTarget.includes(" ")) return normalizedTarget
  if (!normalizedTarget.includes(" ")) return pluralizeConstraintTarget(normalizedTarget)
  return normalizedTarget
}

function buildExclusionTargetForms(target: string) {
  const normalizedTarget = normalizeExclusionTarget(target)
  if (!normalizedTarget) return []

  if (normalizedTarget.includes(" ")) {
    return [normalizedTarget]
  }

  const singular = singularizeConstraintTarget(normalizedTarget)
  const plural = pluralizeConstraintTarget(singular)
  return [...new Set([normalizedTarget, singular, plural].filter(Boolean))]
}

function buildExclusionVariants(target: string) {
  const normalizedTarget = normalizeExclusionTarget(target)
  if (!normalizedTarget) return []

  const targetForms = buildExclusionTargetForms(normalizedTarget)
  const variants = targetForms.flatMap((form) => {
    const hyphenated = form.replace(/\s+/g, "-")
    return [
      `without ${form}`,
      `no ${form}`,
      `exclude ${form}`,
      `excluding ${form}`,
      `do not use ${form}`,
      `avoid ${form}`,
      `${hyphenated}-free`,
      `${hyphenated} free`
    ]
  })

  return [...new Set(variants)]
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
      if (!target) continue
      extracted.add(target)
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

function extractStructuredPromptValues(promptText: string) {
  const values: Array<{ label: string; value: string }> = []
  for (const line of promptText.split("\n")) {
    const match = line.match(/^\s*-\s*([^:\n]+):\s*(.+?)\s*$/)
    if (!match) continue
    values.push({
      label: normalize(match[1] ?? ""),
      value: stripTrailingPunctuation(match[2] ?? "")
    })
  }
  return values.filter((item) => item.label && item.value)
}

function stripTrailingPunctuation(value: string) {
  return value.trim().replace(/[.:;\s]+$/, "")
}

function isEmptyConstraintValue(value: string) {
  return /^(?:none|non|n\/a|na|no restrictions?)$/i.test(stripTrailingPunctuation(value))
}

function extractStructuredPromptConstraints(promptText: string) {
  const constraints: string[] = []
  for (const item of extractStructuredPromptValues(promptText)) {
    if (isEmptyConstraintValue(item.value)) continue

    if (/cuisine style|cuisine/i.test(item.label)) {
      constraints.push(`${normalize(item.value)} cuisine`)
      continue
    }

    if (/type of meal|meal type/i.test(item.label)) {
      constraints.push(normalize(item.value))
      continue
    }

    if (/how many people|servings?/i.test(item.label)) {
      constraints.push(normalize(item.value))
      continue
    }

    if (/dietary restrictions?|allergies|dietary limits/i.test(item.label)) {
      constraints.push(normalize(item.value))
      continue
    }

    if (/cooking limits?|maximum cooking time|time/i.test(item.label) && /\b(?:minutes?|mins?)\b/i.test(item.value)) {
      const normalizedValue = normalize(item.value)
      if (/\bunder\b|\bless than\b|≤|<=|\bmax(?:imum)?\b/i.test(item.value)) {
        const minuteMatch = normalizedValue.match(/(\d+)\s*(?:minutes?|mins?)/)
        if (minuteMatch) constraints.push(`<=${minuteMatch[1]} minutes`)
      } else {
        constraints.push(normalizedValue)
      }
    }
  }
  return constraints
}

function isNoisyConstraint(value: string) {
  const normalizedValue = normalize(value)
  if (!normalizedValue) return true
  if (isEmptyConstraintValue(normalizedValue)) return true
  return NOISY_CONSTRAINT_PATTERNS.some((pattern) => pattern.test(value))
}

function parseResponseMinutes(responseText: string) {
  const patterns = [
    /\b(?:total\s+)?time\s*:\s*(\d+)\s*minutes?\b/i,
    /\bready\s+in\s+(\d+)\s*minutes?\b/i,
    /\bin\s+(\d+)\s*minutes?\b/i
  ]

  for (const pattern of patterns) {
    const match = responseText.match(pattern)
    if (match) return Number(match[1])
  }

  return null
}

function parseConstraintMaxMinutes(constraint: string) {
  const normalizedConstraint = normalize(constraint)
  const bounded = normalizedConstraint.match(/^<=\s*(\d+)\s*(?:minutes?|mins?)$/)
  if (bounded) return { min: null, max: Number(bounded[1]) }
  const range = normalizedConstraint.match(/^(\d+)\s*-\s*(\d+)\s*(?:minutes?|mins?)$/)
  if (range) return { min: Number(range[1]), max: Number(range[2]) }
  return null
}

function parseResponseServingCount(responseText: string) {
  const explicitRange = responseText.match(/\bservings?\s*:\s*(\d+)\s*[-–]\s*(\d+)\b/i)
  if (explicitRange) return { min: Number(explicitRange[1]), max: Number(explicitRange[2]) }
  const explicitSingle = responseText.match(/\bservings?\s*:\s*(\d+)\b/i)
  if (explicitSingle) return { min: Number(explicitSingle[1]), max: Number(explicitSingle[1]) }
  return null
}

function parseConstraintServingCount(constraint: string) {
  const normalizedConstraint = normalize(constraint)
  const range = normalizedConstraint.match(/^(\d+)\s*-\s*(\d+)\s*(?:servings?|people|kids|children|person)$/)
  if (range) return { min: Number(range[1]), max: Number(range[2]) }
  const single = normalizedConstraint.match(/^(\d+)\s*(?:servings?|people|kids|children|person)$/)
  if (single) return { min: Number(single[1]), max: Number(single[1]) }
  return null
}

function rangesOverlap(a: { min: number | null; max: number }, b: { min: number; max: number }) {
  const effectiveMin = a.min ?? Number.NEGATIVE_INFINITY
  return b.max >= effectiveMin && b.min <= a.max
}

function matchesCuisineConstraint(constraint: string, responseText: string) {
  const normalizedConstraint = normalize(constraint)
  const cuisineMatch = normalizedConstraint.match(/^(.+?) cuisine$/)
  if (!cuisineMatch) return null

  const requestedCuisine = cuisineMatch[1]
  const normalizedResponse = normalize(responseText)
  if (normalizedResponse.includes(requestedCuisine)) return true

  const mentionedOtherCuisine = KNOWN_CUISINES.some(
    (cuisine) => cuisine !== requestedCuisine && normalizedResponse.includes(cuisine)
  )
  return mentionedOtherCuisine ? false : false
}

function canonicalizeExclusionConstraint(target: string) {
  const normalizedTarget = preferredExclusionTarget(target)
  if (!normalizedTarget) return ""

  if (/\b(?:dairy|nut|egg|gluten|soy)\b/.test(normalizedTarget) && !normalizedTarget.includes(" ")) {
    return `${normalizedTarget}-free`
  }

  return `do not use ${normalizedTarget}`
}

function buildExclusionConstraintRecords(text: string) {
  return extractExclusionTargets(text).map((target) => ({
    target,
    canonical: canonicalizeExclusionConstraint(target),
    variants: buildExclusionVariants(target)
  }))
}

function findConstraintExclusionRecord(constraint: string) {
  const normalizedConstraint = normalize(constraint)
  return buildExclusionConstraintRecords(constraint).find((record) =>
    record.variants.some((variant) => normalize(variant) === normalizedConstraint) ||
    normalize(record.canonical) === normalizedConstraint
  )
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function exclusionConstraintViolated(record: ReturnType<typeof buildExclusionConstraintRecords>[number], responseText: string) {
  const scrubbed = record.variants.reduce((text, variant) => {
    const pattern = new RegExp(`\\b${escapeRegExp(normalize(variant))}\\b`, "gi")
    return text.replace(pattern, " ")
  }, normalize(responseText))

  return buildExclusionTargetForms(record.target).some((form) => new RegExp(`\\b${escapeRegExp(form)}\\b`, "i").test(scrubbed))
}

function countStructuredSteps(text: string) {
  const matches = text.match(/(^|\n)\s*(?:\d+[.)]|[-*])\s+/g)
  return matches?.length ?? 0
}

function countListStyleIdeas(text: string) {
  const matches = text.match(/(^|\n)\s*(?:[-*]|\d+[.)])\s+/g)
  return matches?.length ?? 0
}

function hasHtmlStructure(text: string) {
  return /<html\b|<body\b|<head\b|<!doctype html>|<section\b|<main\b/i.test(text)
}

function hasCssSignals(text: string) {
  return /<style\b|```css\b|[.#][\w-]+\s*\{|color\s*:|font-family\s*:|max-width\s*:/i.test(text)
}

function hasResearchSignals(text: string) {
  return /\bfindings?\b|\btrends?\b|\bsources?\b|\brisks?\b|\bopen questions?\b|\bimplications?\b/i.test(text)
}

function hasProfessionalToneSignals(text: string) {
  return /\bthank you\b|\bi appreciate\b|\bopportunity\b|\bat your convenience\b|\bglad to\b|\bwould appreciate\b/i.test(
    text
  )
}

function countPromptArtifactSections(text: string) {
  return PROMPT_ARTIFACT_SECTION_PATTERNS.filter((pattern) => pattern.test(text)).length
}

function getPromptArtifactLines(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

function countPromptArtifactControls(text: string) {
  return PROMPT_ARTIFACT_CONTROL_PATTERNS.filter((pattern) => pattern.test(text)).length
}

function firstPromptArtifactLine(text: string) {
  return getPromptArtifactLines(text)[0] ?? ""
}

function looksLikePromptDirective(text: string) {
  const firstLine = firstPromptArtifactLine(text)
  return PROMPT_ARTIFACT_DIRECTIVE_PATTERNS.some((pattern) => pattern.test(firstLine))
}

function isShortSendReadyPromptArtifactText(text: string) {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length < 40 || trimmed.length > 700) return false
  if (/```|<html\b|<style\b|function\s+\w+|const\s+\w+/i.test(trimmed)) return false
  if (/\b(updated|changed|fixed|implemented|patched|debugged|verified|runtime|test(?:ed|ing)?)\b/i.test(trimmed)) {
    return false
  }

  return (
    looksLikePromptDirective(trimmed) &&
    (countPromptArtifactControls(trimmed) >= 1 || countListStyleIdeas(trimmed) >= 2)
  )
}

function isGeneratedPromptArtifact(input: {
  promptText: string
  responseText: string
  responseSummary: ResponsePreprocessorOutput
}) {
  const { promptText, responseText, responseSummary } = input
  const normalizedPrompt = normalize(promptText)
  const sectionCount = countPromptArtifactSections(responseText)
  const controlCount = countPromptArtifactControls(responseText)
  const listCount = countListStyleIdeas(responseText)
  const directive = looksLikePromptDirective(responseText)
  const promptRequested =
    /\bprompt\b/i.test(promptText) ||
    /\b(prompt|rewrite|research|code|recipe|meal|breakfast|lunch|email|message|outline|brief)\b/i.test(normalizedPrompt)
  const implementationSignals =
    responseSummary.has_code_blocks ||
    responseSummary.change_claims.length > 0 ||
    responseSummary.mentioned_files.length > 0 ||
    /\b(updated|changed|fixed|implemented|patched|debugged|runtime|verified|test(?:ed|ing)?)\b/i.test(responseText)

  if (sectionCount >= 2) return true
  if (directive && controlCount >= 2 && listCount >= 2) return true
  if (promptRequested && directive && controlCount >= 1 && !implementationSignals) return true
  if (promptRequested && isShortSendReadyPromptArtifactText(responseText)) return true

  return false
}

function isStructuredPromptArtifactText(text: string) {
  return countPromptArtifactSections(text) >= 2 || isShortSendReadyPromptArtifactText(text)
}

function extractPromptArtifactConstraints(promptText: string) {
  const constraints: string[] = [...extractStructuredPromptConstraints(promptText)]
  const normalizedPrompt = promptText.trim()

  const servingsMatch = normalizedPrompt.match(/(\d+(?:\s*[-–]\s*\d+)?)\s*(?:servings?|people|kids?|children)\b/i)
  if (servingsMatch) {
    const unit = /\bchildren\b/i.test(servingsMatch[0])
      ? "children"
      : /\bkids?\b/i.test(servingsMatch[0])
        ? "kids"
        : /\bpeople\b/i.test(servingsMatch[0])
          ? "people"
          : "servings"
    constraints.push(
      `${servingsMatch[1].replace(/\s+/g, "")} ${unit}`
    )
  }

  const boundedMinuteMatch = normalizedPrompt.match(/(?:under|less than|<=|≤|maximum of|max(?:imum)?)\s*(\d+)\s*(?:minutes?|mins?)\b/i)
  if (boundedMinuteMatch) {
    constraints.push(`<=${boundedMinuteMatch[1]} minutes`)
  } else {
    const minuteMatch = normalizedPrompt.match(/(\d+)\s*[-–]?\s*(?:minutes?|mins?)\b/i)
    if (minuteMatch) constraints.push(`${minuteMatch[1]} minutes`)
  }

  const phrasePatterns = [
    /\bhtml\b/i,
    /\bcss\b/i,
    /\bjavascript\b/i,
    /\bjson\b/i,
    /\bstep[-\s]?by[-\s]?step\b/i,
    /\bquantities\b/i,
    /\bcalories per serving\b/i,
    /\bstovetop\b/i,
    /\boven[-\s]?baked\b/i,
    /\bnut[-\s]?free\b/i,
    /\blow[-\s]?carb\b/i,
    /\bprofessional\b/i
  ]

  for (const pattern of phrasePatterns) {
    const match = normalizedPrompt.match(pattern)
    if (match) constraints.push(match[0])
  }

  for (const exclusion of buildExclusionConstraintRecords(normalizedPrompt)) {
    constraints.push(exclusion.canonical)
  }

  return [
    ...new Set(
      constraints
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => !isNoisyConstraint(item))
    )
  ].slice(0, 8)
}

function parseResponseCaloriesPerServing(responseText: string) {
  const patterns = [
    /\bcalories?\s*:\s*(\d+)\s*(?:per serving)?\b/i,
    /\b(\d+)\s*calories?\s+per serving\b/i
  ]

  for (const pattern of patterns) {
    const match = responseText.match(pattern)
    if (match) return Number(match[1])
  }

  return null
}

function parsePromptCalorieTarget(promptText: string) {
  const normalizedPrompt = normalize(promptText)
  const underMatch = normalizedPrompt.match(/(?:under|less than|<=|≤|max(?:imum)? of?)\s*(\d+)\s*(?:cal|calories)\b/)
  if (underMatch) return { min: null, max: Number(underMatch[1]) }

  const rangeMatch = normalizedPrompt.match(/(\d+)\s*-\s*(\d+)\s*(?:cal|calories)(?: per serving)?\b/)
  if (rangeMatch) return { min: Number(rangeMatch[1]), max: Number(rangeMatch[2]) }

  return null
}

function responseUsesMicrowaveOnly(responseText: string) {
  const normalizedResponse = normalize(responseText)
  if (/\bskillet\b|\bsaute\b|\bstovetop\b|\bfrying pan\b|\bpan\b|\boven\b|\bbake\b/.test(normalizedResponse)) return false
  return /\bmicrowave\b/.test(normalizedResponse)
}

function responseMentionsRiceQuantity(responseText: string) {
  return /\b\d+(?:\/\d+)?\s*(?:cup|cups|tbsp|tablespoons?|g|grams?)\s+(?:of\s+)?rice\b/i.test(responseText)
}

function responseIncludesRiceIngredient(responseText: string) {
  const scrubbed = responseText.replace(/\brice vinegar\b/gi, " ")
  return /(^|\n)\s*-\s*(?:\d+(?:\/\d+)?\s*(?:cup|cups?|tbsp|tablespoons?|g|grams?)\s+)?(?:cooked\s+)?rice\b/i.test(scrubbed)
}

function responseIncludesTextureTips(responseText: string) {
  const normalizedResponse = normalize(responseText)
  return /\btexture tips?\b|\bcream(?:y|iness)\b|\bto keep it creamy\b|\bfor extra creaminess\b|\bfinal texture\b/.test(normalizedResponse)
}

function parseRequestedCuisine(promptText: string) {
  for (const item of extractStructuredPromptValues(promptText)) {
    if (/cuisine style|cuisine/i.test(item.label) && item.value) {
      return normalize(item.value)
    }
  }

  const directMatch = normalize(promptText).match(/\b(?:syrian|lebanese|palestinian|jordanian|turkish|greek|italian|mexican|asian|japanese|korean|thai|indian|american|french|spanish|mediterranean|middle eastern)\b/)
  return directMatch?.[0] ?? ""
}

function buildPrioritizedCreationIssues(input: {
  promptText: string
  responseText: string
}) {
  const { promptText, responseText } = input
  const normalizedPrompt = normalize(promptText)
  const normalizedResponse = normalize(responseText)
  const prioritized: string[] = []

  const requestedCuisine = parseRequestedCuisine(promptText)
  if (requestedCuisine) {
    const cuisineMatched = matchesCuisineConstraint(`${requestedCuisine} cuisine`, responseText)
    if (cuisineMatched === false) {
      prioritized.push(`The answer is not meaningfully ${requestedCuisine} as requested.`)
    }
  }

  const servingConstraint = extractPromptArtifactConstraints(promptText)
    .map((constraint) => parseConstraintServingCount(constraint))
    .find(Boolean)
  const responseServings = parseResponseServingCount(responseText)
  if (servingConstraint && responseServings && !rangesOverlap(servingConstraint, responseServings)) {
    const requested = servingConstraint.min === servingConstraint.max ? `${servingConstraint.min} person` : `${servingConstraint.min}-${servingConstraint.max} people`
    const actual = responseServings.min === responseServings.max ? `${responseServings.min}` : `${responseServings.min}-${responseServings.max}`
    prioritized.push(`The answer serves ${actual} instead of the requested ${requested}.`)
  }

  const minuteConstraint = extractPromptArtifactConstraints(promptText)
    .map((constraint) => parseConstraintMaxMinutes(constraint))
    .find(Boolean)
  const responseMinutes = parseResponseMinutes(responseText)
  if (minuteConstraint && responseMinutes != null) {
    if ((minuteConstraint.min == null && responseMinutes > minuteConstraint.max) || (minuteConstraint.min != null && (responseMinutes < minuteConstraint.min || responseMinutes > minuteConstraint.max))) {
      const requested = minuteConstraint.min == null ? `${minuteConstraint.max} minutes or less` : `${minuteConstraint.min}-${minuteConstraint.max} minutes`
      prioritized.push(`The answer takes ${responseMinutes} minutes instead of staying within ${requested}.`)
    }
  }

  if (/\bmicrowave only\b|\buses only a microwave\b/.test(normalizedPrompt) && !responseUsesMicrowaveOnly(responseText)) {
    prioritized.push("The answer does not stay microwave-only; it uses non-microwave cooking.")
  }

  const calorieTarget = parsePromptCalorieTarget(promptText)
  const responseCalories = parseResponseCaloriesPerServing(responseText)
  if (calorieTarget && responseCalories != null) {
    const violatesUpper = responseCalories > calorieTarget.max
    const violatesLower = calorieTarget.min != null && responseCalories < calorieTarget.min
    if (violatesUpper || violatesLower) {
      const requested = calorieTarget.min == null ? `${calorieTarget.max} calories or less` : `${calorieTarget.min}-${calorieTarget.max} calories`
      prioritized.push(`The answer is ${responseCalories} calories per serving instead of staying within ${requested}.`)
    }
  }

  if (/\brice\b/.test(normalizedPrompt) && !responseIncludesRiceIngredient(responseText)) {
    prioritized.push("The answer does not include rice even though rice was explicitly requested.")
  }

  if (/\bexact rice quantity\b|\bconfirm the exact rice quantity\b/.test(normalizedPrompt) && !responseMentionsRiceQuantity(responseText)) {
    prioritized.push("The answer does not confirm an exact rice quantity for the calorie target.")
  }

  if (/\bcreamy\b/.test(normalizedPrompt) && !/\bcreamy\b|\bcreaminess\b/.test(normalizedResponse)) {
    prioritized.push("The answer does not clearly deliver the requested creamy texture.")
  }

  if (/\btexture tips?\b|\bfinal texture tips?\b/.test(normalizedPrompt) && !responseIncludesTextureTips(responseText)) {
    prioritized.push("The answer is missing the final texture tips that were requested.")
  }

  if (/\bingredients?\b/.test(normalizedPrompt) && !/\bingredients?\b/.test(normalizedResponse)) {
    prioritized.push("The answer is missing the requested ingredients list.")
  }

  if ((/\bmacro breakdown\b|\bmacros?\b|\bnutritional highlights\b|\bnutritional information\b/.test(normalizedPrompt)) &&
    !/\bprotein\b|\bcarbohydrates?\b|\bfat\b|\bfiber\b|\bnutritional\b|\bmacros?\b/.test(normalizedResponse)) {
    prioritized.push("The answer is missing the requested macro or nutritional breakdown.")
  }

  if (/\bstep[-\s]?by[-\s]?step\b|\binstructions?\b/.test(normalizedPrompt) && countStructuredSteps(responseText) < 2) {
    prioritized.push("The answer is missing clear step-by-step instructions.")
  }

  return [...new Set(prioritized)].slice(0, 6)
}

function constraintAppearsInResponse(constraint: string, responseText: string) {
  const constraintText = normalize(constraint)
  const response = normalize(responseText)
  if (!constraintText) return true
  if (response.includes(constraintText)) return true

  const cuisineMatch = matchesCuisineConstraint(constraint, responseText)
  if (cuisineMatch !== null) return cuisineMatch

  const constraintMinutes = parseConstraintMaxMinutes(constraint)
  if (constraintMinutes) {
    const responseMinutes = parseResponseMinutes(responseText)
    if (responseMinutes == null) return false
    if (constraintMinutes.min == null) return responseMinutes <= constraintMinutes.max
    return responseMinutes >= constraintMinutes.min && responseMinutes <= constraintMinutes.max
  }

  const constraintServings = parseConstraintServingCount(constraint)
  if (constraintServings) {
    const responseServings = parseResponseServingCount(responseText)
    if (!responseServings) return false
    return rangesOverlap(constraintServings, responseServings)
  }

  const exclusionRecord = findConstraintExclusionRecord(constraint)
  if (exclusionRecord) {
    const preserved = exclusionRecord.variants.some((variant) => response.includes(normalize(variant)))
    return preserved && !exclusionConstraintViolated(exclusionRecord, responseText)
  }

  const tokens = extractMeaningfulTokens(constraint)
  if (!tokens.length) return true

  const matched = tokens.filter((token) => response.includes(token))
  return matched.length >= Math.min(tokens.length, 2)
}

function buildConstraintCoverage(constraints: string[], responseText: string) {
  const preserved = constraints.filter((constraint) => constraintAppearsInResponse(constraint, responseText))
  const missing = constraints.filter((constraint) => !preserved.includes(constraint))
  const allPreserved = constraints.length === 0 || missing.length === 0
  const mostlyPreserved =
    constraints.length === 0 || preserved.length >= constraints.length || preserved.length >= Math.max(1, constraints.length - 1)

  return {
    preserved,
    missing,
    allPreserved,
    mostlyPreserved
  }
}

function assessWritingFormatAndScope(input: {
  promptText: string
  responseText: string
  responseSummary: ResponsePreprocessorOutput
}) {
  const { promptText, responseText, responseSummary } = input
  const constraints = extractPromptArtifactConstraints(promptText)
  const professionalRequested = /\bprofessional\b/i.test(promptText)
  const professionalSatisfied = !professionalRequested || hasProfessionalToneSignals(responseText)
  const coverage = buildConstraintCoverage(
    constraints.filter((constraint) => normalize(constraint) !== "professional"),
    responseText
  )
  const constraintsMissing = [
    ...coverage.missing,
    ...(professionalRequested && !professionalSatisfied ? ["professional"] : [])
  ]
  const goalKeywords = extractPromptKeywords(promptText)
  const normalizedResponse = normalize(responseText)
  const hasRewriteArtifact = responseText.trim().length >= 24 && !responseSummary.has_code_blocks
  const scopePreserved = !/\bhere(?:'s| is)\b|\bi rewrote\b|\bexplanation\b|\banalysis\b/i.test(responseText)
  const goalPreserved =
    goalKeywords.length === 0 ||
    goalKeywords.filter((keyword) => normalizedResponse.includes(keyword)).length >= Math.min(1, goalKeywords.length)
  const majorComponentMissing = responseText.trim().length < 24

  return {
    matchesFormatAndScope:
      hasRewriteArtifact && scopePreserved && !majorComponentMissing && (goalPreserved || professionalSatisfied) && constraintsMissing.length === 0,
    completeEnough: hasRewriteArtifact && scopePreserved && !majorComponentMissing && responseText.trim().length >= 48,
    constraintsMissing
  }
}

function assessCreationFormatAndScope(input: {
  promptText: string
  responseText: string
  responseSummary: ResponsePreprocessorOutput
}) {
  const { promptText, responseText, responseSummary } = input
  const normalizedPrompt = normalize(promptText)
  const normalizedResponse = normalize(responseText)
  const constraints = extractPromptArtifactConstraints(promptText)
  const coverage = buildConstraintCoverage(constraints, responseText)
  const goalKeywords = extractPromptKeywords(promptText)
  const goalPreserved =
    goalKeywords.length === 0 ||
    goalKeywords.filter((keyword) => normalizedResponse.includes(keyword)).length >= Math.min(2, goalKeywords.length)

  const wantsHtml = /\bhtml\b/i.test(promptText)
  const wantsCss = /\bcss\b/i.test(promptText)
  const wantsJs = /\bjavascript\b|\bjs\b/i.test(promptText)
  const wantsWebsite = /\bwebsite\b|\bpage\b|\bsite\b/i.test(promptText)
  const wantsCv = /\bcv\b|\bresume\b/i.test(promptText)
  const wantsIngredients = /\bingredients?\b/i.test(promptText)
  const wantsQuantities = /\bquantities\b/i.test(promptText)
  const wantsSteps = /\bstep[-\s]?by[-\s]?step\b|\bsteps?\b/i.test(promptText)
  const wantsCalories = /\bcalories per serving\b/i.test(promptText)
  const wantsResearch = /\bresearch\b/i.test(promptText)
  const wantsPrompt = /\bprompt\b/i.test(promptText)

  const hasHtml = responseSummary.has_code_blocks || hasHtmlStructure(responseText) || responseSummary.mentioned_files.some((file) => /\.html$/i.test(file))
  const hasCss = hasCssSignals(responseText) || responseSummary.mentioned_files.some((file) => /\.css$/i.test(file))
  const hasJs = /```(?:js|javascript)\b|<script\b|function\s+\w+|const\s+\w+/i.test(responseText) || responseSummary.mentioned_files.some((file) => /\.(?:js|ts|tsx)$/i.test(file))
  const websiteSignals = hasHtml || /\blayout\b|\bsection\b|\bpage\b/i.test(normalizedResponse)
  const cvSignals = /\bcv\b|\bresume\b|\bexperience\b|\beducation\b|\bskills\b|\bcontact\b/i.test(normalizedResponse)
  const ingredientSignals = /\bingredients?\b/i.test(normalizedResponse)
  const quantitySignals = /\b\d+\s*(?:cups?|tbsp|tsp|g|kg|ml|l|oz)\b/i.test(responseText) || /\bquantities\b/i.test(normalizedResponse)
  const stepSignals = countStructuredSteps(responseText) >= 2 || /\bstep[-\s]?by[-\s]?step\b/i.test(normalizedResponse)
  const calorieSignals = /\bcalories per serving\b|\btotal calories per serving\b/i.test(normalizedResponse)
  const researchSignals = hasResearchSignals(responseText)
  const promptSignals = isGeneratedPromptArtifact({
    promptText,
    responseText,
    responseSummary
  })
  const scopePreserved = !/\bbackend\b|\bapi\b|\bdatabase\b|\bserver\b|\bauth\b/i.test(normalizedResponse)

  const requestedComponentChecks = [
    { requested: wantsHtml, present: hasHtml },
    { requested: wantsCss, present: hasCss },
    { requested: wantsJs, present: hasJs },
    { requested: wantsWebsite, present: websiteSignals },
    { requested: wantsCv, present: cvSignals },
    { requested: wantsIngredients, present: ingredientSignals },
    { requested: wantsQuantities, present: quantitySignals },
    { requested: wantsSteps, present: stepSignals },
    { requested: wantsCalories, present: calorieSignals },
    { requested: wantsResearch, present: researchSignals },
    { requested: wantsPrompt, present: promptSignals }
  ].filter((item) => item.requested)

  const majorMissingComponents = requestedComponentChecks.filter((item) => !item.present).length
  const artifactTypePresent =
    hasHtml ||
    hasCss ||
    hasJs ||
    promptSignals ||
    responseSummary.has_code_blocks ||
    ingredientSignals ||
    researchSignals ||
    responseSummary.response_length >= 80
  const mediumFormatPresent = requestedComponentChecks.every((item) => item.present)
  const noMajorRequestedComponentMissing = majorMissingComponents === 0

  return {
    matchesFormatAndScope:
      artifactTypePresent &&
      mediumFormatPresent &&
      goalPreserved &&
      coverage.mostlyPreserved &&
      scopePreserved &&
      noMajorRequestedComponentMissing,
    completeEnough:
      artifactTypePresent &&
      goalPreserved &&
      scopePreserved &&
      noMajorRequestedComponentMissing &&
      (responseSummary.has_code_blocks || responseSummary.response_length >= 180 || requestedComponentChecks.length >= 2),
    constraintsMissing: coverage.missing
  }
}

function buildPromptArtifactChecklist(input: {
  promptText: string
  responseText: string
  responseSummary: ResponsePreprocessorOutput
}) {
  const { promptText, responseText, responseSummary } = input
  const extractedConstraints = extractPromptArtifactConstraints(promptText)
  const normalizedResponse = normalize(responseText)
  const promptKeywords = extractPromptKeywords(promptText)
  const goalMatched =
    promptKeywords.length === 0 ||
    promptKeywords.filter((keyword) => normalizedResponse.includes(keyword)).length >= Math.min(2, promptKeywords.length)
  const constraintCoverage = buildConstraintCoverage(extractedConstraints, responseText)
  const preservedConstraints = constraintCoverage.preserved
  const structured =
    countPromptArtifactSections(responseText) >= 2 ||
    (looksLikePromptDirective(responseText) && countPromptArtifactControls(responseText) >= 2 && countListStyleIdeas(responseText) >= 1)
  const sendReady =
    goalMatched &&
    constraintCoverage.mostlyPreserved &&
    structured &&
    responseSummary.uncertainty_signals.length < 3 &&
    responseSummary.response_length >= 90

  return {
    checklist: [
      {
        label: PROMPT_ARTIFACT_CHECKLIST_LABELS[0],
        status: goalMatched ? "met" : "not_sure"
      },
      {
        label: PROMPT_ARTIFACT_CHECKLIST_LABELS[1],
        status:
          extractedConstraints.length === 0
            ? "met"
            : constraintCoverage.allPreserved
              ? "met"
              : constraintCoverage.mostlyPreserved
                ? "not_sure"
                : "missed"
      },
      {
        label: PROMPT_ARTIFACT_CHECKLIST_LABELS[2],
        status: structured ? "met" : "not_sure"
      },
      {
        label: PROMPT_ARTIFACT_CHECKLIST_LABELS[3],
        status: sendReady ? "met" : structured ? "not_sure" : "missed"
      }
    ] satisfies AfterAnalysisResult["acceptance_checklist"],
    extractedConstraints,
    preservedConstraints,
    goalMatched,
    structured,
    sendReady
  }
}

function usesPromptQualityChecklist(checklist: AfterAnalysisResult["acceptance_checklist"]) {
  return checklist.some((item) =>
    PROMPT_ARTIFACT_CHECKLIST_LABELS.includes(item.label as (typeof PROMPT_ARTIFACT_CHECKLIST_LABELS)[number])
  )
}

function isPromptArtifactChecklistLabel(label: string) {
  const normalizedLabel = normalize(label)
  if (!normalizedLabel) return false
  if (label.includes("\n")) return true
  if (PROMPT_ARTIFACT_SECTION_PATTERNS.some((pattern) => pattern.test(label))) return true
  if (label.length > 120) return true
  return /^task\s*\/\s*goal\b/i.test(label.trim())
}

function isProofOrientedChecklistLabel(label: string) {
  return PROOF_ORIENTED_CHECKLIST_PATTERNS.some((pattern) => pattern.test(label))
}

function matchesCreationFormatAndScope(input: {
  promptText: string
  responseText: string
  responseSummary: ResponsePreprocessorOutput
}) {
  const { promptText, responseText, responseSummary } = input
  const normalizedPrompt = normalize(promptText)
  const normalizedResponse = normalize(responseText)
  const wantsHtml = /\bhtml\b/i.test(promptText)
  const wantsCss = /\bcss\b/i.test(promptText)
  const wantsJs = /\bjavascript\b|\bjs\b/i.test(promptText)
  const wantsWebsite = /\bwebsite\b|\bpage\b|\bsite\b/i.test(promptText)
  const wantsCv = /\bcv\b|\bresume\b/i.test(promptText)

  const hasHtml = responseSummary.has_code_blocks || hasHtmlStructure(responseText) || responseSummary.mentioned_files.some((file) => /\.html$/i.test(file))
  const hasCss = hasCssSignals(responseText) || responseSummary.mentioned_files.some((file) => /\.css$/i.test(file))
  const hasJs = /```(?:js|javascript)\b|<script\b|function\s+\w+|const\s+\w+/i.test(responseText) || responseSummary.mentioned_files.some((file) => /\.(?:js|ts|tsx)$/i.test(file))
  const staysInScope = !/\bbackend\b|\bapi\b|\bdatabase\b|\bserver\b|\bauth\b/i.test(normalizedResponse)
  const cvSignals = /\bcv\b|\bresume\b|\bexperience\b|\beducation\b|\bskills\b|\bcontact\b/i.test(normalizedResponse)
  const websiteSignals = hasHtml || /\blayout\b|\bsection\b|\bpage\b/i.test(normalizedResponse)

  if (wantsHtml && !hasHtml) return false
  if (wantsCss && !hasCss) return false
  if (wantsJs && !hasJs) return false
  if (wantsWebsite && !websiteSignals) return false
  if (wantsCv && !cvSignals) return false

  return staysInScope && (hasHtml || hasCss || hasJs || responseSummary.has_code_blocks)
}

function extractPromptKeywords(prompt: string) {
  const stopwords = new Set([
    "give",
    "me",
    "the",
    "how",
    "what",
    "when",
    "where",
    "which",
    "this",
    "that",
    "with",
    "from",
    "into",
    "your",
    "their",
    "there",
    "please",
    "instructions",
    "steps"
  ])

  return prompt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !stopwords.has(token))
    .filter((token, index, all) => all.indexOf(token) === index)
    .slice(0, 6)
}

function extractMeaningfulTokens(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !GOAL_STOPWORDS.has(token))
    .filter((token, index, all) => all.indexOf(token) === index)
}

function isWeakGoal(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return true
  if (WEAK_GOAL_PATTERNS.some((pattern) => pattern.test(trimmed))) return true
  const tokens = extractMeaningfulTokens(trimmed)
  return tokens.length < 2
}

function normalizeSentence(value: string) {
  const trimmed = value.replace(/\s+/g, " ").trim()
  if (!trimmed) return ""
  const sentence = trimmed.replace(/[.]+$/g, "")
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`
}

function pickFirstMeaningful(values: Array<string | null | undefined>) {
  return values.map((value) => value?.trim() ?? "").find(Boolean) ?? ""
}

function extractPrimaryGoalText(prompt: string) {
  const match = prompt.match(
    /task\s*\/\s*goal:\s*([\s\S]*?)(?:\n\s*\n|\n(?:key requirements|constraints|output format|quality bar\s*\/\s*style guardrails|style|requirements|output)\s*:|$)/i
  )
  return match?.[1]?.replace(/\s+/g, " ").trim() ?? ""
}

function buildNormalizedGoal(target: ReviewTarget, responseSummary: ResponsePreprocessorOutput) {
  const rawGoal = pickFirstMeaningful([
    extractPrimaryGoalText(target.attempt.intent.goal || ""),
    extractPrimaryGoalText(target.attempt.optimized_prompt || ""),
    extractPrimaryGoalText(target.attempt.raw_prompt || ""),
    target.attempt.intent.goal,
    target.attempt.optimized_prompt,
    target.attempt.raw_prompt
  ])

  if (!isWeakGoal(rawGoal)) return normalizeSentence(rawGoal)

  if (target.taskType === "debug") {
    const runtimeSignals = buildExtensionRuntimeSignals(rawGoal, target.responseText)
    if (runtimeSignals?.length) {
      return "Confirm the runtime fix end to end: extension loads, the content script attaches, the target input is detected, the icon renders in the DOM, and the icon is visible in the UI"
    }

    return "Identify the failure point, apply the fix, and confirm the runtime result"
  }

  const concreteChange = responseSummary.change_claims[0]
  if (concreteChange) {
    return normalizeSentence(`Implement the requested fix and show evidence it resolves the issue. ${concreteChange}`)
  }

  if (responseSummary.mentioned_files.length) {
    return normalizeSentence(
      `Implement the requested fix and show evidence the issue is resolved in ${responseSummary.mentioned_files.slice(0, 2).join(" and ")}`
    )
  }

  return "Implement the requested fix and show evidence the issue is resolved"
}

function isGenericChecklistLabel(label: string, normalizedGoal: string, rawPrompt: string) {
  const normalizedLabel = normalize(label)
  if (!normalizedLabel) return true
  if (isPromptArtifactChecklistLabel(label)) return true
  if (WEAK_GOAL_PATTERNS.some((pattern) => pattern.test(label.trim()))) return true
  if (normalizedLabel === normalize(normalizedGoal) && isWeakGoal(normalizedGoal)) return true
  if (normalizedLabel === normalize(rawPrompt)) return true
  if (/^the user'?s latest request$/i.test(label.trim())) return true
  if (/^solve/.test(normalizedLabel) || /^fix/.test(normalizedLabel)) return extractMeaningfulTokens(label).length < 2
  return false
}

function responseHasGoalSignal(normalizedGoal: string, responseText: string) {
  const goalTokens = extractMeaningfulTokens(normalizedGoal)
  if (!goalTokens.length) return false
  const haystack = normalize(responseText)
  const matched = goalTokens.filter((token) => haystack.includes(token))
  return matched.length >= Math.min(2, goalTokens.length)
}

function buildFallbackStructuredChecklist(
  target: ReviewTarget,
  responseSummary: ResponsePreprocessorOutput,
  normalizedGoal: string
): AfterAnalysisResult["acceptance_checklist"] {
  if (
    isGeneratedPromptArtifact({
      promptText: target.attempt.raw_prompt || target.attempt.optimized_prompt || target.attempt.intent.goal || "",
      responseText: target.responseText,
      responseSummary
    })
  ) {
    return buildPromptArtifactChecklist({
      promptText: target.attempt.raw_prompt || target.attempt.optimized_prompt || target.attempt.intent.goal || "",
      responseText: target.responseText,
      responseSummary
    }).checklist
  }

  if (target.taskType === "debug") {
    const runtimeSignals = buildExtensionRuntimeSignals(
      target.attempt.raw_prompt || target.attempt.optimized_prompt || target.attempt.intent.goal || "",
      target.responseText
    )

    if (runtimeSignals?.length) {
      return runtimeSignals.map((signal) => ({
        label: signal.label,
        status: signal.verified ? "met" : "not_sure"
      }))
    }

    return [
      {
        label: "The root cause is identified",
        status: /\b(root cause|failure point|likely cause)\b/i.test(target.responseText) ? "met" : "not_sure"
      },
      {
        label: "The concrete fix is implemented",
        status:
          responseSummary.change_claims.length > 0 ||
          responseSummary.mentioned_files.length > 0 ||
          responseSummary.has_code_blocks
            ? "met"
            : "not_sure"
      },
      {
        label: "The runtime result is confirmed",
        status:
          responseSummary.validation_signals.length > 0 ||
          /\b(runtime|live|browser|ui)\b.*\b(verified|confirmed|works|resolved)\b/i.test(target.responseText)
            ? "met"
            : "not_sure"
      }
    ]
  }

  const intentCriteria = target.attempt.intent.acceptance_criteria
    .map((item) => normalizeSentence(item))
    .filter((item) => item && !isGenericChecklistLabel(item, normalizedGoal, target.attempt.raw_prompt))
    .slice(0, 4)

  if (intentCriteria.length) {
    return intentCriteria.map((label) => ({
      label,
      status: responseHasGoalSignal(label, target.responseText) ? "met" : "not_sure"
    }))
  }

  return [
    {
      label: "The answer names the concrete change or fix",
      status:
        responseSummary.change_claims.length > 0 ||
        responseSummary.mentioned_files.length > 0 ||
        responseSummary.has_code_blocks
          ? "met"
          : "not_sure"
    },
    {
      label: "The answer explains how the change addresses the goal",
      status: responseHasGoalSignal(normalizedGoal, target.responseText) ? "met" : "not_sure"
    },
    {
      label: "The answer shows evidence the result works",
      status:
        responseSummary.validation_signals.length > 0 || responseSummary.success_signals.length > 0
          ? "met"
          : "not_sure"
    }
  ]
}

function sanitizeChecklist(
  result: AfterAnalysisResult,
  target: ReviewTarget,
  responseSummary: ResponsePreprocessorOutput,
  normalizedGoal: string
) {
  const rawPrompt = target.attempt.raw_prompt || target.attempt.optimized_prompt || target.attempt.intent.goal || ""
  const meaningfulRaw = result.acceptance_checklist
    .map((item) => ({
      label: normalizeSentence(item.label),
      status: item.status
    }))
    .filter(
      (item) =>
        item.label &&
        !isGenericChecklistLabel(item.label, normalizedGoal, rawPrompt) &&
        !isProofOrientedChecklistLabel(item.label)
    )

  if (meaningfulRaw.length) return meaningfulRaw.slice(0, 6)

  return buildFallbackStructuredChecklist(target, responseSummary, normalizedGoal).slice(0, 6)
}

function buildEvidencePool(result: AfterAnalysisResult, responseSummary: ResponsePreprocessorOutput) {
  return Array.from(
    new Set(
      [
        ...result.stage_1.claimed_evidence,
        ...responseSummary.change_claims,
        ...responseSummary.validation_signals,
        ...responseSummary.success_signals,
        ...responseSummary.key_paragraphs
      ]
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ).slice(0, 10)
}

function evidenceMatchesChecklist(label: string, evidence: string) {
  const labelTokens = extractMeaningfulTokens(label)
  const evidenceText = normalize(evidence)

  if (/extension loads/i.test(label)) return /\bextension\b.*\b(load|install|running)\b/i.test(evidence)
  if (/content script attaches/i.test(label)) return /\bcontent script\b.*\b(attached|attach|running|loaded|mounted)\b/i.test(evidence)
  if (/dom selector works/i.test(label)) return /\b(selector|textarea|prompt input|target input)\b.*\b(found|detect|match|resolve)\b/i.test(evidence)
  if (/renders in the dom/i.test(label)) return /\b(icon|button|launcher)\b.*\b(render|insert|mount|dom)\b/i.test(evidence)
  if (/visible in the ui/i.test(label)) return /\b(icon|button|launcher)\b.*\b(visible|showing|appears|displayed)\b/i.test(evidence)

  const overlap = labelTokens.filter((token) => evidenceText.includes(token))
  return overlap.length >= Math.min(2, labelTokens.length)
}

function mapEvidenceToChecklist(checklist: AfterAnalysisResult["acceptance_checklist"], evidencePool: string[]) {
  return checklist.map((item) => {
    const matches = evidencePool.filter((evidence) => evidenceMatchesChecklist(item.label, evidence)).slice(0, 1)
    return {
      item,
      evidence: matches
    }
  })
}

function deriveDeepStatusFromChecklist(
  checklist: AfterAnalysisResult["acceptance_checklist"],
  problemFit: AfterAnalysisResult["stage_2"]["problem_fit"]
) {
  const metCount = checklist.filter((item) => item.status === "met").length
  const missedCount = checklist.filter((item) => item.status === "missed").length
  const unresolvedCount = checklist.length - metCount

  if (problemFit === "wrong_direction") {
    return {
      status: "WRONG_DIRECTION" as const,
      confidence: "low" as const,
      promptStrategy: "retry_cleanly" as const
    }
  }

  if (unresolvedCount === 0) {
    return {
      status: "SUCCESS" as const,
      confidence: "high" as const,
      promptStrategy: "validate" as const
    }
  }

  if (missedCount > 0 && metCount === 0) {
    return {
      status: "FAILED" as const,
      confidence: "low" as const,
      promptStrategy: "fix_missing" as const
    }
  }

  return {
    status: "PARTIAL" as const,
    confidence: missedCount > 1 ? ("low" as const) : ("medium" as const),
    promptStrategy: "fix_missing" as const
  }
}

function buildChecklistDerivedPrompt(input: {
  normalizedGoal: string
  unresolvedLabels: string[]
  status: AfterAnalysisResult["status"]
  taskType: ReviewTarget["taskType"]
}) {
  const { normalizedGoal, unresolvedLabels, status, taskType } = input
  const promptArtifactReview = unresolvedLabels.some((label) =>
    PROMPT_ARTIFACT_CHECKLIST_LABELS.includes(label as (typeof PROMPT_ARTIFACT_CHECKLIST_LABELS)[number])
  )

  if (!unresolvedLabels.length) {
    return `No retry needed. The visible checklist is fully confirmed for this goal: ${normalizedGoal}.`
  }

  if (promptArtifactReview) {
    return [
      `Rewrite the generated prompt so it fixes only these gaps: ${unresolvedLabels.join("; ")}.`,
      "Keep the original goal intact, preserve the important constraints, and return a clearer send-ready prompt."
    ].join("\n")
  }

  if (taskType === "debug") {
    return [
      "Do not assume the previous fix worked.",
      "Confirm the single most likely runtime gap first, then run one minimal diagnostic step.",
      `Check: ${unresolvedLabels[0]}.`,
      "Report what is confirmed and what is still unverified."
    ].join("\n")
  }

  if (taskType === "verification") {
    return [
      `Verify only these unresolved points: ${unresolvedLabels.join("; ")}.`,
      "For each one, show the exact proof or say plainly that it is still unproven."
    ].join("\n")
  }

  const primaryGap = unresolvedLabels[0]
  const remaining = unresolvedLabels.slice(1, 3)

  if (status === "WRONG_DIRECTION") {
    return [
      `The answer drifted away from the real target: ${normalizedGoal}.`,
      `Replace it with the minimum concrete fix for: ${primaryGap}.`,
      "Explain how the change solves the issue and show one clear proof the result works."
    ].join("\n")
  }

  return [
    `Fix only what is still missing: ${primaryGap}.`,
    remaining.length ? `Then cover: ${remaining.join("; ")}.` : "",
    "Show the exact change, explain how it solves the issue, and provide one clear proof the result works."
  ]
    .filter(Boolean)
    .join("\n")
}

function buildGroundedDeepResult(
  result: AfterAnalysisResult,
  target: ReviewTarget,
  responseSummary: ResponsePreprocessorOutput
): AfterAnalysisResult {
  const normalizedGoal = buildNormalizedGoal(target, responseSummary)
  const sanitizedChecklist = sanitizeChecklist(result, target, responseSummary, normalizedGoal)

  if (!sanitizedChecklist.length) {
    throw new Error("Deep review could not be grounded safely.")
  }

  const evidencePool = buildEvidencePool(result, responseSummary)
  const mappedChecklist = mapEvidenceToChecklist(sanitizedChecklist, evidencePool).map(({ item, evidence }) => ({
    ...item,
    status: item.status === "met" && evidence.length === 0 ? "not_sure" : item.status
  }))
  const proofLinks = mapEvidenceToChecklist(mappedChecklist, evidencePool)
  const checkedArtifacts = proofLinks
    .filter((entry) => entry.item.status === "met" && entry.evidence.length)
    .map((entry) => `${entry.item.label}: ${entry.evidence[0]}`)
    .slice(0, 4)
  const unresolvedLabels = mappedChecklist
    .filter((item) => item.status !== "met")
    .map((item) => item.label)
  const proofBackedMissing = unresolvedLabels.map((label) => label)
  const derived = deriveDeepStatusFromChecklist(mappedChecklist, result.stage_2.problem_fit)
  const promptStrategy =
    target.taskType === "debug" && derived.status === "PARTIAL" ? "narrow_scope" : derived.promptStrategy
  const normalizedGoalNote =
    isWeakGoal(target.attempt.intent.goal || "") || isWeakGoal(target.attempt.raw_prompt || "")
      ? [`Deep review normalized the goal to: ${normalizedGoal}.`]
      : []
  const confidenceReason =
    derived.status === "SUCCESS"
      ? `The full checklist is confirmed for this goal: ${normalizedGoal}.`
      : derived.status === "WRONG_DIRECTION"
        ? `The answer does not stay on the normalized goal: ${normalizedGoal}.`
        : `Only ${mappedChecklist.filter((item) => item.status === "met").length} of ${mappedChecklist.length} checklist items are confirmed for this goal: ${normalizedGoal}.`
  const groundedFindings =
    derived.status === "WRONG_DIRECTION"
      ? [
          `The answer drifted away from the normalized goal: ${normalizedGoal}.`,
          unresolvedLabels[0] ? `${unresolvedLabels[0]} is still unresolved.` : "",
          "The current answer should be replaced with a narrower, goal-matching fix."
        ]
      : derived.status === "FAILED"
        ? [
            unresolvedLabels[0] ? `${unresolvedLabels[0]} is still missing.` : "",
            unresolvedLabels[1] ? `${unresolvedLabels[1]} is also still missing.` : "",
            "The answer does not yet show enough proof to trust the result."
          ]
        : derived.status === "PARTIAL"
          ? [
              "The answer makes progress, but the result is not proven yet.",
              unresolvedLabels[0] ? `${unresolvedLabels[0]} is still unresolved.` : "",
              checkedArtifacts[0]
                ? `One supported point was shown: ${checkedArtifacts[0]}.`
                : "No strong proof was shown for the unresolved parts."
            ]
          : [
              `The answer stays on the normalized goal: ${normalizedGoal}.`,
              checkedArtifacts[0] ? `The strongest visible proof was: ${checkedArtifacts[0]}.` : "",
              "The checklist is fully confirmed."
            ]
  const groundedAnalysisNotes =
    proofLinks
      .filter((entry) => entry.item.status === "met" && entry.evidence.length)
      .map((entry) => `"${entry.item.label}" is supported by: ${entry.evidence[0]}.`)
      .slice(0, 2)
  const nextPrompt = buildChecklistDerivedPrompt({
    normalizedGoal,
    unresolvedLabels,
    status: derived.status,
    taskType: target.taskType
  })

  return {
    ...result,
    status: derived.status,
    confidence: derived.confidence,
    confidence_reason: confidenceReason,
    findings: [...normalizedGoalNote, ...groundedFindings].filter(Boolean).slice(0, 3),
    issues: proofBackedMissing.slice(0, 6),
    next_prompt: nextPrompt,
    prompt_strategy: promptStrategy,
    stage_1: {
      ...result.stage_1,
      claimed_evidence: checkedArtifacts,
      assistant_action_summary: normalizeSentence(`${result.stage_1.assistant_action_summary} Goal under review: ${normalizedGoal}.`)
    },
    stage_2: {
      ...result.stage_2,
      addressed_criteria: mappedChecklist.filter((item) => item.status === "met").map((item) => item.label),
      missing_criteria: proofBackedMissing.slice(0, 6),
      analysis_notes: [...normalizedGoalNote, ...groundedAnalysisNotes].filter(Boolean).slice(0, 4),
      problem_fit: derived.status === "WRONG_DIRECTION" ? "wrong_direction" : unresolvedLabels.length ? "partial" : "correct"
    },
    verdict: {
      ...result.verdict,
      status: derived.status,
      confidence: derived.confidence,
      confidence_reason: confidenceReason,
      findings: [...normalizedGoalNote, ...groundedFindings].filter(Boolean).slice(0, 3),
      issues: proofBackedMissing.slice(0, 6)
    },
    next_prompt_output: {
      next_prompt: nextPrompt,
      prompt_strategy: promptStrategy
    },
    acceptance_checklist: mappedChecklist
  }
}

function containsAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text))
}

function buildExtensionRuntimeSignals(promptText: string, responseText: string) {
  const normalizedPrompt = normalize(promptText)
  const normalizedResponse = responseText
  const promptLooksLikeExtensionDebug =
    /\b(extension|content script|replit|icon|launcher|textarea|prompt area|dom|selector|visible)\b/i.test(promptText)

  if (!promptLooksLikeExtensionDebug) return null

  const signals: RuntimeSignal[] = [
    {
      label: "Extension loads",
      patterns: [/\bextension\b.*\b(load(ed)?|install(ed)?|running)\b/i, /\bloaded extension\b/i],
      verified: false
    },
    {
      label: "Content script attaches",
      patterns: [/\bcontent script\b.*\b(attached|attach(es|ed)?|running|loaded|mounted)\b/i],
      verified: false
    },
    {
      label: "DOM selector works",
      patterns: [/\b(selector|textarea|prompt input|target input)\b.*\b(found|detect(ed)?|matched|resolv(ed|es))\b/i],
      verified: false
    },
    {
      label: "Icon renders in the DOM",
      patterns: [/\b(icon|button|launcher)\b.*\b(render(ed|s)?|insert(ed|s)?|mount(ed|s)?|in the dom)\b/i],
      verified: false
    },
    {
      label: "Icon is visible in the UI",
      patterns: [/\b(icon|button|launcher)\b.*\b(visible|showing|appears|displayed)\b/i],
      verified: false
    }
  ]

  return signals.map((signal) => ({
    ...signal,
    verified: containsAny(normalizedResponse, signal.patterns)
  }))
}

function buildGenericDebugChecklist(responseText: string) {
  const runtimeConfirmed = /\b(runtime|live|browser|ui)\b.*\b(verified|confirmed|checked)\b/i.test(responseText)
  const failurePointFound = /\b(root cause|failure point|likely cause|selector|attachment|mount)\b/i.test(responseText)
  const diagnosticStepNamed = /\b(log|console|inspect|check|confirm|verify)\b/i.test(responseText)

  return [
    {
      label: "Current runtime state is confirmed",
      status: runtimeConfirmed ? "met" : "not_sure"
    },
    {
      label: "Most likely failure point is identified",
      status: failurePointFound ? "met" : "not_sure"
    },
    {
      label: "One minimal diagnostic step is proposed before more changes",
      status: diagnosticStepNamed ? "met" : "not_sure"
    }
  ] satisfies AfterAnalysisResult["acceptance_checklist"]
}

function isDebugContinuation(
  result: AfterAnalysisResult,
  responseSummary: ResponsePreprocessorOutput,
  target: ReviewTarget,
  mode: "quick" | "deep"
) {
  if (target.taskType !== "debug") return false

  const unresolved =
    (result.status !== "SUCCESS" && result.status !== "LIKELY_SUCCESS") ||
    result.stage_2.problem_fit !== "correct" ||
    result.acceptance_checklist.some((item) => item.status !== "met")

  const promptStillOpen = /\bstill\b|\bnot visible\b|\bnot showing\b|\bnot working\b|\bdoesn'?t\b|\bfailing\b/i.test(
    target.attempt.raw_prompt || target.attempt.optimized_prompt || target.attempt.intent.goal || ""
  )
  const codeChanged =
    responseSummary.change_claims.length > 0 ||
    responseSummary.mentioned_files.length > 0 ||
    responseSummary.has_code_blocks
  const runtimeSignals = buildExtensionRuntimeSignals(
    target.attempt.raw_prompt || target.attempt.optimized_prompt || target.attempt.intent.goal || "",
    target.responseText
  )
  const runtimeVerified = runtimeSignals?.some((signal) => signal.verified) ?? /\b(runtime|live|browser|ui)\b.*\b(verified|confirmed|works)\b/i.test(target.responseText)
  const runtimeStillOpen = runtimeSignals?.some((signal) => !signal.verified) ?? !runtimeVerified

  if (mode === "quick") {
    return promptStillOpen && (codeChanged || runtimeStillOpen)
  }

  return unresolved && (promptStillOpen || codeChanged || !runtimeVerified)
}

function buildDebugContinuationResult(
  result: AfterAnalysisResult,
  target: ReviewTarget,
  responseSummary: ResponsePreprocessorOutput,
  mode: "quick" | "deep"
): AfterAnalysisResult {
  const promptText = target.attempt.raw_prompt || target.attempt.optimized_prompt || target.attempt.intent.goal || ""
  const runtimeSignals = buildExtensionRuntimeSignals(promptText, target.responseText)
  const checklist =
    runtimeSignals?.map((signal) => ({
      label: signal.label,
      status: signal.verified ? "met" : "not_sure"
    })) ?? buildGenericDebugChecklist(target.responseText)

  const missingRuntime = checklist.filter((item) => item.status !== "met").map((item) => `${item.label} is still unverified.`)
  const codeEvidence = [...responseSummary.change_claims, ...responseSummary.mentioned_files].filter(Boolean).slice(0, 4)

  const findings = [
    "The assistant applied a fix without verifying runtime behavior.",
    "There is no confirmation loop showing whether the issue was actually resolved.",
    "The root cause still appears hypothesized rather than proven."
  ]

  const nextPrompt =
    mode === "quick"
      ? [
          "Do one lightweight diagnostic check before changing more code.",
          "",
          "Confirm the current runtime state for these points:",
          ...checklist.map((item, index) => `${index + 1}. ${item.label}`),
          "",
          "Then name the single most likely failure point in the previous fix and run one minimal diagnostic check first.",
          "Say what is confirmed and what is still unverified."
        ].join("\n")
      : [
          "Do not assume the previous fix worked yet.",
          "",
          "First confirm the current runtime state for these points:",
          ...checklist.map((item, index) => `${index + 1}. ${item.label}`),
          "",
          "Then identify the single most likely failure point in the previous fix and run one minimal diagnostic step before changing more code.",
          "If any point is still unverified, say that plainly."
        ].join("\n")

  return {
    ...result,
    status: "PARTIAL",
    confidence: mode === "deep" ? "low" : "medium",
    confidence_reason: "The code may have changed, but runtime behavior is still not verified.",
    findings,
    issues: missingRuntime.length ? missingRuntime.slice(0, 5) : result.issues,
    next_prompt: nextPrompt,
    prompt_strategy: "narrow_scope",
    stage_1: {
      ...result.stage_1,
      claimed_evidence: codeEvidence.length ? codeEvidence : result.stage_1.claimed_evidence,
      response_mode: "implemented"
    },
    stage_2: {
      ...result.stage_2,
      missing_criteria: missingRuntime.length ? missingRuntime : result.stage_2.missing_criteria,
      analysis_notes: findings,
      addressed_criteria: checklist.filter((item) => item.status === "met").map((item) => item.label),
      problem_fit: "partial"
    },
    verdict: {
      ...result.verdict,
      status: "PARTIAL",
      confidence: mode === "deep" ? "low" : "medium",
      confidence_reason: "The fix is not runtime-verified yet.",
      findings,
      issues: missingRuntime.length ? missingRuntime.slice(0, 5) : result.verdict.issues
    },
    next_prompt_output: {
      next_prompt: nextPrompt,
      prompt_strategy: "narrow_scope"
    },
    acceptance_checklist: checklist
  }
}

function buildInformationalReviewResult(input: {
  target: ReviewTarget
  mode: "quick" | "deep"
  responseSummary: ResponsePreprocessorOutput
}): AfterAnalysisResult {
  const { target, mode, responseSummary } = input
  const isPromptArtifact = isGeneratedPromptArtifact({
    promptText: target.attempt.optimized_prompt || target.attempt.raw_prompt || target.attempt.intent.goal || "",
    responseText: target.responseText,
    responseSummary
  })
  const isCreation = target.taskType === "creation"
  const isWriting = target.taskType === "writing"
  const isInstructional = target.taskType === "instructional"
  const isAdvice = target.taskType === "advice"
  const isIdeation = target.taskType === "ideation"
  const promptText = target.attempt.optimized_prompt || target.attempt.raw_prompt || target.attempt.intent.goal || ""
  const normalizedResponse = normalize(target.responseText)
  const promptArtifactSignals = isPromptArtifact
    ? buildPromptArtifactChecklist({
        promptText,
        responseText: target.responseText,
        responseSummary
      })
    : null
  const creationAssessment = isCreation
    ? assessCreationFormatAndScope({
        promptText,
        responseText: target.responseText,
        responseSummary
      })
    : null
  const prioritizedCreationIssues = isCreation
    ? buildPrioritizedCreationIssues({
        promptText,
        responseText: target.responseText
      })
    : []
  const writingAssessment = isWriting
    ? assessWritingFormatAndScope({
        promptText,
        responseText: target.responseText,
        responseSummary
      })
    : null
  const promptKeywords = extractPromptKeywords(promptText)
  const keywordMatches = promptKeywords.filter((keyword) => normalizedResponse.includes(keyword)).length
  const structuredSteps = countStructuredSteps(target.responseText)
  const ideaCount = countListStyleIdeas(target.responseText)
  const creationDeliverableSignals =
    isCreation &&
    (responseSummary.has_code_blocks ||
      (/\bingredients?\b/i.test(target.responseText) && structuredSteps >= 2) ||
      /\bnutritional\b|\bmacros?\b|\bcalories?\b/i.test(normalizedResponse))
  const directAnswer = isPromptArtifact
    ? promptArtifactSignals?.goalMatched ?? false
    : isWriting
      ? target.responseText.trim().length >= 24 && !responseSummary.has_code_blocks
    : isCreation
      ? creationDeliverableSignals || (target.responseText.trim().length >= 80 && (keywordMatches >= 1 || promptKeywords.length === 0))
    : target.responseText.trim().length >= 80 && (keywordMatches >= 1 || promptKeywords.length === 0)
  const creationMatchesFormat = creationAssessment?.matchesFormatAndScope ?? false
  const clearEnough = isPromptArtifact
    ? (promptArtifactSignals?.structured ?? false) && (promptArtifactSignals?.goalMatched ?? false) && (promptArtifactSignals?.preservedConstraints.length ?? 0) >= Math.max(0, (promptArtifactSignals?.extractedConstraints.length ?? 0) - 1)
    : isInstructional
    ? structuredSteps >= 2 || responseSummary.response_length >= 180
    : isAdvice || isIdeation
      ? ideaCount >= 3 || responseSummary.response_length >= 160
      : isCreation
        ? creationMatchesFormat
        : isWriting
          ? writingAssessment?.matchesFormatAndScope ?? false
      : responseSummary.response_length >= 120
  const completeEnough =
    isPromptArtifact
      ? promptArtifactSignals?.sendReady ?? false
      : isInstructional
      ? structuredSteps >= 3 || responseSummary.response_length >= 260
      : isAdvice || isIdeation
        ? (ideaCount >= 4 && responseSummary.response_length >= 220) || responseSummary.key_paragraphs.length >= 2
        : isCreation
          ? creationAssessment?.completeEnough ?? false
          : isWriting
            ? writingAssessment?.completeEnough ?? false
        : responseSummary.response_length >= 180 && responseSummary.key_paragraphs.length >= 1
  const uncertaintyHeavy = responseSummary.uncertainty_signals.length >= 3
  const missingItems: string[] = []

  if (!directAnswer) {
    missingItems.push(
      isPromptArtifact
        ? "The generated prompt should preserve the user's core goal more clearly."
        : isCreation
        ? "The answer should directly provide the requested deliverable."
        : isWriting
          ? "The answer should directly provide the requested rewritten text."
        :
      isInstructional
        ? "The answer should directly address the requested instructions."
        : isAdvice || isIdeation
          ? "The answer should directly address the requested ideas or recommendations."
          : "The answer should address the question more directly."
    )
  }
  if (!clearEnough && !(isCreation && prioritizedCreationIssues.length)) {
    missingItems.push(
      isPromptArtifact
        ? "The generated prompt should use a clearer structured format with labeled sections."
        : isCreation
        ? "The generated output should be clearer, more usable, and closer to the requested format."
        : isWriting
          ? "The rewrite should read more clearly and match the requested tone."
        :
      isInstructional
        ? "The steps should be clearer and easier to follow."
        : isAdvice || isIdeation
          ? "The ideas should be clearer, easier to scan, and easier to choose from."
          : "The explanation should be clearer and easier to follow."
    )
  }
  if (!completeEnough && !(isCreation && prioritizedCreationIssues.length)) {
    missingItems.push(
      isPromptArtifact
        ? "The generated prompt should be usable as a send-ready prompt without important gaps."
        : isCreation
        ? "The generated deliverable is missing important requested parts."
        : isWriting
          ? "The rewrite is missing polish, completeness, or the requested tone shift."
        :
      isInstructional
        ? "The answer is missing steps or practical detail."
        : isAdvice || isIdeation
          ? "The answer needs more variety, practicality, or useful detail."
          : "The explanation needs more completeness or context."
    )
  }
  if (isPromptArtifact && promptArtifactSignals) {
    const unresolvedConstraints =
      promptArtifactSignals.extractedConstraints.length === 0
        ? []
        : promptArtifactSignals.extractedConstraints.filter(
            (constraint) => !promptArtifactSignals.preservedConstraints.includes(constraint)
          )

    if (unresolvedConstraints.length) {
      missingItems.push(`The generated prompt is missing or weak on these constraints: ${unresolvedConstraints.join("; ")}.`)
    }
  }
  if (isCreation && prioritizedCreationIssues.length) {
    missingItems.push(...prioritizedCreationIssues)
  } else if (isCreation && creationAssessment?.constraintsMissing.length) {
    const filteredMissingConstraints = creationAssessment.constraintsMissing.filter((constraint) => !isNoisyConstraint(constraint))
    if (filteredMissingConstraints.length) {
      missingItems.push(`The generated output is missing or weak on these requested constraints: ${filteredMissingConstraints.join("; ")}.`)
    }
  }
  if (isWriting && writingAssessment?.constraintsMissing.length) {
    missingItems.push(`The rewrite is missing or weak on these requested constraints: ${writingAssessment.constraintsMissing.join("; ")}.`)
  }
  if (uncertaintyHeavy) {
    missingItems.push("The answer uses too much uncertainty for a dependable guide.")
  }

  const success = missingItems.length === 0
  const confidence: AfterAnalysisResult["confidence"] = success
    ? mode === "deep"
      ? "high"
      : "medium"
    : missingItems.length >= 3
      ? "low"
      : "medium"
  const status: AfterAnalysisResult["status"] =
    success ? "SUCCESS" : isCreation && prioritizedCreationIssues.length >= 3 ? "FAILED" : "PARTIAL"

  const checklist = isPromptArtifact && promptArtifactSignals
    ? promptArtifactSignals.checklist
    : [
    {
      label: isCreation
        ? "The answer provides the requested deliverable"
        : isWriting
          ? "The answer provides the requested rewrite"
          : isInstructional
            ? "The answer directly gives the requested instructions"
            : isAdvice || isIdeation
              ? "The answer directly gives relevant ideas for the request"
              : "The answer directly addresses the requested explanation",
      status: directAnswer ? "met" : "missed"
    },
    {
      label: isCreation
        ? "The output matches the requested format and scope"
        : isWriting
          ? "The rewrite matches the requested tone and clarity"
          : isInstructional
            ? "The steps are clear enough to follow"
            : isAdvice || isIdeation
              ? "The ideas are clear and easy to use"
              : "The explanation is clear enough to follow",
      status: clearEnough ? "met" : isCreation && prioritizedCreationIssues.length >= 2 ? "missed" : "not_sure"
    },
    {
      label: isCreation
        ? "The deliverable is complete enough to use as a starting point"
        : isWriting
          ? "The rewritten text is polished enough to use"
          : isInstructional
            ? "The answer is complete enough to use"
            : isAdvice || isIdeation
              ? "The answer offers enough practical variety to use"
              : "The explanation is complete enough to use",
      status:
        completeEnough && !uncertaintyHeavy
          ? "met"
          : isCreation && prioritizedCreationIssues.length >= 3
            ? "missed"
            : missingItems.length
              ? "not_sure"
              : "met"
    }
  ] satisfies AfterAnalysisResult["acceptance_checklist"]

  const findings = success
    ? [
        isPromptArtifact
          ? "The generated prompt keeps the original goal and reads like a usable execution brief."
          : isCreation
          ? "The answer directly provides the requested deliverable."
          : isWriting
            ? "The answer directly provides a usable rewrite."
          :
        isInstructional
          ? "The answer directly provides a usable step-by-step guide."
          : isAdvice
            ? "The answer directly provides usable recommendations for the request."
            : isIdeation
              ? "The answer provides a usable set of ideas to choose from."
          : "The answer directly explains the requested topic in a usable way.",
        mode === "deep"
          ? "Deep review checked the answer for missing steps, ambiguity, and major omissions."
          : "Quick review checked whether the answer was direct, clear, and reasonably complete."
      ]
    : [
        ...(directAnswer ? [] : [isPromptArtifact ? "The generated prompt does not clearly preserve the original goal yet." : "The answer does not fully answer the original question yet."]),
        ...(clearEnough
          ? []
          : [
              isPromptArtifact
                ? "The generated prompt still needs a clearer structure before it is ready to send."
                : isCreation
                ? "The generated output does not clearly match the requested format or scope yet."
                : isWriting
                  ? "The rewrite still does not clearly match the requested tone or polish."
                  : isInstructional
                    ? "The steps are not yet clear enough to follow confidently."
                    : "The explanation is still unclear in important places."
            ]),
        ...(completeEnough
          ? []
          : [
              isPromptArtifact
                ? "The generated prompt is not fully send-ready yet."
                : isCreation
                ? "Important requested parts of the deliverable are still missing."
                : isWriting
                  ? "The rewrite still needs more completeness or polish."
                  : isInstructional
                    ? "Some important steps or details are still missing."
                    : "Some important context or completeness is still missing."
            ])
      ].slice(0, 3)

  const issues = success ? [] : missingItems.slice(0, 4)
  const stage1: Stage1Output = {
    assistant_action_summary: isPromptArtifact
      ? "Provided a structured prompt artifact for the user's request."
      : isCreation
      ? "Provided a generated deliverable for the request."
      : isWriting
        ? "Provided a rewritten version of the text."
        : isInstructional
          ? "Provided step-by-step guidance."
          : isAdvice
            ? "Provided advice-oriented suggestions."
            : isIdeation
              ? "Provided a set of ideas for the request."
              : "Provided an explanatory answer to the user's question.",
    claimed_evidence: success
      ? [
          directAnswer ? (isPromptArtifact ? "The generated prompt preserves the user’s core goal." : "The answer directly addressed the question.") : "",
          clearEnough
            ? isPromptArtifact
              ? "The generated prompt uses a clear structured format."
              : isCreation
              ? "The output matches the requested format closely enough to inspect."
              : isWriting
                ? "The rewrite reads clearly and reflects the requested tone shift."
              : isInstructional
              ? "The answer used a structured set of steps."
              : isAdvice || isIdeation
                ? "The answer presented clear, scannable ideas."
                : "The explanation was presented clearly enough to follow."
            : "",
          completeEnough
            ? isPromptArtifact
              ? "The generated prompt is polished enough to send as-is."
              : isCreation
              ? "The deliverable includes the main requested parts without obvious gaps."
              : isWriting
                ? "The rewritten text is complete enough to use directly."
              : isAdvice || isIdeation
              ? "The answer covered enough practical options without obvious gaps."
              : "The answer covered the main practical details without obvious gaps."
            : ""
        ].filter(Boolean)
      : [],
    response_mode: "explained",
    scope_assessment: "narrow"
  }

  const stage2: Stage2Output = {
    addressed_criteria: checklist.filter((item) => item.status === "met").map((item) => item.label),
    missing_criteria: missingItems,
    constraint_risks: uncertaintyHeavy ? ["The answer still contains ambiguity that could confuse the next step."] : [],
    problem_fit: success ? "correct" : "partial",
    analysis_notes: success
      ? [
          isPromptArtifact
            ? "This was reviewed as a generated prompt artifact, not as a proof-of-fix task."
            : isCreation
            ? "This was reviewed as a generated deliverable, not as a proof-of-fix task."
            : isWriting
              ? "This was reviewed as a rewrite/quality task, not as a proof-of-fix task."
            :
          isInstructional
            ? "This was reviewed as an instructions/usability task, not as an implementation proof task."
            : isAdvice
              ? "This was reviewed as an advice/usability task, not as an implementation proof task."
              : isIdeation
                ? "This was reviewed as an ideation/usability task, not as an implementation proof task."
            : "This was reviewed as an explanation/usability task, not as an implementation proof task."
        ]
      : [
          isPromptArtifact
            ? "The generated prompt should be judged on goal preservation, constraint coverage, structure, and send-ready quality."
            : isCreation
            ? "The answer should be judged on relevance, completeness, and usability of the generated output, not on proof artifacts."
            : isWriting
              ? "The answer should be judged on rewrite quality and tone fit, not on implementation artifacts."
            :
          isInstructional
            ? "The answer should be judged on usability and completeness, not on implementation artifacts."
            : isAdvice
              ? "The answer should be judged on relevance, practicality, and completeness, not on implementation artifacts."
              : isIdeation
                ? "The answer should be judged on idea quality and usefulness, not on implementation artifacts."
            : "The answer should be judged on clarity and completeness, not on implementation artifacts."
        ]
  }

  const verdict: VerdictOutput = {
    status,
    confidence,
    confidence_reason: success
      ? mode === "deep"
        ? isPromptArtifact
          ? "The generated prompt preserves the goal, keeps the important constraints, and is ready to send."
          : "The answer is clear, complete enough, and does not show major omissions."
        : isPromptArtifact
          ? "The generated prompt looks usable and on target."
          : "The answer appears direct and usable for the question that was asked."
      : missingItems[0] || "The answer is not complete enough yet.",
    findings,
    issues
  }

  const followUpPrompt = success
    ? "No retry needed. The answer already addresses the question clearly enough."
    : isPromptArtifact
      ? `Rewrite the generated prompt, but fix only these gaps:\n${missingItems.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
      : isCreation
      ? `Generate this again, but fix only these gaps:\n${missingItems.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
      : isWriting
        ? `Rewrite this again, but fix only these gaps:\n${missingItems.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
    : isInstructional
      ? `Answer this again as a concise step-by-step guide. Fix these gaps only:\n${missingItems.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
      : isAdvice || isIdeation
        ? `Answer this again with more useful, practical suggestions. Fix these gaps only:\n${missingItems.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
      : `Answer this again more clearly and completely. Fix these gaps only:\n${missingItems.map((item, index) => `${index + 1}. ${item}`).join("\n")}`

  return {
    status,
    confidence,
    confidence_reason: verdict.confidence_reason,
    inspection_depth: mode === "deep" ? "targeted_text" : "summary_only",
    findings,
    issues,
    next_prompt: followUpPrompt,
    prompt_strategy: success ? "validate" : "retry_cleanly",
    stage_1: stage1,
    stage_2: stage2,
    verdict,
    next_prompt_output: {
      next_prompt: followUpPrompt,
      prompt_strategy: success ? "validate" : "retry_cleanly"
    },
    acceptance_checklist: checklist,
    response_summary: responseSummary,
    used_fallback_intent: false,
    token_usage_total: 0
  }
}

export function buildReviewTargetKey(target: ReviewTarget) {
  return [
    target.threadIdentity,
    target.attempt.attempt_id,
    target.responseIdentity || "no-response-id",
    target.normalizedResponseText
  ].join("::")
}

export function buildUserSafeReviewErrorMessage(
  reason: "no_response" | "no_submitted_attempt" | "still_updating" | "request_failed" | "unknown"
) {
  switch (reason) {
    case "no_response":
      return "Send a prompt first, then open Review to inspect the assistant's reply."
    case "no_submitted_attempt":
      return "We couldn't match the latest reply to a sent prompt yet. Try again once the thread settles."
    case "still_updating":
      return "The response is still updating. Try again once it settles."
    case "request_failed":
      return "We couldn’t complete the review this time."
    default:
      return "We couldn’t prepare the review right now."
  }
}

export function createReviewAnalysisRunner(input: CreateReviewAnalysisRunnerInput): ReviewAnalysisRunner {
  return async function runReviewAnalysis({ target, mode }) {
    const projectMemory = input.getProjectMemoryContext()
    const responseSummary = input.preprocessResponse(target.responseText) as ResponsePreprocessorOutput
    const changedFiles = input.collectChangedFilesSummary()
    const promptText = target.attempt.optimized_prompt || target.attempt.raw_prompt || target.attempt.intent.goal || ""
    const implementationSignals =
      responseSummary.has_code_blocks ||
      responseSummary.change_claims.length > 0 ||
      responseSummary.mentioned_files.length > 0
    const creationLikeResponse =
      responseSummary.has_code_blocks ||
      responseSummary.mentioned_files.length > 0 ||
      hasHtmlStructure(target.responseText) ||
      hasCssSignals(target.responseText)
    const effectiveTaskType =
      (target.taskType === "implementation" || target.taskType === "writing") &&
      looksLikeCreationRequestPrompt(promptText) &&
      creationLikeResponse
        ? "creation"
        : target.taskType === "implementation" && looksLikeAdviceRequestPrompt(promptText) && !implementationSignals
          ? "advice"
          : target.taskType
    const effectiveTarget =
      effectiveTaskType === target.taskType
        ? target
        : {
            ...target,
            taskType: effectiveTaskType
          }
    const promptArtifactReview = isGeneratedPromptArtifact({
      promptText,
      responseText: effectiveTarget.responseText,
      responseSummary
    })

    if (promptArtifactReview || isAnswerQualityTask(effectiveTarget.taskType)) {
      const informationalResult = buildInformationalReviewResult({
        target: effectiveTarget,
        mode,
        responseSummary
      })

      await input.attachAnalysisResult(
        target.attempt.attempt_id,
        target.responseText,
        informationalResult,
        target.responseIdentity
      )

      return informationalResult
    }

    const rawResult = await input.analyzeAfterAttempt({
      attempt: target.attempt,
      response_summary: responseSummary,
      response_text_fallback: target.responseText,
      deep_analysis: mode === "deep",
      project_context: projectMemory.projectContext,
      current_state: projectMemory.currentState,
      error_summary: input.collectVisibleErrorSummary(),
      changed_file_paths_summary: changedFiles
    })

    const intermediateResult = isDebugContinuation(rawResult, responseSummary, target, mode)
      ? buildDebugContinuationResult(rawResult, target, responseSummary, mode)
      : rawResult
    const forcedPromptArtifactReview =
      promptArtifactReview ||
      isGeneratedPromptArtifact({
        promptText: target.attempt.optimized_prompt || target.attempt.raw_prompt || target.attempt.intent.goal || "",
        responseText: target.responseText,
        responseSummary
      }) ||
      usesPromptQualityChecklist(intermediateResult.acceptance_checklist)
    const forcedAdviceReview =
      effectiveTaskType === "advice" &&
      !implementationSignals &&
      (target.taskType === "implementation" ||
        intermediateResult.acceptance_checklist.some((item) => isProofOrientedChecklistLabel(item.label)))
    const forcedCreationReview =
      effectiveTaskType === "creation" &&
      creationLikeResponse &&
      (target.taskType === "implementation" ||
        target.taskType === "writing" ||
        intermediateResult.acceptance_checklist.some((item) => /rewrite|tone and clarity|polished enough to use/i.test(item.label)))

    if (forcedPromptArtifactReview || forcedAdviceReview || forcedCreationReview) {
      const informationalResult = buildInformationalReviewResult({
        target: effectiveTarget,
        mode,
        responseSummary
      })

      await input.attachAnalysisResult(
        target.attempt.attempt_id,
        target.responseText,
        informationalResult,
        target.responseIdentity
      )

      return informationalResult
    }
    const result =
      mode === "deep"
        ? buildGroundedDeepResult(intermediateResult, target, responseSummary)
        : intermediateResult

    await input.attachAnalysisResult(
      target.attempt.attempt_id,
      target.responseText,
      result,
      target.responseIdentity
    )

    return result
  }
}
