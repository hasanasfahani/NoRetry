import { useState, type CSSProperties, type ReactNode } from "react"

type CollapsibleSectionProps = {
  title: string
  initiallyOpen?: boolean
  children: ReactNode
}

export function CollapsibleSection(props: CollapsibleSectionProps) {
  const [open, setOpen] = useState(Boolean(props.initiallyOpen))

  return (
    <section style={styles.wrap}>
      <button type="button" style={styles.trigger} onClick={() => setOpen((value) => !value)}>
        <span>{props.title}</span>
        <span style={styles.chevron(open)}>{open ? "−" : "+"}</span>
      </button>
      {open ? <div style={styles.content}>{props.children}</div> : null}
    </section>
  )
}

const styles = {
  wrap: {
    borderTop: "1px solid rgba(226, 232, 240, 0.9)",
    paddingTop: 12
  } satisfies CSSProperties,
  trigger: {
    width: "100%",
    border: "none",
    background: "transparent",
    padding: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    color: "#0766fe",
    fontSize: 16,
    fontWeight: 800,
    cursor: "pointer"
  } satisfies CSSProperties,
  chevron: (open: boolean) =>
    ({
      color: "#64748b",
      fontSize: 20,
      transform: open ? "none" : "translateY(-1px)"
    }) satisfies CSSProperties,
  content: {
    display: "grid",
    gap: 10,
    paddingTop: 14
  } satisfies CSSProperties
}
