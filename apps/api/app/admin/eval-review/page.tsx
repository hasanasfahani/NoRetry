"use client"

import { useEffect, useMemo, useState, type ChangeEvent } from "react"
import styles from "./page.module.css"

type CandidateStatus = "pending" | "accepted" | "rejected" | "needs_edit" | "product_rule_issue"
type SignalSource = "ai" | "local_heuristic" | "none"
type SignalAgreement = "agree" | "disagree" | "ai_only" | "local_only" | "none"

type SignalSnapshot = {
  source?: SignalSource
  kind?: string
  nextMoveType?: string
  currentStepClaim?: string
  confidenceLevel?: string
  targetLabel?: string | null
  targetPhaseNumber?: number | null
}

type DecisionSnapshot = {
  status: string
  recommendationKind: string
  title: string
  primaryCtaLabel: string
}

type SimpleNextPromptDecisionSnapshot = {
  version: string
  status: "needs_confirmation" | "ready_for_next_prompt"
  rolloutMode?: "off" | "shadow" | "on"
  applied?: boolean
  requirementStatus: "pass" | "needs_confirmation"
  confirmedCount: number
  missingCount: number
  missingRequirements: string[]
  optimizedPrompt: string
  assistantSuggestedNextMove: string | null
}

type DeepAnalysisV2DecisionSnapshot = {
  version: string
  analysisId?: string
  analysisVersion?: string
  analysisState?: "idle" | "quick_check_ready" | "v2_running" | "v2_ready" | "v2_unavailable" | "stale"
  analysisMode?: "standard" | "large_input_checkpoint"
  threadId?: string
  messageId?: string
  submittedPromptHash?: string
  assistantAnswerHash?: string
  surface?: "chatgpt" | "replit" | "lovable" | "unknown"
  completedAt?: string
  rolloutMode?: "off" | "shadow" | "on"
  applied?: boolean
  provider: "openai" | "kimi" | "deepseek" | "fallback" | "none"
  model?: string
  latencyMs?: number
  providerAttempted?: "openai" | "kimi" | "deepseek" | "none"
  fallbackReason?: string
  failureMessage?: string
  kimiLatencyMs?: number
  deepSeekAttempted?: boolean
  deepSeekLatencyMs?: number
  deepSeekFailureReason?: string
  overallStatus: "pass" | "needs_confirmation" | "risky" | "fail" | "unavailable"
  confidence: "low" | "medium" | "high"
  requirementCount: number
  missingCount: number
  assistantSuggestedNextMove: string | null
  nextStepSource?: "assistant_suggestion" | "project_memory" | "system_inferred" | "unavailable"
  nextStepRequirements?: string[]
  blockedScope?: string[]
  promptIntent?: "implement_next_step" | "confirm_missing_requirements" | "ask_for_next_step" | "review_before_advancing"
  generatedPrompt: string
}

type DeepAnalysisV2ComparisonSnapshot = {
  v1Decision: string | null
  v2Decision: string
  agreement: "agree" | "disagree" | "unknown"
  provider: "openai" | "kimi" | "deepseek" | "fallback" | "none"
  latencyMs?: number
  generatedPrompt: string
}

type EvalCandidate = {
  candidateId: string
  status: CandidateStatus
  reasons: string[]
  sourceEventIds: string[]
  projectKey?: string
  projectLabel?: string
  promptText: string
  responseText: string
  taskType: string
  analysisStatus: string
  confidence: string
  workflowState?: string | null
  finalDecision: DecisionSnapshot | null
  selectedSignal: SignalSnapshot | null
  aiSignal: SignalSnapshot | null
  localSignal: SignalSnapshot | null
  signalSource: SignalSource
  signalAgreement: SignalAgreement
  simpleNextPromptDecision?: SimpleNextPromptDecisionSnapshot | null
  deepAnalysisV2Decision?: DeepAnalysisV2DecisionSnapshot | null
  deepAnalysisV2Comparison?: DeepAnalysisV2ComparisonSnapshot | null
  suggestedExpectedDecision: DecisionSnapshot | null
  reviewerNote?: string
  expectedDecisionNote?: string
  rubricNote?: string
  createdAt: string
  updatedAt: string
}

type StatusFilter = CandidateStatus | "all"

const STORAGE_KEY = "noretry-admin:next-move-eval-candidates:v1"
const ADMIN_CANDIDATES_API_PATH = "/api/admin/eval-candidates"

