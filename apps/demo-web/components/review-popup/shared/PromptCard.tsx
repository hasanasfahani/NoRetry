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
    borderRadius: 22,
    background:
      "linear-gradient(180deg, rgba(8,15,32,0.94) 0%, rgba(10,19,39,0.9) 100%)",
    color: "#e2e8f0",
    padding: 18,
    display: "grid",
    gap: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    boxShadow: "0 20px 48px rgba(0,0,0,0.24)"
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
    color: "#76b2ff"
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
    color: "rgba(226, 235, 255, 0.78)"
  }
}
