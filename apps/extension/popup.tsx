import { useEffect, useState, type CSSProperties } from "react"
import type { SessionSummary } from "@prompt-optimizer/shared"
import { getSessionSummary, resetOnboardingState, savePopupArtifactSnapshot } from "./lib/storage"

export default function Popup() {
  const [summary, setSummary] = useState<SessionSummary | null>(null)

  useEffect(() => {
    void getSessionSummary().then(async (nextSummary) => {
      setSummary(nextSummary)

      const shellText = [
        "NoRetry popup opened.",
        `Status: ${nextSummary?.lastProbableStatus ?? "UNKNOWN"}`,
        `Retries: ${nextSummary?.retryCount ?? 0}`,
        `Last intent: ${nextSummary?.lastIntent ?? "OTHER"}`
      ].join(" ")

      let hostHint = ""
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        hostHint = tabs[0]?.url ? new URL(tabs[0].url).hostname : ""
      } catch {
        hostHint = ""
      }

      await savePopupArtifactSnapshot({
        statusText: nextSummary?.lastProbableStatus ?? "UNKNOWN",
        retryCount: nextSummary?.retryCount ?? 0,
        lastIntent: nextSummary?.lastIntent ?? "OTHER",
        visibleText: shellText,
        authStateText: "",
        usageText: "",
        strengthenVisible: false,
        hostHint
      })
    })
  }, [])

  return (
    <main style={styles.shell}>
      <p style={styles.eyebrow}>NoRetry</p>
      <h1 style={styles.title}>AI prompt quality, minus the noise.</h1>
      <p style={styles.copy}>
        Before-send analysis is always cheap. After-send diagnosis only runs if visible failure signals appear or you ask
        for it.
      </p>
      <section style={styles.card}>
        <p style={styles.label}>Current session</p>
        <p style={styles.metric}>Status: {summary?.lastProbableStatus ?? "UNKNOWN"}</p>
        <p style={styles.metric}>Retries: {summary?.retryCount ?? 0}</p>
        <p style={styles.metric}>Last intent: {summary?.lastIntent ?? "OTHER"}</p>
      </section>
      <button style={styles.button} onClick={() => void resetOnboardingState()}>
        Reset onboarding
      </button>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  shell: {
    minWidth: 320,
    padding: 20,
    background: "linear-gradient(180deg, #faf5eb 0%, #f7fbf8 100%)",
    color: "#1f2937",
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  },
  eyebrow: {
    margin: 0,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "#166534"
  },
  title: {
    margin: "8px 0 12px",
    fontSize: 22,
    lineHeight: 1.15
  },
  copy: {
    margin: "0 0 16px",
    color: "#52606d",
    fontSize: 14,
    lineHeight: 1.5
  },
  card: {
    padding: 14,
    borderRadius: 18,
    border: "1px solid rgba(31,41,55,0.12)",
    background: "rgba(255,255,255,0.8)",
    marginBottom: 12
  },
  label: {
    margin: 0,
    fontSize: 12,
    color: "#166534",
    textTransform: "uppercase",
    letterSpacing: "0.08em"
  },
  metric: {
    margin: "8px 0 0",
    fontSize: 14
  },
  button: {
    border: "none",
    borderRadius: 999,
    padding: "10px 14px",
    background: "#1f2937",
    color: "white",
    cursor: "pointer"
  }
}
