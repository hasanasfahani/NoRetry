import { useEffect, useRef, type CSSProperties } from "react"
import { ActionBar } from "../shared/ActionBar"
import { PromptCard } from "../shared/PromptCard"
import { SectionCard } from "../shared/SectionCard"
import type { PopupAction } from "../shared/types"
import type { ReviewPromptModeState } from "@prompt-optimizer/extension/lib/review/types"

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

export function ReviewPromptMode(props: ReviewPromptModeProps) {
  const promptReadyRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!props.state.promptReady) return
    promptReadyRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    })
  }, [props.state.promptReady])

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
  const answeredCount = props.state.questionHistory.filter((question) => {
    const raw = props.state.answerState[question.id]
    const other = props.state.otherAnswerState[question.id]?.trim()
    return Boolean(raw && (raw !== OTHER_OPTION || other))
  }).length

  return (
    <>
      <SectionCard title="Planning goal" subtitle="Your current unsent prompt now anchors the next-step tree.">
        <p style={styles.goal}>{props.state.planningGoal}</p>
        <p style={styles.copy}>
          reeva AI starts the branch from this typed prompt, so you do not need to re-enter the direction inside the popup.
        </p>
      </SectionCard>

      {visibleQuestions.length ? (
        <SectionCard title="Prompt tree" subtitle={`${answeredCount} answered · level ${props.state.currentLevel}`}>
          <div style={styles.tabHeader}>
            <div style={styles.tabRow}>
            {visibleQuestions.map((question, index) => {
              const rawValue = props.state.answerState[question.id]
              const otherValue = props.state.otherAnswerState[question.id]?.trim()
              const answered = Boolean(rawValue && (rawValue !== OTHER_OPTION || otherValue))
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
                  const selected = activeAnswer === option
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

              {activeAnswer === OTHER_OPTION ? (
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
                    disabled={props.state.isLoadingQuestions || !(props.state.otherAnswerState[activeQuestion.id] ?? "").trim()}
                  >
                    {props.state.isLoadingQuestions ? "Generating..." : "Continue"}
                  </button>
                </div>
              ) : null}

              {activeQuestion.mode === "multi" && activeAnswer !== OTHER_OPTION ? (
                <div style={styles.otherWrap}>
                  <button
                    type="button"
                    style={styles.primaryButton}
                    onClick={props.onAdvanceOther}
                    disabled={props.state.isLoadingQuestions || !activeAnswer.trim()}
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
            <button
              type="button"
              style={styles.secondaryButton}
              onClick={props.onGeneratePrompt}
              disabled={props.state.isGeneratingPrompt || props.state.isLoadingQuestions}
            >
              {props.state.isGeneratingPrompt ? "Generating..." : "Generate prompt now"}
            </button>
          </div>
        </SectionCard>
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
    color: "#0f172a",
    fontWeight: 700
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
      border: active ? "1px solid rgba(79,70,229,0.28)" : "1px solid rgba(148,163,184,0.2)",
      background: active ? "rgba(79,70,229,0.12)" : answered ? "rgba(220,252,231,0.82)" : "#ffffff",
      color: active ? "#4338ca" : "#1e293b",
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
    border: "1px solid rgba(79,70,229,0.16)",
    background: "rgba(79,70,229,0.08)",
    color: "#4338ca",
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
      background: "#4f46e5",
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
    border: "1px solid rgba(79,70,229,0.2)",
    borderRadius: 999,
    background: "rgba(79,70,229,0.08)",
    color: "#4338ca",
    padding: "12px 18px",
    fontWeight: 800,
    cursor: "pointer"
  } satisfies CSSProperties
}
