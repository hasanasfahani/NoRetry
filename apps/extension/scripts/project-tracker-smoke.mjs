import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  advanceProjectTrackerAfterPhasePass,
  buildProjectTrackerCurrentPhasePrompt,
  buildProjectTrackerDeepAnalysisBrief,
  buildProjectTrackerFinalReviewPrompt,
  buildProjectTrackerHandoffPrompt,
  buildProjectTrackerRecord,
  deactivateProjectTracker,
  hashProjectTrackerText,
  isProjectTrackerBoundTo,
  isProjectTrackerAwaitingFreshAnswer,
  markProjectTrackerFinalReviewAnswerReceived,
  markProjectTrackerFinalReviewCopied,
  markProjectTrackerFinalReviewSubmitted,
  markProjectTrackerTestingCheckpointAnswered,
  shouldShowProjectTrackerFinalReview,
  shouldAdvanceProjectTrackerFromAnalysis
} from "../lib/project-tracker/project-tracker.ts"
import { hashDeepAnalysisV2Text } from "../../../packages/shared/src/deep-analysis-v2.ts"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const extensionRoot = resolve(scriptDir, "..")
const contentScriptSource = readFileSync(resolve(extensionRoot, "contents/replit-agent.tsx"), "utf8")
const reviewAnalysisSource = readFileSync(resolve(extensionRoot, "lib/review/services/review-analysis.ts"), "utf8")
const reviewPopupOrchestratorSource = readFileSync(
  resolve(extensionRoot, "lib/review/orchestrator/review-popup-orchestrator.ts"),
  "utf8"
)
const reviewPopupSource = readFileSync(resolve(extensionRoot, "components/review-popup/review/ReviewPopup.tsx"), "utf8")
const reviewPromptModeSource = readFileSync(resolve(extensionRoot, "components/review-popup/review/ReviewPromptMode.tsx"), "utf8")
const popupShellSource = readFileSync(resolve(extensionRoot, "components/review-popup/shared/PopupShell.tsx"), "utf8")
const statusBadgeSource = readFileSync(resolve(extensionRoot, "components/review-popup/shared/StatusBadge.tsx"), "utf8")
const loadingStateSource = readFileSync(resolve(extensionRoot, "components/review-popup/shared/LoadingState.tsx"), "utf8")
const reviewTypesSource = readFileSync(resolve(extensionRoot, "components/review-popup/review/review-types.ts"), "utf8")
const deepAnalysisViewModelSource = readFileSync(resolve(extensionRoot, "lib/review/deep-analysis-v2-view-model.ts"), "utf8")
const storageSource = readFileSync(resolve(extensionRoot, "lib/storage.ts"), "utf8")

assert.match(
  reviewPopupSource,
  /data-reeva-surface="project-tracker"/,
  "Project Tracker card exposes an explicit theme surface"
)
assert.match(
  popupShellSource,
  /\[data-reeva-surface="project-tracker"\]/,
  "dark mode defines a dedicated Project Tracker surface"
)

const basePhases = [
  {
    title: "Core Logging Loop",
    goal: "Validate that users can log water quickly.",
    buildScope: ["Tap-based intake logger", "Daily progress ring"],
    outOfScope: ["Push notifications"],
    dataStateNeeded: ["Daily intake records", "User goal"],
    deliverables: ["Logging screen", "Goal setup"],
    acceptanceCriteria: ["User completes first log in under 10 seconds", "Progress ring updates immediately"],
    validationProofExpected: ["Show 5/5 users logging 3 times without prompting"]
  },
  {
    title: "Smart Reminders",
    goal: "Prompt users when they fall behind.",
    buildScope: ["Time-based reminders", "Snooze option"],
    outOfScope: ["Adaptive reminder timing"],
    dataStateNeeded: ["Reminder preferences", "Reminder delivery log"],
    deliverables: ["Push notification service", "Reminder settings screen"],
    acceptanceCriteria: ["Reminder fires within 15 minutes of scheduled time"],
    validationProofExpected: ["Show notification delivery log"]
  }
]

const prdText = "# Water Intake PRD\n\n## Implementation Phases\n\n- Core Logging Loop\n- Smart Reminders"
const submittedPrompt = "Implement this PRD one phase at a time.\n\nWater Intake PRD"
const prdHash = hashProjectTrackerText(prdText)
const submittedPromptHash = hashProjectTrackerText(submittedPrompt)

const tracker = buildProjectTrackerRecord({
  projectKey: "chatgpt.com::water-intake",
  projectLabel: "Water Intake",
  surface: "chatgpt",
  prdHash,
  submittedPromptHash,
  phases: basePhases,
  timestamp: "2026-05-13T00:00:00.000Z"
})

assert.ok(tracker, "tracker created from PRD submit")
assert.equal(tracker.enabled, true)
assert.equal(tracker.projectId, `chatgpt.com::water-intake::${prdHash}`)
assert.equal(tracker.currentPhaseIndex, 0)
assert.equal(tracker.phases[0].status, "in_progress")
assert.equal(tracker.phases[1].status, "not_started")
assert.equal(tracker.awaitingNextPhaseAnswer, false)
assert.equal(
  isProjectTrackerBoundTo({
    record: tracker,
    projectKey: "chatgpt.com::water-intake",
    surface: "chatgpt",
    prdHash,
    submittedPromptHash
  }),
  true,
  "tracker binding includes project, surface, PRD hash, and submitted prompt hash"
)

