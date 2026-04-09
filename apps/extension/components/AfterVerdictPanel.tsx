import type { CSSProperties } from "react"
import type { AfterAnalysisResult } from "@prompt-optimizer/shared"

type AfterVerdictPanelProps = {
  verdict: AfterAnalysisResult
  isEvaluating: boolean
  onCopyNextPrompt: () => void
  onRunDeepAnalysis: () => void
  onClose: () => void
}

function toneForStatus(status: AfterAnalysisResult["status"]) {
  switch (status) {
    case "SUCCESS":
    case "LIKELY_SUCCESS":
      return { badgeBg: "#dcfce7", badgeFg: "#166534", border: "rgba(22,101,52,0.14)" }
    case "FAILED":
    case "WRONG_DIRECTION":
      return { badgeBg: "#fee2e2", badgeFg: "#b91c1c", border: "rgba(185,28,28,0.14)" }
    case "PARTIAL":
      return { badgeBg: "#fef3c7", badgeFg: "#b45309", border: "rgba(180,83,9,0.16)" }
    default:
      return { badgeBg: "#e2e8f0", badgeFg: "#475569", border: "rgba(71,85,105,0.16)" }
  }
}

function depthLabel(depth: AfterAnalysisResult["inspection_depth"]) {
  switch (depth) {
    case "targeted_code":
      return "Deep code review"
    case "targeted_text":
      return "Deep answer review"
    default:
      return "Quick summary review"
  }
}

const FRIENDLY_CHECK_LABELS: Record<string, string> = {
  weight_loss: "Weight loss goal",
  steps: "Quick prep steps",
  nutrition: "Basic nutrition details",
  time_under_15: "Under 15 minutes",
  ingredients: "Ingredients list",
  vegetarian: "Vegetarian fit",
  time_under_15_minutes: "Under 15 minutes"
}