const statusLabels: Record<CandidateStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
  needs_edit: "Needs edit",
  product_rule_issue: "Product rule issue"
}

const reasonLabels: Record<string, string> = {
  ai_local_disagreement: "AI and fallback disagreed",
  signal_ai_only: "AI found a signal fallback missed",
  signal_local_only: "Fallback found a signal AI missed",
  low_confidence_ai_fallback: "Low-confidence AI used fallback",
  no_next_move_signal: "No next-move signal",
  simple_needs_confirmation: "Simple flow needs confirmation",
  simple_ready_for_next_prompt: "Simple flow ready for next prompt",
  deep_v2_shadow: "Deep Analysis v2 shadow sample",
  deep_v2_fallback: "Deep Analysis v2 used fallback",
  deep_v2_unavailable: "Deep Analysis v2 unavailable",
  deep_v2_low_confidence: "Deep Analysis v2 low confidence",
  deep_v2_v1_disagreement: "Deep Analysis v2 disagreed with v1"
}

const sampleCandidates: EvalCandidate[] = [
  {
    candidateId: "sample-replit-data-save",
    status: "pending",
    reasons: ["ai_local_disagreement"],
    sourceEventIds: ["sample-event-1"],
    projectLabel: "replit.com/@builder/booking-app",
    promptText: "Build a booking app where customers can submit appointments and I can view saved bookings.",
    responseText:
      "The booking page and form are ready. The next step is to deploy the app. I can add database persistence later if you want.",
    taskType: "feature_build",
    analysisStatus: "partial",
    confidence: "medium",
    workflowState: "implementation",
    finalDecision: {
      status: "blocked",
      recommendationKind: "finish_missing_requirement",
      title: "Finish saving bookings before deploying",
      primaryCtaLabel: "Create follow-up prompt"
    },
    selectedSignal: {
      source: "ai",
      kind: "continue_current_task",
      nextMoveType: "finish_missing_requirement",
      currentStepClaim: "UI exists but database persistence is incomplete",
      confidenceLevel: "high"
    },
    aiSignal: {
      source: "ai",
      kind: "continue_current_task",
      nextMoveType: "finish_missing_requirement",
      currentStepClaim: "UI exists but database persistence is incomplete",
      confidenceLevel: "high"
    },
    localSignal: {
      source: "local_heuristic",
      kind: "advance",
      nextMoveType: "deploy",
      confidenceLevel: "medium"
    },
    signalSource: "ai",
    signalAgreement: "disagree",
    simpleNextPromptDecision: {
      version: "simple-next-prompt-decision.v1",
      status: "needs_confirmation",
      rolloutMode: "on",
      applied: true,
      requirementStatus: "needs_confirmation",
      confirmedCount: 3,
      missingCount: 1,
      missingRequirements: ["Confirm database persistence is implemented."],
      optimizedPrompt:
        "Before we move forward, confirm these requirements from my last prompt:\n\n- Confirm database persistence is implemented.\n\nFor each one, answer:\n- Completed, with evidence\n- Not completed yet, with what remains\n\nDo not add new scope yet.\n\nAfter confirming, suggest what the next step should be.",
      assistantSuggestedNextMove: "deploy the app"
    },
    suggestedExpectedDecision: {
      status: "blocked",
      recommendationKind: "finish_missing_requirement",
      title: "Finish saving bookings before deploying",
      primaryCtaLabel: "Create follow-up prompt"
    },
    createdAt: "2026-05-04T00:00:00.000Z",
    updatedAt: "2026-05-04T00:00:00.000Z"
  },
  {
    candidateId: "sample-lovable-submit",
    status: "pending",
    reasons: ["signal_ai_only"],
    sourceEventIds: ["sample-event-2"],
    projectLabel: "lovable.dev/landing-page",
    promptText: "Create a landing page with a working lead form that sends every signup to Supabase.",
    responseText:
      "The design is complete and the signup form is visible. You should review the page now. Supabase wiring still needs the insert function.",
    taskType: "feature_build",
    analysisStatus: "partial",
    confidence: "high",
    workflowState: "validation",
    finalDecision: {
      status: "blocked",
      recommendationKind: "finish_missing_requirement",
      title: "Connect the form before review",
      primaryCtaLabel: "Ask agent to wire Supabase"
    },
    selectedSignal: {
      source: "ai",
      kind: "continue_current_task",
      nextMoveType: "finish_missing_requirement",
      currentStepClaim: "The submit path is not wired yet",
      confidenceLevel: "high"
    },
    aiSignal: {
      source: "ai",
      kind: "continue_current_task",
      nextMoveType: "finish_missing_requirement",
      currentStepClaim: "The submit path is not wired yet",
      confidenceLevel: "high"
    },
    localSignal: null,
    signalSource: "ai",
    signalAgreement: "ai_only",
    simpleNextPromptDecision: null,
    suggestedExpectedDecision: {
      status: "blocked",
      recommendationKind: "finish_missing_requirement",
      title: "Connect the form before review",
      primaryCtaLabel: "Ask agent to wire Supabase"
    },
    createdAt: "2026-05-04T00:00:00.000Z",
    updatedAt: "2026-05-04T00:00:00.000Z"
  }
]

