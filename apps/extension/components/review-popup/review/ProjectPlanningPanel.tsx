import { useEffect, useRef, useState, type CSSProperties } from "react"
import {
  buildProjectPlanningIntakeFields,
  buildProjectPlanningDebugText,
  buildVisiblePlanningOptions,
  deriveProjectPlanningNfrProfile,
  hasAnsweredPlanningQuestion,
  includesPlanningOption,
  PROJECT_PLANNING_INTAKE_QUESTIONS,
  PROJECT_PLANNING_OTHER_OPTION,
  type ProjectPlanningDebugPayload,
  type ProjectPlanningState
} from "../../../lib/project-planning/project-planning"

type ProjectPlanningPanelProps = {
  projectLabel: string
  platformLabel: string
  state: ProjectPlanningState
  isSaving: boolean
  isGeneratingDraft: boolean
  errorMessage: string | null
  copyMessage: string | null
  debugPayload: ProjectPlanningDebugPayload | null
  onDraftChange: (value: string) => void
  onQuestionIndexChange: (index: number) => void
  onAnswerChange: (questionId: string, value: string) => void
  onToggleMultiAnswer: (questionId: string, value: string) => void
  onOtherAnswerChange: (questionId: string, value: string) => void
  onAdvanceQuestion: () => void
  onBackToOnboarding: () => void
  onBackToIntake: () => void
  onBuildDraft: () => void
  onReturnToQuestions: () => void
  onCopyPrd: () => void
}

