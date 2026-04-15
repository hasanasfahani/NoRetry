import type { CSSProperties } from "react"

type PromptCardProps = {
  label: string
  prompt: string
  note?: string
}

export function PromptCard(props: PromptCardProps) {
  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <p style={styles.label}>{props.label}</p>
      </div>
      <pre style={styles.prompt}>{props.prompt}</pre>
      {props.note ? <p style={styles.note}>{props.note}</p> : null}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  card: {
    borderRadius: 18,
    background: "#0f172a",
    color: "#e2e8f0",
    padding: 16,
    display: "grid",
    gap: 10
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between"
  },
  label: {
    margin: 0,
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: "#93c5fd"
  },
  prompt: {
    margin: 0,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 13,
    lineHeight: 1.55,
    whiteSpace: "pre-wrap"
  },
  note: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: "#cbd5e1"
  }
}
