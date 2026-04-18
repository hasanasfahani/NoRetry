import { analyzePromptLocally } from "@prompt-optimizer/shared/src/analyzePrompt"
import type {
  AfterAnalysisResult,
  AnalyzePromptResponse,
  Attempt,
  ClarificationQuestion,
  ExtendQuestionsRequest,
  PromptSurface,
  SessionSummary
} from "@prompt-optimizer/shared/src/schemas"
import {
  buildAfterPlaceholder,
  buildPlanningAttemptFromDraft,
  buildInitialPlannerState
} from "../../core/after-orchestration"
import { buildPlanningAttemptIntentFromPrompt } from "../../core/attempt-orchestration"
import { createGoalContract } from "../../goal/goal-contract"
import { normalizeGoalContract } from "../../goal/goal-normalizer"
import type { GoalContract, GoalConstraint } from "../../goal/types"
import { type PromptContract } from "../../prompt/contracts"
import { buildPromptContractFromGoalContract } from "../../prompt/prompt-renderer"

function buildFallbackChecklist(intent: AnalyzePromptResponse["intent"]) {
  switch (intent) {
    case "DEBUG":
      return [
        "Identify the first runtime checkpoint to inspect",
        "Clarify what counts as proof the bug is fixed",
        "Keep the next step narrow and testable"
      ]
    case "BUILD":
      return [
        "Clarify the exact output the first draft must include",
        "Call out the required format or technology",
        "State what makes the draft usable right away"
      ]
    case "EXPLAIN":
      return [
        "Clarify what should be explained first",
        "State the level of detail the answer should use",
        "Keep the explanation tied to the user's actual goal"
      ]
    default:
      return [
        "Clarify the exact outcome the next prompt should request",
        "Capture the most important constraints",
        "Keep the next step focused enough to act on"
      ]
  }
}

function buildFallbackQuestionOptions(intent: AnalyzePromptResponse["intent"]) {
  switch (intent) {
    case "DEBUG":
      return {
        label: "What should the next step confirm first?",
        helper: "Pick the first runtime checkpoint the next prompt should verify before changing more code.",
        options: [
          "The extension loads",
          "The content script attaches",
          "The target element is detected",
          "The UI renders visibly",
          "Other"
        ]
      }
    case "BUILD":
      return {
        label: "What matters most in the first draft?",
        helper: "Pick the first quality bar the next prompt should optimize for.",
        options: [
          "Correct structure first",
          "Requested format first",
          "Usable starter content",
          "Minimal starter only",
          "Other"
        ]
      }
    case "EXPLAIN":
      return {
        label: "What should the next answer optimize first?",
        helper: "Pick the most important quality bar for the next explanation.",
        options: [
          "Direct answer first",
          "Clear steps",
          "Stronger examples",
          "Tighter scope",
          "Other"
        ]
      }
    default:
      return {
        label: "What should the next prompt lock down first?",
        helper: "Pick the first thing the next prompt should make explicit.",
        options: [
          "Exact output",
          "Key constraint",
          "Success criteria",
          "Scope limit",
          "Other"
        ]
      }
  }
}

function goalHasConstraintType(goalContract: GoalContract | null | undefined, types: GoalConstraint["type"][]) {
  if (!goalContract) return false
  return goalContract.hardConstraints.some((item) => types.includes(item.type))
}

function outputRequirementPresent(goalContract: GoalContract | null | undefined, pattern: RegExp) {
  if (!goalContract) return false
  return goalContract.outputRequirements.some((item) => pattern.test(item))
}

function isPriorityStylePreference(goalContract: GoalContract | null | undefined) {
  if (!goalContract) return false
  return goalContract.softPreferences.some((item) => /professional|concise|friendly|clean|practical|tone|audience/i.test(`${item.label} ${item.value ?? ""}`))
}

