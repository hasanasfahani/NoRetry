import type { ClarificationQuestion } from "./schemas"

export function mergeUniqueQuestions(existing: ClarificationQuestion[], incoming: ClarificationQuestion[]) {
  const seen = new Set(existing.map((question) => question.id))
  return [...existing, ...incoming.filter((question) => !seen.has(question.id))]
}

export function buildLevelMap(questions: ClarificationQuestion[], level: number) {
  return Object.fromEntries(questions.map((question) => [question.id, level] as const))
}

function resolvePlannerAnswer(rawValue: string | string[] | undefined, otherValue: string | undefined, otherOption: string) {
  if (Array.isArray(rawValue)) {
    return rawValue
      .flatMap((value) => {
        if (value === otherOption) {
          const typedOther = otherValue?.trim() ?? ""
          return typedOther ? [typedOther] : []
        }
        const trimmed = value.trim()
        return trimmed ? [trimmed] : []
      })
      .join(", ")
  }
  if (rawValue === otherOption) return otherValue?.trim() ?? ""
  return rawValue?.trim() ?? ""
}

export function findNextUnansweredQuestionIndex(params: {
  currentLevelQuestions: ClarificationQuestion[]
  answerState: Record<string, string | string[]>
  otherAnswerState: Record<string, string>
  otherOption: string
}) {
  const { currentLevelQuestions, answerState, otherAnswerState, otherOption } = params
  return currentLevelQuestions.findIndex((question) => {
    const rawValue = answerState[question.id]
    const resolvedValue = resolvePlannerAnswer(rawValue, otherAnswerState[question.id], otherOption)
    if (Array.isArray(rawValue)) {
      return rawValue.length === 0 || (rawValue.includes(otherOption) && !resolvedValue)
    }
    return !rawValue || (rawValue === otherOption && !resolvedValue)
  })
}

export function normalizePlannerAnswers(params: {
  answerState: Record<string, string | string[]>
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
