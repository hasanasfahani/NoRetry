import type { CSSProperties } from "react"
import { SectionCard } from "../shared/SectionCard"
import type { ReviewPromptModeV2Question, ReviewPromptModeV2State } from "../../../lib/review/types"
import type { ReviewPromptModeV2RequestType } from "../../../lib/review/v2/request-types"

type ReviewPromptModeV2Props = {
  state: ReviewPromptModeV2State
  onTaskTypeSelect: (taskType: ReviewPromptModeV2RequestType) => void
  onContinueFromEntry: () => void
  onQuestionIndexChange: (index: number) => void
  onQuestionAnswerChange: (questionId: string, value: string) => void
  onQuestionMultiToggle: (questionId: string, value: string) => void
  onContinueQuestion: () => void
  onGeneratePrompt: () => void
}

function buildVisibleOptions(question: ReviewPromptModeV2Question) {
  return question.options.map((option) => option.trim()).filter(Boolean)
}

function selectedMultiValues(value: string | string[] | undefined) {
  return Array.isArray(value) ? value : typeof value === "string" && value ? [value] : []
}

function isAnswered(question: ReviewPromptModeV2Question, state: ReviewPromptModeV2State) {
  const raw = state.answerState[question.id]
  if (Array.isArray(raw)) {
    return raw.some((item) => item)
  }
  if (typeof raw === "string") {
    return Boolean(raw.trim())
  }
  return false
}

