import type { AnalysisAnswerModel } from "./analysis-answer-model"
import type { AnalysisRequestModel } from "./analysis-request-model"
import type { ReviewAnalysisJudgment } from "./contracts"

export const ANALYSIS_JUDGE_PROMPT_VERSION = "analysis-smart-judge.v2.1"

export type AnalysisJudgeConfidence = "high" | "medium" | "low"

export type AnalysisJudgeResult = {
  promptVersion: string
  working: string[]
  gaps: string[]
  nextMove: string
  noRetryNeeded: boolean
  confidence: AnalysisJudgeConfidence
  judgeNotes: string[]
  verdicts: ReviewAnalysisJudgment[]
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value) as Partial<AnalysisJudgeResult>
  } catch {
    const fenced = value.match(/```json\s*([\s\S]+?)```/i)
    if (!fenced?.[1]) return null
    try {
      return JSON.parse(fenced[1]) as Partial<AnalysisJudgeResult>
    } catch {
      return null
    }
  }
}

export function buildAnalysisJudgePrompt(params: {
  requestModel: AnalysisRequestModel
  answerModel: AnalysisAnswerModel
  working: string[]
  gaps: string[]
  baselineVerdicts: ReviewAnalysisJudgment[]
}) {
  const { requestModel, answerModel, working, gaps, baselineVerdicts } = params
  const sections = [
    `Prompt version: ${ANALYSIS_JUDGE_PROMPT_VERSION}`,
    "Judge whether the assistant answer satisfies the request.",
    "Prefer `unclear` over guessing. Do not invent missing requirements. Preserve anything clearly met.",
    "Judge the literal request first. Do not silently raise the bar because the topic looks technical or software-related.",
    "For broad or underspecified prompts, prefer `noRetryNeeded: true` when the answer is directionally correct and reasonably complete.",
    "Use the structured models below, not raw paraphrase.",
    `Request model:\n${JSON.stringify(requestModel, null, 2)}`,
    `Answer model:\n${JSON.stringify(answerModel, null, 2)}`,
    working.length ? `Current confirmed items:\n${working.map((item) => `- ${item}`).join("\n")}` : "",
    gaps.length ? `Current possible gaps:\n${gaps.map((item) => `- ${item}`).join("\n")}` : "",
    baselineVerdicts.length
      ? `Baseline judgments:\n${JSON.stringify(
          baselineVerdicts.map((verdict) => ({
            id: verdict.id,
            section: verdict.section,
            label: verdict.label,
            status: verdict.status,
            confidence: verdict.confidence,
            usefulness: verdict.usefulness,
            requestEvidence: verdict.requestEvidence,
            answerEvidence: verdict.answerEvidence
          })),
          null,
          2
        )}`
      : "",
    [
      "Return JSON only with this exact shape:",
      "{",
      `  "promptVersion": "${ANALYSIS_JUDGE_PROMPT_VERSION}",`,
      '  "working": string[],',
      '  "gaps": string[],',
      '  "nextMove": string,',
      '  "noRetryNeeded": boolean,',
      '  "confidence": "high" | "medium" | "low",',
      '  "judgeNotes": string[],',
      '  "verdicts": Array<{',
      '    "id": string,',
      '    "section": "taskGoal" | "requirements" | "constraints" | "acceptanceCriteria" | "actualOutputToEvaluate",',
      '    "label": string,',
      '    "status": "met" | "missing" | "unclear" | "contradicted",',
      '    "confidence": "high" | "medium" | "low",',
      '    "usefulness": number,',
      '    "rationale": string,',
      '    "requestEvidence": Array<{ "source": "request" | "answer" | "review", "snippet": string, "lineStart": number, "lineEnd": number }>,',
      '    "answerEvidence": Array<{ "source": "request" | "answer" | "review", "snippet": string, "lineStart": number, "lineEnd": number }>',
      "  }>",
      "}"
    ].join("\n")
  ].filter(Boolean)

  return sections.join("\n\n")
}

