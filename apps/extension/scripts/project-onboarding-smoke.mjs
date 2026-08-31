import { createEmptyProjectPlanningState } from "../lib/project-planning/project-planning.ts"
import {
  hasMeaningfulPlanningResumeState,
  resolveProjectSetupView,
  shouldAutoCloseProjectSetupPanel,
  shouldPreferReviewOverProjectSetup,
  shouldTreatProjectEntryAsNew
} from "../lib/project-planning/onboarding-routing.ts"
import { resolveProjectPlanningSeedText } from "../lib/project-planning/seed.ts"

const emptyPlanningState = createEmptyProjectPlanningState()
const draftPlanningState = {
  ...createEmptyProjectPlanningState("A new registration flow for a web app."),
  phase: "questions",
  questions: [
    {
      id: "q1",
      criterion: "scope",
      label: "What should ship first?",
      helper: "Clarify MVP scope.",
      mode: "single",
      options: ["Registration only"]
    }
  ]
}

if (hasMeaningfulPlanningResumeState(emptyPlanningState)) {
  throw new Error("Expected empty planning state not to count as resumable.")
}

if (!hasMeaningfulPlanningResumeState(draftPlanningState)) {
  throw new Error("Expected in-progress planning state to count as resumable.")
}

const common = {
  supportsProjectSetup: true,
  projectKey: "replit::project-a",
  dismissedProjectKey: null
}

if (
  resolveProjectSetupView({
    ...common,
    projectHasMemory: false,
    onboardingRecord: null,
    planningState: emptyPlanningState
  }) !== "onboarding"
) {
  throw new Error("Expected a brand-new empty project to open onboarding.")
}

if (
  resolveProjectSetupView({
    ...common,
    projectHasMemory: false,
    onboardingRecord: null,
    planningState: draftPlanningState
  }) !== "planning"
) {
  throw new Error("Expected resumable planning state to reopen Project Planning.")
}

if (
  resolveProjectSetupView({
    ...common,
    projectHasMemory: false,
    onboardingRecord: {
      projectKey: common.projectKey,
      status: "in_progress_import",
      entryChoice: "in_progress",
      completedAt: null,
      updatedAt: new Date().toISOString()
    },
    planningState: emptyPlanningState
  }) !== "context"
) {
  throw new Error("Expected in-progress import onboarding to open Project Context.")
}

if (
  resolveProjectSetupView({
    ...common,
    projectHasMemory: false,
    onboardingRecord: {
      projectKey: common.projectKey,
      status: "planning_ready",
      entryChoice: "starting_now",
      completedAt: null,
      updatedAt: new Date().toISOString()
    },
    planningState: emptyPlanningState
  }) !== "planning"
) {
  throw new Error("Expected planning-ready onboarding to open Project Planning.")
}

if (
  resolveProjectSetupView({
    ...common,
    projectHasMemory: true,
    onboardingRecord: {
      projectKey: common.projectKey,
      status: "planning_ready",
      entryChoice: "starting_now",
      completedAt: null,
      updatedAt: new Date().toISOString()
    },
    planningState: draftPlanningState
  }) !== null
) {
  throw new Error("Expected saved context to bypass onboarding and planning setup.")
}

if (
  resolveProjectSetupView({
    ...common,
    projectKey: "https://chatgpt.com/",
    projectHasMemory: false,
    onboardingRecord: null,
    planningState: emptyPlanningState
  }) !== "onboarding"
) {
  throw new Error("Expected ChatGPT surfaces to open onboarding too.")
}

if (
  resolveProjectSetupView({
    ...common,
    projectKey: "https://lovable.dev/projects/demo",
    projectHasMemory: false,
    onboardingRecord: null,
    planningState: emptyPlanningState
  }) !== "onboarding"
) {
  throw new Error("Expected Lovable surfaces to open onboarding too.")
}

if (
  resolveProjectSetupView({
    ...common,
    projectKey: "",
    projectHasMemory: false,
    onboardingRecord: null,
    planningState: draftPlanningState
  }) !== null
) {
  throw new Error("Expected non-project locations not to open onboarding or planning.")
}

const launcherIdentity = {
  key: "https://replit.com/~",
  label: "~"
}

if (
  resolveProjectSetupView({
    ...common,
    projectKey: launcherIdentity.key,
    projectHasMemory: false,
    onboardingRecord: null,
    planningState: emptyPlanningState
  }) !== "onboarding"
) {
  throw new Error("Expected the Replit launcher to open onboarding, not skip it.")
}

if (
  !shouldTreatProjectEntryAsNew({
    isEntryLocation: true,
    projectHasMemory: false,
    hasActiveTracker: false,
    hasAssistantResponse: false
  })
) {
  throw new Error("Expected an empty Replit launcher to remain a new-project entry.")
}

for (const existingProjectSignal of ["memory", "tracker", "assistant"]) {
  if (
    shouldTreatProjectEntryAsNew({
      isEntryLocation: true,
      projectHasMemory: existingProjectSignal === "memory",
      hasActiveTracker: existingProjectSignal === "tracker",
      hasAssistantResponse: existingProjectSignal === "assistant"
    })
  ) {
    throw new Error(`Expected ${existingProjectSignal} state to bypass new-project routing on Replit /~.`)
  }
}

if (
  !shouldPreferReviewOverProjectSetup({
    hasAssistantResponse: true,
    hasActiveTracker: false
  }) ||
  !shouldPreferReviewOverProjectSetup({
    hasAssistantResponse: false,
    hasActiveTracker: true
  }) ||
  shouldPreferReviewOverProjectSetup({
    hasAssistantResponse: false,
    hasActiveTracker: false
  })
) {
  throw new Error("Expected a visible assistant answer or active tracker to outrank Project Setup routing.")
}

if (
  resolveProjectSetupView({
    ...common,
    projectHasMemory: false,
    dismissedProjectKey: common.projectKey,
    onboardingRecord: null,
    planningState: emptyPlanningState
  }) !== null
) {
  throw new Error("Expected dismissed onboarding not to reopen in the same session.")
}

if (
  shouldAutoCloseProjectSetupPanel({
    panelView: "planning",
    projectHasMemory: true
  })
) {
  throw new Error("Expected the active PRD planning panel to remain open when project memory is saved.")
}

if (
  shouldAutoCloseProjectSetupPanel({
    panelView: "context",
    projectHasMemory: true
  })
) {
  throw new Error("Expected Project Context panel to remain usable after setup is complete.")
}

if (
  resolveProjectPlanningSeedText({
    latestUserPromptText: " water intake app ",
    draftPromptText: "draft should not win",
    existingDescription: "existing should not win"
  }) !== "water intake app"
) {
  throw new Error("Expected latest submitted user message to seed Project Planning first.")
}

if (
  resolveProjectPlanningSeedText({
    latestUserPromptText: "",
    draftPromptText: " build an invoice tracker ",
    existingDescription: "existing should not win"
  }) !== "build an invoice tracker"
) {
  throw new Error("Expected current prompt box text to seed Project Planning when no submitted message exists.")
}

if (
  resolveProjectPlanningSeedText({
    latestUserPromptText: "",
    draftPromptText: "",
    existingDescription: " existing planning description "
  }) !== "existing planning description"
) {
  throw new Error("Expected existing planning description to be the final seed fallback.")
}

console.log("project-onboarding-smoke: ok")
