import type {
  AssistantCurrentStepClaim,
  AssistantInterpreterConfidence,
  AssistantNextMoveInterpretation,
  AssistantNextMoveType
} from "./assistant-next-move-interpreter-types"

export const ASSISTANT_NEXT_MOVE_INTERPRETER_PROMPT_VERSION = "assistant-next-move-interpreter.v1"

type InterpreterPromptFn = (input: {
  prompt: string
  answers: Record<string, string>
  taskType: string
}) => Promise<string | null>

type ParsedInterpreterResult = Partial<{
  promptVersion: string
  currentStepClaim: AssistantCurrentStepClaim
  nextMoveType: AssistantNextMoveType
  nextMoveSummary: string
  targetLabel: string | null
  targetPhaseNumber: number | null
  requiresApproval: boolean
  suggestsImplementation: boolean
  suggestsClarification: boolean
  suggestsValidation: boolean
  suggestsCompletion: boolean
  confidenceLevel: AssistantInterpreterConfidence
}>

type NormalizedInterpreterResult = {
  currentStepClaim: AssistantCurrentStepClaim
  nextMoveType: AssistantNextMoveType
  nextMoveSummary: string
  targetLabel: string | null
  targetPhaseNumber: number | null
  requiresApproval: boolean
  suggestsImplementation: boolean
  suggestsClarification: boolean
  suggestsValidation: boolean
  suggestsCompletion: boolean
  confidenceLevel: AssistantInterpreterConfidence
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value) as ParsedInterpreterResult
  } catch {
    const fenced = value.match(/```json\s*([\s\S]+?)```/i)
    if (!fenced?.[1]) return null
    try {
      return JSON.parse(fenced[1]) as ParsedInterpreterResult
    } catch {
      return null
    }
  }
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1).trimEnd()}…`
}

function tailLines(value: string, count: number) {
  return value
    .split(/\n+/)
    .map((line) => normalize(line))
    .filter(Boolean)
    .slice(-count)
}

function isCurrentStepClaim(value: unknown): value is AssistantCurrentStepClaim {
  return value === "complete" || value === "partial" || value === "unclear"
}

function isNextMoveType(value: unknown): value is AssistantNextMoveType {
  return (
    value === "approval_request" ||
    value === "continuation_offer" ||
    value === "clarification_request" ||
    value === "validation_request" ||
    value === "optional_enhancement" ||
    value === "task_complete" ||
    value === "unknown"
  )
}

function isConfidenceLevel(value: unknown): value is AssistantInterpreterConfidence {
  return value === "high" || value === "medium" || value === "low"
}

function isBoolean(value: unknown): value is boolean {
  return value === true || value === false
}

function normalizeTargetLabel(value: unknown) {
  if (value == null) return null
  if (typeof value !== "string") return null
  const normalized = normalize(value)
  return normalized || null
}

function normalizeTargetPhaseNumber(value: unknown) {
  if (value == null) return null
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return null
  return value
}

function normalizeInterpreterResult(parsed: ParsedInterpreterResult): NormalizedInterpreterResult | null {
  if (!isCurrentStepClaim(parsed.currentStepClaim)) return null
  if (!isNextMoveType(parsed.nextMoveType)) return null
  if (!isConfidenceLevel(parsed.confidenceLevel)) return null
  if (
    !isBoolean(parsed.requiresApproval) ||
    !isBoolean(parsed.suggestsImplementation) ||
    !isBoolean(parsed.suggestsClarification) ||
    !isBoolean(parsed.suggestsValidation) ||
    !isBoolean(parsed.suggestsCompletion)
  ) {
    return null
  }

  const nextMoveSummary = typeof parsed.nextMoveSummary === "string" ? normalize(parsed.nextMoveSummary) : ""
  if (!nextMoveSummary) return null

  return {
    currentStepClaim: parsed.currentStepClaim,
    nextMoveType: parsed.nextMoveType,
    nextMoveSummary,
    targetLabel: normalizeTargetLabel(parsed.targetLabel),
    targetPhaseNumber: normalizeTargetPhaseNumber(parsed.targetPhaseNumber),
    requiresApproval: parsed.requiresApproval,
    suggestsImplementation: parsed.suggestsImplementation,
    suggestsClarification: parsed.suggestsClarification,
    suggestsValidation: parsed.suggestsValidation,
    suggestsCompletion: parsed.suggestsCompletion,
    confidenceLevel: parsed.confidenceLevel
  }
}

export function buildAssistantNextMoveInterpreterPrompt(params: {
  promptText: string
  responseText: string
}) {
  const answerTail = tailLines(params.responseText, 8)
  const sections = [
    `Prompt version: ${ASSISTANT_NEXT_MOVE_INTERPRETER_PROMPT_VERSION}`,
    "Interpret the assistant's latest answer and identify what the assistant is asking to do next.",
    "This task is intent interpretation only. Do not decide whether the user should approve the next move.",
    "Prefer `unknown` over guessing. Base your answer on the actual assistant response, especially the latest actionable lines.",
    "If the assistant says the current step is done and asks to continue, mark `currentStepClaim` as `complete` and choose the next-move type that best matches the request.",
    "If the assistant offers an optional follow-up, treat it as `optional_enhancement`.",
    "If the assistant is asking a question, requesting confirmation, or needs a user decision, treat it as `clarification_request` unless it is clearly asking approval to continue a completed step.",
    "If the assistant is asking for proof, testing, verification, or checks before moving on, treat it as `validation_request`.",
    "Return JSON only.",
    `User request under review:\n${truncate(params.promptText.trim(), 2500)}`,
    `Assistant answer under review:\n${truncate(params.responseText.trim(), 5000)}`,
    answerTail.length ? `Latest actionable lines:\n${answerTail.map((line) => `- ${line}`).join("\n")}` : "",
    [
      "Return JSON only with this exact shape:",
      "{",
      `  "promptVersion": "${ASSISTANT_NEXT_MOVE_INTERPRETER_PROMPT_VERSION}",`,
      '  "currentStepClaim": "complete" | "partial" | "unclear",',
      '  "nextMoveType": "approval_request" | "continuation_offer" | "clarification_request" | "validation_request" | "optional_enhancement" | "task_complete" | "unknown",',
      '  "nextMoveSummary": string,',
      '  "targetLabel": string | null,',
      '  "targetPhaseNumber": number | null,',
      '  "requiresApproval": boolean,',
      '  "suggestsImplementation": boolean,',
      '  "suggestsClarification": boolean,',
      '  "suggestsValidation": boolean,',
      '  "suggestsCompletion": boolean,',
      '  "confidenceLevel": "high" | "medium" | "low"',
      "}"
    ].join("\n")
  ].filter(Boolean)

  return sections.join("\n\n")
}

export async function runAssistantNextMoveLlmInterpreter(input: {
  promptText: string
  responseText: string
  taskType: string
  interpretPrompt?: InterpreterPromptFn
}): Promise<AssistantNextMoveInterpretation | null> {
  if (!input.interpretPrompt) return null

  const prompt = buildAssistantNextMoveInterpreterPrompt({
    promptText: input.promptText,
    responseText: input.responseText
  })

  const response = await input.interpretPrompt({
    prompt,
    answers: {
      request_summary: truncate(normalize(input.promptText), 1000),
      answer_tail: tailLines(input.responseText, 6).join(" | "),
      answer_summary: truncate(normalize(input.responseText), 1200)
    },
    taskType: input.taskType
  })

  if (!response) return null
  const parsed = safeJsonParse(response)
  if (!parsed) return null
  const normalized = normalizeInterpreterResult(parsed)
  if (!normalized) return null

  return {
    source: "ai",
    ...normalized
  }
}
