import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import type {
  AnalyzePromptResponse,
  ClarificationQuestion,
  DetectOutcomeResponse,
  DiagnoseFailureResponse,
  SessionSummary,
  StrengthScore
} from "@prompt-optimizer/shared/src/schemas"

type OptimizerShellProps = {
  mounted: boolean
  panelOpen: boolean
  promptPreview: string
  beforeResult: AnalyzePromptResponse | null
  isAnalyzingPrompt: boolean
  diagnosis: DiagnoseFailureResponse | null
  detection: DetectOutcomeResponse | null
  session: SessionSummary | null
  onboardingVisible: boolean
  issueVisible: boolean
  answerState: Record<string, string | string[]>
  otherAnswerState: Record<string, string>
  editableDraft: string
  aiDraftNotes: string[]
  isGeneratingDraft: boolean
  isAddingQuestions: boolean
  isLoadingQuestions: boolean
  answeredCount: number
  totalQuestions: number
  draftReady: boolean
  debugInfo: {
    surface: "REPLIT" | "CHATGPT"
    promptDetected: boolean
    promptLength: number
    questionSource: "AI" | "FALLBACK" | "NONE"
    aiAvailable: boolean
    questionLoadError: string | null
  }
  onClosePanel: () => void
  onOpenPanel: () => void
  onRewrite: () => void
  onExplain: () => void
  onApplyFix: () => void
  onCopyFix: () => void
  onRetry: () => void
  onDismissOnboarding: () => void
  onWorked: () => void
  onDidNotWork: () => void
  onAnswerChange: (question: ClarificationQuestion, value: string) => void
  onToggleMultiAnswer: (question: ClarificationQuestion, value: string) => void
  onOtherAnswerChange: (question: ClarificationQuestion, value: string) => void
  onDraftChange: (value: string) => void
  onReplacePrompt: () => void
  onGenerateAiDraft: () => void
  onAddQuestions: () => void
}

function badgeTone(score: StrengthScore | undefined) {
  switch (score) {
    case "HIGH":
      return { bg: "rgba(220,252,231,0.92)", fg: "#16a34a", border: "rgba(22,163,74,0.22)" }
    case "MID":
      return { bg: "rgba(254,243,199,0.94)", fg: "#eab308", border: "rgba(234,179,8,0.22)" }
    default:
      return { bg: "rgba(254,226,226,0.94)", fg: "#ef4444", border: "rgba(239,68,68,0.18)" }
  }
}

