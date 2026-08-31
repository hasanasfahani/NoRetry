import {
  analyzeProjectDescription,
  buildProjectPlanningDebugText,
  buildProjectPlanningIntakeFields,
  buildPlanningQuestionsFromCoverage,
  buildGeneratedPrdDraft,
  buildProjectPlanningContextPayload,
  PROJECT_PLANNING_INTAKE_QUESTIONS
} from "../lib/project-planning/project-planning.ts"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import {
  restoreProjectPlanningStateFromSync,
  sanitizeProjectPlanningStateForSync
} from "../lib/progress/project-progress.ts"
import {
  PROJECT_PLANNING_CLIENT_TIMEOUT_MS,
  PROJECT_PLANNING_DRAFT_CLIENT_TIMEOUT_MS
} from "../../../packages/shared/src/project-planning.ts"
import {
  advanceProjectTrackerAfterPhasePass,
  buildProjectTrackerDeepAnalysisBrief,
  buildProjectTrackerHandoffPrompt,
  buildProjectTrackerRecord,
  deactivateProjectTracker,
  isProjectTrackerBoundTo
} from "../lib/project-tracker/project-tracker.ts"
import { shouldAutoCloseProjectSetupPanel } from "../lib/project-planning/onboarding-routing.ts"

if (PROJECT_PLANNING_CLIENT_TIMEOUT_MS > 20_000) {
  throw new Error("Expected Project Planning client timeout to stay below 20 seconds.")
}

if (PROJECT_PLANNING_DRAFT_CLIENT_TIMEOUT_MS < 85_000 || PROJECT_PLANNING_DRAFT_CLIENT_TIMEOUT_MS > 95_000) {
  throw new Error("Expected Build PRD Draft client timeout to cover the 50s full attempt plus compact retry.")
}

const richDescription = `
A customer-facing registration flow for a web app. New customers need a clean sign-up experience because the current
flow feels incomplete and causes drop-off. The first version should stay narrowly scoped to registration only and must
capture name, email, password, and gender. For now, keep social login and analytics out of scope. Success means users
can complete registration confidently end to end and the validation states feel clear. We should preserve the existing
web architecture and avoid unrelated rewrites.
`

const thinDescription = `A new app for teams.`
const scriptDir = dirname(fileURLToPath(import.meta.url))
const extensionRoot = resolve(scriptDir, "..")

const intakeQuestionLabels = PROJECT_PLANNING_INTAKE_QUESTIONS.map((question) => question.label)

if (PROJECT_PLANNING_INTAKE_QUESTIONS.length !== 9) {
  throw new Error("Expected Project Planning intake to include five product fields and four optional NFR fields.")
}

for (const question of PROJECT_PLANNING_INTAKE_QUESTIONS) {
  if (question.mode !== "freeform") {
    throw new Error("Expected Project Planning intake fields to stay simple freeform textareas.")
  }
}

for (const label of [
  "Who will use this?",
  "What problem should it help with?",
  "What should the first version be able to do?",
  "What should we skip for now?",
  "Anything else we should know?",
  "Will people sign in, and should different people see or change different things?",
  "What information must the app remember, and what would be serious if it were lost or shown to the wrong person?",
  "Where will this run, and which outside services will it connect to?",
  "Which matter most: speed, accessibility, low cost, easy maintenance?"
]) {
  if (!intakeQuestionLabels.includes(label)) {
    throw new Error(`Expected Project Planning intake to include "${label}".`)
  }
}

const intakeFields = buildProjectPlanningIntakeFields({
  description: "water intake app",
  answerState: {
    intake_target_user: "Busy people who forget to drink water.",
    intake_problem: "They do not know if they reached their daily goal.",
    intake_first_version: "Set a goal, log drinks, show progress, and send reminders.",
    intake_skip_now: "No social sharing.",
    intake_anything_else: "Use cups or liters.",
    intake_nfr_access_and_roles: "People sign in and see only their own entries.",
    intake_nfr_data_and_sensitivity: "Save email addresses and water logs.",
    intake_nfr_deployment_and_services: "Run on Replit and send email reminders.",
    intake_nfr_quality_priorities: "Accessibility and easy maintenance matter most."
  }
})

