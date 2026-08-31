import type { AnswerCompletionState } from "../adapter"

export function resolveReplitAnswerCompletionState(input: {
  genericState: AnswerCompletionState
  assistantExists: boolean
  submitButtonVisible: boolean
  submitButtonLabel: string
}): AnswerCompletionState {
  if (
    !input.assistantExists ||
    input.genericState.isStreamingActive ||
    input.genericState.assistantControlsVisible
  ) {
    return input.genericState
  }

  const submitButtonLabel = input.submitButtonLabel.trim().toLowerCase()
  if (input.submitButtonVisible && (submitButtonLabel === "start" || submitButtonLabel === "send")) {
    return {
      isStreamingActive: false,
      assistantControlsVisible: true,
      reason: "replit_idle_submit_visible"
    }
  }

  return input.genericState
}
