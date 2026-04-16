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
          <div style={styles.titleWrap}>
            <ReviewPopupBrand />
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

function ReviewPopupBrand() {
  return (
    <div style={styles.brandRow} aria-label="reeva AI">
      <svg viewBox="0 0 1024 1024" style={styles.brandIcon} aria-hidden="true">
        <circle cx="512" cy="512" r="305" fill="none" stroke="#1E6DEB" strokeWidth="38" />
        <circle cx="512" cy="512" r="228" fill="none" stroke="#1E6DEB" strokeWidth="34" />
        <circle cx="512" cy="512" r="153" fill="none" stroke="#1E6DEB" strokeWidth="30" />
        <circle cx="512" cy="512" r="85" fill="none" stroke="#1E6DEB" strokeWidth="26" />
        <circle cx="512" cy="512" r="28" fill="#1E6DEB" />
        <path d="M452 186L512 154L572 186L540 236H484L452 186Z" fill="#ffffff" />
      </svg>
      <span style={styles.brandWordmark}>reeva AI</span>
    </div>
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
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
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
  titleWrap: {
    display: "grid",
    gap: 10
  },
  brandRow: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10
  },
  brandIcon: {
    width: 34,
    height: 34,
    display: "block",
    flex: "0 0 auto"
  },
  brandWordmark: {
    fontSize: 20,
    lineHeight: 1,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: "#0f172a"
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
