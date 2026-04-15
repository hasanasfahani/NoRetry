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

export function buildPromptModeSessionKey(promptText: string) {
  return promptText.replace(/\s+/g, " ").trim().toLowerCase()
}

function mapIntentToPromptIntent(intent: AnalyzePromptResponse["intent"]) {
  return intent ?? "OTHER"
}

function normalizePromptModeAnswers(params: {
  answerState: Record<string, string>
  otherAnswerState: Record<string, string>
}) {
  const { answerState, otherAnswerState } = params
  return Object.fromEntries(
    Object.entries(answerState)
      .map(([questionId, rawValue]) => [
        questionId,
        rawValue === "Other" ? otherAnswerState[questionId]?.trim() ?? "" : rawValue.trim()
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

function looksLikeConstraint(value: string) {
  const normalized = value.toLowerCase()
  return /no |without |exclude|only|under |less|stovetop|minutes?|servings?|for \d+|limit|keep|must|do not|avoid/.test(normalized)
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

  const excludeMatch = normalized.match(/(?:exclude|without|no)\s+([a-z][a-z\s-]+)/i)
  if (excludeMatch) constraints.push(`Do not use ${stripTrailingPunctuation(excludeMatch[1])}.`)

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
        style: ["Keep the request clear, specific, and easy for the AI assistant to follow."]
      }
  }
}

function buildSection(title: string, items: string[]) {
  if (!items.length) return ""
  return `${title}:\n${items.map((item) => `- ${normalizeBulletText(item)}`).join("\n")}`
}

function normalizeBulletText(value: string) {
  const trimmed = stripTrailingPunctuation(value)
  if (!trimmed) return ""
  return /[.!?]$/.test(value.trim()) ? value.trim() : `${trimmed}.`
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

  const clarifiedChoices = uniqueItems(answeredPath)
  const retainedConstraints = uniqueItems([
    ...constraints,
    ...localAnalysis.missing_elements.slice(0, 2).map((item) => `Resolve this clearly: ${item}`)
  ]).slice(0, 5)
  const outputGuidance = buildPromptModeOutputGuidance(localAnalysis.intent)

  const basePrompt = [
    "Rewrite the user's typed draft into a strong, polished prompt they can send next.",
    "Keep the original intent, but make the final prompt feel clear, deliberate, and high quality.",
    `Original Draft\n${sourcePrompt.trim()}`,
    `Planning Goal\n${planningGoal.trim()}`,
    clarifiedChoices.length
      ? `Clarified Choices\n${clarifiedChoices.map((item, index) => `${index + 1}. ${toSentenceCase(item)}`).join("\n")}`
      : "",
    retainedConstraints.length
      ? `Constraints To Preserve\n${retainedConstraints.map((item, index) => `${index + 1}. ${toSentenceCase(item)}`).join("\n")}`
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
  ]).map(normalizeBulletText)

  const sections = [
    `Task / goal:\n${taskLine}`,
    buildSection("Key requirements", keyRequirements),
    buildSection("Constraints", preservedConstraints),
    buildSection("Required inputs or ingredients", requiredInputs),
    buildSection("Output format", outputFormat),
    buildSection("Quality bar / style guardrails", style)
  ].filter(Boolean)

  return sections.join("\n\n")
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
      assistant_action_summary: "NoRetry is shaping the next prompt before it is sent.",
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
      prompt_strategy: "narrow_scope"
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

  return buildInitialPlannerState([question], 1)
}

export function buildPromptModeQuestionRequest(params: {
  promptText: string
  localAnalysis: AnalyzePromptResponse
  existingQuestions: ClarificationQuestion[]
  answerState: Record<string, string>
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
