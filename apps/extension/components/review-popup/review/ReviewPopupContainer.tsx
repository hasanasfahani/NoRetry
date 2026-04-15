import { ReviewPopup } from "./ReviewPopup"
import type { ReviewPopupViewModel } from "./review-types"
import type { ReviewPopupSurface, ReviewPromptModeState } from "../../../lib/review/types"
import type { PopupAction } from "../shared/types"

type ReviewPopupContainerProps = {
  open: boolean
  surface: ReviewPopupSurface
  viewModel: ReviewPopupViewModel
  promptModeState: ReviewPromptModeState
  surfaceActions: PopupAction[]
  promptActions: PopupAction[]
  onPromptQuestionIndexChange: (index: number) => void
  onPromptAnswerChange: (questionId: string, value: string) => void
  onPromptOtherAnswerChange: (questionId: string, value: string) => void
  onPromptAdvanceOther: () => void
  onPromptGenerate: () => void
  onClose: () => void
}

export function ReviewPopupContainer(props: ReviewPopupContainerProps) {
  return (
    <ReviewPopup
      open={props.open}
      surface={props.surface}
      viewModel={props.viewModel}
      promptModeState={props.promptModeState}
      modeActions={props.surfaceActions}
      promptActions={props.promptActions}
      onPromptQuestionIndexChange={props.onPromptQuestionIndexChange}
      onPromptAnswerChange={props.onPromptAnswerChange}
      onPromptOtherAnswerChange={props.onPromptOtherAnswerChange}
      onPromptAdvanceOther={props.onPromptAdvanceOther}
      onPromptGenerate={props.onPromptGenerate}
      onClose={props.onClose}
    />
  )
}