export function ReviewPromptModeV2(props: ReviewPromptModeV2Props) {
  if (props.state.popupState === "error") {
    return (
      <SectionCard title="Prompt Mode v2" subtitle="The new structured builder could not start safely.">
        <p style={styles.copy}>{props.state.errorMessage ?? "Try again after typing a fresh prompt."}</p>
      </SectionCard>
    )
  }

  const activeQuestion = props.state.questionHistory[props.state.activeQuestionIndex] ?? null
  const activeAnswer = activeQuestion ? props.state.answerState[activeQuestion.id] : undefined
  const activeMultiValues = selectedMultiValues(activeAnswer)
  const shouldShowContinueButton = activeQuestion?.mode === "multi"
  const continueDisabled = !activeQuestion
    ? true
    : activeQuestion.mode === "multi"
      ? activeMultiValues.length === 0
      : true

  return (
    <>
      <SectionCard title="Prompt Mode v2" subtitle="A separate structured path that works section by section.">
        <p style={styles.goal}>{props.state.sourcePrompt}</p>
        <div style={styles.metaGrid}>
          <p style={styles.metaLine}>
            <strong>Intent confidence:</strong> {props.state.intentConfidence}
          </p>
          <p style={styles.metaLine}>
            <strong>Primary task type:</strong> {props.state.selectedTaskType ? props.state.selectedTaskType.replace(/_/g, " ") : "Choose one below"}
          </p>
        </div>
        {props.state.progress ? (
          <div style={styles.progressWrap}>
            <div style={styles.progressHeader}>
              <div style={styles.progressMeta}>
                <p style={styles.progressTitle}>Progress</p>
                <p style={styles.progressSummary}>{props.state.progress.summary}</p>
              </div>
              <div style={styles.progressBadges}>
                <span style={styles.scoreBadge("progress")}>
                  Progress: {props.state.progress.progressLabel}
                </span>
                <span style={styles.scoreBadge("strength")}>
                  Prompt strength: {props.state.progress.strengthLabel}
                </span>
              </div>
            </div>
            <div style={styles.progressTrack}>
              <div style={styles.progressFill("progress", props.state.progress.progressScore)} />
            </div>
            <div style={styles.progressTrack}>
              <div style={styles.progressFill("strength", props.state.progress.strengthScore)} />
            </div>
            <div style={styles.progressFooter}>
              <p style={styles.progressHint}>
                {props.state.progress.resolvedSectionCount}/{props.state.progress.totalSectionCount} sections resolved
              </p>
              {props.state.progress.nextLevelLabel ? (
                <p style={styles.progressHint}>
                  {props.state.progress.meaningfulStepsToNextLevel} more meaningful {props.state.progress.meaningfulStepsToNextLevel === 1 ? "step" : "steps"} to reach{" "}
                  {props.state.progress.nextLevelLabel}
                </p>
              ) : (
                <p style={styles.progressHint}>You have reached the top progress tier.</p>
              )}
            </div>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="Choose one primary task type" subtitle="The chips are suggestions. You still decide which v2 path to use.">
        <div style={styles.chipWrap}>
          {props.state.likelyTaskTypes.map((chip) => {
            const selected = props.state.selectedTaskType === chip.type
            return (
              <button key={chip.type} type="button" style={styles.chip(selected)} onClick={() => props.onTaskTypeSelect(chip.type)}>
                <span style={styles.chipTitle}>
                  {chip.label}
                  {chip.suggested ? <span style={styles.suggestedTag}>Suggested</span> : null}
                </span>
                <span style={styles.chipReason}>{chip.reason}</span>
              </button>
            )
          })}
        </div>
      </SectionCard>

      {props.state.selectedTaskType ? (
        <SectionCard title="Section status" subtitle="Prompt Mode v2 asks only for sections that are still unresolved or only partially resolved.">
          <div style={styles.sectionGrid}>
            {props.state.sections.map((section) => (
              <div key={section.id} style={styles.sectionStatus(section.status)}>
                <p style={styles.sectionLabel}>{section.label}</p>
                <p style={styles.sectionMeta}>
                  {section.status.replace(/_/g, " ")} · target {section.targetQuestionRange.min}-{section.targetQuestionRange.max}
                </p>
                {section.resolvedContent.length ? (
                  <div style={styles.signalGroup}>
                    <p style={styles.signalLabel}>Resolved content</p>
                    <p style={styles.sectionSignals}>{section.resolvedContent.join(" · ")}</p>
                  </div>
                ) : null}
                {section.partialContent.length ? (
                  <div style={styles.signalGroup}>
                    <p style={styles.signalLabel}>Partially resolved</p>
                    <p style={styles.sectionSignals}>{section.partialContent.join(" · ")}</p>
                  </div>
                ) : null}
                {section.unresolvedGaps.length ? (
                  <div style={styles.signalGroup}>
                    <p style={styles.signalLabel}>Unresolved gaps</p>
                    <p style={styles.sectionSignals}>{section.unresolvedGaps.join(" · ")}</p>
                  </div>
                ) : null}
                {section.contradictions.length ? (
                  <div style={styles.signalGroup}>
                    <p style={styles.signalLabel}>Conflicts to resolve</p>
                    <p style={styles.sectionSignals}>{section.contradictions.join(" · ")}</p>
                  </div>
                ) : null}
              </div>
            ))}
            {props.state.additionalNotes.length ? (
              <div style={styles.sectionStatus("partially_resolved")}>
                <p style={styles.sectionLabel}>Additional notes</p>
                <p style={styles.sectionMeta}>Preserved safely because the merge confidence was too low.</p>
                <p style={styles.sectionSignals}>{props.state.additionalNotes.join(" · ")}</p>
              </div>
            ) : null}
          </div>
        </SectionCard>
      ) : null}

      {props.state.selectedTaskType && props.state.questionHistory.length ? (
        <SectionCard title="Adaptive questions" subtitle="Only unresolved sections keep asking questions, using structured single-select and multi-select choices.">
          <div style={styles.tabRow}>
            {props.state.questionHistory.map((question, index) => (
              <button
                key={question.id}
                type="button"
                style={styles.tab(index === props.state.activeQuestionIndex, isAnswered(question, props.state))}
                onClick={() => props.onQuestionIndexChange(index)}
              >
                {index + 1}
              </button>
            ))}
          </div>

          {activeQuestion ? (
            <div style={styles.questionCard}>
              <p style={styles.questionLabel}>{activeQuestion.label}</p>
              <p style={styles.questionHelper}>
                {activeQuestion.sectionLabel} · {activeQuestion.helper}
              </p>

              <div style={styles.optionList}>
                {buildVisibleOptions(activeQuestion).map((option) => {
                  const selected =
                    activeQuestion.mode === "multi"
                      ? selectedMultiValues(activeAnswer).includes(option)
                      : activeAnswer === option
                  return (
                    <button
                      key={option}
                      type="button"
                      style={styles.optionButton(selected)}
                      onClick={() =>
                        activeQuestion.mode === "multi"
                          ? props.onQuestionMultiToggle(activeQuestion.id, option)
                          : props.onQuestionAnswerChange(activeQuestion.id, option)
                      }
                    >
                      {option}
                    </button>
                  )
                })}
              </div>

              {shouldShowContinueButton ? (
                <button type="button" style={styles.primaryButton} onClick={props.onContinueQuestion} disabled={continueDisabled}>
                  Continue
                </button>
              ) : null}
            </div>
          ) : null}
        </SectionCard>
      ) : null}

      {props.state.selectedTaskType ? (
        <SectionCard title="Prompt assembly" subtitle="Generate a structured v2 prompt from the normalized section state and validate what still needs attention.">
          <div style={styles.assemblyActions}>
            <button type="button" style={styles.primaryButton} onClick={props.onGeneratePrompt} disabled={props.state.isGeneratingPrompt}>
              {props.state.promptReady ? "Regenerate prompt" : props.state.isGeneratingPrompt ? "Generating..." : "Generate prompt"}
            </button>
          </div>

          {props.state.assemblyErrorMessage ? (
            <div style={styles.errorBox}>
              <p style={styles.errorTitle}>Prompt assembly failed</p>
              <p style={styles.copy}>{props.state.assemblyErrorMessage}</p>
              <button type="button" style={styles.primaryButton} onClick={props.onGeneratePrompt}>
                Regenerate
              </button>
            </div>
          ) : null}

          {props.state.validation ? (
            <div style={styles.validationGrid}>
              {props.state.validation.missingItems.length ? (
                <div style={styles.validationBlock}>
                  <p style={styles.signalLabel}>Missing items</p>
                  <p style={styles.sectionSignals}>{props.state.validation.missingItems.join(" · ")}</p>
                </div>
              ) : null}
              {props.state.validation.assumedItems.length ? (
                <div style={styles.validationBlock}>
                  <p style={styles.signalLabel}>Assumed items</p>
                  <p style={styles.sectionSignals}>{props.state.validation.assumedItems.join(" · ")}</p>
                </div>
              ) : null}
              {props.state.validation.contradictions.length ? (
                <div style={styles.validationBlock}>
                  <p style={styles.signalLabel}>Contradictions</p>
                  <p style={styles.sectionSignals}>{props.state.validation.contradictions.join(" · ")}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {props.state.promptReady && props.state.promptDraft.trim() ? (
            <pre style={styles.promptDraft}>{props.state.promptDraft}</pre>
          ) : null}
        </SectionCard>
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
    lineHeight: 1.6,
    color: "#475569"
  } satisfies CSSProperties,
  metaGrid: {
    display: "grid",
    gap: 6
  } satisfies CSSProperties,
  metaLine: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: "#334155"
  } satisfies CSSProperties,
  progressWrap: {
    display: "grid",
    gap: 10,
    padding: "14px 16px",
    borderRadius: 18,
    background: "#f8fafc",
    border: "1px solid rgba(148,163,184,0.18)"
  } satisfies CSSProperties,
  progressHeader: {
    display: "grid",
    gap: 10
  } satisfies CSSProperties,
  progressMeta: {
    display: "grid",
    gap: 4
  } satisfies CSSProperties,
  progressTitle: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.4,
    fontWeight: 800,
    color: "#0f172a"
  } satisfies CSSProperties,
  progressSummary: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: "#475569"
  } satisfies CSSProperties,
  progressBadges: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8
  } satisfies CSSProperties,
  scoreBadge: (kind: "progress" | "strength") =>
    ({
      display: "inline-flex",
      alignItems: "center",
      padding: "4px 10px",
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 800,
      background: kind === "progress" ? "rgba(37,99,235,0.12)" : "rgba(22,163,74,0.12)",
      color: kind === "progress" ? "#1d4ed8" : "#15803d"
    }) satisfies CSSProperties,
  progressTrack: {
    width: "100%",
    height: 10,
    borderRadius: 999,
    background: "rgba(148,163,184,0.16)",
    overflow: "hidden"
  } satisfies CSSProperties,
  progressFill: (kind: "progress" | "strength", score: number) =>
    ({
      width: `${Math.max(4, score)}%`,
      height: "100%",
      borderRadius: 999,
      background:
        kind === "progress"
          ? "linear-gradient(90deg, #60a5fa 0%, #2563eb 100%)"
          : "linear-gradient(90deg, #86efac 0%, #16a34a 100%)"
    }) satisfies CSSProperties,
  progressFooter: {
    display: "grid",
    gap: 4
  } satisfies CSSProperties,
  progressHint: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.5,
    color: "#64748b"
  } satisfies CSSProperties,
  questionWrap: {
    display: "grid",
    gap: 8,
    padding: 14,
    borderRadius: 18,
    background: "rgba(59,130,246,0.08)",
    border: "1px solid rgba(59,130,246,0.16)"
  } satisfies CSSProperties,
  chipWrap: {
    display: "grid",
    gap: 10
  } satisfies CSSProperties,
  chip: (selected: boolean) =>
    ({
      display: "grid",
      gap: 6,
      textAlign: "left",
      padding: "14px 16px",
      borderRadius: 18,
      border: selected ? "1px solid rgba(37,99,235,0.32)" : "1px solid rgba(148,163,184,0.2)",
      background: selected ? "rgba(37,99,235,0.10)" : "#ffffff",
      cursor: "pointer"
    }) satisfies CSSProperties,
  chipTitle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 15,
    lineHeight: 1.4,
    fontWeight: 800,
    color: "#0f172a"
  } satisfies CSSProperties,
  suggestedTag: {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 800,
    background: "rgba(37,99,235,0.12)",
    color: "#1d4ed8"
  } satisfies CSSProperties,
  chipReason: {
    fontSize: 13,
    lineHeight: 1.5,
    color: "#475569"
  } satisfies CSSProperties,
  sectionGrid: {
    display: "grid",
    gap: 10
  } satisfies CSSProperties,
  sectionStatus: (status: ReviewPromptModeV2State["sections"][number]["status"]) =>
    ({
      display: "grid",
      gap: 4,
      padding: "12px 14px",
      borderRadius: 16,
      border: status === "resolved" ? "1px solid rgba(22,163,74,0.18)" : status === "partially_resolved" ? "1px solid rgba(245,158,11,0.18)" : "1px solid rgba(148,163,184,0.18)",
      background: status === "resolved" ? "rgba(220,252,231,0.7)" : status === "partially_resolved" ? "rgba(254,249,195,0.85)" : "#ffffff"
    }) satisfies CSSProperties,
  sectionLabel: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.4,
    fontWeight: 800,
    color: "#0f172a"
  } satisfies CSSProperties,
  sectionMeta: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.4,
    color: "#475569"
  } satisfies CSSProperties,
  sectionSignals: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.5,
    color: "#334155"
  } satisfies CSSProperties,
  signalGroup: {
    display: "grid",
    gap: 2
  } satisfies CSSProperties,
  signalLabel: {
    margin: 0,
    fontSize: 11,
    lineHeight: 1.35,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: 0.3,
    color: "#64748b"
  } satisfies CSSProperties,
  tabRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8
  } satisfies CSSProperties,
  tab: (active: boolean, answered: boolean) =>
    ({
      border: active ? "1px solid rgba(37,99,235,0.3)" : "1px solid rgba(148,163,184,0.22)",
      background: active ? "rgba(37,99,235,0.12)" : answered ? "rgba(220,252,231,0.82)" : "#ffffff",
      width: 34,
      height: 34,
      borderRadius: 999,
      fontWeight: 800,
      cursor: "pointer"
    }) satisfies CSSProperties,
  questionCard: {
    display: "grid",
    gap: 12
  } satisfies CSSProperties,
  questionLabel: {
    margin: 0,
    fontSize: 18,
    lineHeight: 1.25,
    fontWeight: 800,
    color: "#0f172a"
  } satisfies CSSProperties,
  questionHelper: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.6,
    color: "#64748b"
  } satisfies CSSProperties,
  optionList: {
    display: "grid",
    gap: 10
  } satisfies CSSProperties,
  optionButton: (selected: boolean) =>
    ({
      border: selected ? "1px solid rgba(37,99,235,0.32)" : "1px solid rgba(148,163,184,0.2)",
      background: selected ? "rgba(37,99,235,0.10)" : "#ffffff",
      color: "#0f172a",
      padding: "13px 14px",
      borderRadius: 18,
      textAlign: "left",
      cursor: "pointer",
      fontSize: 14,
      lineHeight: 1.5,
      fontWeight: selected ? 700 : 600
    }) satisfies CSSProperties,
  otherWrap: {
    display: "grid",
    gap: 10
  } satisfies CSSProperties,
  textarea: {
    width: "100%",
    minHeight: 96,
    resize: "vertical",
    borderRadius: 16,
    border: "1px solid rgba(148,163,184,0.24)",
    padding: "12px 14px",
    fontSize: 14,
    lineHeight: 1.5,
    color: "#0f172a",
    background: "#ffffff"
  } satisfies CSSProperties,
  entryActions: {
    display: "grid",
    gap: 8
  } satisfies CSSProperties,
  entryHint: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.6,
    color: "#64748b"
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
  assemblyActions: {
    display: "flex",
    alignItems: "center",
    gap: 10
  } satisfies CSSProperties,
  validationGrid: {
    display: "grid",
    gap: 10
  } satisfies CSSProperties,
  validationBlock: {
    display: "grid",
    gap: 4,
    padding: "12px 14px",
    borderRadius: 16,
    border: "1px solid rgba(148,163,184,0.18)",
    background: "#ffffff"
  } satisfies CSSProperties,
  promptDraft: {
    margin: 0,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    padding: "14px 16px",
    borderRadius: 18,
    border: "1px solid rgba(148,163,184,0.2)",
    background: "#f8fafc",
    color: "#0f172a",
    fontSize: 13,
    lineHeight: 1.6,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
  } satisfies CSSProperties,
  errorBox: {
    display: "grid",
    gap: 10,
    padding: "14px 16px",
    borderRadius: 18,
    background: "rgba(239,68,68,0.08)",
    border: "1px solid rgba(239,68,68,0.18)"
  } satisfies CSSProperties,
  errorTitle: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.4,
    fontWeight: 800,
    color: "#991b1b"
  } satisfies CSSProperties
}
