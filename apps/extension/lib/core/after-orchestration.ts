import type {
  AfterAnalysisResult,
  Attempt,
  AttemptIntent,
  AfterNextQuestionRequest,
  ClarificationQuestion,
  PromptIntent
} from "@prompt-optimizer/shared/src/schemas"

export function buildAfterPlaceholder(
  finding: string,
  issues: string[] = [],
  nextPrompt = ""
): AfterAnalysisResult {
  return {
    status: "UNVERIFIED",
    confidence: "low",
    confidence_reason: issues[0] || "",
    inspection_depth: "summary_only",
    findings: [finding],
    issues,
    next_prompt: nextPrompt,
    prompt_strategy: "retry_cleanly",
    stage_1: {
      assistant_action_summary: finding,
      claimed_evidence: [],
      response_mode: "uncertain",
      scope_assessment: "moderate"
    },
    stage_2: {
      addressed_criteria: [],
      missing_criteria: [],
      constraint_risks: issues,
      problem_fit: "partial",
      analysis_notes: []
    },
    verdict: {
      status: "UNVERIFIED",
      confidence: "low",
      confidence_reason: issues[0] || "",
      findings: [finding],
      issues
    },
    next_prompt_output: {
      next_prompt: nextPrompt,
      prompt_strategy: "retry_cleanly"
    },
    acceptance_checklist: [],
    review_contract: {
      version: "v1",
      target_signature: "",
      goal: finding,
      criteria: []
    },
    response_summary: {
      response_text: "",
      response_length: 0,
      first_excerpt: "",
      last_excerpt: "",
      key_paragraphs: [],
      has_code_blocks: false,
      mentioned_files: [],
      change_claims: [],
      validation_signals: [],
      certainty_signals: [],
      uncertainty_signals: [],
      success_signals: [],
      failure_signals: []
    },
    used_fallback_intent: true,
    token_usage_total: 0
  }
}

export function hasRealAfterReview(verdict: AfterAnalysisResult | null) {
  if (!verdict) return false
  return verdict.response_summary.response_length > 0 || (verdict.acceptance_checklist?.length ?? 0) > 0
}

export function mapTaskTypeToPromptIntent(taskType: AttemptIntent["task_type"]): PromptIntent {
  switch (taskType) {
    case "debug":
      return "DEBUG"
    case "build":
      return "BUILD"
    case "refactor":
      return "REFACTOR"
    case "explain":
      return "EXPLAIN"
    case "create_ui":
      return "DESIGN_UI"
    default:
      return "OTHER"
  }
}

export function mergeUniqueQuestions(existing: ClarificationQuestion[], incoming: ClarificationQuestion[]) {
  const seen = new Set(existing.map((question) => question.id))
  return [...existing, ...incoming.filter((question) => !seen.has(question.id))]
}

export function buildLevelMap(questions: ClarificationQuestion[], level: number) {
  return Object.fromEntries(questions.map((question) => [question.id, level] as const))
}

export function buildPlanningAttemptFromDraft(
  promptText: string,
  platform: Attempt["platform"],
  intent: AttemptIntent
): Attempt {
  const trimmedPrompt = promptText.trim()
  const now = new Date().toISOString()

  return {
    attempt_id: crypto.randomUUID(),
    platform,
    raw_prompt: trimmedPrompt,
    optimized_prompt: trimmedPrompt,
    intent,
    status: "draft",
    created_at: now,
    submitted_at: null,
    response_text: null,
    response_message_id: null,
    analysis_result: null,
    token_usage_total: 0,
    stage_cache: {}
  }
}

export function appendPlanningDirection(current: string, nextDirection: string) {
  const trimmedCurrent = current.trim()
  const trimmedNext = nextDirection.trim()
  if (!trimmedNext) return trimmedCurrent
  if (!trimmedCurrent) return `1. ${trimmedNext.replace(/^\d+\.\s*/, "")}`

  const lines = trimmedCurrent
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  const normalizedNext = trimmedNext.replace(/^\d+\.\s*/, "")
  const existingNormalized = lines.map((line) => line.replace(/^\d+\.\s*/, ""))
  if (existingNormalized.includes(normalizedNext)) {
    return trimmedCurrent
  }

  const renumbered = [...existingNormalized, normalizedNext].map((line, index) => `${index + 1}. ${line}`)
  return renumbered.join("\n")
}

