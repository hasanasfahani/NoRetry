import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

function resolveInputPath() {
  const raw = process.env.NEXT_MOVE_CANDIDATES_INPUT
  if (!raw?.trim()) return path.resolve(process.cwd(), ".tmp/next-move-eval-candidates.json")
  return path.resolve(process.cwd(), raw.trim())
}

function resolveOutputPath() {
  const raw = process.env.NEXT_MOVE_CANDIDATES_REPORT_PATH
  if (!raw?.trim()) return path.resolve(process.cwd(), ".tmp/next-move-eval-candidates.md")
  return path.resolve(process.cwd(), raw.trim())
}

async function readCandidates(inputPath) {
  try {
    const parsed = JSON.parse(await readFile(inputPath, "utf8"))
    if (Array.isArray(parsed)) return parsed
    if (Array.isArray(parsed.candidates)) return parsed.candidates
    if (Array.isArray(parsed.nextMoveEvalCandidates)) return parsed.nextMoveEvalCandidates
    return []
  } catch (error) {
    if (error?.code === "ENOENT") return []
    throw error
  }
}

function truncate(value, max = 900) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim()
  if (normalized.length <= max) return normalized || "Not captured"
  return `${normalized.slice(0, max - 3)}...`
}

function formatDecision(decision) {
  if (!decision) return "none"
  return `${decision.status}/${decision.recommendationKind}`
}

function renderCandidate(candidate, index) {
  return [
    `## ${index + 1}. ${candidate.candidateId}`,
    "",
    `- Status: ${candidate.status}`,
    `- Reasons: ${(candidate.reasons ?? []).join(", ") || "none"}`,
    `- Task type: ${candidate.taskType ?? "unknown"}`,
    `- Review status: ${candidate.analysisStatus ?? "unknown"}`,
    `- Final decision: ${formatDecision(candidate.finalDecision)}`,
    `- Signal source/agreement: ${candidate.signalSource ?? "none"}/${candidate.signalAgreement ?? "none"}`,
    `- Suggested expected decision: ${formatDecision(candidate.suggestedExpectedDecision)}`,
    "",
    "**User Request**",
    "",
    truncate(candidate.promptText),
    "",
    "**Assistant Answer**",
    "",
    truncate(candidate.responseText),
    "",
    "**PM Review Choices**",
    "",
    "- [ ] Accept into eval dataset",
    "- [ ] Reject",
    "- [ ] Needs expected decision/rubric edit",
    "- [ ] Product-rule change needed",
    "",
    `Reviewer note: ${candidate.reviewerNote ?? ""}`,
    ""
  ].join("\n")
}

function renderReport(candidates) {
  const pending = candidates.filter((candidate) => candidate.status === "pending")
  const counts = candidates.reduce((acc, candidate) => {
    acc[candidate.status] = (acc[candidate.status] ?? 0) + 1
    return acc
  }, {})

  return [
    "# Next-Move Eval Candidate Review",
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Total candidates: ${candidates.length}`,
    `Pending candidates: ${pending.length}`,
    "",
    "## Status Counts",
    "",
    ...Object.entries(counts).map(([status, count]) => `- ${status}: ${count}`),
    "",
    "## Pending Review",
    "",
    ...(pending.length ? pending.map(renderCandidate) : ["No pending candidates."]),
    ""
  ].join("\n")
}

const inputPath = resolveInputPath()
const outputPath = resolveOutputPath()
const candidates = await readCandidates(inputPath)
const report = renderReport(candidates)

await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, report)

console.log(`Read ${candidates.length} candidates from ${inputPath}`)
console.log(`Wrote report to ${outputPath}`)
