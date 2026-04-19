import { useEffect, useRef, type CSSProperties } from "react"
import { ActionBar } from "../shared/ActionBar"
import { PromptCard } from "../shared/PromptCard"
import { SectionCard } from "../shared/SectionCard"
import type { PopupAction } from "../shared/types"
import type { ReviewPromptModeState } from "../../../lib/review-types"

type ReviewPromptModeProps = {
  state: ReviewPromptModeState
  promptActions: PopupAction[]
  onQuestionIndexChange: (index: number) => void
  onAnswerChange: (questionId: string, value: string) => void
  onOtherAnswerChange: (questionId: string, value: string) => void
  onAdvanceOther: () => void
  onGeneratePrompt: () => void
}

const OTHER_OPTION = "Other"

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
  const questionSectionRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!props.state.promptReady) return
    promptReadyRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    })
  }, [props.state.promptReady])

  useEffect(() => {
    if (!props.state.isLoadingQuestions) return
    questionSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    })
  }, [props.state.isLoadingQuestions, props.state.currentLevel, props.state.activeQuestionIndex])

  if (props.state.popupState === "error") {
    return (
      <SectionCard title="Prompt mode" subtitle="reeva AI couldn't start the prompt tree safely.">
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
      <SectionCard title="Planning goal" subtitle="Your current unsent prompt now anchors the next-step tree.">
        <p style={styles.goal}>{props.state.planningGoal}</p>
      </SectionCard>

      {visibleQuestions.length ? (
        <div ref={questionSectionRef}>
        <SectionCard
          title="Prompt tree"
          subtitle={`${answeredCount} answered · level ${props.state.currentLevel}`}
          headerAction={
            <button
              type="button"
              style={styles.secondaryButton(answeredCount < 1)}
              className={props.state.isGeneratingPrompt ? "cta-loading" : undefined}
              onClick={props.onGeneratePrompt}
              disabled={props.state.isGeneratingPrompt || props.state.isLoadingQuestions || answeredCount < 1}
            >
              {props.state.isGeneratingPrompt ? "Generating..." : "Generate prompt now"}
            </button>
          }
        >
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
                      onClick={() => props.onAnswerChange(activeQuestion.id, option)}
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
              You can stop partway through this tree and still generate an improved prompt from the answered path so far.
            </p>
          </div>
        </SectionCard>
        </div>
      ) : null}

      {props.state.promptReady ? (
        <div ref={promptReadyRef} style={styles.promptReadyWrap}>
          <ActionBar actions={props.promptActions} />
          <PromptCard
            label="Next best prompt"
            prompt={props.state.promptDraft}
            note="Built from your typed prompt, the answered branch so far, and the constraints captured in this session."
          />
        </div>
      ) : null}
    </>
  )
}

const styles = {
  goal: {
    margin: 0,
    fontSize: 16,
    lineHeight: 1.55,
    color: "#f7fbff",
    fontWeight: 700
  } satisfies CSSProperties,
  copy: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.55,
    color: "rgba(226, 235, 255, 0.76)"
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
      border: active ? "1px solid rgba(7,102,254,0.28)" : "1px solid rgba(148,163,184,0.2)",
      background: active ? "rgba(7,102,254,0.18)" : answered ? "rgba(121,216,168,0.16)" : "rgba(255,255,255,0.08)",
      color: active ? "#8bc4ff" : "#eef4ff",
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
    color: "#8bc4ff",
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
    color: "#f7fbff",
    fontWeight: 800
  } satisfies CSSProperties,
  questionHelper: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.55,
    color: "rgba(226, 235, 255, 0.72)"
  } satisfies CSSProperties,
  optionList: {
    display: "grid",
    gap: 10
  } satisfies CSSProperties,
  optionButton: (selected: boolean, disabled: boolean) =>
    ({
      border: selected ? "1px solid rgba(7,102,254,0.26)" : "1px solid rgba(255,255,255,0.12)",
      background: selected ? "rgba(7,102,254,0.16)" : "rgba(255,255,255,0.08)",
      color: selected ? "#8bc4ff" : "#eef4ff",
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
    border: "1px solid rgba(255,255,255,0.12)",
    padding: "12px 14px",
    fontSize: 14,
    lineHeight: 1.5,
    color: "#f7fbff",
    background: "rgba(8, 15, 32, 0.82)"
  } satisfies CSSProperties,
  footerRow: {
    display: "grid",
    gap: 10
  } satisfies CSSProperties,
  promptReadyWrap: {
    display: "grid",
    gap: 12
  } satisfies CSSProperties,
  primaryButton: {
    justifySelf: "flex-start",
    border: "none",
    borderRadius: 999,
    background: "linear-gradient(135deg, #0766fe 0%, #2d8cff 100%)",
    color: "#ffffff",
    padding: "12px 18px",
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 18px 34px rgba(7, 102, 254, 0.24)"
  } satisfies CSSProperties,
  secondaryButton: (disabled?: boolean) => ({
    justifySelf: "flex-start",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 999,
    background: disabled ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.08)",
    color: disabled ? "rgba(247,251,255,0.46)" : "#f7fbff",
    padding: "12px 18px",
    fontWeight: 800,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.72 : 1
  }) satisfies CSSProperties
}