export function buildSuggestedDirectionChips(
  verdict: AfterAnalysisResult | null,
  usedSuggestedDirectionChipIds: string[]
) {
  if (!verdict || !verdict.acceptance_checklist?.length) return []

  return verdict.acceptance_checklist
    .filter((item) => item.status !== "met")
    .filter((item) => !usedSuggestedDirectionChipIds.includes(item.label))
    .slice(0, 4)
    .map((item) => ({
      id: item.label,
      label: `${
        item.status === "missed" ? "Fix" : "Double-check"
      } ${item.label.charAt(0).toLowerCase()}${item.label.slice(1)}`,
      actionStyle: item.status === "missed" ? "fix" : "double-check"
    }))
}

export function prunePlannerBranch(params: {
  startIndex: number
  questionHistory: ClarificationQuestion[]
  questionLevels: Record<string, number>
  answerState: Record<string, string>
  otherAnswerState: Record<string, string>
}) {
  const { startIndex, questionHistory, questionLevels, answerState, otherAnswerState } = params
  const keptHistory = questionHistory.slice(0, startIndex + 1)
  const activeQuestion = keptHistory[startIndex]
  const activeLevel = activeQuestion ? questionLevels[activeQuestion.id] ?? 1 : 1

  const keepQuestionId = (questionId: string) => {
    const questionIndex = keptHistory.findIndex((item) => item.id === questionId)
    return questionIndex >= 0 && questionIndex <= startIndex
  }

  return {
    keptHistory,
    activeLevel,
    currentLevelQuestions: keptHistory.filter((question) => (questionLevels[question.id] ?? 1) === activeLevel),
    answerState: Object.fromEntries(Object.entries(answerState).filter(([questionId]) => keepQuestionId(questionId))),
    otherAnswerState: Object.fromEntries(
      Object.entries(otherAnswerState).filter(([questionId]) => keepQuestionId(questionId))
    ),
    questionLevels: Object.fromEntries(
      Object.entries(questionLevels).filter(([questionId]) => keepQuestionId(questionId))
    ),
    activeQuestionIndex: startIndex
  }
}

export function resolvePlannerAnswer(rawValue: string | undefined, otherValue: string | undefined, otherOption: string) {
  if (rawValue === otherOption) return otherValue?.trim() ?? ""
  return rawValue?.trim() ?? ""
}

export function shouldRebuildPlannerBranch(params: {
  questionIndex: number
  totalQuestions: number
  previousResolvedValue: string
  nextResolvedValue: string
}) {
  const { questionIndex, totalQuestions, previousResolvedValue, nextResolvedValue } = params
  return (
    questionIndex >= 0 &&
    questionIndex < totalQuestions - 1 &&
    previousResolvedValue.trim().length > 0 &&
    previousResolvedValue !== nextResolvedValue
  )
}

export function findNextUnansweredQuestionIndex(params: {
  currentLevelQuestions: ClarificationQuestion[]
  answerState: Record<string, string>
  otherAnswerState: Record<string, string>
  otherOption: string
}) {
  const { currentLevelQuestions, answerState, otherAnswerState, otherOption } = params
  return currentLevelQuestions.findIndex((question) => {
    const rawValue = answerState[question.id]
    const resolvedValue = resolvePlannerAnswer(rawValue, otherAnswerState[question.id], otherOption)
    return !rawValue || (rawValue === otherOption && !resolvedValue)
  })
}

export function normalizePlannerAnswers(params: {
  answerState: Record<string, string>
  otherAnswerState: Record<string, string>
  otherOption: string
}) {
  const { answerState, otherAnswerState, otherOption } = params
  return Object.fromEntries(
    Object.entries(answerState)
      .map(([questionId, rawValue]) => [
        questionId,
        resolvePlannerAnswer(rawValue, otherAnswerState[questionId], otherOption)
      ])
      .filter(([, value]) => typeof value === "string" && value.trim())
  ) as Record<string, string>
}

