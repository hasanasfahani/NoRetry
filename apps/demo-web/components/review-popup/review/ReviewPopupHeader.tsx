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
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    display: "grid"
  }
}