function RunningManIcon() {
  return (
    <svg viewBox="0 0 24 24" style={styles.badgeRunner} aria-hidden="true">
      <circle cx="15.5" cy="4.5" r="2.2" fill="#8b5cf6" />
      <path
        d="M13.5 7.2l-3.2 3.7 2.3 2.1-2.9 5.2m3.8-8.8l3.8 2.4 2.9-.8m-6.7-1.6l1.3 4.5 3.5 2.7m-5-2.3L7.3 21m5.8-1.8l4.5-3.2"
        fill="none"
        stroke="#8b5cf6"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CardManIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" style={styles.badgeCardMan} aria-hidden="true">
      <circle cx="8.2" cy="5" r="2.1" fill="#334155" />
      <path
        d="M8.2 7.6v5.2m0 0l-3.2 4.7m3.2-4.7l3.4 4.7m0-8.8l-3.4 2.2m3.4-2.2l3.2-1.7"
        fill="none"
        stroke="#334155"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="14.2" y="5.8" width="6.1" height="8.4" rx="1.1" fill={color} />
      <path
        d="M11.4 9.3h3.2"
        fill="none"
        stroke="#334155"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function OptimizerShell(props: OptimizerShellProps) {
  const otherOption = "Other"
  const isBusy = props.isAnalyzingPrompt || props.isLoadingQuestions
  const tone = isBusy
    ? { bg: "#eff6ff", fg: "#1d4ed8", border: "rgba(29,78,216,0.18)" }
    : badgeTone(props.beforeResult?.score)
  const draftSectionRef = useRef<HTMLDivElement | null>(null)
  const prevDraftReadyRef = useRef(false)
  const prevAnswerSignatureRef = useRef("")
  const autoAdvanceTimerRef = useRef<number | null>(null)
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0)
  const [savedQuestionId, setSavedQuestionId] = useState<string | null>(null)
  const questions = props.beforeResult?.clarification_questions ?? []
  const activeQuestion = questions[activeQuestionIndex] ?? null

  const answerSignature = useMemo(
    () =>
      JSON.stringify({
        answers: props.answerState,
        otherAnswers: props.otherAnswerState,
        questionIds: questions.map((question) => question.id)
      }),
    [props.answerState, props.otherAnswerState, questions]
  )

  const selectedAnswerSummary = useMemo(() => {
    const activeQuestion = questions[activeQuestionIndex]
    if (!activeQuestion) return []

    const value = props.answerState[activeQuestion.id]
    const customOther = props.otherAnswerState[activeQuestion.id]?.trim()
    const answers = Array.isArray(value) ? value : typeof value === "string" ? [value] : []

    return answers
      .map((answer) => (answer === otherOption && customOther ? customOther : answer))
      .filter(Boolean)
  }, [activeQuestionIndex, otherOption, props.answerState, props.otherAnswerState, questions])

  const activeQuestionUsesOther =
    activeQuestion != null && isOtherSelectedForDisplay(activeQuestion, props.answerState, otherOption)
  const activeQuestionNeedsManualAdvance =
    activeQuestion != null && (activeQuestion.mode === "multi" || activeQuestionUsesOther)

  useEffect(() => {
    if (!questions.length) {
      setActiveQuestionIndex(0)
      return
    }

    setActiveQuestionIndex((current) => Math.min(current, questions.length - 1))
  }, [questions.length])

  useEffect(() => {
    if (props.draftReady && !prevDraftReadyRef.current) {
      window.setTimeout(() => {
        draftSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
      }, 120)
    }

    prevDraftReadyRef.current = props.draftReady
  }, [props.draftReady])

  useEffect(() => {
    if (prevAnswerSignatureRef.current === answerSignature) return

    const previousParsed = prevAnswerSignatureRef.current
      ? (JSON.parse(prevAnswerSignatureRef.current) as {
          answers: Record<string, string | string[]>
          otherAnswers: Record<string, string>
        })
      : { answers: {}, otherAnswers: {} }

    prevAnswerSignatureRef.current = answerSignature

    const changedQuestion = questions.find((question) => {
      const previousAnswer = JSON.stringify(previousParsed.answers[question.id] ?? null)
      const nextAnswer = JSON.stringify(props.answerState[question.id] ?? null)
      const previousOther = previousParsed.otherAnswers[question.id] ?? ""
      const nextOther = props.otherAnswerState[question.id] ?? ""

      return previousAnswer !== nextAnswer || previousOther !== nextOther
    })

    if (!changedQuestion) return

    setSavedQuestionId(changedQuestion.id)
    window.clearTimeout(autoAdvanceTimerRef.current ?? undefined)
    autoAdvanceTimerRef.current = window.setTimeout(() => {
      setSavedQuestionId(null)
      const changedQuestionNeedsManualAdvance =
        changedQuestion.mode === "multi" || isOtherSelectedForDisplay(changedQuestion, props.answerState, otherOption)
      if (changedQuestionNeedsManualAdvance) {
        return
      }
      const nextIndex = questions.findIndex((question, index) => {
        if (index <= activeQuestionIndex) return false
        return !isAnsweredForDisplay(question, props.answerState, props.otherAnswerState, otherOption)
      })

      if (nextIndex >= 0) {
        setActiveQuestionIndex(nextIndex)
      }
    }, 220)

    return () => {
      if (autoAdvanceTimerRef.current) {
        window.clearTimeout(autoAdvanceTimerRef.current)
      }
    }
  }, [activeQuestionIndex, answerSignature, otherOption, props.answerState, props.otherAnswerState, questions])

  const allAnswered = questions.length > 0 && questions.every((question) => isAnsweredForDisplay(question, props.answerState, props.otherAnswerState, otherOption))

  return (
    <div style={styles.root(props.mounted)}>
      <style>
        {`
          @keyframes promptOptimizerSpin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          @keyframes promptOptimizerCharge {
            0% { transform: translateX(-4px) scaleX(1) scale(0.96); opacity: 0.72; }
            24% { transform: translateX(4px) scaleX(1) scale(1); opacity: 1; }
            25% { transform: translateX(4px) scaleX(-1) scale(1); opacity: 1; }
            49% { transform: translateX(-4px) scaleX(-1) scale(0.96); opacity: 0.78; }
            50% { transform: translateX(-4px) scaleX(1) scale(0.96); opacity: 0.78; }
            74% { transform: translateX(4px) scaleX(1) scale(1); opacity: 1; }
            75% { transform: translateX(4px) scaleX(-1) scale(1); opacity: 1; }
            100% { transform: translateX(-4px) scaleX(-1) scale(0.96); opacity: 0.72; }
          }
        `}
      </style>
      <button type="button" style={styles.badge(tone.bg, tone.fg, tone.border)} onClick={props.panelOpen ? props.onClosePanel : props.onOpenPanel}>
        <span style={isBusy ? styles.badgeCharge : styles.badgeDot}>
          {isBusy ? <RunningManIcon /> : null}
        </span>
        {!isBusy ? (
          <CardManIcon color={tone.fg} />
        ) : null}
      </button>

      {props.issueVisible && !props.panelOpen ? (
        <section style={styles.issueCard}>
          <p style={styles.issueCopy}>Looks like something didn&apos;t go as expected.</p>
          <button type="button" style={styles.primaryButton} onClick={props.onExplain}>
            Explain what went wrong
          </button>
        </section>
      ) : null}

      {props.panelOpen ? (
        <>
          <button type="button" style={styles.scrim} onClick={props.onClosePanel} aria-label="Close NoRetry" />
          <section style={styles.panel}>
            <div style={styles.panelHeader}>
              <div>
                <p style={styles.eyebrow}>{props.onboardingVisible ? "Welcome" : "Before Send"}</p>
                <h3 style={styles.heading}>
                  {props.onboardingVisible ? "NoRetry" : `Prompt strength ${props.beforeResult?.score ?? "LOW"}`}
                </h3>
              </div>
              <button type="button" style={styles.closeButton} onClick={props.onClosePanel} aria-label="Close">
                x
              </button>
            </div>

            {props.onboardingVisible ? (
              <section style={styles.onboarding}>
                <ol style={styles.list}>
                  <li>We improve your prompt before sending.</li>
                  <li>If the AI misses the mark, we explain why.</li>
                  <li>Click the badge any time you want help.</li>
                </ol>
                <button type="button" style={styles.primaryButton} onClick={props.onDismissOnboarding}>
                  Start
                </button>
              </section>
            ) : null}

            {!props.onboardingVisible ? (
              <>
                <div style={styles.panelSection}>
                  <p style={styles.meta}>Intent: {props.beforeResult?.intent ?? "OTHER"}</p>
                  <div style={styles.promptCard}>
                    <p style={styles.cardTitle}>Current prompt</p>
                    <p style={styles.preview}>{props.promptPreview || "Start typing in the prompt box to analyze your prompt."}</p>
                  </div>
                </div>

                {props.beforeResult?.question_source === "AI" && props.beforeResult?.clarification_questions.length ? (
                  <div style={styles.questionPanel}>
                    <div style={styles.questionPanelHeader}>
                      <div style={styles.progressMeta}>
                        <p style={styles.cardTitle}>AI questions</p>
                        <p style={styles.progressCopy}>
                          {props.answeredCount} of {props.totalQuestions} completed
                        </p>
                      </div>
                      <div style={styles.questionHeaderActions}>
                        <button type="button" style={styles.secondaryButton} onClick={props.onAddQuestions} disabled={props.isAddingQuestions}>
                          {props.isAddingQuestions ? "Adding..." : "Add 3 Questions"}
                        </button>
                      </div>
                    </div>
                    <div style={styles.stickyProgressArea}>
                      <div style={styles.progressTrack}>
                        <div
                          style={styles.progressFill(
                            props.totalQuestions === 0 ? 0 : (props.answeredCount / props.totalQuestions) * 100
                          )}
                        />
                      </div>
                      <div style={styles.questionTabs}>
                        {questions.map((question, index) => {
                          const answered = isAnsweredForDisplay(question, props.answerState, props.otherAnswerState, otherOption)
                          const active = index === activeQuestionIndex
                          return (
                            <button
                              key={question.id}
                              type="button"
                              style={styles.questionTab(active, answered)}
                              onClick={() => setActiveQuestionIndex(index)}>
                              {index + 1}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    {activeQuestion ? (
                      <div style={styles.questionStage}>
                        <div style={styles.questionStatusRow}>
                          <p style={styles.questionCounter}>
                            Question {activeQuestionIndex + 1} of {questions.length}
                          </p>
                          <div style={styles.questionStatusMeta}>
                            {savedQuestionId === activeQuestion.id ? <span style={styles.savedPill}>Saved</span> : null}
                          </div>
                        </div>
                        <div style={styles.questionCardActive(activeQuestion.mode)}>
                          <p style={styles.questionLabel}>{activeQuestion.label}</p>
                          <p style={styles.questionHelper}>{activeQuestion.helper}</p>
                          <div style={styles.optionColumn}>
                            {[...activeQuestion.options.filter((option) => option !== otherOption), otherOption].map((option) => {
                              const selected =
                                activeQuestion.mode === "multi"
                                  ? Array.isArray(props.answerState[activeQuestion.id]) &&
                                    (props.answerState[activeQuestion.id] as string[]).includes(option)
                                  : props.answerState[activeQuestion.id] === option

                              return (
                                <button
                                  type="button"
                                  key={option}
                                  style={styles.optionButton(selected, activeQuestion.mode)}
                                  onClick={() =>
                                    activeQuestion.mode === "multi"
                                      ? props.onToggleMultiAnswer(activeQuestion, option)
                                      : props.onAnswerChange(activeQuestion, option)
                                  }>
                                  {option}
                                </button>
                              )
                            })}
                            {(activeQuestion.mode === "multi"
                              ? Array.isArray(props.answerState[activeQuestion.id]) &&
                                (props.answerState[activeQuestion.id] as string[]).includes(otherOption)
                              : props.answerState[activeQuestion.id] === otherOption) ? (
                              <input
                                type="text"
                                style={styles.inlineInput}
                                value={props.otherAnswerState[activeQuestion.id] ?? ""}
                                onChange={(event) => props.onOtherAnswerChange(activeQuestion, event.currentTarget.value)}
                                placeholder="Type your answer"
                              />
                            ) : null}
                          </div>
                          {selectedAnswerSummary.length ? (
                            <div style={styles.answerChipRow}>
                              {selectedAnswerSummary.map((answer) => (
                                <span key={answer} style={styles.answerChip}>
                                  {answer}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {activeQuestionNeedsManualAdvance ? (
                            <div style={styles.manualAdvanceRow}>
                              <button
                                type="button"
                                style={styles.secondaryButton}
                                onClick={() => {
                                  const nextIndex = questions.findIndex((question, index) => {
                                    if (index <= activeQuestionIndex) return false
                                    return !isAnsweredForDisplay(question, props.answerState, props.otherAnswerState, otherOption)
                                  })

                                  if (nextIndex >= 0) {
                                    setActiveQuestionIndex(nextIndex)
                                    return
                                  }

                                  setActiveQuestionIndex(Math.min(activeQuestionIndex + 1, questions.length - 1))
                                }}>
                                Next question
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div style={styles.panelCard}>
                    <p style={styles.cardTitle}>AI questions</p>
                    <div style={styles.loadingState}>
                      <span style={styles.loadingRunner}>
                        <RunningManIcon />
                      </span>
                      <p style={styles.rowItem}>
                        {props.isLoadingQuestions
                          ? "Loading AI questions..."
                          : props.beforeResult?.ai_available
                          ? "No extra questions needed."
                          : "AI is shaping your next questions..."}
                      </p>
                    </div>
                  </div>
                )}

                <div style={styles.debugCard}>
                  <p style={styles.debugTitle}>Debug</p>
                  <p style={styles.debugLine}>
                    Surface: {props.debugInfo.surface} | Prompt detected: {props.debugInfo.promptDetected ? "yes" : "no"} | Prompt chars:{" "}
                    {props.debugInfo.promptLength}
                  </p>
                  <p style={styles.debugLine}>
                    Questions: {props.debugInfo.questionSource} | AI available: {props.debugInfo.aiAvailable ? "yes" : "no"} | Loading:{" "}
                    {props.isLoadingQuestions ? "yes" : "no"}
                  </p>
                  {props.debugInfo.questionLoadError ? <p style={styles.debugError}>{props.debugInfo.questionLoadError}</p> : null}
                </div>

                <div style={styles.panelCard} ref={draftSectionRef}>
                  <div style={styles.progressHeader}>
                    <div style={styles.progressMeta}>
                      <p style={styles.cardTitle}>New AI prompt</p>
                    </div>
                    {props.answeredCount > 0 ? (
                      <button type="button" style={styles.primaryButton} onClick={props.onGenerateAiDraft} disabled={props.isGeneratingDraft}>
                        {props.isGeneratingDraft ? "Generating..." : "Generate"}
                      </button>
                    ) : null}
                  </div>
                  {props.isGeneratingDraft ? (
                    <p style={styles.rowItem}>Turning your answers into a stronger AI prompt...</p>
                  ) : props.draftReady ? (
                    <>
                      <textarea
                        style={styles.textAreaLarge}
                        value={props.editableDraft}
                        onChange={(event) => props.onDraftChange(event.currentTarget.value)}
                      />
                    </>
                  ) : (
                    <p style={styles.rowItem}>
                      {props.answeredCount > 0
                        ? "Click Generate to create the new prompt here."
                        : "Answer at least one question to unlock prompt generation."}
                    </p>
                  )}
                </div>

                <div style={styles.bottomActionRow}>
                  <button
                    type="button"
                    style={styles.primaryButtonWide(props.draftReady && !!props.editableDraft.trim())}
                    disabled={!props.draftReady || !props.editableDraft.trim()}
                    onClick={props.onReplacePrompt}>
                    Replace prompt
                  </button>
                </div>

                {props.detection ? (
                  <div style={styles.panelCard}>
                    <p style={styles.cardTitle}>Outcome check</p>
                    <p style={styles.rowItem}>Status: {props.detection.probable_status}</p>
                    <p style={styles.rowItem}>{props.detection.concise_issue ?? "No visible issue detected."}</p>
                  </div>
                ) : null}

                {props.diagnosis ? (
                  <div style={styles.panelCard}>
                    <p style={styles.cardTitle}>After diagnosis</p>
                    {props.diagnosis.why_it_likely_failed.map((item) => (
                      <p key={item} style={styles.rowItem}>
                        {item}
                      </p>
                    ))}
                    <p style={styles.rowItem}>{props.diagnosis.what_the_ai_likely_misunderstood}</p>
                    {props.diagnosis.what_to_fix_next_time.map((item) => (
                      <p key={item} style={styles.rowItem}>
                        {item}
                      </p>
                    ))}
                    <div style={styles.actionsRow}>
                      <button type="button" style={styles.primaryButton} onClick={props.onApplyFix} disabled={!props.diagnosis.improved_retry_prompt}>
                        Apply Fix
                      </button>
                      <button type="button" style={styles.secondaryButton} onClick={props.onCopyFix} disabled={!props.diagnosis.improved_retry_prompt}>
                        Copy Fix
                      </button>
                      <button type="button" style={styles.secondaryButton} onClick={props.onRetry} disabled={!props.diagnosis.improved_retry_prompt}>
                        Retry
                      </button>
                    </div>
                  </div>
                ) : null}

                {props.session ? (
                  <p style={styles.footer}>
                    Session status {props.session.lastProbableStatus}. Retries {props.session.retryCount}. Last issue{" "}
                    {props.session.lastIssueDetected ?? "none"}.
                  </p>
                ) : null}
              </>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  )
}

function isAnsweredForDisplay(
  question: ClarificationQuestion,
  answers: Record<string, string | string[]>,
  otherAnswers: Record<string, string>,
  otherOption: string
) {
  const value = answers[question.id]
  const otherValue = otherAnswers[question.id]?.trim() ?? ""

  return question.mode === "multi"
    ? Array.isArray(value) && value.length > 0 && (!value.includes(otherOption) || otherValue.length > 0)
    : typeof value === "string" && value.trim().length > 0 && (value !== otherOption || otherValue.length > 0)
}

function isOtherSelectedForDisplay(
  question: ClarificationQuestion,
  answers: Record<string, string | string[]>,
  otherOption: string
) {
  const value = answers[question.id]

  return question.mode === "multi"
    ? Array.isArray(value) && value.includes(otherOption)
    : value === otherOption
}

const styles = {
  root: (mounted: boolean): CSSProperties => ({
    position: "relative",
    zIndex: 2147483647,
    opacity: mounted ? 1 : 0,
    transition: "opacity 180ms ease"
  }),
  badge: (bg: string, fg: string, border: string): CSSProperties => ({
    border: `1px solid ${border}`,
    borderRadius: "999px",
    background: bg,
    color: fg,
    minWidth: 26,
    width: 26,
    height: 26,
    padding: 0,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.01em",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    boxShadow: "0 8px 18px rgba(15,23,42,0.12)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    outline: "none",
    transition: "transform 140ms ease, box-shadow 140ms ease"
  }),
  badgeDot: {
    display: "none"
  } as CSSProperties,
  badgeSpinner: {
    width: 9,
    height: 9,
    borderRadius: "50%",
    border: "2px solid rgba(29,78,216,0.18)",
    borderTopColor: "#1d4ed8",
    animation: "promptOptimizerSpin 0.9s linear infinite"
  } as CSSProperties,
  badgeCharge: {
    position: "relative",
    width: 18,
    height: 18,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden"
  } as CSSProperties,
  badgeRunner: {
    width: 18,
    height: 18,
    animation: "promptOptimizerCharge 1s ease-in-out infinite",
    transformOrigin: "50% 50%"
  } as CSSProperties,
  badgeCardMan: {
    width: 18,
    height: 18,
    transform: "translateY(-0.25px)",
    filter: "drop-shadow(0 1px 4px rgba(15,23,42,0.14))"
  } as CSSProperties,
  onboarding: {
    marginTop: 4
  } as CSSProperties,
  issueCard: {
    position: "fixed",
    top: 80,
    right: 16,
    width: 280,
    padding: 14,
    borderRadius: 18,
    background: "#fff",
    border: "1px solid rgba(153, 27, 27, 0.14)",
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.14)"
  } as CSSProperties,
  issueCopy: {
    margin: "0 0 12px",
    fontSize: 14,
    lineHeight: 1.4
  } as CSSProperties,
  panel: {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "min(560px, calc(100vw - 32px))",
    maxHeight: "min(78vh, 760px)",
    overflowY: "auto",
    padding: 20,
    borderRadius: 24,
    background: "linear-gradient(180deg, rgba(255,250,241,0.98) 0%, rgba(255,255,255,0.98) 100%)",
    border: "1px solid rgba(31,41,55,0.12)",
    boxShadow: "0 24px 64px rgba(15, 23, 42, 0.16)",
    backdropFilter: "blur(16px)"
  } as CSSProperties,
  scrim: {
    position: "fixed",
    inset: 0,
    border: "none",
    background: "rgba(15, 23, 42, 0.18)",
    cursor: "pointer"
  } as CSSProperties,
  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start"
  } as CSSProperties,
  eyebrow: {
    margin: 0,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "#166534"
  } as CSSProperties,
  heading: {
    margin: "4px 0 0",
    fontSize: 18,
    color: "#1f2937"
  } as CSSProperties,
  panelSection: {
    marginTop: 12
  } as CSSProperties,
  promptCard: {
    padding: 14,
    borderRadius: 18,
    background: "rgba(255,255,255,0.86)",
    border: "1px solid rgba(31,41,55,0.08)"
  } as CSSProperties,
  meta: {
    margin: "0 0 10px",
    fontSize: 12,
    color: "#52606d"
  } as CSSProperties,
  preview: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: "#1f2937"
  } as CSSProperties,
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 12,
    marginTop: 14
  } as CSSProperties,
  panelCard: {
    padding: 14,
    borderRadius: 18,
    background: "rgba(255,255,255,0.86)",
    border: "1px solid rgba(31,41,55,0.08)"
  } as CSSProperties,
  cardTitle: {
    margin: "0 0 8px",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#166534"
  } as CSSProperties,
  rowItem: {
    margin: "0 0 8px",
    fontSize: 13,
    lineHeight: 1.45,
    color: "#334155"
  } as CSSProperties,
  loadingState: {
    display: "flex",
    alignItems: "center",
    gap: 10
  } as CSSProperties,
  loadingOrb: {
    width: 16,
    height: 16,
    borderRadius: "50%",
    border: "2px solid rgba(22,163,74,0.18)",
    borderTopColor: "#16a34a",
    animation: "promptOptimizerSpin 0.9s linear infinite"
  } as CSSProperties,
  questionBlock: {
    marginBottom: 16
  } as CSSProperties,
  progressHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12
  } as CSSProperties,
  progressMeta: {
    minWidth: 0
  } as CSSProperties,
  progressCopy: {
    margin: "4px 0 0",
    fontSize: 12,
    color: "#64748b"
  } as CSSProperties,
  questionPanel: {
    padding: 14,
    borderRadius: 20,
    background: "rgba(255,255,255,0.9)",
    border: "1px solid rgba(31,41,55,0.08)",
    marginTop: 12
  } as CSSProperties,
  questionPanelHeader: {
    position: "sticky",
    top: -4,
    zIndex: 2,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
    paddingBottom: 10,
    background: "linear-gradient(180deg, rgba(255,250,241,0.98) 0%, rgba(255,250,241,0.9) 100%)"
  } as CSSProperties,
  questionHeaderActions: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    justifyContent: "flex-end"
  } as CSSProperties,
  progressTrack: {
    width: "100%",
    height: 10,
    borderRadius: 999,
    background: "rgba(31,41,55,0.08)",
    overflow: "hidden",
    marginBottom: 14
  } as CSSProperties,
  progressFill: (width: number): CSSProperties => ({
    width: `${Math.max(0, Math.min(100, width))}%`,
    height: "100%",
    borderRadius: 999,
    background: "linear-gradient(90deg, #166534 0%, #4ade80 100%)"
  }),
  stickyProgressArea: {
    position: "sticky",
    top: 54,
    zIndex: 1,
    background: "rgba(255,250,241,0.94)",
    paddingBottom: 10,
    marginBottom: 14
  } as CSSProperties,
  questionTabs: {
    display: "flex",
    gap: 8,
    overflowX: "auto",
    paddingBottom: 4
  } as CSSProperties,
  questionTab: (active: boolean, answered: boolean): CSSProperties => ({
    minWidth: 36,
    height: 36,
    borderRadius: 999,
    border: `1px solid ${
      active ? "rgba(22,101,52,0.32)" : answered ? "rgba(74,222,128,0.28)" : "rgba(31,41,55,0.12)"
    }`,
    background: active ? "#dcfce7" : answered ? "#f0fdf4" : "#fff",
    color: active ? "#166534" : "#334155",
    fontWeight: 700,
    cursor: "pointer"
  }),
  completionBanner: (ready: boolean): CSSProperties => ({
    padding: "12px 14px",
    borderRadius: 16,
    marginBottom: 14,
    background: ready ? "rgba(220,252,231,0.9)" : "rgba(255,247,234,0.92)",
    border: `1px solid ${ready ? "rgba(22,101,52,0.18)" : "rgba(180,83,9,0.16)"}`
  }),
  completionTitle: {
    margin: "0 0 4px",
    fontSize: 13,
    fontWeight: 700,
    color: "#1f2937"
  } as CSSProperties,
  completionHint: {
    margin: 0,
    fontSize: 12,
    color: "#64748b",
    lineHeight: 1.45
  } as CSSProperties,
  questionStage: {
    marginBottom: 14
  } as CSSProperties,
  questionStatusRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10
  } as CSSProperties,
  questionStatusMeta: {
    display: "flex",
    alignItems: "center",
    gap: 8
  } as CSSProperties,
  questionCounter: {
    margin: 0,
    fontSize: 12,
    color: "#64748b",
    fontWeight: 700
  } as CSSProperties,
  savedPill: {
    padding: "4px 10px",
    borderRadius: 999,
    background: "#dcfce7",
    color: "#166534",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase"
  } as CSSProperties,
  questionCardActive: (mode: "single" | "multi"): CSSProperties => ({
    padding: 16,
    borderRadius: 20,
    border: `1px solid ${mode === "multi" ? "rgba(109,40,217,0.12)" : "rgba(14,116,144,0.10)"}`,
    background: mode === "multi" ? "#faf5ff" : "#fff7ea",
    boxShadow: "0 14px 34px rgba(15, 23, 42, 0.08)"
  }),
  questionScroller: {
    display: "flex",
    gap: 12,
    overflowX: "auto",
    paddingBottom: 4,
    scrollSnapType: "x proximity"
  } as CSSProperties,
  questionCard: {
    minWidth: "min(360px, 72vw)",
    maxWidth: "min(420px, 78vw)",
    padding: 14,
    borderRadius: 18,
    border: "1px solid rgba(31,41,55,0.08)",
    background: "#fff7ea",
    scrollSnapAlign: "start"
  } as CSSProperties,
  questionLabel: {
    margin: "0 0 4px",
    fontSize: 14,
    fontWeight: 700,
    color: "#1f2937"
  } as CSSProperties,
  questionHelper: {
    margin: "0 0 10px",
    fontSize: 12,
    lineHeight: 1.45,
    color: "#64748b"
  } as CSSProperties,
  optionRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8
  } as CSSProperties,
  optionColumn: {
    display: "flex",
    flexDirection: "column",
    gap: 8
  } as CSSProperties,
  answerChipRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12
  } as CSSProperties,
  manualAdvanceRow: {
    display: "flex",
    justifyContent: "flex-end",
    marginTop: 14
  } as CSSProperties,
  answerChip: {
    borderRadius: 999,
    background: "#ecfccb",
    color: "#3f6212",
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 700
  } as CSSProperties,
  optionButton: (selected: boolean, mode: "single" | "multi"): CSSProperties => ({
    border: `1px solid ${
      selected
        ? mode === "multi"
          ? "rgba(109,40,217,0.28)"
          : "rgba(22,101,52,0.32)"
        : "rgba(31,41,55,0.12)"
    }`,
    borderRadius: 999,
    background: selected ? (mode === "multi" ? "#ede9fe" : "#dcfce7") : "#fff",
    color: selected ? (mode === "multi" ? "#6d28d9" : "#166534") : "#334155",
    padding: "9px 12px",
    fontWeight: 600,
    cursor: "pointer"
  }),
  inlineInput: {
    width: "100%",
    borderRadius: 14,
    border: "1px solid rgba(31,41,55,0.12)",
    padding: "10px 12px",
    font: "inherit",
    color: "#1f2937",
    background: "#fff"
  } as CSSProperties,
  textArea: {
    width: "100%",
    minHeight: 82,
    borderRadius: 16,
    border: "1px solid rgba(31,41,55,0.12)",
    padding: 12,
    resize: "vertical",
    font: "inherit",
    color: "#1f2937",
    background: "#fff"
  } as CSSProperties,
  textAreaLarge: {
    width: "100%",
    minHeight: 150,
    borderRadius: 16,
    border: "1px solid rgba(31,41,55,0.12)",
    padding: 14,
    resize: "vertical",
    font: "inherit",
    lineHeight: 1.55,
    color: "#1f2937",
    background: "#fff"
  } as CSSProperties,
  noteList: {
    marginTop: 12
  } as CSSProperties,
  noteItem: {
    margin: "0 0 6px",
    fontSize: 12,
    lineHeight: 1.45,
    color: "#64748b"
  } as CSSProperties,
  debugCard: {
    marginTop: 12,
    padding: "10px 12px",
    borderRadius: 12,
    background: "#f8fafc",
    border: "1px solid rgba(148,163,184,0.22)"
  } as CSSProperties,
  debugTitle: {
    margin: 0,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#475569"
  } as CSSProperties,
  debugLine: {
    margin: "6px 0 0",
    fontSize: 12,
    color: "#475569",
    lineHeight: 1.4
  } as CSSProperties,
  debugError: {
    margin: "6px 0 0",
    fontSize: 12,
    color: "#b91c1c",
    lineHeight: 1.4
  } as CSSProperties,
  bottomActionRow: {
    marginTop: 16
  } as CSSProperties,
  primaryButtonWide: (enabled: boolean): CSSProperties => ({
    width: "100%",
    border: "none",
    borderRadius: 999,
    background: enabled ? "#1f2937" : "#cbd5e1",
    color: enabled ? "#fff" : "#64748b",
    padding: "14px 18px",
    fontWeight: 700,
    cursor: enabled ? "pointer" : "not-allowed",
    boxShadow: enabled ? "0 10px 24px rgba(15,23,42,0.18)" : "inset 0 0 0 1px rgba(100,116,139,0.12)"
  }),
  list: {
    margin: "10px 0 14px",
    paddingLeft: 18,
    color: "#334155",
    fontSize: 13,
    lineHeight: 1.5
  } as CSSProperties,
  actionsRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginTop: 14
  } as CSSProperties,
  primaryButton: {
    border: "none",
    borderRadius: 999,
    background: "#1f2937",
    color: "#fff",
    padding: "10px 14px",
    fontWeight: 700,
    cursor: "pointer"
  } as CSSProperties,
  secondaryButton: {
    border: "1px solid rgba(31,41,55,0.12)",
    borderRadius: 999,
    background: "white",
    color: "#1f2937",
    padding: "10px 14px",
    fontWeight: 600,
    cursor: "pointer"
  } as CSSProperties,
  closeButton: {
    border: "1px solid rgba(31,41,55,0.12)",
    borderRadius: 999,
    background: "rgba(255,255,255,0.84)",
    color: "#334155",
    width: 36,
    height: 36,
    fontWeight: 700,
    textTransform: "uppercase",
    cursor: "pointer"
  } as CSSProperties,
  footer: {
    margin: "14px 0 0",
    fontSize: 12,
    color: "#64748b",
    lineHeight: 1.5
  } as CSSProperties
}
