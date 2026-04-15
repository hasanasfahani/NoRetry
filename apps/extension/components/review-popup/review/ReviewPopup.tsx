import { PopupShell } from "../shared/PopupShell"
import { ActionBar } from "../shared/ActionBar"
import { ErrorState } from "../shared/ErrorState"
import { LoadingState } from "../shared/LoadingState"
import { PromptCard } from "../shared/PromptCard"
import { ReviewChecklistSection } from "./ReviewChecklistSection"
import { ReviewDecisionSummary } from "./ReviewDecisionSummary"
import { ReviewFeedbackRow } from "./ReviewFeedbackRow"
import { ReviewMissingItems } from "./ReviewMissingItems"
import { ReviewPromptMode } from "./ReviewPromptMode"
import { ReviewPopupHeader } from "./ReviewPopupHeader"
import { ReviewProofSection } from "./ReviewProofSection"
import type { ReviewPopupViewModel } from "./review-types"
import { ReviewWhySection } from "./ReviewWhySection"
import type { ReviewPopupSurface, ReviewPromptModeState } from "../../../lib/review/types"
import type { PopupAction } from "../shared/types"

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

  return (
    <PopupShell
      open={props.open}
      onClose={props.onClose}
      eyebrow={isPromptMode ? "Prompt mode" : props.viewModel.eyebrow}
      title={isPromptMode ? "Prompt planner" : props.viewModel.title}
    >
      {props.modeActions.length ? <ActionBar actions={props.modeActions} /> : null}
      {isPromptMode ? (
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
          {props.viewModel.state === "loading" ? <LoadingState /> : null}
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
              <ReviewMissingItems items={props.viewModel.missingItems} />
              <ReviewDecisionSummary viewModel={props.viewModel} />
              <ReviewWhySection items={props.viewModel.whyItems} />
              <ReviewProofSection
                summary={props.viewModel.proofSummary}
                checked={props.viewModel.checkedArtifacts}
                missing={props.viewModel.uncheckedArtifacts}
              />
              <ReviewChecklistSection items={props.viewModel.checklistRows} />
              <ReviewFeedbackRow prompt={props.viewModel.feedbackPrompt} />
            </>
          ) : null}
        </>
      )}
    </PopupShell>
  )
}