export function buildOrderedAnsweredPath(params: {
  questionHistory: ClarificationQuestion[]
  answerState: Record<string, string>
  otherAnswerState: Record<string, string>
  otherOption: string
}) {
  const { questionHistory, answerState, otherAnswerState, otherOption } = params
  return questionHistory
    .map((question) => {
      const resolvedValue = resolvePlannerAnswer(answerState[question.id], otherAnswerState[question.id], otherOption)
      if (!resolvedValue) return ""
      return `${question.label}: ${resolvedValue}`
    })
    .filter(Boolean)
}

export function buildAfterNextPromptPlan(params: {
  submittedPrompt: string
  planningGoal: string
  verdict: AfterAnalysisResult
  answeredPath: string[]
  constraints: string[]
  projectContext?: string
  currentState?: string
}) {
  const { submittedPrompt, planningGoal, verdict, answeredPath, constraints, projectContext = "", currentState = "" } = params

  const unmetChecklist = (verdict.acceptance_checklist ?? [])
    .filter((item) => item.status !== "met")
    .map((item) => item.label.trim())
    .filter(Boolean)

  const focusItems = [
    ...answeredPath,
    ...unmetChecklist.map((item) => `Cover this unmet requirement: ${item}`)
  ]
    .filter(Boolean)
    .slice(0, 6)

  const keepItems = [...constraints.filter(Boolean), "Do not broaden the scope beyond the chosen next step."]
    .filter(Boolean)
    .slice(0, 4)

  const outputItems = [
    "Write a send-ready next prompt.",
    "Use short sections and numbered focus points when helpful.",
    "Do not mostly repeat the original prompt.",
    "Keep only the original details that still matter for this next move."
  ]

  const basePrompt = [
    "Write a fresh next prompt for the AI assistant.",
    `Goal\n${planningGoal.trim()}`,
    projectContext.trim() ? `Project Context\n${projectContext.trim()}` : "",
    currentState.trim() ? `Current State\n${currentState.trim()}` : "",
    focusItems.length ? `Focus On\n${focusItems.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "",
    keepItems.length ? `Keep These Constraints\n${keepItems.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "",
    `Original Prompt Context\n${submittedPrompt}`,
    `Analysis Context\nStatus: ${verdict.status}\n${verdict.findings.length ? `Findings: ${verdict.findings.join("; ")}` : ""}\n${verdict.issues.length ? `Issues: ${verdict.issues.join("; ")}` : ""}`.trim(),
    `Output Requirements\n${outputItems.map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
    "Return only the final prompt text the user should send next."
  ]
    .filter(Boolean)
    .join("\n\n")

  const localFallback = [
    planningGoal.trim(),
    projectContext.trim() ? `Project context:\n${projectContext.trim()}` : "",
    currentState.trim() ? `Current state:\n${currentState.trim()}` : "",
    focusItems.length ? `Focus on:\n${focusItems.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "",
    keepItems.length ? `Keep these constraints:\n${keepItems.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "",
    "Return only the updated result for this step."
  ]
    .filter(Boolean)
    .join("\n\n")

  return {
    focusItems,
    keepItems,
    outputItems,
    basePrompt,
    localFallback
  }
}

export function buildSuggestedDirectionRewritePrompt(params: {
  originalPrompt: string
  acceptanceCriterion: string
  confidence: AfterAnalysisResult["confidence"]
  actionStyle: "fix" | "double-check"
  currentDirection: string
}) {
  const { originalPrompt, acceptanceCriterion, confidence, actionStyle, currentDirection } = params
  const actionVerb = actionStyle === "fix" ? "fix" : "double-check and, if needed, fix"

  return [
    "Turn this unmet acceptance criterion into one concise next-step direction for the user.",
    `Original submitted prompt: ${originalPrompt.trim()}`,
    `Acceptance criterion: ${acceptanceCriterion}`,
    `Confidence: ${confidence}`,
    `Action style: ${actionVerb}`,
    currentDirection ? `Current direction draft: ${currentDirection.trim()}` : "",
    "Write one short imperative direction the user can take next.",
    "Do not repeat the whole original prompt.",
    "Return only the rewritten direction."
  ]
    .filter(Boolean)
    .join("\n\n")
}

export function buildAfterQuestionRequest(params: {
  attempt: Attempt
  analysis: AfterAnalysisResult
  askedQuestions: ClarificationQuestion[]
  questionLevels: Record<string, number>
  answers: Record<string, string>
  planningGoal: string
  projectContext?: string
  currentState?: string
  currentLevel: number
  requestKind: AfterNextQuestionRequest["request_kind"]
}): AfterNextQuestionRequest {
  const {
    attempt,
    analysis,
    askedQuestions,
    questionLevels,
    answers,
    planningGoal,
    projectContext = "",
    currentState = "",
    currentLevel,
    requestKind
  } = params

  return {
    attempt,
    analysis,
    asked_questions: askedQuestions,
    question_levels: questionLevels,
    answers,
    planning_goal: planningGoal,
    project_context: projectContext,
    current_state: currentState,
    current_level: currentLevel,
    request_kind: requestKind
  }
}

export function buildInitialPlannerState(questions: ClarificationQuestion[], level: number) {
  return {
    questionHistory: questions,
    currentLevelQuestions: questions,
    questionLevels: buildLevelMap(questions, level),
    currentLevel: level,
    activeQuestionIndex: 0
  }
}

export function buildPlannerAdvanceResult(params: {
  questionId: string
  resolvedValue: string
  answerState: Record<string, string>
  otherAnswerState: Record<string, string>
  visibleLevelQuestions: ClarificationQuestion[]
  visibleHistory: ClarificationQuestion[]
  visibleLevel: number
  questionLevels: Record<string, number>
  otherOption: string
}) {
  const {
    questionId,
    resolvedValue,
    answerState,
    otherAnswerState,
    visibleLevelQuestions,
    visibleHistory,
    visibleLevel,
    questionLevels,
    otherOption
  } = params

  const mergedAnswers = {
    ...answerState,
    [questionId]: resolvePlannerAnswer(resolvedValue, otherAnswerState[questionId], otherOption)
  }

  const nextIndex = findNextUnansweredQuestionIndex({
    currentLevelQuestions: visibleLevelQuestions,
    answerState: mergedAnswers,
    otherAnswerState,
    otherOption
  })

  if (nextIndex >= 0) {
    return {
      kind: "advance_local" as const,
      nextIndex,
      mergedAnswers
    }
  }

  return {
    kind: "request_next_level" as const,
    mergedAnswers,
    normalizedAnswers: normalizePlannerAnswers({
      answerState: mergedAnswers,
      otherAnswerState,
      otherOption
    }),
    askedQuestions: mergeUniqueQuestions(visibleHistory, visibleLevelQuestions),
    currentLevel: visibleLevel,
    questionLevels
  }
}

export function buildPlannerBranchContext(params: {
  questionId: string
  questionHistory: ClarificationQuestion[]
  questionLevels: Record<string, number>
}) {
  const { questionId, questionHistory, questionLevels } = params
  const questionIndex = questionHistory.findIndex((item) => item.id === questionId)
  const activeLevel = questionLevels[questionId] ?? 1
  const keptHistory = questionIndex >= 0 ? questionHistory.slice(0, questionIndex + 1) : questionHistory
  const keptLevelQuestions = keptHistory.filter((item) => (questionLevels[item.id] ?? 1) === activeLevel)

  return {
    questionIndex,
    activeLevel,
    keptHistory,
    keptLevelQuestions
  }
}

export function buildNextPromptAnswers(params: {
  answerState: Record<string, string>
  otherAnswerState: Record<string, string>
  otherOption: string
  planningGoal: string
}) {
  const { answerState, otherAnswerState, otherOption, planningGoal } = params
  const answers = normalizePlannerAnswers({
    answerState,
    otherAnswerState,
    otherOption
  })

  if (planningGoal.trim()) {
    answers.planning_goal = planningGoal.trim()
  }

  return answers
}

export function buildSuggestedDirectionFallback(params: {
  criterion: string
  actionStyle: "fix" | "double-check"
}) {
  const { criterion, actionStyle } = params
  return actionStyle === "fix"
    ? `Fix this missing requirement: ${criterion}`
    : `Double-check and fix if needed: ${criterion}`
}
