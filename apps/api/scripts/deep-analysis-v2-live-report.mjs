import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

function resolveInputPath() {
  const raw = process.env.DEEP_ANALYSIS_V2_LIVE_CANDIDATES_INPUT
  if (!raw?.trim()) return path.resolve(process.cwd(), ".tmp/admin-next-move-eval-candidates.json")
  return path.resolve(process.cwd(), raw.trim())
}

function resolveOutputPath() {
  const raw = process.env.DEEP_ANALYSIS_V2_LIVE_REPORT_PATH
  if (!raw?.trim()) return path.resolve(process.cwd(), ".tmp/deep-analysis-v2-live-report.md")
  return path.resolve(process.cwd(), raw.trim())
}

async function readCandidates(inputPath) {
  try {
    const parsed = JSON.parse(await readFile(inputPath, "utf8"))
    if (Array.isArray(parsed)) return parsed
    if (Array.isArray(parsed?.candidates)) return parsed.candidates
    if (Array.isArray(parsed?.nextMoveEvalCandidates)) return parsed.nextMoveEvalCandidates
    return []
  } catch (error) {
    if (error?.code === "ENOENT") return []
    throw error
  }
}

function countBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item) || "unknown"
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
}

function percentile(values, target) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((target / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)]
}

function average(values) {
  if (!values.length) return null
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function formatMs(value) {
  return typeof value === "number" ? `${value}ms` : "n/a"
}

function formatCountMap(counts) {
  const entries = Object.entries(counts)
  if (!entries.length) return ["- none"]
  return entries.sort(([left], [right]) => left.localeCompare(right)).map(([key, count]) => `- ${key}: ${count}`)
}

function truncate(value, max = 360) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim()
  if (normalized.length <= max) return normalized || "Not captured"
  return `${normalized.slice(0, max - 3)}...`
}

const completionCta = "After you finish, confirm which requirements were completed and suggest the next step."

function promptIncludesRequirement(prompt, requirement) {
  const normalizedPrompt = String(prompt ?? "").toLowerCase()
  const importantWords = String(requirement ?? "")
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]/g, ""))
    .filter((word) => word.length >= 4)
  if (!importantWords.length) return true
  const matches = importantWords.filter((word) => normalizedPrompt.includes(word)).length
  return matches >= Math.min(2, importantWords.length)
}

function generatedPromptIssues(decision) {
  const prompt = decision.generatedPrompt ?? ""
  const issues = []

  if (!prompt.trim()) {
    issues.push("missing_generated_prompt")
    return issues
  }
  const asksForNextStep = /suggest (?:what )?(?:the )?next step|suggested next step|suggest the safest next step/i.test(prompt)
  if (!prompt.trim().endsWith(completionCta) && !asksForNextStep) {
    issues.push("missing_completion_cta")
  }
  if (!decision.promptIntent) {
    return issues
  }
  if (decision.promptIntent === "implement_next_step") {
    const requirements = decision.nextStepRequirements ?? []
    if (requirements.length < 2) {
      issues.push("too_few_next_step_requirements")
    }
    const missing = requirements.filter((item) => !promptIncludesRequirement(prompt, item))
    if (missing.length) {
      issues.push("prompt_missing_next_step_requirements")
    }
    if ((decision.blockedScope ?? []).length && !/\bdo not\b/i.test(prompt)) {
      issues.push("missing_blocked_scope_line")
    }
  }
  if (decision.promptIntent === "ask_for_next_step" && !/suggest the safest next step/i.test(prompt)) {
    issues.push("ask_next_step_prompt_not_explicit")
  }
  if (decision.promptIntent === "review_before_advancing" && !/\b(proof|evidence|test|screenshot|url|code)\b/i.test(prompt)) {
    issues.push("review_prompt_missing_evidence_request")
  }

  return issues
}

