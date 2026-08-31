export const REPLIT_CONTEXT_REQUEST_PROMPT = `Summarize this project and the current debugging situation for another AI tool that needs context fast.

Return only markdown in this exact structure:

# Project Overview
- What this project/app does
- Main architecture or important components
- Important constraints or requirements
- Important files or modules
- Definition of done for the current work

# Current State
- What I am working on right now
- Current bug/problem
- What has already been tried
- Latest findings
- Current blockers
- Best next likely step

Keep it concise, specific, and based only on what is already known in this project/thread. Do not invent details.`

export type ImportedProjectContextSummary = {
  presentSections: string[]
  constraints: string[]
  relevantFiles: string[]
  blockers: string[]
  repeatedBugs: string[]
  fixAttempts: string[]
  aiDriftPatterns: string[]
  userIntent: string[]
  definitionOfDone: string[]
}

export type ParsedProjectHandoff = {
  rawMarkdown: string
  projectContext: string
  currentState: string
  summary: ImportedProjectContextSummary
}

export type ImportedProjectContextRecord = ParsedProjectHandoff & {
  parsedAt: string
}

function slugifyProjectLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project"
}

export function buildReplitDeepContextRequestPrompt(projectLabel: string) {
  const fileName = `${slugifyProjectLabel(projectLabel)}-handoff.md`

  return `Create a richer markdown handoff for another AI tool that needs to understand this project deeply before reviewing the latest debugging work.

Prepare it as a standalone, downloadable markdown file that I can download from Replit and upload to another tool. The filename should be exactly \`${fileName}\`.

Return only markdown in this exact structure:

# Project Overview
- What this project/app does
- User-facing goal
- Current phase or milestone

# Architecture
- Main system components
- Data flow or important runtime behavior
- Relevant integrations, APIs, or services

# Constraints
- Product constraints
- Technical constraints
- Non-negotiable requirements

# Relevant Files
- Most relevant files or modules for the current work
- Why each one matters

# Current State
- What I am working on right now
- Current bug/problem
- What has already been tried
- Latest findings
- Current blockers
- Best next likely step

# Repeated Bugs
- Bugs or failures that have reappeared across multiple attempts
- Which ones are still unresolved
- Whether any bug looked fixed but later came back

# Fix Attempts
- The main changes that were already made to fix the issue
- Why each change was tried
- What happened after each attempt
- Which attempts partially helped vs clearly failed

# AI Drift Patterns
- Where the AI assistant kept misunderstanding the request
- Which requirements it kept ignoring, weakening, or changing
- Any repeated pattern of fixing symptoms instead of the root cause
- Any repeated loop or unhelpful direction the AI kept taking

# User Intent To Preserve
- What the user explicitly wants
- What must not be changed
- What the assistant should stay aligned with while helping

# Definition Of Done
- What must be true for this current work to be considered complete

Keep it specific, concise, and grounded in what is already known from this project and thread.
Pay special attention to unresolved repeated bugs, prior fix attempts, and where the AI assistant has been drifting away from the user’s real requirements.
Do not invent details.

Do not add any explanation before or after the markdown. Only return the final upload-ready markdown handoff.`
}

export function buildProjectHandoffMarkdown(projectContext: string, currentState: string) {
  return [
    "# Project Overview",
    projectContext.trim() || "-",
    "",
    "# Current State",
    currentState.trim() || "-"
  ].join("\n")
}

function normalizeSectionTitle(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
}

function extractBulletLines(text: string) {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s*/, "").trim())
    .filter(Boolean)
}

function summarizeLines(text: string, matcher: RegExp, limit = 4) {
  const seen = new Set<string>()
  const items: string[] = []

  for (const line of extractBulletLines(text)) {
    if (!matcher.test(line)) continue
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    items.push(line)
    if (items.length >= limit) break
  }

  return items
}

