import type { GoalContract } from "../goal/types"
import type { AnalysisPromptContract } from "./analysis-prompt-section"
import { detectAnalysisArtifactFamily, type AnalysisArtifactFamily } from "./analysis-artifact-family"
import { buildAnalysisRequestSpecificity, type AnalysisRequestSpecificity } from "./analysis-specificity"
import { buildSemanticRequirements, type AnalysisSemanticRequirement } from "./analysis-semantics"
import { buildAnalysisRequestSlots, type AnalysisSlotValue } from "./analysis-slot-extractors"

export type AnalysisRequestModel = {
  artifactFamily: AnalysisArtifactFamily
  rawPrompt: string
  taskGoal: string[]
  requirements: string[]
  constraints: string[]
  acceptanceCriteria: string[]
  outputRequirements: string[]
  audience: string[]
  tone: string[]
  styleConstraints: string[]
  scopeHints: string[]
  plainOutputPreferred: boolean
  noSmallTalk: boolean
  wordLimitMax: number | null
  semanticRequirements: AnalysisSemanticRequirement[]
  specificity: AnalysisRequestSpecificity
  slots: AnalysisSlotValue[]
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeLower(value: string) {
  return normalize(value).toLowerCase()
}

function unique(values: Array<string | null | undefined>) {
  const seen = new Set<string>()
  const items: string[] = []
  for (const raw of values) {
    const value = normalize(raw ?? "")
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    items.push(value)
  }
  return items
}

function extractAudience(promptText: string) {
  const audiences: string[] = []
  for (const match of promptText.matchAll(/\b(?:to|for)\s+my\s+([^.,\n]+?)(?:\.|,|\n|$)/gi)) {
    audiences.push(match[1] ?? "")
  }
  return unique(audiences)
}

function extractTone(promptText: string) {
  const lower = normalizeLower(promptText)
  const tones: string[] = []
  if (/\bformal\b/.test(lower)) tones.push("formal")
  if (/\bconcise\b/.test(lower)) tones.push("concise")
  if (/\bprofessional\b/.test(lower)) tones.push("professional")
  return tones
}

function extractStyleConstraints(promptText: string) {
  const lower = normalizeLower(promptText)
  const styles: string[] = []
  if (/\bno small-talk\b|\bno small talk\b/.test(lower)) styles.push("no small-talk")
  if (/\bwithout the email box\b|\bwrite it freely here\b|\bno email box\b/.test(lower)) styles.push("plain inline output")
  return styles
}

function extractScopeHints(promptText: string) {
  const lower = normalizeLower(promptText)
  const hints: string[] = []
  if (/\bper serving\b|\bsingle-serving\b|\bsingle serving\b/.test(lower)) hints.push("per_serving")
  if (/\bper day\b|\bdaily\b|\bkcal day\b|\bcalorie day\b/.test(lower)) hints.push("per_day")
  if (/\bper session\b/.test(lower)) hints.push("per_session")
  return hints
}

function extractWordLimit(promptText: string) {
  const match = promptText.match(/\bunder\s+(\d+)\s+words?\b/i)
  return match ? Number(match[1]) : null
}

export function buildAnalysisRequestModel(params: {
  promptText: string
  promptContract: AnalysisPromptContract
  goalContract?: GoalContract | null
  taskFamily: string
}): AnalysisRequestModel {
  const artifactFamily = detectAnalysisArtifactFamily({
    promptText: params.promptText,
    goalContract: params.goalContract ?? null,
    taskFamily: params.taskFamily
  })
  const styleConstraints = extractStyleConstraints(params.promptText)
  const semanticRequirements = buildSemanticRequirements([
    ...params.promptContract.taskGoal,
    ...params.promptContract.requirements,
    ...params.promptContract.constraints,
    ...params.promptContract.acceptanceCriteria,
    ...params.promptContract.actualOutputToEvaluate
  ])
  const specificity = buildAnalysisRequestSpecificity({
    promptText: params.promptText,
    promptContract: params.promptContract,
    semanticRequirements
  })

  const model: AnalysisRequestModel = {
    artifactFamily,
    rawPrompt: normalize(params.promptText),
    taskGoal: params.promptContract.taskGoal,
    requirements: params.promptContract.requirements,
    constraints: params.promptContract.constraints,
    acceptanceCriteria: params.promptContract.acceptanceCriteria,
    outputRequirements: params.promptContract.actualOutputToEvaluate,
    audience: extractAudience(params.promptText),
    tone: extractTone(params.promptText),
    styleConstraints,
    scopeHints: extractScopeHints(params.promptText),
    plainOutputPreferred: styleConstraints.includes("plain inline output"),
    noSmallTalk: styleConstraints.includes("no small-talk"),
    wordLimitMax: extractWordLimit(params.promptText),
    semanticRequirements,
    specificity,
    slots: []
  }

  model.slots = buildAnalysisRequestSlots(model)
  return model
}