const invalidTracker = buildProjectTrackerRecord({
  projectKey: "chatgpt.com::invalid",
  projectLabel: "Invalid",
  surface: "chatgpt",
  prdHash: "bad-prd",
  submittedPromptHash: "bad-prompt",
  phases: [
    {
      title: "Incomplete Phase",
      goal: "",
      buildScope: [],
      deliverables: [],
      acceptanceCriteria: []
    }
  ],
  timestamp: "2026-05-13T00:00:00.000Z"
})

assert.equal(invalidTracker, null, "invalid PRD does not enable tracker")

const phaseOnePass = {
  overallStatus: "pass",
  confidence: "medium",
  requirementMatches: [
    {
      requirementText: "User completes first log in under 10 seconds",
      status: "pass"
    },
    {
      requirementText: "Progress ring updates immediately",
      status: "pass"
    }
  ]
}

assert.equal(shouldAdvanceProjectTrackerFromAnalysis(phaseOnePass), true)

const genericPhasePass = {
  overallStatus: "pass",
  confidence: "high",
  requirementMatches: [
    {
      requirementText: "Match the submitted prompt requirements.",
      status: "pass"
    }
  ]
}

assert.equal(
  shouldAdvanceProjectTrackerFromAnalysis(genericPhasePass),
  false,
  "generic pass row does not advance project tracker"
)
const genericPrompt = buildProjectTrackerHandoffPrompt({
  record: tracker,
  analysis: genericPhasePass,
  latestAnswerContext: "Phase 1 looks complete, but the review did not provide phase-level evidence."
})
assert.equal(genericPrompt.promptIntent, "confirm_missing_requirements")
assert.match(genericPrompt.generatedPrompt, /Finish Phase 1: Core Logging Loop/)
assert.match(genericPrompt.generatedPrompt, /User completes first log in under 10 seconds/)

const advanced = advanceProjectTrackerAfterPhasePass({
  record: tracker,
  timestamp: "2026-05-13T00:01:00.000Z",
  reviewedAssistantAnswerHash: "answer-hash-1",
  reviewedSubmittedPromptHash: "phase-1-prompt-hash"
})

assert.ok(advanced, "phase 1 pass advances to phase 2")
assert.equal(advanced.currentPhaseIndex, 1)
assert.equal(advanced.phases[0].status, "completed")
assert.equal(advanced.phases[1].status, "in_progress")
assert.equal(advanced.enabled, true)
assert.equal(advanced.awaitingNextPhaseAnswer, true)
assert.equal(advanced.lastReviewedAssistantAnswerHash, "answer-hash-1")
assert.equal(
  isProjectTrackerAwaitingFreshAnswer({
    record: advanced,
    assistantAnswerHash: "answer-hash-1"
  }),
  true,
  "same answer that advanced phase 1 cannot be reused as phase 2 evidence"
)
assert.equal(
  isProjectTrackerAwaitingFreshAnswer({
    record: advanced,
    assistantAnswerHash: "answer-hash-2"
  }),
  false,
  "new assistant answer is eligible for current phase review"
)
const currentPhasePrompt = buildProjectTrackerCurrentPhasePrompt(advanced)
assert.equal(currentPhasePrompt.promptIntent, "implement_next_step")
assert.match(currentPhasePrompt.generatedPrompt, /Implement Phase 2: Smart Reminders only\./)
assert.match(currentPhasePrompt.recommendedNextMove, /Submit the Phase 2: Smart Reminders prompt/)
assert.doesNotMatch(currentPhasePrompt.generatedPrompt, /All tracked implementation phases are complete/)

const phaseOnePartial = {
  overallStatus: "needs_confirmation",
  confidence: "medium",
  requirementMatches: [
    {
      requirementText: "Progress ring updates immediately",
      status: "missing"
    }
  ]
}

assert.equal(shouldAdvanceProjectTrackerFromAnalysis(phaseOnePartial), false)
const partialPrompt = buildProjectTrackerHandoffPrompt({
  record: tracker,
  analysis: phaseOnePartial,
  latestAnswerContext: "I built the logger but did not verify the progress ring yet."
})

assert.equal(tracker.currentPhaseIndex, 0, "phase 1 partial stays on phase 1")
assert.match(partialPrompt.generatedPrompt, /I built the logger/)
assert.match(partialPrompt.generatedPrompt, /Progress ring updates immediately/)
assert.match(partialPrompt.generatedPrompt, /If it is already implemented, provide concrete evidence/)
assert.match(partialPrompt.generatedPrompt, /If it is not implemented or not working, complete only that item/)
assert.match(partialPrompt.generatedPrompt, /Do not start Phase 2: Smart Reminders yet\./)
assert.deepEqual(partialPrompt.nextStepRequirements, ["Progress ring updates immediately"])

