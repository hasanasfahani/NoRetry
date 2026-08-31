import type { CSSProperties } from "react"
import { SectionCard } from "../shared/SectionCard"
import { StatusBadge } from "../shared/StatusBadge"
import type { ReviewPopupViewModel } from "./review-types"

type ReviewNextMoveSummaryProps = {
  viewModel: ReviewPopupViewModel
}

function toneForDecisionStatus(status: NonNullable<ReviewPopupViewModel["nextMoveDecision"]>["status"]) {
  switch (status) {
    case "complete":
      return "success" as const
    case "incomplete":
      return "warning" as const
    case "risky":
      return "warning" as const
    case "blocked":
      return "danger" as const
    case "ready_for_next_phase":
      return "info" as const
    default:
      return "neutral" as const
  }
}

export function ReviewNextMoveSummary(props: ReviewNextMoveSummaryProps) {
  const decision = props.viewModel.nextMoveDecision
  if (!decision) return null
  const v2Trace = props.viewModel.deepAnalysisV2Trace
  const requirements = v2Trace?.nextStepRequirements ?? []
  const blockedScope = v2Trace?.blockedScope ?? []

  return (
    <SectionCard title="What to do next" subtitle={decision.recommendation.message}>
      <div style={styles.topRow}>
        <StatusBadge label={decision.recommendation.title} tone={toneForDecisionStatus(decision.status)} />
      </div>
      {requirements.length || blockedScope.length ? (
        <div style={styles.trace}>
          {requirements.length ? (
            <div style={styles.traceBlock}>
              <span style={styles.traceLabel}>Next step requirements</span>
              <ul style={styles.traceList}>
                {requirements.map((item) => (
                  <li key={item} style={styles.traceItem}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {blockedScope.length ? (
            <div style={styles.traceBlock}>
              <span style={styles.traceLabel}>Blocked scope</span>
              <ul style={styles.traceList}>
                {blockedScope.map((item) => (
                  <li key={item} style={styles.traceItem}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </SectionCard>
  )
}

const styles: Record<string, CSSProperties> = {
  topRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    minWidth: 0
  },
  trace: {
    display: "grid",
    gap: 10,
    borderRadius: 12,
    border: "1px solid rgba(148,163,184,0.18)",
    background: "#f8fafc",
    padding: 12,
    minWidth: 0,
    overflow: "hidden"
  },
  traceMeta: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8
  },
  tracePill: {
    borderRadius: 999,
    background: "#ffffff",
    border: "1px solid rgba(148,163,184,0.2)",
    color: "#334155",
    fontSize: 12,
    fontWeight: 800,
    lineHeight: 1.2,
    padding: "6px 9px",
    maxWidth: "100%",
    overflowWrap: "anywhere"
  },
  traceBlock: {
    display: "grid",
    gap: 6
  },
  traceLabel: {
    color: "#475569",
    fontSize: 12,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: 0
  },
  traceList: {
    margin: 0,
    paddingLeft: 18,
    display: "grid",
    gap: 5
  },
  traceItem: {
    color: "#334155",
    fontSize: 13,
    lineHeight: 1.4,
    overflowWrap: "anywhere"
  }
}