function analyzeCandidates(candidates) {
  const v2Candidates = candidates.filter((candidate) => candidate.deepAnalysisV2Decision)
  const decisions = v2Candidates.map((candidate) => candidate.deepAnalysisV2Decision)
  const latencies = decisions
    .map((decision) => decision.latencyMs)
    .filter((value) => typeof value === "number" && Number.isFinite(value))

  const fallbackCount = decisions.filter((decision) => decision.provider === "fallback").length
  const lowConfidenceCount = decisions.filter((decision) => decision.confidence === "low").length
  const riskyOrFailCount = decisions.filter((decision) => decision.overallStatus === "risky" || decision.overallStatus === "fail").length
  const pendingCount = v2Candidates.filter((candidate) => candidate.status === "pending").length
  const p90 = percentile(latencies, 90)
  const promptIssuesByCandidate = v2Candidates
    .map((candidate) => ({
      candidate,
      issues: generatedPromptIssues(candidate.deepAnalysisV2Decision)
    }))
    .filter((item) => item.issues.length)
  const promptIssueCounts = countBy(
    promptIssuesByCandidate.flatMap((item) => item.issues),
    (issue) => issue
  )

  const blockers = []
  if (v2Candidates.length < 10) blockers.push("Collect at least 10 real manual samples before judging launch readiness.")
  if (pendingCount > 0) blockers.push("Review all pending v2 candidates in the admin portal.")
  if (fallbackCount > Math.max(1, Math.floor(v2Candidates.length * 0.2))) {
    blockers.push("Fallback provider rate is high; inspect provider failures before launch.")
  }
  if (lowConfidenceCount > Math.max(1, Math.floor(v2Candidates.length * 0.2))) {
    blockers.push("Low-confidence rate is high; add cases or improve the prompt before launch.")
  }
  if (riskyOrFailCount > 0) blockers.push("Risky/fail cases exist; review whether the user-facing recommendation was correct.")
  if (typeof p90 === "number" && p90 > 15000) {
    blockers.push("p90 latency is above 15s; investigate provider latency or prewarm behavior.")
  }
  if (promptIssuesByCandidate.length) {
    blockers.push("Generated-prompt quality issues exist; review next-step requirements, blocked scope, and CTA coverage.")
  }

  return {
    v2Candidates,
    decisions,
    latencies,
    fallbackCount,
    lowConfidenceCount,
    riskyOrFailCount,
    pendingCount,
    p50: percentile(latencies, 50),
    p90,
    averageLatency: average(latencies),
    providerCounts: countBy(decisions, (decision) => decision.provider),
    statusCounts: countBy(decisions, (decision) => decision.overallStatus),
    confidenceCounts: countBy(decisions, (decision) => decision.confidence),
    promptIntentCounts: countBy(decisions, (decision) => decision.promptIntent),
    nextStepSourceCounts: countBy(decisions, (decision) => decision.nextStepSource),
    traceCoverageCounts: {
      with_prompt_intent: decisions.filter((decision) => decision.promptIntent).length,
      missing_prompt_intent: decisions.filter((decision) => !decision.promptIntent).length,
      with_next_step_source: decisions.filter((decision) => decision.nextStepSource).length,
      missing_next_step_source: decisions.filter((decision) => !decision.nextStepSource).length
    },
    rolloutCounts: countBy(decisions, (decision) => decision.rolloutMode),
    appliedCounts: countBy(decisions, (decision) => (decision.applied === false ? "observed_only" : "applied")),
    promptIssuesByCandidate,
    promptIssueCounts,
    blockers,
    recommendation: blockers.length ? "Keep v2 in shadow/on-with-review until blockers are resolved." : "v2 is ready to stay on for the tested surfaces."
  }
}

