import type { RequestBrief } from "@prompt-optimizer/shared/src/request-brief"
import type { GoalContract } from "../goal/types"
import type { ReviewContract, ReviewFollowUpStrategyMode } from "../review/contracts"
import {
  deriveWorkflowStateFromAnalysis,
  deriveWorkflowStateFromRequestBrief,
  type ReviewWorkflowState
} from "../review/workflow-state"

export type StructuredProjectPhase = "discovery" | "planning" | "implementation" | "validation" | "done"

export type ArchitectureRecordV1 = {
  stack?: string[]
  dataModel?: string[]
  accessRules?: string[]
  conventions?: string[]
  decisions?: Array<{
    id: string
    statement: string
    status: "active" | "superseded"
    strength: "required" | "preferred"
  }>
}

export type ArchitectureConfirmationState = {
  source: "planning" | "imported_context"
  draft: string
  editing: boolean
}

export type StructuredProjectMemory = {
  stableConstraints: string[]
  protectedAreas: string[]
  acceptedAssumptions: string[]
  preferredPatterns: string[]
  knownBadDirections: string[]
  currentFeatureArea: string
  currentPhase: StructuredProjectPhase | null
  currentWorkflowState: ReviewWorkflowState | null
  architecture?: ArchitectureRecordV1
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function sentenceCase(value: string) {
  const trimmed = normalize(value)
  if (!trimmed) return ""
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`
}

function uniqueItems(values: Array<string | null | undefined>, limit = Number.POSITIVE_INFINITY) {
  const seen = new Set<string>()
  const items: string[] = []

  for (const raw of values) {
    const value = normalize(raw ?? "")
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    items.push(value)
    if (items.length >= limit) break
  }

  return items
}

function architectureList(value: unknown) {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return undefined
  return uniqueItems(value)
}

function architectureDecisions(value: unknown): NonNullable<ArchitectureRecordV1["decisions"]> | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return undefined

  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return []
    const decision = item as Record<string, unknown>
    if (
      typeof decision.id !== "string" ||
      typeof decision.statement !== "string" ||
      (decision.status !== "active" && decision.status !== "superseded") ||
      (decision.strength !== "required" && decision.strength !== "preferred")
    ) {
      return []
    }

    const id = normalize(decision.id)
    const statement = normalize(decision.statement)
    if (!id || !statement) return []
    return [{ id, statement, status: decision.status, strength: decision.strength }]
  })
}

function mergeArchitectureRecord(base: unknown, patch: unknown): ArchitectureRecordV1 | undefined {
  const baseRecord = base && typeof base === "object" && !Array.isArray(base) ? (base as Record<string, unknown>) : null
  const patchRecord = patch && typeof patch === "object" && !Array.isArray(patch) ? (patch as Record<string, unknown>) : null
  if (!baseRecord && !patchRecord) return undefined

  const stack = uniqueItems([...(architectureList(baseRecord?.stack) ?? []), ...(architectureList(patchRecord?.stack) ?? [])])
  const dataModel = uniqueItems([
    ...(architectureList(baseRecord?.dataModel) ?? []),
    ...(architectureList(patchRecord?.dataModel) ?? [])
  ])
  const accessRules = uniqueItems([
    ...(architectureList(baseRecord?.accessRules) ?? []),
    ...(architectureList(patchRecord?.accessRules) ?? [])
  ])
  const conventions = uniqueItems([
    ...(architectureList(baseRecord?.conventions) ?? []),
    ...(architectureList(patchRecord?.conventions) ?? [])
  ])
  const decisionsById = new Map<string, NonNullable<ArchitectureRecordV1["decisions"]>[number]>()
  for (const decision of [
    ...(architectureDecisions(baseRecord?.decisions) ?? []),
    ...(architectureDecisions(patchRecord?.decisions) ?? [])
  ]) {
    decisionsById.set(decision.id.toLowerCase(), decision)
  }
  const decisions = [...decisionsById.values()]

  if (!stack.length && !dataModel.length && !accessRules.length && !conventions.length && !decisions.length) {
    return undefined
  }

  return {
    ...(stack.length ? { stack } : {}),
    ...(dataModel.length ? { dataModel } : {}),
    ...(accessRules.length ? { accessRules } : {}),
    ...(conventions.length ? { conventions } : {}),
    ...(decisions.length ? { decisions } : {})
  }
}

function architectureRecordFromLists(input: {
  stack?: string[]
  dataModel?: string[]
  accessRules?: string[]
  conventions?: string[]
}): ArchitectureRecordV1 | undefined {
  return mergeArchitectureRecord(undefined, input)
}

function architectureTextLines(value: string | null | undefined) {
  return (value ?? "")
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s*/, "").trim())
    .filter((line) => line && !/^not yet specified$/i.test(line))
}

export function deriveArchitectureRecordFromPlanning(input: {
  accessAndRoles?: string | null
  dataAndSensitivity?: string | null
  deploymentAndServices?: string | null
  qualityPriorities?: string | null
  nonFunctionalRequirements?: string | null
}): ArchitectureRecordV1 | undefined {
  try {
    const stack = architectureTextLines(input.deploymentAndServices)
    const dataModel = architectureTextLines(input.dataAndSensitivity)
    const accessRules = architectureTextLines(input.accessAndRoles)
    const conventions = architectureTextLines(input.qualityPriorities)
    let activeSection: "stack" | "dataModel" | "accessRules" | "conventions" | null = null

    for (const rawLine of (input.nonFunctionalRequirements ?? "").split(/\n+/)) {
      const line = rawLine.trim()
      if (!line) continue
      const heading = line.replace(/:$/, "").toLowerCase()
      if (/access|permission|auth/.test(heading) && !/^[-*]/.test(line)) {
        activeSection = "accessRules"
        continue
      }
      if (/data handling|data model|privacy/.test(heading) && !/^[-*]/.test(line)) {
        activeSection = "dataModel"
        continue
      }
      if (/deployment|outside services|stack|integration/.test(heading) && !/^[-*]/.test(line)) {
        activeSection = "stack"
        continue
      }
      if (/quality|validation|error handling|convention|maintenance|logging/.test(heading) && !/^[-*]/.test(line)) {
        activeSection = "conventions"
        continue
      }
      if (/confirmed assumptions|project risk/i.test(heading) && !/^[-*]/.test(line)) {
        activeSection = null
        continue
      }

      const item = line.replace(/^\s*(?:[-*]|\d+\.)\s*/, "").trim()
      if (!item || /^not yet specified$/i.test(item) || !activeSection) continue
      if (activeSection === "stack") stack.push(item)
      if (activeSection === "dataModel") dataModel.push(item)
      if (activeSection === "accessRules") accessRules.push(item)
      if (activeSection === "conventions") conventions.push(item)
    }

    return architectureRecordFromLists({ stack, dataModel, accessRules, conventions })
  } catch {
    return undefined
  }
}

export function deriveArchitectureRecordFromImportedMarkdown(markdown: string): ArchitectureRecordV1 | undefined {
  try {
    const heading = /^#{1,6}\s+Architecture\s*$/im.exec(markdown)
    if (!heading || heading.index === undefined) return undefined
    const contentStart = heading.index + heading[0].length
    const remaining = markdown.slice(contentStart)
    const nextHeading = /^#{1,6}\s+.+$/m.exec(remaining)
    const section = remaining.slice(0, nextHeading?.index ?? remaining.length)
    const stack: string[] = []
    const dataModel: string[] = []
    const accessRules: string[] = []
    const conventions: string[] = []

    for (const item of architectureTextLines(section)) {
      let matched = false
      if (/\b(access|auth|permission|role|owner|admin|session|sign[ -]?in|visible to|see|view|change|edit|their own)\b/i.test(item)) {
        accessRules.push(item)
        matched = true
      }
      if (/\b(data|schema|table|entity|record|state|flow|belongs?|relationship|stores?|collection)\b/i.test(item)) {
        dataModel.push(item)
        matched = true
      }
      if (/\b(stack|framework|frontend|backend|database|runtime|hosting|integration|api|service|provider|built with|uses?)\b/i.test(item)) {
        stack.push(item)
        matched = true
      }
      if (/\b(convention|pattern|component|module|folder|directory|layer|route|hook|through)\b/i.test(item)) {
        conventions.push(item)
        matched = true
      }
      if (!matched) conventions.push(item)
    }

    return architectureRecordFromLists({ stack, dataModel, accessRules, conventions })
  } catch {
    return undefined
  }
}

export function formatArchitectureRecordForConfirmation(record: ArchitectureRecordV1 | null | undefined) {
  try {
    const architecture = mergeArchitectureRecord(undefined, record)
    if (!architecture) return ""
    const sections = [
      architecture.stack?.length ? `Stack\n${architecture.stack.map((item) => `- ${item}`).join("\n")}` : "",
      architecture.dataModel?.length ? `Data model\n${architecture.dataModel.map((item) => `- ${item}`).join("\n")}` : "",
      architecture.accessRules?.length ? `Access rules\n${architecture.accessRules.map((item) => `- ${item}`).join("\n")}` : "",
      architecture.conventions?.length ? `Conventions\n${architecture.conventions.map((item) => `- ${item}`).join("\n")}` : ""
    ].filter(Boolean)
    return sections.join("\n\n")
  } catch {
    return ""
  }
}

export function parseArchitectureConfirmationDraft(value: string): ArchitectureRecordV1 | undefined {
  try {
    const lists = {
      stack: [] as string[],
      dataModel: [] as string[],
      accessRules: [] as string[],
      conventions: [] as string[]
    }
    let activeSection: keyof typeof lists | null = null

    for (const rawLine of value.split(/\n+/)) {
      const line = rawLine.trim()
      if (!line) continue
      const heading = line.replace(/:$/, "").toLowerCase()
      if (heading === "stack") activeSection = "stack"
      else if (heading === "data model") activeSection = "dataModel"
      else if (heading === "access rules") activeSection = "accessRules"
      else if (heading === "conventions") activeSection = "conventions"
      else if (activeSection) lists[activeSection].push(line.replace(/^\s*(?:[-*]|\d+\.)\s*/, "").trim())
    }

    return architectureRecordFromLists(lists)
  } catch {
    return undefined
  }
}

function extractBulletLikeLines(text: string) {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean)
}

function matchingLines(text: string, pattern: RegExp, limit = 6) {
  return uniqueItems(
    extractBulletLikeLines(text).filter((line) => pattern.test(line)),
    limit
  )
}

function inferCurrentFeatureArea(projectContext: string, currentState: string) {
  const currentLines = extractBulletLikeLines(currentState)
  const projectLines = extractBulletLikeLines(projectContext)

  const preferredCurrent = currentLines.find((line) =>
    /\bworking on|current bug|feature|settings|popup|auth|routing|review|analysis|prompt|ui|screen|page|extension\b/i.test(line)
  )
  if (preferredCurrent) return sentenceCase(preferredCurrent)

  const preferredProject = projectLines.find((line) =>
    /\bproject|app|extension|feature|workflow|review|analysis|prompt|ui|screen|page\b/i.test(line)
  )
  if (preferredProject) return sentenceCase(preferredProject)

  return sentenceCase(currentLines[0] ?? projectLines[0] ?? "")
}

function inferCurrentPhase(text: string, fallback: StructuredProjectPhase | null = null): StructuredProjectPhase | null {
  const normalized = text.toLowerCase()
  if (!normalized.trim()) return fallback
  if (/\bdone\b|\bcomplete\b|\bcompleted\b|\bready to ship\b|\bresolved\b/.test(normalized)) return "done"
  if (/\bvalidate\b|\bvalidation\b|\bverify\b|\bverification\b|\bproof\b|\btest\b|\bsmoke\b|\bregression\b/.test(normalized)) {
    return "validation"
  }
  if (/\bimplement\b|\bimplementation\b|\bbuild\b|\bfix\b|\bupdate\b|\bwire\b|\bchange\b|\bedit\b|\bpatch\b/.test(normalized)) {
    return "implementation"
  }
  if (/\bplan\b|\bscope\b|\bclarify\b|\bphase\b|\bapproach\b|\bdefine\b|\bbrief\b/.test(normalized)) return "planning"
  if (/\binvestigate\b|\bexplore\b|\bunderstand\b|\bdiscover\b|\btriage\b/.test(normalized)) return "discovery"
  return fallback
}

export function createEmptyStructuredProjectMemory(): StructuredProjectMemory {
  return {
    stableConstraints: [],
    protectedAreas: [],
    acceptedAssumptions: [],
    preferredPatterns: [],
    knownBadDirections: [],
    currentFeatureArea: "",
    currentPhase: null,
    currentWorkflowState: null,
    architecture: undefined
  }
}

export function mergeStructuredProjectMemory(
  base: StructuredProjectMemory | null | undefined,
  patch: Partial<StructuredProjectMemory> | null | undefined
): StructuredProjectMemory | null {
  if (!base && !patch) return null

  const next = createEmptyStructuredProjectMemory()
  const source = base ?? createEmptyStructuredProjectMemory()
  const incoming = patch ?? {}

  next.stableConstraints = uniqueItems([...(source.stableConstraints ?? []), ...(incoming.stableConstraints ?? [])], 10)
  next.protectedAreas = uniqueItems([...(source.protectedAreas ?? []), ...(incoming.protectedAreas ?? [])], 10)
  next.acceptedAssumptions = uniqueItems([...(source.acceptedAssumptions ?? []), ...(incoming.acceptedAssumptions ?? [])], 8)
  next.preferredPatterns = uniqueItems([...(source.preferredPatterns ?? []), ...(incoming.preferredPatterns ?? [])], 8)
  next.knownBadDirections = uniqueItems([...(source.knownBadDirections ?? []), ...(incoming.knownBadDirections ?? [])], 8)
  next.currentFeatureArea = normalize(incoming.currentFeatureArea ?? source.currentFeatureArea ?? "")
  next.currentPhase = incoming.currentPhase ?? source.currentPhase ?? null
  next.currentWorkflowState = incoming.currentWorkflowState ?? source.currentWorkflowState ?? null
  next.architecture = mergeArchitectureRecord(source.architecture, incoming.architecture)

  const hasSignal =
    next.stableConstraints.length > 0 ||
    next.protectedAreas.length > 0 ||
    next.acceptedAssumptions.length > 0 ||
    next.preferredPatterns.length > 0 ||
    next.knownBadDirections.length > 0 ||
    Boolean(next.currentFeatureArea) ||
    Boolean(next.currentPhase) ||
    Boolean(next.currentWorkflowState) ||
    Boolean(next.architecture)

  return hasSignal ? next : null
}

export function replaceStructuredProjectMemoryFields(
  base: StructuredProjectMemory | null | undefined,
  patch: {
    protectedAreas?: string[]
    currentFeatureArea?: string
    currentPhase?: StructuredProjectPhase | null
    architecture?: ArchitectureRecordV1 | null
  }
): StructuredProjectMemory | null {
  const source = mergeStructuredProjectMemory(base, null) ?? createEmptyStructuredProjectMemory()
  const next: StructuredProjectMemory = {
    ...source,
    protectedAreas:
      patch.protectedAreas !== undefined ? uniqueItems(patch.protectedAreas, 10) : source.protectedAreas,
    currentFeatureArea:
      patch.currentFeatureArea !== undefined ? normalize(patch.currentFeatureArea) : source.currentFeatureArea,
    currentPhase: patch.currentPhase !== undefined ? patch.currentPhase : source.currentPhase,
    architecture:
      patch.architecture !== undefined ? mergeArchitectureRecord(undefined, patch.architecture) : source.architecture
  }

  const hasSignal =
    next.stableConstraints.length > 0 ||
    next.protectedAreas.length > 0 ||
    next.acceptedAssumptions.length > 0 ||
    next.preferredPatterns.length > 0 ||
    next.knownBadDirections.length > 0 ||
    Boolean(next.currentFeatureArea) ||
    Boolean(next.currentPhase) ||
    Boolean(next.currentWorkflowState) ||
    Boolean(next.architecture)

  return hasSignal ? next : null
}

export function buildStructuredProjectMemoryFromTexts(input: {
  projectContext: string
  currentState: string
}): StructuredProjectMemory | null {
  const { projectContext, currentState } = input
  const combined = `${projectContext}\n${currentState}`.trim()
  if (!combined) return null

  return mergeStructuredProjectMemory(null, {
    stableConstraints: matchingLines(
      combined,
      /\bconstraint|requirement|definition of done|must\b|non-negotiable|keep\b|stay within\b/i
    ),
    protectedAreas: matchingLines(
      combined,
      /\bdo not change\b|\bmust not\b|\bleave untouched\b|\bpreserve\b|\bprotected\b|\bstay aligned\b/i
    ),
    acceptedAssumptions: matchingLines(combined, /\bassum(?:e|ing)\b/i),
    preferredPatterns: matchingLines(
      combined,
      /\breuse\b|\bexisting pattern\b|\bexisting flow\b|\bconvention\b|\bkeep using\b|\bfollow\b.*\bpattern\b/i
    ),
    knownBadDirections: matchingLines(
      combined,
      /\brepeated\b|\bdrift\b|\bwrong direction\b|\bavoid\b|\bfixing symptoms\b|\bbroader rewrite\b|\bloop\b/i
    ),
    currentFeatureArea: inferCurrentFeatureArea(projectContext, currentState),
    currentPhase: inferCurrentPhase(combined),
    currentWorkflowState: null
  })
}

export function buildStructuredProjectMemoryPatchFromRequestBrief(brief: RequestBrief | null | undefined) {
  if (!brief) return null

  return mergeStructuredProjectMemory(null, {
    stableConstraints: uniqueItems([...brief.constraints, ...brief.successCriteria], 8),
    protectedAreas: uniqueItems(brief.nonGoals, 6),
    acceptedAssumptions: uniqueItems(brief.assumptions, 6),
    preferredPatterns: brief.riskLevel !== "low" ? ["Preserve existing architecture and prefer the safest incremental path."] : [],
    currentFeatureArea: brief.goal,
    currentPhase: "planning",
    currentWorkflowState: deriveWorkflowStateFromRequestBrief(brief)
  })
}

function strategyToPhase(mode: ReviewFollowUpStrategyMode | null | undefined): StructuredProjectPhase | null {
  switch (mode) {
    case "validate_before_continue":
      return "validation"
    case "plan_first":
    case "clarify_scope":
    case "split_into_phases":
      return "planning"
    case "direct_revise":
      return "implementation"
    case "no_retry":
      return "done"
    default:
      return null
  }
}

function failureTypeDirectionLabel(type: string) {
  switch (type) {
    case "wrong_direction":
      return "Avoid drifting into the wrong implementation direction."
    case "proof_missing":
      return "Do not claim success without validation or visible proof."
    case "hard_constraint_violation":
      return "Do not broaden the change in ways that break hard constraints."
    case "missing_required_output":
      return "Do not skip required deliverables or verification details."
    default:
      return sentenceCase(type.replace(/_/g, " "))
  }
}

export function buildStructuredProjectMemoryPatchFromAnalysis(input: {
  promptText: string
  goalContract: GoalContract | null | undefined
  reviewContract: ReviewContract | null | undefined
  resultStatus?: "SUCCESS" | "PARTIAL" | "FAILED" | "WRONG_DIRECTION" | null
  taskType?: string
  previousWorkflowState?: ReviewWorkflowState | null
}) {
  const { promptText, goalContract, reviewContract } = input
  const strategyMode = reviewContract?.analysisDebug?.smart?.strategy?.mode

  return mergeStructuredProjectMemory(null, {
    stableConstraints: uniqueItems([
      ...(goalContract?.hardConstraints.map((item) => item.label) ?? []),
      ...(goalContract?.outputRequirements ?? [])
    ], 10),
    protectedAreas: uniqueItems([
      ...(goalContract?.assumptions.filter((item) => /preserve|avoid unrelated|do not change|leave untouched/i.test(item)) ?? []),
      ...(reviewContract?.topFailures
        .map((item) => item.label)
        .filter((label) => /\bpreserve\b|\bdo not change\b|\bleave untouched\b|\bunrelated\b|\bscope\b/i.test(label)) ?? [])
    ], 8),
    acceptedAssumptions: uniqueItems(goalContract?.assumptions ?? [], 6),
    preferredPatterns: uniqueItems(
      [
        ...(goalContract?.assumptions.filter((item) => /pattern|architecture|incremental|existing/i.test(item)) ?? []),
        ...(reviewContract?.checkedItems.filter((item) => /existing|pattern|architecture|layout/i.test(item)) ?? [])
      ],
      6
    ),
    knownBadDirections: uniqueItems(
      [
        ...(reviewContract?.attemptMemory?.repeatedFailureTypes.map(failureTypeDirectionLabel) ?? []),
        ...(reviewContract?.attemptMemory?.unresolvedIssues.map((item) => `Still unresolved: ${item}`) ?? []),
        ...(reviewContract?.analysisDebug?.smart?.judgments
          .filter((item) => item.status !== "met" && /scope|proof|validation|wrong direction|files|preserve|phase/i.test(item.label))
          .map((item) => sentenceCase(item.label)) ?? [])
      ],
      8
    ),
    currentFeatureArea: sentenceCase(goalContract?.userGoal || promptText),
    currentPhase: strategyToPhase(strategyMode) ?? inferCurrentPhase(promptText),
    currentWorkflowState: deriveWorkflowStateFromAnalysis({
      resultStatus: input.resultStatus ?? null,
      strategyMode,
      taskType: input.taskType ?? "",
      previousWorkflowState: input.previousWorkflowState ?? null
    })
  })
}

export function formatStructuredProjectMemorySummary(memory: StructuredProjectMemory | null | undefined) {
  if (!memory) return ""

  const architecture = mergeArchitectureRecord(undefined, memory.architecture)

  const sections = [
    memory.currentFeatureArea ? `Current feature area\n- ${memory.currentFeatureArea}` : "",
    memory.currentPhase ? `Current phase\n- ${sentenceCase(memory.currentPhase)}` : "",
    memory.currentWorkflowState ? `Workflow state\n- ${sentenceCase(memory.currentWorkflowState.replace(/_/g, " "))}` : "",
    architecture?.stack?.length ? `Architecture stack\n${architecture.stack.map((item) => `- ${item}`).join("\n")}` : "",
    architecture?.dataModel?.length
      ? `Architecture data model\n${architecture.dataModel.map((item) => `- ${sentenceCase(item)}`).join("\n")}`
      : "",
    architecture?.accessRules?.length
      ? `Architecture access rules\n${architecture.accessRules.map((item) => `- ${sentenceCase(item)}`).join("\n")}`
      : "",
    architecture?.conventions?.length
      ? `Architecture conventions\n${architecture.conventions.map((item) => `- ${sentenceCase(item)}`).join("\n")}`
      : "",
    architecture?.decisions?.length
      ? `Architecture decisions\n${architecture.decisions
          .map((item) => `- ${sentenceCase(item.statement)} (${item.strength}; ${item.status})`)
          .join("\n")}`
      : "",
    memory.protectedAreas.length
      ? `Protected areas\n${memory.protectedAreas.map((item) => `- ${sentenceCase(item)}`).join("\n")}`
      : "",
    memory.stableConstraints.length
      ? `Stable constraints\n${memory.stableConstraints.map((item) => `- ${sentenceCase(item)}`).join("\n")}`
      : "",
    memory.acceptedAssumptions.length
      ? `Accepted assumptions\n${memory.acceptedAssumptions.map((item) => `- ${sentenceCase(item)}`).join("\n")}`
      : "",
    memory.preferredPatterns.length
      ? `Preferred patterns\n${memory.preferredPatterns.map((item) => `- ${sentenceCase(item)}`).join("\n")}`
      : "",
    memory.knownBadDirections.length
      ? `Known bad directions to avoid\n${memory.knownBadDirections.map((item) => `- ${sentenceCase(item)}`).join("\n")}`
      : ""
  ].filter(Boolean)

  return sections.join("\n\n")
}
