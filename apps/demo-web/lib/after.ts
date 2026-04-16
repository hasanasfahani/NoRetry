import type { ClarificationQuestion } from "@prompt-optimizer/shared"

export function mergeUniqueQuestions(existing: ClarificationQuestion[], incoming: ClarificationQuestion[]) {
  const seen = new Set(existing.map((question) => question.id))
  return [...existing, ...incoming.filter((question) => !seen.has(question.id))]
}

export function buildLevelMap(questions: ClarificationQuestion[], level: number) {
  return Object.fromEntries(questions.map((question) => [question.id, level] as const))
}

function resolvePlannerAnswer(rawValue: string | undefined, otherValue: string | undefined, otherOption: string) {
  if (rawValue === otherOption) return otherValue?.trim() ?? ""
  return rawValue?.trim() ?? ""
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