function normalizeStatus(value: unknown): CandidateStatus {
  return value === "accepted" ||
    value === "rejected" ||
    value === "needs_edit" ||
    value === "product_rule_issue" ||
    value === "pending"
    ? value
    : "pending"
}

function normalizeCandidate(input: unknown, index: number): EvalCandidate | null {
  if (!input || typeof input !== "object") return null
  const record = input as Partial<EvalCandidate>
  const now = new Date().toISOString()

  return {
    candidateId: String(record.candidateId || `imported-${Date.now()}-${index}`),
    status: normalizeStatus(record.status),
    reasons: Array.isArray(record.reasons) ? record.reasons.map(String) : [],
    sourceEventIds: Array.isArray(record.sourceEventIds) ? record.sourceEventIds.map(String) : [],
    projectKey: record.projectKey,
    projectLabel: record.projectLabel,
    promptText: String(record.promptText || ""),
    responseText: String(record.responseText || ""),
    taskType: String(record.taskType || "unknown"),
    analysisStatus: String(record.analysisStatus || "unknown"),
    confidence: String(record.confidence || "unknown"),
    workflowState: record.workflowState ?? null,
    finalDecision: record.finalDecision ?? null,
    selectedSignal: record.selectedSignal ?? null,
    aiSignal: record.aiSignal ?? null,
    localSignal: record.localSignal ?? null,
    signalSource: record.signalSource ?? "none",
    signalAgreement: record.signalAgreement ?? "none",
    simpleNextPromptDecision: record.simpleNextPromptDecision ?? null,
    deepAnalysisV2Decision: record.deepAnalysisV2Decision ?? null,
    deepAnalysisV2Comparison: record.deepAnalysisV2Comparison ?? null,
    suggestedExpectedDecision: record.suggestedExpectedDecision ?? record.finalDecision ?? null,
    reviewerNote: record.reviewerNote,
    expectedDecisionNote: record.expectedDecisionNote,
    rubricNote: record.rubricNote,
    createdAt: record.createdAt || now,
    updatedAt: record.updatedAt || now
  }
}

function parseCandidatePayload(value: string) {
  const parsed = JSON.parse(value) as unknown
  const candidates = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { candidates?: unknown[] }).candidates)
      ? (parsed as { candidates: unknown[] }).candidates
      : null

  if (!candidates) {
    throw new Error("JSON must be an array of candidates or an object with a candidates array.")
  }

  return candidates.map(normalizeCandidate).filter((candidate): candidate is EvalCandidate => Boolean(candidate))
}

