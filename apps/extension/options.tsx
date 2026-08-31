import { useEffect, useMemo, useState, type CSSProperties } from "react"
import {
  getNextMoveEvalCandidates,
  updateNextMoveEvalCandidateReview,
  type NextMoveEvalCandidateRecord,
  type NextMoveEvalCandidateStatus
} from "./lib/storage"

const REVIEW_ACTIONS: Array<{ status: NextMoveEvalCandidateStatus; label: string }> = [
  { status: "accepted", label: "Accept" },
  { status: "rejected", label: "Reject" },
  { status: "needs_edit", label: "Needs edit" },
  { status: "product_rule_issue", label: "Product rule issue" }
]

export default function EvalReviewOptionsPage() {
  const [candidates, setCandidates] = useState<NextMoveEvalCandidateRecord[]>([])
  const [statusFilter, setStatusFilter] = useState<NextMoveEvalCandidateStatus | "all">("pending")
  const [noteById, setNoteById] = useState<Record<string, string>>({})
  const [copyStatus, setCopyStatus] = useState("")

  async function refresh() {
    const next = await getNextMoveEvalCandidates()
    setCandidates(next)
    setNoteById(Object.fromEntries(next.map((candidate) => [candidate.candidateId, candidate.reviewerNote ?? ""])))
  }

  useEffect(() => {
    void refresh()
  }, [])

  const visibleCandidates = useMemo(
    () => candidates.filter((candidate) => statusFilter === "all" || candidate.status === statusFilter),
    [candidates, statusFilter]
  )

  async function reviewCandidate(candidateId: string, status: NextMoveEvalCandidateStatus) {
    await updateNextMoveEvalCandidateReview({
      candidateId,
      status,
      reviewerNote: noteById[candidateId] ?? ""
    })
    await refresh()
  }

  async function copyCandidateJson() {
    await navigator.clipboard.writeText(JSON.stringify({ candidates }, null, 2))
    setCopyStatus("Copied")
    window.setTimeout(() => setCopyStatus(""), 1600)
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>reeva AI</p>
          <h1 style={styles.title}>Eval Review</h1>
          <p style={styles.subtitle}>Approve real next-move examples before they become product truth.</p>
        </div>
        <button type="button" style={styles.secondaryButton} onClick={() => void refresh()}>
          Refresh
        </button>
        <button type="button" style={styles.secondaryButton} onClick={() => void copyCandidateJson()}>
          {copyStatus || "Copy JSON"}
        </button>
      </header>

      <section style={styles.toolbar}>
        {(["pending", "accepted", "rejected", "needs_edit", "product_rule_issue", "all"] as const).map((status) => (
          <button
            key={status}
            type="button"
            style={statusFilter === status ? styles.activeFilter : styles.filter}
            onClick={() => setStatusFilter(status)}
          >
            {status.replace(/_/g, " ")}
          </button>
        ))}
      </section>

      <section style={styles.list}>
        {visibleCandidates.length === 0 ? (
          <p style={styles.empty}>No candidates in this view yet.</p>
        ) : (
          visibleCandidates.map((candidate) => (
            <article key={candidate.candidateId} style={styles.card}>
              <div style={styles.cardHeader}>
                <div>
                  <p style={styles.meta}>{candidate.reasons.join(", ")}</p>
                  <h2 style={styles.cardTitle}>{candidate.finalDecision?.recommendationKind ?? "No decision"}</h2>
                </div>
                <span style={styles.status}>{candidate.status.replace(/_/g, " ")}</span>
              </div>

              <div style={styles.grid}>
                <TextBlock label="User request" value={candidate.promptText} />
                <TextBlock label="Assistant answer" value={candidate.responseText} />
              </div>

              <div style={styles.facts}>
                <span>Task: {candidate.taskType}</span>
                <span>Review: {candidate.analysisStatus}</span>
                <span>Signals: {candidate.signalSource}/{candidate.signalAgreement}</span>
              </div>

              <textarea
                value={noteById[candidate.candidateId] ?? ""}
                placeholder="Reviewer note"
                style={styles.note}
                onChange={(event) =>
                  setNoteById((previous) => ({
                    ...previous,
                    [candidate.candidateId]: event.currentTarget.value
                  }))
                }
              />

              <div style={styles.actions}>
                {REVIEW_ACTIONS.map((action) => (
                  <button
                    key={action.status}
                    type="button"
                    style={action.status === "accepted" ? styles.primaryButton : styles.secondaryButton}
                    onClick={() => void reviewCandidate(candidate.candidateId, action.status)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </article>
          ))
        )}
      </section>
    </main>
  )
}

function TextBlock(props: { label: string; value: string }) {
  return (
    <div style={styles.textBlock}>
      <h3 style={styles.textLabel}>{props.label}</h3>
      <p style={styles.textValue}>{props.value || "Not captured"}</p>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    margin: 0,
    padding: 32,
    background: "#f8fafc",
    color: "#0f172a",
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: 24,
    alignItems: "flex-start",
    maxWidth: 1100,
    margin: "0 auto 24px"
  },
  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: 12,
    fontWeight: 800,
    textTransform: "uppercase"
  },
  title: {
    margin: "4px 0",
    fontSize: 32,
    lineHeight: 1.15
  },
  subtitle: {
    margin: 0,
    color: "#475569",
    fontSize: 15
  },
  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    maxWidth: 1100,
    margin: "0 auto 20px"
  },
  filter: {
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#334155",
    borderRadius: 8,
    padding: "8px 12px",
    fontWeight: 700,
    cursor: "pointer"
  },
  activeFilter: {
    border: "1px solid #2563eb",
    background: "#dbeafe",
    color: "#1d4ed8",
    borderRadius: 8,
    padding: "8px 12px",
    fontWeight: 800,
    cursor: "pointer"
  },
  list: {
    display: "grid",
    gap: 16,
    maxWidth: 1100,
    margin: "0 auto"
  },
  empty: {
    color: "#64748b",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: 20
  },
  card: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: 18,
    display: "grid",
    gap: 14
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16
  },
  meta: {
    margin: 0,
    color: "#64748b",
    fontSize: 12,
    fontWeight: 700
  },
  cardTitle: {
    margin: "4px 0 0",
    fontSize: 20
  },
  status: {
    color: "#475569",
    fontSize: 12,
    fontWeight: 800,
    textTransform: "uppercase"
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 12
  },
  textBlock: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: 12
  },
  textLabel: {
    margin: "0 0 6px",
    fontSize: 12,
    color: "#475569",
    textTransform: "uppercase"
  },
  textValue: {
    margin: 0,
    color: "#0f172a",
    fontSize: 14,
    lineHeight: 1.55
  },
  facts: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    color: "#475569",
    fontSize: 13,
    fontWeight: 700
  },
  note: {
    minHeight: 74,
    resize: "vertical",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    padding: 10,
    font: "inherit"
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8
  },
  primaryButton: {
    border: "1px solid #1d4ed8",
    background: "#2563eb",
    color: "#ffffff",
    borderRadius: 8,
    padding: "9px 12px",
    fontWeight: 800,
    cursor: "pointer"
  },
  secondaryButton: {
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#334155",
    borderRadius: 8,
    padding: "9px 12px",
    fontWeight: 800,
    cursor: "pointer"
  }
}