const syncTracker = buildProjectTrackerRecord({
  projectKey: "chatgpt.com::shared-list",
  projectLabel: "Shared List",
  surface: "chatgpt",
  prdHash: "sync-prd",
  submittedPromptHash: "sync-prompt",
  phases: [
    {
      title: "Shared List Foundation",
      goal: "Single shared list with basic CRUD and live sync between two accounts.",
      buildScope: ["Creator adds/edits/deletes items", "Shopper views live-updating list without refresh"],
      outOfScope: ["Item assignment"],
      deliverables: ["OAuth login", "Real-time list sync via WebSockets"],
      acceptanceCriteria: ["Two users see updates within 2 seconds", "List persists across sessions"],
      validationProofExpected: ["Screen recording of simultaneous edit sync across two phones"]
    },
    {
      title: "Shopper Assignment & Tracking",
      goal: "Let shoppers claim and track items.",
      buildScope: ["Assign shopper to item"],
      deliverables: ["Assignment UI"],
      acceptanceCriteria: ["Assigned item updates for both users"]
    }
  ],
  timestamp: "2026-05-13T00:04:00.000Z"
})
const syncPartialPrompt = buildProjectTrackerHandoffPrompt({
  record: syncTracker,
  analysis: {
    overallStatus: "needs_confirmation",
    confidence: "medium",
    ignoredExternalValidation: ["Validation proof: Screen recording of simultaneous edit sync across two phones"],
    requirementMatches: [
      {
        requirementText: "Build scope: Shopper views live-updating list without refresh",
        status: "unclear"
      },
      {
        requirementText: "Acceptance criteria: Two users see updates within 2 seconds",
        status: "pass"
      },
      {
        requirementText: "Acceptance criteria: List persists across sessions",
        status: "pass"
      }
    ]
  },
  latestAnswerContext: "Phase 1 is mostly complete, but shopper live-update evidence was unclear."
})

assert.match(syncPartialPrompt.generatedPrompt, /Two users see updates within 2 seconds/, "multi-user timing acceptance criteria stays actionable")
assert.doesNotMatch(syncPartialPrompt.generatedPrompt, /Screen recording of simultaneous edit sync across two phones/, "ignored external validation is removed from follow-up prompts")

const carryoverAnalysis = {
  overallStatus: "pass",
  confidence: "medium",
  phaseAdvanceBasis: "phase_completion_claimed_with_carryover",
  phaseCompletionClaimed: true,
  requirementMatches: [
    {
      requirementText: "Build scope: Shopper views live-updating list without refresh",
      status: "unclear"
    },
    {
      requirementText: "Acceptance criteria: Two users see updates within 2 seconds",
      status: "pass"
    },
    {
      requirementText: "Acceptance criteria: List persists across sessions",
      status: "pass"
    }
  ]
}
assert.equal(shouldAdvanceProjectTrackerFromAnalysis(carryoverAnalysis), true, "phase completion claim with carryover advances tracker")
assert.equal(
  shouldAdvanceProjectTrackerFromAnalysis({
    ...carryoverAnalysis,
    overallStatus: "needs_confirmation",
    confidence: "low"
  }),
  true,
  "carryover phase completion signal advances even when provider status stayed conservative"
)
const carryoverPrompt = buildProjectTrackerHandoffPrompt({
  record: syncTracker,
  analysis: carryoverAnalysis,
  latestAnswerContext: "Phase 1 is complete, but shopper live update was unclear."
})
assert.equal(carryoverPrompt.promptIntent, "implement_next_step")
assert.match(carryoverPrompt.generatedPrompt, /Implement Phase 2: Shopper Assignment & Tracking only/)
assert.match(carryoverPrompt.generatedPrompt, /Also carry forward these missing or unclear items/)
assert.match(carryoverPrompt.generatedPrompt, /Build scope: Shopper views live-updating list without refresh/)
assert.doesNotMatch(carryoverPrompt.generatedPrompt, /Current phase requirements/)
assert.doesNotMatch(carryoverPrompt.generatedPrompt, /Validation proof expected:[\s\S]*Screen recording/)

const nextPrompt = buildProjectTrackerHandoffPrompt({
  record: tracker,
  analysis: phaseOnePass,
  latestAnswerContext: "Phase 1 is complete with validation proof."
})

assert.equal(nextPrompt.promptIntent, "implement_next_step")
assert.match(nextPrompt.generatedPrompt, /Use the work already completed in the latest answer as the starting point/)
assert.match(nextPrompt.generatedPrompt, /Implement Phase 2: Smart Reminders only\./)
assert.match(nextPrompt.generatedPrompt, /Time-based reminders/)
assert.doesNotMatch(nextPrompt.generatedPrompt, /Tap-based intake logger/)

const finalPass = advanceProjectTrackerAfterPhasePass({
  record: advanced,
  timestamp: "2026-05-13T00:02:00.000Z",
  carryoverItems: ["Acceptance criteria: Progress ring updates within 500ms of entry"]
})