if (
  intakeFields.appIdea !== "water intake app" ||
  intakeFields.targetUsers !== "Busy people who forget to drink water." ||
  intakeFields.firstVersion !== "Set a goal, log drinks, show progress, and send reminders." ||
  intakeFields.accessAndRoles !== "People sign in and see only their own entries." ||
  intakeFields.dataAndSensitivity !== "Save email addresses and water logs."
) {
  throw new Error("Expected Project Planning intake answers to map into draft intake fields.")
}

const projectPlanningPanelSource = readFileSync(
  resolve(extensionRoot, "components/review-popup/review/ProjectPlanningPanel.tsx"),
  "utf8"
)
const reviewPopupSource = readFileSync(
  resolve(extensionRoot, "components/review-popup/review/ReviewPopup.tsx"),
  "utf8"
)
const reviewPopupContainerSource = readFileSync(
  resolve(extensionRoot, "components/review-popup/review/ReviewPopupContainer.tsx"),
  "utf8"
)
const contentScriptSource = readFileSync(resolve(extensionRoot, "contents/replit-agent.tsx"), "utf8")
const storageSource = readFileSync(resolve(extensionRoot, "lib/storage.ts"), "utf8")

if (/Gather Requirements|onStartQuestions|isGeneratingQuestions/.test(projectPlanningPanelSource)) {
  throw new Error("Expected the visible Project Planning panel to remove the Gather Requirements flow.")
}

if (
  !/Generating PRD/.test(projectPlanningPanelSource) ||
  !/Regenerating PRD/.test(projectPlanningPanelSource) ||
  !/Creating implementation phases/.test(projectPlanningPanelSource) ||
  !/Finalizing the PRD/.test(projectPlanningPanelSource)
) {
  throw new Error("Expected Project Planning panel to show visible PRD generation progress.")
}

if (!projectPlanningPanelSource.includes("Retry PRD generation")) {
  throw new Error("Expected failed PRD generation to expose a clear retry action.")
}

if (
  !projectPlanningPanelSource.includes('useState(false)') ||
  !projectPlanningPanelSource.includes("Looks right") ||
  !projectPlanningPanelSource.includes("Change these")
) {
  throw new Error("Expected NFR assumptions to use the collapsed confirmation control.")
}

if (
  !contentScriptSource.includes("generationAttempt: projectPlanningGenerationAttemptRef.current") ||
  !contentScriptSource.includes("Your answers are preserved") ||
  !contentScriptSource.includes("structured PRD retry")
) {
  throw new Error("Expected PRD retry to preserve intake and send a corrective generation attempt.")
}

