import type { GoalContract } from "../goal/types"
import type { StructuredProjectMemory } from "../session/project-memory"
import type { ImportedProjectContextRecord } from "../core/project-context"
import {
  buildProjectContextPack,
  formatProjectContextPackSummary,
  type ProjectContextPack
} from "../core/project-context-pack"
import type {
  ProjectContextStatus,
  ProjectPreferenceSettings,
  ProjectSettingsRecord
} from "../session/project-settings"
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
  projectMemory: StructuredProjectMemory | null
  projectMemoryHints: string[]
  projectPreferences: ProjectPreferenceSettings | null
  projectPreferenceHints: string[]
  projectContextPack: ProjectContextPack
  projectContextStatus: ProjectContextStatus
  projectContextHints: string[]
  projectContextWarnings: string[]
  projectContextSummary: string
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

function buildProjectMemoryHints(memory: StructuredProjectMemory | null | undefined) {
  if (!memory) return []

  return unique([
    memory.currentFeatureArea ? `Current feature area: ${memory.currentFeatureArea}` : "",
    memory.currentPhase ? `Current phase: ${memory.currentPhase}` : "",
    memory.currentWorkflowState ? `Workflow state: ${memory.currentWorkflowState}` : "",
    ...(memory.protectedAreas ?? []).map((item) => `Protected area: ${item}`),
    ...(memory.stableConstraints ?? []).map((item) => `Stable constraint: ${item}`),
    ...(memory.acceptedAssumptions ?? []).map((item) => `Accepted assumption: ${item}`),
    ...(memory.preferredPatterns ?? []).map((item) => `Preferred pattern: ${item}`),
    ...(memory.knownBadDirections ?? []).map((item) => `Avoid this direction: ${item}`)
  ]).slice(0, 14)
}

function buildProjectPreferenceHints(preferences: ProjectPreferenceSettings | null | undefined) {
  if (!preferences) return []

  return unique([
    preferences.collaborationMode === "plan_first" ? "Prefer a short plan before broad implementation." : "",
    preferences.collaborationMode === "fast" ? "Favor faster progress with fewer clarification loops." : "",
    preferences.proofPreference === "proof_required" ? "Require explicit proof before claiming success." : "",
    preferences.proofPreference === "files_first" ? "Name changed files or surfaces before claiming success." : "",
    preferences.scopePreference === "narrow" ? "Keep the change narrowly scoped and avoid unrelated edits." : "",
    preferences.explanationStyle === "plain_language"
      ? "Explain scope, risks, and validation in plain language for a non-technical user."
      : "Technical implementation details are acceptable when clarifying the work."
  ])
}

function buildProjectContextHints(pack: ProjectContextPack) {
  return pack.hints.slice(0, 18)
}

export function buildAnalysisRequestModel(params: {
  promptText: string
  promptContract: AnalysisPromptContract
  goalContract?: GoalContract | null
  taskFamily: string
  importedContext?: ImportedProjectContextRecord | null
  projectMemory?: StructuredProjectMemory | null
  projectSettings?: ProjectSettingsRecord | null
}): AnalysisRequestModel {
  const artifactFamily = detectAnalysisArtifactFamily({
    promptText: params.promptText,
    goalContract: params.goalContract ?? null,
    taskFamily: params.taskFamily
  })
  const projectContextPack = buildProjectContextPack({
    importedContext: params.importedContext ?? null,
    structuredMemory: params.projectMemory ?? null,
    settings: params.projectSettings ?? null,
    currentRequestText: params.promptText
  })
  const projectPreferenceHints = buildProjectPreferenceHints(params.projectSettings?.preferences ?? null)
  const projectContextHints = buildProjectContextHints(projectContextPack)
  const effectiveConstraints = unique([
    ...params.promptContract.constraints,
    ...(params.projectSettings?.preferences.scopePreference === "narrow"
      ? ["Keep the change narrowly scoped and avoid unrelated edits."]
      : [])
  ])
  const effectiveAcceptanceCriteria = unique([
    ...params.promptContract.acceptanceCriteria,
    ...projectContextPack.definitionOfDone,
    ...(params.projectSettings?.preferences.proofPreference === "proof_required"
      ? ["Provide explicit proof before claiming success."]
      : []),
    ...(params.projectSettings?.preferences.proofPreference === "files_first"
      ? ["List the changed files or surfaces before claiming success.", "Provide proof that the result works after naming the changes."]
      : []),
    ...(params.projectSettings?.preferences.collaborationMode === "plan_first"
      ? ["Return a short plan before broad implementation."]
      : [])
  ])
  const styleConstraints = extractStyleConstraints(params.promptText)
  const semanticRequirements = buildSemanticRequirements([
    ...params.promptContract.taskGoal,
    ...params.promptContract.requirements,
    ...effectiveConstraints,
    ...effectiveAcceptanceCriteria,
    ...params.promptContract.actualOutputToEvaluate,
    ...projectPreferenceHints,
    ...projectContextHints
  ])
  const specificity = buildAnalysisRequestSpecificity({
    promptText: params.promptText,
    promptContract: {
      ...params.promptContract,
      constraints: effectiveConstraints,
      acceptanceCriteria: effectiveAcceptanceCriteria
    },
    semanticRequirements
  })

  const model: AnalysisRequestModel = {
    artifactFamily,
    rawPrompt: normalize(params.promptText),
    taskGoal: params.promptContract.taskGoal,
    requirements: params.promptContract.requirements,
    constraints: effectiveConstraints,
    acceptanceCriteria: effectiveAcceptanceCriteria,
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
    slots: [],
    projectMemory: params.projectMemory ?? null,
    projectMemoryHints: buildProjectMemoryHints(params.projectMemory ?? null),
    projectPreferences: params.projectSettings?.preferences ?? null,
    projectPreferenceHints,
    projectContextPack,
    projectContextStatus: projectContextPack.contextStatus,
    projectContextHints,
    projectContextWarnings: projectContextPack.warnings,
    projectContextSummary: formatProjectContextPackSummary(projectContextPack)
  }

  model.slots = buildAnalysisRequestSlots(model)
  return model
}
