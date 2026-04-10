import type { CSSProperties } from "react"
import type { AfterAnalysisResult } from "@prompt-optimizer/shared"
import type { ClarificationQuestion } from "@prompt-optimizer/shared/src/schemas"

type AfterVerdictPanelProps = {
  verdict: AfterAnalysisResult
  isEvaluating: boolean
  isDeepAnalyzing: boolean
  codeAnalysisMode: "quick" | "deep"
  nextStepStarted: boolean
  nextQuestions: ClarificationQuestion[]
  nextAnswerState: Record<string, string>
  nextOtherAnswerState: Record<string, string>
  activeNextQuestionIndex: number
  isAddingNextQuestions: boolean
  isGeneratingNextPrompt: boolean
  nextPromptDraft: string
  nextPromptReady: boolean
  onRunDeepAnalysis: () => void
  onSelectCodeAnalysisMode: (mode: "quick" | "deep") => void
  onStartNextStep: () => void
  onAddNextQuestions: () => void
  onNextAnswerChange: (question: ClarificationQuestion, value: string) => void
  onNextOtherAnswerChange: (question: ClarificationQuestion, value: string) => void
  onNextQuestionIndexChange: (index: number) => void
  onAdvanceNextQuestion: () => void
  onNextPromptDraftChange: (value: string) => void
  onGenerateNextPrompt: () => void
  onSubmitNextPrompt: () => void
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

function LightningPulseIcon() {
  return (
    <svg viewBox="0 0 24 24" style={styles.pulseIcon} aria-hidden="true">
      <defs>
        <linearGradient id="afterPulseBolt" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      <path
        d="M13.2 2.6L6.7 12.1h4.2L9.8 21.4l7.5-10.2H13l.2-8.6z"
        fill="url(#afterPulseBolt)"
      />
      <path
        d="M13.2 2.6L6.7 12.1h4.2L9.8 21.4l7.5-10.2H13l.2-8.6z"
        fill="none"
        stroke="rgba(79,70,229,0.22)"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
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
  const otherOption = "Other"
  const tone = toneForStatus(props.verdict.status)
  const isCodeAnswer =
    props.verdict.response_summary.has_code_blocks || props.verdict.response_summary.mentioned_files.length > 0
  const showDeepAnalyze =
    !props.isEvaluating &&
    !isCodeAnswer &&
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
  const activeNextQuestion = props.nextQuestions[props.activeNextQuestionIndex] ?? null
  const answeredNextCount = props.nextQuestions.filter((question) => {
    const value = props.nextAnswerState[question.id]?.trim()
    const otherValue = props.nextOtherAnswerState[question.id]?.trim()
    return Boolean(value) && (value !== otherOption || Boolean(otherValue))
  }).length
  const canGenerateNextPrompt = answeredNextCount > 0 && !props.isGeneratingNextPrompt
  const activeNextQuestionUsesOther =
    activeNextQuestion != null && props.nextAnswerState[activeNextQuestion.id] === otherOption
  const showStartNextStep = !props.nextStepStarted

  return (
    <>
      <style>
        {`
          @keyframes afterVerdictPulse {
            0% { transform: scale(0.9); opacity: 0.72; box-shadow: 0 0 0 0 rgba(99,102,241,0.28); }
            50% { transform: scale(1.06); opacity: 1; box-shadow: 0 0 0 7px rgba(99,102,241,0.08); }
            100% { transform: scale(0.9); opacity: 0.72; box-shadow: 0 0 0 0 rgba(99,102,241,0); }
          }
          @keyframes afterVerdictDotBlink {
            0%, 20% { opacity: 0.2; }
            50% { opacity: 1; }
            100% { opacity: 0.2; }
          }
        `}
      </style>
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
          <div style={styles.summaryRow}>
            <p style={styles.summarySentence}>
              {summarySentence}
              {props.isEvaluating && !props.isDeepAnalyzing ? (
                <span style={styles.inlinePulseWrap}>
                  <span style={styles.pulseBadge}>
                    <span style={styles.pulseInner}>
                      <LightningPulseIcon />
                    </span>
                  </span>
                </span>
              ) : null}
            </p>
          </div>
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
            <p style={styles.blockTitle}>Analysis Status</p>
            <p style={styles.statusMeta}>
              <span>Confidence: {props.verdict.confidence}</span>
              <span>Review: {props.verdict.inspection_depth === "summary_only" ? "quick" : "deep"}</span>
            </p>
          </div>
          <div style={styles.actions}>
            {isCodeAnswer ? (
              <div style={styles.modeToggle}>
                <button
                  type="button"
                  style={styles.modeButton(props.codeAnalysisMode === "quick")}
                  onClick={() => props.onSelectCodeAnalysisMode("quick")}
                  disabled={props.isEvaluating || props.isDeepAnalyzing}
                >
                  Quick
                </button>
                <button
                  type="button"
                  style={styles.modeButton(props.codeAnalysisMode === "deep")}
                  onClick={() => props.onSelectCodeAnalysisMode("deep")}
                  disabled={props.isEvaluating || props.isDeepAnalyzing}
                >
                  {props.isDeepAnalyzing && props.codeAnalysisMode === "deep" ? "Digging deeper..." : "Deep"}
                </button>
              </div>
            ) : null}
            {showDeepAnalyze ? (
              <button
                type="button"
                style={styles.deepButton}
                onClick={props.onRunDeepAnalysis}
                disabled={props.isDeepAnalyzing}
              >
                {props.isDeepAnalyzing ? (
                  <span style={styles.loadingLabel}>
                    Digging deeper
                    <span style={styles.loadingDots} aria-hidden="true">
                      <span style={styles.loadingDot(0)}>.</span>
                      <span style={styles.loadingDot(0.2)}>.</span>
                      <span style={styles.loadingDot(0.4)}>.</span>
                    </span>
                  </span>
                ) : (
                  "Deep Analyze"
                )}
              </button>
            ) : null}
            {showStartNextStep ? (
              <button
                type="button"
                style={styles.copyButton}
                onClick={props.onStartNextStep}
                disabled={props.isEvaluating}
              >
                {props.isEvaluating ? "Analyzing..." : "Start Next Step"}
              </button>
            ) : null}
          </div>
        </div>

        {props.nextStepStarted ? (
          <div style={styles.nextStepSection}>
            <div style={styles.questionPanelHeader}>
              <div>
                <p style={styles.blockTitle}>Plan The Next Step</p>
                <p style={styles.progressCopy}>
                  {answeredNextCount} of {props.nextQuestions.length} answered
                </p>
              </div>
              <button
                type="button"
                style={styles.secondaryButton}
                onClick={props.onAddNextQuestions}
                disabled={props.isAddingNextQuestions}
              >
                {props.isAddingNextQuestions ? "Adding..." : "Add more questions"}
              </button>
            </div>

            {props.nextQuestions.length ? (
              <>
                <div style={styles.questionTabs}>
                  {props.nextQuestions.map((question, index) => (
                    <button
                      key={question.id}
                      type="button"
                      style={styles.questionTab(index === props.activeNextQuestionIndex, Boolean(props.nextAnswerState[question.id]?.trim()))}
                      onClick={() => props.onNextQuestionIndexChange(index)}
                    >
                      {index + 1}
                    </button>
                  ))}
                </div>

                {activeNextQuestion ? (
                  <div style={styles.questionCard}>
                    <p style={styles.questionLabel}>{activeNextQuestion.label}</p>
                    <p style={styles.questionHelper}>{activeNextQuestion.helper}</p>
                    <div style={styles.optionList}>
                      {[...activeNextQuestion.options.filter((option) => option !== otherOption), otherOption].map((option) => {
                        const selected = props.nextAnswerState[activeNextQuestion.id] === option
                        return (
                          <button
                            key={option}
                            type="button"
                            style={styles.optionButton(selected)}
                            onClick={() => props.onNextAnswerChange(activeNextQuestion, option)}
                          >
                            {option}
                          </button>
                        )
                      })}
                      {activeNextQuestionUsesOther ? (
                        <input
                          type="text"
                          style={styles.inlineInput}
                          value={props.nextOtherAnswerState[activeNextQuestion.id] ?? ""}
                          onChange={(event) => props.onNextOtherAnswerChange(activeNextQuestion, event.currentTarget.value)}
                          placeholder="Type your answer"
                        />
                      ) : null}
                    </div>
                    {activeNextQuestionUsesOther ? (
                      <div style={styles.manualAdvanceRow}>
                        <button
                          type="button"
                          style={styles.secondaryButton}
                          onClick={props.onAdvanceNextQuestion}
                          disabled={!(props.nextOtherAnswerState[activeNextQuestion.id] ?? "").trim()}
                        >
                          Next Question
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}

            {answeredNextCount > 0 ? (
              <button
                type="button"
                style={styles.primaryButton}
                onClick={props.onGenerateNextPrompt}
                disabled={!canGenerateNextPrompt}
              >
                {props.isGeneratingNextPrompt ? "Generating..." : "Generate Next Prompt"}
              </button>
            ) : null}

            {props.nextPromptReady ? (
              <div style={styles.draftCard}>
                <p style={styles.blockTitle}>Next Prompt</p>
                <textarea
                  value={props.nextPromptDraft}
                  onChange={(event) => props.onNextPromptDraftChange(event.target.value)}
                  style={styles.draftInput}
                />
                <button
                  type="button"
                  style={styles.copyButton}
                  onClick={props.onSubmitNextPrompt}
                  disabled={!props.nextPromptDraft.trim()}
                >
                  Submit Prompt
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
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
    color: "#334155",
    flex: 1,
    minWidth: 0
  } as CSSProperties,
  summaryRow: {
    display: "block"
  } as CSSProperties,
  pulseBadge: {
    display: "inline-flex",
    width: 28,
    height: 28,
    borderRadius: 999,
    background: "rgba(99,102,241,0.10)",
    border: "1px solid rgba(99,102,241,0.12)",
    justifyContent: "center",
    alignItems: "center",
    verticalAlign: "middle"
  } as CSSProperties,
  inlinePulseWrap: {
    display: "inline-flex",
    marginLeft: 8,
    verticalAlign: "middle"
  } as CSSProperties,
  pulseInner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 18,
    height: 18,
    borderRadius: 999,
    animation: "afterVerdictPulse 1.25s ease-in-out infinite"
  } as CSSProperties,
  pulseIcon: {
    width: 16,
    height: 16,
    flexShrink: 0
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
  statusMeta: {
    margin: 0,
    display: "flex",
    flexWrap: "wrap",
    gap: 12,
    fontSize: 12,
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
  nextStepSection: {
    marginTop: 14,
    paddingTop: 14,
    borderTop: "1px solid rgba(148,163,184,0.18)",
    display: "flex",
    flexDirection: "column",
    gap: 12
  } as CSSProperties,
  questionPanelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  } as CSSProperties,
  progressCopy: {
    margin: 0,
    fontSize: 11,
    color: "#64748b"
  } as CSSProperties,
  secondaryButton: {
    border: "1px solid rgba(99,102,241,0.18)",
    borderRadius: 999,
    background: "rgba(99,102,241,0.08)",
    color: "#4338ca",
    padding: "8px 12px",
    fontWeight: 700,
    cursor: "pointer"
  } as CSSProperties,
  questionTabs: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap"
  } as CSSProperties,
  questionTab: (active: boolean, answered: boolean): CSSProperties => ({
    border: active ? "1px solid rgba(99,102,241,0.25)" : "1px solid rgba(148,163,184,0.18)",
    background: active ? "rgba(99,102,241,0.12)" : answered ? "rgba(220,252,231,0.7)" : "#ffffff",
    color: active ? "#4338ca" : "#334155",
    width: 32,
    height: 32,
    borderRadius: 999,
    fontWeight: 700,
    cursor: "pointer"
  }),
  questionCard: {
    border: "1px solid rgba(148,163,184,0.18)",
    borderRadius: 18,
    padding: 14,
    background: "rgba(248,250,252,0.92)"
  } as CSSProperties,
  questionLabel: {
    margin: 0,
    fontSize: 13,
    fontWeight: 800,
    color: "#0f172a"
  } as CSSProperties,
  questionHelper: {
    margin: "6px 0 0",
    fontSize: 11,
    lineHeight: 1.45,
    color: "#64748b"
  } as CSSProperties,
  optionList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginTop: 12
  } as CSSProperties,
  inlineInput: {
    width: "100%",
    borderRadius: 12,
    border: "1px solid rgba(148,163,184,0.24)",
    padding: "10px 12px",
    fontSize: 12,
    color: "#0f172a",
    background: "#ffffff"
  } as CSSProperties,
  optionButton: (selected: boolean): CSSProperties => ({
    border: selected ? "1px solid rgba(99,102,241,0.28)" : "1px solid rgba(148,163,184,0.16)",
    borderRadius: 14,
    background: selected ? "rgba(99,102,241,0.12)" : "#ffffff",
    color: selected ? "#312e81" : "#334155",
    padding: "10px 12px",
    textAlign: "left",
    fontWeight: selected ? 700 : 500,
    cursor: "pointer"
  }),
  manualAdvanceRow: {
    display: "flex",
    justifyContent: "flex-end",
    marginTop: 12
  } as CSSProperties,
  primaryButton: {
    border: "none",
    borderRadius: 999,
    background: "#0f172a",
    color: "#ffffff",
    padding: "12px 16px",
    fontWeight: 800,
    cursor: "pointer",
    alignSelf: "flex-start"
  } as CSSProperties,
  draftCard: {
    border: "1px solid rgba(148,163,184,0.18)",
    borderRadius: 18,
    padding: 14,
    background: "#ffffff",
    display: "flex",
    flexDirection: "column",
    gap: 10
  } as CSSProperties,
  draftInput: {
    width: "100%",
    minHeight: 140,
    resize: "vertical",
    borderRadius: 14,
    border: "1px solid rgba(148,163,184,0.24)",
    padding: 12,
    fontSize: 12,
    lineHeight: 1.5,
    color: "#0f172a",
    background: "#f8fafc"
  } as CSSProperties,
  modeToggle: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    padding: 4,
    background: "#eef2ff",
    gap: 4
  } as CSSProperties,
  modeButton: (active: boolean): CSSProperties => ({
    border: "none",
    borderRadius: 999,
    background: active ? "#4338ca" : "transparent",
    color: active ? "#ffffff" : "#4338ca",
    padding: "8px 12px",
    fontWeight: 700,
    cursor: "pointer"
  }),
  deepButton: {
    border: "1px solid rgba(99,102,241,0.25)",
    borderRadius: 999,
    background: "rgba(99,102,241,0.1)",
    color: "#4338ca",
    padding: "10px 14px",
    fontWeight: 700,
    cursor: "pointer"
  } as CSSProperties,
  loadingLabel: {
    display: "inline-flex",
    alignItems: "center"
  } as CSSProperties,
  loadingDots: {
    display: "inline-flex",
    marginLeft: 2
  } as CSSProperties,
  loadingDot: (delay: number): CSSProperties => ({
    display: "inline-block",
    width: "0.32em",
    animation: "afterVerdictDotBlink 1.1s ease-in-out infinite",
    animationDelay: `${delay}s`
  }),
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