function candidateTime(value: string | undefined) {
  if (!value) return 0
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function sortCandidatesByAnalysisTime(candidates: EvalCandidate[]) {
  return [...candidates].sort((a, b) => {
    const timeDelta = candidateTime(b.createdAt) - candidateTime(a.createdAt)
    if (timeDelta !== 0) return timeDelta
    return candidateTime(b.updatedAt) - candidateTime(a.updatedAt)
  })
}

function mergeCandidates(existing: EvalCandidate[], incoming: EvalCandidate[]) {
  const byId = new Map(existing.map((candidate) => [candidate.candidateId, candidate]))
  for (const candidate of incoming) {
    const previous = byId.get(candidate.candidateId)
    byId.set(candidate.candidateId, {
      ...previous,
      ...candidate,
      reviewerNote: previous?.reviewerNote || candidate.reviewerNote,
      expectedDecisionNote: previous?.expectedDecisionNote || candidate.expectedDecisionNote,
      rubricNote: previous?.rubricNote || candidate.rubricNote,
      status: previous && previous.status !== "pending" ? previous.status : candidate.status,
      createdAt: candidate.createdAt || previous?.createdAt || new Date().toISOString(),
      updatedAt: candidate.updatedAt || previous?.updatedAt || candidate.createdAt || new Date().toISOString()
    })
  }
  return sortCandidatesByAnalysisTime(Array.from(byId.values()))
}

function formatDecision(decision: DecisionSnapshot | null) {
  if (!decision) return "No decision captured"
  return `${decision.status} / ${decision.recommendationKind}`
}

function formatSignal(signal: SignalSnapshot | null) {
  if (!signal) return "None"
  return [signal.source, signal.kind, signal.nextMoveType, signal.confidenceLevel].filter(Boolean).join(" / ")
}

function formatSimpleDecision(simpleDecision: SimpleNextPromptDecisionSnapshot | null | undefined) {
  if (!simpleDecision) return "No simple decision captured"
  return `${simpleDecision.status} / ${simpleDecision.requirementStatus}`
}

function formatDeepAnalysisV2Decision(deepDecision: DeepAnalysisV2DecisionSnapshot | null | undefined) {
  if (!deepDecision) return "No v2 decision captured"
  return `${deepDecision.overallStatus} / ${deepDecision.confidence}`
}

function humanizeKey(value: string | null | undefined) {
  if (!value) return "Unknown"
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function shortDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date)
}

function percentile(values: number[], target: number) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((target / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)]
}

function formatLatency(value: number | null) {
  return typeof value === "number" ? `${value}ms` : "n/a"
}

async function fetchServerCandidates() {
  const response = await fetch(ADMIN_CANDIDATES_API_PATH, { cache: "no-store" })
  if (!response.ok) throw new Error(`Server load failed with ${response.status}`)
  const data = (await response.json()) as { candidates?: unknown[] }
  return parseCandidatePayload(JSON.stringify(data.candidates ?? []))
}

async function saveServerCandidates(candidates: EvalCandidate[]) {
  const response = await fetch(ADMIN_CANDIDATES_API_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "admin",
      replace: true,
      candidates
    })
  })
  if (!response.ok) throw new Error(`Server save failed with ${response.status}`)
  return response.json() as Promise<{ total: number }>
}

