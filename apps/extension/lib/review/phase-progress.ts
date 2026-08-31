import type { ImportedProjectContextRecord } from "../core/project-context"
import type { StructuredProjectMemory } from "../session/project-memory"

export type ReviewPhasePlan = {
  id: string
  index: number
  title: string
  goal: string
  deliverables: string[]
  acceptanceCriteria: string[]
}

export type ReviewPhaseProgress = {
  hasPhasePlan: boolean
  activePhaseIndex: number | null
  activePhaseLabel: string | null
  nextPhaseIndex: number | null
  nextPhaseLabel: string | null
  isFinalPhase: boolean
  phases: ReviewPhasePlan[]
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function extractBulletItems(text: string) {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean)
}

function titleCaseWords(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function buildPhaseTitleFromSummary(index: number, description: string) {
  const cleaned = normalize(
    description
      .replace(/^(?:builds?|adds?|polishes?|handles?|covers?|focuses on|introduces?)\s+/i, "")
      .replace(/[.]+$/, "")
  )
  return cleaned ? `Phase ${index + 1} — ${titleCaseWords(cleaned)}` : `Phase ${index + 1}`
}

function parsePhaseSummarySentences(text: string) {
  const matches = Array.from(
    text.matchAll(/Phase\s+(\d+)\s+(builds?|adds?|polishes?|handles?|covers?|focuses on|introduces?)\s+([^.\n]+)[.\n]?/gi)
  )

  return matches
    .map((match): ReviewPhasePlan | null => {
      const phaseNumber = Number(match[1])
      const verb = normalize(match[2] ?? "")
      const description = normalize(match[3] ?? "")
      if (!Number.isFinite(phaseNumber) || phaseNumber < 1 || !description) return null

      const goal =
        verb === "adds"
          ? `Add ${description}.`
          : verb === "polishes"
            ? `Polish ${description}.`
            : verb === "handles"
              ? `Handle ${description}.`
              : verb === "covers"
                ? `Cover ${description}.`
                : verb === "focuses on"
                  ? `Focus on ${description}.`
                  : verb === "introduces"
                    ? `Introduce ${description}.`
                    : `Build ${description}.`

      return {
        id: `phase_${phaseNumber}`,
        index: phaseNumber - 1,
        title: buildPhaseTitleFromSummary(phaseNumber - 1, description),
        goal,
        deliverables: [],
        acceptanceCriteria: []
      }
    })
    .filter((item): item is ReviewPhasePlan => Boolean(item))
    .sort((left, right) => left.index - right.index)
}

function parsePhaseBlocks(text: string) {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(Phase\s+\d+\s*(?:[—:-])\s*[^*\n]+)\*\*/gi, "$1")
    .replace(/(Phase\s+\d+\s*(?:[—:-])\s*[^\n]+)(?=Goal:)/gi, "$1\n")
    .replace(/(?<!\n)(Goal:)/gi, "\n$1")
    .replace(/(?<!\n)(Deliverables:)/gi, "\n$1")
    .replace(/(?<!\n)(Acceptance Criteria:)/gi, "\n$1")
    .replace(/Deliverables:\s*-\s*/gi, "Deliverables:\n- ")
    .replace(/Acceptance Criteria:\s*-\s*/gi, "Acceptance Criteria:\n- ")
    .replace(/\.\s*-\s*/g, ".\n- ")
    .replace(/(?<!\n)(Done\s+[—-])/gi, "\n$1")
    .replace(/(?<!\n)(Waiting for your approval)/gi, "\n$1")
    .replace(/-\s+(?=[A-Z][^:\n]{2,}:\s)/g, "\n- ")
  const phaseBlocks = Array.from(
    normalized.matchAll(/(Phase\s+\d+\s*(?:[—:-])\s*[\s\S]*?)(?=Phase\s+\d+\s*(?:[—:-])\s*|$)/gi)
  ).map((match) => match[1]?.trim() ?? "")

  return phaseBlocks
    .map((block, index): ReviewPhasePlan | null => {
      const title = normalize(block.split("\n")[0] ?? "")
      if (!/^phase\s+\d+\s*(?:[—:-])\s*/i.test(title)) return null

      const goalMatch = block.match(/Goal:\s*([\s\S]*?)(?=\nDeliverables:|\nAcceptance Criteria:|$)/i)
      const deliverablesMatch = block.match(/Deliverables:\s*([\s\S]*?)(?=\nAcceptance Criteria:|$)/i)
      const acceptanceMatch = block.match(/Acceptance Criteria:\s*([\s\S]*?)(?=\nDone\s+[—-]|\nWaiting for your approval|$)/i)
      const bodyAfterTitle = block.split("\n").slice(1).join("\n").trim()
      const fallbackGoal = bodyAfterTitle
        .split(/\n+/)
        .map((line) => normalize(line.replace(/^\s*[-*]\s*/, "")))
        .find((line) => line && !/^(?:goal|deliverables|acceptance criteria):/i.test(line))

      return {
        id: `phase_${index + 1}`,
        index,
        title,
        goal: normalize(goalMatch?.[1] ?? fallbackGoal ?? ""),
        deliverables: extractBulletItems(deliverablesMatch?.[1] ?? ""),
        acceptanceCriteria: extractBulletItems(acceptanceMatch?.[1] ?? "")
      }
    })
    .filter((item): item is ReviewPhasePlan => Boolean(item))
}