assert.ok(finalPass, "final phase pass disables tracker automatically")
assert.equal(finalPass.enabled, false)
assert.equal(finalPass.disabledReason, "completed")
assert.ok(finalPass.completedAt)
assert.deepEqual(
  finalPass.carryoverItems,
  ["Acceptance criteria: Progress ring updates within 500ms of entry"],
  "final phase pass persists carryover for the completion handoff"
)
assert.equal(shouldShowProjectTrackerFinalReview(finalPass), true, "completed tracker shows one final review handoff")
const finalReviewPrompt = buildProjectTrackerFinalReviewPrompt({
  record: finalPass
})
assert.ok(finalReviewPrompt, "completed tracker creates a final review handoff prompt")
assert.equal(finalReviewPrompt.promptIntent, "review_before_advancing")
assert.match(finalReviewPrompt.generatedPrompt, /All tracked implementation phases are complete/)
assert.match(finalReviewPrompt.generatedPrompt, /First, resolve any remaining tracked implementation gaps/)
assert.match(finalReviewPrompt.generatedPrompt, /Progress ring updates within 500ms/)
assert.match(finalReviewPrompt.generatedPrompt, /implement only that remaining tracked requirement now/)
assert.match(finalReviewPrompt.generatedPrompt, /Main manual test cases I should run as the user/)
assert.match(finalReviewPrompt.generatedPrompt, /Do not add new scope beyond these tracked requirements/)
const finalReviewPromptHash = hashDeepAnalysisV2Text(finalReviewPrompt.generatedPrompt)
assert.equal(
  finalReviewPromptHash,
  hashDeepAnalysisV2Text(`  ${finalReviewPrompt.generatedPrompt.replace(/\n/g, "\n  ")}  `),
  "final review identity is stable across composer whitespace normalization"
)
assert.notEqual(
  finalReviewPromptHash,
  hashDeepAnalysisV2Text("Please investigate this separate user prompt."),
  "a later user prompt does not match the completed-tracker checkpoint"
)
const finalReviewCopied = markProjectTrackerFinalReviewCopied({
  record: finalPass,
  timestamp: "2026-05-13T00:02:15.000Z"
})
assert.ok(finalReviewCopied, "copying marks the final review prompt without consuming the review state")
assert.equal(shouldShowProjectTrackerFinalReview(finalReviewCopied), true, "copying keeps the final review visible")
const finalReviewSubmitted = markProjectTrackerFinalReviewSubmitted({
  record: finalReviewCopied,
  submittedPromptHash: finalReviewPromptHash,
  timestamp: "2026-05-13T00:02:30.000Z"
})
assert.ok(finalReviewSubmitted, "final review submit marker updates completed tracker")
assert.equal(finalReviewSubmitted.finalReviewSubmittedPromptHash, finalReviewPromptHash)
assert.equal(finalReviewSubmitted.testingCheckpointAnsweredAt, null)
assert.equal(shouldShowProjectTrackerFinalReview(finalReviewSubmitted), true, "submission keeps final review visible until a fresh answer arrives")
const finalReviewAnswerReceived = markProjectTrackerFinalReviewAnswerReceived({
  record: finalReviewSubmitted,
  timestamp: "2026-05-13T00:02:40.000Z"
})
assert.ok(finalReviewAnswerReceived, "fresh final-review answer opens the testing checkpoint")
assert.equal(shouldShowProjectTrackerFinalReview(finalReviewAnswerReceived), false, "fresh answer consumes the final review state")
const testingCheckpointAnswered = markProjectTrackerTestingCheckpointAnswered({
  record: finalReviewAnswerReceived,
  timestamp: "2026-05-13T00:02:45.000Z"
})
assert.ok(testingCheckpointAnswered, "testing choice consumes the post-review checkpoint")
assert.equal(testingCheckpointAnswered.testingCheckpointAnsweredAt, "2026-05-13T00:02:45.000Z")
assert.equal(
  markProjectTrackerTestingCheckpointAnswered({
    record: testingCheckpointAnswered,
    timestamp: "2026-05-13T00:02:50.000Z"
  }),
  null,
  "testing checkpoint is consumed only once"
)

const manualOff = deactivateProjectTracker({
  record: tracker,
  reason: "manual",
  timestamp: "2026-05-13T00:03:00.000Z"
})

assert.equal(manualOff.enabled, false, "manual toggle disables tracker")
assert.equal(manualOff.disabledReason, "manual")
assert.equal(manualOff.projectId, tracker.projectId, "manual toggle keeps tracker stored")

const newPrdTracker = buildProjectTrackerRecord({
  projectKey: "chatgpt.com::water-intake",
  projectLabel: "Water Intake v2",
  surface: "chatgpt",
  prdHash: "new-prd-hash",
  submittedPromptHash: "new-prompt-hash",
  phases: basePhases,
  timestamp: "2026-05-13T00:04:00.000Z"
})

assert.ok(newPrdTracker, "stale PRD hash creates new tracker")
assert.notEqual(newPrdTracker.projectId, tracker.projectId)
assert.equal(
  isProjectTrackerBoundTo({
    record: tracker,
    projectKey: "chatgpt.com::water-intake",
    surface: "chatgpt",
    prdHash: "new-prd-hash",
    submittedPromptHash: "new-prompt-hash"
  }),
  false,
  "old tracker binding rejects new PRD hash"
)

const deepAnalysisBrief = buildProjectTrackerDeepAnalysisBrief(tracker)
assert.ok(deepAnalysisBrief, "tracker creates compact Deep Analysis brief")
assert.match(deepAnalysisBrief.promptText, /CURRENT PHASE REQUIREMENTS/)
assert.match(deepAnalysisBrief.promptText, /REQUIREMENT-LEVEL CHECKLIST/)
assert.match(deepAnalysisBrief.promptText, /Do not collapse/)
assert.match(deepAnalysisBrief.promptText, /NEXT PHASE REQUIREMENTS/)
assert.match(deepAnalysisBrief.promptText, /Validation proof expected|5\/5 users logging/i, "Deep Analysis receives validation rows for LLM classification")
assert.match(deepAnalysisBrief.promptText, /Ignore external validation for phase advancement/i, "LLM classifies external validation instead of hardcoded filtering")
assert.doesNotMatch(deepAnalysisBrief.promptText, /Product Overview|Target User|Success Criteria/, "no full PRD in repeated Deep Analysis calls")