export function ProjectPlanningPanel(props: ProjectPlanningPanelProps) {
  const debugText = buildProjectPlanningDebugText(props.debugPayload)
  const debugPanel = debugText ? <ProjectPlanningDebugPanel debugText={debugText} /> : null
  const [generationStepIndex, setGenerationStepIndex] = useState(0)
  const [isFinishingGeneration, setIsFinishingGeneration] = useState(false)
  const [nfrAssumptionsExpanded, setNfrAssumptionsExpanded] = useState(false)
  const wasGeneratingDraftRef = useRef(false)
  const intakeAnswerValue = (questionId: string) => {
    const value = props.state.answerState[questionId]
    return typeof value === "string" ? value : ""
  }
  const nfrProfile = deriveProjectPlanningNfrProfile(
    buildProjectPlanningIntakeFields({
      description: props.state.description,
      answerState: props.state.answerState
    })
  )

  useEffect(() => {
    if (props.isGeneratingDraft) {
      setGenerationStepIndex(0)
      setIsFinishingGeneration(false)

      const intervalId = window.setInterval(() => {
        setGenerationStepIndex((current) => Math.min(current + 1, PRD_GENERATION_STEPS.length - 1))
      }, PRD_GENERATION_STEP_INTERVAL_MS)

      return () => window.clearInterval(intervalId)
    }
  }, [props.isGeneratingDraft])

  useEffect(() => {
    if (props.isGeneratingDraft) {
      wasGeneratingDraftRef.current = true
      return
    }

    if (wasGeneratingDraftRef.current && props.state.phase === "review" && props.state.generatedPrd) {
      wasGeneratingDraftRef.current = false
      setGenerationStepIndex(PRD_GENERATION_STEPS.length - 1)
      setIsFinishingGeneration(true)

      const timeoutId = window.setTimeout(() => {
        setIsFinishingGeneration(false)
      }, 950)

      return () => window.clearTimeout(timeoutId)
    }

    wasGeneratingDraftRef.current = false
  }, [props.isGeneratingDraft, props.state.phase, props.state.generatedPrd])

  useEffect(() => {
    if (props.state.phase === "intake") setNfrAssumptionsExpanded(false)
  }, [props.state.phase])

  if (props.isGeneratingDraft || isFinishingGeneration) {
    const activeStep = isFinishingGeneration
      ? PRD_GENERATION_DONE_STEP
      : PRD_GENERATION_STEPS[generationStepIndex] ?? PRD_GENERATION_STEPS[0]
    const completedStepIndex = isFinishingGeneration ? PRD_GENERATION_STEPS.length - 1 : generationStepIndex

    return (
      <div style={styles.layout}>
        <style>{PROJECT_PLANNING_SPINNER_KEYFRAMES}</style>
        <div style={styles.hero}>
          <p style={styles.eyebrow}>Project planning</p>
          <p style={styles.title}>
            {props.errorMessage ? "Regenerating PRD" : "Generating PRD"}
          </p>
        </div>

        <div style={styles.generationCard(isFinishingGeneration)} data-reeva-surface="planning-generation">
          <div style={isFinishingGeneration ? styles.generationCheck : styles.spinner}>
            {isFinishingGeneration ? "✓" : null}
          </div>
          <div style={styles.generationContent}>
            <p style={styles.generationTitle}>{activeStep.title}</p>
          </div>
        </div>

        <div style={styles.generationSteps}>
          {PRD_GENERATION_STEPS.map((step, index) => (
            <div key={step.title} style={styles.generationStep(index <= completedStepIndex)}>
              <span style={styles.generationDot(index <= completedStepIndex)} />
              <span>{step.title}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (props.state.phase === "review" && props.state.generatedPrd) {
    const coverage = props.state.coverageReport
    const generatedPrd = props.state.generatedPrd
    return (
      <div style={styles.layout}>
        <div style={styles.hero}>
          <p style={styles.eyebrow}>Project planning</p>
          <p style={styles.title}>Review your first PRD</p>
          <p style={styles.body}>{generatedPrd.summary}</p>
        </div>

        {coverage ? (
          <div style={styles.statusRow}>
            <span style={styles.progressLabel}>
              {coverage.summary.present} clear · {coverage.summary.partial} partial · {coverage.summary.conflicting} conflicting
            </span>
          </div>
        ) : null}

        {props.errorMessage ? (
          <div style={styles.errorCard}>
            <p style={styles.errorTitle}>PRD is saved, but submission needs your help</p>
            <p style={styles.errorBody}>{props.errorMessage}</p>
          </div>
        ) : null}

        <div style={styles.reviewCard} data-reeva-surface="planning-prd">
          <p style={styles.reviewTitle}>{generatedPrd.title}</p>
          <div style={styles.reviewSections}>
            {generatedPrd.sections.map((section) => (
              <div key={section.id} style={styles.reviewSection}>
                <p style={styles.reviewSectionTitle}>{section.title}</p>
                <p style={styles.reviewSectionBody}>{section.body}</p>
                {section.id === "implementation-phases" && generatedPrd.implementationPhases.length ? (
                  <div style={styles.phaseDetails}>
                    {generatedPrd.implementationPhases.map((phase) => (
                      <div key={phase.id} style={styles.phaseCard} data-reeva-surface="planning-phase">
                        <p style={styles.phaseTitle}>{phase.title}</p>
                        <p style={styles.reviewSectionBody}>{phase.goal}</p>
                        {phase.buildScope.length ? (
                          <>
                            <p style={styles.metaLabel}>Build scope</p>
                            <ul style={styles.phaseList}>
                              {phase.buildScope.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </>
                        ) : null}
                        {phase.outOfScope.length ? (
                          <>
                            <p style={styles.metaLabel}>Out of scope for this phase</p>
                            <ul style={styles.phaseList}>
                              {phase.outOfScope.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </>
                        ) : null}
                        {phase.dataState.length ? (
                          <>
                            <p style={styles.metaLabel}>Data/state needed</p>
                            <ul style={styles.phaseList}>
                              {phase.dataState.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </>
                        ) : null}
                        <p style={styles.metaLabel}>Deliverables</p>
                        <ul style={styles.phaseList}>
                          {phase.deliverables.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                        <p style={styles.metaLabel}>Acceptance criteria</p>
                        <ul style={styles.phaseList}>
                          {phase.acceptanceCriteria.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                        {phase.validationProof.length ? (
                          <>
                            <p style={styles.metaLabel}>Validation proof expected</p>
                            <ul style={styles.phaseList}>
                              {phase.validationProof.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {debugPanel}

        <div style={styles.actionRow}>
          <button
            type="button"
            style={styles.secondaryButton}
            onClick={props.state.questions.length ? props.onReturnToQuestions : props.onBackToIntake}
          >
            {props.state.questions.length ? "Back to questions" : "Back to intake"}
          </button>
          <button
            type="button"
            style={styles.primaryButton(props.isSaving)}
            onClick={props.onCopyPrd}
            disabled={props.isSaving}
          >
            {props.isSaving ? "Copying..." : "Copy PRD"}
          </button>
        </div>

        {props.copyMessage ? <div style={styles.copyStatus}>{props.copyMessage}</div> : null}
      </div>
    )
  }

  if (props.state.phase === "questions") {
    const activeQuestion = props.state.questions[props.state.activeQuestionIndex] ?? null
    const coverage = props.state.coverageReport
    const answeredCount = props.state.questions.filter((question) =>
      hasAnsweredPlanningQuestion(question, props.state.answerState, props.state.otherAnswerState)
    ).length
    const allQuestionsAnswered = answeredCount === props.state.questions.length
    const activeAnswer = activeQuestion ? props.state.answerState[activeQuestion.id] ?? "" : ""
    const activeOtherAnswer = activeQuestion ? props.state.otherAnswerState[activeQuestion.id] ?? "" : ""
    const activeQuestionAnswered = activeQuestion
      ? hasAnsweredPlanningQuestion(activeQuestion, props.state.answerState, props.state.otherAnswerState)
      : false
    const requiresContinue =
      !!activeQuestion &&
      ((activeQuestion.mode === "multi" &&
        Array.isArray(activeAnswer) &&
        activeAnswer.length > 0 &&
        (!activeAnswer.includes(PROJECT_PLANNING_OTHER_OPTION) || Boolean(activeOtherAnswer.trim()))) ||
        (activeQuestion.mode === "single" &&
          activeAnswer === PROJECT_PLANNING_OTHER_OPTION &&
          Boolean(activeOtherAnswer.trim())) ||
        (activeQuestion.mode === "freeform" && typeof activeAnswer === "string" && Boolean(activeAnswer.trim())))

    return (
      <div style={styles.layout}>
        <div style={styles.hero}>
          <p style={styles.eyebrow}>Project planning</p>
          <p style={styles.title}>Shape the first PRD draft</p>
        </div>

        <div style={styles.statusRow}>
          <span style={styles.statusChip}>Drafting</span>
          <span style={styles.progressLabel}>
            {answeredCount} answered · {props.state.questions.length} total
          </span>
        </div>

        {coverage ? (
          <div style={styles.statusRow}>
            <span style={styles.progressLabel}>
              {coverage.summary.present} clear · {coverage.summary.partial} partial · {coverage.summary.missing} missing
            </span>
          </div>
        ) : null}

        {props.errorMessage ? (
          <div style={styles.errorCard}>
            <p style={styles.errorTitle}>Planning needs another try</p>
            <p style={styles.errorBody}>{props.errorMessage}</p>
          </div>
        ) : null}

        {debugPanel}

        <div style={styles.tabRow}>
          {props.state.questions.map((question, index) => {
            const answered = hasAnsweredPlanningQuestion(question, props.state.answerState, props.state.otherAnswerState)
            const active = index === props.state.activeQuestionIndex

            return (
              <button
                key={question.id}
                type="button"
                style={styles.tab(active, answered)}
                onClick={() => props.onQuestionIndexChange(index)}
              >
                {index + 1}
              </button>
            )
          })}
        </div>

        {activeQuestion ? (
          <div style={styles.questionCard}>
            <p style={styles.questionLabel}>{activeQuestion.label}</p>
            <p style={styles.questionHelper}>{activeQuestion.helper}</p>

            {activeQuestion.mode === "freeform" ? (
              <textarea
                style={styles.questionTextarea}
                value={typeof activeAnswer === "string" ? activeAnswer : ""}
                onChange={(event) => props.onAnswerChange(activeQuestion.id, event.target.value)}
                placeholder={activeQuestion.placeholder}
              />
            ) : (
              <div style={styles.optionList}>
                {buildVisiblePlanningOptions(activeQuestion.options).map((option) => {
                  const selected = includesPlanningOption(activeAnswer, option)
                  return (
                    <button
                      key={option}
                      type="button"
                      style={styles.optionButton(selected)}
                      onClick={() =>
                        activeQuestion.mode === "multi"
                          ? props.onToggleMultiAnswer(activeQuestion.id, option)
                          : props.onAnswerChange(activeQuestion.id, option)
                      }
                    >
                      {option}
                    </button>
                  )
                })}
              </div>
            )}

            {(activeQuestion.mode !== "freeform" &&
              includesPlanningOption(activeAnswer, PROJECT_PLANNING_OTHER_OPTION)) ? (
              <textarea
                style={styles.questionTextarea}
                value={activeOtherAnswer}
                onChange={(event) => props.onOtherAnswerChange(activeQuestion.id, event.target.value)}
                placeholder="Add the missing detail in your own words."
              />
            ) : null}

            <div style={styles.actionRow}>
              <button type="button" style={styles.secondaryButton} onClick={props.onBackToIntake}>
                Back to intake
              </button>
              {props.state.activeQuestionIndex === props.state.questions.length - 1 ? (
                <button
                  type="button"
                  style={styles.primaryButton(!activeQuestionAnswered || !allQuestionsAnswered || props.isGeneratingDraft)}
                  onClick={props.onBuildDraft}
                  disabled={!activeQuestionAnswered || !allQuestionsAnswered || props.isGeneratingDraft}
                >
                  {props.isGeneratingDraft
                    ? props.errorMessage
                      ? "Regenerating PRD..."
                      : "Generating PRD..."
                    : props.errorMessage
                      ? "Retry PRD generation"
                      : "Generate PRD"}
                </button>
              ) : (
                <button
                  type="button"
                  style={styles.primaryButton(!requiresContinue)}
                  onClick={props.onAdvanceQuestion}
                  disabled={!requiresContinue}
                >
                  Continue
                </button>
              )}
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div style={styles.layout}>
      <div style={styles.hero}>
        <p style={styles.eyebrow}>Project planning</p>
        <p style={styles.title}>Start with your app idea</p>
      </div>

      <textarea
        style={styles.textarea}
        value={props.state.description}
        onChange={(event) => props.onDraftChange(event.target.value)}
        placeholder={`Example:\nAn app that helps people track how much water they drink.`}
      />

      <div style={styles.intakeFields}>
        {PROJECT_PLANNING_INTAKE_QUESTIONS.map((question) => (
          <label key={question.id} style={styles.intakeField}>
            <span style={styles.intakeLabel}>{question.label}</span>
            <span style={styles.intakeHelper}>{question.helper}</span>
            <textarea
              style={styles.intakeTextarea}
              value={intakeAnswerValue(question.id)}
              onChange={(event) => props.onAnswerChange(question.id, event.target.value)}
              placeholder={question.placeholder}
            />
          </label>
        ))}
      </div>

      <div style={styles.questionCard} data-reeva-surface="planning-nfr-assumptions">
        <p style={styles.questionLabel}>Based on your answers I&apos;ve assumed:</p>
        <p style={styles.questionHelper}>
          {nfrProfile.assumptions.length
            ? `${nfrProfile.assumptions.length} plain-language product rules are ready for your confirmation.`
            : "No additional access, data, or service assumptions are needed yet."}
        </p>
        {nfrAssumptionsExpanded ? (
          <>
            {nfrProfile.assumptions.length ? (
              <ul style={styles.phaseList}>
                {nfrProfile.assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
              </ul>
            ) : (
              <p style={styles.questionHelper}>The PRD will record these areas as not yet specified.</p>
            )}
            <p style={styles.questionHelper}>Change any of the four answers above, then review these assumptions again.</p>
          </>
        ) : null}
        <div style={styles.actionRow}>
          <button
            type="button"
            style={styles.secondaryButton}
            onClick={() => setNfrAssumptionsExpanded(true)}
            aria-expanded={nfrAssumptionsExpanded}
          >
            Change these
          </button>
          <button
            type="button"
            style={styles.primaryButton(!props.state.description.trim() || props.isGeneratingDraft)}
            onClick={props.onBuildDraft}
            disabled={!props.state.description.trim() || props.isGeneratingDraft}
          >
            {props.isGeneratingDraft ? "Generating PRD..." : "Looks right"}
          </button>
        </div>
      </div>

      {props.errorMessage ? (
        <div style={styles.errorCard}>
          <p style={styles.errorTitle}>Planning needs another try</p>
          <p style={styles.errorBody}>{props.errorMessage}</p>
        </div>
      ) : null}

      {debugPanel}

      <div style={styles.actionRow}>
        <button type="button" style={styles.secondaryButton} onClick={props.onBackToOnboarding}>
          Back
        </button>
      </div>
    </div>
  )
}

const PRD_GENERATION_STEPS = [
  {
    title: "Reading your app idea",
    body: ""
  },
  {
    title: "Shaping the PRD sections",
    body: ""
  },
  {
    title: "Creating implementation phases",
    body: ""
  },
  {
    title: "Preparing the assistant handoff",
    body: ""
  },
  {
    title: "Checking product coverage",
    body: ""
  },
  {
    title: "Finalizing the PRD",
    body: ""
  }
]
const PRD_GENERATION_STEP_INTERVAL_MS = 1800

const PRD_GENERATION_DONE_STEP = {
  title: "PRD ready",
  body: ""
}

const PROJECT_PLANNING_SPINNER_KEYFRAMES = `
@keyframes reeva-project-planning-spin {
  to { transform: rotate(360deg); }
}
`

function ProjectPlanningDebugPanel(props: { debugText: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle")

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(props.debugText)
      setCopyState("copied")
      window.setTimeout(() => setCopyState("idle"), 1400)
    } catch {
      setCopyState("failed")
      window.setTimeout(() => setCopyState("idle"), 1800)
    }
  }

  return (
    <div style={styles.debugCard}>
      <button type="button" style={styles.debugButton} onClick={() => void handleCopy()}>
        {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy debug"}
      </button>
    </div>
  )
}

const styles = {
  layout: {
    display: "grid",
    gap: 16
  },
  hero: {
    display: "grid",
    gap: 8
  },
  eyebrow: {
    margin: 0,
    fontSize: 12,
    letterSpacing: "0.22em",
    textTransform: "uppercase",
    color: "#64748b",
    fontWeight: 700
  },
  title: {
    margin: 0,
    fontSize: 22,
    lineHeight: 1.15,
    color: "#0f172a",
    fontWeight: 800
  },
  body: {
    margin: 0,
    fontSize: 15,
    lineHeight: 1.7,
    color: "#475569"
  },
  textarea: {
    width: "100%",
    minHeight: 220,
    resize: "vertical",
    borderRadius: 22,
    border: "1px solid rgba(148, 163, 184, 0.24)",
    padding: "16px 18px",
    fontSize: 14,
    lineHeight: 1.65,
    color: "#0f172a",
    background: "#ffffff",
    boxSizing: "border-box",
    outline: "none"
  },
  intakeFields: {
    display: "grid",
    gap: 12
  },
  intakeField: {
    display: "grid",
    gap: 6
  },
  intakeLabel: {
    fontSize: 15,
    lineHeight: 1.35,
    color: "#0f172a",
    fontWeight: 800
  },
  intakeHelper: {
    fontSize: 13,
    lineHeight: 1.5,
    color: "#64748b",
    fontWeight: 650
  },
  intakeTextarea: {
    width: "100%",
    minHeight: 88,
    resize: "vertical",
    borderRadius: 18,
    border: "1px solid rgba(148, 163, 184, 0.22)",
    padding: "13px 15px",
    fontSize: 14,
    lineHeight: 1.6,
    color: "#0f172a",
    background: "#ffffff",
    boxSizing: "border-box",
    outline: "none"
  },
  noticeCard: {
    borderRadius: 22,
    border: "1px solid rgba(37, 99, 235, 0.16)",
    background: "rgba(219, 234, 254, 0.38)",
    padding: "16px 18px",
    display: "grid",
    gap: 6
  },
  noticeTitle: {
    margin: 0,
    fontSize: 15,
    lineHeight: 1.3,
    color: "#1d4ed8",
    fontWeight: 800
  },
  noticeBody: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.6,
    color: "#475569"
  },
  errorCard: {
    borderRadius: 22,
    border: "1px solid rgba(239, 68, 68, 0.18)",
    background: "rgba(254, 242, 242, 0.9)",
    padding: "16px 18px",
    display: "grid",
    gap: 6
  },
  errorTitle: {
    margin: 0,
    fontSize: 15,
    lineHeight: 1.3,
    color: "#b91c1c",
    fontWeight: 800
  },
  errorBody: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.6,
    color: "#7f1d1d"
  },
  debugCard: {
    display: "flex",
    justifyContent: "flex-end",
    borderRadius: 18,
    border: "1px solid rgba(37,99,235,0.18)",
    background: "transparent",
    padding: 0
  },
  debugButton: {
    borderRadius: 14,
    border: "1px solid rgba(37,99,235,0.24)",
    background: "rgba(37,99,235,0.08)",
    color: "#1d4ed8",
    fontSize: 12,
    fontWeight: 800,
    padding: "10px 12px",
    cursor: "pointer",
    whiteSpace: "nowrap"
  },
  debugPre: {
    margin: 0,
    maxHeight: 220,
    overflow: "auto",
    borderRadius: 14,
    border: "1px solid rgba(148, 163, 184, 0.18)",
    background: "#020617",
    color: "#dbeafe",
    padding: 12,
    fontSize: 11,
    lineHeight: 1.55,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word"
  },
  generationCard: (complete = false): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 14,
    borderRadius: 24,
    border: complete ? "1px solid rgba(16, 185, 129, 0.18)" : "1px solid rgba(7,102,254,0.16)",
    background: complete ? "rgba(236, 253, 245, 0.82)" : "rgba(219,234,254,0.42)",
    padding: "18px 20px"
  }),
  spinner: {
    width: 28,
    height: 28,
    borderRadius: 999,
    border: "3px solid rgba(7,102,254,0.16)",
    borderTopColor: "#0766fe",
    animation: "reeva-project-planning-spin 900ms linear infinite",
    flex: "0 0 auto"
  },
  generationCheck: {
    width: 32,
    height: 32,
    borderRadius: 999,
    background: "#10b981",
    color: "#ffffff",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 18,
    fontWeight: 900,
    flex: "0 0 auto"
  },
  generationContent: {
    display: "grid",
    gap: 4
  },
  generationTitle: {
    margin: 0,
    fontSize: 16,
    lineHeight: 1.35,
    color: "#0f172a",
    fontWeight: 800
  },
  generationBody: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.6,
    color: "#475569"
  },
  generationSteps: {
    display: "grid",
    gap: 10
  },
  generationStep: (active: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    lineHeight: 1.4,
    color: active ? "#0f172a" : "#94a3b8",
    fontWeight: active ? 800 : 700
  }),
  generationDot: (active: boolean): CSSProperties => ({
    width: 9,
    height: 9,
    borderRadius: 999,
    background: active ? "#0766fe" : "rgba(148,163,184,0.45)"
  }),
  statusRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  statusChip: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    border: "1px solid rgba(37,99,235,0.16)",
    background: "rgba(219,234,254,0.62)",
    color: "#1d4ed8",
    fontSize: 13,
    fontWeight: 800,
    padding: "8px 12px"
  },
  progressLabel: {
    fontSize: 13,
    lineHeight: 1.4,
    color: "#64748b",
    fontWeight: 700
  },
  tabRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8
  },
  tab: (active: boolean, answered: boolean): CSSProperties => ({
    width: 36,
    height: 36,
    borderRadius: 14,
    border: active
      ? "1px solid rgba(7,102,254,0.28)"
      : answered
        ? "1px solid rgba(16,185,129,0.22)"
        : "1px solid rgba(148,163,184,0.16)",
    background: active ? "rgba(7,102,254,0.12)" : answered ? "rgba(16,185,129,0.10)" : "#ffffff",
    color: active ? "#0766fe" : answered ? "#047857" : "#475569",
    fontSize: 14,
    fontWeight: 800,
    cursor: "pointer"
  }),
  questionCard: {
    display: "grid",
    gap: 14,
    borderRadius: 24,
    border: "1px solid rgba(148,163,184,0.16)",
    background: "#ffffff",
    boxShadow: "0 18px 40px rgba(15,23,42,0.06)",
    padding: 18
  },
  questionLabel: {
    margin: 0,
    fontSize: 20,
    lineHeight: 1.35,
    color: "#0f172a",
    fontWeight: 800
  },
  questionHelper: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.7,
    color: "#475569"
  },
  optionList: {
    display: "grid",
    gap: 10
  },
  optionButton: (selected: boolean): CSSProperties => ({
    width: "100%",
    borderRadius: 18,
    border: selected ? "1px solid rgba(7,102,254,0.24)" : "1px solid rgba(148,163,184,0.16)",
    background: selected ? "rgba(7,102,254,0.09)" : "#ffffff",
    color: selected ? "#0f172a" : "#334155",
    padding: "14px 16px",
    textAlign: "left",
    fontSize: 14,
    lineHeight: 1.6,
    fontWeight: 700,
    cursor: "pointer"
  }),
  questionTextarea: {
    width: "100%",
    minHeight: 120,
    resize: "vertical",
    borderRadius: 18,
    border: "1px solid rgba(148,163,184,0.22)",
    background: "#ffffff",
    color: "#0f172a",
    fontSize: 14,
    lineHeight: 1.65,
    padding: "14px 16px",
    boxSizing: "border-box",
    outline: "none"
  },
  reviewCard: {
    display: "grid",
    gap: 16,
    borderRadius: 24,
    border: "1px solid rgba(37,99,235,0.16)",
    background: "linear-gradient(180deg, rgba(248,250,252,0.9), rgba(255,255,255,0.96))",
    boxShadow: "0 18px 40px rgba(15,23,42,0.06)",
    padding: 20
  },
  reviewTitle: {
    margin: 0,
    fontSize: 18,
    lineHeight: 1.3,
    color: "#0f172a",
    fontWeight: 800
  },
  reviewSections: {
    display: "grid",
    gap: 14
  },
  reviewSection: {
    display: "grid",
    gap: 6
  },
  reviewSectionTitle: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.3,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
    color: "#64748b",
    fontWeight: 800
  },
  reviewSectionBody: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.75,
    color: "#334155",
    whiteSpace: "pre-wrap"
  },
  submitHintCard: {
    borderRadius: 18,
    border: "1px solid rgba(14, 165, 233, 0.18)",
    background: "rgba(240, 249, 255, 0.86)",
    padding: "12px 14px"
  },
  submitHint: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.65,
    color: "#0369a1",
    fontWeight: 700
  },
  phaseDetails: {
    display: "grid",
    gap: 12,
    marginTop: 14
  },
  phaseCard: {
    display: "grid",
    gap: 8,
    borderRadius: 18,
    border: "1px solid rgba(37,99,235,0.16)",
    background: "linear-gradient(180deg, rgba(219,234,254,0.36), rgba(248,250,252,0.82))",
    padding: "16px 18px"
  },
  phaseTitle: {
    margin: 0,
    fontSize: 16,
    lineHeight: 1.35,
    color: "#0f172a",
    fontWeight: 800
  },
  metaLabel: {
    margin: "6px 0 0",
    fontSize: 12,
    lineHeight: 1.3,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
    color: "#64748b",
    fontWeight: 800
  },
  phaseList: {
    margin: "6px 0 0 18px",
    padding: 0,
    color: "#334155",
    fontSize: 14,
    lineHeight: 1.65
  },
  actionRow: {
    display: "flex",
    gap: 12
  },
  copyStatus: {
    marginTop: -2,
    borderRadius: 14,
    border: "1px solid rgba(34,197,94,0.28)",
    background: "rgba(220,252,231,0.8)",
    color: "#166534",
    fontSize: 13,
    lineHeight: 1.45,
    fontWeight: 800,
    padding: "12px 14px"
  },
  secondaryButton: {
    flex: 1,
    borderRadius: 18,
    border: "1px solid rgba(148, 163, 184, 0.22)",
    background: "#ffffff",
    color: "#0f172a",
    fontSize: 14,
    fontWeight: 700,
    padding: "14px 16px",
    cursor: "pointer"
  },
  primaryButton: (disabled: boolean): CSSProperties => ({
    flex: 1,
    borderRadius: 18,
    border: "none",
    background: disabled ? "rgba(226,232,240,0.7)" : "linear-gradient(135deg, #0766fe, #1d4ed8)",
    color: disabled ? "#94a3b8" : "#ffffff",
    fontSize: 14,
    fontWeight: 800,
    padding: "14px 16px",
    cursor: disabled ? "not-allowed" : "pointer",
    boxShadow: disabled ? "none" : "0 14px 28px rgba(7,102,254,0.20)"
  }),
  primaryButtonDisabled: {
    flex: 1,
    borderRadius: 18,
    border: "1px solid rgba(148, 163, 184, 0.18)",
    background: "rgba(226, 232, 240, 0.7)",
    color: "#94a3b8",
    fontSize: 14,
    fontWeight: 800,
    padding: "14px 16px",
    cursor: "not-allowed"
  }
} satisfies Record<string, CSSProperties | ((...args: never[]) => CSSProperties)>
