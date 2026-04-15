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
    border: "1px solid rgba(185, 28, 28, 0.14)",
    background: "#fff1f2",
    padding: 16
  },
  title: {
    margin: 0,
    color: "#b91c1c",
    fontSize: 16,
    fontWeight: 800
  },
  body: {
    margin: "8px 0 0",
    color: "#7f1d1d",
    fontSize: 14,
    lineHeight: 1.55
  }
}
