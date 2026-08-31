import type { ImportedProjectContextRecord } from "./project-context"
import {
  mergeStructuredProjectMemory,
  type ArchitectureRecordV1,
  type StructuredProjectMemory
} from "../session/project-memory"
import {
  buildProjectContextSignal,
  formatProjectPreferenceSummary,
  type ProjectContextStatus,
  type ProjectSettingsRecord
} from "../session/project-settings"

export type ProjectContextPack = {
  projectContext: string
  currentState: string
  importedContext: ImportedProjectContextRecord | null
  structuredMemory: StructuredProjectMemory | null
  architecture?: ArchitectureRecordV1
  settings: ProjectSettingsRecord | null
  contextStatus: ProjectContextStatus
  staleReasons: string[]
  conflictReasons: string[]
  warnings: string[]
  featureArea: string
  currentPhase: StructuredProjectMemory["currentPhase"]
  currentWorkflowState: StructuredProjectMemory["currentWorkflowState"]
  protectedAreas: string[]
  stableConstraints: string[]
  acceptedAssumptions: string[]
  preferredPatterns: string[]
  knownBadDirections: string[]
  relevantFiles: string[]
  blockers: string[]
  definitionOfDone: string[]
  userIntent: string[]
  aiDriftPatterns: string[]
  preferenceSummary: string
  hints: string[]
}

const PROJECT_CONTEXT_BLOCK_START = "--- PROJECT CONTEXT (do not remove) ---"
const PROJECT_CONTEXT_BLOCK_END = "--- END PROJECT CONTEXT ---"
const PROJECT_CONTEXT_BLOCK_CHARACTER_BUDGET = 1800
const BUILD_SIMPLY_SECTION = [
  "BUILD SIMPLY",
  "Use the simplest approach that satisfies this request. Do not add",
  "abstraction layers, new libraries, configuration systems, or patterns",
  "that are not required. If you believe a more complex approach is",
  "necessary, say so and explain why instead of implementing it."
].join("\n")
const CONFLICT_RULE_SECTION = [
  "CONFLICT RULE",
  "If this request cannot be implemented within the constraints above,",
  "stop and explain the conflict before changing anything."
].join("\n")

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

