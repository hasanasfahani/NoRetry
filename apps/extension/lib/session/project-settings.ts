import type { ImportedProjectContextRecord } from "../core/project-context"
import type { StructuredProjectMemory } from "./project-memory"

export type ProjectContextStatus = "missing" | "active" | "stale" | "conflicted"
export type ProjectContextSource = "none" | "imported_markdown"

export type ProjectCollaborationMode = "fast" | "careful" | "plan_first"
export type ProjectProofPreference = "standard" | "proof_required" | "files_first"
export type ProjectExplanationStyle = "plain_language" | "technical"
export type ProjectScopePreference = "narrow" | "balanced"

export type ProjectPreferenceSettings = {
  collaborationMode: ProjectCollaborationMode
  proofPreference: ProjectProofPreference
  explanationStyle: ProjectExplanationStyle
  scopePreference: ProjectScopePreference
}

export type ProjectContextSignal = {
  status: ProjectContextStatus
  source: ProjectContextSource
  lastImportedAt: string | null
  staleReasons: string[]
  conflictReasons: string[]
  warnings: string[]
  architectureConflicts?: ArchitectureDecisionConflict[]
}

export type ArchitectureConflictKind =
  | "authentication"
  | "database_or_orm"
  | "deployment"
  | "data_layer_bypass"
  | "core_dependency"

export type ArchitectureConflictChoice = "keep_existing" | "replace" | "ask_engineer"

export type ArchitectureDecisionConflict = {
  id: string
  kind: ArchitectureConflictKind
  decisionId: string
  storedDecision: string
  conflictingRequest: string
  proposedDecision: string
  practicalConsequence: string
  choices: Array<{
    id: ArchitectureConflictChoice
    label: "Keep the existing decision" | "Intentionally replace it" | "Ask an engineer"
  }>
}

export type ProjectSettingsRecord = {
  context: ProjectContextSignal
  preferences: ProjectPreferenceSettings
}

export type ProjectPreferenceField = keyof ProjectPreferenceSettings

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function unique(values: Array<string | null | undefined>, limit = Number.POSITIVE_INFINITY) {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const raw of values) {
    const value = normalize(raw ?? "")
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(value)
    if (kept.length >= limit) break
  }
  return kept
}

function daysSinceIso(value: string | null | undefined) {
  if (!value) return null
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return null
  return Math.floor((Date.now() - parsed) / (1000 * 60 * 60 * 24))
}

function looksBroadChangeRequest(text: string) {
  return /\b(rewrite|refactor|overhaul|rebuild|replace|delete|remove|migrate|restructure|change everything|broader changes?)\b/i.test(
    text
  )
}

function looksLikeDirectChange(text: string) {
  return /\b(change|edit|update|rewrite|refactor|replace|remove|delete|touch|modify|rework|overhaul|rebuild|move)\b/i.test(
    text
  )
}

function tokenizeSignal(value: string) {
  return unique(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4),
    6
  )
}

export function requestTouchesSignal(requestText: string, signal: string) {
  const normalizedRequest = requestText.toLowerCase()
  const normalizedSignal = signal.toLowerCase()
  if (normalizedRequest.includes(normalizedSignal)) return true

  const tokens = tokenizeSignal(signal)
  if (!tokens.length) return false
  return tokens.every((token) => normalizedRequest.includes(token))
}

const ARCHITECTURE_CONFLICT_CHOICES: ArchitectureDecisionConflict["choices"] = [
  { id: "keep_existing", label: "Keep the existing decision" },
  { id: "replace", label: "Intentionally replace it" },
  { id: "ask_engineer", label: "Ask an engineer" }
]

const AUTH_PROVIDERS = ["supabase auth", "firebase auth", "firebase", "clerk", "auth0", "cognito", "nextauth", "auth.js", "lucia", "descope"]
const DATABASES = ["postgresql", "postgres", "mysql", "sqlite", "mongodb", "mongo", "firestore", "dynamodb", "supabase database", "neon", "planetscale"]
const ORMS = ["prisma", "drizzle", "sequelize", "typeorm", "mongoose", "knex"]
const DEPLOYMENT_PROVIDERS = ["replit", "vercel", "netlify", "cloudflare", "fly.io", "render", "railway", "aws", "azure", "gcp"]

