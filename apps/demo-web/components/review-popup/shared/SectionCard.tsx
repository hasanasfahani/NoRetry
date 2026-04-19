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
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(8, 15, 32, 0.56)",
    padding: 16,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)"
  },
  title: {
    margin: 0,
    fontSize: 12,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    fontWeight: 800,
    color: "rgba(219, 232, 255, 0.74)"
  },
  subtitle: {
    margin: "8px 0 0",
    fontSize: 14,
    lineHeight: 1.45,
    color: "rgba(226, 235, 255, 0.72)"
  },
  content: {
    display: "grid",
    gap: 10,
    marginTop: 12
  }
}
