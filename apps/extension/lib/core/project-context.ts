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