function matchingArchitectureTerms(value: string, terms: string[]) {
  const normalized = value.toLowerCase()
  return terms.filter((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\ /g, "\\s+")}\\b`, "i").test(normalized))
}

function requestIntroducesArchitecture(value: string) {
  return /\b(add|adopt|bypass|configure|connect|deploy|directly|introduce|integrate|install|migrate|move|replace|set up|switch|use)\b/i.test(value)
}

function looksLikeVocabularyOverlapOnly(value: string) {
  return (
    /\b(icon|logo|copy|text|button|color|style|label|layout)\b/i.test(value) &&
    !/\b(provider|system|integration|sdk|service|session|account|identity|database|orm|deploy|hosting|dependency)\b/i.test(value)
  )
}

function proposedDecisionFor(kind: ArchitectureConflictKind, requestText: string, requestedTerm: string) {
  if (kind === "authentication") return `Use ${requestedTerm} for authentication`
  if (kind === "database_or_orm") return `Use ${requestedTerm} for data access`
  if (kind === "deployment") return `Deploy with ${requestedTerm}`
  if (kind === "data_layer_bypass") return `Allow direct database access requested by: ${requestText}`
  return `Replace the established dependency as requested: ${requestText}`
}

function conflictConsequence(kind: ArchitectureConflictKind) {
  if (kind === "authentication") return "Two authentication systems can create inconsistent identities, sessions, and access rules."
  if (kind === "database_or_orm") return "A second database or ORM can split data access, migrations, and transaction behavior."
  if (kind === "deployment") return "A second deployment provider can create divergent environments, secrets, and release behavior."
  if (kind === "data_layer_bypass") return "Bypassing the established data layer can skip validation, access checks, and shared transaction rules."
  return "Replacing a core dependency can invalidate existing patterns and require changes across dependent modules."
}

function stableConflictId(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function architectureDecisionSubject(statement: string) {
  const normalized = normalize(statement)
  const matched = /^(?:use|keep|standardize on|deploy (?:on|with))\s+(.+?)(?:\s+(?:for|as|through|via)\s+|$)/i.exec(normalized)
  return normalize(matched?.[1] ?? "")
}

function buildArchitectureConflict(input: {
  kind: ArchitectureConflictKind
  decisionId: string
  storedDecision: string
  requestText: string
  requestedTerm: string
}): ArchitectureDecisionConflict {
  const proposedDecision = proposedDecisionFor(input.kind, input.requestText, input.requestedTerm)
  return {
    id: `architecture-conflict:${stableConflictId(`${input.decisionId}:${input.requestText}:${proposedDecision}`)}`,
    kind: input.kind,
    decisionId: input.decisionId,
    storedDecision: input.storedDecision,
    conflictingRequest: input.requestText,
    proposedDecision,
    practicalConsequence: conflictConsequence(input.kind),
    choices: ARCHITECTURE_CONFLICT_CHOICES.map((choice) => ({ ...choice }))
  }
}

export function detectArchitectureDecisionConflicts(input: {
  requestText: string
  structuredMemory?: StructuredProjectMemory | null
}): ArchitectureDecisionConflict[] {
  try {
    const requestText = normalize(input.requestText)
    if (!requestText || !requestIntroducesArchitecture(requestText) || looksLikeVocabularyOverlapOnly(requestText)) return []
    const activeDecisions = (input.structuredMemory?.architecture?.decisions ?? []).filter(
      (decision) => decision.status === "active"
    )
    const conflicts: ArchitectureDecisionConflict[] = []

    for (const decision of activeDecisions) {
      const storedAuth = matchingArchitectureTerms(decision.statement, AUTH_PROVIDERS)
      const requestedAuth = matchingArchitectureTerms(requestText, AUTH_PROVIDERS)
      const differentAuth = requestedAuth.find((term) => !storedAuth.includes(term))
      if (storedAuth.length && differentAuth && /\b(auth|authentication|login|sign[ -]?in|identity|session)\b/i.test(requestText)) {
        conflicts.push(buildArchitectureConflict({
          kind: "authentication",
          decisionId: decision.id,
          storedDecision: decision.statement,
          requestText,
          requestedTerm: differentAuth
        }))
        continue
      }

      const storedDataTools = matchingArchitectureTerms(decision.statement, [...DATABASES, ...ORMS])
      const requestedDataTools = matchingArchitectureTerms(requestText, [...DATABASES, ...ORMS])
      const differentDataTool = requestedDataTools.find((term) => !storedDataTools.includes(term))
      if (storedDataTools.length && differentDataTool && /\b(database|db|orm|data|schema|queries?)\b/i.test(requestText)) {
        conflicts.push(buildArchitectureConflict({
          kind: "database_or_orm",
          decisionId: decision.id,
          storedDecision: decision.statement,
          requestText,
          requestedTerm: differentDataTool
        }))
        continue
      }

      const storedDeployment = matchingArchitectureTerms(decision.statement, DEPLOYMENT_PROVIDERS)
      const requestedDeployment = matchingArchitectureTerms(requestText, DEPLOYMENT_PROVIDERS)
      const differentDeployment = requestedDeployment.find((term) => !storedDeployment.includes(term))
      if (storedDeployment.length && differentDeployment && /\b(deploy|deployment|host|hosting|production)\b/i.test(requestText)) {
        conflicts.push(buildArchitectureConflict({
          kind: "deployment",
          decisionId: decision.id,
          storedDecision: decision.statement,
          requestText,
          requestedTerm: differentDeployment
        }))
        continue
      }

      if (
        /\b(data|database|db)\b/i.test(decision.statement) &&
        /\b(through|via|layer|repository|service)\b/i.test(decision.statement) &&
        /\b(bypass|direct|directly|skip|without)\b/i.test(requestText) &&
        /\b(data|database|db|query|queries|sql)\b/i.test(requestText)
      ) {
        conflicts.push(buildArchitectureConflict({
          kind: "data_layer_bypass",
          decisionId: decision.id,
          storedDecision: decision.statement,
          requestText,
          requestedTerm: "direct database access"
        }))
        continue
      }

      if (
        /\b(replace|remove|swap|migrate away|switch away)\b/i.test(requestText) &&
        Boolean(architectureDecisionSubject(decision.statement)) &&
        requestText.toLowerCase().includes(architectureDecisionSubject(decision.statement).toLowerCase())
      ) {
        conflicts.push(buildArchitectureConflict({
          kind: "core_dependency",
          decisionId: decision.id,
          storedDecision: decision.statement,
          requestText,
          requestedTerm: "the requested replacement"
        }))
      }
    }

    return conflicts
  } catch {
    return []
  }
}

export function applyArchitectureConflictChoice(input: {
  structuredMemory: StructuredProjectMemory
  conflict: ArchitectureDecisionConflict
  choice: ArchitectureConflictChoice
}): StructuredProjectMemory {
  try {
    if (input.choice !== "replace") return input.structuredMemory
    const architecture = input.structuredMemory.architecture
    const decisions = architecture?.decisions ?? []
    const existing = decisions.find(
      (decision) => decision.id === input.conflict.decisionId && decision.status === "active"
    )
    if (!existing || existing.statement !== input.conflict.storedDecision || !input.conflict.proposedDecision.trim()) {
      return input.structuredMemory
    }

    const replacementId = `decision:${stableConflictId(input.conflict.proposedDecision.toLowerCase())}`
    const nextDecisions = decisions
      .filter((decision) => decision.id !== replacementId)
      .map((decision) =>
        decision.id === existing.id ? { ...decision, status: "superseded" as const } : decision
      )
    nextDecisions.push({
      id: replacementId,
      statement: input.conflict.proposedDecision,
      status: "active",
      strength: existing.strength
    })

    return {
      ...input.structuredMemory,
      architecture: {
        ...(architecture ?? {}),
        decisions: nextDecisions
      }
    }
  } catch {
    return input.structuredMemory
  }
}

export function createDefaultProjectPreferenceSettings(): ProjectPreferenceSettings {
  return {
    collaborationMode: "careful",
    proofPreference: "proof_required",
    explanationStyle: "plain_language",
    scopePreference: "narrow"
  }
}

export function createDefaultProjectContextSignal(): ProjectContextSignal {
  return {
    status: "missing",
    source: "none",
    lastImportedAt: null,
    staleReasons: [],
    conflictReasons: [],
    warnings: []
  }
}

export function createDefaultProjectSettingsRecord(): ProjectSettingsRecord {
  return {
    context: createDefaultProjectContextSignal(),
    preferences: createDefaultProjectPreferenceSettings()
  }
}

export function buildProjectContextSignal(input: {
  projectContext: string
  currentState: string
  importedContext?: ImportedProjectContextRecord | null
  structuredMemory?: StructuredProjectMemory | null
  previous?: ProjectSettingsRecord | null
  importedAt?: string | null
  currentRequestText?: string | null
  preferences?: ProjectPreferenceSettings | null
}): ProjectContextSignal {
  const projectContext = normalize(input.projectContext)
  const currentState = normalize(input.currentState)
  const importedContext = input.importedContext ?? null
  const structuredMemory = input.structuredMemory ?? null
  const previous = input.previous ?? createDefaultProjectSettingsRecord()
  const preferences = input.preferences ?? previous.preferences ?? createDefaultProjectPreferenceSettings()
  const hasContext = Boolean(projectContext || currentState || importedContext?.rawMarkdown?.trim())

  if (!hasContext) {
    return createDefaultProjectContextSignal()
  }

  const summary = importedContext?.summary
  const staleReasons: string[] = []
  const conflictReasons: string[] = []
  const importedAt = importedContext?.parsedAt ?? input.importedAt ?? previous.context.lastImportedAt ?? new Date().toISOString()

  const ageDays = daysSinceIso(importedAt)
  if (ageDays != null && ageDays >= 7) {
    staleReasons.push("Saved project context may be outdated. Refresh the markdown handoff before a riskier change.")
  }

  const summarySignalCount =
    (summary?.relevantFiles.length ?? 0) +
    (summary?.definitionOfDone.length ?? 0) +
    (summary?.userIntent.length ?? 0) +
    (summary?.constraints.length ?? 0)
  if (importedContext && ((summary?.presentSections.length ?? 0) < 4 || summarySignalCount < 3)) {
    staleReasons.push("Saved context is still lightweight. A richer markdown handoff would improve guidance.")
  }

  if (structuredMemory?.currentFeatureArea && (summary?.relevantFiles.length ?? 0) === 0) {
    staleReasons.push("No relevant files are captured for the current feature focus yet.")
  }

  if (
    (structuredMemory?.currentPhase === "validation" || structuredMemory?.currentWorkflowState === "validation_needed") &&
    (summary?.definitionOfDone.length ?? 0) === 0
  ) {
    staleReasons.push("Validation is active, but there is no saved definition of done yet.")
  }

  const requestText = normalize(input.currentRequestText ?? "")
  const protectedSignals = unique([
    ...(structuredMemory?.protectedAreas ?? []),
    ...(summary?.userIntent ?? []).filter((item) => /\bmust not\b|\bdo not\b|\bpreserve\b|\bkeep\b|\buntouched\b/i.test(item))
  ])

  if (requestText && looksLikeDirectChange(requestText)) {
    const touchedProtectedArea = protectedSignals.find((item) => requestTouchesSignal(requestText, item))
    if (touchedProtectedArea) {
      conflictReasons.push(`The current request appears to touch a protected area: ${touchedProtectedArea}.`)
    }

    if (preferences.scopePreference === "narrow" && looksBroadChangeRequest(requestText) && protectedSignals.length > 0) {
      conflictReasons.push("The current request sounds broader than the saved narrow-scope preference.")
    }
  }

  const architectureConflicts = detectArchitectureDecisionConflicts({
    requestText,
    structuredMemory
  })
  conflictReasons.push(
    ...architectureConflicts.map(
      (conflict) =>
        `Stored decision: ${conflict.storedDecision}. Conflicting request: ${conflict.conflictingRequest}. Practical consequence: ${conflict.practicalConsequence} Choices: Keep the existing decision, intentionally replace it, or ask an engineer.`
    )
  )

  const status: ProjectContextStatus =
    conflictReasons.length > 0 ? "conflicted" : staleReasons.length > 0 ? "stale" : "active"

  return {
    status,
    source: "imported_markdown",
    lastImportedAt: importedAt,
    staleReasons: unique(staleReasons, 4),
    conflictReasons: unique(conflictReasons, 4),
    warnings: unique([...staleReasons, ...conflictReasons], 6),
    ...(architectureConflicts.length ? { architectureConflicts } : {})
  }
}

export function buildProjectSettingsRecord(input: {
  projectContext: string
  currentState: string
  importedContext?: ImportedProjectContextRecord | null
  structuredMemory?: StructuredProjectMemory | null
  previous?: ProjectSettingsRecord | null
  importedAt?: string | null
  currentRequestText?: string | null
}): ProjectSettingsRecord {
  const previous = input.previous ?? createDefaultProjectSettingsRecord()

  return {
    context: buildProjectContextSignal({
      projectContext: input.projectContext,
      currentState: input.currentState,
      importedContext: input.importedContext ?? null,
      structuredMemory: input.structuredMemory ?? null,
      previous,
      importedAt: input.importedAt ?? null,
      currentRequestText: input.currentRequestText ?? null,
      preferences: previous.preferences
    }),
    preferences: previous.preferences ?? createDefaultProjectPreferenceSettings()
  }
}

export function formatProjectPreferenceSummary(preferences: ProjectPreferenceSettings) {
  return [
    `Collaboration mode: ${preferences.collaborationMode}`,
    `Proof preference: ${preferences.proofPreference}`,
    `Scope preference: ${preferences.scopePreference}`,
    `Explanation style: ${preferences.explanationStyle}`
  ].join(" | ")
}
