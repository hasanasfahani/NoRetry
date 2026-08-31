export const PROJECT_TRACKER_SCHEMA_VERSION = "project-tracker-v1"

export type ProjectTrackerSurface = "chatgpt" | "replit" | "lovable" | "unknown"
export type ProjectTrackerMode = "phase_tracker"
export type ProjectTrackerPhaseStatus = "not_started" | "in_progress" | "completed" | "skipped"
export type ProjectTrackerDisableReason = "manual" | "completed" | "stale_prd" | "invalid_tracker"

export type ProjectTrackerPhase = {
  id: string
  title: string
  goal: string
  buildScope: string[]
  outOfScope: string[]
  dataStateNeeded: string[]
  deliverables: string[]
  acceptanceCriteria: string[]
  validationProofExpected: string[]
  status: ProjectTrackerPhaseStatus
  startedAt: string | null
  completedAt: string | null
  skippedAt: string | null
}

export type ProjectTrackerRecord = {
  schemaVersion: typeof PROJECT_TRACKER_SCHEMA_VERSION
  projectId: string
  projectKey: string
  projectLabel: string
  surface: ProjectTrackerSurface
  prdHash: string
  submittedPromptHash: string
  mode: ProjectTrackerMode
  enabled: boolean
  currentPhaseIndex: number
  phases: ProjectTrackerPhase[]
  createdAt: string
  updatedAt: string
  completedAt: string | null
  disabledAt: string | null
  disabledReason: ProjectTrackerDisableReason | null
  awaitingNextPhaseAnswer?: boolean
  lastReviewedAssistantAnswerHash?: string | null
  lastReviewedSubmittedPromptHash?: string | null
  carryoverItems?: string[]
  finalReviewPromptCopiedAt?: string | null
  finalReviewPromptSubmittedAt?: string | null
  finalReviewSubmittedPromptHash?: string | null
  finalReviewAnswerReceivedAt?: string | null
  testingCheckpointAnsweredAt?: string | null
}

export type ProjectTrackerSourcePhase = {
  id?: string
  title: string
  goal: string
  buildScope?: string[]
  outOfScope?: string[]
  dataState?: string[]
  dataStateNeeded?: string[]
  deliverables?: string[]
  acceptanceCriteria?: string[]
  validationProof?: string[]
  validationProofExpected?: string[]
}

type ProjectTrackerPromptAnalysis = {
  overallStatus: "pass" | "needs_confirmation" | "risky" | "fail" | "unavailable"
  confidence: "low" | "medium" | "high"
  ignoredExternalValidation?: string[]
  actionableMissingItems?: string[]
  phaseAdvanceBasis?: string
  phaseCompletionClaimed?: boolean
  requirementMatches?: Array<{
    requirementText: string
    status: "pass" | "missing" | "unclear"
  }>
}

export type ProjectTrackerDebugMetadata = {
  trackerEnabled: boolean
  currentPhaseIndex: number | null
  currentPhaseTitle: string | null
  nextPhaseTitle: string | null
  phaseStatus: ProjectTrackerPhaseStatus | "completed" | "inactive" | "missing"
  advanceRecommended: boolean
  trackerCompleted: boolean
  prdHash: string | null
  promptHash: string | null
}

const PROJECT_TRACKER_COMPLETION_CTA =
  "After you finish, confirm which requirements were completed and suggest the next step."

function normalize(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim()
}

export function hashProjectTrackerText(value: string) {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(36)
}

function normalizeList(values: string[] | null | undefined, limit = 8) {
  const seen = new Set<string>()
  const output: string[] = []

  for (const raw of values ?? []) {
    const value = normalize(raw)
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(value)
    if (output.length >= limit) break
  }

  return output
}