function topConstraintOptions(goalContract: GoalContract | null | undefined, limit = 4) {
  if (!goalContract) return []
  return uniqueItems(
    goalContract.hardConstraints
      .filter((item) => !["generic", "scope"].includes(item.type))
      .map((item) => toSentenceCase(item.label))
  ).slice(0, limit)
}

function deriveGoalAwareFallbackQuestion(params: {
  promptText: string
  localAnalysis: AnalyzePromptResponse
  goalContract?: GoalContract | null
}) {
  const { promptText, localAnalysis, goalContract } = params
  const promptSnippet = promptText.trim().slice(0, 72)
  const deliverableType = goalContract?.deliverableType ?? ""

  if (!deliverableType) {
    return {
      label: "What kind of result should the next prompt ask for?",
      helper: `Lock down the exact deliverable before sending the next prompt. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
      options: ["Recipe", "Rewrite", "HTML/CSS output", "Recommendation", "Other"]
    }
  }

  if (!goalHasConstraintType(goalContract, ["servings", "count"])) {
    return {
      label: "What serving or count should the next prompt lock down?",
      helper: `Make the requested amount explicit before sending the next prompt. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
      options: ["Single serving", "2 servings", "4 servings", "Exact count matters", "Other"]
    }
  }

  if (!goalHasConstraintType(goalContract, ["time"])) {
    return {
      label: "What time limit should the next prompt enforce?",
      helper: `Clarify the time budget so the next answer stays within it. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
      options: ["5 minutes or less", "15 minutes or less", "30 minutes or less", "Time does not matter", "Other"]
    }
  }

  if (deliverableType === "recipe" && !goalHasConstraintType(goalContract, ["calories", "protein", "diet", "exclusion", "method"])) {
    return {
      label: "Which hard recipe constraint matters most to lock down next?",
      helper: `Pick the next non-negotiable recipe requirement. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
      options: ["Calorie target", "Protein target", "Diet restriction", "Cooking method", "Other"]
    }
  }

  if (deliverableType === "recipe" && (!outputRequirementPresent(goalContract, /\bingredients?\b/i) || !outputRequirementPresent(goalContract, /\bstep[-\s]?by[-\s]?step\b|\binstructions?\b/i))) {
    return {
      label: "Which recipe output sections must the next answer include?",
      helper: `Lock down the recipe output format before sending the next prompt. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
      options: ["Ingredients + steps", "Ingredients + steps + calories", "Ingredients + steps + macros", "Full recipe card", "Other"]
    }
  }

  if ((deliverableType === "html_file" || goalHasConstraintType(goalContract, ["technology", "method"])) && !outputRequirementPresent(goalContract, /\bhtml\b|\bcss\b/i)) {
    return {
      label: "What code artifact should the next prompt make explicit?",
      helper: `Clarify the output artifact so the next answer returns the right code shape. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
      options: ["Full HTML file", "HTML + CSS", "One component only", "JSON/data output", "Other"]
    }
  }

  if (deliverableType === "rewrite" && !isPriorityStylePreference(goalContract)) {
    return {
      label: "Which rewrite quality should the next prompt pin down?",
      helper: `Clarify the rewrite bar before sending the next prompt. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
      options: ["Tone", "Audience", "Length", "Keep meaning exactly", "Other"]
    }
  }

  const prioritizedConstraints = topConstraintOptions(goalContract)
  if (prioritizedConstraints.length >= 2) {
    return {
      label: "Which current requirement is least negotiable?",
      helper: `The goal is already detailed. Pick the highest-value requirement to protect first. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
      options: [...prioritizedConstraints, "Other"].slice(0, 5)
    }
  }

  return buildFallbackQuestionOptions(localAnalysis.intent)
}