if (
  !/async function copyPromptForManualHandoff[\s\S]*?copyTextToClipboardBestEffort\(normalizedPrompt\)/.test(contentScriptSource) ||
  /async function handleProjectPlanningCopyPrd[\s\S]*?submitProjectPlanningPrompt\(/.test(contentScriptSource) ||
  /async function handleProjectPlanningCopyPrd[\s\S]*?writeAndSubmitActiveSurfacePrompt\(/.test(contentScriptSource)
) {
  throw new Error("Expected Project Planning PRD handoff to copy only without writing into the composer or clicking send.")
}

if (
  /async function handleProjectPlanningCopyPrd[\s\S]*?phase:\s*"saving"/.test(contentScriptSource) ||
  projectPlanningPanelSource.includes("Copying the PRD") ||
  !projectPlanningPanelSource.includes("copyMessage") ||
  !contentScriptSource.includes("showNotice: false")
) {
  throw new Error("Expected Copy PRD to keep the review page mounted and show an inline persistent copy message.")
}

if (
  !/reviewPopupOpenStateRef\.current\s*&&\s*projectPanelView === "closed"\s*&&\s*reviewPopupSurface === "answer_mode"/.test(
    contentScriptSource
  )
) {
  throw new Error("Expected answer-analysis auto-refresh to stay paused while Project Planning or Project Context panels are open.")
}

if (
  !shouldAutoCloseProjectSetupPanel({ panelView: "onboarding", projectHasMemory: true }) ||
  shouldAutoCloseProjectSetupPanel({ panelView: "planning", projectHasMemory: true })
) {
  throw new Error("Expected project memory creation to auto-close onboarding only, not the active PRD planning panel.")
}

if (/onProjectPlanningStart|projectPlanningGeneratingQuestions/.test(reviewPopupSource + reviewPopupContainerSource)) {
  throw new Error("Expected Project Planning popup props to remove the old requirements-generation wiring.")
}

if (/handleProjectPlanningStart|analyzeProjectPlanning\b|requirements gathering/.test(contentScriptSource)) {
  throw new Error("Expected the active content script flow not to call the old requirements endpoint.")
}

if (!reviewPopupSource.includes("Project planning phases completed")) {
  throw new Error("Expected the review popup to show completed Project Tracker state.")
}

if (reviewPopupSource.includes("Tracker is stored but inactive")) {
  throw new Error("Expected the review popup to keep Project Tracker mode copy concise.")
}

if (!storageSource.includes("PROJECT_CATALOG_KEY") || !storageSource.includes("saveProjectCatalogItem")) {
  throw new Error("Expected Project Planning to persist generated PRDs into a project catalog.")
}

if (!contentScriptSource.includes("saveProjectCatalogItem") || !contentScriptSource.includes("projectCatalogItems")) {
  throw new Error("Expected the content script to load and update the Projects catalog.")
}

if (!reviewPopupContainerSource.includes("onProjectsOpen") || !reviewPopupSource.includes("ProjectCatalogPanel")) {
  throw new Error("Expected the popup to expose a Projects menu panel.")
}

if (!reviewPopupSource.includes("No PRDs saved yet.") || !reviewPopupSource.includes("Saved PRDs")) {
  throw new Error("Expected the Projects menu to show empty and populated PRD catalog states.")
}

if (!contentScriptSource.includes('disabledReason === "completed"')) {
  throw new Error("Expected completed Project Tracker records not to be manually re-enabled.")
}

if (!contentScriptSource.includes("tracker_replaced_for_new_prd")) {
  throw new Error("Expected new PRD submission to replace the previous active Project Tracker.")
}

if (!contentScriptSource.includes("tracker_stale_save_failed")) {
  throw new Error("Expected stale Project Tracker protection during project load.")
}

const richCoverage = analyzeProjectDescription(richDescription)
const thinCoverage = analyzeProjectDescription(thinDescription)
const richPrdSnapshot = {
  problem: {
    status: "partial",
    draft: "New customers need a cleaner registration flow.",
    missing: []
  },
  target_user: {
    status: "filled",
    draft: "New customers registering for the web app.",
    missing: []
  },
  goal_outcome: {
    status: "partial",
    draft: "Reduce registration drop-off with a clearer flow.",
    missing: ["Exact conversion target"]
  },
  scope: {
    status: "filled",
    draft: "First release is registration only.",
    missing: []
  },
  core_requirements: {
    status: "filled",
    draft: "Capture name, email, password, and gender with clear validation.",
    missing: []
  },
  non_goals: {
    status: "filled",
    draft: "Social login and analytics are out of scope.",
    missing: []
  },
  constraints: {
    status: "partial",
    draft: "Preserve the existing web architecture.",
    missing: ["Timeline"]
  },
  success_criteria: {
    status: "partial",
    draft: "Users complete registration confidently end to end.",
    missing: ["Measurable threshold"]
  },
  assumptions_risks: {
    status: "missing",
    draft: "",
    missing: ["Validation complexity", "Drop-off cause may need verification"]
  }
}

const richQuestions = buildPlanningQuestionsFromCoverage(richCoverage)
const thinQuestions = buildPlanningQuestionsFromCoverage(thinCoverage)

if (richQuestions.length >= thinQuestions.length) {
  throw new Error("Expected the richer description to require fewer planning questions.")
}

if (!thinQuestions.length) {
  throw new Error("Expected the thinner description to require follow-up planning questions.")
}

const draft = buildGeneratedPrdDraft({
  projectLabel: "Registration Project",
  description: richDescription,
  coverageReport: richCoverage,
  questions: richQuestions,
  answerState: {
    intake_nfr_access_and_roles: "Customers sign in and see only their own registration details.",
    intake_nfr_data_and_sensitivity: "Save names and email addresses; showing them to another customer would be serious.",
    intake_nfr_deployment_and_services: "Run on Replit and connect to an email service.",
    intake_nfr_quality_priorities: "Accessibility and easy maintenance matter most."
  },
  otherAnswerState: {}
})

if (draft.sections.length < 8) {
  throw new Error("Expected the generated PRD draft to include the core sections.")
}

const nfrSection = draft.sections.find((section) => section.id === "non-functional-requirements")
if (!nfrSection || !/Access and permissions/i.test(nfrSection.body) || !/Confirmed assumptions/i.test(nfrSection.body)) {
  throw new Error("Expected the local PRD fallback to include the NFR section from raw intake answers.")
}

if (!draft.submissionPrompt.includes("Non-Functional Requirements")) {
  throw new Error("Expected the NFR section to flow into the PRD submission prompt.")
}

if (draft.implementationPhases.length < 2) {
  throw new Error("Expected the generated PRD draft to include phased implementation guidance.")
}

if (!draft.submissionPrompt.includes("Implementation phases")) {
  throw new Error("Expected the generated PRD draft to include the implementation phases in the handoff prompt.")
}

const visibleHandoffSection = draft.sections.find((section) => section.id === "implementation-handoff")

if (!visibleHandoffSection || !/implement phase 1 only/i.test(visibleHandoffSection.body)) {
  throw new Error("Expected the visible PRD draft to include an implementation handoff section.")
}

if (!/implement phase 1 only/i.test(draft.submissionPrompt)) {
  throw new Error("Expected the submission prompt to start implementation with Phase 1 only.")
}

if (!/validated against its acceptance criteria/i.test(draft.submissionPrompt)) {
  throw new Error("Expected the submission prompt to require validation against phase acceptance criteria.")
}

if (!/concrete implementation validation proof/i.test(draft.submissionPrompt)) {
  throw new Error("Expected the submission prompt to require concrete implementation validation proof.")
}

if (!/wait for the user's confirmation/i.test(draft.submissionPrompt)) {
  throw new Error("Expected the submission prompt to wait for user confirmation before the next phase.")
}

if (draft.submissionPrompt.indexOf("Implementation phases") > draft.submissionPrompt.indexOf("Implementation handoff")) {
  throw new Error("Expected implementation handoff to appear after implementation phases in the submitted prompt.")
}

const debugText = buildProjectPlanningDebugText({
  stage: "prd_draft",
  status: "success",
  diagnostics: {
    aiAvailable: true,
    fallbackUsed: false,
    providerName: "Kimi",
    durationMs: 4703,
    outputQualityStatus: "passed",
    providerAttempts: [
      {
        providerName: "Kimi",
        durationMs: 4703,
        status: "success",
        outputQualityStatus: "passed"
      },
      {
        providerName: "DeepSeek",
        durationMs: 4704,
        status: "aborted",
        errorReason: "race_lost",
        outputQualityStatus: "not_checked"
      }
    ]
  },
  tracker: {
    trackerEnabled: true,
    currentPhaseIndex: 0,
    currentPhaseTitle: "Daily Hydration Tracking",
    nextPhaseTitle: "Smart Reminders",
    phaseStatus: "in_progress",
    advanceRecommended: false,
    trackerCompleted: false,
    prdHash: "prd-hash",
    promptHash: "prompt-hash"
  },
  intakeFields: {
    appIdea: "water intake app",
    targetUsers: "Busy people who forget to drink water.",
    problem: "They do not know if they reached their daily goal.",
    firstVersion: "Set a goal, log drinks, show progress, and send reminders.",
    skipForNow: "",
    anythingElse: "Use cups or liters."
  },
  phaseTitles: ["Daily Hydration Tracking"]
})
const parsedDebugText = JSON.parse(debugText)

if (parsedDebugText.providerName !== "Kimi" || parsedDebugText.providerAttempts.length !== 2) {
  throw new Error("Expected Project Planning debug text to preserve provider diagnostics.")
}

if (!parsedDebugText.filledIntakeFields.includes("firstVersion")) {
  throw new Error("Expected Project Planning debug text to include filled intake field names.")
}

if (parsedDebugText.intakeFields.find((field) => field.name === "skipForNow")?.filled) {
  throw new Error("Expected Project Planning debug text to mark empty intake fields as unfilled.")
}

if (debugText.includes("Busy people who forget to drink water.")) {
  throw new Error("Expected Project Planning debug text to avoid raw intake answers.")
}

if (!parsedDebugText.phaseTitles.includes("Daily Hydration Tracking")) {
  throw new Error("Expected Project Planning debug text to include generated phase titles.")
}

for (const key of [
  "trackerEnabled",
  "currentPhaseIndex",
  "currentPhaseTitle",
  "nextPhaseTitle",
  "phaseStatus",
  "advanceRecommended",
  "trackerCompleted",
  "prdHash",
  "promptHash"
]) {
  if (!(key in parsedDebugText)) {
    throw new Error(`Expected Project Planning debug text to include tracker diagnostic field "${key}".`)
  }
}

if ("description" in parsedDebugText || "prompt" in parsedDebugText || "apiKey" in parsedDebugText) {
  throw new Error("Expected Project Planning debug text to avoid raw prompts and secrets.")
}

const contextPayload = buildProjectPlanningContextPayload(draft)

if (!contextPayload.projectContext.trim() || !contextPayload.currentState.trim()) {
  throw new Error("Expected the PRD draft to map into non-empty project context and current state.")
}

if (!contextPayload.structuredMemory.currentFeatureArea.trim()) {
  throw new Error("Expected the planning bridge to seed the current feature area.")
}

if (!contextPayload.projectContext.includes("## Implementation Phases")) {
  throw new Error("Expected implementation phases to be preserved in the saved project context.")
}

if (!contextPayload.projectContext.includes("## Non-Functional Requirements")) {
  throw new Error("Expected NFR constraints to be preserved in the saved project context.")
}

if (!contextPayload.structuredMemory.stableConstraints.some((item) => /Customers sign in/i.test(item))) {
  throw new Error("Expected NFR values to seed saved stable constraints.")
}

const tracker = buildProjectTrackerRecord({
  projectKey: "chatgpt.com::thread",
  projectLabel: "Water Intake",
  surface: "chatgpt",
  prdHash: "prd-hash",
  submittedPromptHash: "prompt-hash",
  phases: [
    {
      title: "Core Logging Loop",
      goal: "Validate that users can log water quickly.",
      buildScope: ["Tap-based logger", "Daily progress ring"],
      outOfScope: ["Notifications"],
      dataStateNeeded: ["Daily intake records"],
      deliverables: ["Logging screen"],
      acceptanceCriteria: ["Progress updates immediately"],
      validationProofExpected: ["Show 3 logs without prompting"]
    },
    {
      title: "Smart Reminders",
      goal: "Prompt users when they fall behind.",
      buildScope: ["Reminder preferences", "Snooze action"],
      outOfScope: ["Adaptive timing"],
      dataStateNeeded: ["Reminder schedule"],
      deliverables: ["Reminder settings"],
      acceptanceCriteria: ["Reminder fires near scheduled time"],
      validationProofExpected: ["Show reminder delivery log"]
    }
  ],
  timestamp: "2026-05-13T00:00:00.000Z"
})

if (!tracker) {
  throw new Error("Expected Project Tracker record to build from PRD phases.")
}

if (
  !isProjectTrackerBoundTo({
    record: tracker,
    projectKey: "chatgpt.com::thread",
    surface: "chatgpt",
    prdHash: "prd-hash",
    submittedPromptHash: "prompt-hash"
  })
) {
  throw new Error("Expected Project Tracker binding to match project, surface, PRD hash, and submitted prompt hash.")
}

if (
  isProjectTrackerBoundTo({
    record: tracker,
    projectKey: "chatgpt.com::thread",
    surface: "chatgpt",
    prdHash: "different-prd-hash",
    submittedPromptHash: "prompt-hash"
  })
) {
  throw new Error("Expected Project Tracker binding to reject stale PRD hashes.")
}

const staleTracker = deactivateProjectTracker({
  record: tracker,
  reason: "stale_prd",
  timestamp: "2026-05-13T00:00:30.000Z"
})

if (staleTracker.enabled || staleTracker.disabledReason !== "stale_prd") {
  throw new Error("Expected stale Project Tracker records to be stored inactive.")
}

const trackerBrief = buildProjectTrackerDeepAnalysisBrief(tracker)

if (!trackerBrief?.promptText.includes("CURRENT PHASE REQUIREMENTS")) {
  throw new Error("Expected Project Tracker Deep Analysis brief to include current phase requirements.")
}

if (!trackerBrief.promptText.includes("REQUIREMENT-LEVEL CHECKLIST")) {
  throw new Error("Expected Project Tracker Deep Analysis brief to require phase-level checklist matches.")
}

if (!trackerBrief.promptText.includes("NEXT PHASE REQUIREMENTS")) {
  throw new Error("Expected Project Tracker Deep Analysis brief to include next phase requirements.")
}

if (!trackerBrief.promptText.includes("Core Logging Loop") || !trackerBrief.promptText.includes("Smart Reminders")) {
  throw new Error("Expected Project Tracker brief to include current and next phase titles.")
}

const trackerNextPrompt = buildProjectTrackerHandoffPrompt({
  record: tracker,
  analysis: {
    overallStatus: "pass",
    confidence: "medium",
    requirementMatches: [
      {
        requirementText: "Tap-based logger",
        status: "pass"
      },
      {
        requirementText: "Progress updates immediately",
        status: "pass"
      }
    ]
  }
})

if (
  !trackerNextPrompt ||
  trackerNextPrompt.promptIntent !== "implement_next_step" ||
  !trackerNextPrompt.generatedPrompt.includes("Implement Phase 2: Smart Reminders only.") ||
  !trackerNextPrompt.generatedPrompt.includes("Reminder preferences") ||
  trackerNextPrompt.generatedPrompt.includes("Tap-based logger")
) {
  throw new Error("Expected Project Tracker handoff prompt to target the next phase only after current phase passes.")
}

const trackerMissingPrompt = buildProjectTrackerHandoffPrompt({
  record: tracker,
  latestAnswerContext: "I built the logging screen, but I have not validated that the progress ring updates immediately yet.",
  analysis: {
    overallStatus: "needs_confirmation",
    confidence: "medium",
    requirementMatches: [
      {
        requirementText: "Progress updates immediately",
        status: "missing"
      }
    ]
  }
})

if (
  !trackerMissingPrompt ||
  trackerMissingPrompt.promptIntent !== "confirm_missing_requirements" ||
  !trackerMissingPrompt.generatedPrompt.includes("Finish Phase 1: Core Logging Loop") ||
  !trackerMissingPrompt.generatedPrompt.includes("Progress updates immediately") ||
  !trackerMissingPrompt.generatedPrompt.includes("latest answer context") ||
  !trackerMissingPrompt.generatedPrompt.includes("I built the logging screen") ||
  !trackerMissingPrompt.generatedPrompt.includes("complete only that item and then provide evidence") ||
  !trackerMissingPrompt.nextStepRequirements.includes("Progress updates immediately") ||
  !trackerMissingPrompt.generatedPrompt.includes("Do not start Phase 2: Smart Reminders yet.")
) {
  throw new Error("Expected Project Tracker handoff prompt to keep the agent on missing current-phase work.")
}

const advancedTracker = advanceProjectTrackerAfterPhasePass({
  record: tracker,
  timestamp: "2026-05-13T00:01:00.000Z"
})

if (!advancedTracker || advancedTracker.currentPhaseIndex !== 1) {
  throw new Error("Expected Project Tracker to advance to the next phase after a confirmed pass.")
}

if (
  advancedTracker.phases[0].status !== "completed" ||
  advancedTracker.phases[1].status !== "in_progress" ||
  !advancedTracker.enabled
) {
  throw new Error("Expected Project Tracker phase advancement to complete the current phase and start the next.")
}

const completedTracker = advanceProjectTrackerAfterPhasePass({
  record: advancedTracker,
  timestamp: "2026-05-13T00:02:00.000Z"
})

if (!completedTracker?.completedAt || completedTracker.enabled || completedTracker.disabledReason !== "completed") {
  throw new Error("Expected Project Tracker to disable itself after the final phase is confirmed complete.")
}

const syncedPlanningState = sanitizeProjectPlanningStateForSync({
  phase: "review",
  description: richDescription,
  coverageReport: richCoverage,
  prdSnapshot: richPrdSnapshot,
  questions: richQuestions,
  activeQuestionIndex: 0,
  answerState: {},
  otherAnswerState: {},
  generatedPrd: draft,
  completed: true
})

if (!syncedPlanningState) {
  throw new Error("Expected a meaningful planning draft to serialize for sync.")
}

const restoredPlanningState = restoreProjectPlanningStateFromSync(syncedPlanningState)

if (!restoredPlanningState || restoredPlanningState.phase !== "review" || !restoredPlanningState.generatedPrd) {
  throw new Error("Expected serialized planning state to restore cleanly.")
}

if (restoredPlanningState.prdSnapshot?.scope.draft !== richPrdSnapshot.scope.draft) {
  throw new Error("Expected serialized planning state to preserve the PRD snapshot.")
}

console.log("project-planning-smoke: ok")