function humanizeChecklistLabel(value: string) {
  const normalized = value.trim().toLowerCase()
  if (FRIENDLY_CHECK_LABELS[normalized]) return FRIENDLY_CHECK_LABELS[normalized]
  if (/^the answer did not clearly/i.test(value)) {
    return value
      .replace(/^the answer did not clearly\s+/i, "")
      .replace(/\.$/, "")
      .replace(/\bshow that the recipe stays\b/i, "")
      .replace(/\bshow the recipe can be made in about\b/i, "")
      .replace(/\binclude an?\b/i, "")
      .replace(/\binclude\b/i, "")
      .replace(/\bexplain why the recipe fits a\b/i, "")
      .replace(/\bgoal\b/i, "goal")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^./, (char) => char.toUpperCase())
  }
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function canonicalChecklistKey(value: string) {
  return humanizeChecklistLabel(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function extractCheckedDetails(notes: string[]) {
  const checkedNote = notes.find((note) => note.toLowerCase().startsWith("checked requested details:"))
  if (!checkedNote) return []

  const [, rawItems = ""] = checkedNote.split(":", 2)
  return rawItems
    .replace(/\.$/, "")
    .split(",")
    .map((item) => humanizeChecklistLabel(item))
    .filter(Boolean)
}

export function AfterVerdictPanel(props: AfterVerdictPanelProps) {
  const tone = toneForStatus(props.verdict.status)
  const canCopyNextPrompt = props.verdict.next_prompt.trim().length > 0
  const canDeepAnalyze =
    !props.isEvaluating &&
    props.verdict.confidence !== "high" &&
    props.verdict.inspection_depth === "summary_only"
  const summarySentence =
    props.verdict.findings.find((item) => item.trim().length > 0) ||
    "NoRetry reviewed the answer against your request."
  const coveredItems = Array.from(
    new Set([
      ...extractCheckedDetails(props.verdict.stage_2.analysis_notes),
      ...props.verdict.stage_2.addressed_criteria.map((item) => humanizeChecklistLabel(item))
    ])
  )
  const coveredKeys = new Set(coveredItems.map((item) => canonicalChecklistKey(item)))
  const unresolvedItems = props.verdict.issues
    .slice(0, 4)
    .map((item) => humanizeChecklistLabel(item))
    .filter((item) => !coveredKeys.has(canonicalChecklistKey(item)))
  const unresolvedPrefix = props.verdict.inspection_depth === "summary_only" ? "(not sure)" : "🚫"

  return (
    <>
      <button type="button" style={styles.scrim} onClick={props.onClose} aria-label="Close verdict panel" />
      <section style={styles.panel(tone.border)}>
        <div style={styles.header}>
          <div>
            <p style={styles.eyebrow}>After response</p>
            <span style={styles.badge(tone.badgeBg, tone.badgeFg)}>{props.verdict.status}</span>
          </div>
          <button type="button" style={styles.closeButton} onClick={props.onClose} aria-label="Close verdict panel">
            x
          </button>
        </div>

        <div style={styles.block}>
          <p style={styles.blockTitle}>Analysis Summary</p>
          <p style={styles.summarySentence}>{summarySentence}</p>
        </div>

        {coveredItems.length || unresolvedItems.length ? (
          <div style={styles.block}>
            <ul style={styles.list}>
              {coveredItems.map((item) => (
                <li key={`covered-${item}`} style={styles.listItem}>
                  <span style={styles.leadingBullet}>•</span>
                  <span style={styles.listText}>
                    {item}
                    <span style={styles.inlineMarker}> ✅</span>
                  </span>
                </li>
              ))}
              {unresolvedItems.map((item) => (
                <li key={`unresolved-${item}`} style={styles.listItem}>
                  <span style={styles.leadingBullet}>•</span>
                  <span style={styles.listText}>
                    {item}
                    <span style={styles.inlineMarker}> {unresolvedPrefix}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div style={styles.footer}>
          <div style={styles.confidenceBlock}>
            <p style={styles.confidence}>Confidence: {props.verdict.confidence}</p>
            <p style={styles.reviewDepth}>{depthLabel(props.verdict.inspection_depth)}</p>
            {props.verdict.confidence_reason ? (
              <p style={styles.confidenceReason}>{props.verdict.confidence_reason}</p>
            ) : null}
          </div>
          <div style={styles.actions}>
            {canDeepAnalyze ? (
              <button
                type="button"
                style={styles.deepButton}
                onClick={props.onRunDeepAnalysis}
              >
                Deep Analyze
              </button>
            ) : null}
            <button
              type="button"
              style={styles.copyButton}
              onClick={props.onCopyNextPrompt}
              disabled={props.isEvaluating || !canCopyNextPrompt}
            >
              {props.isEvaluating ? "Checking..." : canCopyNextPrompt ? "Copy Next Prompt" : "No Prompt Yet"}
            </button>
          </div>
        </div>
      </section>
    </>
  )
}

const styles = {
  scrim: {
    position: "fixed",
    inset: 0,
    border: "none",
    background: "rgba(15,23,42,0.18)",
    cursor: "pointer",
    zIndex: 2147483645
  } as CSSProperties,
  panel: (border: string): CSSProperties => ({
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "min(520px, calc(100vw - 32px))",
    maxHeight: "min(70vh, 680px)",
    overflowY: "auto",
    zIndex: 2147483646,
    padding: 18,
    borderRadius: 22,
    background: "rgba(255,255,255,0.98)",
    border: `1px solid ${border}`,
    boxShadow: "0 24px 64px rgba(15,23,42,0.18)",
    backdropFilter: "blur(12px)"
  }),
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10
  } as CSSProperties,
  eyebrow: {
    margin: 0,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#64748b"
  } as CSSProperties,
  badge: (bg: string, fg: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    background: bg,
    color: fg,
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.04em",
    marginTop: 6
  }),
  closeButton: {
    border: "none",
    background: "transparent",
    color: "#64748b",
    fontSize: 16,
    cursor: "pointer",
    padding: 2,
    lineHeight: 1
  } as CSSProperties,
  block: {
    marginBottom: 10
  } as CSSProperties,
  blockTitle: {
    margin: "0 0 6px",
    fontSize: 12,
    fontWeight: 800,
    color: "#0f172a"
  } as CSSProperties,
  summarySentence: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.45,
    color: "#334155"
  } as CSSProperties,
  lineItem: {
    margin: "0 0 6px",
    fontSize: 12,
    lineHeight: 1.45,
    color: "#334155"
  } as CSSProperties,
  list: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 8
  } as CSSProperties,
  listItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    fontSize: 12,
    lineHeight: 1.45,
    color: "#334155"
  } as CSSProperties,
  leadingBullet: {
    color: "#64748b",
    lineHeight: 1.45
  } as CSSProperties,
  listText: {
    flex: 1,
    minWidth: 0
  } as CSSProperties,
  inlineMarker: {
    color: "#334155",
    fontWeight: 700,
    whiteSpace: "nowrap"
  } as CSSProperties,
  footer: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 10
  } as CSSProperties,
  confidenceBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    maxWidth: "65%"
  } as CSSProperties,
  confidence: {
    margin: 0,
    fontSize: 12,
    color: "#64748b"
  } as CSSProperties,
  reviewDepth: {
    margin: 0,
    fontSize: 11,
    fontWeight: 700,
    color: "#334155"
  } as CSSProperties,
  confidenceReason: {
    margin: 0,
    fontSize: 11,
    lineHeight: 1.45,
    color: "#475569"
  } as CSSProperties,
  actions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "flex-end"
  } as CSSProperties,
  deepButton: {
    border: "1px solid rgba(99,102,241,0.25)",
    borderRadius: 999,
    background: "rgba(99,102,241,0.1)",
    color: "#4338ca",
    padding: "10px 14px",
    fontWeight: 700,
    cursor: "pointer"
  } as CSSProperties,
  copyButton: {
    border: "none",
    borderRadius: 999,
    background: "#0f172a",
    color: "#fff",
    padding: "10px 14px",
    fontWeight: 700,
    cursor: "pointer"
  } as CSSProperties
}