function renderRecentCases(v2Candidates) {
  const recent = [...v2Candidates]
    .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")))
    .slice(0, 10)

  if (!recent.length) return ["No v2 candidates captured yet."]

  return recent.flatMap((candidate, index) => {
    const decision = candidate.deepAnalysisV2Decision
    return [
      `### ${index + 1}. ${candidate.candidateId}`,
      "",
      `- Status: ${candidate.status ?? "unknown"}`,
      `- Project: ${candidate.projectLabel ?? "unknown"}`,
      `- v2: ${decision.overallStatus}/${decision.confidence}`,
      `- Provider: ${decision.provider}${decision.model ? ` · ${decision.model}` : ""}`,
      `- Latency: ${formatMs(decision.latencyMs)}`,
      `- Rollout: ${decision.rolloutMode ?? "unknown"} · ${decision.applied === false ? "observed only" : "applied"}`,
      `- Prompt intent: ${decision.promptIntent ?? "unknown"}`,
      `- Next step source: ${decision.nextStepSource ?? "unknown"}`,
      `- Next-step requirements: ${(decision.nextStepRequirements ?? []).length ? decision.nextStepRequirements.join("; ") : "none"}`,
      `- Blocked scope: ${(decision.blockedScope ?? []).length ? decision.blockedScope.join("; ") : "none"}`,
      `- Assistant suggested: ${decision.assistantSuggestedNextMove ?? "none"}`,
      "",
      `Prompt: ${truncate(candidate.promptText)}`,
      "",
      `Answer: ${truncate(candidate.responseText)}`,
      ""
    ]
  })
}

function renderReport(inputPath, candidates, analysis) {
  return [
    "# Deep Analysis v2 Live Validation Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Input: ${inputPath}`,
    "",
    "## Summary",
    "",
    `- Total admin candidates: ${candidates.length}`,
    `- Candidates with v2 snapshot: ${analysis.v2Candidates.length}`,
    `- Pending v2 candidates: ${analysis.pendingCount}`,
    `- Fallback provider count: ${analysis.fallbackCount}`,
    `- Low-confidence count: ${analysis.lowConfidenceCount}`,
    `- Risky/fail count: ${analysis.riskyOrFailCount}`,
    "",
    "## Latency",
    "",
    `- Samples: ${analysis.latencies.length}`,
    `- Average: ${formatMs(analysis.averageLatency)}`,
    `- p50: ${formatMs(analysis.p50)}`,
    `- p90: ${formatMs(analysis.p90)}`,
    "",
    "## Provider Counts",
    "",
    ...formatCountMap(analysis.providerCounts),
    "",
    "## Status Counts",
    "",
    ...formatCountMap(analysis.statusCounts),
    "",
    "## Confidence Counts",
    "",
    ...formatCountMap(analysis.confidenceCounts),
    "",
    "## Prompt Intent Counts",
    "",
    ...formatCountMap(analysis.promptIntentCounts),
    "",
    "## Next Step Source Counts",
    "",
    ...formatCountMap(analysis.nextStepSourceCounts),
    "",
    "## Trace Coverage",
    "",
    ...formatCountMap(analysis.traceCoverageCounts),
    "",
    "## Generated Prompt Quality Issues",
    "",
    ...formatCountMap(analysis.promptIssueCounts),
    "",
    "## Rollout Counts",
    "",
    ...formatCountMap(analysis.rolloutCounts),
    "",
    "## Applied Counts",
    "",
    ...formatCountMap(analysis.appliedCounts),
    "",
    "## Launch Recommendation",
    "",
    analysis.recommendation,
    "",
    "## Blockers",
    "",
    ...(analysis.blockers.length ? analysis.blockers.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## Recent v2 Cases",
    "",
    ...renderRecentCases(analysis.v2Candidates),
    ""
  ].join("\n")
}

const inputPath = resolveInputPath()
const outputPath = resolveOutputPath()
const candidates = await readCandidates(inputPath)
const analysis = analyzeCandidates(candidates)
const report = renderReport(inputPath, candidates, analysis)

await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, report)

console.log(`Read ${candidates.length} candidates from ${inputPath}`)
console.log(`Found ${analysis.v2Candidates.length} candidates with Deep Analysis v2 snapshots`)
console.log(`Latency p50=${formatMs(analysis.p50)} p90=${formatMs(analysis.p90)}`)
console.log(`Prompt issue candidates=${analysis.promptIssuesByCandidate.length}`)
console.log(`Recommendation: ${analysis.recommendation}`)
console.log(`Wrote report to ${outputPath}`)

if (process.env.DEEP_ANALYSIS_V2_LIVE_REQUIRE_READY === "1" && analysis.blockers.length) {
  process.exitCode = 1
}
