import type { CSSProperties } from "react"

export function LoadingState() {
  return (
    <div style={styles.wrap}>
      <div style={styles.barTrack}>
        <div style={styles.barFill} />
      </div>
      <p style={styles.label}>Preparing the review surface…</p>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    display: "grid",
    gap: 12
  },
  barTrack: {
    height: 10,
    borderRadius: 999,
    background: "#e2e8f0",
    overflow: "hidden"
  },
  barFill: {
    width: "58%",
    height: "100%",
    borderRadius: 999,
    background: "linear-gradient(90deg, #818cf8, #4f46e5)"
  },
  label: {
    margin: 0,
    color: "#475569",
    fontSize: 15
  }
}