function questionMentionsResolvedDimension(question: ClarificationQuestion, goalContract: GoalContract | null | undefined) {
  const text = `${question.label} ${question.helper ?? ""} ${(question.options ?? []).join(" ")}`.toLowerCase()
  if (/\bwhich ai\b|\bchatgpt\b|\bclaude\b|\bgemini\b|\bcopilot\b|\bmodel\b/.test(text)) return true
  if (goalHasConstraintType(goalContract, ["servings", "count"]) && /\bservings?\b|\bhow many people\b|\bhow many meals\b|\bportion\b/.test(text)) return true
  if (goalHasConstraintType(goalContract, ["time"]) && /\bminutes?\b|\btime limit\b|\bhow long\b/.test(text)) return true
  if (goalHasConstraintType(goalContract, ["calories"]) && /\bcalories?\b|\bkcal\b/.test(text)) return true
  if (goalHasConstraintType(goalContract, ["protein"]) && /\bprotein\b/.test(text)) return true
  if (goalHasConstraintType(goalContract, ["diet", "exclusion"]) && /\bdiet\b|\bdairy\b|\bvegan\b|\bvegetarian\b|\bavoid\b|\bexclude\b/.test(text)) return true
  if (goalHasConstraintType(goalContract, ["method", "technology"]) && /\bmicrowave\b|\boven\b|\bstovetop\b|\bgrill\b|\bhtml\b|\bcss\b|\bjavascript\b|\btypescript\b|\breact\b/.test(text)) return true
  if (goalContract?.deliverableType && /\bwhat kind of result\b|\bwhat output\b|\bdeliverable\b/.test(text)) return true
  if (goalContract && goalContract.outputRequirements.length > 0 && /\bingredients?\b|\binstructions?\b|\bsteps?\b|\bmacros?\b|\bformat\b|\bsection\b/.test(text)) return true
  return false
}

function filterGoalAwareQuestions(params: {
  goalContract?: GoalContract | null
  questions: ClarificationQuestion[]
}) {
  const { goalContract, questions } = params
  return questions.filter((question) => !questionMentionsResolvedDimension(question, goalContract))
}

export function buildPromptModeSessionKey(promptText: string) {
  return promptText.replace(/\s+/g, " ").trim().toLowerCase()
}

function mapIntentToPromptIntent(intent: AnalyzePromptResponse["intent"]) {
  return intent ?? "OTHER"
}

function normalizePromptModeAnswers(params: {
  answerState: Record<string, string | string[]>
  otherAnswerState: Record<string, string>
}) {
  const { answerState, otherAnswerState } = params
  return Object.fromEntries(
    Object.entries(answerState)
      .map(([questionId, rawValue]) => [
        questionId,
        Array.isArray(rawValue)
          ? rawValue
              .flatMap((value) => {
                if (value === "Other") {
                  const typedOther = otherAnswerState[questionId]?.trim() ?? ""
                  return typedOther ? [typedOther] : []
                }
                const trimmed = value.trim()
                return trimmed ? [trimmed] : []
              })
              .join(", ")
          : rawValue === "Other"
            ? otherAnswerState[questionId]?.trim() ?? ""
            : rawValue.trim()
      ])
      .filter(([, value]) => value)
  ) as Record<string, string>
}

function toSentenceCase(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ""
  return trimmed[0].toUpperCase() + trimmed.slice(1)
}

function uniqueItems(values: string[]) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))]
}

function stripTrailingPunctuation(value: string) {
  return value.trim().replace(/[.:;\s]+$/, "")
}

