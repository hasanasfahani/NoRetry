import { ReviewPopup } from "./ReviewPopup"
import type { ReviewPopupViewModel } from "./review-types"
import type { ReviewPopupSurface, ReviewPromptModeState, ReviewPromptModeV2State } from "../../../lib/review/types"
import type { ReviewPromptModeV2RequestType } from "../../../lib/review/v2/request-types"
import type { PopupAction } from "../shared/types"

type ReviewPopupContainerProps = {
  open: boolean
  surface: ReviewPopupSurface
  viewModel: ReviewPopupViewModel
  promptModeState: ReviewPromptModeState
  promptModeV2State: ReviewPromptModeV2State
  surfaceActions: PopupAction[]
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

export function ReviewPopupContainer(props: ReviewPopupContainerProps) {
  return (
    <ReviewPopup
      open={props.open}
      surface={props.surface}
      viewModel={props.viewModel}
      promptModeState={props.promptModeState}
      promptModeV2State={props.promptModeV2State}
      modeActions={props.surfaceActions}
      promptActions={props.promptActions}
      onPromptQuestionIndexChange={props.onPromptQuestionIndexChange}
      onPromptAnswerChange={props.onPromptAnswerChange}
      onPromptToggleMultiAnswer={props.onPromptToggleMultiAnswer}
      onPromptOtherAnswerChange={props.onPromptOtherAnswerChange}
      onPromptAdvanceOther={props.onPromptAdvanceOther}
      onPromptGenerate={props.onPromptGenerate}
      onPromptV2TaskTypeSelect={props.onPromptV2TaskTypeSelect}
      onPromptV2ContinueFromEntry={props.onPromptV2ContinueFromEntry}
      onPromptV2QuestionIndexChange={props.onPromptV2QuestionIndexChange}
      onPromptV2QuestionAnswerChange={props.onPromptV2QuestionAnswerChange}
      onPromptV2QuestionMultiToggle={props.onPromptV2QuestionMultiToggle}
      onPromptV2ContinueQuestion={props.onPromptV2ContinueQuestion}
      onPromptV2Generate={props.onPromptV2Generate}
      onClose={props.onClose}
    />
  )
}
