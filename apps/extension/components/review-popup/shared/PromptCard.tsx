import { useEffect, useRef, useState, type CSSProperties } from "react"

type PromptCardProps = {
  label: string
  prompt: string
  note?: string
  action?: {
    label: string
    disabled?: boolean
    onClick: () => void
    feedbackMessage?: string | null
    feedbackTone?: "success" | "error"
  }
}

export function PromptCard(props: PromptCardProps) {
  const [isPressed, setIsPressed] = useState(false)
  const pressTimeoutRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (pressTimeoutRef.current) window.clearTimeout(pressTimeoutRef.current)
    },
    []
  )

  function handleActionClick() {
    setIsPressed(true)
    if (pressTimeoutRef.current) window.clearTimeout(pressTimeoutRef.current)
    pressTimeoutRef.current = window.setTimeout(() => {
      setIsPressed(false)
      pressTimeoutRef.current = null
    }, 260)
    props.action?.onClick()
  }

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <p style={styles.label}>{props.label}</p>
        {props.action ? (
          <div style={styles.actionCluster}>
            <button
              type="button"
              disabled={props.action.disabled}
              style={actionButtonStyle(
                Boolean(props.action.disabled),
                isPressed,
                props.action.feedbackTone === "success"
              )}
              onClick={handleActionClick}
            >
              {props.action.feedbackTone === "success" ? "Copied" : props.action.label}
            </button>
            {props.action.feedbackMessage ? (
              <span
                role="status"
                aria-live="polite"
                style={feedbackStyle(props.action.feedbackTone ?? "success")}
              >
                {props.action.feedbackMessage}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <pre style={styles.prompt}>{props.prompt}</pre>
      {props.note ? <p style={styles.note}>{props.note}</p> : null}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  card: {
    borderRadius: 18,
    background: "#0f172a",
    color: "#e2e8f0",
    padding: 16,
    display: "grid",
    gap: 10,
    minWidth: 0,
    overflow: "hidden"
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap"
  },
  label: {
    margin: 0,
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: "#76b2ff"
  },
  actionCluster: {
    display: "grid",
    justifyItems: "end",
    gap: 7,
    maxWidth: 320
  },
  prompt: {
    margin: 0,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 13,
    lineHeight: 1.55,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    wordBreak: "break-word"
  },
  note: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: "#cbd5e1"
  }
}

function actionButtonStyle(disabled: boolean, pressed: boolean, copied: boolean): CSSProperties {
  return {
    border: "1px solid rgba(96,165,250,0.34)",
    borderRadius: 999,
    background: copied ? "#15803d" : "linear-gradient(135deg, #0b6bff, #3b82f6)",
    color: "#ffffff",
    padding: "8px 12px",
    fontSize: 12,
    lineHeight: 1.1,
    fontWeight: 850,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    maxWidth: "100%",
    whiteSpace: "normal",
    overflowWrap: "anywhere",
    transform: pressed ? "scale(0.94)" : "scale(1)",
    transition: "transform 160ms ease, background-color 180ms ease, box-shadow 180ms ease",
    boxShadow: pressed ? "0 0 0 4px rgba(96,165,250,0.18)" : "none"
  }
}

function feedbackStyle(tone: "success" | "error"): CSSProperties {
  return {
    color: tone === "success" ? "#86efac" : "#fca5a5",
    fontSize: 12,
    lineHeight: 1.4,
    fontWeight: 750,
    textAlign: "right"
  }
}
