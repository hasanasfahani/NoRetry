import type { CSSProperties } from "react"
import type { ReviewPopupViewModel } from "./review-types"
import { StatusBadge } from "../shared/StatusBadge"

type ReviewPopupHeaderProps = {
  viewModel: ReviewPopupViewModel
}

export function ReviewPopupHeader(props: ReviewPopupHeaderProps) {
  return (
    <div style={styles.wrap}>
      <StatusBadge label={props.viewModel.statusBadge.label} tone={props.viewModel.statusBadge.tone} />
      <div style={styles.copy}>
        <p style={styles.decision}>{props.viewModel.decision}</p>
        <p style={styles.recommendation}>👉 Recommended: {props.viewModel.recommendedAction}</p>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    display: "grid",
    gap: 14
  },
  copy: {
    display: "grid",
    gap: 8
  },
  decision: {
    margin: 0,
    fontSize: 30,
    lineHeight: 1.05,
    color: "#0f172a",
    fontWeight: 800
  },
  recommendation: {
    margin: 0,
    fontSize: 17,
    lineHeight: 1.45,
    color: "#1e293b",
    fontWeight: 700
  }
}
