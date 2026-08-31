import type { ProjectOnboardingRecord } from "../storage"
import type { ProjectPlanningState } from "./project-planning"

export type ProjectSetupView = "onboarding" | "context" | "planning" | null

export function hasMeaningfulPlanningResumeState(state: ProjectPlanningState | null | undefined) {
  if (!state) return false

  return Boolean(
    state.description.trim() ||
      state.phase !== "intake" ||
      state.coverageReport ||
      state.prdSnapshot ||
      state.questions.length ||
      Object.keys(state.answerState).length ||
      Object.keys(state.otherAnswerState).length ||
      state.generatedPrd
  )
}

export function resolveProjectSetupView(input: {
  supportsProjectSetup: boolean
  projectHasMemory: boolean
  projectKey: string
  dismissedProjectKey: string | null
  onboardingRecord: ProjectOnboardingRecord | null
  planningState: ProjectPlanningState | null
}): ProjectSetupView {
  if (!input.supportsProjectSetup || !input.projectKey.trim() || input.projectHasMemory) return null
  if (!input.onboardingRecord && input.dismissedProjectKey === input.projectKey) return null
  if (!input.onboardingRecord && hasMeaningfulPlanningResumeState(input.planningState)) return "planning"
  if (!input.onboardingRecord) return "onboarding"

  if (input.onboardingRecord.status === "planning_ready") return "planning"
  if (input.onboardingRecord.status === "in_progress_import") return "context"
  if (input.onboardingRecord.status === "completed") return null

  return "onboarding"
}

export function shouldAutoCloseProjectSetupPanel(input: {
  panelView: "closed" | "onboarding" | "context" | "planning" | "settings" | "account" | "projects"
  projectHasMemory: boolean
}) {
  return input.projectHasMemory && input.panelView === "onboarding"
}

export function shouldTreatProjectEntryAsNew(input: {
  isEntryLocation: boolean
  projectHasMemory: boolean
  hasActiveTracker: boolean
  hasAssistantResponse: boolean
}) {
  return (
    input.isEntryLocation &&
    !input.projectHasMemory &&
    !input.hasActiveTracker &&
    !input.hasAssistantResponse
  )
}

export function shouldPreferReviewOverProjectSetup(input: {
  hasAssistantResponse: boolean
  hasActiveTracker: boolean
}) {
  return input.hasAssistantResponse || input.hasActiveTracker
}
