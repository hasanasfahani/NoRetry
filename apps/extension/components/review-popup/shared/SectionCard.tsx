import type { CSSProperties, ReactNode } from "react"

type SectionCardProps = {
  title?: string
  subtitle?: string
  children: ReactNode
}

export function SectionCard(props: SectionCardProps) {
  return (
    <section style={styles.card}>
      {props.title ? <p style={styles.title}>{props.title}</p> : null}
      {props.subtitle ? <p style={styles.subtitle}>{props.subtitle}</p> : null}
      <div style={styles.content}>{props.children}</div>
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  card: {
    borderRadius: 22,
    border: "1px solid rgba(148, 163, 184, 0.18)",
    background: "rgba(255,255,255,0.88)",
    padding: 16
  },
  title: {
    margin: 0,
    fontSize: 12,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    fontWeight: 800,
    color: "#64748b"
  },
  subtitle: {
    margin: "8px 0 0",
    fontSize: 14,
    lineHeight: 1.45,
    color: "#475569"
  },
  content: {
    display: "grid",
    gap: 10,
    marginTop: 12
  }
}