export default function EvalReviewAdminPage() {
  const [candidates, setCandidates] = useState<EvalCandidate[]>([])
  const [hasLoadedWorkspace, setHasLoadedWorkspace] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending")
  const [search, setSearch] = useState("")
  const [importText, setImportText] = useState("")
  const [message, setMessage] = useState("Ready")
  const [serverStatus, setServerStatus] = useState("Loading server candidates")

  useEffect(() => {
    let cancelled = false

    async function loadWorkspace() {
      let localCandidates: EvalCandidate[] = []
      const stored = window.localStorage.getItem(STORAGE_KEY)

      if (stored) {
        try {
          localCandidates = parseCandidatePayload(stored)
          setMessage("Loaded saved browser workspace")
        } catch {
          window.localStorage.removeItem(STORAGE_KEY)
          setMessage("Saved browser workspace was reset because it could not be read")
        }
      }

      try {
        const serverCandidates = await fetchServerCandidates()
        if (cancelled) return
        setCandidates(mergeCandidates(localCandidates, serverCandidates))
        setServerStatus(`Connected to server · ${serverCandidates.length} stored`)
      } catch (error) {
        if (cancelled) return
        setCandidates(localCandidates)
        setServerStatus(error instanceof Error ? error.message : "Server unavailable")
      } finally {
        if (!cancelled) setHasLoadedWorkspace(true)
      }
    }

    void loadWorkspace()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!hasLoadedWorkspace) return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(candidates, null, 2))
  }, [candidates, hasLoadedWorkspace])

  useEffect(() => {
    if (!hasLoadedWorkspace) return
    const timeoutId = window.setTimeout(() => {
      void saveServerCandidates(candidates)
        .then((result) => setServerStatus(`Synced to server · ${result.total} stored`))
        .catch((error) => setServerStatus(error instanceof Error ? error.message : "Server sync failed"))
    }, 700)

    return () => window.clearTimeout(timeoutId)
  }, [candidates, hasLoadedWorkspace])

  const stats = useMemo(() => {
    return candidates.reduce(
      (acc, candidate) => {
        acc[candidate.status] += 1
        acc.total += 1
        return acc
      },
      {
        total: 0,
        pending: 0,
        accepted: 0,
        rejected: 0,
        needs_edit: 0,
        product_rule_issue: 0
      }
    )
  }, [candidates])

  const v2Stats = useMemo(() => {
    const v2Candidates = candidates.filter((candidate) => candidate.deepAnalysisV2Decision)
    const decisions = v2Candidates.map((candidate) => candidate.deepAnalysisV2Decision!)
    const latencies = decisions
      .map((decision) => decision.latencyMs)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    const fallbackCount = decisions.filter((decision) => decision.provider === "fallback").length
    const unavailableCount = decisions.filter((decision) => decision.overallStatus === "unavailable").length
    const lowConfidenceCount = decisions.filter((decision) => decision.confidence === "low").length
    const pendingCount = v2Candidates.filter((candidate) => candidate.status === "pending").length

    return {
      total: v2Candidates.length,
      pendingCount,
      fallbackCount,
      unavailableCount,
      lowConfidenceCount,
      p50: percentile(latencies, 50),
      p90: percentile(latencies, 90)
    }
  }, [candidates])

  const filteredCandidates = useMemo(() => {
    const query = search.trim().toLowerCase()
    return sortCandidatesByAnalysisTime(candidates.filter((candidate) => {
      const matchesStatus = statusFilter === "all" || candidate.status === statusFilter
      if (!matchesStatus) return false
      if (!query) return true
      return [
        candidate.candidateId,
        candidate.projectLabel,
        candidate.promptText,
        candidate.responseText,
        candidate.taskType,
        candidate.finalDecision?.title,
        candidate.finalDecision?.recommendationKind,
        candidate.reviewerNote
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    }))
  }, [candidates, search, statusFilter])

  function updateCandidate(candidateId: string, patch: Partial<EvalCandidate>) {
    setCandidates((current) =>
      current.map((candidate) =>
        candidate.candidateId === candidateId
          ? {
              ...candidate,
              ...patch,
              updatedAt: new Date().toISOString()
            }
          : candidate
      )
    )
  }

  function handleImport() {
    try {
      const imported = parseCandidatePayload(importText)
      setCandidates((current) => mergeCandidates(current, imported))
      setImportText("")
      setMessage(`Imported ${imported.length} candidate${imported.length === 1 ? "" : "s"}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not import candidates")
    }
  }

  function handleLoadSamples() {
    setCandidates((current) => mergeCandidates(current, sampleCandidates))
    setMessage("Loaded sample candidates")
  }

  async function handleRefreshFromServer() {
    try {
      const serverCandidates = await fetchServerCandidates()
      setCandidates((current) => mergeCandidates(current, serverCandidates))
      setServerStatus(`Refreshed from server · ${serverCandidates.length} stored`)
    } catch (error) {
      setServerStatus(error instanceof Error ? error.message : "Server refresh failed")
    }
  }

  async function handleCopyJson() {
    await navigator.clipboard.writeText(JSON.stringify(candidates, null, 2))
    setMessage("Copied reviewed JSON")
  }

  function handleDownloadJson() {
    const blob = new Blob([JSON.stringify(candidates, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "next-move-eval-candidates-reviewed.json"
    link.click()
    URL.revokeObjectURL(url)
    setMessage("Downloaded reviewed JSON")
  }

  function handleClearReviewedWorkspace() {
    setCandidates([])
    window.localStorage.removeItem(STORAGE_KEY)
    setMessage("Cleared local review workspace")
  }

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar} aria-label="Admin navigation">
        <div>
          <p className={styles.brand}>NoRetry</p>
          <h1>Admin</h1>
        </div>
        <nav className={styles.nav}>
          <a aria-current="page" href="/admin/eval-review">
            Eval Review
          </a>
        </nav>
        <p className={styles.sidebarNote}>Local review workspace. Database-backed review comes next.</p>
      </aside>

      <section className={styles.workspace}>
        <header className={styles.header}>
          <div>
            <p className={styles.kicker}>Next-move evaluation</p>
            <h2>Candidate review</h2>
            <p className={styles.subtle}>
              Review production learning signals before they become approved eval fixtures or product rules.
            </p>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.secondaryButton} onClick={handleRefreshFromServer}>
              Refresh
            </button>
            <button type="button" className={styles.secondaryButton} onClick={handleCopyJson} disabled={!candidates.length}>
              Copy JSON
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={handleDownloadJson}
              disabled={!candidates.length}
            >
              Export JSON
            </button>
          </div>
        </header>

        <section className={styles.metrics} aria-label="Review status summary">
          <button type="button" onClick={() => setStatusFilter("all")} data-active={statusFilter === "all"}>
            <span>Total</span>
            <strong>{stats.total}</strong>
          </button>
          {(Object.keys(statusLabels) as CandidateStatus[]).map((status) => (
            <button
              type="button"
              key={status}
              onClick={() => setStatusFilter(status)}
              data-active={statusFilter === status}
            >
              <span>{statusLabels[status]}</span>
              <strong>{stats[status]}</strong>
            </button>
          ))}
        </section>

        <section className={styles.v2Metrics} aria-label="Deep Analysis v2 live validation summary">
          <div>
            <span>v2 samples</span>
            <strong>{v2Stats.total}</strong>
            <p>{v2Stats.pendingCount} pending review</p>
          </div>
          <div>
            <span>Latency</span>
            <strong>{formatLatency(v2Stats.p50)}</strong>
            <p>p90 {formatLatency(v2Stats.p90)}</p>
          </div>
          <div>
            <span>Unavailable</span>
            <strong>{v2Stats.unavailableCount}</strong>
            <p>LLM analysis did not complete</p>
          </div>
          <div>
            <span>Low confidence</span>
            <strong>{v2Stats.lowConfidenceCount}</strong>
            <p>Review before rollout</p>
          </div>
        </section>

        <section className={styles.importPanel} aria-label="Candidate import">
          <div>
            <h3>Import candidates</h3>
            <p>
              Paste the candidate JSON from the extension storage/export workflow. This page merges by candidate ID and
              keeps your review actions in this browser.
            </p>
          </div>
          <textarea
            value={importText}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setImportText(event.target.value)}
            placeholder='[{"candidateId":"...","status":"pending","promptText":"..."}]'
            spellCheck={false}
          />
          <div className={styles.importActions}>
            <button type="button" className={styles.primaryButton} onClick={handleImport} disabled={!importText.trim()}>
              Import JSON
            </button>
            <button type="button" className={styles.secondaryButton} onClick={handleLoadSamples}>
              Load samples
            </button>
            <button
              type="button"
              className={styles.dangerButton}
              onClick={handleClearReviewedWorkspace}
              disabled={!candidates.length}
            >
              Clear workspace
            </button>
            <span role="status" aria-live="polite">
              {message} · {serverStatus}
            </span>
          </div>
        </section>

        <section className={styles.toolbar} aria-label="Candidate filters">
          <label>
            Search
            <input
              value={search}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)}
              placeholder="Project, decision, prompt, answer, note"
            />
          </label>
        </section>

        <section className={styles.candidateList} aria-label="Eval candidates">
          {filteredCandidates.length === 0 ? (
            <div className={styles.emptyState}>
              <h3>No candidates in this view</h3>
              <p>Import production candidates, load samples, or change the status filter.</p>
            </div>
          ) : (
            filteredCandidates.map((candidate) => (
              <article className={styles.candidate} key={candidate.candidateId}>
                <div className={styles.candidateHeader}>
                  <div>
                    <p className={styles.candidateMeta}>
                      {candidate.projectLabel || "Unknown project"} · {candidate.taskType} · analyzed{" "}
                      {shortDate(candidate.createdAt)}
                    </p>
                    <h3>{candidate.finalDecision?.title || candidate.candidateId}</h3>
                  </div>
                  <span className={styles.statusPill} data-status={candidate.status}>
                    {statusLabels[candidate.status]}
                  </span>
                </div>

                <div className={styles.reasonRow}>
                  {candidate.reasons.length ? (
                    candidate.reasons.map((reason) => <span key={reason}>{reasonLabels[reason] || reason}</span>)
                  ) : (
                    <span>No reason captured</span>
                  )}
                </div>

                <div className={styles.summaryGrid}>
                  <div>
                    <span>Final decision</span>
                    <strong>{formatDecision(candidate.finalDecision)}</strong>
                    <p>{candidate.finalDecision?.primaryCtaLabel || "No CTA captured"}</p>
                  </div>
                  <div>
                    <span>Selected signal</span>
                    <strong>{formatSignal(candidate.selectedSignal)}</strong>
                    <p>
                      {candidate.signalSource} · {candidate.signalAgreement}
                    </p>
                  </div>
                  <div>
                    <span>AI signal</span>
                    <strong>{formatSignal(candidate.aiSignal)}</strong>
                    <p>{candidate.aiSignal?.currentStepClaim || "No AI claim captured"}</p>
                  </div>
                  <div>
                    <span>Fallback signal</span>
                    <strong>{formatSignal(candidate.localSignal)}</strong>
                    <p>{candidate.localSignal?.currentStepClaim || "No fallback claim captured"}</p>
                  </div>
                </div>

                <div className={styles.simpleDecisionPanel}>
                  <div>
                    <span>Simple flow decision</span>
                    <strong>{formatSimpleDecision(candidate.simpleNextPromptDecision)}</strong>
                    <p>
                      {candidate.simpleNextPromptDecision
                        ? `${candidate.simpleNextPromptDecision.confirmedCount} confirmed · ${candidate.simpleNextPromptDecision.missingCount} missing`
                        : "No simplified requirement-match snapshot was captured for this candidate."}
                    </p>
                  </div>
                  {candidate.simpleNextPromptDecision ? (
                    <>
                      <div>
                        <span>Assistant suggested</span>
                        <strong>{candidate.simpleNextPromptDecision.assistantSuggestedNextMove || "No next move captured"}</strong>
                        <p>{candidate.simpleNextPromptDecision.version}</p>
                      </div>
                      <div>
                        <span>Rollout</span>
                        <strong>{candidate.simpleNextPromptDecision.rolloutMode || "unknown"}</strong>
                        <p>{candidate.simpleNextPromptDecision.applied === false ? "Observed only" : "Applied to popup"}</p>
                      </div>
                      <div>
                        <span>Missing requirements</span>
                        {candidate.simpleNextPromptDecision.missingRequirements.length ? (
                          <ul>
                            {candidate.simpleNextPromptDecision.missingRequirements.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <p>No missing requirements.</p>
                        )}
                      </div>
                      <div className={styles.simplePromptPreview}>
                        <span>Generated prompt</span>
                        <p>{candidate.simpleNextPromptDecision.optimizedPrompt || "No prompt captured"}</p>
                      </div>
                    </>
                  ) : null}
                </div>

                <div className={styles.deepAnalysisV2Panel}>
                  <div>
                    <span>Deep Analysis v2</span>
                    <strong>{formatDeepAnalysisV2Decision(candidate.deepAnalysisV2Decision)}</strong>
                    <p>
                      {candidate.deepAnalysisV2Decision
                        ? `${candidate.deepAnalysisV2Decision.requirementCount} requirements · ${candidate.deepAnalysisV2Decision.missingCount} missing`
                        : "No Deep Analysis v2 snapshot was captured for this candidate."}
                    </p>
                  </div>
                  {candidate.deepAnalysisV2Decision ? (
                    <>
                      <div>
                        <span>Provider</span>
                        <strong>{candidate.deepAnalysisV2Decision.provider}</strong>
                        <p>
                          {[
                            candidate.deepAnalysisV2Decision.model,
                            candidate.deepAnalysisV2Decision.latencyMs
                              ? `${candidate.deepAnalysisV2Decision.latencyMs}ms`
                              : null
                          ]
                            .filter(Boolean)
                            .join(" · ") || "No provider detail captured"}
                        </p>
                        {candidate.deepAnalysisV2Decision.provider === "fallback" ? (
                          <p>
                            {[
                              candidate.deepAnalysisV2Decision.providerAttempted
                                ? `attempted ${candidate.deepAnalysisV2Decision.providerAttempted}`
                                : null,
                              candidate.deepAnalysisV2Decision.fallbackReason
                                ? `reason: ${candidate.deepAnalysisV2Decision.fallbackReason}`
                                : null,
                              candidate.deepAnalysisV2Decision.kimiLatencyMs
                                ? `Kimi ${candidate.deepAnalysisV2Decision.kimiLatencyMs}ms`
                                : null,
                              candidate.deepAnalysisV2Decision.deepSeekAttempted
                                ? `DeepSeek ${candidate.deepAnalysisV2Decision.deepSeekFailureReason || "attempted"}`
                                : null
                            ]
                              .filter(Boolean)
                              .join(" · ") || "Fallback reason not captured"}
                          </p>
                        ) : null}
                        {candidate.deepAnalysisV2Decision.failureMessage ? (
                          <p>{candidate.deepAnalysisV2Decision.failureMessage}</p>
                        ) : null}
                      </div>
                      <div>
                        <span>Rollout</span>
                        <strong>{candidate.deepAnalysisV2Decision.rolloutMode || "unknown"}</strong>
                        <p>{candidate.deepAnalysisV2Decision.applied === false ? "Observed only" : "Applied to popup"}</p>
                      </div>
                      <div>
                        <span>Assistant suggested</span>
                        <strong>{candidate.deepAnalysisV2Decision.assistantSuggestedNextMove || "No next move captured"}</strong>
                        <p>{candidate.deepAnalysisV2Decision.version}</p>
                      </div>
                      <div>
                        <span>Prompt intent</span>
                        <strong>{humanizeKey(candidate.deepAnalysisV2Decision.promptIntent)}</strong>
                        <p>
                          Next step source: {humanizeKey(candidate.deepAnalysisV2Decision.nextStepSource)}
                          {candidate.deepAnalysisV2Decision.analysisMode
                            ? ` · Mode: ${humanizeKey(candidate.deepAnalysisV2Decision.analysisMode)}`
                            : ""}
                        </p>
                      </div>
                      <div>
                        <span>Next step requirements</span>
                        {candidate.deepAnalysisV2Decision.nextStepRequirements?.length ? (
                          <ul>
                            {candidate.deepAnalysisV2Decision.nextStepRequirements.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <p>No next-step requirements captured.</p>
                        )}
                      </div>
                      <div>
                        <span>Blocked scope</span>
                        {candidate.deepAnalysisV2Decision.blockedScope?.length ? (
                          <ul>
                            {candidate.deepAnalysisV2Decision.blockedScope.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <p>No blocked scope captured.</p>
                        )}
                      </div>
                      <div className={styles.simplePromptPreview}>
                        <span>Generated prompt</span>
                        <p>{candidate.deepAnalysisV2Decision.generatedPrompt || "No prompt captured"}</p>
                      </div>
                    </>
                  ) : null}
                  {candidate.deepAnalysisV2Comparison ? (
                    <div className={styles.simplePromptPreview}>
                      <span>v1 / v2 agreement</span>
                      <strong>{candidate.deepAnalysisV2Comparison.agreement}</strong>
                      <p>
                        v1: {candidate.deepAnalysisV2Comparison.v1Decision || "none"} · v2:{" "}
                        {candidate.deepAnalysisV2Comparison.v2Decision}
                      </p>
                    </div>
                  ) : null}
                </div>

                <div className={styles.evidenceGrid}>
                  <section>
                    <h4>User request</h4>
                    <p>{candidate.promptText || "No prompt text captured"}</p>
                  </section>
                  <section>
                    <h4>Assistant answer</h4>
                    <p>{candidate.responseText || "No response text captured"}</p>
                  </section>
                </div>

                <div className={styles.reviewFields}>
                  <label>
                    Reviewer note
                    <textarea
                      value={candidate.reviewerNote || ""}
                      onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                        updateCandidate(candidate.candidateId, { reviewerNote: event.target.value })
                      }
                      placeholder="Why this should be accepted, rejected, edited, or turned into a product-rule change."
                    />
                  </label>
                  <label>
                    Expected decision or fixture edit
                    <textarea
                      value={candidate.expectedDecisionNote || ""}
                      onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                        updateCandidate(candidate.candidateId, { expectedDecisionNote: event.target.value })
                      }
                      placeholder="What the approved expected decision should be, if different from the suggestion."
                    />
                  </label>
                  <label>
                    Rubric or product-rule note
                    <textarea
                      value={candidate.rubricNote || ""}
                      onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                        updateCandidate(candidate.candidateId, { rubricNote: event.target.value })
                      }
                      placeholder="Describe any product rule this case exposes."
                    />
                  </label>
                </div>

                <div className={styles.actionRow}>
                  {(Object.keys(statusLabels) as CandidateStatus[]).map((status) => (
                    <button
                      type="button"
                      key={status}
                      className={status === "accepted" ? styles.primaryButton : styles.secondaryButton}
                      data-selected={candidate.status === status}
                      onClick={() => updateCandidate(candidate.candidateId, { status })}
                    >
                      {statusLabels[status]}
                    </button>
                  ))}
                </div>
              </article>
            ))
          )}
        </section>
      </section>
    </main>
  )
}
