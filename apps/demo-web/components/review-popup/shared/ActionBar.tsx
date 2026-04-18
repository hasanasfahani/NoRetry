import type { CSSProperties } from "react"
import type { PopupAction } from "./types"

type ActionBarProps = {
  actions: PopupAction[]
}

export function ActionBar(props: ActionBarProps) {
  if (!props.actions.length) return null

  return (
    <div style={styles.row}>
      {props.actions.map((action) => (
        <button
          key={action.id}
          type="button"
          disabled={action.disabled}
          style={buttonStyle(action.kind ?? "secondary", Boolean(action.disabled))}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}

function buttonStyle(kind: PopupAction["kind"], disabled: boolean): CSSProperties {
  const shared: CSSProperties = {
    borderRadius: 999,
    padding: "11px 16px",
    fontSize: 14,
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1
  }

  if (kind === "primary") {
    return {
      ...shared,
      border: "1px solid rgba(7, 102, 254, 0.2)",
      background: "#0766fe",
      color: "#ffffff"
    }
  }

  if (kind === "ghost") {
    return {
      ...shared,
      border: "none",
      background: "transparent",
      color: "#475569",
      paddingInline: 4
    }
  }

  return {
    ...shared,
    border: "1px solid rgba(148, 163, 184, 0.28)",
    background: "#ffffff",
    color: "#0f172a"
  }
}

const styles: Record<string, CSSProperties> = {
  row: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10
  }
}
