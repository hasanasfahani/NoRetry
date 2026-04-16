import type { CSSProperties } from "react"
import { ActionBar } from "../shared/ActionBar"

type ReviewFeedbackRowProps = {
  prompt: string
}

export function ReviewFeedbackRow(props: ReviewFeedbackRowProps) {
  return (
    <div style={styles.wrap}>
      <p style={styles.prompt}>{props.prompt}</p>
      <ActionBar
        actions={[
          { id: "yes", label: "Yes", kind: "secondary" },
          { id: "no", label: "No", kind: "secondary" }
        ]}
      />
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    display: "grid",
    gap: 12,
    paddingTop: 8
  },
  prompt: {
    margin: 0,
    color: "#0f172a",
    fontSize: 16,
    fontWeight: 800
  }
}