function parseImplementationPhasesSection(rawMarkdown: string) {
  const match = rawMarkdown.match(/(?:^|\n)#+\s+Implementation Phases\s*\n([\s\S]*?)(?=\n#+\s+|$)/i)
  const sectionBody = match?.[1]?.trim() ?? ""
  const fromSection = sectionBody ? parsePhaseBlocks(sectionBody) : []
  if (fromSection.length) return fromSection
  const fromRawMarkdown = parsePhaseBlocks(rawMarkdown)
  if (fromRawMarkdown.length) return fromRawMarkdown
  return sectionBody ? parsePhaseSummarySentences(sectionBody) : parsePhaseSummarySentences(rawMarkdown)
}

function firstValidPhaseIndexFromPatterns(text: string, phaseCount: number, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    const phaseNumber = Number(match?.[1])
    if (Number.isFinite(phaseNumber) && phaseNumber >= 1 && phaseNumber <= phaseCount) {
      return phaseNumber - 1
    }
  }
  return null
}

function inferExplicitActivePhaseIndex(text: string, phaseCount: number) {
  return firstValidPhaseIndexFromPatterns(text, phaseCount, [
    /\b(?:implement|build|complete|finish|work on|ship|deliver)\s+phase\s+(\d+)\b/i,
    /\bphase\s+(\d+)\s+(?:only|goal|scope|status|is complete|completed|finished|done|was completed)\b/i,
    /\bcurrent\s+phase\s*(?:is|:)?\s*phase\s+(\d+)\b/i,
    /\bphase\s+(\d+)\s+(?:against|before|and then|then wait|then stop)\b/i
  ])
}

function inferCompletedPhaseIndex(text: string, phaseCount: number) {
  return firstValidPhaseIndexFromPatterns(text, phaseCount, [
    /\bphase\s+(\d+)\s+(?:is\s+)?(?:complete|completed|finished|done|validated|ready)\b/i,
    /\b(?:completed|finished|validated|built|implemented)\s+phase\s+(\d+)\b/i,
    /\bphase\s+(\d+)\s+status\s*:\s*(?:complete|completed|done|validated)\b/i
  ])
}

function inferPhasePlanFromPrompt(promptText: string) {
  const normalized = normalize(promptText).toLowerCase()
  const bookingUiPhase =
    /\bbooking app\b/.test(normalized) &&
    /\bphase\s+1\b/.test(normalized) &&
    /\b(form ui only|booking form ui only|ui only|visual form)\b/.test(normalized)

  if (!bookingUiPhase) return []

  return [
    {
      id: "phase_1",
      index: 0,
      title: "Phase 1 — Booking Form UI",
      goal: "Create the booking form UI only.",
      deliverables: ["Visible booking form fields", "Basic responsive layout"],
      acceptanceCriteria: ["No backend, saving, payment, or data handling is required in this phase"]
    },
    {
      id: "phase_2",
      index: 1,
      title: "Phase 2 — Form Validation And Confirmation State",
      goal: "Add required-field validation and show a booking confirmation summary after submission.",
      deliverables: ["Required field errors", "Prevent empty submission", "Booking confirmation summary"],
      acceptanceCriteria: ["Do not connect a backend or database yet"]
    },
    {
      id: "phase_3",
      index: 2,
      title: "Phase 3 — Local Storage",
      goal: "Save recent booking requests in the browser.",
      deliverables: ["Local booking persistence", "Recent bookings list"],
      acceptanceCriteria: ["Bookings remain visible after a page refresh"]
    },
    {
      id: "phase_4",
      index: 3,
      title: "Phase 4 — Admin View",
      goal: "Create a simple admin dashboard to review submitted bookings.",
      deliverables: ["Admin bookings list"],
      acceptanceCriteria: ["Admin can inspect saved booking requests"]
    },
    {
      id: "phase_5",
      index: 4,
      title: "Phase 5 — Backend And Database",
      goal: "Connect the booking flow to a backend and database for real submissions.",
      deliverables: ["API endpoint", "Database persistence"],
      acceptanceCriteria: ["Real bookings are stored outside the browser"]
    }
  ] satisfies ReviewPhasePlan[]
}

