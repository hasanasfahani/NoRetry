import type { CSSProperties, ReactNode } from "react"

type PopupShellProps = {
  open: boolean
  title: string
  eyebrow?: string
  children: ReactNode
  onClose: () => void
}

export function PopupShell(props: PopupShellProps) {
  if (!props.open) return null

  return (
    <>
      <button type="button" style={styles.scrim} onClick={props.onClose} aria-label="Close review popup" />
      <section style={styles.panel}>
        <div style={styles.header}>
          <div>
            {props.eyebrow ? <p style={styles.eyebrow}>{props.eyebrow}</p> : null}
            <h3 style={styles.title}>{props.title}</h3>
          </div>
          <button type="button" style={styles.closeButton} onClick={props.onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div style={styles.body}>{props.children}</div>
      </section>
    </>
  )
}

const styles: Record<string, CSSProperties> = {
  scrim: {
    position: "fixed",
    inset: 0,
    border: "none",
    background: "rgba(15, 23, 42, 0.14)",
    backdropFilter: "blur(2px)",
    zIndex: 2147483644,
    cursor: "default"
  },
  panel: {
    position: "fixed",
    top: 84,
    right: 28,
    width: 420,
    maxWidth: "calc(100vw - 32px)",
    maxHeight: "calc(100vh - 112px)",
    overflow: "auto",
    borderRadius: 28,
    border: "1px solid rgba(148, 163, 184, 0.22)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.98))",
    boxShadow: "0 32px 80px rgba(15, 23, 42, 0.18)",
    padding: 22,
    zIndex: 2147483645
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 18
  },
  eyebrow: {
    margin: 0,
    fontSize: 12,
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    color: "#64748b",
    fontWeight: 700
  },
  title: {
    margin: "6px 0 0",
    fontSize: 28,
    lineHeight: 1.05,
    color: "#0f172a"
  },
  closeButton: {
    border: "none",
    background: "transparent",
    color: "#64748b",
    fontSize: 32,
    lineHeight: 1,
    padding: 0,
    cursor: "pointer"
  },
  body: {
    display: "grid",
    gap: 14
  }
}
