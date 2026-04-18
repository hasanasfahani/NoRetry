import { useEffect, useState } from "react"
import { PopupShell } from "../shared/PopupShell"
import { ActionBar } from "../shared/ActionBar"
import { ErrorState } from "../shared/ErrorState"
import { LoadingState } from "../shared/LoadingState"
import { PromptCard } from "../shared/PromptCard"
import { ReviewPromptMode } from "./ReviewPromptMode"
import { ReviewPopupHeader } from "./ReviewPopupHeader"
import type { ReviewPopupViewModel } from "./review-types"
import type { PopupAction } from "../shared/types"
import type { ReviewPopupSurface, ReviewPromptModeState } from "@prompt-optimizer/shared"

type ReviewPopupProps = {
  open: boolean
  surface: ReviewPopupSurface
  viewModel: ReviewPopupViewModel
  promptModeState: ReviewPromptModeState
  modeActions: PopupAction[]
  promptActions: PopupAction[]
  onPromptQuestionIndexChange: (index: number) => void
  onPromptAnswerChange: (questionId: string, value: string) => void
  onPromptOtherAnswerChange: (questionId: string, value: string) => void
  onPromptAdvanceOther: () => void
  onPromptGenerate: () => void
  onClose: () => void
}

export function ReviewPopup(props: ReviewPopupProps) {
  const isPromptMode = props.surface === "prompt_mode"
  const currentlyLoading = isPromptMode ? props.promptModeState.popupState === "loading" : props.viewModel.state === "loading"
  const currentError = isPromptMode ? props.promptModeState.popupState === "error" : props.viewModel.state === "error"
  const [loadingOverlay, setLoadingOverlay] = useState<{
    visible: boolean
    mode: "answer" | "prompt"
    complete: boolean
  }>({
    visible: currentlyLoading,
    mode: isPromptMode ? "prompt" : "answer",
    complete: false
  })

  useEffect(() => {
    if (currentlyLoading) {
      setLoadingOverlay({
        visible: true,
        mode: isPromptMode ? "prompt" : "answer",
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
  }, [currentlyLoading, currentError, isPromptMode, loadingOverlay.visible])

  return (
    <PopupShell
      open={props.open}
      onClose={props.onClose}
      eyebrow={isPromptMode ? "Prompt mode" : props.viewModel.eyebrow}
      title={isPromptMode ? "Prompt planner" : ""}
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
          onOtherAnswerChange={props.onPromptOtherAnswerChange}
          onAdvanceOther={props.onPromptAdvanceOther}
          onGeneratePrompt={props.onPromptGenerate}
        />
      ) : (
        <>
          {props.viewModel.state === "error" && props.viewModel.error ? (
            <ErrorState title={props.viewModel.error.title} body={props.viewModel.error.body} />
          ) : null}

          {props.viewModel.state !== "loading" && props.viewModel.state !== "error" ? (
            <>
              <ReviewPopupHeader viewModel={props.viewModel} />
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
