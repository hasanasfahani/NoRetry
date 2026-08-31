import type { CSSProperties } from "react"
import {
  WORKFLOW_STAGE_LABELS,
  workflowStageIndex,
  workflowStateTone,
  type ReviewWorkflowState
} from "../../../lib/review/workflow-state"

type WorkflowProgressProps = {
  state: ReviewWorkflowState
}

export function WorkflowProgress({ state }: WorkflowProgressProps) {
  const currentIndex = workflowStageIndex(state)
  const tone = workflowStateTone(state)
  const accent = toneStyles[tone]

  return (
    <div style={styles.wrap}>
      {WORKFLOW_STAGE_LABELS.map((label, index) => {
        const phase =
          state === "blocked" && index === currentIndex
            ? "blocked"
            : currentIndex !== null && index < currentIndex
              ? "complete"
              : currentIndex !== null && index === currentIndex
                ? "current"
                : "upcoming"

        const phaseStyle = phaseStyles[phase]

        return (
          <span
            key={label}
            style={{
              ...styles.pill,
              background: phase === "current" || phase === "blocked" ? accent.bg : phaseStyle.bg,
              color: phase === "current" || phase === "blocked" ? accent.fg : phaseStyle.fg,
              borderColor: phase === "current" || phase === "blocked" ? accent.border : phaseStyle.border
            }}
          >
            {label}
          </span>
        )
      })}
    </div>
  )
}

const toneStyles = {
  neutral: { bg: "rgba(15,23,42,0.72)", fg: "#cbd5e1", border: "rgba(148,163,184,0.28)" },
  success: { bg: "rgba(37,99,235,0.3)", fg: "#dbeafe", border: "rgba(96,165,250,0.58)" },
  warning: { bg: "rgba(180,83,9,0.2)", fg: "#fed7aa", border: "rgba(251,146,60,0.42)" },
  danger: { bg: "rgba(127,29,29,0.28)", fg: "#fecaca", border: "rgba(248,113,113,0.42)" },
  info: { bg: "rgba(37,99,235,0.36)", fg: "#dbeafe", border: "rgba(96,165,250,0.62)" }
} as const

const phaseStyles = {
  complete: { bg: "rgba(30,64,175,0.22)", fg: "#bfdbfe", border: "rgba(59,130,246,0.42)" },
  current: toneStyles.info,
  blocked: toneStyles.danger,
  upcoming: { bg: "rgba(15,23,42,0.58)", fg: "#94a3b8", border: "rgba(148,163,184,0.22)" }
} as const

const styles: Record<string, CSSProperties> = {
  wrap: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10
  },
  pill: {
    borderRadius: 999,
    borderStyle: "solid",
    borderWidth: 1,
    padding: "7px 12px",
    fontSize: 12,
    fontWeight: 850,
    letterSpacing: "0.02em",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 18px rgba(2,6,23,0.22)"
  }
}
