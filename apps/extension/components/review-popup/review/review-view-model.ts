import type { ReviewPopupMockState, ReviewPopupViewModel } from "./review-types"

const sharedMissingItems = [
  "Strength button visibly appears inside the Replit AI prompt area after the user types enough text.",
  "Opening the review surface feels attached to the prompt area instead of detached from the flow."
]

const sharedChecklist = [
  { id: "1", label: "Launcher appears beside the existing prompt tools", status: "verified" as const },
  { id: "2", label: "New popup opens and closes cleanly", status: "not_verified" as const },
  { id: "3", label: "No old AFTER logic is wired into the new popup tree", status: "blocked" as const }
]

export const mockReviewStates: Record<ReviewPopupMockState, ReviewPopupViewModel> = {
  loading: {
    state: "loading",
    eyebrow: "Review popup",
    title: "Checking the latest assistant answer",
    statusBadge: { label: "Preparing", tone: "info" },
    decision: "Hold for a moment while the review surface loads.",
    recommendedAction: "Preparing the next recommendation",
    promptLabel: "Prompt preview",
    prompt: "Loading mocked review content…",
    promptActions: [],
    missingItems: [],
    confidenceLabel: "Confidence: Pending",
    confidenceNote: "No judgment yet.",
    whyItems: [],
    proofChecked: [],
    proofMissing: [],
    checklist: [],
    feedbackPrompt: "Did this review help?"
  },
  quick_review: {
    state: "quick_review",
    eyebrow: "Review popup",
    title: "After response",
    statusBadge: { label: "Not clear yet", tone: "info" },
    decision: "Validate this before proceeding",
    recommendedAction: "Ask for visible proof before you keep building on this answer.",
    promptLabel: "Recommended next prompt",
    prompt: "Show what is already working in the UI, what is still not visible, and the smallest next correction to make the launcher feel real in the Replit prompt area.",
    promptNote: "Mocked quick review state for Phase 1.",
    promptActions: [{ id: "copy", label: "Copy prompt", kind: "primary" }],
    missingItems: sharedMissingItems,
    confidenceLabel: "Confidence: Low",
    confidenceNote: "Quick review is intentionally lighter and should stay easy to scan.",
    whyItems: [
      "The answer sounds plausible, but the visible UI evidence is still thin.",
      "The next move should clarify proof before broader changes."
    ],
    proofChecked: ["Visible response text", "Current prompt-area launcher region"],
    proofMissing: ["Fresh screenshot or DOM proof of the new review popup launcher"],
    checklist: sharedChecklist,
    feedbackPrompt: "Did this review help you avoid a bad retry?"
  },
  deep_review: {
    state: "deep_review",
    eyebrow: "Review popup",
    title: "After response",
    statusBadge: { label: "Needs review", tone: "warning" },
    decision: "Tighten the evidence before trusting this answer",
    recommendedAction: "Push for stronger proof and a smaller correction path.",
    promptLabel: "Recommended deep prompt",
    prompt: "Stay inside the original goal. Focus only on the unresolved launcher and popup behaviors. Say what is verified, what is not verified yet, and the evidence for each point.",
    promptNote: "Mocked deep review state for Phase 1.",
    promptActions: [{ id: "copy", label: "Copy prompt", kind: "primary" }],
    missingItems: [
      "The new review popup launcher still needs explicit visible proof beside the current two icons.",
      "The popup hierarchy should feel calm and action-first, not overloaded."
    ],
    confidenceLabel: "Confidence: Medium",
    confidenceNote: "Deep review should feel stricter, but still concise.",
    whyItems: [
      "The answer may be directionally right, but the proof burden is higher here.",
      "The recommended next move should stay scoped to unresolved UI behavior."
    ],
    proofChecked: ["Current launcher stack position", "Popup hierarchy expectations"],
    proofMissing: ["A stable deep-review confirmation path is intentionally not connected in Phase 1"],
    checklist: [
      { id: "1", label: "Action-first summary appears at the top", status: "verified" },
      { id: "2", label: "Prompt card is visually stronger than supporting detail", status: "verified" },
      { id: "3", label: "Deep analysis wiring is still mocked only", status: "missing" }
    ],
    feedbackPrompt: "Did this deeper review feel more useful?"
  },
  rescue_diagnosis: {
    state: "rescue_diagnosis",
    eyebrow: "Review popup",
    title: "After response",
    statusBadge: { label: "Rescue mode", tone: "danger" },
    decision: "Diagnose first",
    recommendedAction: "Stop patching and diagnose why the current approach is failing.",
    promptLabel: "Diagnosis prompt",
    prompt: "Stop continuing the current fix. Explain which original requirements are still unmet, what was already attempted, why the current path may be failing, and the smallest better implementation plan. Do not implement yet.",
    promptNote: "Mocked rescue diagnosis state for Phase 1.",
    promptActions: [{ id: "copy", label: "Copy diagnosis prompt", kind: "primary" }],
    missingItems: [
      "The current path is looping without enough visible progress.",
      "A clearer diagnosis is needed before the next implementation step."
    ],
    confidenceLabel: "Confidence: Low",
    confidenceNote: "Rescue mode should feel different from normal review at a glance.",
    whyItems: [
      "Normal retry prompts are no longer the right next move in this state.",
      "The product should guide the user into a reset-first step."
    ],
    proofChecked: ["Current unresolved launcher and popup requirements"],
    proofMissing: ["A diagnosis response from the assistant"],
    checklist: [
      { id: "1", label: "Rescue diagnosis label is visible", status: "verified" },
      { id: "2", label: "Prompt asks for diagnosis only, not implementation", status: "verified" }
    ],
    feedbackPrompt: "Did the diagnosis step feel clearer than another retry?"
  },
  rescue_execution: {
    state: "rescue_execution",
    eyebrow: "Review popup",
    title: "After response",
    statusBadge: { label: "Rescue mode", tone: "warning" },
    decision: "Implement the corrected plan",
    recommendedAction: "Use the diagnosis, then make the smallest better correction.",
    promptLabel: "Execution prompt",
    prompt: "Based on the diagnosis above, stay inside the original goal, focus only on the unresolved launcher and popup behaviors, do not repeat the previous failed path, and show the exact evidence that proves the correction worked.",
    promptNote: "Mocked rescue execution state for Phase 1.",
    promptActions: [{ id: "copy", label: "Copy execution prompt", kind: "primary" }],
    missingItems: [
      "The corrected launcher/popup path still needs implementation.",
      "Visible evidence is still required after the correction."
    ],
    confidenceLabel: "Confidence: Medium",
    confidenceNote: "Execution should feel stricter than normal review.",
    whyItems: [
      "The plan is now explicit, so the next prompt can be tighter.",
      "The popup should make this feel like a deliberate second phase."
    ],
    proofChecked: ["Diagnosis output is assumed to exist in this mocked state"],
    proofMissing: ["Final evidence of the corrected UI behavior"],
    checklist: [
      { id: "1", label: "Execution prompt blocks repeating the failed path", status: "verified" },
      { id: "2", label: "Execution prompt asks for proof of success", status: "verified" }
    ],
    feedbackPrompt: "Did the execution step feel focused enough?"
  },
  error: {
    state: "error",
    eyebrow: "Review popup",
    title: "After response",
    statusBadge: { label: "Review unavailable", tone: "danger" },
    decision: "We couldn’t build the review right now",
    recommendedAction: "Retry once the prompt area is stable again.",
    promptLabel: "Prompt preview",
    prompt: "Review unavailable.",
    promptActions: [],
    missingItems: [],
    confidenceLabel: "Confidence: Low",
    confidenceNote: "The popup should fail softly when the review cannot be prepared.",
    whyItems: [],
    proofChecked: [],
    proofMissing: [],
    checklist: [],
    feedbackPrompt: "Did this review help?",
    error: {
      title: "Review popup could not load",
      body: "This is a mocked error state for Phase 1. Real analysis and recovery behavior are intentionally deferred."
    }
  }
}

export function getMockReviewPopupViewModel(state: ReviewPopupMockState): ReviewPopupViewModel {
  return mockReviewStates[state]
}