function fallbackPhaseId(index: number, title: string) {
  const slug = normalize(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || `phase-${index + 1}`
}

export function buildProjectTrackerPhase(input: {
  phase: ProjectTrackerSourcePhase
  index: number
  status?: ProjectTrackerPhaseStatus
  timestamp?: string
}): ProjectTrackerPhase {
  const timestamp = input.timestamp ?? new Date().toISOString()
  const status = input.status ?? (input.index === 0 ? "in_progress" : "not_started")

  return {
    id: normalize(input.phase.id) || fallbackPhaseId(input.index, input.phase.title),
    title: normalize(input.phase.title),
    goal: normalize(input.phase.goal),
    buildScope: normalizeList(input.phase.buildScope),
    outOfScope: normalizeList(input.phase.outOfScope),
    dataStateNeeded: normalizeList(input.phase.dataStateNeeded ?? input.phase.dataState),
    deliverables: normalizeList(input.phase.deliverables),
    acceptanceCriteria: normalizeList(input.phase.acceptanceCriteria),
    validationProofExpected: normalizeList(input.phase.validationProofExpected ?? input.phase.validationProof),
    status,
    startedAt: status === "in_progress" ? timestamp : null,
    completedAt: status === "completed" ? timestamp : null,
    skippedAt: status === "skipped" ? timestamp : null
  }
}

export function hasValidProjectTrackerPhases(phases: ProjectTrackerPhase[]) {
  return (
    phases.length > 0 &&
    phases.every(
      (phase) =>
        Boolean(phase.title) &&
        Boolean(phase.goal) &&
        phase.buildScope.length > 0 &&
        phase.deliverables.length > 0 &&
        phase.acceptanceCriteria.length > 0
    )
  )
}

export function buildProjectTrackerRecord(input: {
  projectKey: string
  projectLabel: string
  surface: ProjectTrackerSurface
  prdHash: string
  submittedPromptHash: string
  phases: ProjectTrackerSourcePhase[]
  timestamp?: string
}): ProjectTrackerRecord | null {
  const timestamp = input.timestamp ?? new Date().toISOString()
  const phases = input.phases.map((phase, index) =>
    buildProjectTrackerPhase({
      phase,
      index,
      timestamp
    })
  )

  if (!hasValidProjectTrackerPhases(phases)) return null

  return {
    schemaVersion: PROJECT_TRACKER_SCHEMA_VERSION,
    projectId: `${input.projectKey}::${input.prdHash}`,
    projectKey: input.projectKey,
    projectLabel: input.projectLabel,
    surface: input.surface,
    prdHash: input.prdHash,
    submittedPromptHash: input.submittedPromptHash,
    mode: "phase_tracker",
    enabled: true,
    currentPhaseIndex: 0,
    phases,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    disabledAt: null,
    disabledReason: null,
    awaitingNextPhaseAnswer: false,
    lastReviewedAssistantAnswerHash: null,
    lastReviewedSubmittedPromptHash: null,
    carryoverItems: [],
    finalReviewPromptCopiedAt: null,
    finalReviewPromptSubmittedAt: null,
    finalReviewSubmittedPromptHash: null,
    finalReviewAnswerReceivedAt: null,
    testingCheckpointAnsweredAt: null
  }
}

export function getActiveProjectTrackerPhase(record: ProjectTrackerRecord | null | undefined) {
  if (!record?.enabled) return null
  return record.phases[record.currentPhaseIndex] ?? null
}

export function getNextProjectTrackerPhase(record: ProjectTrackerRecord | null | undefined) {
  if (!record?.enabled) return null
  return record.phases[record.currentPhaseIndex + 1] ?? null
}

export function isProjectTrackerCompleted(record: ProjectTrackerRecord | null | undefined) {
  return Boolean(record?.completedAt) || Boolean(record?.phases.length && record.phases.every((phase) => phase.status === "completed"))
}

export function isProjectTrackerBoundTo(input: {
  record: ProjectTrackerRecord | null | undefined
  projectKey: string
  surface: ProjectTrackerSurface
  prdHash?: string | null
  submittedPromptHash?: string | null
}) {
  const { record } = input
  if (!record) return false
  if (record.projectKey !== input.projectKey) return false
  if (record.surface !== input.surface) return false
  if (input.prdHash && record.prdHash !== input.prdHash) return false
  if (input.submittedPromptHash && record.submittedPromptHash !== input.submittedPromptHash) return false
  return record.projectId === `${record.projectKey}::${record.prdHash}`
}

export function deactivateProjectTracker(input: {
  record: ProjectTrackerRecord
  reason: ProjectTrackerDisableReason
  timestamp?: string
}) {
  const timestamp = input.timestamp ?? new Date().toISOString()

  return {
    ...input.record,
    enabled: false,
    updatedAt: timestamp,
    disabledAt: input.record.disabledAt ?? timestamp,
    disabledReason: input.record.disabledReason ?? input.reason
  }
}

export function buildProjectTrackerDebugMetadata(input: {
  record: ProjectTrackerRecord | null | undefined
  advanceRecommended?: boolean
}): ProjectTrackerDebugMetadata {
  const { record } = input
  const completed = isProjectTrackerCompleted(record)
  const currentPhase = record ? record.phases[record.currentPhaseIndex] ?? null : null
  const nextPhase = record ? record.phases[record.currentPhaseIndex + 1] ?? null : null

  return {
    trackerEnabled: Boolean(record?.enabled),
    currentPhaseIndex: currentPhase ? record!.currentPhaseIndex : null,
    currentPhaseTitle: currentPhase?.title ?? null,
    nextPhaseTitle: nextPhase?.title ?? null,
    phaseStatus: completed ? "completed" : currentPhase?.status ?? (record ? "missing" : "inactive"),
    advanceRecommended: Boolean(input.advanceRecommended),
    trackerCompleted: completed,
    prdHash: record?.prdHash ?? null,
    promptHash: record?.submittedPromptHash ?? null
  }
}

export function shouldAdvanceProjectTrackerFromAnalysis(analysis: ProjectTrackerPromptAnalysis) {
  if (analysis.phaseAdvanceBasis === "phase_completion_claimed_with_carryover") return true
  if (analysis.overallStatus !== "pass" || analysis.confidence === "low") return false

  const specificMatches = getSpecificProjectTrackerRequirementMatches(analysis)
  return specificMatches.length >= 2 && specificMatches.every((match) => match.status === "pass")
}

export function advanceProjectTrackerAfterPhasePass(input: {
  record: ProjectTrackerRecord | null | undefined
  timestamp?: string
  reviewedAssistantAnswerHash?: string | null
  reviewedSubmittedPromptHash?: string | null
  carryoverItems?: string[]
}) {
  const { record } = input
  if (!record?.enabled || isProjectTrackerCompleted(record)) return null

  const activePhase = getActiveProjectTrackerPhase(record)
  if (!activePhase) return null

  const timestamp = input.timestamp ?? new Date().toISOString()
  const nextPhaseIndex = record.currentPhaseIndex + 1
  const hasNextPhase = nextPhaseIndex < record.phases.length
  const phases = record.phases.map((phase, index): ProjectTrackerPhase => {
    if (index === record.currentPhaseIndex) {
      return {
        ...phase,
        status: "completed",
        completedAt: phase.completedAt ?? timestamp
      }
    }

    if (hasNextPhase && index === nextPhaseIndex) {
      return {
        ...phase,
        status: phase.status === "not_started" ? "in_progress" : phase.status,
        startedAt: phase.startedAt ?? timestamp
      }
    }

    return phase
  })

  return {
    ...record,
    enabled: hasNextPhase,
    currentPhaseIndex: hasNextPhase ? nextPhaseIndex : record.currentPhaseIndex,
    phases,
    updatedAt: timestamp,
    completedAt: hasNextPhase ? record.completedAt : timestamp,
    disabledAt: hasNextPhase ? record.disabledAt : timestamp,
    disabledReason: hasNextPhase ? record.disabledReason : "completed",
    awaitingNextPhaseAnswer: hasNextPhase,
    lastReviewedAssistantAnswerHash: input.reviewedAssistantAnswerHash ?? record.lastReviewedAssistantAnswerHash ?? null,
    lastReviewedSubmittedPromptHash: input.reviewedSubmittedPromptHash ?? record.lastReviewedSubmittedPromptHash ?? null,
    carryoverItems: normalizeList([...(record.carryoverItems ?? []), ...(input.carryoverItems ?? [])], 12),
    finalReviewPromptCopiedAt: record.finalReviewPromptCopiedAt ?? null,
    finalReviewPromptSubmittedAt: record.finalReviewPromptSubmittedAt ?? null,
    finalReviewAnswerReceivedAt: record.finalReviewAnswerReceivedAt ?? null,
    testingCheckpointAnsweredAt: record.testingCheckpointAnsweredAt ?? null
  }
}

export function markProjectTrackerFinalReviewCopied(input: {
  record: ProjectTrackerRecord | null | undefined
  timestamp?: string
}) {
  const { record } = input
  if (!record || !isProjectTrackerCompleted(record)) return null
  const timestamp = input.timestamp ?? new Date().toISOString()

  return {
    ...record,
    updatedAt: timestamp,
    finalReviewPromptCopiedAt: timestamp
  }
}

export function markProjectTrackerFinalReviewSubmitted(input: {
  record: ProjectTrackerRecord | null | undefined
  submittedPromptHash?: string | null
  timestamp?: string
}) {
  const { record } = input
  if (!record || !isProjectTrackerCompleted(record) || record.finalReviewPromptSubmittedAt) return null
  const timestamp = input.timestamp ?? new Date().toISOString()

  return {
    ...record,
    updatedAt: timestamp,
    finalReviewPromptSubmittedAt: timestamp,
    finalReviewSubmittedPromptHash: input.submittedPromptHash ?? record.finalReviewSubmittedPromptHash ?? null,
    finalReviewAnswerReceivedAt: null,
    testingCheckpointAnsweredAt: null
  }
}

export function markProjectTrackerFinalReviewAnswerReceived(input: {
  record: ProjectTrackerRecord | null | undefined
  timestamp?: string
}) {
  const { record } = input
  if (!record?.finalReviewPromptSubmittedAt || record.finalReviewAnswerReceivedAt) return null
  const timestamp = input.timestamp ?? new Date().toISOString()

  return {
    ...record,
    updatedAt: timestamp,
    finalReviewAnswerReceivedAt: timestamp
  }
}

export function markProjectTrackerTestingCheckpointAnswered(input: {
  record: ProjectTrackerRecord | null | undefined
  timestamp?: string
}) {
  const { record } = input
  if (!record?.finalReviewAnswerReceivedAt || record.testingCheckpointAnsweredAt) return null
  const timestamp = input.timestamp ?? new Date().toISOString()

  return {
    ...record,
    updatedAt: timestamp,
    testingCheckpointAnsweredAt: timestamp
  }
}

function formatProjectTrackerList(label: string, values: string[], limit = 5) {
  const items = values.slice(0, limit).map((value) => `- ${value}`)
  return `${label}:\n${items.length ? items.join("\n") : "- Not specified"}`
}

function formatProjectTrackerBullets(values: string[], fallback: string, limit = 6) {
  const items = normalizeList(values, limit)
  return items.length ? items.map((value) => `- ${value}`).join("\n") : `- ${fallback}`
}

function isGenericProjectTrackerRequirementText(value: string) {
  const text = normalize(value).toLowerCase()
  if (!text) return true

  return [
    "match the submitted prompt requirements",
    "submitted prompt requirements",
    "match the prompt",
    "current phase requirements",
    "project tracker mode",
    "phase requirements"
  ].some((pattern) => text === pattern || text.includes(pattern))
}

function isIgnoredExternalValidationText(input: {
  ignoredExternalValidation?: string[]
  label?: string
  value: string
}) {
  const candidates = normalizeList(input.ignoredExternalValidation, 12).map((item) => item.toLowerCase())
  const raw = normalize(input.value).toLowerCase()
  const prefixed = normalize(input.label ? `${input.label}: ${input.value}` : input.value).toLowerCase()
  return candidates.some((item) => item === raw || item === prefixed || item.includes(raw) || item.includes(prefixed))
}

function filterIgnoredExternalValidationRows(input: {
  ignoredExternalValidation?: string[]
  label: string
  values: string[]
}) {
  return input.values.filter(
    (value) =>
      !isIgnoredExternalValidationText({
        ignoredExternalValidation: input.ignoredExternalValidation,
        label: input.label,
        value
      })
  )
}

export function isProjectTrackerAwaitingFreshAnswer(input: {
  record: ProjectTrackerRecord | null | undefined
  assistantAnswerHash?: string | null
}) {
  const { record } = input
  if (!record?.enabled || !record.awaitingNextPhaseAnswer) return false
  if (!record.lastReviewedAssistantAnswerHash || !input.assistantAnswerHash) return false
  return record.lastReviewedAssistantAnswerHash === input.assistantAnswerHash
}

export function getSpecificProjectTrackerRequirementMatches(analysis: ProjectTrackerPromptAnalysis) {
  return (analysis.requirementMatches ?? []).filter(
    (match) => !isGenericProjectTrackerRequirementText(match.requirementText)
  )
}

export function getProjectTrackerCarryoverItems(analysis: ProjectTrackerPromptAnalysis, limit = 8) {
  return normalizeList(
    getSpecificProjectTrackerRequirementMatches(analysis)
      .filter((match) => match.status !== "pass")
      .map((match) => match.requirementText),
    limit
  )
}

export function shouldShowProjectTrackerFinalReview(record: ProjectTrackerRecord | null | undefined) {
  return Boolean(record && isProjectTrackerCompleted(record) && !record.finalReviewAnswerReceivedAt)
}

function getProjectTrackerPhaseCheckItems(phase: ProjectTrackerPhase) {
  return [
    ...phase.buildScope.map((value) => `Build scope: ${value}`),
    ...phase.deliverables.map((value) => `Deliverable: ${value}`),
    ...phase.acceptanceCriteria.map((value) => `Acceptance criteria: ${value}`),
    ...phase.validationProofExpected.map((value) => `Validation proof: ${value}`)
  ].slice(0, 10)
}

function formatProjectTrackerPhaseForReview(input: {
  phase: ProjectTrackerPhase
  phaseNumber: number
  totalPhases: number
}) {
  const { phase, phaseNumber, totalPhases } = input

  return [
    `Phase ${phaseNumber} of ${totalPhases}: ${phase.title}`,
    `Goal: ${phase.goal}`,
    formatProjectTrackerList("Build scope", phase.buildScope),
    formatProjectTrackerList("Out of scope", phase.outOfScope),
    formatProjectTrackerList("Data/state needed", phase.dataStateNeeded),
    formatProjectTrackerList("Deliverables", phase.deliverables),
    formatProjectTrackerList("Acceptance criteria", phase.acceptanceCriteria),
    formatProjectTrackerList("Validation proof expected", phase.validationProofExpected)
  ].join("\n")
}

export function buildProjectTrackerDeepAnalysisBrief(record: ProjectTrackerRecord | null | undefined) {
  if (!record?.enabled || isProjectTrackerCompleted(record)) return null

  const activePhase = getActiveProjectTrackerPhase(record)
  if (!activePhase) return null

  const nextPhase = getNextProjectTrackerPhase(record)
  const currentPhaseNumber = record.currentPhaseIndex + 1
  const nextPhaseNumber = currentPhaseNumber + 1

  const currentPhaseBrief = formatProjectTrackerPhaseForReview({
    phase: activePhase,
    phaseNumber: currentPhaseNumber,
    totalPhases: record.phases.length
  })
  const nextPhaseBrief = nextPhase
    ? formatProjectTrackerPhaseForReview({
        phase: nextPhase,
        phaseNumber: nextPhaseNumber,
        totalPhases: record.phases.length
      })
    : "No next phase. This is the final tracked phase."

  return {
    promptText: [
      "Project tracker mode is on. Review the latest AI agent answer against the CURRENT phase only.",
      "",
      `Project: ${record.projectLabel}`,
      `Tracker project id: ${record.projectId}`,
      `Source PRD hash: ${record.prdHash}`,
      "",
      "CURRENT PHASE REQUIREMENTS",
      currentPhaseBrief,
      "",
      "REQUIREMENT-LEVEL CHECKLIST",
      "Return one requirement match for each item below. Do not collapse these into a generic row like \"Match the submitted prompt requirements\".",
      formatProjectTrackerBullets(
        getProjectTrackerPhaseCheckItems(activePhase),
        "Check the concrete current-phase build scope, deliverables, acceptance criteria, and validation proof.",
        10
      ),
      "",
      "NEXT PHASE REQUIREMENTS",
      nextPhaseBrief,
      "",
      "Decision rules:",
      "- First classify each checklist row as actionable implementation/app acceptance work or external validation.",
      "- External validation depends on real users, customers, stakeholders, production data, interviews, surveys, business metrics, live experiments, or approvals.",
      "- Ignore external validation for phase advancement and do not count it as missing.",
      "- Then decide whether the latest AI agent answer completed the actionable current-phase implementation requirements and acceptance criteria.",
      "- The phase can pass only when specific current-phase checklist rows pass. A generic requirement row is not enough.",
      "- If the current phase is incomplete, generate a prompt that asks the AI agent to finish only the missing current-phase requirements.",
      "- If the current phase is complete and a next phase exists, generate a prompt that asks the AI agent to implement the next phase only.",
      "- If the current phase is complete and there is no next phase, say the tracked project plan is complete.",
      "- Do not ask for the full PRD and do not advance beyond the next phase.",
      "- Use the latest AI agent answer as the evidence source."
    ].join("\n"),
    projectContext: [
      `Project tracker mode is active for ${record.projectLabel}.`,
      `Current phase: ${currentPhaseNumber}/${record.phases.length} - ${activePhase.title}.`,
      nextPhase ? `Next phase: ${nextPhaseNumber}/${record.phases.length} - ${nextPhase.title}.` : "No next phase remains."
    ].join("\n"),
    currentState: [
      "Use project tracker mode for this review.",
      `Current tracked phase status: ${activePhase.status}.`,
      "Judge the current phase before suggesting any next implementation prompt."
    ].join("\n")
  }
}

export function buildProjectTrackerCurrentPhasePrompt(
  record: ProjectTrackerRecord | null | undefined,
  projectContextBlock?: string | null
) {
  if (!record?.enabled || isProjectTrackerCompleted(record)) return null

  const currentPhase = getActiveProjectTrackerPhase(record)
  if (!currentPhase) return null

  const nextPhase = getNextProjectTrackerPhase(record)
  const currentPhaseNumber = record.currentPhaseIndex + 1

  const generatedPrompt = [
    `Implement Phase ${currentPhaseNumber}: ${currentPhase.title} only.`,
    "",
    "Use the existing app and previous completed phases as the starting point.",
    "",
    `Goal: ${currentPhase.goal}`,
    "",
    "Build scope:",
    formatProjectTrackerBullets(currentPhase.buildScope, "Complete the current phase build scope."),
    "",
    "Out of scope for this phase:",
    formatProjectTrackerBullets(currentPhase.outOfScope, "Do not add unrelated scope."),
    "",
    "Data/state needed:",
    formatProjectTrackerBullets(currentPhase.dataStateNeeded, "Use the minimum state needed for this phase."),
    "",
    "Deliverables:",
    formatProjectTrackerBullets(currentPhase.deliverables, "Complete the current phase deliverables."),
    "",
    "Acceptance criteria:",
    formatProjectTrackerBullets(currentPhase.acceptanceCriteria, "Validate the current phase acceptance criteria."),
    "",
    currentPhase.validationProofExpected.length ? "Validation proof expected:" : "",
    currentPhase.validationProofExpected.length
      ? formatProjectTrackerBullets(currentPhase.validationProofExpected, "Show concrete validation proof.")
      : "",
    currentPhase.validationProofExpected.length ? "" : "",
    nextPhase ? `Do not start Phase ${currentPhaseNumber + 1}: ${nextPhase.title} yet.` : "Do not add new scope yet.",
    "",
    PROJECT_TRACKER_COMPLETION_CTA
  ].join("\n")
  let generatedPromptWithContext = generatedPrompt
  try {
    if (
      projectContextBlock?.trim() &&
      !generatedPrompt.includes("--- PROJECT CONTEXT (do not remove) ---")
    ) {
      generatedPromptWithContext = `${generatedPrompt.trimEnd()}\n\n${projectContextBlock}`
    }
  } catch {
    generatedPromptWithContext = generatedPrompt
  }

  return {
    promptIntent: "implement_next_step" as const,
    generatedPrompt: generatedPromptWithContext,
    recommendedNextMove: `Submit the Phase ${currentPhaseNumber}: ${currentPhase.title} prompt and wait for the new answer.`,
    nextStepRequirements: [
      ...currentPhase.buildScope,
      ...currentPhase.deliverables,
      ...currentPhase.acceptanceCriteria
    ].slice(0, 8),
    blockedScope: [
      nextPhase ? `Phase ${currentPhaseNumber + 1}: ${nextPhase.title}` : "new scope",
      ...currentPhase.outOfScope
    ].filter(Boolean).slice(0, 8)
  }
}

export function buildProjectTrackerFinalReviewPrompt(input: {
  record: ProjectTrackerRecord | null | undefined
  carryoverItems?: string[]
  force?: boolean
}) {
  const { record } = input
  if (!record || (!input.force && !isProjectTrackerCompleted(record))) return null

  const carryoverItems = normalizeList([...(record.carryoverItems ?? []), ...(input.carryoverItems ?? [])], 12)
  const trackerCompleted = isProjectTrackerCompleted(record)
  const phaseSummary = record.phases
    .map((phase, index) => `- Phase ${index + 1}: ${phase.title} (${trackerCompleted ? "completed" : phase.status})`)
    .join("\n")

  return {
    promptIntent: "review_before_advancing" as const,
    generatedPrompt: [
      "All tracked implementation phases are complete.",
      "",
      "Before we consider this MVP finished, review the full implementation against the original PRD.",
      "",
      "Tracked phases:",
      phaseSummary || "- No tracked phases were captured.",
      "",
      "First, resolve any remaining tracked implementation gaps:",
      carryoverItems.length
        ? formatProjectTrackerBullets(carryoverItems, "Resolve remaining tracked implementation gaps.", 12)
        : "- No known tracked implementation gaps were captured.",
      "",
      "If any listed item is already implemented, provide concrete evidence.",
      "If any listed item is not implemented, implement only that remaining tracked requirement now.",
      "Do not add new scope beyond these tracked requirements.",
      "",
      "Then provide the final MVP review:",
      "- What was completed across each phase",
      "- What changed in this final cleanup, if anything",
      "- Any missing, incomplete, or risky requirements",
      "- Out-of-scope confirmation",
      "- Concrete validation proof for key acceptance criteria",
      "- Validation proof still requiring real users, real devices, production data, or cohort results",
      "- Main manual test cases I should run as the user",
      "- Known risks or assumptions",
      "- Recommended next step after MVP",
      "",
      "After you finish, confirm what is complete and what still needs user testing."
    ].join("\n"),
    recommendedNextMove: "Review final MVP readiness and fix any remaining tracked gaps.",
    nextStepRequirements: carryoverItems,
    blockedScope: ["new product scope", "untracked features"].slice(0, 8)
  }
}

export function buildProjectTrackerHandoffPrompt(input: {
  record: ProjectTrackerRecord | null | undefined
  analysis: ProjectTrackerPromptAnalysis
  latestAnswerContext?: string | null
}) {
  const { record, analysis } = input
  if (!record?.enabled || isProjectTrackerCompleted(record)) return null

  const currentPhase = getActiveProjectTrackerPhase(record)
  if (!currentPhase) return null

  const nextPhase = getNextProjectTrackerPhase(record)
  const currentPhaseNumber = record.currentPhaseIndex + 1
  const nextPhaseNumber = currentPhaseNumber + 1
  const currentPhaseIncomplete = !shouldAdvanceProjectTrackerFromAnalysis(analysis)
  const carryoverMissing = normalizeList(
    (analysis.requirementMatches ?? [])
      .filter((match) => match.status !== "pass" && !isGenericProjectTrackerRequirementText(match.requirementText))
      .map((match) => match.requirementText),
    6
  )
  const currentAcceptanceCriteria = filterIgnoredExternalValidationRows({
    ignoredExternalValidation: analysis.ignoredExternalValidation,
    label: "Acceptance criteria",
    values: currentPhase.acceptanceCriteria
  })
  const currentValidationProofExpected = filterIgnoredExternalValidationRows({
    ignoredExternalValidation: analysis.ignoredExternalValidation,
    label: "Validation proof",
    values: currentPhase.validationProofExpected
  })

  if (currentPhaseIncomplete) {
    const specificMatches = getSpecificProjectTrackerRequirementMatches(analysis)
    const missingFromAnalysis = normalizeList(
      (analysis.requirementMatches ?? [])
        .filter((match) => match.status !== "pass" && !isGenericProjectTrackerRequirementText(match.requirementText))
        .map((match) => match.requirementText),
      6
    )
    const missing =
      missingFromAnalysis.length > 0
        ? missingFromAnalysis
        : normalizeList(
            specificMatches.length > 0
              ? getProjectTrackerPhaseCheckItems(currentPhase).filter(
                  (item) =>
                    !specificMatches.some(
                      (match) =>
                        match.status === "pass" &&
                        normalize(item).toLowerCase().includes(normalize(match.requirementText).toLowerCase())
                    )
                )
              : getProjectTrackerPhaseCheckItems(currentPhase),
            6
          )
    const latestAnswerContext = normalize(input.latestAnswerContext)
    const latestAnswerExcerpt =
      latestAnswerContext.length > 700
        ? `${latestAnswerContext.slice(0, 700).trim()}...`
        : latestAnswerContext

    return {
      promptIntent: "confirm_missing_requirements" as const,
      generatedPrompt: [
        `Finish Phase ${currentPhaseNumber}: ${currentPhase.title} before moving forward.`,
        "",
        "Use this latest answer context as the starting point:",
        latestAnswerExcerpt || "- No latest answer context was captured.",
        "",
        "Deep Analysis marked these current-phase items as missing, unclear, or insufficiently proven:",
        formatProjectTrackerBullets(missing, "Re-check the current phase requirements and provide concrete evidence."),
        "",
        "For each item above:",
        "- If it is already implemented, provide concrete evidence such as screenshots, test output, timing proof, logs, or exact files/components changed.",
        "- If it is not implemented or not working, complete only that item and then provide evidence.",
        "- Do not redo completed work unless it is needed to produce the missing proof.",
        "",
        "Current phase requirements:",
        `Goal: ${currentPhase.goal}`,
        "",
        "Build scope:",
        formatProjectTrackerBullets(currentPhase.buildScope, "Complete the current phase build scope."),
        "",
        "Deliverables:",
        formatProjectTrackerBullets(currentPhase.deliverables, "Complete the current phase deliverables."),
        "",
        "Acceptance criteria:",
        formatProjectTrackerBullets(currentAcceptanceCriteria, "Validate the current phase acceptance criteria."),
        "",
        currentValidationProofExpected.length ? "Validation proof expected:" : "",
        currentValidationProofExpected.length ? formatProjectTrackerBullets(currentValidationProofExpected, "Show concrete validation proof.") : "",
        currentValidationProofExpected.length ? "" : "",
        nextPhase ? `Do not start Phase ${nextPhaseNumber}: ${nextPhase.title} yet.` : "Do not add new scope yet.",
        "",
        PROJECT_TRACKER_COMPLETION_CTA
      ].join("\n"),
      recommendedNextMove: `Finish Phase ${currentPhaseNumber}: ${currentPhase.title} before advancing.`,
      nextStepRequirements: missing,
      blockedScope: [
        nextPhase ? `Phase ${nextPhaseNumber}: ${nextPhase.title}` : "new scope",
        ...currentPhase.outOfScope
      ].filter(Boolean).slice(0, 8)
    }
  }

  if (!nextPhase) {
    return buildProjectTrackerFinalReviewPrompt({
      record,
      carryoverItems: carryoverMissing,
      force: true
    })
  }

  return {
    promptIntent: "implement_next_step" as const,
    generatedPrompt: [
      `Implement Phase ${nextPhaseNumber}: ${nextPhase.title} only.`,
      "",
      "Use the work already completed in the latest answer as the starting point.",
      "",
      carryoverMissing.length ? "Also carry forward these missing or unclear items from the previous completed phase:" : "",
      carryoverMissing.length ? formatProjectTrackerBullets(carryoverMissing, "Resolve previous phase carryover items.") : "",
      carryoverMissing.length ? "" : "",
      `Goal: ${nextPhase.goal}`,
      "",
      "Build scope:",
      formatProjectTrackerBullets(nextPhase.buildScope, "Complete the next phase build scope."),
      "",
      "Out of scope for this phase:",
      formatProjectTrackerBullets(nextPhase.outOfScope, "Do not add unrelated scope."),
      "",
      "Data/state needed:",
      formatProjectTrackerBullets(nextPhase.dataStateNeeded, "Use the minimum state needed for this phase."),
      "",
      "Deliverables:",
      formatProjectTrackerBullets(nextPhase.deliverables, "Complete the next phase deliverables."),
      "",
      "Acceptance criteria:",
      formatProjectTrackerBullets(nextPhase.acceptanceCriteria, "Validate the next phase acceptance criteria."),
      "",
      nextPhase.validationProofExpected.length ? "Validation proof expected:" : "",
      nextPhase.validationProofExpected.length ? formatProjectTrackerBullets(nextPhase.validationProofExpected, "Show concrete validation proof.") : "",
      nextPhase.validationProofExpected.length ? "" : "",
      `Do not start Phase ${nextPhaseNumber + 1} yet.`,
      "",
      PROJECT_TRACKER_COMPLETION_CTA
    ].join("\n"),
    recommendedNextMove: `Implement Phase ${nextPhaseNumber}: ${nextPhase.title}.`,
    nextStepRequirements: [
      ...carryoverMissing,
      ...nextPhase.buildScope,
      ...nextPhase.deliverables,
      ...nextPhase.acceptanceCriteria
    ].slice(0, 8),
    blockedScope: [
      `Phase ${nextPhaseNumber + 1}`,
      ...nextPhase.outOfScope
    ].filter(Boolean).slice(0, 8)
  }
}
