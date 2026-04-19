import type { CSSProperties } from "react"

type ErrorStateProps = {
  title: string
  body: string
}

export function ErrorState(props: ErrorStateProps) {
  return (
    <div style={styles.card}>
      <p style={styles.title}>{props.title}</p>
      <p style={styles.body}>{props.body}</p>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  card: {
    borderRadius: 20,
    border: "1px solid rgba(255,120,120,0.18)",
    background: "rgba(70, 19, 26, 0.72)",
    padding: 16
  },
  title: {
    margin: 0,
    color: "#ffb4b4",
    fontSize: 16,
    fontWeight: 800
  },
  body: {
    margin: "8px 0 0",
    color: "rgba(255, 222, 222, 0.82)",
    fontSize: 14,
    lineHeight: 1.55
  }
}
