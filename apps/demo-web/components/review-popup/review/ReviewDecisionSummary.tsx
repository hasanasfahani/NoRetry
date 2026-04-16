import type { CSSProperties } from "react"
import { SectionCard } from "../shared/SectionCard"
import type { ReviewPopupViewModel } from "./review-types"

type ReviewDecisionSummaryProps = {
  viewModel: ReviewPopupViewModel
}

export function ReviewDecisionSummary(props: ReviewDecisionSummaryProps) {
  return (
    <SectionCard title="Confidence" subtitle={props.viewModel.confidenceLabel}>
      <p style={styles.note}>{props.viewModel.confidenceNote}</p>
      {props.viewModel.quickToDeepDelta ? <p style={styles.delta}>{props.viewModel.quickToDeepDelta}</p> : null}
      {props.viewModel.confidenceReasons.length ? (
        <ul style={styles.list}>
          {props.viewModel.confidenceReasons.map((item) => (
            <li key={item} style={styles.item}>
              {item}
            </li>
          ))}
        </ul>
      ) : null}
    </SectionCard>
  )
}

const styles: Record<string, CSSProperties> = {
  note: {
    margin: 0,
    color: "#475569",
    fontSize: 15,
    lineHeight: 1.55
  },
  delta: {
    margin: 0,
    color: "#1e293b",
    fontSize: 14,
    lineHeight: 1.55,
    fontWeight: 700
  },
  list: {
    margin: 0,
    paddingLeft: 18,
    display: "grid",
    gap: 8
  },
  item: {
    color: "#334155",
    fontSize: 14,
    lineHeight: 1.5
  }
}