function inferActivePhaseIndex(input: {
  promptText: string
  responseText: string
  importedContext?: ImportedProjectContextRecord | null
  projectMemory?: StructuredProjectMemory | null
  phaseCount: number
}) {
  const promptText = normalize(input.promptText)
  const currentStateText = normalize(input.importedContext?.currentState ?? "")
  const responseText = normalize(input.responseText)
  const primarySearchText = [promptText, currentStateText].filter(Boolean).join("\n")
  const fallbackSearchText = [promptText, currentStateText, responseText].filter(Boolean).join("\n")

  const explicitActivePhaseIndex =
    inferExplicitActivePhaseIndex(primarySearchText, input.phaseCount) ??
    inferExplicitActivePhaseIndex(fallbackSearchText, input.phaseCount)
  if (explicitActivePhaseIndex !== null) return explicitActivePhaseIndex

  const completedPhaseIndex = inferCompletedPhaseIndex(responseText, input.phaseCount)
  if (completedPhaseIndex !== null) return completedPhaseIndex

  if (input.projectMemory?.currentPhase === "planning") return 0
  if (input.projectMemory?.currentPhase === "implementation") return 0
  if (input.projectMemory?.currentPhase === "validation") {
    return Math.max(0, input.phaseCount - 1)
  }

  return input.phaseCount > 0 ? 0 : null
}

export function deriveReviewPhaseProgress(input: {
  promptText: string
  responseText: string
  importedContext?: ImportedProjectContextRecord | null
  projectMemory?: StructuredProjectMemory | null
}): ReviewPhaseProgress | null {
  const rawMarkdown = input.importedContext?.rawMarkdown ?? ""
  const phases = rawMarkdown.trim() ? parseImplementationPhasesSection(rawMarkdown) : []
  const promptPhases = phases.length ? [] : parseImplementationPhasesSection(input.promptText)
  const responseDetailedPhases = parsePhaseBlocks(input.responseText)
  const fallbackPhases = phases.length
    ? phases
    : promptPhases.length
      ? promptPhases
      : responseDetailedPhases.length
        ? responseDetailedPhases
        : parsePhaseSummarySentences(input.responseText)
  const inferredPhases = fallbackPhases.length ? [] : inferPhasePlanFromPrompt(input.promptText)
  const effectivePhases = fallbackPhases.length ? fallbackPhases : inferredPhases
  if (!effectivePhases.length) return null

  const activePhaseIndex = inferActivePhaseIndex({
    promptText: input.promptText,
    responseText: input.responseText,
    importedContext: input.importedContext ?? null,
    projectMemory: input.projectMemory ?? null,
    phaseCount: effectivePhases.length
  })
  const activePhase = activePhaseIndex !== null ? effectivePhases[activePhaseIndex] ?? null : null
  const nextPhase = activePhaseIndex !== null ? effectivePhases[activePhaseIndex + 1] ?? null : null

  return {
    hasPhasePlan: effectivePhases.length > 0,
    activePhaseIndex,
    activePhaseLabel: activePhase?.title ?? null,
    nextPhaseIndex: nextPhase?.index ?? null,
    nextPhaseLabel: nextPhase?.title ?? null,
    isFinalPhase: activePhaseIndex !== null ? activePhaseIndex >= effectivePhases.length - 1 : false,
    phases: effectivePhases
  }
}

export function buildNextPhasePrompt(phaseProgress: ReviewPhaseProgress) {
  const nextPhase =
    phaseProgress.nextPhaseIndex !== null ? phaseProgress.phases[phaseProgress.nextPhaseIndex] ?? null : null
  if (!nextPhase) return null

  return [
    `Implement ${nextPhase.title} only.`,
    nextPhase.goal ? `Goal: ${nextPhase.goal}` : "",
    nextPhase.deliverables.length
      ? `Deliverables:\n${nextPhase.deliverables.map((item) => `- ${item}`).join("\n")}`
      : "",
    nextPhase.acceptanceCriteria.length
      ? `Acceptance criteria:\n${nextPhase.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}`
      : "",
    "Do not begin later phases yet.",
    "Preserve the accepted work from the previous phases."
  ]
    .filter(Boolean)
    .join("\n\n")
}