function sentenceCase(value: string) {
  const trimmed = normalize(value)
  if (!trimmed) return ""
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`
}

export function buildProjectContextPack(input: {
  projectContext?: string
  currentState?: string
  importedContext?: ImportedProjectContextRecord | null
  structuredMemory?: StructuredProjectMemory | null
  settings?: ProjectSettingsRecord | null
  currentRequestText?: string
}): ProjectContextPack {
  const imported = input.importedContext ?? null
  const structured = input.structuredMemory ?? null
  const architecture = mergeStructuredProjectMemory(null, {
    architecture: structured?.architecture
  })?.architecture
  const settings = input.settings ?? null
  const summary = imported?.summary
  const contextSignal = buildProjectContextSignal({
    projectContext: input.projectContext ?? imported?.projectContext ?? "",
    currentState: input.currentState ?? imported?.currentState ?? "",
    importedContext: imported,
    structuredMemory: structured,
    previous: settings,
    importedAt: imported?.parsedAt ?? settings?.context.lastImportedAt ?? null,
    currentRequestText: input.currentRequestText ?? "",
    preferences: settings?.preferences ?? null
  })

  const pack: ProjectContextPack = {
    projectContext: normalize(input.projectContext ?? imported?.projectContext ?? ""),
    currentState: normalize(input.currentState ?? imported?.currentState ?? ""),
    importedContext: imported,
    structuredMemory: structured,
    architecture,
    settings,
    contextStatus: contextSignal.status,
    staleReasons: contextSignal.staleReasons,
    conflictReasons: contextSignal.conflictReasons,
    warnings: contextSignal.warnings,
    featureArea: normalize(structured?.currentFeatureArea ?? ""),
    currentPhase: structured?.currentPhase ?? null,
    currentWorkflowState: structured?.currentWorkflowState ?? null,
    protectedAreas: unique([
      ...(structured?.protectedAreas ?? []),
      ...(summary?.userIntent ?? []).filter((item) => /\bmust not\b|\bdo not change\b|\bpreserve\b|\bkeep\b|\buntouched\b/i.test(item))
    ], 10),
    stableConstraints: unique([
      ...(structured?.stableConstraints ?? []),
      ...(architecture?.decisions ?? [])
        .filter((item) => item.status === "active" && item.strength === "required")
        .map((item) => item.statement),
      ...(summary?.constraints ?? []),
      ...(summary?.definitionOfDone ?? [])
    ], 12),
    acceptedAssumptions: unique(structured?.acceptedAssumptions ?? [], 8),
    preferredPatterns: unique([
      ...(structured?.preferredPatterns ?? []),
      ...(architecture?.conventions ?? []),
      ...(architecture?.decisions ?? [])
        .filter((item) => item.status === "active" && item.strength === "preferred")
        .map((item) => item.statement)
    ], 8),
    knownBadDirections: unique([
      ...(structured?.knownBadDirections ?? []),
      ...(summary?.aiDriftPatterns ?? [])
    ], 8),
    relevantFiles: unique(summary?.relevantFiles ?? [], 8),
    blockers: unique(summary?.blockers ?? [], 6),
    definitionOfDone: unique(summary?.definitionOfDone ?? [], 6),
    userIntent: unique(summary?.userIntent ?? [], 6),
    aiDriftPatterns: unique(summary?.aiDriftPatterns ?? [], 6),
    preferenceSummary: settings ? formatProjectPreferenceSummary(settings.preferences) : "",
    hints: []
  }

  pack.hints = unique([
    pack.contextStatus !== "active" ? `Context status: ${pack.contextStatus}` : "",
    ...pack.warnings.map((item) => `Context warning: ${item}`),
    pack.featureArea ? `Current feature area: ${pack.featureArea}` : "",
    pack.currentPhase ? `Current phase: ${pack.currentPhase}` : "",
    pack.currentWorkflowState ? `Workflow state: ${pack.currentWorkflowState}` : "",
    ...(pack.architecture?.stack ?? []).map((item) => `Architecture stack: ${item}`),
    ...(pack.architecture?.dataModel ?? []).map((item) => `Architecture data model: ${item}`),
    ...(pack.architecture?.accessRules ?? []).map((item) => `Architecture access rule: ${item}`),
    ...(pack.architecture?.conventions ?? []).map((item) => `Architecture convention: ${item}`),
    ...(pack.architecture?.decisions ?? [])
      .filter((item) => item.status === "active")
      .map((item) => `${item.strength === "required" ? "Required" : "Preferred"} architecture decision: ${item.statement}`),
    ...pack.protectedAreas.map((item) => `Protected area: ${item}`),
    ...pack.stableConstraints.map((item) => `Stable constraint: ${item}`),
    ...pack.relevantFiles.map((item) => `Relevant file: ${item}`),
    ...pack.blockers.map((item) => `Current blocker: ${item}`),
    ...pack.definitionOfDone.map((item) => `Definition of done: ${item}`),
    ...pack.userIntent.map((item) => `Preserve user intent: ${item}`),
    ...pack.aiDriftPatterns.map((item) => `AI drift to avoid: ${item}`),
    ...pack.knownBadDirections.map((item) => `Avoid this direction: ${item}`),
    pack.preferenceSummary ? `Project preferences: ${pack.preferenceSummary}` : ""
  ], 20)

  return pack
}

export function formatProjectContextPackSummary(pack: ProjectContextPack | null | undefined) {
  if (!pack) return ""

  const sections = [
    pack.contextStatus !== "active"
      ? `Context status\n- ${sentenceCase(pack.contextStatus)}${pack.warnings[0] ? `\n- ${sentenceCase(pack.warnings[0])}` : ""}`
      : "",
    pack.featureArea ? `Current feature area\n- ${sentenceCase(pack.featureArea)}` : "",
    pack.currentPhase ? `Current phase\n- ${sentenceCase(pack.currentPhase)}` : "",
    pack.currentWorkflowState ? `Workflow state\n- ${sentenceCase(pack.currentWorkflowState.replace(/_/g, " "))}` : "",
    pack.architecture?.stack?.length
      ? `Architecture stack\n${pack.architecture.stack.map((item) => `- ${item}`).join("\n")}`
      : "",
    pack.architecture?.dataModel?.length
      ? `Architecture data model\n${pack.architecture.dataModel.map((item) => `- ${sentenceCase(item)}`).join("\n")}`
      : "",
    pack.architecture?.accessRules?.length
      ? `Architecture access rules\n${pack.architecture.accessRules.map((item) => `- ${sentenceCase(item)}`).join("\n")}`
      : "",
    pack.architecture?.conventions?.length
      ? `Architecture conventions\n${pack.architecture.conventions.map((item) => `- ${sentenceCase(item)}`).join("\n")}`
      : "",
    pack.architecture?.decisions?.length
      ? `Architecture decisions\n${pack.architecture.decisions
          .map((item) => `- ${sentenceCase(item.statement)} (${item.strength}; ${item.status})`)
          .join("\n")}`
      : "",
    pack.protectedAreas.length
      ? `Protected areas\n${pack.protectedAreas.map((item) => `- ${sentenceCase(item)}`).join("\n")}`
      : "",
    pack.stableConstraints.length
      ? `Stable constraints\n${pack.stableConstraints.map((item) => `- ${sentenceCase(item)}`).join("\n")}`
      : "",
    pack.relevantFiles.length
      ? `Relevant files\n${pack.relevantFiles.map((item) => `- ${item}`).join("\n")}`
      : "",
    pack.blockers.length
      ? `Current blockers\n${pack.blockers.map((item) => `- ${sentenceCase(item)}`).join("\n")}`
      : "",
    pack.definitionOfDone.length
      ? `Definition of done\n${pack.definitionOfDone.map((item) => `- ${sentenceCase(item)}`).join("\n")}`
      : "",
    pack.userIntent.length
      ? `User intent to preserve\n${pack.userIntent.map((item) => `- ${sentenceCase(item)}`).join("\n")}`
      : "",
    pack.aiDriftPatterns.length
      ? `AI drift patterns to avoid\n${pack.aiDriftPatterns.map((item) => `- ${sentenceCase(item)}`).join("\n")}`
      : "",
    pack.preferenceSummary ? `Project preferences\n- ${pack.preferenceSummary}` : ""
  ].filter(Boolean)

  return sections.join("\n\n")
}

export function formatProjectContextBlock(pack: ProjectContextPack | null | undefined): string {
  try {
    if (!pack) return ""

    const currentTask = pack.featureArea?.trim() ? pack.featureArea : ""
    const currentPhase = pack.currentPhase?.trim() ? pack.currentPhase : ""
    const architectureStack = (pack.architecture?.stack ?? []).filter((item) => item.trim())
    const dataConstraints = (pack.architecture?.dataModel ?? []).filter((item) => item.trim())
    const accessRules = (pack.architecture?.accessRules ?? []).filter((item) => item.trim())
    const activeDecisions = (pack.architecture?.decisions ?? []).filter(
      (item) => item.status === "active" && item.statement.trim()
    )
    const requiredDecisions = activeDecisions
      .filter((item) => item.strength === "required")
      .map((item) => item.statement)
    const explicitMustNotDecisions = activeDecisions
      .filter(
        (item) =>
          item.strength !== "required" &&
          /\b(must not|do not|never)\b/i.test(item.statement)
      )
      .map((item) => item.statement)
    const mandatoryDecisionKeys = new Set(
      [...requiredDecisions, ...explicitMustNotDecisions].map((item) => item.trim().toLowerCase())
    )
    const protectedAreas = pack.protectedAreas.filter((item) => item.trim())
    const stableConstraints = pack.stableConstraints.filter(
      (item) => item.trim() && !mandatoryDecisionKeys.has(item.trim().toLowerCase())
    )
    const preferredPatterns = pack.preferredPatterns.filter(
      (item) => item.trim() && !mandatoryDecisionKeys.has(item.trim().toLowerCase())
    )
    const knownBadDirections = pack.knownBadDirections.filter((item) => item.trim())
    const relevantFiles = pack.relevantFiles.filter((item) => item.trim())

    if (
      !currentTask &&
      !currentPhase &&
      !architectureStack.length &&
      !dataConstraints.length &&
      !accessRules.length &&
      !requiredDecisions.length &&
      !explicitMustNotDecisions.length &&
      !protectedAreas.length &&
      !stableConstraints.length &&
      !preferredPatterns.length &&
      !knownBadDirections.length &&
      !relevantFiles.length
    ) {
      return ""
    }

    const renderBlock = (includeOptional = true) => [
      PROJECT_CONTEXT_BLOCK_START,
      currentTask ? `Current task: ${currentTask}` : "",
      currentPhase ? `Current phase: ${currentPhase}` : "",
      architectureStack.length
        ? ["Architecture stack:", ...architectureStack.map((item) => `- ${item}`)].join("\n")
        : "",
      accessRules.length
        ? ["Access rules:", ...accessRules.map((item) => `- ${item}`)].join("\n")
        : "",
      dataConstraints.length
        ? ["Data constraints:", ...dataConstraints.map((item) => `- ${item}`)].join("\n")
        : "",
      protectedAreas.length
        ? ["Protected — do not break:", ...protectedAreas.map((item) => `- ${item}`)].join("\n")
        : "",
      stableConstraints.length
        ? ["Constraints:", ...stableConstraints.map((item) => `- ${item}`)].join("\n")
        : "",
      requiredDecisions.length
        ? ["Required architecture decisions:", ...requiredDecisions.map((item) => `- ${item}`)].join("\n")
        : "",
      explicitMustNotDecisions.length
        ? ["Explicit must-not decisions:", ...explicitMustNotDecisions.map((item) => `- ${item}`)].join("\n")
        : "",
      includeOptional && preferredPatterns.length
        ? [
            "Preferred approaches (follow unless there is a clear reason not to):",
            ...preferredPatterns.map((item) => `- ${item}`)
          ].join("\n")
        : "",
      includeOptional && knownBadDirections.length
        ? ["Known bad directions:", ...knownBadDirections.map((item) => `- ${item}`)].join("\n")
        : "",
      includeOptional && relevantFiles.length
        ? ["Relevant files and screens:", ...relevantFiles.map((item) => `- ${item}`)].join("\n")
        : "",
      BUILD_SIMPLY_SECTION,
      CONFLICT_RULE_SECTION,
      PROJECT_CONTEXT_BLOCK_END
    ].filter(Boolean).join("\n\n")

    let block = renderBlock()
    const mandatoryLength = renderBlock(false).length
    const effectiveBudget = Math.max(PROJECT_CONTEXT_BLOCK_CHARACTER_BUDGET, mandatoryLength)

    for (const optionalItems of [knownBadDirections, preferredPatterns, relevantFiles]) {
      while (block.length > effectiveBudget && optionalItems.length) {
        optionalItems.pop()
        block = renderBlock()
      }
    }

    return block
  } catch {
    return ""
  }
}

export function appendProjectContextBlock(
  prompt: string,
  pack: ProjectContextPack | null | undefined
): string {
  try {
    if (!prompt.trim() || prompt.includes(PROJECT_CONTEXT_BLOCK_START)) return prompt
    const block = formatProjectContextBlock(pack)
    return block ? `${prompt.trimEnd()}\n\n${block}` : prompt
  } catch {
    return prompt
  }
}
