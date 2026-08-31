import { useEffect, useRef, useState, type CSSProperties } from "react"
import { ActionBar } from "../shared/ActionBar"
import { PromptCard } from "../shared/PromptCard"
import { SectionCard } from "../shared/SectionCard"
import { StatusBadge } from "../shared/StatusBadge"
import { WorkflowProgress } from "../shared/WorkflowProgress"
import type { PopupAction } from "../shared/types"
import type { ReviewPromptModeState } from "../../../lib/review/types"
import { workflowStateHelper } from "../../../lib/review/workflow-state"

type ReviewPromptModeProps = {
  state: ReviewPromptModeState
  projectContextStatus: "missing" | "active" | "stale" | "conflicted"
  projectContextConflictReasons: string[]
  promptActions: PopupAction[]
  onQuestionIndexChange: (index: number) => void
  onAnswerChange: (questionId: string, value: string) => void
  onToggleMultiAnswer: (questionId: string, value: string) => void
  onOtherAnswerChange: (questionId: string, value: string) => void
  onAdvanceOther: () => void
  onGeneratePrompt: () => void
  onReviewConflict: () => void
  onFixMissingContext: () => void
}

const OTHER_OPTION = "Other"

function ensureStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[]
  return value.map((item) => String(item).trim()).filter(Boolean)
}

function buildVisibleOptions(options: string[] | undefined) {
  const normalized = (options ?? []).map((option) => option.trim()).filter(Boolean)
  return [...normalized.filter((option) => option !== OTHER_OPTION), OTHER_OPTION]
}

function includesOption(value: string | string[], option: string) {
  return Array.isArray(value) ? value.includes(option) : value === option
}

function hasAnsweredValue(value: string | string[], otherValue?: string) {
  const other = otherValue?.trim() ?? ""
  if (Array.isArray(value)) {
    return value.length > 0 && (!value.includes(OTHER_OPTION) || Boolean(other))
  }
  return Boolean(value && (value !== OTHER_OPTION || other))
}

