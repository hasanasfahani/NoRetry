import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from "react"
import type { AfterAnalysisResult } from "@prompt-optimizer/shared"
import type { ClarificationQuestion } from "@prompt-optimizer/shared/src/schemas"

type AfterVerdictPanelProps = {
  verdict: AfterAnalysisResult
  isEvaluating: boolean
  isDeepAnalyzing: boolean
  loadingProgress: { percent: number; label: string } | null
  codeAnalysisMode: "quick" | "deep"
  displayedReviewMode: "quick" | "deep"
  nextStepStarted: boolean
  planningGoal: string
  planningGoalNotice: string
  nextQuestionHistory: ClarificationQuestion[]
  nextQuestions: ClarificationQuestion[]
  nextAnswerState: Record<string, string>
  nextOtherAnswerState: Record<string, string>
  activeNextQuestionIndex: number
  isAddingNextQuestions: boolean
  isGeneratingNextPrompt: boolean
  nextPromptDraft: string
  nextPromptReady: boolean
  projectContextSetupActive: boolean
  projectContextReadyActive: boolean
  projectMemoryEnabled: boolean
  projectMemoryExists: boolean
  projectMemoryLabel: string
  projectMemoryDepth: "quick" | "deep"
  projectHandoffDraft: string
  isSavingProjectMemory: boolean
  suggestedDirectionChips: { id: string; label: string }[]
  activeSuggestionChipId: string | null
  hasUsedSuggestedDirection: boolean
  recentlyAnsweredQuestionId: string | null
  onRunDeepAnalysis: () => void
  onSelectCodeAnalysisMode: (mode: "quick" | "deep") => void
  onStartNextStep: () => void
  onPlanningGoalChange: (value: string) => void
  onSuggestedDirectionClick: (chipId: string) => void
  onBeginDecisionTree: () => void
  onSubmitPlanningGoalPrompt: () => void
  onNextAnswerChange: (question: ClarificationQuestion, value: string) => void
  onNextOtherAnswerChange: (question: ClarificationQuestion, value: string) => void
  onNextQuestionIndexChange: (index: number) => void
  onAdvanceNextQuestion: () => void
  onNextPromptDraftChange: (value: string) => void
  onGenerateNextPrompt: () => void
  onSubmitNextPrompt: () => void
  onProjectHandoffChange: (value: string) => void
  onProjectMemoryDepthChange: (value: "quick" | "deep") => void
  onCopyProjectContextRequest: () => void
  onSaveProjectMemory: () => void
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

function userFacingStatusLabel(status: AfterAnalysisResult["status"]) {
  switch (status) {
    case "SUCCESS":
      return "Looks Good"
    case "LIKELY_SUCCESS":
      return "Probably Good"
    case "PARTIAL":
      return "Needs More Work"
    case "FAILED":
      return "Didn't Work"
    case "WRONG_DIRECTION":
      return "Off Track"
    default:
      return "Needs Review"
  }
}

function toneForConfidence(confidence: AfterAnalysisResult["confidence"]) {
  switch (confidence) {
    case "high":
      return { bg: "#dcfce7", fg: "#166534", border: "rgba(22,101,52,0.16)" }
    case "medium":
      return { bg: "#fef3c7", fg: "#b45309", border: "rgba(180,83,9,0.16)" }
    default:
      return { bg: "#e2e8f0", fg: "#475569", border: "rgba(71,85,105,0.16)" }
  }
}

function userFacingEvidenceLabel(confidence: AfterAnalysisResult["confidence"]) {
  switch (confidence) {
    case "high":
      return "strong"
    case "medium":
      return "moderate"
    default:
      return "limited"
  }
}

function toneForReview(depth: AfterAnalysisResult["inspection_depth"]) {
  switch (depth) {
    case "targeted_code":
      return { bg: "#dbeafe", fg: "#1d4ed8", border: "rgba(29,78,216,0.16)", label: "deep" }
    case "targeted_text":
      return { bg: "#ede9fe", fg: "#6d28d9", border: "rgba(109,40,217,0.16)", label: "deep" }
    default:
      return { bg: "#f1f5f9", fg: "#475569", border: "rgba(71,85,105,0.14)", label: "quick" }
  }
}

function toneForDisplayedReview(
  displayedMode: "quick" | "deep",
  depth: AfterAnalysisResult["inspection_depth"]
) {
  if (displayedMode === "quick") {
    return { bg: "#f1f5f9", fg: "#475569", border: "rgba(71,85,105,0.14)", label: "quick" }
  }

  if (depth === "targeted_code") {
    return { bg: "#dbeafe", fg: "#1d4ed8", border: "rgba(29,78,216,0.16)", label: "deep" }
  }

  return { bg: "#ede9fe", fg: "#6d28d9", border: "rgba(109,40,217,0.16)", label: "deep" }
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

function QuestionTrailLoader() {
  return (
    <div style={styles.questionTrailLoader} aria-hidden="true">
      <span style={styles.questionTrailDot(0)} />
      <span style={styles.questionTrailDot(0.15)} />
      <span style={styles.questionTrailDot(0.3)} />
    </div>
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
  const trimmed = value.trim()
  if (!trimmed || /^solve:\s*$/i.test(trimmed)) {
    return "Solve the requested task"
  }
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
  if (/\s/.test(trimmed) && !trimmed.includes("_")) {
    return trimmed.replace(/\s+/g, " ").replace(/^./, (char) => char.toUpperCase())
  }
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function improvementLabel(answeredCount: number, isAddingNextQuestions: boolean, nextPromptReady: boolean) {
  if (nextPromptReady) return "Prompt ready"
  if (isAddingNextQuestions) return "Sharpening the next branch"
  if (answeredCount >= 4) return "Execution path clearer"
  if (answeredCount >= 3) return "Constraints captured"
  if (answeredCount >= 2) return "Output clarified"
  if (answeredCount >= 1) return "Scope narrowed"
  return "Direction set"
}

function isMeaningfulDeepEvidenceItem(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.length < 18) return false
  if (/^(fixed|working|updated|changed|done|resolved)\b/i.test(trimmed)) return false
  if (/^here is exactly what was wrong/i.test(trimmed)) return false
  if (/^the user'?s latest request$/i.test(trimmed)) return false
  return true
}

function isMeaningfulDeepAnalysisNote(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.length < 20) return false
  if (/^some acceptance criteria remain unverified/i.test(trimmed)) return false
  if (/^the answer appears to directly deliver the requested content/i.test(trimmed)) return false
  return true
}

export function AfterVerdictPanel(props: AfterVerdictPanelProps) {
  const otherOption = "Other"
  const tone = toneForStatus(props.verdict.status)
  const statusLabel = userFacingStatusLabel(props.verdict.status)
  const isInitialChecking =
    props.isEvaluating &&
    !props.isDeepAnalyzing &&
    props.verdict.findings.length === 1 &&
    props.verdict.findings[0] === "Checking the latest change."
  const hasRealReview =
    props.verdict.response_summary.response_length > 0 ||
    (props.verdict.acceptance_checklist?.length ?? 0) > 0
  const showModeToggle = !isInitialChecking && hasRealReview && !props.nextStepStarted
  const summarySentence =
    props.verdict.findings.find((item) => item.trim().length > 0) ||
    "NoRetry reviewed the answer against your request."
  const isPlannerOnlyState = !hasRealReview && props.nextStepStarted
  const checklistItems = (props.verdict.acceptance_checklist ?? []).map((item) => ({
    label: humanizeChecklistLabel(item.label),
    marker: item.status === "met" ? "✅" : item.status === "missed" ? "🚫" : "(not sure)"
  }))
  const confidenceTone = toneForConfidence(props.verdict.confidence)
  const evidenceLabel = userFacingEvidenceLabel(props.verdict.confidence)
  const activeReviewMode = props.displayedReviewMode
  const reviewTone = toneForDisplayedReview(activeReviewMode, props.verdict.inspection_depth)
  const deepReviewLimitedHint =
    activeReviewMode === "deep" && props.verdict.confidence === "low"
      ? props.verdict.confidence_reason || "Deep review ran, but the visible evidence is still limited."
      : ""
  const deepReviewEvidenceItems =
    activeReviewMode === "deep"
      ? Array.from(
          new Map(
            props.verdict.stage_1.claimed_evidence.map((item) => [item.trim().toLowerCase(), item.trim()])
          ).values()
        ).filter(isMeaningfulDeepEvidenceItem)
      : []
  const deepReviewAnalysisNotes =
    activeReviewMode === "deep"
      ? Array.from(
          new Map(
            props.verdict.stage_2.analysis_notes.map((item) => [item.trim().toLowerCase(), item.trim()])
          ).values()
        ).filter(isMeaningfulDeepAnalysisNote)
      : []
  const deepReviewEvidenceHint =
    activeReviewMode === "deep" && deepReviewAnalysisNotes.length
      ? `Deep review found: ${deepReviewAnalysisNotes.slice(0, 2).join(" • ")}`
      : activeReviewMode === "deep" && deepReviewEvidenceItems.length
      ? `Deep review inspected: ${deepReviewEvidenceItems.slice(0, 2).join(" • ")}`
      : ""
  const shouldShowLoadingProgress =
    Boolean(props.loadingProgress) && (props.isEvaluating || props.isDeepAnalyzing) && !isPlannerOnlyState
  const visibleQuestions = props.nextQuestionHistory.length ? props.nextQuestionHistory : props.nextQuestions
  const activeNextQuestion = visibleQuestions[props.activeNextQuestionIndex] ?? null
  const answeredNextCount = visibleQuestions.filter((question) => {
    const value = props.nextAnswerState[question.id]?.trim()
    const otherValue = props.nextOtherAnswerState[question.id]?.trim()
    return Boolean(value) && (value !== otherOption || Boolean(otherValue))
  }).length
  const canGenerateNextPrompt = answeredNextCount > 0 && !props.isGeneratingNextPrompt
  const activeNextQuestionUsesOther =
    activeNextQuestion != null && props.nextAnswerState[activeNextQuestion.id] === otherOption
  const showStartNextStep = !isInitialChecking && hasRealReview && !props.nextStepStarted
  const showPlanningGoalEntry = props.nextStepStarted && visibleQuestions.length === 0
  const hasStructuredPlanningDirection =
    props.hasUsedSuggestedDirection || /^\s*\d+\.\s/m.test(props.planningGoal)
  const originalPromptPreview =
    !hasRealReview && props.planningGoal.trim() ? props.planningGoal.trim() : ""
  const planningTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const nextStepSectionRef = useRef<HTMLDivElement | null>(null)
  const nextPromptSectionRef = useRef<HTMLDivElement | null>(null)
  const questionTabsRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [isDragActive, setIsDragActive] = useState(false)
  const improvement = improvementLabel(answeredNextCount, props.isAddingNextQuestions, props.nextPromptReady)

  async function readHandoffFile(file: File | null) {
    if (!file) return
    const text = await file.text()
    props.onProjectHandoffChange(text)
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragActive(false)
    const file = event.dataTransfer.files?.[0] ?? null
    await readHandoffFile(file)
  }

  useEffect(() => {
    if (!props.planningGoalNotice || !planningTextareaRef.current) return

    planningTextareaRef.current.scrollTop = planningTextareaRef.current.scrollHeight
    planningTextareaRef.current.focus()
    planningTextareaRef.current.setSelectionRange(
      planningTextareaRef.current.value.length,
      planningTextareaRef.current.value.length
    )
    planningTextareaRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [props.planningGoalNotice, props.planningGoal])

  useEffect(() => {
    if (!props.nextStepStarted || !nextStepSectionRef.current) return

    nextStepSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [props.nextStepStarted])

  useEffect(() => {
    if (!props.nextPromptReady || !nextPromptSectionRef.current) return

    nextPromptSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [props.nextPromptReady])

  useEffect(() => {
    if (!props.isAddingNextQuestions || !questionTabsRef.current) return

    questionTabsRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [props.isAddingNextQuestions])

  return (
    <>
      <style>
        {`
          [data-after-panel] button:not(:disabled) {
            transition: transform 140ms ease, box-shadow 160ms ease, filter 160ms ease, opacity 160ms ease;
          }
          [data-after-panel] button:not(:disabled):hover {
            filter: brightness(0.99);
          }
          [data-after-panel] button:not(:disabled):active {
            transform: translateY(1px) scale(0.985);
            box-shadow: inset 0 1px 2px rgba(15,23,42,0.12);
          }
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
          @keyframes afterQuestionTrailPulse {
            0%, 100% { transform: scale(0.72); opacity: 0.24; }
            50% { transform: scale(1); opacity: 1; }
          }
          @keyframes afterAnswerCelebrate {
            0% { transform: scale(0.96); box-shadow: 0 0 0 0 rgba(99,102,241,0.18); }
            45% { transform: scale(1.04); box-shadow: 0 0 0 8px rgba(99,102,241,0.12); }
            100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(99,102,241,0); }
          }
          @keyframes afterRewardFloat {
            0% { transform: translateY(0) scale(0.88); opacity: 0; }
            12% { transform: translateY(-4px) scale(1); opacity: 1; }
            72% { transform: translateY(-24px) scale(1); opacity: 1; }
            100% { transform: translateY(-34px) scale(0.96); opacity: 0; }
          }
        `}
      </style>
      <button type="button" style={styles.scrim} onClick={props.onClose} aria-label="Close verdict panel" />
      <section data-after-panel="true" style={styles.panel(tone.border)}>
        {props.projectContextSetupActive ? (
          <div style={styles.contextSetupSurface}>
            <div style={styles.header}>
              <div>
                <p style={styles.eyebrow}>After response</p>
                <span style={styles.badge("#ede9fe", "#6d28d9")}>Add Project Context</span>
              </div>
              <button type="button" style={styles.closeButton} onClick={props.onClose} aria-label="Close verdict panel">
                x
              </button>
            </div>

            <div style={styles.contextSetupIntro}>
              <p style={styles.contextSetupTitle}>Let’s ground this review before we judge your latest project answer.</p>
              <p style={styles.contextSetupBody}>
                Paste a structured Replit handoff once, and NoRetry will immediately return to your latest project answer
                and review it with the missing context.
              </p>
              <div style={styles.contextStatusRow}>
                <span style={styles.contextPill(props.projectMemoryExists)}>
                  {props.projectMemoryExists
                    ? props.projectMemoryDepth === "deep"
                      ? "Deep project memory ready"
                      : "Quick project memory ready"
                    : "Context needed first"}
                </span>
                {props.projectMemoryLabel ? <span style={styles.contextMeta}>{props.projectMemoryLabel}</span> : null}
              </div>
            </div>

            <div style={styles.contextChoiceRow}>
              <div
                style={styles.contextChoiceButton(props.projectMemoryDepth === "quick")}
                onClick={() => props.onProjectMemoryDepthChange("quick")}
              >
                <span style={styles.contextChoiceTitle}>Quick handoff</span>
                <span style={styles.contextChoiceBody}>Fastest setup. Great for getting unstuck quickly.</span>
                <button
                  type="button"
                  style={styles.contextChoiceAction}
                  onClick={(event) => {
                    event.stopPropagation()
                    props.onProjectMemoryDepthChange("quick")
                    props.onCopyProjectContextRequest()
                  }}
                >
                  Copy Request
                </button>
              </div>
              <div
                style={styles.contextChoiceButton(props.projectMemoryDepth === "deep")}
                onClick={() => props.onProjectMemoryDepthChange("deep")}
              >
                <span style={styles.contextChoiceTitle}>Deep handoff</span>
                <span style={styles.contextChoiceBody}>Richer project understanding for complex ongoing work.</span>
                <button
                  type="button"
                  style={styles.contextChoiceAction}
                  onClick={(event) => {
                    event.stopPropagation()
                    props.onProjectMemoryDepthChange("deep")
                    props.onCopyProjectContextRequest()
                  }}
                >
                  Copy Request
                </button>
              </div>
            </div>

            <div style={styles.contextCard}>
              <p style={styles.contextHelper}>
                {props.projectMemoryDepth === "deep"
                  ? "Copy the deep handoff request, ask Replit for a richer markdown file, then paste or drop that .md here. After you save it, NoRetry will resume the original review automatically."
                  : "Copy the quick handoff request, paste it into Replit, then paste the returned markdown handoff here. After you save it, NoRetry will resume the original review automatically."}
              </p>
              <div
                style={styles.dropZone(isDragActive)}
                onDragOver={(event) => {
                  event.preventDefault()
                  setIsDragActive(true)
                }}
                onDragLeave={() => setIsDragActive(false)}
                onDrop={(event) => void handleDrop(event)}
              >
                <p style={styles.dropZoneTitle}>
                  {props.projectMemoryDepth === "deep" ? "Drop the Replit .md handoff here" : "Paste the Replit handoff below"}
                </p>
                <p style={styles.dropZoneBody}>
                  {props.projectMemoryDepth === "deep"
                    ? "You can drag a markdown file here or paste its contents below."
                    : "You can also drag a markdown file here if Replit gives you one."}
                </p>
                <button
                  type="button"
                  style={styles.ghostButton}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose .md File
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,text/markdown,.txt"
                  style={styles.hiddenFileInput}
                  onChange={(event) => void readHandoffFile(event.currentTarget.files?.[0] ?? null)}
                />
              </div>
              <div style={styles.orDivider}>
                <span style={styles.orDividerLine} />
                <span style={styles.orDividerLabel}>Or Paste it Here</span>
                <span style={styles.orDividerLine} />
              </div>
              <textarea
                style={styles.contextTextarea}
                value={props.projectHandoffDraft}
                onChange={(event) => props.onProjectHandoffChange(event.currentTarget.value)}
                placeholder="Paste the Replit handoff here"
              />
              <div style={styles.manualAdvanceRow}>
                <button
                  type="button"
                  style={styles.secondaryButton}
                  onClick={props.onSaveProjectMemory}
                  disabled={props.isSavingProjectMemory || !props.projectHandoffDraft.trim()}
                >
                  {props.isSavingProjectMemory ? "Saving..." : props.projectMemoryExists ? "Update Project Memory" : "Save Project Memory"}
                </button>
              </div>
            </div>
          </div>
        ) : props.projectContextReadyActive ? (
          <div style={styles.contextSetupSurface}>
            <div style={styles.header}>
              <div>
                <p style={styles.eyebrow}>After response</p>
                <span style={styles.badge("#dcfce7", "#166534")}>Project Memory Ready</span>
              </div>
              <button type="button" style={styles.closeButton} onClick={props.onClose} aria-label="Close verdict panel">
                x
              </button>
            </div>

            <div style={styles.contextSetupIntro}>
              <p style={styles.contextSetupTitle}>Your project context is now saved and ready.</p>
              <p style={styles.contextSetupBody}>
                NoRetry has absorbed the background for this project. Continue working with Replit, and open AFTER on the
                next real project answer when you want a cleaner, better-grounded review.
              </p>
              <div style={styles.contextStatusRow}>
                <span style={styles.contextPill(true)}>
                  {props.projectMemoryDepth === "deep" ? "Deep project memory saved" : "Quick project memory saved"}
                </span>
                {props.projectMemoryLabel ? <span style={styles.contextMeta}>{props.projectMemoryLabel}</span> : null}
              </div>
            </div>

            <div style={styles.contextCard}>
              <p style={styles.contextHelper}>
                The next AFTER review will start from this point forward, using the project memory you just created
                instead of trying to retroactively judge the earlier setup exchange.
              </p>
              <div style={styles.manualAdvanceRow}>
                <button type="button" style={styles.copyButton} onClick={props.onClose}>
                  Got It
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
        <div style={styles.heroSurface}>
          <div style={styles.header}>
            <div>
              <p style={styles.eyebrow}>After response</p>
            <span style={styles.badge(tone.badgeBg, tone.badgeFg)}>
              {isPlannerOnlyState ? "No answer yet" : statusLabel}
            </span>
            </div>
            <button type="button" style={styles.closeButton} onClick={props.onClose} aria-label="Close verdict panel">
              x
            </button>
          </div>

          <div style={styles.block}>
            <p style={styles.blockTitle}>Analysis Summary</p>
            {hasRealReview ? (
              <p style={styles.summaryContext}>Based on your latest submitted prompt and latest visible answer.</p>
            ) : isPlannerOnlyState ? (
              <p style={styles.summaryContext}>NoRetry is ready to help shape the next prompt before any answer exists.</p>
            ) : null}
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
            {shouldShowLoadingProgress ? (
              <div style={styles.loadingProgressWrap}>
                <div style={styles.loadingProgressMeta}>
                  <span style={styles.loadingPercent}>{props.loadingProgress?.percent ?? 0}%</span>
                  <span style={styles.loadingStageLabel}>{props.loadingProgress?.label}</span>
                </div>
                <div style={styles.loadingTrack}>
                  <div
                    style={styles.loadingTrackFill(props.loadingProgress?.percent ?? 0)}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div style={styles.footer}>
            <div style={styles.confidenceBlock}>
              <p style={styles.blockTitle}>Analysis Status</p>
              <p style={styles.statusMeta}>
                <span style={styles.metaChip(confidenceTone.bg, confidenceTone.fg, confidenceTone.border)}>
                  Evidence: {evidenceLabel}
                </span>
                <span style={styles.metaChip(reviewTone.bg, reviewTone.fg, reviewTone.border)}>
                  Review: {reviewTone.label}
                </span>
              </p>
              {deepReviewEvidenceHint ? <p style={styles.statusHint}>{deepReviewEvidenceHint}</p> : null}
              {deepReviewLimitedHint ? <p style={styles.statusHint}>{deepReviewLimitedHint}</p> : null}
            </div>
          </div>
        </div>

        {checklistItems.length ? (
          <div style={styles.subtleSurface}>
            <p style={styles.criteriaCaption}>Checked against your submitted prompt</p>
            <ul style={styles.list}>
              {checklistItems.map((item) => (
                <li key={item.label} style={styles.listItem}>
                  <span style={styles.leadingBullet}>•</span>
                  <span style={styles.listText}>
                    {item.label}
                    <span style={styles.inlineMarker}> {item.marker}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div style={styles.checklistActions}>
              {showModeToggle ? (
                <div style={styles.modeToggle}>
                  <button
                    type="button"
                    style={styles.modeButton(activeReviewMode === "quick")}
                    onClick={() => props.onSelectCodeAnalysisMode("quick")}
                    disabled={props.isEvaluating || props.isDeepAnalyzing}
                  >
                    Quick
                  </button>
                  <button
                    type="button"
                    style={styles.modeButton(activeReviewMode === "deep")}
                    onClick={() => props.onSelectCodeAnalysisMode("deep")}
                    disabled={props.isEvaluating || props.isDeepAnalyzing}
                  >
                    {props.isDeepAnalyzing && activeReviewMode === "deep" ? "Digging deeper..." : "Deep"}
                  </button>
                </div>
              ) : null}
              {showStartNextStep ? (
                <button
                  type="button"
                  style={styles.copyButton}
                  onClick={props.onStartNextStep}
                  disabled={props.isEvaluating || props.isDeepAnalyzing}
                >
                  Start Next Step
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {props.nextStepStarted ? (
          <div ref={nextStepSectionRef} style={styles.nextStepSection}>
            <div style={styles.questionPanelHeader}>
              <div>
                <p style={styles.blockTitle}>{hasRealReview ? "Plan The Next Step" : "Let's Optimize Your Prompt"}</p>
                {props.projectMemoryEnabled ? (
                  <div style={styles.contextStatusRow}>
                    <span style={styles.contextPill(props.projectMemoryExists)}>
                      {props.projectMemoryExists
                        ? props.projectMemoryDepth === "deep"
                          ? "Using deep project memory"
                          : "Using quick project memory"
                        : "Add project memory"}
                    </span>
                    {props.projectMemoryLabel ? <span style={styles.contextMeta}>{props.projectMemoryLabel}</span> : null}
                  </div>
                ) : null}
                {!hasRealReview && originalPromptPreview ? (
                  <div style={styles.originalPromptCard}>
                    <p style={styles.originalPromptLabel}>Starting from your original prompt</p>
                    <p style={styles.originalPromptText}>{originalPromptPreview}</p>
                  </div>
                ) : null}
                <p style={styles.progressCopy}>
                  {visibleQuestions.length ? `${answeredNextCount} of ${visibleQuestions.length} answered` : "Start by describing the next step you want"}
                </p>
                {visibleQuestions.length ? (
                  <p style={styles.progressHint}>Questions build on your latest answer, and earlier edits can reshape the branch.</p>
                ) : null}
              </div>
            </div>

            {visibleQuestions.length || props.planningGoal.trim() ? (
              <div style={styles.progressAffirmation}>{improvement}</div>
            ) : null}

            {showPlanningGoalEntry ? (
              <div style={styles.questionCard}>
                <p style={styles.questionLabel}>What do you want the next step to be?</p>
                <p style={styles.questionHelper}>
                  Give NoRetry a short direction so it can build the next decision-tree questions around it.
                  {props.suggestedDirectionChips.length ? " Or tap a suggested issue below to add it for you." : ""}
                </p>
                {props.suggestedDirectionChips.length ? (
                  <div style={styles.suggestionSection}>
                    <p style={styles.suggestionLabel}>Suggested from this review</p>
                    <div style={styles.suggestionChips}>
                      {props.suggestedDirectionChips.map((chip) => {
                        const active = props.activeSuggestionChipId === chip.id
                        return (
                          <button
                            key={chip.id}
                            type="button"
                            style={styles.suggestionChip(active)}
                            onClick={() => props.onSuggestedDirectionClick(chip.id)}
                            disabled={Boolean(props.activeSuggestionChipId)}
                          >
                            {chip.label}
                            {active ? (
                              <span style={styles.loadingDotsInline} aria-hidden="true">
                                <span style={styles.loadingDot(0)}>.</span>
                                <span style={styles.loadingDot(0.2)}>.</span>
                                <span style={styles.loadingDot(0.4)}>.</span>
                              </span>
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : null}
                {props.planningGoalNotice ? (
                  <div style={styles.planningToast}>{props.planningGoalNotice}</div>
                ) : null}
                <textarea
                  ref={planningTextareaRef}
                  style={styles.planningTextarea}
                  value={props.planningGoal}
                  onChange={(event) => props.onPlanningGoalChange(event.currentTarget.value)}
                  placeholder="Example: Help me debug why the emoji overlay does not appear"
                />
                <div style={styles.manualAdvanceRow}>
                  {hasStructuredPlanningDirection ? (
                    <button
                      type="button"
                      style={styles.copyButton}
                      onClick={props.onSubmitPlanningGoalPrompt}
                      disabled={!props.planningGoal.trim()}
                    >
                      Submit Prompt
                    </button>
                  ) : (
                    <button
                      type="button"
                      style={styles.secondaryButton}
                      onClick={props.onBeginDecisionTree}
                      disabled={!props.planningGoal.trim() || props.isAddingNextQuestions}
                    >
                      {props.isAddingNextQuestions ? "Thinking..." : "Submit"}
                    </button>
                  )}
                </div>
              </div>
            ) : null}

            {visibleQuestions.length ? (
              <>
                <div ref={questionTabsRef} style={styles.questionTabs}>
                  {visibleQuestions.map((question, index) => (
                    <button
                      key={question.id}
                      type="button"
                      style={styles.questionTab(
                        index === props.activeNextQuestionIndex,
                        Boolean(props.nextAnswerState[question.id]?.trim()),
                        props.recentlyAnsweredQuestionId === question.id
                      )}
                      onClick={() => props.onNextQuestionIndexChange(index)}
                    >
                      {index + 1}
                    </button>
                  ))}
                  {props.recentlyAnsweredQuestionId ? (
                    <div style={styles.floatingReward} aria-hidden="true">
                      +1
                    </div>
                  ) : null}
                  {props.isAddingNextQuestions ? <QuestionTrailLoader /> : null}
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
                            style={styles.optionButton(
                              selected,
                              props.recentlyAnsweredQuestionId === activeNextQuestion.id && selected
                            )}
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
                          Submit
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
              <div ref={nextPromptSectionRef} style={styles.draftCard}>
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
          </>
        )}
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
    width: "min(620px, calc(100vw - 32px))",
    maxHeight: "min(76vh, 760px)",
    overflowY: "auto",
    zIndex: 2147483646,
    padding: 22,
    borderRadius: 28,
    background: "linear-gradient(180deg, rgba(255,255,255,0.985) 0%, rgba(248,250,252,0.975) 100%)",
    border: `1px solid ${border}`,
    boxShadow: "0 32px 88px rgba(15,23,42,0.16)",
    backdropFilter: "blur(14px)"
  }),
  heroSurface: {
    padding: 18,
    borderRadius: 24,
    background: "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(239,246,255,0.74) 100%)",
    border: "1px solid rgba(148,163,184,0.12)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)"
  } as CSSProperties,
  contextSetupSurface: {
    display: "flex",
    flexDirection: "column",
    gap: 16
  } as CSSProperties,
  contextSetupIntro: {
    padding: 18,
    borderRadius: 24,
    background: "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(245,243,255,0.82) 100%)",
    border: "1px solid rgba(148,163,184,0.12)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)"
  } as CSSProperties,
  contextSetupTitle: {
    margin: 0,
    fontSize: 20,
    lineHeight: 1.35,
    fontWeight: 800,
    color: "#0f172a"
  } as CSSProperties,
  contextSetupBody: {
    margin: "10px 0 0",
    fontSize: 14,
    lineHeight: 1.6,
    color: "#475569"
  } as CSSProperties,
  contextChoiceRow: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 12
  } as CSSProperties,
  contextChoiceButton: (active: boolean): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 6,
    padding: 14,
    borderRadius: 18,
    border: active ? "1px solid rgba(99,102,241,0.28)" : "1px solid rgba(148,163,184,0.16)",
    background: active ? "rgba(99,102,241,0.08)" : "rgba(255,255,255,0.8)",
    cursor: "pointer",
    textAlign: "left"
  }),
  contextChoiceTitle: {
    fontSize: 14,
    fontWeight: 800,
    color: "#0f172a"
  } as CSSProperties,
  contextChoiceBody: {
    fontSize: 12,
    lineHeight: 1.5,
    color: "#64748b"
  } as CSSProperties,
  contextChoiceAction: {
    marginTop: 8,
    border: "1px solid rgba(99,102,241,0.2)",
    borderRadius: 999,
    background: "rgba(99,102,241,0.08)",
    color: "#4338ca",
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 800,
    cursor: "pointer"
  } as CSSProperties,
  subtleSurface: {
    marginTop: 14,
    padding: 16,
    borderRadius: 20,
    background: "rgba(255,255,255,0.72)",
    border: "1px solid rgba(148,163,184,0.12)"
  } as CSSProperties,
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 16
  } as CSSProperties,
  eyebrow: {
    margin: 0,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "#64748b",
    fontWeight: 700
  } as CSSProperties,
  badge: (bg: string, fg: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    background: bg,
    color: fg,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: "0.04em",
    marginTop: 8,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.45)"
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
    marginBottom: 14
  } as CSSProperties,
  blockTitle: {
    margin: "0 0 8px",
    fontSize: 16,
    fontWeight: 800,
    color: "#0f172a"
  } as CSSProperties,
  summaryContext: {
    margin: "0 0 10px",
    fontSize: 12,
    lineHeight: 1.45,
    color: "#64748b"
  } as CSSProperties,
  criteriaCaption: {
    margin: "0 0 8px",
    fontSize: 12,
    fontWeight: 700,
    color: "#64748b"
  } as CSSProperties,
  summarySentence: {
    margin: 0,
    fontSize: 16,
    lineHeight: 1.55,
    color: "#334155",
    flex: 1,
    minWidth: 0
  } as CSSProperties,
  summaryRow: {
    display: "block"
  } as CSSProperties,
  loadingProgressWrap: {
    marginTop: 12,
    padding: "10px 12px",
    borderRadius: 16,
    background: "rgba(255,255,255,0.72)",
    border: "1px solid rgba(148,163,184,0.12)"
  } as CSSProperties,
  loadingProgressMeta: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 8
  } as CSSProperties,
  loadingPercent: {
    fontSize: 13,
    fontWeight: 800,
    color: "#4338ca"
  } as CSSProperties,
  loadingStageLabel: {
    fontSize: 12,
    lineHeight: 1.4,
    color: "#64748b",
    textAlign: "right"
  } as CSSProperties,
  loadingTrack: {
    position: "relative",
    width: "100%",
    height: 7,
    borderRadius: 999,
    overflow: "hidden",
    background: "rgba(99,102,241,0.10)"
  } as CSSProperties,
  loadingTrackFill: (percent: number): CSSProperties => ({
    width: `${Math.max(4, Math.min(percent, 100))}%`,
    height: "100%",
    borderRadius: 999,
    background: "linear-gradient(90deg, #818cf8 0%, #4f46e5 100%)",
    boxShadow: "0 0 18px rgba(79,70,229,0.18)",
    transition: "width 260ms ease"
  }),
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
    gap: 10,
    fontSize: 14,
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
    marginTop: 18
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
    fontSize: 13,
    lineHeight: 1.45,
    color: "#475569"
  } as CSSProperties,
  statusHint: {
    margin: "6px 0 0",
    fontSize: 13,
    lineHeight: 1.55,
    color: "#64748b",
    maxWidth: 520
  } as CSSProperties,
  metaChip: (bg: string, fg: string, border: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    background: bg,
    color: fg,
    border: `1px solid ${border}`,
    padding: "6px 12px",
    fontWeight: 700
  }),
  actions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "flex-end"
  } as CSSProperties,
  checklistActions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 16
  } as CSSProperties,
  nextStepSection: {
    marginTop: 18,
    padding: 18,
    borderRadius: 24,
    background: "rgba(255,255,255,0.76)",
    border: "1px solid rgba(148,163,184,0.12)",
    display: "flex",
    flexDirection: "column",
    gap: 14
  } as CSSProperties,
  questionPanelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  } as CSSProperties,
  progressAffirmation: {
    alignSelf: "flex-start",
    borderRadius: 999,
    background: "linear-gradient(180deg, rgba(99,102,241,0.08) 0%, rgba(79,70,229,0.12) 100%)",
    color: "#4338ca",
    border: "1px solid rgba(99,102,241,0.14)",
    padding: "7px 12px",
    fontSize: 12,
    fontWeight: 700
  } as CSSProperties,
  contextStatusRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    margin: "8px 0 12px"
  } as CSSProperties,
  contextPill: (active: boolean): CSSProperties => ({
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 700,
    background: active ? "rgba(34,197,94,0.12)" : "rgba(99,102,241,0.1)",
    color: active ? "#166534" : "#4338ca",
    border: active ? "1px solid rgba(34,197,94,0.16)" : "1px solid rgba(99,102,241,0.14)"
  }),
  contextMeta: {
    fontSize: 11,
    color: "#64748b"
  } as CSSProperties,
  contextCard: {
    border: "1px solid rgba(148,163,184,0.14)",
    borderRadius: 18,
    padding: 16,
    background: "rgba(255,255,255,0.76)",
    display: "flex",
    flexDirection: "column",
    gap: 10
  } as CSSProperties,
  contextTitle: {
    margin: 0,
    fontSize: 14,
    fontWeight: 800,
    color: "#0f172a"
  } as CSSProperties,
  contextHelper: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.55,
    color: "#64748b"
  } as CSSProperties,
  contextTextarea: {
    width: "100%",
    minHeight: 84,
    resize: "vertical",
    borderRadius: 14,
    border: "1px solid rgba(148,163,184,0.22)",
    padding: "12px 14px",
    fontSize: 13,
    lineHeight: 1.5,
    color: "#0f172a",
    background: "#ffffff"
  } as CSSProperties,
  dropZone: (active: boolean): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 8,
    padding: 14,
    borderRadius: 16,
    border: active ? "1px solid rgba(99,102,241,0.26)" : "1px dashed rgba(148,163,184,0.28)",
    background: active ? "rgba(99,102,241,0.06)" : "rgba(248,250,252,0.9)"
  }),
  dropZoneTitle: {
    margin: 0,
    fontSize: 13,
    fontWeight: 800,
    color: "#0f172a"
  } as CSSProperties,
  dropZoneBody: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.5,
    color: "#64748b"
  } as CSSProperties,
  ghostButton: {
    border: "1px solid rgba(148,163,184,0.18)",
    borderRadius: 999,
    background: "#ffffff",
    color: "#334155",
    padding: "8px 12px",
    fontWeight: 700,
    cursor: "pointer"
  } as CSSProperties,
  hiddenFileInput: {
    display: "none"
  } as CSSProperties,
  orDivider: {
    display: "flex",
    alignItems: "center",
    gap: 10
  } as CSSProperties,
  orDividerLine: {
    flex: 1,
    height: 1,
    background: "rgba(148,163,184,0.22)"
  } as CSSProperties,
  orDividerLabel: {
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#94a3b8"
  } as CSSProperties,
  originalPromptCard: {
    margin: "0 0 12px",
    padding: "10px 12px",
    borderRadius: 16,
    background: "rgba(255,255,255,0.7)",
    border: "1px solid rgba(148,163,184,0.14)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)"
  } as CSSProperties,
  originalPromptLabel: {
    margin: 0,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.02em",
    color: "#64748b"
  } as CSSProperties,
  originalPromptText: {
    margin: "6px 0 0",
    fontSize: 12,
    lineHeight: 1.55,
    color: "#334155"
  } as CSSProperties,
  progressCopy: {
    margin: 0,
    fontSize: 13,
    color: "#64748b"
  } as CSSProperties,
  progressHint: {
    margin: "4px 0 0",
    fontSize: 11,
    lineHeight: 1.45,
    color: "#94a3b8",
    maxWidth: 320
  } as CSSProperties,
  secondaryButton: {
    border: "1px solid rgba(99,102,241,0.18)",
    borderRadius: 999,
    background: "rgba(99,102,241,0.08)",
    color: "#4338ca",
    padding: "10px 14px",
    fontWeight: 700,
    cursor: "pointer"
  } as CSSProperties,
  questionTabs: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
    position: "relative"
  } as CSSProperties,
  floatingReward: {
    position: "absolute",
    top: -6,
    right: 0,
    width: 36,
    height: 36,
    borderRadius: 999,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, rgba(34,197,94,0.18) 0%, rgba(99,102,241,0.18) 100%)",
    color: "#166534",
    border: "1px solid rgba(34,197,94,0.18)",
    boxShadow: "0 10px 24px rgba(15,23,42,0.08)",
    fontSize: 13,
    fontWeight: 800,
    pointerEvents: "none",
    animation: "afterRewardFloat 2s ease-out forwards"
  } as CSSProperties,
  questionTrailLoader: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minHeight: 32,
    marginLeft: 4
  } as CSSProperties,
  questionTrailDot: (delay: number): CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: 999,
    background: "linear-gradient(135deg, #818cf8 0%, #4f46e5 100%)",
    animation: "afterQuestionTrailPulse 0.9s ease-in-out infinite",
    animationDelay: `${delay}s`,
    boxShadow: "0 0 0 4px rgba(99,102,241,0.08)"
  }),
  questionTab: (active: boolean, answered: boolean, celebrating: boolean): CSSProperties => ({
    border: active ? "1px solid rgba(99,102,241,0.25)" : "1px solid rgba(148,163,184,0.18)",
    background: active ? "rgba(99,102,241,0.12)" : answered ? "rgba(220,252,231,0.7)" : "#ffffff",
    color: active ? "#4338ca" : "#334155",
    width: 32,
    height: 32,
    borderRadius: 999,
    fontWeight: 700,
    cursor: "pointer",
    animation: celebrating ? "afterAnswerCelebrate 520ms ease-out" : undefined
  }),
  questionCard: {
    border: "1px solid rgba(148,163,184,0.14)",
    borderRadius: 22,
    padding: 18,
    background: "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(248,250,252,0.9) 100%)",
    boxShadow: "0 12px 30px rgba(15,23,42,0.04)"
  } as CSSProperties,
  questionLabel: {
    margin: 0,
    fontSize: 18,
    fontWeight: 800,
    color: "#0f172a"
  } as CSSProperties,
  questionHelper: {
    margin: "8px 0 0",
    fontSize: 13,
    lineHeight: 1.55,
    color: "#64748b"
  } as CSSProperties,
  suggestionSection: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginTop: 12,
    marginBottom: 12
  } as CSSProperties,
  suggestionLabel: {
    margin: 0,
    fontSize: 12,
    fontWeight: 700,
    color: "#475569"
  } as CSSProperties,
  suggestionChips: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8
  } as CSSProperties,
  suggestionChip: (active: boolean): CSSProperties => ({
    border: "1px solid rgba(99,102,241,0.18)",
    borderRadius: 999,
    background: active ? "rgba(99,102,241,0.12)" : "rgba(248,250,252,0.96)",
    color: "#4338ca",
    padding: "9px 13px",
    fontSize: 12,
    fontWeight: 700,
    cursor: active ? "default" : "pointer",
    display: "inline-flex",
    alignItems: "center"
  }),
  optionList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    marginTop: 14
  } as CSSProperties,
  inlineInput: {
    width: "100%",
    borderRadius: 14,
    border: "1px solid rgba(148,163,184,0.24)",
    padding: "12px 14px",
    fontSize: 14,
    color: "#0f172a",
    background: "#ffffff"
  } as CSSProperties,
  planningTextarea: {
    width: "100%",
    minHeight: 104,
    resize: "vertical",
    borderRadius: 16,
    border: "1px solid rgba(148,163,184,0.24)",
    padding: "12px 14px",
    fontSize: 14,
    lineHeight: 1.5,
    color: "#0f172a",
    background: "#ffffff"
  } as CSSProperties,
  planningToast: {
    alignSelf: "flex-start",
    borderRadius: 999,
    background: "rgba(34,197,94,0.12)",
    color: "#166534",
    border: "1px solid rgba(34,197,94,0.16)",
    padding: "7px 12px",
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 10
  } as CSSProperties,
  optionButton: (selected: boolean, celebrating: boolean): CSSProperties => ({
    border: selected ? "1px solid rgba(99,102,241,0.28)" : "1px solid rgba(148,163,184,0.16)",
    borderRadius: 18,
    background: selected ? "rgba(99,102,241,0.12)" : "#ffffff",
    color: selected ? "#312e81" : "#334155",
    padding: "14px 16px",
    textAlign: "left",
    fontWeight: selected ? 700 : 500,
    cursor: "pointer",
    fontSize: 15,
    lineHeight: 1.45,
    animation: celebrating ? "afterAnswerCelebrate 520ms ease-out" : undefined
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
    padding: "14px 20px",
    fontWeight: 800,
    fontSize: 15,
    cursor: "pointer",
    alignSelf: "flex-start"
  } as CSSProperties,
  draftCard: {
    border: "1px solid rgba(148,163,184,0.14)",
    borderRadius: 22,
    padding: 18,
    background: "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.92) 100%)",
    display: "flex",
    flexDirection: "column",
    gap: 12
  } as CSSProperties,
  draftInput: {
    width: "100%",
    minHeight: 140,
    resize: "vertical",
    borderRadius: 16,
    border: "1px solid rgba(148,163,184,0.24)",
    padding: 14,
    fontSize: 14,
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
  loadingDotsInline: {
    display: "inline-flex",
    marginLeft: 4
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
