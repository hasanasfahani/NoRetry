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

export function parseProjectHandoffMarkdown(raw: string) {
  const text = raw.trim()
  if (!text) {
    return { projectContext: "", currentState: "" }
  }

  const overviewMatch = text.match(/#\s*Project Overview\s*([\s\S]*?)(?=\n#\s*Current State\b|$)/i)
  const currentStateMatch = text.match(/#\s*Current State\s*([\s\S]*)$/i)

  const projectContext = (overviewMatch?.[1] ?? "")
    .trim()
    .replace(/^\s*-\s*/gm, "- ")
    .trim()

  const currentState = (currentStateMatch?.[1] ?? "")
    .trim()
    .replace(/^\s*-\s*/gm, "- ")
    .trim()

  if (projectContext || currentState) {
    return { projectContext, currentState }
  }

  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
  return {
    projectContext: paragraphs[0] ?? "",
    currentState: paragraphs.slice(1).join("\n\n")
  }
}
