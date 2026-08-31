import type { CSSProperties } from "react"
import { SectionCard } from "../shared/SectionCard"
import { StatusBadge } from "../shared/StatusBadge"
import type { ReviewPopupViewModel } from "./review-types"

type ReviewRequirementMatchSummaryProps = {
  summary: NonNullable<ReviewPopupViewModel["requirementMatchSummary"]>
}

function rowTone(status: ReviewPopupViewModel["checklistRows"][number]["status"]) {
  switch (status) {
    case "verified":
      return "success" as const
    case "missing":
    case "blocked":
      return "warning" as const
    default:
      return "neutral" as const
  }
}

function rowLabel(status: ReviewPopupViewModel["checklistRows"][number]["status"]) {
  switch (status) {
    case "verified":
      return "Confirmed"
    case "missing":
      return "Needs confirmation"
    case "blocked":
      return "Blocked"
    default:
      return "Not proven"
  }
}

export function ReviewRequirementMatchSummary(props: ReviewRequirementMatchSummaryProps) {
  const passed = props.summary.status === "pass"
  const subtitle = passed
    ? `${props.summary.confirmedCount} requested item${props.summary.confirmedCount === 1 ? "" : "s"} confirmed.`
    : `${props.summary.missingCount} requested item${props.summary.missingCount === 1 ? "" : "s"} still need confirmation.`

  return (
    <SectionCard title="Requirements checked" subtitle={subtitle}>
      <div style={styles.summaryRow}>
        <StatusBadge label={passed ? "Matched" : "Needs confirmation"} tone={passed ? "success" : "warning"} />
        <span style={styles.countText}>
          {props.summary.confirmedCount} confirmed · {props.summary.missingCount} missing
        </span>
      </div>
      <div style={styles.rows}>
        {props.summary.rows.map((row) => (
          <div key={row.id} style={styles.row}>
            <span style={styles.rowText}>{row.label.replace(/\s+\((?:Confirmed|Needs confirmation|Missing|Unclear|Covered)\)$/i, "")}</span>
            <StatusBadge label={rowLabel(row.status)} tone={rowTone(row.status)} />
          </div>
        ))}
      </div>
    </SectionCard>
  )
}

const styles: Record<string, CSSProperties> = {
  summaryRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
    minWidth: 0
  },
  countText: {
    minWidth: 0,
    color: "#64748b",
    fontSize: 13,
    fontWeight: 700,
    overflowWrap: "anywhere"
  },
  rows: {
    display: "grid",
    gap: 8
  },
  row: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    gap: 12,
    borderTop: "1px solid rgba(148,163,184,0.14)",
    paddingTop: 10,
    minWidth: 0
  },
  rowText: {
    minWidth: 0,
    color: "#0f172a",
    fontSize: 13,
    lineHeight: 1.45,
    fontWeight: 650,
    overflowWrap: "anywhere"
  }
}