export function ReviewPromptMode(props: ReviewPromptModeProps) {
  const promptReadyRef = useRef<HTMLDivElement | null>(null)
  const generateButtonRef = useRef<HTMLButtonElement | null>(null)
  const draftingHelper = workflowStateHelper("drafting")
  const [briefExpanded, setBriefExpanded] = useState(false)
  const requestBriefScope = ensureStringArray(props.state.requestBrief?.scope)
  const requestBriefConstraints = ensureStringArray(props.state.requestBrief?.constraints)
  const requestBriefAssumptions = ensureStringArray(props.state.requestBrief?.assumptions)

  useEffect(() => {
    if (!props.state.promptReady) return
    promptReadyRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    })
  }, [props.state.promptReady])

  useEffect(() => {
    if (!props.state.branchReadyToGenerate || props.state.promptReady) return
    generateButtonRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    })
  }, [props.state.branchReadyToGenerate, props.state.promptReady])

  if (props.state.popupState === "error") {
    return (
      <SectionCard title="Next Move" subtitle="reeva AI couldn't start the next-move guide safely.">
        <p style={styles.copy}>{props.state.errorMessage ?? "Try typing a prompt and opening the popup again."}</p>
      </SectionCard>
    )
  }

  const visibleQuestions = props.state.questionHistory.length ? props.state.questionHistory : props.state.currentLevelQuestions
  const activeQuestion = props.state.questionHistory[props.state.activeQuestionIndex] ?? props.state.currentLevelQuestions[0] ?? null
  const activeAnswer = activeQuestion ? props.state.answerState[activeQuestion.id] ?? "" : ""
  const activeOtherAnswer = activeQuestion ? props.state.otherAnswerState[activeQuestion.id] ?? "" : ""
  const answeredCount = props.state.questionHistory.filter((question) => {
    const raw = props.state.answerState[question.id]
    const other = props.state.otherAnswerState[question.id]?.trim()
    return hasAnsweredValue(raw ?? "", other)
  }).length

  return (
    <>
      {props.projectContextStatus === "missing" ? (
        <SectionCard title="Project context" subtitle="Import project context so reeva AI can give more accurate, project-aware results.">
          <div style={styles.contextBanner}>
            <StatusBadge label="Context is missing" tone="warning" />
            <button type="button" style={styles.contextBannerAction} onClick={props.onFixMissingContext}>
              Fix it
            </button>
          </div>
        </SectionCard>
      ) : null}

      {props.projectContextStatus === "conflicted" && props.projectContextConflictReasons.length ? (
        <SectionCard title="Context conflicted" subtitle="This request may go beyond the saved project protections.">
          <div style={styles.conflictBanner}>
            <StatusBadge label="Needs attention" tone="danger" />
            <p style={styles.conflictCopy}>
              {props.projectContextConflictReasons[0]}
            </p>
            <button type="button" style={styles.conflictAction} onClick={props.onReviewConflict}>
              Review conflict
            </button>
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="Next move brief" subtitle="reeva AI inferred this PM-style brief from your typed request and will tighten it as you answer.">
        <div style={styles.briefSummaryWrap}>
          <div style={styles.briefSummaryTop}>
            <StatusBadge label="Drafting" tone="info" />
            {props.state.requestBrief ? (
              <span style={styles.riskChip(props.state.requestBrief.riskLevel)}>
                {props.state.requestBrief.riskLevel === "high"
                  ? "High risk"
                  : props.state.requestBrief.riskLevel === "medium"
                    ? "Medium risk"
                    : "Low risk"}
              </span>
            ) : null}
          </div>
          <p style={styles.goal}>{props.state.requestBrief?.goal ?? props.state.planningGoal}</p>
          {draftingHelper ? <p style={styles.workflowHelper}>{draftingHelper}</p> : null}
          <button
            type="button"
            style={styles.briefToggle}
            onClick={() => setBriefExpanded((current) => !current)}
          >
            {briefExpanded ? "Hide next move brief" : "View next move brief"}
          </button>
        </div>
        {briefExpanded ? (
          <>
            <div style={styles.workflowWrap}>
              <WorkflowProgress state="drafting" />
            </div>
            {props.state.requestBrief ? (
              <div style={styles.briefGrid}>
                {requestBriefScope.length ? (
                  <div style={styles.briefSection}>
                    <p style={styles.briefLabel}>Scope</p>
                    <div style={styles.briefList}>
                      {requestBriefScope.slice(0, 3).map((item) => (
                        <p key={`scope-${item}`} style={styles.briefItem}>
                          {item}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}

                {requestBriefConstraints.length ? (
                  <div style={styles.briefSection}>
                    <p style={styles.briefLabel}>Constraints</p>
                    <div style={styles.briefList}>
                      {requestBriefConstraints.slice(0, 3).map((item) => (
                        <p key={`constraint-${item}`} style={styles.briefItem}>
                          {item}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}

                {requestBriefAssumptions.length ? (
                  <div style={styles.briefSection}>
                    <p style={styles.briefLabel}>Assumptions for now</p>
                    <div style={styles.briefList}>
                      {requestBriefAssumptions.slice(0, 2).map((item) => (
                        <p key={`assumption-${item}`} style={styles.briefItem}>
                          {item}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div style={styles.riskWrap}>
                  <p style={styles.riskCopy}>{props.state.requestBrief.riskReason}</p>
                  <p style={styles.contractCopy}>
                    The generated prompt will also ask the coding assistant to confirm its understanding, scope, protected areas, risks, and validation plan.
                  </p>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </SectionCard>

      {visibleQuestions.length ? (
        <SectionCard title="Next Move questions" subtitle={`${answeredCount} answered · level ${props.state.currentLevel}`}>
          <div style={styles.tabHeader}>
            <div style={styles.tabRow}>
            {visibleQuestions.map((question, index) => {
              const rawValue = props.state.answerState[question.id]
              const otherValue = props.state.otherAnswerState[question.id]?.trim()
              const answered = hasAnsweredValue(rawValue ?? "", otherValue)
              const isActive = index === props.state.activeQuestionIndex

              return (
                <button
                  key={question.id}
                  type="button"
                  style={styles.tab(isActive, answered)}
                  onClick={() => props.onQuestionIndexChange(index)}
                  disabled={props.state.isLoadingQuestions}
                >
                  {index + 1}
                </button>
              )
            })}
            </div>

            {props.state.isLoadingQuestions ? (
              <div style={styles.loadingBadge} aria-live="polite">
                <span style={styles.loadingDots} aria-hidden="true">
                  <span style={styles.loadingDot(1)} />
                  <span style={styles.loadingDot(0.7)} />
                  <span style={styles.loadingDot(0.45)} />
                </span>
                <span>Generating the next question…</span>
              </div>
            ) : null}
          </div>

          {activeQuestion ? (
            <div style={styles.questionCard}>
              <p style={styles.questionLabel}>{activeQuestion.label}</p>
              <p style={styles.questionHelper}>{activeQuestion.helper}</p>

              <div style={styles.optionList}>
                {buildVisibleOptions(activeQuestion.options).map((option) => {
                  const selected = includesOption(activeAnswer, option)
                  return (
                    <button
                      key={option}
                      type="button"
                      style={styles.optionButton(selected, props.state.isLoadingQuestions)}
                      onClick={() =>
                        activeQuestion.mode === "multi"
                          ? props.onToggleMultiAnswer(activeQuestion.id, option)
                          : props.onAnswerChange(activeQuestion.id, option)
                      }
                      disabled={props.state.isLoadingQuestions}
                    >
                      {option}
                    </button>
                  )
                })}
              </div>

              {includesOption(activeAnswer, OTHER_OPTION) ? (
                <div style={styles.otherWrap}>
                  <textarea
                    style={styles.textarea}
                    value={props.state.otherAnswerState[activeQuestion.id] ?? ""}
                    onChange={(event) => props.onOtherAnswerChange(activeQuestion.id, event.target.value)}
                    placeholder="Type the branch detail you want reeva AI to use next."
                    disabled={props.state.isLoadingQuestions}
                  />
                  <button
                    type="button"
                    style={styles.primaryButton}
                    onClick={props.onAdvanceOther}
                    disabled={props.state.isLoadingQuestions || !activeOtherAnswer.trim()}
                  >
                    {props.state.isLoadingQuestions ? "Generating..." : "Continue"}
                  </button>
                </div>
              ) : null}

              {activeQuestion.mode === "multi" && !includesOption(activeAnswer, OTHER_OPTION) ? (
                <div style={styles.otherWrap}>
                  <button
                    type="button"
                    style={styles.primaryButton}
                    onClick={props.onAdvanceOther}
                    disabled={props.state.isLoadingQuestions || !Array.isArray(activeAnswer) || activeAnswer.length === 0}
                  >
                    {props.state.isLoadingQuestions ? "Generating..." : "Continue"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          <div style={styles.footerRow}>
            <p style={styles.copy}>
              You can stop partway through this guide and still generate a scoped prompt from the answered path so far.
            </p>
            {props.state.branchStatusMessage ? (
              <div style={styles.readyBadge} aria-live="polite">
                {props.state.branchStatusMessage}
              </div>
            ) : null}
            <button
              ref={generateButtonRef}
              type="button"
              style={props.state.branchReadyToGenerate ? styles.readyButton : styles.secondaryButton}
              onClick={props.onGeneratePrompt}
              disabled={props.state.isGeneratingPrompt || props.state.isLoadingQuestions}
            >
              {props.state.isGeneratingPrompt
                ? "Generating..."
                : props.state.branchReadyToGenerate
                  ? "Generate Next Move prompt"
                  : "Generate Next Move prompt"}
            </button>
          </div>
        </SectionCard>
      ) : null}

      {props.state.promptReady ? (
        <div ref={promptReadyRef} style={styles.promptReadyWrap}>
          <ActionBar actions={props.promptActions} />
          <PromptCard
            label="Next Move prompt"
            prompt={props.state.promptDraft}
            note="Built from your typed prompt, the answered branch so far, and the constraints captured in this session."
          />
        </div>
      ) : null}
    </>
  )
}

const styles = {
  briefSummaryWrap: {
    display: "grid",
    gap: 10
  } satisfies CSSProperties,
  briefSummaryTop: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap"
  } satisfies CSSProperties,
  workflowWrap: {
    display: "grid",
    gap: 10
  } satisfies CSSProperties,
  conflictBanner: {
    display: "grid",
    gap: 12,
    borderRadius: 18,
    border: "1px solid rgba(239,68,68,0.18)",
    background: "linear-gradient(180deg, rgba(254,242,242,0.94), rgba(255,255,255,0.98))",
    padding: 14
  } satisfies CSSProperties,
  contextBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap"
  } satisfies CSSProperties,
  contextBannerAction: {
    border: "1px solid rgba(245,158,11,0.18)",
    borderRadius: 999,
    background: "rgba(255,251,235,0.98)",
    color: "#b45309",
    padding: "10px 14px",
    fontSize: 12,
    lineHeight: 1.2,
    fontWeight: 800,
    cursor: "pointer"
  } satisfies CSSProperties,
  conflictCopy: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.55,
    color: "#7f1d1d",
    fontWeight: 600
  } satisfies CSSProperties,
  conflictAction: {
    justifySelf: "start",
    border: "1px solid rgba(239,68,68,0.18)",
    borderRadius: 999,
    background: "#ffffff",
    color: "#b91c1c",
    padding: "10px 14px",
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer"
  } satisfies CSSProperties,
  workflowHelper: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.5,
    color: "#475569"
  } satisfies CSSProperties,
  briefToggle: {
    justifySelf: "flex-start",
    border: "none",
    background: "transparent",
    color: "#0766fe",
    padding: 0,
    fontSize: 13,
    lineHeight: 1.3,
    fontWeight: 800,
    cursor: "pointer"
  } satisfies CSSProperties,
  goal: {
    margin: 0,
    fontSize: 16,
    lineHeight: 1.55,
    color: "#0f172a",
    fontWeight: 700
  } satisfies CSSProperties,
  briefGrid: {
    display: "grid",
    gap: 12
  } satisfies CSSProperties,
  briefSection: {
    display: "grid",
    gap: 6
  } satisfies CSSProperties,
  briefLabel: {
    margin: 0,
    fontSize: 12,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#64748b",
    fontWeight: 800
  } satisfies CSSProperties,
  briefList: {
    display: "grid",
    gap: 6
  } satisfies CSSProperties,
  briefItem: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.5,
    color: "#334155"
  } satisfies CSSProperties,
  riskWrap: {
    display: "grid",
    gap: 8
  } satisfies CSSProperties,
  riskChip: (risk: "low" | "medium" | "high") =>
    ({
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "fit-content",
      padding: "6px 10px",
      borderRadius: 999,
      background:
        risk === "high"
          ? "rgba(239,68,68,0.12)"
          : risk === "medium"
            ? "rgba(245,158,11,0.12)"
            : "rgba(7,102,254,0.12)",
      color: risk === "high" ? "#b91c1c" : risk === "medium" ? "#b45309" : "#075fd6",
      fontSize: 12,
      fontWeight: 800,
      letterSpacing: "0.04em",
      textTransform: "uppercase"
    }) satisfies CSSProperties,
  riskCopy: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: "#475569"
  } satisfies CSSProperties,
  contractCopy: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: "#1d4ed8",
    fontWeight: 600
  } satisfies CSSProperties,
  copy: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.55,
    color: "#475569"
  } satisfies CSSProperties,
  tabHeader: {
    display: "grid",
    gap: 10
  } satisfies CSSProperties,
  tabRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8
  } satisfies CSSProperties,
  tab: (active: boolean, answered: boolean) =>
    ({
      border: active ? "1px solid rgba(7,102,254,0.24)" : "1px solid rgba(148,163,184,0.2)",
      background: active ? "rgba(7,102,254,0.1)" : answered ? "rgba(220,252,231,0.82)" : "#ffffff",
      color: active ? "#0766fe" : "#1e293b",
      width: 34,
      height: 34,
      borderRadius: 999,
      fontWeight: 800,
      cursor: "pointer",
      opacity: active ? 1 : answered ? 1 : 0.96
    }) satisfies CSSProperties,
  loadingBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    alignSelf: "flex-start",
    padding: "10px 12px",
    borderRadius: 999,
    border: "1px solid rgba(7,102,254,0.16)",
    background: "rgba(7,102,254,0.08)",
    color: "#0766fe",
    fontSize: 13,
    lineHeight: 1.4,
    fontWeight: 700
  } satisfies CSSProperties,
  loadingDots: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4
  } satisfies CSSProperties,
  loadingDot: (opacity: number) =>
    ({
      width: 7,
      height: 7,
      borderRadius: 999,
      background: "#0766fe",
      opacity
    }) satisfies CSSProperties,
  questionCard: {
    display: "grid",
    gap: 12
  } satisfies CSSProperties,
  questionLabel: {
    margin: 0,
    fontSize: 20,
    lineHeight: 1.2,
    color: "#0f172a",
    fontWeight: 800
  } satisfies CSSProperties,
  questionHelper: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.55,
    color: "#64748b"
  } satisfies CSSProperties,
  optionList: {
    display: "grid",
    gap: 10
  } satisfies CSSProperties,
  optionButton: (selected: boolean, disabled: boolean) =>
    ({
      border: selected ? "1px solid rgba(79,70,229,0.26)" : "1px solid rgba(148,163,184,0.2)",
      background: selected ? "rgba(79,70,229,0.12)" : "#ffffff",
      color: selected ? "#312e81" : "#1e293b",
      padding: "13px 14px",
      borderRadius: 18,
      textAlign: "left",
      cursor: disabled ? "wait" : "pointer",
      fontSize: 14,
      lineHeight: 1.5,
      fontWeight: selected ? 700 : 600,
      opacity: disabled ? 0.72 : 1
    }) satisfies CSSProperties,
  otherWrap: {
    display: "grid",
    gap: 10
  } satisfies CSSProperties,
  textarea: {
    width: "100%",
    minHeight: 100,
    resize: "vertical",
    borderRadius: 16,
    border: "1px solid rgba(148,163,184,0.24)",
    padding: "12px 14px",
    fontSize: 14,
    lineHeight: 1.5,
    color: "#0f172a",
    background: "#ffffff"
  } satisfies CSSProperties,
  footerRow: {
    display: "grid",
    gap: 10
  } satisfies CSSProperties,
  readyBadge: {
    borderRadius: 16,
    border: "1px solid rgba(7,102,254,0.18)",
    background: "rgba(7,102,254,0.08)",
    color: "#1d4ed8",
    padding: "12px 14px",
    fontSize: 13,
    lineHeight: 1.5,
    fontWeight: 700
  } satisfies CSSProperties,
  promptReadyWrap: {
    display: "grid",
    gap: 12
  } satisfies CSSProperties,
  primaryButton: {
    justifySelf: "flex-start",
    border: "none",
    borderRadius: 999,
    background: "#0f172a",
    color: "#ffffff",
    padding: "12px 18px",
    fontWeight: 800,
    cursor: "pointer"
  } satisfies CSSProperties,
  secondaryButton: {
    justifySelf: "flex-start",
    border: "1px solid rgba(7,102,254,0.2)",
    borderRadius: 999,
    background: "rgba(7,102,254,0.08)",
    color: "#0766fe",
    padding: "12px 18px",
    fontWeight: 800,
    cursor: "pointer"
  } satisfies CSSProperties,
  readyButton: {
    justifySelf: "flex-start",
    border: "1px solid rgba(7,102,254,0.22)",
    borderRadius: 999,
    background: "#0766fe",
    color: "#ffffff",
    padding: "12px 18px",
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 10px 24px rgba(7,102,254,0.24)"
  } satisfies CSSProperties
}
