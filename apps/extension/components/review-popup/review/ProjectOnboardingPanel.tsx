import type { CSSProperties } from "react"

type ProjectOnboardingPanelProps = {
  projectLabel: string
  onChooseInProgress: () => void
  onChooseStartingNow: () => void
}

export function ProjectOnboardingPanel(props: ProjectOnboardingPanelProps) {
  return (
    <div style={styles.layout}>
      <div style={styles.hero}>
        <p style={styles.eyebrow}>Project setup</p>
        <p style={styles.title}>How are you using this project?</p>
      </div>

      <button type="button" style={styles.choiceCard} onClick={props.onChooseInProgress}>
        <div style={styles.choiceCopy}>
          <p style={styles.choiceTitle}>Already in progress</p>
        </div>
        <span style={styles.choiceAction}>Use Project Context</span>
      </button>

      <button type="button" style={styles.choiceCard} onClick={props.onChooseStartingNow}>
        <div style={styles.choiceCopy}>
          <p style={styles.choiceTitle}>Just getting started</p>
        </div>
        <span style={styles.choiceAction}>Open Project Planning</span>
      </button>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  layout: {
    display: "grid",
    gap: 16
  },
  hero: {
    display: "grid",
    gap: 8
  },
  eyebrow: {
    margin: 0,
    fontSize: 12,
    letterSpacing: "0.22em",
    textTransform: "uppercase",
    color: "#64748b",
    fontWeight: 700
  },
  title: {
    margin: 0,
    fontSize: 22,
    lineHeight: 1.15,
    color: "#0f172a",
    fontWeight: 800
  },
  choiceCard: {
    display: "grid",
    gap: 12,
    width: "100%",
    borderRadius: 24,
    border: "1px solid rgba(148, 163, 184, 0.22)",
    background: "linear-gradient(180deg, rgba(239,246,255,0.72), rgba(255,255,255,0.94))",
    padding: "20px 18px",
    textAlign: "left",
    cursor: "pointer",
    boxShadow: "0 12px 32px rgba(15, 23, 42, 0.05)"
  },
  choiceCopy: {
    display: "grid",
    gap: 6
  },
  choiceTitle: {
    margin: 0,
    fontSize: 18,
    lineHeight: 1.2,
    color: "#0f172a",
    fontWeight: 800
  },
  choiceAction: {
    justifySelf: "start",
    borderRadius: 999,
    border: "1px solid rgba(7,102,254,0.22)",
    background: "rgba(7,102,254,0.08)",
    padding: "8px 12px",
    fontSize: 14,
    fontWeight: 850,
    color: "#0766fe"
  }
}