function extractSectionMap(text: string) {
  const matches = [...text.matchAll(/^#\s+(.+?)\s*$/gm)]
  if (!matches.length) return new Map<string, { title: string; content: string }>()

  const sections = new Map<string, { title: string; content: string }>()

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const title = match[1]?.trim() ?? ""
    const start = match.index! + match[0].length
    const end = index + 1 < matches.length ? matches[index + 1].index! : text.length
    const content = text.slice(start, end).trim()
    if (!title || !content) continue
    sections.set(normalizeSectionTitle(title), { title, content })
  }

  return sections
}

function buildCombinedMarkdownSections(
  sections: Map<string, { title: string; content: string }>,
  orderedTitles: string[]
) {
  const present = orderedTitles
    .map((title) => sections.get(normalizeSectionTitle(title)))
    .filter((section): section is { title: string; content: string } => Boolean(section))

  if (!present.length) return ""
  if (present.length === 1) return present[0].content.trim()

  return present.map((section) => `## ${section.title}\n${section.content.trim()}`).join("\n\n").trim()
}

function buildImportedProjectContextSummary(
  sections: Map<string, { title: string; content: string }>,
  projectContext: string,
  currentState: string
): ImportedProjectContextSummary {
  const constraints = summarizeLines(
    sections.get("constraints")?.content ?? projectContext,
    /\bconstraint|requirement|non-negotiable|must|should stay|keep|preserve|avoid\b/i,
    5
  )
  const relevantFiles = summarizeLines(
    sections.get("relevant files")?.content ?? projectContext,
    /\.[a-z0-9]+$|\/|component|module|file|screen|page|route|service|hook|store/i,
    6
  )
  const blockers = summarizeLines(
    sections.get("current state")?.content ?? currentState,
    /\bblocker|blocked|waiting|stuck|need\b/i,
    4
  )
  const repeatedBugs = extractBulletLines(sections.get("repeated bugs")?.content ?? "").slice(0, 5)
  const fixAttempts = extractBulletLines(sections.get("fix attempts")?.content ?? "").slice(0, 5)
  const aiDriftPatterns = extractBulletLines(sections.get("ai drift patterns")?.content ?? "").slice(0, 5)
  const userIntent = extractBulletLines(sections.get("user intent to preserve")?.content ?? "").slice(0, 5)
  const definitionOfDone = extractBulletLines(
    sections.get("definition of done")?.content ?? sections.get("project overview")?.content ?? ""
  ).slice(0, 4)

  return {
    presentSections: [...sections.values()].map((section) => section.title),
    constraints,
    relevantFiles,
    blockers,
    repeatedBugs,
    fixAttempts,
    aiDriftPatterns,
    userIntent,
    definitionOfDone
  }
}

export function parseProjectHandoffMarkdown(raw: string): ParsedProjectHandoff {
  const text = raw.trim()
  if (!text) {
    return {
      rawMarkdown: "",
      projectContext: "",
      currentState: "",
      summary: {
        presentSections: [],
        constraints: [],
        relevantFiles: [],
        blockers: [],
        repeatedBugs: [],
        fixAttempts: [],
        aiDriftPatterns: [],
        userIntent: [],
        definitionOfDone: []
      }
    }
  }

  const sections = extractSectionMap(text)
  const projectContext = buildCombinedMarkdownSections(sections, [
    "Project Overview",
    "Architecture",
    "Constraints",
    "Relevant Files",
    "User Intent To Preserve",
    "Definition Of Done"
  ])
  const currentState = buildCombinedMarkdownSections(sections, [
    "Current State",
    "Repeated Bugs",
    "Fix Attempts",
    "AI Drift Patterns"
  ])

  if (projectContext || currentState || sections.size > 0) {
    return {
      rawMarkdown: text,
      projectContext,
      currentState,
      summary: buildImportedProjectContextSummary(sections, projectContext, currentState)
    }
  }

  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
  return {
    rawMarkdown: text,
    projectContext: paragraphs[0] ?? "",
    currentState: paragraphs.slice(1).join("\n\n"),
    summary: {
      presentSections: ["Freeform"],
      constraints: summarizeLines(text, /\bconstraint|requirement|must|keep\b/i, 5),
      relevantFiles: summarizeLines(text, /\.[a-z0-9]+$|\/|component|module|file|screen|page|route|service|hook|store/i, 6),
      blockers: summarizeLines(text, /\bblocker|blocked|waiting|stuck|need\b/i, 4),
      repeatedBugs: [],
      fixAttempts: [],
      aiDriftPatterns: [],
      userIntent: [],
      definitionOfDone: summarizeLines(text, /\bdone|complete|success|working\b/i, 4)
    }
  }
}

export function buildImportedProjectContextRecord(raw: string, parsedAt = new Date().toISOString()): ImportedProjectContextRecord {
  const parsed = parseProjectHandoffMarkdown(raw)
  return {
    ...parsed,
    parsedAt
  }
}
