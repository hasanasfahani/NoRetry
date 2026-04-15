import type { PopupAction, PopupTone } from "../shared/types"

export type ReviewPopupVisualState =
  | "loading"
  | "quick_review"
  | "deep_review"
  | "rescue_diagnosis"
  | "rescue_execution"
  | "error"

export type ReviewChecklistItem = {
  id: string
  label: string
  status: "verified" | "not_verified" | "missing" | "blocked"
}

export type ReviewPopupViewModel = {
  state: ReviewPopupVisualState
  mode: "quick" | "deep"
  eyebrow: string
  title: string
  statusBadge: {
    label: string
    tone: PopupTone
  }
  decision: string
  recommendedAction: string
  promptLabel: string
  prompt: string
  promptNote?: string
  promptActions: PopupAction[]
  confidenceLabel: string
  confidenceNote: string
  confidenceReasons: string[]
  missingItems: string[]
  whyItems: string[]
  proofSummary: string
  checkedArtifacts: string[]
  uncheckedArtifacts: string[]
  checklistRows: ReviewChecklistItem[]
  quickToDeepDelta: string
  feedbackPrompt: string
  error?: {
    title: string
    body: string
  }
}
