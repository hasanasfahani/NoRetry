import { useEffect, useState } from "react"
import { PopupShell } from "../shared/PopupShell"
import { ActionBar } from "../shared/ActionBar"
import { ErrorState } from "../shared/ErrorState"
import { LoadingState } from "../shared/LoadingState"
import { PromptCard } from "../shared/PromptCard"
import { StatusBadge } from "../shared/StatusBadge"
import { ReviewPromptMode } from "./ReviewPromptMode"
import { ReviewPromptModeV2 } from "./ReviewPromptModeV2"
import type { ReviewPopupViewModel } from "./review-types"
import type { ReviewPopupSurface, ReviewPromptModeState, ReviewPromptModeV2State } from "../../../lib/review/types"
import type { ReviewPromptModeV2RequestType } from "../../../lib/review/v2/request-types"
import type { PopupAction } from "../shared/types"

type ReviewPopupProps = {
  open: boolean
  surface: ReviewPopupSurface
  viewModel: ReviewPopupViewModel
  promptModeState: ReviewPromptModeState
  promptModeV2State: ReviewPromptModeV2State
  modeActions: PopupAction[]
  promptActions: PopupAction[]
  onPromptQuestionIndexChange: (index: number) => void
  onPromptAnswerChange: (questionId: string, value: string) => void
  onPromptToggleMultiAnswer: (questionId: string, value: string) => void
  onPromptOtherAnswerChange: (questionId: string, value: string) => void
  onPromptAdvanceOther: () => void
  onPromptGenerate: () => void
  onPromptV2TaskTypeSelect: (taskType: ReviewPromptModeV2RequestType) => void
  onPromptV2ContinueFromEntry: () => void
  onPromptV2QuestionIndexChange: (index: number) => void
  onPromptV2QuestionAnswerChange: (questionId: string, value: string) => void
  onPromptV2QuestionMultiToggle: (questionId: string, value: string) => void
  onPromptV2ContinueQuestion: () => void
  onPromptV2Generate: () => void
  onClose: () => void
}

export function ReviewPopup(props: ReviewPopupProps) {
  const isPromptMode = props.surface === "prompt_mode"
  const isPromptModeV2 = props.surface === "prompt_mode_v2"
  const currentlyLoading = isPromptMode
    ? props.promptModeState.popupState === "loading"
    : isPromptModeV2
      ? props.promptModeV2State.popupState === "loading"
      : props.viewModel.state === "loading"
  const currentError = isPromptMode
    ? props.promptModeState.popupState === "error"
    : isPromptModeV2
      ? props.promptModeV2State.popupState === "error"
      : props.viewModel.state === "error"
  const [loadingOverlay, setLoadingOverlay] = useState<{
    visible: boolean
    mode: "answer" | "prompt"
    complete: boolean
  }>({
    visible: currentlyLoading,
    mode: isPromptMode || isPromptModeV2 ? "prompt" : "answer",
    complete: false
  })

  useEffect(() => {
    if (currentlyLoading) {
      setLoadingOverlay({
        visible: true,
        mode: isPromptMode || isPromptModeV2 ? "prompt" : "answer",
        complete: false
      })
      return
    }

    if (!loadingOverlay.visible) return

    if (currentError) {
      setLoadingOverlay((current) => ({ ...current, visible: false, complete: false }))
      return
    }

    setLoadingOverlay((current) =>
      current.visible && !current.complete
        ? {
            ...current,
            complete: true
          }
        : current
    )
  }, [currentlyLoading, currentError, isPromptMode, isPromptModeV2, loadingOverlay.visible])

  return (
      <PopupShell
      open={props.open}
      onClose={props.onClose}
      eyebrow={isPromptMode ? "Prompt mode" : isPromptModeV2 ? "Prompt mode v2" : props.viewModel.eyebrow}
      title={isPromptMode ? "Prompt planner" : isPromptModeV2 ? "Prompt planner v2" : ""}
    >
      {props.modeActions.length ? <ActionBar actions={props.modeActions} /> : null}
      {loadingOverlay.visible ? (
        <LoadingState
          mode={loadingOverlay.mode}
          complete={loadingOverlay.complete}
          onComplete={() => setLoadingOverlay((current) => ({ ...current, visible: false, complete: false }))}
        />
      ) : isPromptMode ? (
        <ReviewPromptMode
          state={props.promptModeState}
          promptActions={props.promptActions}
          onQuestionIndexChange={props.onPromptQuestionIndexChange}
          onAnswerChange={props.onPromptAnswerChange}
          onToggleMultiAnswer={props.onPromptToggleMultiAnswer}
          onOtherAnswerChange={props.onPromptOtherAnswerChange}
          onAdvanceOther={props.onPromptAdvanceOther}
          onGeneratePrompt={props.onPromptGenerate}
        />
      ) : isPromptModeV2 ? (
        <ReviewPromptModeV2
          state={props.promptModeV2State}
          onTaskTypeSelect={props.onPromptV2TaskTypeSelect}
          onContinueFromEntry={props.onPromptV2ContinueFromEntry}
          onQuestionIndexChange={props.onPromptV2QuestionIndexChange}
          onQuestionAnswerChange={props.onPromptV2QuestionAnswerChange}
          onQuestionMultiToggle={props.onPromptV2QuestionMultiToggle}
          onContinueQuestion={props.onPromptV2ContinueQuestion}
          onGeneratePrompt={props.onPromptV2Generate}
        />
      ) : (
        <>
          {props.viewModel.state === "error" && props.viewModel.error ? (
            <ErrorState title={props.viewModel.error.title} body={props.viewModel.error.body} />
          ) : null}

          {props.viewModel.state !== "loading" && props.viewModel.state !== "error" ? (
            <>
              <StatusBadge
                label={props.viewModel.statusBadge.label}
                tone={props.viewModel.statusBadge.tone}
              />
              <ActionBar actions={props.viewModel.promptActions} />
              <PromptCard
                label={props.viewModel.promptLabel}
                prompt={props.viewModel.prompt}
                note={props.viewModel.promptNote}
              />
            </>
          ) : null}
        </>
      )}
    </PopupShell>
  )
}
