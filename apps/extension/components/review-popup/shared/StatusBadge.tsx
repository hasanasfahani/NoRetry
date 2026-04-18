import type { CSSProperties } from "react"
import type { PopupTone } from "./types"

type StatusBadgeProps = {
  label: string
  tone?: PopupTone
}

const toneMap: Record<PopupTone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: "#e2e8f0", fg: "#475569", border: "rgba(71,85,105,0.16)" },
  success: { bg: "#dcfce7", fg: "#166534", border: "rgba(22,101,52,0.16)" },
  warning: { bg: "#fef3c7", fg: "#b45309", border: "rgba(180,83,9,0.16)" },
  danger: { bg: "#fee2e2", fg: "#b91c1c", border: "rgba(185,28,28,0.16)" },
  info: { bg: "#e0f0ff", fg: "#0766fe", border: "rgba(7,102,254,0.16)" }
}

export function StatusBadge({ label, tone = "neutral" }: StatusBadgeProps) {
  const activeTone = toneMap[tone]

  return (
    <span
      style={{
        ...styles.badge,
        background: activeTone.bg,
        color: activeTone.fg,
        borderColor: activeTone.border
      }}
    >
      {label}
    </span>
  )
}

const styles: Record<string, CSSProperties> = {
  badge: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    borderStyle: "solid",
    borderWidth: 1,
    fontSize: 13,
    fontWeight: 800,
    padding: "8px 14px"
  }
}