assert.match(contentScriptSource, /getDeepAnalysisV2ContextOverride/, "normal Deep Analysis remains untouched except for one routing branch")
assert.match(contentScriptSource, /projectTrackerMatchesCurrentBinding/, "tracker routing is binding-gated")
assert.match(contentScriptSource, /shouldAdvanceProjectTrackerFromAnalysis/, "tracker does not advance unless LLM confirms pass")
assert.match(contentScriptSource, /trackerAdjustedAnalysis/, "tracker guard aligns visible Deep Analysis status with phase advancement decision")
assert.match(contentScriptSource, /project-tracker-missing-/, "tracker guard exposes missing phase rows when generic Deep Analysis pass is rejected")
assert.match(contentScriptSource, /tracker_deep_analysis_unavailable/, "tracker mode does not synthesize a next prompt when Deep Analysis v2 is unavailable")
assert.match(contentScriptSource, /Do not advance the project tracker without an LLM-backed review/, "unavailable tracker review blocks non-LLM next prompts")
assert.match(contentScriptSource, /handleRetryReviewAnalysis/, "unavailable review exposes a retry handler")
assert.match(reviewPopupSource, /Retry analysis/, "unavailable review exposes a retry button")
assert.match(reviewPopupOrchestratorSource, /bypassPersistentCache/, "retry bypasses cached unavailable analysis")
assert.match(contentScriptSource, /getDeepAnalysisV2PreflightResult/, "tracker can short-circuit stale same-answer phase reviews")
assert.match(contentScriptSource, /awaiting_fresh_answer_for_current_phase/, "same answer cannot advance or be judged as the next phase")
assert.match(contentScriptSource, /await syncProjectTrackerFromDeepAnalysis/, "primary action commits approved tracker advancement before handing off the next prompt")
assert.match(contentScriptSource, /tracker_completed_final_review/, "completed tracker gets one final MVP review prompt")
assert.match(contentScriptSource, /syncProjectTrackerFinalReviewCopied/, "copying final review prompt records copy state only")
assert.match(
  contentScriptSource,
  /syncProjectTrackerFinalReviewCopied\(result, viewModel\.prompt\)/,
  "final review handoff records the copy without marking it submitted"
)
assert.match(
  contentScriptSource,
  /syncProjectTrackerFinalReviewSubmittedFromPrompt\(prompt\)/,
  "the real Replit send marks the final review prompt submitted"
)
assert.match(
  contentScriptSource,
  /return latestSubmittedPrompt \? hashDeepAnalysisV2Text\(latestSubmittedPrompt\) : null/,
  "latest submitted prompt uses the same normalized identity as Deep Analysis"
)
assert.doesNotMatch(
  contentScriptSource,
  /hashProjectTrackerText\(latestSubmittedPrompt\)/,
  "final review routing does not compare normalized and raw prompt hashes"
)
assert.match(contentScriptSource, /onPostTrackerTestingPromptSubmit/, "post-tracker testing prompt can be copied for the assistant")
assert.match(contentScriptSource, /label: "Next Move"/, "prompt optimizer entry is user-facing as Next Move")
assert.match(contentScriptSource, /const NEXT_MOVE_V2_ENABLED = true/, "Next Move v2 can replace prompt optimizer entry behind a small flag")
assert.match(contentScriptSource, /openNextMoveV2PromptMode/, "typed drafts open directly into the Next Move v2 shell")
assert.match(contentScriptSource, /reviewTypingState\.active \|\| NEXT_MOVE_V2_ENABLED/, "Next Move v2 does not depend on background typing state to open")
assert.match(contentScriptSource, /!NEXT_MOVE_V2_ENABLED &&\s*reviewPopupOpen/s, "old prompt tree orchestrator is dormant while Next Move v2 is enabled")
assert.match(contentScriptSource, /Copy Next Move prompt/, "generated prompt action is user-facing as Next Move")
assert.match(reviewPopupSource, /eyebrow=\{isPromptMode \? "Next Move"/, "prompt mode popup uses Next Move title")
assert.match(reviewPopupSource, /function NextMoveV2Shell/, "Next Move v2 shell renders in prompt mode")
assert.match(reviewPopupSource, /Prompt Optimizer v2/, "Next Move v2 is labeled separately from the old tree")
assert.match(reviewPopupSource, /Decision-tree flow/, "Next Move v2 presents a decision-tree style path chooser")
assert.match(reviewPopupSource, /handleNextMoveV2Select/, "Next Move v2 selections open their focused detail page")
assert.match(reviewPopupSource, /setNextMoveV2Selection\(props\.promptModeState\.nextMoveInitialChoice \?\? "none"\)/, "Next Move v2 opens with the initial selected path when provided")
assert.match(reviewPopupSource, /Next Move questions/, "Next Move v2 shows stable decision-tree questions")
assert.match(reviewPopupSource, /handleDescriptionEditStart/, "Next Move v2 descriptions can be edited from selection and path pages")
assert.match(reviewPopupSource, /Save Description/, "the four-path selection page can save an edited description")
assert.match(reviewPopupSource, /Submit & Regenerate Questions/, "a path page can submit edits and regenerate questions")
assert.match(
  reviewPopupSource,
  /if \(props\.selectedNextMove !== "none"\)[\s\S]*props\.onNextMoveSelect\(props\.selectedNextMove\)[\s\S]*setSessionQuestions\(\[\]\)[\s\S]*setQuestionSetLoading\(true\)[\s\S]*setQuestionSetRetryKey/,
  "editing a path description discards answers and reruns LLM question generation with progress"
)
assert.match(reviewPopupSource, /nextMoveQuestionTab/, "Next Move v2 uses one-question-at-a-time navigation")
assert.match(reviewPopupSource, /nextMoveOptionButton/, "Next Move v2 answers are selected through multiple-choice options")
assert.match(reviewPopupSource, /Select all that apply\./, "Next Move v2 questions clearly support multi-select answers")
assert.match(reviewPopupSource, /parseNextMoveV2SelectedOptions/, "Next Move v2 stores and reads multi-select answers")
assert.match(reviewPopupSource, /NEXT_MOVE_V2_OTHER_OPTION/, "Next Move v2 keeps an Other option for user-specific detail")
assert.match(popupShellSource, /data-reeva-theme/, "review popup uses a scoped theme mode")
assert.match(statusBadgeSource, /data-reeva-tone/, "review popup badges expose tone attributes for dark-mode contrast")
assert.match(reviewPopupSource, /<strong>Description<\/strong>/, "Next Move v2 shows the description as editable context")
assert.match(reviewPopupSource, /buildNextMoveV2StaticPrompt/, "Next Move v2 generates prompts from a local static template first")
assert.match(contentScriptSource, /trimmedFallback/, "Next Move v2 keeps static prompt generation as fallback")
assert.match(reviewPopupSource, /handleCopyGeneratedPrompt/, "Next Move v2 copies only after showing the generated prompt")
assert.match(contentScriptSource, /loadNextMoveV2QuestionSet/, "Next Move v2 loads one complete LLM question set")
assert.match(contentScriptSource, /buildNextMoveV2ProjectContextBrief/, "Next Move v2 questions receive compact project context")
assert.match(contentScriptSource, /Project context brief/, "Next Move v2 interpreter prompts include project context")
assert.match(contentScriptSource, /buildPromptModeSessionKey\(projectContextBrief\)/, "Next Move v2 caches are scoped by project context")
assert.match(contentScriptSource, /next_move_v2_question_set/, "Next Move v2 uses a dedicated complete question-set task")
assert.match(contentScriptSource, /nextMoveV2QuestionSetCacheRef/, "complete question sets are cached by draft, context, and path")
assert.match(contentScriptSource, /Return exactly five questions in a logical order/, "question generation requires one coherent five-question set")
assert.match(contentScriptSource, /Cover these five topics in this exact order/, "LLM questions align with each path's five stable answer slots")
assert.match(contentScriptSource, /nextQuestions\.length !== 5/, "incomplete LLM question sets are rejected")
assert.match(contentScriptSource, /labels\.size !== 5/, "duplicate LLM question sets are rejected")
assert.match(contentScriptSource, /options\.length < 3/, "LLM questions require at least three answer options")
assert.match(contentScriptSource, /distinctOptions\.size !== options\.length/, "duplicate LLM answer options are rejected")
assert.match(contentScriptSource, /Do not make options mutually exclusive/, "Next Move v2 prompts ask for multi-select-compatible options")
assert.match(reviewPopupSource, /questions\.length === staticQuestions\.length/, "the UI applies the LLM set only when all five questions are present")
for (const pathName of ["small_feature", "large_feature", "bug_fix", "small_change"]) {
  const sectionStart = reviewPopupSource.indexOf(`  ${pathName}: [`)
  const sectionEnd = reviewPopupSource.indexOf("\n  ],", sectionStart)
  const section = reviewPopupSource.slice(sectionStart, sectionEnd)
  assert.equal(
    (section.match(/\n    \{\n      id:/g) ?? []).length,
    5,
    `${pathName} must map the five-question LLM response onto exactly five stable answer IDs`
  )
}
assert.doesNotMatch(reviewPopupSource, /source: "fallback" as const/, "question generation never substitutes a static question set")
assert.match(reviewPopupSource, /Questions unavailable/, "failed LLM question generation shows an explicit unavailable state")
assert.match(reviewPopupSource, /Retry Questions/, "failed LLM question generation can be retried")
assert.doesNotMatch(contentScriptSource, /next_move_v2_follow_up_questions/, "Next Move v2 no longer mixes late follow-up questions")
assert.doesNotMatch(contentScriptSource, /next_move_v2_second_batch_questions/, "Next Move v2 no longer mixes a late second question batch")
assert.match(contentScriptSource, /generateNextMoveV2FinalPrompt/, "Next Move v2 can generate the final prompt through the interpreter")
assert.match(contentScriptSource, /next_move_v2_final_prompt/, "Next Move v2 final prompt generation uses a dedicated interpreter task")
assert.match(contentScriptSource, /nextMoveV2FinalPromptCacheRef/, "Next Move v2 final prompts are cached by draft, path, answers, and fallback")
assert.match(contentScriptSource, /Preserve the fallback prompt section order/, "Next Move v2 asks the LLM to preserve path template structure")
assert.match(contentScriptSource, /isValidNextMoveV2FinalPrompt/, "Next Move v2 falls back when the LLM drops required path-template sections")
assert.match(contentScriptSource, /Please implement this new small feature only\./, "Next Move v2 validates the small-feature template anchor")
assert.match(contentScriptSource, /Before implementing, create a fresh PRD for this large feature\./, "Next Move v2 validates the large-feature template anchor")
assert.match(contentScriptSource, /Please fix this bug only\./, "Next Move v2 validates the bug-fix template anchor")
assert.match(contentScriptSource, /Please make this small change only\./, "Next Move v2 validates the small-change template anchor")
assert.match(reviewPopupSource, /Generate New Prompt/, "Next Move v2 exposes final prompt generation without a flickering helper section")
assert.match(reviewPopupSource, /promptGenerationRequestRef/, "Next Move v2 guards against stale async final prompt results")
assert.match(reviewPopupSource, /answersSnapshot/, "Next Move v2 final prompt generation uses an answer snapshot")
assert.match(reviewPopupSource, /function handleAnswerChange/, "Next Move v2 clears generated prompts when answers change")
assert.match(contentScriptSource, /onNextMoveV2PromptSubmit=\{\(prompt\)[\s\S]*?copyPromptForManualHandoff\(prompt/, "Next Move v2 generated prompt copies through the shared handoff flow")
assert.match(reviewPromptModeSource, /title="Next Move"/, "prompt mode v1 UI is surfaced as Next Move")
assert.match(reviewPromptModeSource, /Next Move questions/, "question tree is surfaced as Next Move questions")
assert.match(reviewPromptModeSource, /Generate Next Move prompt/, "generation button is surfaced as Next Move")
assert.match(loadingStateSource, /Next Move/, "prompt loading state is surfaced as Next Move")
assert.match(reviewPopupSource, /Have you completed testing the MVP\?/, "completed tracker shows a testing checkpoint after final review")
assert.match(reviewPopupSource, /!props\.projectTracker\?\.testingCheckpointAnsweredAt/, "testing checkpoint stays visible until the user answers it")
assert.doesNotMatch(reviewPopupSource, /latestSubmittedPromptHash === finalReviewSubmittedPromptHash/, "testing checkpoint does not depend on fragile prompt identity matching")
assert.match(contentScriptSource, /tracker\.finalReviewAnswerReceivedAt/, "testing checkpoint waits for a fresh final-review answer")
assert.match(contentScriptSource, /choice !== "testing_complete"\) return/, "not-tested choice keeps the testing checkpoint pending")
assert.match(contentScriptSource, /markProjectTrackerTestingCheckpointAnswered/, "completed-testing choice is persisted on the tracker")
assert.match(
  contentScriptSource,
  /reviewPopupOrchestratorRef\.current\?\.invalidate\(\)[\s\S]*?shouldCapturePostTrackerFinalReviewAnswer\(\)[\s\S]*?capturePostTrackerFinalReviewAnswer\(\)[\s\S]*?return[\s\S]*?triggerActionIconAttention/,
  "a newly settled final-review answer skips Deep Analysis and opens the testing checkpoint"
)
assert.match(
  contentScriptSource,
  /const currentDraft = getCurrentDraftSnapshot\(\)\.text\.trim\(\)[\s\S]*?if \(hasUnsentPromptDraft\(currentDraft\)[\s\S]*?openNextMoveV2PromptMode\(currentDraft\)[\s\S]*?if \(shouldOpenPostTrackerTestingCheckpointDirectly\(\)\)/,
  "the unsent final-review draft remains editable before the testing checkpoint begins"
)
assert.match(reviewPopupSource, /No, I still need to test/, "testing checkpoint has a not-tested path")
assert.match(reviewPopupSource, /Get Manual Test Plan/, "not-tested path generates a manual validation prompt")
assert.match(reviewPopupSource, /Do not implement anything yet/, "manual validation prompt blocks accidental new implementation")
assert.match(reviewPopupSource, /Choose Next Move/, "tested path opens the next-move shell")
assert.match(reviewPopupSource, /New small feature/, "next-move shell includes small feature option")
assert.match(reviewPopupSource, /New large feature/, "next-move shell includes large feature option")
assert.match(reviewPopupSource, /Fix bug/, "next-move shell includes bug fix option")
assert.match(reviewPopupSource, /Small change/, "next-move shell includes small change option")
assert.match(reviewPopupSource, /onPostTrackerNextMoveV2Open/, "completed-testing flow hands off to the original Next Move v2 route")
assert.match(contentScriptSource, /onPostTrackerNextMoveV2Open=\{\(description, choice\) => openNextMoveV2PromptMode\(description, choice\)\}/, "post-tracker description opens the shared Next Move v2 shell with the selected path")
assert.match(reviewPopupSource, /setPostTrackerPage\("choose_next_move"\)/, "completed-testing flow asks for the next path before description")
assert.match(reviewPopupSource, /props\.onNextMoveV2Open\(seedDraft, selectedNextMove\)/, "completed-testing description carries the selected path into Next Move v2")
assert.match(reviewPopupSource, /What is broken\?/, "bug fix path asks for the bug summary")
assert.doesNotMatch(reviewPopupSource, /Add screenshot/, "bug fix path temporarily hides popup screenshot upload")
assert.match(
  reviewPopupSource,
  /attach screenshots or a screen recording of the bug directly in the AI agent/,
  "bug fix path reminds the user to attach visual evidence directly in the AI agent"
)
assert.doesNotMatch(reviewPopupSource, /Capture screenshot/, "bug fix path no longer depends on active-tab screenshot capture")
assert.match(reviewPopupSource, /Generate New Prompt/, "all next-move paths generate an optimized prompt before copy")
assert.match(reviewPopupSource, /Copy Prompt/, "all next-move paths copy only after prompt generation")
assert.match(reviewPopupSource, /NextMoveWorkflowSteps/, "Next Move keeps Description, Questions, and Generate Prompt visible in a workflow bar")
assert.match(reviewPopupSource, /data-reeva-question-state/, "Next Move exposes active, answered, and remaining question states")
assert.match(reviewPopupSource, /Question \{activeQuestionIndex \+ 1\} of \{selectedQuestions\.length\}/, "Next Move labels the current question position")
assert.match(reviewPopupSource, /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/, "answering all questions scrolls to Generate Prompt")
assert.match(reviewPopupSource, /generateButtonRef\.current\?\.animate/, "Generate Prompt receives a brief attention animation")
assert.match(reviewPopupSource, /Prompt copied\. Paste it into Replit and click Send\./, "Next Move copy shows persistent Replit handoff guidance")
assert.doesNotMatch(reviewPopupSource, /id: "submit-next-move-v2-prompt"/, "generated Next Move prompt copies from the prompt header instead of a detached action bar")
assert.match(contentScriptSource, /handleGeneratePostTrackerNextMovePrompt/, "next-move prompt generation runs through prompt refinement")
assert.match(
  contentScriptSource,
  /Before submitting this prompt, attach screenshots or a screen recording of the bug directly in the AI agent/,
  "generated bug prompts include the direct attachment reminder"
)
assert.match(storageSource, /saveBugReportScreenshot/, "uploaded bug screenshots are stored locally")
assert.match(reviewPopupSource, /What should stay out of scope\?/, "small feature path asks for scope boundaries")
assert.match(reviewPopupSource, /What are the must-have workflows\?/, "large feature path asks for core workflows")
assert.match(contentScriptSource, /buildLargeFeaturePostTrackerPrompt/, "large feature prompt creates a fresh PRD-planning brief")
assert.match(reviewPopupSource, /What should remain unchanged\?/, "small change path protects existing behavior")
assert.match(contentScriptSource, /handleSubmitPostTrackerNextMovePrompt/, "all next-move paths share the generated-prompt copy flow")
assert.match(contentScriptSource, /buildScopedPostTrackerNextMovePrompt/, "small feature and small change prompts are generated locally")
assert.match(contentScriptSource, /Please implement this new small feature only/, "small feature prompt stays scoped")
assert.match(contentScriptSource, /Please make this small change only/, "small change prompt stays scoped")
assert.doesNotMatch(reviewPopupSource, /Publish the app/, "publish option is intentionally postponed")
assert.match(contentScriptSource, /shouldSuppressSoftFallback/, "tracker mode suppresses misleading preliminary quick-check status")
assert.match(contentScriptSource, /handleProjectTrackerToggle/, "user can disable tracker anytime")
assert.match(contentScriptSource, /disabledReason === "completed"/, "auto-disable after final phase completion is protected")
assert.match(reviewAnalysisSource, /transformDeepAnalysisV2Result/, "Deep Analysis result transform is an optional branch")
assert.match(reviewPopupSource, /ReviewDebugCopyPanel/, "answer review popup exposes copyable debug payload")
assert.match(reviewPopupSource, /buildReviewDebugText/, "copyable debug payload is generated locally")
assert.match(reviewPopupSource, /preliminaryResult/, "debug payload distinguishes preliminary quick check from final Deep Analysis")
assert.match(reviewPopupSource, /Copy debug/, "debug payload can be copied without DevTools")
assert.match(reviewTypesSource, /requirementMatches/, "Deep Analysis trace exposes requirement matches for debugging")
assert.match(deepAnalysisViewModelSource, /providerName/, "Deep Analysis trace exposes provider metadata")
assert.match(deepAnalysisViewModelSource, /fallbackReason/, "Deep Analysis trace exposes provider failure reason")
assert.match(deepAnalysisViewModelSource, /ignoredExternalValidation/, "Deep Analysis trace exposes ignored external validation rows")
assert.match(deepAnalysisViewModelSource, /failureMessage/, "Deep Analysis trace exposes provider failure message")
assert.match(deepAnalysisViewModelSource, /generatedPrompt/, "Deep Analysis trace exposes generated prompt")
assert.doesNotMatch(
  contentScriptSource,
  /buildFallbackGeneratedPrompt|buildDeepAnalysisV2Fallback/,
  "no deterministic generic fallback is used as the final phase judgment in Project Tracker routing"
)

console.log("project-tracker-smoke: ok")
