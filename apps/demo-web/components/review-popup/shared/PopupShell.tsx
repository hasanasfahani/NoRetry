import { ReevaLogo } from "../../brand/ReevaLogo"
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
            {props.title.trim() ? <h3 style={styles.title}>{props.title}</h3> : null}
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
      <ReevaLogo width={148} height={38} />
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  scrim: {
    position: "fixed",
    inset: 0,
    border: "none",
    background: "rgba(4, 10, 24, 0.56)",
    backdropFilter: "blur(10px)",
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
    borderRadius: 32,
    border: "1px solid rgba(255, 255, 255, 0.14)",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.07) 100%)",
    boxShadow: "0 32px 80px rgba(0, 0, 0, 0.34)",
    padding: 22,
    zIndex: 2147483645,
    backdropFilter: "blur(20px)"
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
    marginBottom: 2
  },
  eyebrow: {
    margin: 0,
    fontSize: 12,
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    color: "rgba(219, 232, 255, 0.76)",
    fontWeight: 700
  },
  title: {
    margin: "6px 0 0",
    fontSize: 28,
    lineHeight: 1.05,
    color: "#f7fbff"
  },
  closeButton: {
    border: "none",
    background: "transparent",
    color: "rgba(226, 235, 255, 0.76)",
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