export async function runAnalysisLlmJudge(input: {
  requestModel: AnalysisRequestModel
  answerModel: AnalysisAnswerModel
  working: string[]
  gaps: string[]
  baselineVerdicts: ReviewAnalysisJudgment[]
  taskType: string
  judgePrompt?: (input: {
    prompt: string
    answers: Record<string, string>
    taskType: string
  }) => Promise<string | null>
}): Promise<AnalysisJudgeResult | null> {
  if (!input.judgePrompt) return null

  const prompt = buildAnalysisJudgePrompt({
    requestModel: input.requestModel,
    answerModel: input.answerModel,
    working: input.working,
    gaps: input.gaps,
    baselineVerdicts: input.baselineVerdicts
  })
  const response = await input.judgePrompt({
    prompt,
    answers: {
      artifact_family: input.requestModel.artifactFamily,
      request_summary: input.requestModel.taskGoal.join(" | "),
      answer_summary: input.answerModel.rawAnswer.slice(0, 1000)
    },
    taskType: input.taskType
  })

  if (!response) return null
  const parsed = safeJsonParse(response)
  if (!parsed) return null

  return {
    promptVersion: typeof parsed.promptVersion === "string" ? parsed.promptVersion : ANALYSIS_JUDGE_PROMPT_VERSION,
    working: Array.isArray(parsed.working) ? parsed.working.filter((item): item is string => typeof item === "string").slice(0, 8) : [],
    gaps: Array.isArray(parsed.gaps) ? parsed.gaps.filter((item): item is string => typeof item === "string").slice(0, 8) : [],
    nextMove: typeof parsed.nextMove === "string" ? parsed.nextMove.trim() : "",
    noRetryNeeded: Boolean(parsed.noRetryNeeded),
    confidence:
      parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low"
        ? parsed.confidence
        : "low",
    judgeNotes: Array.isArray(parsed.judgeNotes)
      ? parsed.judgeNotes.filter((item): item is string => typeof item === "string").slice(0, 6)
      : [],
    verdicts: Array.isArray(parsed.verdicts)
      ? parsed.verdicts
          .filter((item) => typeof item === "object" && item !== null)
          .map((item, index) => {
            const candidate = item as Record<string, unknown>
            const section: ReviewAnalysisJudgment["section"] =
              candidate.section === "taskGoal" ||
              candidate.section === "requirements" ||
              candidate.section === "constraints" ||
              candidate.section === "acceptanceCriteria" ||
              candidate.section === "actualOutputToEvaluate"
                ? candidate.section
                : "requirements"
            const status: ReviewAnalysisJudgment["status"] =
              candidate.status === "met" ||
              candidate.status === "missing" ||
              candidate.status === "unclear" ||
              candidate.status === "contradicted"
                ? candidate.status
                : "unclear"
            const confidence: ReviewAnalysisJudgment["confidence"] =
              candidate.confidence === "high" || candidate.confidence === "medium" || candidate.confidence === "low"
                ? candidate.confidence
                : "low"
            return {
              id:
                typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : `judge-${index + 1}`,
              section,
              label: typeof candidate.label === "string" ? candidate.label.trim() : "",
              status,
              confidence,
              usefulness: typeof candidate.usefulness === "number" ? candidate.usefulness : 0,
              rationale: typeof candidate.rationale === "string" ? candidate.rationale.trim() : "",
              requestEvidence: Array.isArray(candidate.requestEvidence)
                ? candidate.requestEvidence
                  .filter((span): span is ReviewAnalysisJudgment["requestEvidence"][number] => typeof span === "object" && span !== null)
                  .map((span) => ({
                    source: span.source === "request" || span.source === "answer" || span.source === "review" ? span.source : "request",
                    snippet: typeof span.snippet === "string" ? span.snippet.trim() : "",
                    lineStart: typeof span.lineStart === "number" ? span.lineStart : 1,
                    lineEnd: typeof span.lineEnd === "number" ? span.lineEnd : typeof span.lineStart === "number" ? span.lineStart : 1
                  }))
                  .filter((span) => span.snippet)
                  .slice(0, 3)
                : [],
              answerEvidence: Array.isArray(candidate.answerEvidence)
                ? candidate.answerEvidence
                  .filter((span): span is ReviewAnalysisJudgment["answerEvidence"][number] => typeof span === "object" && span !== null)
                  .map((span) => ({
                    source: span.source === "request" || span.source === "answer" || span.source === "review" ? span.source : "answer",
                    snippet: typeof span.snippet === "string" ? span.snippet.trim() : "",
                    lineStart: typeof span.lineStart === "number" ? span.lineStart : 1,
                    lineEnd: typeof span.lineEnd === "number" ? span.lineEnd : typeof span.lineStart === "number" ? span.lineStart : 1
                  }))
                  .filter((span) => span.snippet)
                  .slice(0, 3)
                : []
            }
          })
          .filter((item) => item.label)
          .slice(0, 16)
      : []
  }
}
