import type { CSSProperties } from "react"
import type { PopupTone } from "./types"

type StatusBadgeProps = {
  label: string
  tone?: PopupTone
}

const toneMap: Record<PopupTone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: "rgba(255,255,255,0.08)", fg: "#dbe8ff", border: "rgba(255,255,255,0.12)" },
  success: { bg: "rgba(121,216,168,0.16)", fg: "#9ff0be", border: "rgba(121,216,168,0.22)" },
  warning: { bg: "rgba(255,211,108,0.14)", fg: "#ffd36c", border: "rgba(255,211,108,0.22)" },
  danger: { bg: "rgba(255,120,120,0.14)", fg: "#ff9f9f", border: "rgba(255,120,120,0.22)" },
  info: { bg: "rgba(7, 102, 254, 0.16)", fg: "#8bc4ff", border: "rgba(7,102,254,0.22)" }
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