function singularizeConstraintTarget(value: string) {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return ""
  if (trimmed.endsWith("ies") && trimmed.length > 4) return `${trimmed.slice(0, -3)}y`
  if (trimmed.endsWith("oes") && trimmed.length > 4) return trimmed.slice(0, -2)
  if (trimmed.endsWith("s") && !trimmed.endsWith("ss") && trimmed.length > 3) return trimmed.slice(0, -1)
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

function normalizeExclusionTarget(value: string) {
  const trimmed = value
    .toLowerCase()
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

function formatExplicitExclusionConstraint(target: string) {
  const normalizedTarget = preferredExclusionTarget(target)
  if (!normalizedTarget) return ""

  if (/\b(?:dairy|nut|egg|gluten|soy)\b/.test(normalizedTarget) && !normalizedTarget.includes(" ")) {
    return `Keep it ${normalizedTarget}-free.`
  }

  return `Do not use ${normalizedTarget}.`
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

function buildPromptModeOutputGuidance(intent: AnalyzePromptResponse["intent"]) {
  switch (intent) {
    case "DEBUG":
      return [
        "State the current issue clearly before proposing changes.",
        "Ask for one focused diagnostic or fix path, not several competing rewrites.",
        "Request concrete confirmation of what changed and how to verify it."
      ]
    case "BUILD":
      return [
        "Turn the draft into a polished build request with a clear deliverable.",
        "Preserve all explicit format, scope, and constraint details.",
        "Ask for a response that is directly usable as a strong first draft."
      ]
    case "EXPLAIN":
      return [
        "Frame the request as a clear explanation goal.",
        "Preserve the chosen depth, examples, and clarity constraints.",
        "Keep the wording natural and direct instead of robotic."
      ]
    default:
      return [
        "Rewrite the draft into a polished, send-ready prompt.",
        "Preserve the real constraints and remove stitched phrasing.",
        "Keep the request focused on one clear next step."
      ]
  }
}

export function buildPromptModePromptPlan(params: {
  sourcePrompt: string
  planningGoal: string
  localAnalysis: AnalyzePromptResponse
  answeredPath: string[]
  constraints: string[]
  projectContext?: string
  currentState?: string
}) {
  const {
    sourcePrompt,
    planningGoal,
    localAnalysis,
    answeredPath,
    constraints,
    projectContext = "",
    currentState = ""
  } = params

  const goalContract = normalizeGoalContract({
    promptText: sourcePrompt,
    taskFamily: mapIntentToPromptIntent(localAnalysis.intent).toLowerCase(),
    answeredPath,
    constraints
  })
  const clarifiedChoices = uniqueItems(answeredPath)
  const retainedConstraints = uniqueItems(goalContract.hardConstraints.map((item) => item.label))
    .concat(uniqueItems(localAnalysis.missing_elements.slice(0, 2).map((item) => `Resolve this clearly: ${item}`)))
    .slice(0, 6)
  const outputGuidance = buildPromptModeOutputGuidance(localAnalysis.intent)
  const outputRequirements = uniqueItems(goalContract.outputRequirements)
  const softPreferences = uniqueItems(goalContract.softPreferences.map((item) => item.value || item.label))

  const basePrompt = [
    "Rewrite the user's typed draft into a strong, polished prompt they can send next.",
    "Keep the original intent, but make the final prompt feel clear, deliberate, and high quality.",
    `Original Draft\n${sourcePrompt.trim()}`,
    `Planning Goal\n${planningGoal.trim()}`,
    goalContract.deliverableType ? `Requested Deliverable\n${goalContract.deliverableType}` : "",
    clarifiedChoices.length
      ? `Clarified Choices\n${clarifiedChoices.map((item, index) => `${index + 1}. ${toSentenceCase(item)}`).join("\n")}`
      : "",
    retainedConstraints.length
      ? `Constraints To Preserve\n${retainedConstraints.map((item, index) => `${index + 1}. ${toSentenceCase(item)}`).join("\n")}`
      : "",
    outputRequirements.length
      ? `Output Requirements\n${outputRequirements.map((item, index) => `${index + 1}. ${toSentenceCase(item)}`).join("\n")}`
      : "",
    softPreferences.length
      ? `Quality Targets\n${softPreferences.map((item, index) => `${index + 1}. ${toSentenceCase(item)}`).join("\n")}`
      : "",
    projectContext.trim() ? `Project Context\n${projectContext.trim()}` : "",
    currentState.trim() ? `Current State\n${currentState.trim()}` : "",
    `Output Guidance\n${outputGuidance.map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
    "Return only the final prompt text. Do not explain your edits."
  ]
    .filter(Boolean)
    .join("\n\n")

  const localFallbackSections = [
    planningGoal.trim(),
    clarifiedChoices.length ? `Requirements:\n${clarifiedChoices.map((item) => `- ${toSentenceCase(item)}`).join("\n")}` : "",
    retainedConstraints.length
      ? `Keep these constraints:\n${retainedConstraints.map((item) => `- ${toSentenceCase(item)}`).join("\n")}`
      : "",
    outputRequirements.length
      ? `Output requirements:\n${outputRequirements.map((item) => `- ${toSentenceCase(item)}`).join("\n")}`
      : "",
    projectContext.trim() ? `Context:\n${projectContext.trim()}` : "",
    currentState.trim() ? `Current state:\n${currentState.trim()}` : ""
  ].filter(Boolean)

  const localFallback = `${localFallbackSections.join("\n\n")}\n\nReturn only the finished result in a polished, ready-to-use form.`

  return {
    basePrompt,
    localFallback
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
  return buildPromptModePromptContract(params).renderedPrompt
}

export function buildPromptModePromptContract(params: {
  sourcePrompt: string
  planningGoal: string
  refinedPrompt: string
  localAnalysis: AnalyzePromptResponse
  answeredPath: string[]
  constraints: string[]
}): PromptContract {
  const { sourcePrompt, planningGoal, refinedPrompt, localAnalysis, answeredPath, constraints } = params
  const renderedPrompt = refinedPrompt || planningGoal || sourcePrompt
  const sourceGoalContract = normalizeGoalContract({
    promptText: sourcePrompt,
    taskFamily: mapIntentToPromptIntent(localAnalysis.intent).toLowerCase(),
    answeredPath,
    constraints
  })
  const renderedGoalContract = normalizeGoalContract({
    promptText: renderedPrompt,
    taskFamily: mapIntentToPromptIntent(localAnalysis.intent).toLowerCase(),
    answeredPath,
    constraints
  })
  const goalContract = createGoalContract({
    ...sourceGoalContract,
    userGoal: renderedGoalContract.userGoal,
    deliverableType: renderedGoalContract.deliverableType || sourceGoalContract.deliverableType,
    hardConstraints: [...sourceGoalContract.hardConstraints, ...renderedGoalContract.hardConstraints],
    softPreferences: [...sourceGoalContract.softPreferences, ...renderedGoalContract.softPreferences],
    outputRequirements: [...sourceGoalContract.outputRequirements, ...renderedGoalContract.outputRequirements],
    assumptions: [...sourceGoalContract.assumptions, ...renderedGoalContract.assumptions],
    riskFlags: [...sourceGoalContract.riskFlags, ...renderedGoalContract.riskFlags]
  })

  return buildPromptContractFromGoalContract(goalContract)
}

export function buildPromptModeSeedAnalysis(params: {
  promptText: string
  platform: Attempt["platform"]
  beforeIntent: AnalyzePromptResponse["intent"] | null | undefined
  sessionSummary?: Partial<SessionSummary> | null
}) {
  const { promptText, platform, beforeIntent, sessionSummary } = params
  const localAnalysis = analyzePromptLocally(promptText, sessionSummary ?? undefined)
  const checklistLabels = (localAnalysis.missing_elements.length
    ? localAnalysis.missing_elements
    : buildFallbackChecklist(localAnalysis.intent)
  )
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3)

  const base = buildAfterPlaceholder(
    `Planning the next prompt around this goal: ${promptText.trim()}`,
    checklistLabels.length
      ? [`Clarify the strongest missing part first: ${checklistLabels[0]}`]
      : ["Clarify the next step before sending the prompt."],
    ""
  )

  const planningAttempt = buildPlanningAttemptFromDraft(
    promptText,
    platform,
    buildPlanningAttemptIntentFromPrompt({
      prompt: promptText,
      beforeIntent
    })
  )

  const seed: AfterAnalysisResult = {
    ...base,
    status: "PARTIAL",
    confidence: checklistLabels.length > 1 ? "medium" : "high",
    confidence_reason: checklistLabels.length
      ? `The next prompt still needs sharper guidance around: ${checklistLabels[0]}.`
      : "The next prompt can still be sharpened before sending.",
    findings: [`Use the typed draft as the direction for the next-step tree.`],
    issues: checklistLabels.map((item) => `Clarify: ${item}`),
    prompt_strategy: "narrow_scope",
    stage_1: {
      assistant_action_summary: "reeva AI is shaping the next prompt before it is sent.",
      claimed_evidence: checklistLabels,
      response_mode: "suggested",
      scope_assessment: "moderate"
    },
    stage_2: {
      addressed_criteria: [],
      missing_criteria: checklistLabels,
      constraint_risks: [],
      problem_fit: "correct",
      analysis_notes: localAnalysis.suggestions.slice(0, 3)
    },
    verdict: {
      status: "PARTIAL",
      confidence: checklistLabels.length > 1 ? "medium" : "high",
      confidence_reason: checklistLabels.length
        ? `The draft direction still leaves ${checklistLabels[0].toLowerCase()} unclear.`
        : "The draft direction can still be sharpened.",
      findings: [`Use the typed draft as the planning goal.`],
      issues: checklistLabels.map((item) => `Clarify: ${item}`)
    },
    next_prompt_output: {
      next_prompt: "",
      prompt_strategy: "narrow_scope",
      next_prompt_explanation: "",
      expected_outcome: ""
    },
    acceptance_checklist: checklistLabels.map((label) => ({
      label,
      status: "not_sure" as const
    })),
    used_fallback_intent: true
  }

  return {
    localAnalysis,
    planningAttempt,
    seedAnalysis: seed
  }
}

export function buildPromptModeFallbackQuestions(params: {
  promptText: string
  localAnalysis: AnalyzePromptResponse
  goalContract?: GoalContract | null
}) {
  const { promptText, localAnalysis, goalContract } = params
  const template = deriveGoalAwareFallbackQuestion({
    promptText,
    localAnalysis,
    goalContract
  })
  const question: ClarificationQuestion = {
    id: `prompt-${crypto.randomUUID()}`,
    label: template.label,
    helper: template.helper,
    mode: "single",
    options: template.options
  }

  return buildInitialPlannerState([question], 1)
}

export function buildPromptModeQuestionRequest(params: {
  promptText: string
  localAnalysis: AnalyzePromptResponse
  existingQuestions: ClarificationQuestion[]
  answerState: Record<string, string | string[]>
  otherAnswerState: Record<string, string>
  surface: PromptSurface
  sessionSummary?: Partial<SessionSummary> | null
}): ExtendQuestionsRequest {
  const { promptText, localAnalysis, existingQuestions, answerState, otherAnswerState, surface, sessionSummary } = params
  const normalizedAnswers = normalizePromptModeAnswers({
    answerState,
    otherAnswerState
  })

  return {
    prompt: promptText,
    surface,
    intent: mapIntentToPromptIntent(localAnalysis.intent),
    existing_questions: existingQuestions,
    answers: {
      planning_goal: promptText,
      ...normalizedAnswers
    },
    sessionSummary: sessionSummary ?? undefined
  }
}

export function selectPromptModeQuestions(params: {
  goalContract?: GoalContract | null
  localAnalysis: AnalyzePromptResponse
  questions: ClarificationQuestion[]
  promptText: string
}) {
  const filtered = filterGoalAwareQuestions({
    goalContract: params.goalContract,
    questions: params.questions
  })

  if (filtered.length) return filtered
  return buildPromptModeFallbackQuestions({
    promptText: params.promptText,
    localAnalysis: params.localAnalysis,
    goalContract: params.goalContract
  }).questionHistory
}
