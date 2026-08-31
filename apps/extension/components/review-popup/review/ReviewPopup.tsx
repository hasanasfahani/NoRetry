import { useEffect, useRef, useState } from "react"
import { PopupShell } from "../shared/PopupShell"
import { ActionBar } from "../shared/ActionBar"
import { ErrorState } from "../shared/ErrorState"
import { LoadingState } from "../shared/LoadingState"
import { PromptCard } from "../shared/PromptCard"
import { StatusBadge } from "../shared/StatusBadge"
import { WorkflowProgress } from "../shared/WorkflowProgress"
import { ReviewPromptMode } from "./ReviewPromptMode"
import { ArchitectureConfirmationPanel, ProjectSettingsPanel } from "./ProjectSettingsPanel"
import { AccountPanel } from "./AccountPanel"
import { ProjectOnboardingPanel } from "./ProjectOnboardingPanel"
import { ProjectPlanningPanel } from "./ProjectPlanningPanel"
import { ReviewNextMoveSummary } from "./ReviewNextMoveSummary"
import { ReviewRequirementMatchSummary } from "./ReviewRequirementMatchSummary"
import type { ReviewPopupViewModel } from "./review-types"
import type { ImportedProjectContextRecord } from "../../../lib/core/project-context"
import type { ReviewPopupSurface, ReviewPromptModeState } from "../../../lib/review/types"
import type { ProjectContextStatus, ProjectPreferenceSettings } from "../../../lib/session/project-settings"
import type {
  ArchitectureConfirmationState,
  StructuredProjectPhase
} from "../../../lib/session/project-memory"
import type { PopupAction } from "../shared/types"
import type { AccountState } from "../../../lib/account/account-types"
import type { ProjectSyncStatus } from "../../../lib/sync/sync-types"
import type { BugReportScreenshotRecord, ProjectCatalogItemRecord } from "../../../lib/storage"
import type {
  ProjectPlanningDebugPayload,
  ProjectPlanningState
} from "../../../lib/project-planning/project-planning"
import {
  buildProjectTrackerDebugMetadata,
  shouldAdvanceProjectTrackerFromAnalysis,
  type ProjectTrackerRecord
} from "../../../lib/project-tracker/project-tracker"

type ReviewPopupProps = {
  open: boolean
  surface: ReviewPopupSurface
  viewModel: ReviewPopupViewModel
  promptModeState: ReviewPromptModeState
  projectSettingsEnabled: boolean
  projectPanelView: "closed" | "onboarding" | "context" | "planning" | "settings" | "account" | "projects"
  projectContextStatus: ProjectContextStatus
  projectContextWarnings: string[]
  projectContextStaleReasons: string[]
  projectContextConflictReasons: string[]
  projectSyncStatus: ProjectSyncStatus
  projectSyncMessage: string | null
  promptProjectContextImportedContext: ImportedProjectContextRecord | null
  projectPreferences: ProjectPreferenceSettings
  projectCurrentPhase: StructuredProjectPhase | null
  projectProtectedAreas: string[]
  promptProjectContextEnabled: boolean
  promptProjectContextReady: boolean
  promptProjectContextLabel: string
  projectCatalogItems: ProjectCatalogItemRecord[]
  projectTracker: ProjectTrackerRecord | null
  latestSubmittedPromptHash: string | null
  projectPlanningPlatformLabel: string
  promptProjectContextFeatureArea: string
  promptProjectContextProtectedCount: number
  promptProjectContextConstraintCount: number
  promptProjectContextImportOpen: boolean
  promptProjectContextDraft: string
  architectureConfirmation: ArchitectureConfirmationState | null
  projectPlanningState: ProjectPlanningState
  promptProjectContextSaving: boolean
  projectPlanningSaving: boolean
  projectPlanningGeneratingDraft: boolean
  projectPlanningErrorMessage: string | null
  projectPlanningCopyMessage: string | null
  reviewPromptCopyFeedback: {
    prompt: string
    message: string
    tone: "success" | "error"
  } | null
  projectPlanningDebugPayload: ProjectPlanningDebugPayload | null
  promptProjectContextDeleting: boolean
  projectPreferencesSaving: boolean
  projectFocusSaving: boolean
  accountState: AccountState
  accountSubmitting: boolean
  bugReportScreenshots: BugReportScreenshotRecord[]
  bugReportScreenshotCapturing: boolean
  bugReportScreenshotError: string | null
  handoffNotice: string
  modeActions: PopupAction[]
  promptActions: PopupAction[]
  onPromptQuestionIndexChange: (index: number) => void
  onPromptAnswerChange: (questionId: string, value: string) => void
  onPromptToggleMultiAnswer: (questionId: string, value: string) => void
  onPromptOtherAnswerChange: (questionId: string, value: string) => void
  onPromptAdvanceOther: () => void
  onPromptGenerate: () => void
  onPromptReviewConflict: () => void
  onPromptFixMissingContext: () => void
  onProjectOnboardingOpen: () => void
  onProjectContextOpen: () => void
  onProjectPlanningOpen: () => void
  onProjectsOpen: () => void
  onProjectSettingsOpen: () => void
  onAccountOpen: () => void
  onProjectPanelClose: () => void
  onProjectOnboardingChooseInProgress: () => void
  onProjectOnboardingChooseStartingNow: () => void
  onProjectPlanningDraftChange: (value: string) => void
  onProjectPlanningQuestionIndexChange: (index: number) => void
  onProjectPlanningAnswerChange: (questionId: string, value: string) => void
  onProjectPlanningToggleMultiAnswer: (questionId: string, value: string) => void
  onProjectPlanningOtherAnswerChange: (questionId: string, value: string) => void
  onProjectPlanningAdvanceQuestion: () => void
  onProjectPlanningBackToOnboarding: () => void
  onProjectPlanningBackToIntake: () => void
  onProjectPlanningBuildDraft: () => void
  onProjectPlanningReturnToQuestions: () => void
  onProjectPlanningCopyPrd: () => void
  onProjectTrackerToggle: () => void
  onProjectPreferencesSave: (next: ProjectPreferenceSettings) => Promise<void> | void
  onAccountLogin: (input: { email: string; password: string }) => Promise<void> | void
  onAccountRegister: (input: { firstName: string; lastName: string; email: string; password: string }) => Promise<void> | void
  onAccountLogout: () => Promise<void> | void
  onProjectProtectedAreasChange: (areas: string[]) => void
  onProjectFeatureAreaChange: (value: string) => void
  onProjectPhaseChange: (value: StructuredProjectPhase | null) => void
  onPromptProjectContextToggle: () => void
  onPromptProjectContextDraftChange: (value: string) => void
  onPromptProjectContextCopyRequest: () => void
  onPromptProjectContextImport: () => void
  onPromptProjectContextDelete: () => void
  onArchitectureConfirmationEdit: () => void
  onArchitectureConfirmationDraftChange: (value: string) => void
  onArchitectureConfirmationConfirm: () => void
  onPostTrackerTestingChoice: (choice: "needs_testing" | "testing_complete") => void
  onPostTrackerTestingPromptSubmit: (prompt: string) => void
  onPostTrackerBugScreenshotAdd: (input: PostTrackerBugScreenshotInput) => Promise<void> | void
  onPostTrackerBugScreenshotClear: () => void
  onPostTrackerNextMovePromptGenerate: (
    choice: Exclude<PostTrackerNextMove, "none">,
    answers: PostTrackerNextMoveAnswers
  ) => Promise<string>
  onPostTrackerNextMovePromptSubmit: (choice: Exclude<PostTrackerNextMove, "none">, prompt: string) => void
  onPostTrackerNextMoveV2Open: (description: string, choice: Exclude<PostTrackerNextMove, "none">) => void
  onNextMoveV2QuestionSetLoad: (
    choice: Exclude<PostTrackerNextMove, "none">,
    sourcePromptOverride?: string
  ) => Promise<NextMoveV2QuestionSuggestion[]>
  onNextMoveV2PromptGenerate: (
    choice: Exclude<PostTrackerNextMove, "none">,
    answers: PostTrackerNextMoveAnswers,
    fallbackPrompt: string,
    sourcePromptOverride?: string
  ) => Promise<string>
  onNextMoveV2PathSelected: (choice: Exclude<PostTrackerNextMove, "none">) => void
  onNextMoveV2QuestionAnswered: (input: {
    choice: Exclude<PostTrackerNextMove, "none">
    answeredCount: number
    questionCount: number
    allAnswered: boolean
  }) => void
  onNextMoveV2DescriptionEdited: (choice: Exclude<PostTrackerNextMove, "none">) => void
  onNextMoveV2QuestionsRetried: (choice: Exclude<PostTrackerNextMove, "none">) => void
  onNextMoveV2PromptSubmit: (prompt: string) => Promise<boolean>
  onRetryAnalysis: () => void
  onClose: () => void
}

const POST_TRACKER_TESTING_PROMPT = [
  "The MVP implementation is complete. Help me run manual validation before adding new scope.",
  "",
  "Based on the completed PRD and implementation summary, give me:",
  "- Main happy-path test scenarios",
  "- Edge-case test scenarios",
  "- Data/state persistence tests",
  "- Mobile/responsive tests if relevant",
  "- Any external validation still requiring real users, devices, production data, or cohort results",
  "- A simple pass/fail checklist I can follow",
  "",
  "Do not implement anything yet."
].join("\n")

type PostTrackerTestingChoice = "none" | "needs_testing" | "testing_complete"
type PostTrackerNextMove = "none" | "small_feature" | "large_feature" | "bug_fix" | "small_change"
type PostTrackerNextMoveAnswers = Record<string, string>
type PostTrackerPage = "testing" | "choose_next_move" | "next_move_description"
type PostTrackerBugScreenshotInput = {
  dataUrl: string
  mimeType: string
}
type PostTrackerNextMoveQuestion = {
  id: string
  label: string
  helper: string
  options: string[]
  placeholder: string
  source?: "ai" | "fallback"
  provider?: string
}
type NextMoveV2FirstQuestion = {
  label: string
  helper?: string
  options?: string[]
  placeholder: string
  source: "ai" | "fallback"
  provider?: string
}
type NextMoveV2QuestionSuggestion = NextMoveV2FirstQuestion

const NEXT_MOVE_V2_ENABLED = true
const NEXT_MOVE_V2_OTHER_OPTION = "Other"
const NEXT_MOVE_V2_QUESTION_SET_WAIT_MS = 15000
const NEXT_MOVE_V2_PROGRESS_COMPLETE_HOLD_MS = 350
const POST_TRACKER_NEXT_MOVE_OPTIONS: Array<{
  id: Exclude<PostTrackerNextMove, "none">
  label: string
  description: string
}> = [
  {
    id: "small_feature",
    label: "New small feature",
    description: "Add one focused improvement without changing the product plan."
  },
  {
    id: "large_feature",
    label: "New large feature",
    description: "Start a new PRD and tracked implementation flow for a bigger addition."
  },
  {
    id: "bug_fix",
    label: "Fix bug",
    description: "Capture the issue, expected behavior, and evidence before fixing."
  },
  {
    id: "small_change",
    label: "Small change",
    description: "Make a narrow UI, copy, styling, or behavior adjustment."
  }
]

const POST_TRACKER_NEXT_MOVE_QUESTIONS: Record<Exclude<PostTrackerNextMove, "none">, PostTrackerNextMoveQuestion[]> = {
  small_feature: [
    {
      id: "feature_goal",
      label: "What should the new small feature do?",
      helper: "Choose the closest type of small addition.",
      options: [
        "Add a new user-facing UI feature",
        "Add one new action or interaction",
        "Add one new display or summary",
        "Improve one existing workflow"
      ],
      placeholder: "Example: Add a weekly hydration summary card."
    },
    {
      id: "user_value",
      label: "Who is it for, and what problem does it solve?",
      helper: "Pick the main value so the prompt stays focused.",
      options: [
        "Helps users complete a task faster",
        "Helps users understand their progress",
        "Helps users avoid mistakes",
        "Helps users personalize the app"
      ],
      placeholder: "Example: Busy users who want a quick weekly progress check."
    },
    {
      id: "placement",
      label: "Where should it appear in the app?",
      helper: "Choose the safest placement for this addition.",
      options: [
        "On an existing main screen",
        "Inside an existing detail view",
        "Behind an existing button or menu",
        "As a small new section"
      ],
      placeholder: "Example: On the dashboard under today's progress."
    },
    {
      id: "out_of_scope",
      label: "What should stay out of scope?",
      helper: "Protect the finished MVP from accidental expansion.",
      options: [
        "No backend or database changes",
        "No auth, payments, or accounts",
        "No redesign or navigation rewrite",
        "No unrelated features"
      ],
      placeholder: "Example: No sharing, no new backend, no analytics dashboard."
    },
    {
      id: "done_criteria",
      label: "How will we know this feature is complete?",
      helper: "Select the proof you want the assistant to provide.",
      options: [
        "Visible UI works in the app",
        "User can complete the new action",
        "Existing flows still work",
        "Manual test steps are provided"
      ],
      placeholder: "Example: The summary renders from local data and updates after new logs."
    }
  ],
  large_feature: [
    {
      id: "feature_summary",
      label: "What is the large feature or new module?",
      helper: "Choose the kind of larger addition to plan.",
      options: [
        "A new major workflow",
        "A new user role or mode",
        "A new data-heavy feature",
        "A new product area"
      ],
      placeholder: "Example: A coach mode that recommends hydration goals."
    },
    {
      id: "target_user",
      label: "Who uses it, and why do they need it?",
      helper: "Pick the main audience for the new PRD.",
      options: [
        "Existing users of the MVP",
        "A new user segment",
        "Admins or operators",
        "Users with an advanced need"
      ],
      placeholder: "Example: New users who do not know what goal to choose."
    },
    {
      id: "core_flows",
      label: "What are the must-have workflows?",
      helper: "Choose how broad the first PRD should be.",
      options: [
        "One primary happy path",
        "A setup flow plus main flow",
        "A dashboard plus detail view",
        "A multi-step workflow"
      ],
      placeholder: "Example: Answer intake questions, get a recommended goal, adjust it."
    },
    {
      id: "protected_behavior",
      label: "What existing behavior must stay unchanged?",
      helper: "Choose the main guardrail for the new plan.",
      options: [
        "Do not break completed MVP flows",
        "Do not change existing data shape unless needed",
        "Do not redesign existing screens",
        "Do not remove current functionality"
      ],
      placeholder: "Example: Existing manual logging and progress ring behavior."
    },
    {
      id: "success_criteria",
      label: "What are the success criteria?",
      helper: "Choose how success should be proven.",
      options: [
        "User can complete the new workflow",
        "Acceptance criteria are listed per phase",
        "Manual tests are provided",
        "Risks and out-of-scope items are explicit"
      ],
      placeholder: "Example: User can complete setup in under 60 seconds."
    }
  ],
  bug_fix: [
    {
      id: "bug_summary",
      label: "What is broken?",
      helper: "Choose the type of bug.",
      options: [
        "A button or action does nothing",
        "Wrong data is shown or saved",
        "A screen or layout is broken",
        "An error appears"
      ],
      placeholder: "Example: The progress ring resets after reopening the app."
    },
    {
      id: "steps_to_reproduce",
      label: "What steps reproduce the bug?",
      helper: "Choose how reliably it happens.",
      options: [
        "Happens every time",
        "Happens after a specific sequence",
        "Happens only on one screen",
        "Happens only on one device or browser"
      ],
      placeholder: "Example: Log 500ml, close the app, reopen the dashboard."
    },
    {
      id: "expected_behavior",
      label: "What should happen instead?",
      helper: "Choose the intended result.",
      options: [
        "The action should complete successfully",
        "The correct data should appear",
        "The UI should stay usable",
        "The user should see a clear error or success state"
      ],
      placeholder: "Example: Today's intake should still show 500ml."
    },
    {
      id: "actual_behavior",
      label: "What actually happens?",
      helper: "Choose the observed failure.",
      options: [
        "Nothing happens",
        "Wrong result appears",
        "The app crashes or freezes",
        "The UI changes but the data is wrong"
      ],
      placeholder: "Example: The ring returns to 0ml."
    },
    {
      id: "bug_location",
      label: "Where does it happen?",
      helper: "Choose where the assistant should inspect first.",
      options: [
        "Main screen",
        "Form or modal",
        "Navigation or routing",
        "Mobile/responsive view"
      ],
      placeholder: "Example: Dashboard on iPhone Safari."
    }
  ],
  small_change: [
    {
      id: "change_summary",
      label: "What exactly should change?",
      helper: "Choose the kind of small change.",
      options: [
        "Copy or label change",
        "Small styling change",
        "Tiny behavior adjustment",
        "Move or show one UI element"
      ],
      placeholder: "Example: Rename the CTA from Save to Log Water."
    },
    {
      id: "change_location",
      label: "Where is the change?",
      helper: "Choose the affected area.",
      options: [
        "Main screen",
        "A specific card or section",
        "A button or form field",
        "Mobile/responsive layout"
      ],
      placeholder: "Example: The main logging button on the dashboard."
    },
    {
      id: "desired_result",
      label: "What should the result look or behave like?",
      helper: "Choose the intended outcome.",
      options: [
        "Clearer wording",
        "Cleaner visual hierarchy",
        "Less confusing interaction",
        "More visible information"
      ],
      placeholder: "Example: Clearer action text, no layout change."
    },
    {
      id: "keep_unchanged",
      label: "What should remain unchanged?",
      helper: "Choose what the assistant must protect.",
      options: [
        "Existing behavior",
        "Existing data/storage",
        "Existing layout except this change",
        "Everything outside this specific area"
      ],
      placeholder: "Example: Button color, size, and logging behavior."
    },
    {
      id: "verification",
      label: "How will you verify the change?",
      helper: "Choose the final check.",
      options: [
        "Visible change appears correctly",
        "Original flow still works",
        "Mobile view still fits",
        "Assistant provides before/after summary"
      ],
      placeholder: "Example: Button text is updated and logging still works."
    }
  ]
}

function formatNextMoveAnswerRows(rows: Array<[string, string | undefined]>) {
  return rows
    .map(([label, value]) => {
      const trimmed = String(value ?? "").trim()
      return trimmed ? `- ${label}: ${trimmed}` : ""
    })
    .filter(Boolean)
}

function getNextMoveV2AnswerText(answers: PostTrackerNextMoveAnswers, questionId: string) {
  const answer = answers[questionId]?.trim() ?? ""
  const selectedOptions = parseNextMoveV2SelectedOptions(answer)
  const otherAnswer = answers[`${questionId}__other`]?.trim() ?? ""
  const visibleAnswers = selectedOptions.filter((option) => option !== NEXT_MOVE_V2_OTHER_OPTION)
  if (selectedOptions.includes(NEXT_MOVE_V2_OTHER_OPTION) && otherAnswer) {
    visibleAnswers.push(otherAnswer)
  }
  return visibleAnswers.join(", ")
}

function parseNextMoveV2SelectedOptions(answer: string | undefined) {
  const trimmed = answer?.trim() ?? ""
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed)) {
      return parsed.map((option) => String(option).trim()).filter(Boolean)
    }
  } catch {
    // Older saved answers used a plain string; keep reading them.
  }
  return [trimmed]
}

function serializeNextMoveV2SelectedOptions(options: string[]) {
  return JSON.stringify(Array.from(new Set(options.map((option) => option.trim()).filter(Boolean))))
}

function buildNextMoveV2VisibleOptions(options: string[] | undefined) {
  const normalized = (options ?? []).map((option) => option.trim()).filter(Boolean)
  return [...normalized.filter((option) => option !== NEXT_MOVE_V2_OTHER_OPTION), NEXT_MOVE_V2_OTHER_OPTION]
}

function hasNextMoveV2AnsweredValue(answer: string | undefined, otherAnswer?: string) {
  const selectedOptions = parseNextMoveV2SelectedOptions(answer)
  const trimmedOther = otherAnswer?.trim() ?? ""
  return selectedOptions.some((option) => option !== NEXT_MOVE_V2_OTHER_OPTION) ||
    (selectedOptions.includes(NEXT_MOVE_V2_OTHER_OPTION) && Boolean(trimmedOther))
}

function applyNextMoveV2QuestionOverride(
  question: PostTrackerNextMoveQuestion,
  override: NextMoveV2QuestionSuggestion | null | undefined
): PostTrackerNextMoveQuestion {
  const label = override?.label?.trim() ?? ""
  const helper = override?.helper?.trim() ?? ""
  const placeholder = override?.placeholder?.trim() ?? ""
  const options = (override?.options ?? []).map((option) => option.trim()).filter(Boolean).slice(0, 4)

  if (!label || options.length < 2) return question

  return {
    ...question,
    label,
    helper: helper || question.helper,
    placeholder: placeholder || question.placeholder,
    options,
    source: override?.source ?? "ai",
    provider: override?.provider
  }
}

function buildNextMoveV2StaticPrompt(input: {
  choice: Exclude<PostTrackerNextMove, "none">
  answers: PostTrackerNextMoveAnswers
  sourcePrompt?: string
}) {
  const sourcePrompt = input.sourcePrompt?.trim() ?? ""
  const sourceRows = sourcePrompt ? ["Original typed request:", sourcePrompt, ""] : []

  if (input.choice === "large_feature") {
    const rows = formatNextMoveAnswerRows([
      ["Large feature or new module", getNextMoveV2AnswerText(input.answers, "feature_summary")],
      ["Target user and need", getNextMoveV2AnswerText(input.answers, "target_user")],
      ["Must-have workflows", getNextMoveV2AnswerText(input.answers, "core_flows")],
      ["Existing behavior to protect", getNextMoveV2AnswerText(input.answers, "protected_behavior")],
      ["Constraints, deadline, platform, or data limits", getNextMoveV2AnswerText(input.answers, "constraints")],
      ["Success criteria", getNextMoveV2AnswerText(input.answers, "success_criteria")]
    ])

    return [
      "Before implementing, create a fresh PRD for this large feature.",
      "",
      ...sourceRows,
      "Large feature brief:",
      ...rows,
      "",
      "Planning rules:",
      "- Treat this as a new large feature that extends the completed MVP.",
      "- Use the existing app as context, but do not restart or rebuild completed MVP phases.",
      "- Create clear implementation phases with goals, build scope, out of scope, data/state needed, deliverables, acceptance criteria, and validation proof.",
      "- Keep the first implementation phase narrow and safe.",
      "- Do not implement the feature yet.",
      "",
      "After you finish, confirm:",
      "- The PRD title",
      "- The recommended implementation phases",
      "- What should be implemented first",
      "- What should stay out of scope"
    ].join("\n")
  }

  if (input.choice === "bug_fix") {
    const rows = formatNextMoveAnswerRows([
      ["Bug", getNextMoveV2AnswerText(input.answers, "bug_summary")],
      ["Steps to reproduce", getNextMoveV2AnswerText(input.answers, "steps_to_reproduce")],
      ["Expected behavior", getNextMoveV2AnswerText(input.answers, "expected_behavior")],
      ["Actual behavior", getNextMoveV2AnswerText(input.answers, "actual_behavior")],
      ["Location", getNextMoveV2AnswerText(input.answers, "bug_location")],
      ["Evidence", getNextMoveV2AnswerText(input.answers, "evidence")]
    ])

    return [
      "Please fix this bug only.",
      "",
      ...sourceRows,
      "Bug report:",
      ...rows,
      "",
      "Visual evidence:",
      "- Before submitting this prompt, attach screenshots or a screen recording of the bug directly in the AI agent.",
      "",
      "Scope rules:",
      "- Fix only the described bug.",
      "- Do not add unrelated features, redesigns, backend changes, auth, payments, or new architecture.",
      "- Preserve existing behavior unless it directly causes this bug.",
      "",
      "After you finish, confirm:",
      "- Root cause",
      "- Files changed",
      "- How the fix was verified",
      "- Any remaining risks"
    ].join("\n")
  }

  if (input.choice === "small_change") {
    const rows = formatNextMoveAnswerRows([
      ["Change", getNextMoveV2AnswerText(input.answers, "change_summary")],
      ["Location", getNextMoveV2AnswerText(input.answers, "change_location")],
      ["Desired result", getNextMoveV2AnswerText(input.answers, "desired_result")],
      ["Keep unchanged", getNextMoveV2AnswerText(input.answers, "keep_unchanged")],
      ["Verification", getNextMoveV2AnswerText(input.answers, "verification")]
    ])

    return [
      "Please make this small change only.",
      "",
      ...sourceRows,
      "Change brief:",
      ...rows,
      "",
      "Scope rules:",
      "- Keep the change narrow and avoid unrelated cleanup.",
      "- Do not add new features, backend changes, auth, payments, or architecture changes.",
      "- Preserve existing behavior unless the requested change explicitly modifies it.",
      "",
      "After you finish, confirm:",
      "- What changed",
      "- What stayed unchanged",
      "- How I can verify the change",
      "- Any risks or follow-up needed"
    ].join("\n")
  }

  const rows = formatNextMoveAnswerRows([
    ["Feature", getNextMoveV2AnswerText(input.answers, "feature_goal")],
    ["User value", getNextMoveV2AnswerText(input.answers, "user_value")],
    ["Placement", getNextMoveV2AnswerText(input.answers, "placement")],
    ["Out of scope", getNextMoveV2AnswerText(input.answers, "out_of_scope")],
    ["Done criteria", getNextMoveV2AnswerText(input.answers, "done_criteria")]
  ])

  return [
    "Please implement this new small feature only.",
    "",
    ...sourceRows,
    "Feature brief:",
    ...rows,
    "",
    "Scope rules:",
    "- Keep this as a focused addition to the completed MVP.",
    "- Do not start a new PRD or rebuild the existing app.",
    "- Do not add unrelated features, backend changes, auth, payments, or a redesign unless explicitly required above.",
    "- Preserve existing working flows unless they directly need to support this feature.",
    "",
    "After you finish, confirm:",
    "- What changed",
    "- Which requested details were completed",
    "- How I can manually test it",
    "- Any risks or follow-up needed"
  ].join("\n")
}

export function ReviewPopup(props: ReviewPopupProps) {
  const isPromptMode = props.surface === "prompt_mode"
  const [postTrackerTestingChoice, setPostTrackerTestingChoice] = useState<PostTrackerTestingChoice>("none")
  const [postTrackerPage, setPostTrackerPage] = useState<PostTrackerPage>("testing")
  const [nextMoveV2Selection, setNextMoveV2Selection] = useState<PostTrackerNextMove>("none")
  const [nextMoveV2Answers, setNextMoveV2Answers] = useState<PostTrackerNextMoveAnswers>({})
  const currentlyLoading = isPromptMode
    ? props.promptModeState.popupState === "loading"
    : props.viewModel.state === "loading"
  const currentError = isPromptMode
    ? props.promptModeState.popupState === "error"
    : props.viewModel.state === "error"
  const [loadingOverlay, setLoadingOverlay] = useState<{
    visible: boolean
    mode: "answer" | "prompt"
    complete: boolean
  }>({
    visible: currentlyLoading,
    mode: isPromptMode ? "prompt" : "answer",
    complete: false
  })

  useEffect(() => {
    if (props.open) return
    setPostTrackerTestingChoice("none")
    setPostTrackerPage("testing")
  }, [props.open])

  useEffect(() => {
    if (currentlyLoading) {
      setLoadingOverlay({
        visible: true,
        mode: isPromptMode ? "prompt" : "answer",
        complete: false
      })
      return
    }

    if (!loadingOverlay.visible) return

    if (currentError) {
      setLoadingOverlay((current) => ({ ...current, visible: false, complete: false }))
      return
    }

    setLoadingOverlay((current) =>
      current.visible && !current.complete
        ? {
            ...current,
            complete: true
          }
        : current
    )
  }, [currentlyLoading, currentError, isPromptMode, loadingOverlay.visible])

  const showProjectSettings = props.projectSettingsEnabled

  useEffect(() => {
    setNextMoveV2Selection(props.promptModeState.nextMoveInitialChoice ?? "none")
    setNextMoveV2Answers({})
  }, [
    props.promptModeState.nextMoveInitialChoice,
    props.promptModeState.sessionKey,
    props.promptModeState.sourcePrompt
  ])
  const projectPanelOpen = props.projectPanelView !== "closed"
  const utilityPanelVisible =
    projectPanelOpen &&
    (showProjectSettings ||
      props.projectPanelView === "account" ||
      props.projectPanelView === "onboarding" ||
      props.projectPanelView === "planning" ||
      props.projectPanelView === "projects")
  const settingsScreenTitle = ""

  if (utilityPanelVisible) {
    return (
      <PopupShell
        open={props.open}
        onClose={props.onClose}
        eyebrow={
          props.projectPanelView === "onboarding"
            ? "Project Setup"
            : props.projectPanelView === "planning"
              ? "Project Planning"
              : props.projectPanelView === "projects"
                ? "Projects"
              : props.projectPanelView === "settings"
                ? "Preference Settings"
                : props.projectPanelView === "account"
                  ? "Account"
                  : "Project Context"
        }
        title={settingsScreenTitle}
        leadingAction={
          props.projectPanelView === "onboarding" ? null : (
            <button
              type="button"
              onClick={props.onProjectPanelClose}
              style={styles.backIconButton}
              aria-label="Back to review"
            >
              <span aria-hidden="true">&lt;</span>
            </button>
          )
        }
      >
        {props.handoffNotice ? <div style={styles.handoffNotice}>{props.handoffNotice}</div> : null}
        {props.architectureConfirmation ? (
          <ArchitectureConfirmationPanel
            confirmation={props.architectureConfirmation}
            saving={props.promptProjectContextSaving}
            onEdit={props.onArchitectureConfirmationEdit}
            onDraftChange={props.onArchitectureConfirmationDraftChange}
            onConfirm={props.onArchitectureConfirmationConfirm}
          />
        ) : props.projectPanelView === "account" ? (
          <AccountPanel
            accountState={props.accountState}
            isSubmitting={props.accountSubmitting}
            onLogin={props.onAccountLogin}
            onRegister={props.onAccountRegister}
            onLogout={props.onAccountLogout}
          />
        ) : props.projectPanelView === "onboarding" ? (
          <ProjectOnboardingPanel
            projectLabel={props.promptProjectContextLabel}
            onChooseInProgress={props.onProjectOnboardingChooseInProgress}
            onChooseStartingNow={props.onProjectOnboardingChooseStartingNow}
          />
        ) : props.projectPanelView === "planning" ? (
          <ProjectPlanningPanel
            projectLabel={props.promptProjectContextLabel}
            platformLabel={props.projectPlanningPlatformLabel}
            state={props.projectPlanningState}
            isSaving={props.projectPlanningSaving}
            isGeneratingDraft={props.projectPlanningGeneratingDraft}
            errorMessage={props.projectPlanningErrorMessage}
            copyMessage={props.projectPlanningCopyMessage}
            debugPayload={props.projectPlanningDebugPayload}
            onDraftChange={props.onProjectPlanningDraftChange}
            onQuestionIndexChange={props.onProjectPlanningQuestionIndexChange}
            onAnswerChange={props.onProjectPlanningAnswerChange}
            onToggleMultiAnswer={props.onProjectPlanningToggleMultiAnswer}
            onOtherAnswerChange={props.onProjectPlanningOtherAnswerChange}
            onAdvanceQuestion={props.onProjectPlanningAdvanceQuestion}
            onBackToOnboarding={props.onProjectPlanningBackToOnboarding}
            onBackToIntake={props.onProjectPlanningBackToIntake}
            onBuildDraft={props.onProjectPlanningBuildDraft}
            onReturnToQuestions={props.onProjectPlanningReturnToQuestions}
            onCopyPrd={props.onProjectPlanningCopyPrd}
          />
        ) : props.projectPanelView === "projects" ? (
          <ProjectCatalogPanel items={props.projectCatalogItems} />
        ) : (
          <ProjectSettingsPanel
            mode={props.projectPanelView === "settings" ? "settings" : "context"}
            contextStatus={props.projectContextStatus}
            contextWarnings={props.projectContextWarnings}
            contextStaleReasons={props.projectContextStaleReasons}
            contextConflictReasons={props.projectContextConflictReasons}
            syncStatus={props.projectSyncStatus}
            syncMessage={props.projectSyncMessage}
            projectLabel={props.promptProjectContextLabel}
            importedContext={props.promptProjectContextImportedContext}
            preferences={props.projectPreferences}
            featureArea={props.promptProjectContextFeatureArea}
            currentPhase={props.projectCurrentPhase}
            protectedAreas={props.projectProtectedAreas}
            protectedCount={props.promptProjectContextProtectedCount}
            constraintCount={props.promptProjectContextConstraintCount}
            importOpen={props.promptProjectContextImportOpen}
            draft={props.promptProjectContextDraft}
            saving={props.promptProjectContextSaving}
            deletingContext={props.promptProjectContextDeleting}
            savingPreferences={props.projectPreferencesSaving}
            savingProjectFocus={props.projectFocusSaving}
            onToggleImport={props.onPromptProjectContextToggle}
            onDraftChange={props.onPromptProjectContextDraftChange}
            onCopyRequest={props.onPromptProjectContextCopyRequest}
            onImport={props.onPromptProjectContextImport}
            onDeleteContext={props.onPromptProjectContextDelete}
            onPreferencesSave={props.onProjectPreferencesSave}
            onProtectedAreasChange={props.onProjectProtectedAreasChange}
            onFeatureAreaChange={props.onProjectFeatureAreaChange}
            onPhaseChange={props.onProjectPhaseChange}
          />
        )}
      </PopupShell>
    )
  }

  const showProjectPlanningMenu = props.projectContextStatus === "missing"
  const shouldShowAssistantPromptCard =
    Boolean(props.viewModel.nextMoveDecision) &&
    props.viewModel.nextMoveDecision?.assistantPrompt.mode !== "informational_only"
  const analysisUnavailable =
    props.viewModel.deepAnalysisV2Trace?.analysisState === "v2_unavailable" ||
    props.viewModel.statusBadge.label === "Analysis unavailable"
  const summaryPrimaryAction =
    props.viewModel.nextMoveDecision?.assistantPrompt.mode === "review_first"
      ? props.viewModel.promptActions[0] ?? null
      : null
  const visibleProjectTracker = props.projectTracker
  const projectTrackerCompleted =
    Boolean(props.projectTracker?.completedAt) ||
    Boolean(props.projectTracker?.phases.length && props.projectTracker.phases.every((phase) => phase.status === "completed"))
  const showCompletedTrackerUnavailableFallback =
    !isPromptMode &&
    analysisUnavailable &&
    projectTrackerCompleted &&
    !props.projectTracker?.enabled &&
    Boolean(props.projectTracker?.finalReviewAnswerReceivedAt) &&
    !props.projectTracker?.testingCheckpointAnsweredAt
  const showReadyForTestingCheckpoint = !isPromptMode && Boolean(props.viewModel.readyForTesting)
  const showPostTrackerTestingCheckpoint =
    showReadyForTestingCheckpoint ||
    showCompletedTrackerUnavailableFallback ||
    (!isPromptMode && projectTrackerCompleted && postTrackerTestingChoice !== "none") ||
    (!isPromptMode &&
      projectTrackerCompleted &&
      Boolean(props.projectTracker?.finalReviewAnswerReceivedAt) &&
      !props.projectTracker?.testingCheckpointAnsweredAt)

  function handlePostTrackerTestingChoiceChange(choice: PostTrackerTestingChoice) {
    setPostTrackerTestingChoice(choice)
    if (choice !== "none") {
      props.onPostTrackerTestingChoice(choice)
    }
    if (choice === "testing_complete") {
      setPostTrackerPage("choose_next_move")
      return
    }

    setPostTrackerPage("testing")
  }

  function handleNextMoveV2Select(choice: PostTrackerNextMove) {
    setNextMoveV2Selection(choice)
    setNextMoveV2Answers({})
    if (choice !== "none") {
      props.onNextMoveV2PathSelected(choice)
    }
  }

  function handleNextMoveV2AnswerChange(questionId: string, value: string) {
    setNextMoveV2Answers((current) => {
      const nextAnswers = {
        ...current,
        [questionId]: value
      }
      if (nextMoveV2Selection !== "none") {
        const questions = POST_TRACKER_NEXT_MOVE_QUESTIONS[nextMoveV2Selection] ?? []
        const answeredCount = questions.filter((question) =>
          hasNextMoveV2AnsweredValue(nextAnswers[question.id], nextAnswers[`${question.id}__other`])
        ).length
        props.onNextMoveV2QuestionAnswered({
          choice: nextMoveV2Selection,
          answeredCount,
          questionCount: questions.length,
          allAnswered: Boolean(questions.length) && answeredCount === questions.length
        })
      }
      return nextAnswers
    })
  }

  return (
    <PopupShell
      open={props.open}
      onClose={props.onClose}
      eyebrow={isPromptMode ? "Next Move" : props.viewModel.eyebrow}
      title=""
      headerAction={
        (
          <>
            <button
              type="button"
              onClick={props.onAccountOpen}
              style={menuItemStyle(props.projectPanelView === "account", "active")}
              aria-label="Open account"
            >
              <span style={styles.settingsIcon} aria-hidden="true">
                ○
              </span>
              <span style={styles.settingsLabel}>
                {props.accountState.status === "authenticated" ? "Account" : "Sign in"}
              </span>
            </button>
            {showProjectSettings ? (
              <>
                <button
                  type="button"
                  onClick={props.onProjectContextOpen}
                  style={menuItemStyle(props.projectPanelView === "context", props.projectContextStatus)}
                  aria-label="Open project context"
                >
                  <span style={styles.settingsIcon} aria-hidden="true">
                    ⌘
                  </span>
                  <span style={styles.settingsLabel}>Project Context</span>
                  {props.projectContextStatus !== "active" ? (
                    <span style={styles.settingsIndicator(props.projectContextStatus)} aria-hidden="true" />
                  ) : null}
                </button>
                {showProjectPlanningMenu ? (
                  <button
                    type="button"
                    onClick={props.onProjectOnboardingOpen}
                    style={menuItemStyle(props.projectPanelView === "onboarding", "active")}
                    aria-label="Open project setup"
                  >
                    <span style={styles.settingsIcon} aria-hidden="true">
                      ◎
                    </span>
                    <span style={styles.settingsLabel}>Project Setup</span>
                  </button>
                ) : null}
                {showProjectPlanningMenu ? (
                  <button
                    type="button"
                    onClick={props.onProjectPlanningOpen}
                    style={menuItemStyle(props.projectPanelView === "planning", "active")}
                    aria-label="Open project planning"
                  >
                    <span style={styles.settingsIcon} aria-hidden="true">
                      ✦
                    </span>
                    <span style={styles.settingsLabel}>Project Planning</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={props.onProjectsOpen}
                  style={menuItemStyle(props.projectPanelView === "projects", "active")}
                  aria-label="Open projects"
                >
                  <span style={styles.settingsIcon} aria-hidden="true">
                    P
                  </span>
                  <span style={styles.settingsLabel}>Projects</span>
                </button>
                <button
                  type="button"
                  onClick={props.onProjectSettingsOpen}
                  style={menuItemStyle(props.projectPanelView === "settings", "active")}
                  aria-label="Open settings"
                >
                  <span style={styles.settingsIcon} aria-hidden="true">
                    ⚙
                  </span>
                  <span style={styles.settingsLabel}>Settings</span>
                </button>
              </>
            ) : null}
          </>
        )
      }
    >
      {props.handoffNotice ? <div style={styles.handoffNotice}>{props.handoffNotice}</div> : null}
      {props.modeActions.length ? <ActionBar actions={props.modeActions} /> : null}
      {loadingOverlay.visible ? (
        <LoadingState
          mode={loadingOverlay.mode}
          complete={loadingOverlay.complete}
          onComplete={() => setLoadingOverlay((current) => ({ ...current, visible: false, complete: false }))}
        />
      ) : isPromptMode && NEXT_MOVE_V2_ENABLED ? (
        <NextMoveV2Shell
          sourcePrompt={props.promptModeState.sourcePrompt}
          selectedNextMove={nextMoveV2Selection}
          nextMoveAnswers={nextMoveV2Answers}
          onQuestionSetLoad={props.onNextMoveV2QuestionSetLoad}
          onPromptGenerate={props.onNextMoveV2PromptGenerate}
          onNextMoveSelect={handleNextMoveV2Select}
          onNextMoveAnswerChange={handleNextMoveV2AnswerChange}
          onDescriptionEdited={props.onNextMoveV2DescriptionEdited}
          onQuestionsRetried={props.onNextMoveV2QuestionsRetried}
          onNextMovePromptSubmit={props.onNextMoveV2PromptSubmit}
          bugScreenshots={props.bugReportScreenshots}
          bugScreenshotCapturing={props.bugReportScreenshotCapturing}
          bugScreenshotError={props.bugReportScreenshotError}
          onBugScreenshotAdd={props.onPostTrackerBugScreenshotAdd}
          onBugScreenshotClear={props.onPostTrackerBugScreenshotClear}
        />
      ) : isPromptMode ? (
        <ReviewPromptMode
          state={props.promptModeState}
          projectContextStatus={props.projectContextStatus}
          projectContextConflictReasons={props.projectContextConflictReasons}
          promptActions={props.promptActions}
          onQuestionIndexChange={props.onPromptQuestionIndexChange}
          onAnswerChange={props.onPromptAnswerChange}
          onToggleMultiAnswer={props.onPromptToggleMultiAnswer}
          onOtherAnswerChange={props.onPromptOtherAnswerChange}
          onAdvanceOther={props.onPromptAdvanceOther}
          onGeneratePrompt={props.onPromptGenerate}
          onReviewConflict={props.onPromptReviewConflict}
          onFixMissingContext={props.onPromptFixMissingContext}
        />
      ) : (
        <>
          {visibleProjectTracker ? (
            <ProjectTrackerStatusCard
              tracker={visibleProjectTracker}
              onToggle={props.onProjectTrackerToggle}
            />
          ) : null}
          {visibleProjectTracker || props.viewModel.deepAnalysisV2Trace ? (
            <ReviewDebugCopyPanel
              tracker={props.projectTracker}
              viewModel={props.viewModel}
            />
          ) : null}

          {props.projectContextStatus === "missing" ? (
            <div style={styles.contextBannerCard}>
              <div style={styles.contextBannerTop}>
                <StatusBadge label="Context is missing" tone="warning" />
                <button type="button" style={styles.contextBannerButton} onClick={props.onProjectContextOpen}>
                  Fix it
                </button>
              </div>
              <p style={styles.contextBannerCopy}>
                Import project context so reeva AI can give more accurate, project-aware results.
              </p>
            </div>
          ) : null}

          {props.viewModel.state === "error" && props.viewModel.error ? (
            <ErrorState title={props.viewModel.error.title} body={props.viewModel.error.body} />
          ) : null}

          {props.viewModel.state !== "loading" && props.viewModel.state !== "error" ? (
            <>
              <StatusBadge
                label={props.viewModel.statusBadge.label}
                tone={props.viewModel.statusBadge.tone}
              />
              {props.viewModel.workflowHelper ? (
                <p style={styles.workflowHelper}>{props.viewModel.workflowHelper}</p>
              ) : null}
              {props.viewModel.workflowState ? (
                <WorkflowProgress state={props.viewModel.workflowState} />
              ) : null}
              {analysisUnavailable && !showPostTrackerTestingCheckpoint ? (
                <div style={styles.retryAnalysisCard}>
                  <div style={styles.retryAnalysisTextGroup}>
                    <strong style={styles.retryAnalysisTitle}>Try the review again</strong>
                    <p style={styles.retryAnalysisCopy}>
                      Deep Analysis v2 did not return a result. Retry reruns the LLM review for this same answer.
                    </p>
                  </div>
                  <ActionBar
                    actions={[
                      {
                        id: "retry-analysis",
                        label: "Retry analysis",
                        kind: "primary",
                        onClick: props.onRetryAnalysis
                      }
                    ]}
                  />
                </div>
              ) : null}
              {showPostTrackerTestingCheckpoint ? (
                <PostTrackerTestingCheckpoint
                  page={postTrackerPage}
                  choice={postTrackerTestingChoice}
                  onPageChange={setPostTrackerPage}
                  onChoiceChange={handlePostTrackerTestingChoiceChange}
                  onSubmitPrompt={() => props.onPostTrackerTestingPromptSubmit(POST_TRACKER_TESTING_PROMPT)}
                  onNextMoveV2Open={props.onPostTrackerNextMoveV2Open}
                  genericCopy={showReadyForTestingCheckpoint}
                />
              ) : (
                <>
                  <ReviewNextMoveSummary viewModel={props.viewModel} />
                  {shouldShowAssistantPromptCard ? (
                    <div style={styles.promptActionStack}>
                      <PromptCard
                        label={props.viewModel.promptLabel}
                        prompt={props.viewModel.prompt}
                        note={props.viewModel.promptNote}
                        action={
                          summaryPrimaryAction?.onClick
                            ? {
                                label: "Copy Prompt",
                                disabled: summaryPrimaryAction.disabled,
                                onClick: summaryPrimaryAction.onClick,
                                feedbackMessage:
                                  props.reviewPromptCopyFeedback?.prompt === props.viewModel.prompt
                                    ? props.reviewPromptCopyFeedback.message
                                    : null,
                                feedbackTone:
                                  props.reviewPromptCopyFeedback?.prompt === props.viewModel.prompt
                                    ? props.reviewPromptCopyFeedback.tone
                                    : undefined
                              }
                            : undefined
                        }
                      />
                    </div>
                  ) : null}
                  {props.viewModel.requirementMatchSummary ? (
                    <ReviewRequirementMatchSummary summary={props.viewModel.requirementMatchSummary} />
                  ) : null}
                </>
              )}
            </>
          ) : null}
        </>
      )}
    </PopupShell>
  )
}

function PostTrackerPageHeader(props: {
  title: string
  onBack: () => void
}) {
  return (
    <div style={styles.nextMovePageHeader}>
      <button type="button" style={styles.nextMoveBackButton} onClick={props.onBack} aria-label="Go back">
        <span aria-hidden="true">&lt;</span>
      </button>
      <h3 style={styles.nextMovePageTitle}>{props.title}</h3>
    </div>
  )
}

function PostTrackerTestingCheckpoint(props: {
  page: PostTrackerPage
  choice: PostTrackerTestingChoice
  genericCopy?: boolean
  onPageChange: (page: PostTrackerPage) => void
  onChoiceChange: (choice: PostTrackerTestingChoice) => void
  onSubmitPrompt: () => void
  onNextMoveV2Open: (description: string, choice: Exclude<PostTrackerNextMove, "none">) => void
}) {
  const [seedDraft, setSeedDraft] = useState("")
  const [selectedNextMove, setSelectedNextMove] = useState<Exclude<PostTrackerNextMove, "none"> | null>(null)

  useEffect(() => {
    setSeedDraft("")
    if (props.page === "testing") {
      setSelectedNextMove(null)
    }
  }, [props.page])

  if (props.page === "choose_next_move") {
    return (
      <div style={styles.testingCard}>
        <PostTrackerPageHeader title="Choose Next Move" onBack={() => props.onPageChange("testing")} />
        <div style={styles.testingCompleteBox}>
          <div style={styles.testingCompleteHeader}>
            <span style={styles.testingCompletePill}>Testing complete</span>
            <strong>Choose what should happen next.</strong>
          </div>
          <div style={styles.nextMoveGrid}>
            {POST_TRACKER_NEXT_MOVE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={selectedNextMove === option.id}
                onClick={() => {
                  setSelectedNextMove(option.id)
                  props.onPageChange("next_move_description")
                }}
                style={styles.nextMoveButton(selectedNextMove === option.id)}
              >
                <strong style={styles.nextMoveTitle}>{option.label}</strong>
                <span style={styles.nextMoveDescription}>{option.description}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (props.page === "next_move_description") {
    const selectedOption = POST_TRACKER_NEXT_MOVE_OPTIONS.find((option) => option.id === selectedNextMove)

    return (
      <div style={styles.testingCard}>
        <PostTrackerPageHeader title={selectedOption?.label ?? "Next Move"} onBack={() => props.onPageChange("choose_next_move")} />
        <div style={styles.nextMoveQuestionPanel}>
          <div style={styles.nextMoveQuestionField}>
            <p style={styles.nextMoveQuestionLabel}>Description</p>
          </div>
          <textarea
            value={seedDraft}
            placeholder={
              selectedNextMove === "bug_fix"
                ? "Describe the bug you want fixed."
                : selectedNextMove === "large_feature"
                  ? "Describe the larger feature you want to plan."
                  : selectedNextMove === "small_change"
                    ? "Describe the small change you want."
                    : "Describe the small feature you want."
            }
            onChange={(event) => setSeedDraft(event.currentTarget.value)}
            rows={4}
            style={styles.nextMoveTextarea}
          />
          <button
            type="button"
            style={styles.nextMovePrimaryAction(!seedDraft.trim() || !selectedNextMove)}
            disabled={!seedDraft.trim() || !selectedNextMove}
            onClick={() => {
              if (!selectedNextMove) return
              props.onNextMoveV2Open(seedDraft, selectedNextMove)
            }}
          >
            Generate Questions
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.testingCard}>
      <NextMoveWorkflowSteps activeStep={1} />
      <div>
        <span style={styles.testingEyebrow}>Ready for testing</span>
        <h3 style={styles.testingTitle}>
          {props.genericCopy ? "Have you completed testing?" : "Have you completed testing the MVP?"}
        </h3>
      </div>
      <div style={styles.testingActions}>
        <button
          type="button"
          onClick={() => props.onChoiceChange("needs_testing")}
          style={styles.testingChoiceButton(props.choice === "needs_testing")}
        >
          No, I still need to test
        </button>
        <button
          type="button"
          onClick={() => props.onChoiceChange("testing_complete")}
          style={styles.testingChoiceButton(props.choice === "testing_complete")}
        >
          Yes, testing is complete
        </button>
      </div>
      {props.choice === "needs_testing" ? (
        <div style={styles.testingPromptBlock}>
          <PromptCard
            label="Manual test plan prompt"
            prompt={POST_TRACKER_TESTING_PROMPT}
          />
          <ActionBar
            actions={[
              {
                id: "submit-testing-prompt",
                label: "Get Manual Test Plan",
                kind: "primary",
                onClick: props.onSubmitPrompt
              }
            ]}
          />
        </div>
      ) : null}
    </div>
  )
}

function NextMoveV2Shell(props: {
  sourcePrompt: string
  selectedNextMove: PostTrackerNextMove
  nextMoveAnswers: PostTrackerNextMoveAnswers
  onQuestionSetLoad: (
    choice: Exclude<PostTrackerNextMove, "none">,
    sourcePromptOverride?: string
  ) => Promise<NextMoveV2QuestionSuggestion[]>
  onPromptGenerate: (
    choice: Exclude<PostTrackerNextMove, "none">,
    answers: PostTrackerNextMoveAnswers,
    fallbackPrompt: string,
    sourcePromptOverride?: string
  ) => Promise<string>
  onNextMoveSelect: (choice: PostTrackerNextMove) => void
  onNextMoveAnswerChange: (questionId: string, value: string) => void
  onDescriptionEdited: (choice: Exclude<PostTrackerNextMove, "none">) => void
  onQuestionsRetried: (choice: Exclude<PostTrackerNextMove, "none">) => void
  onNextMovePromptSubmit: (prompt: string) => Promise<boolean>
  bugScreenshots?: BugReportScreenshotRecord[]
  bugScreenshotCapturing?: boolean
  bugScreenshotError?: string | null
  onBugScreenshotAdd?: (input: PostTrackerBugScreenshotInput) => Promise<void> | void
  onBugScreenshotClear?: () => void
  onBack?: () => void
}) {
  const [description, setDescription] = useState(props.sourcePrompt.trim())
  const [descriptionDraft, setDescriptionDraft] = useState(props.sourcePrompt.trim())
  const [descriptionEditing, setDescriptionEditing] = useState(false)
  const [generatedPrompt, setGeneratedPrompt] = useState("")
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0)
  const [sessionQuestionChoice, setSessionQuestionChoice] = useState<PostTrackerNextMove>("none")
  const [sessionQuestions, setSessionQuestions] = useState<PostTrackerNextMoveQuestion[]>([])
  const [questionSetLoading, setQuestionSetLoading] = useState(false)
  const [questionSetError, setQuestionSetError] = useState(false)
  const [questionSetRetryKey, setQuestionSetRetryKey] = useState(0)
  const [questionSetProgressPercent, setQuestionSetProgressPercent] = useState(0)
  const [promptGenerating, setPromptGenerating] = useState(false)
  const [copyFeedback, setCopyFeedback] = useState<{
    message: string
    tone: "success" | "error"
  } | null>(null)
  const generateButtonRef = useRef<HTMLButtonElement | null>(null)
  const wasAllQuestionsAnsweredRef = useRef(false)
  const promptGenerationRequestRef = useRef(0)
  const selectedOption = POST_TRACKER_NEXT_MOVE_OPTIONS.find((option) => option.id === props.selectedNextMove) ?? null
  const selectedChoice = props.selectedNextMove === "none" ? null : props.selectedNextMove
  const trimmedSourcePrompt = description.trim()
  const staticQuestions = selectedChoice ? POST_TRACKER_NEXT_MOVE_QUESTIONS[selectedChoice] : []
  const selectedQuestions =
    selectedChoice && sessionQuestionChoice === selectedChoice && sessionQuestions.length
      ? sessionQuestions
      : []
  const activeQuestion = selectedQuestions[activeQuestionIndex] ?? selectedQuestions[0] ?? null
  const activeAnswer = activeQuestion ? props.nextMoveAnswers[activeQuestion.id] ?? "" : ""
  const activeOtherAnswer = activeQuestion ? props.nextMoveAnswers[`${activeQuestion.id}__other`] ?? "" : ""
  const answeredQuestionCount = selectedQuestions.filter((question) =>
    hasNextMoveV2AnsweredValue(props.nextMoveAnswers[question.id], props.nextMoveAnswers[`${question.id}__other`])
  ).length
  const allQuestionsAnswered = Boolean(selectedQuestions.length) && answeredQuestionCount === selectedQuestions.length
  const canGeneratePrompt = props.selectedNextMove !== "none" && allQuestionsAnswered
  const workflowStage = generatedPrompt ? 3 : allQuestionsAnswered ? 3 : 2

  useEffect(() => {
    const nextDescription = props.sourcePrompt.trim()
    setDescription(nextDescription)
    setDescriptionDraft(nextDescription)
    setDescriptionEditing(false)
  }, [props.sourcePrompt])

  useEffect(() => {
    promptGenerationRequestRef.current += 1
    setGeneratedPrompt("")
    setPromptGenerating(false)
    setActiveQuestionIndex(0)
    setSessionQuestionChoice(props.selectedNextMove)
    setSessionQuestions([])
    setQuestionSetError(false)
    setQuestionSetProgressPercent(0)
    if (!selectedChoice || !trimmedSourcePrompt) {
      setQuestionSetLoading(false)
      return
    }

    let cancelled = false
    let settled = false
    setQuestionSetLoading(true)
    setQuestionSetProgressPercent(8)

    const finishWithQuestions = (questions: NextMoveV2QuestionSuggestion[]) => {
      if (cancelled || settled) return
      settled = true
      const completeQuestions = questions.length === staticQuestions.length
        ? staticQuestions.map((question, index) => applyNextMoveV2QuestionOverride(question, questions[index]))
        : []
      setQuestionSetProgressPercent(100)
      window.setTimeout(() => {
        if (cancelled) return
        setSessionQuestions(completeQuestions)
        setQuestionSetError(completeQuestions.length === 0)
        setQuestionSetLoading(false)
      }, NEXT_MOVE_V2_PROGRESS_COMPLETE_HOLD_MS)
    }

    const fallbackTimeoutId = window.setTimeout(
      () => {
        window.clearInterval(progressIntervalId)
        finishWithQuestions([])
      },
      NEXT_MOVE_V2_QUESTION_SET_WAIT_MS
    )
    const startedAt = window.performance.now()
    const progressIntervalId = window.setInterval(() => {
      const elapsed = window.performance.now() - startedAt
      const nextPercent = Math.min(96, Math.round((elapsed / NEXT_MOVE_V2_QUESTION_SET_WAIT_MS) * 100))
      setQuestionSetProgressPercent(Math.max(8, nextPercent))
    }, 120)

    props.onQuestionSetLoad(selectedChoice, trimmedSourcePrompt)
      .then((questions) => {
        window.clearTimeout(fallbackTimeoutId)
        window.clearInterval(progressIntervalId)
        finishWithQuestions(questions)
      })
      .catch(() => {
        window.clearTimeout(fallbackTimeoutId)
        window.clearInterval(progressIntervalId)
        finishWithQuestions([])
      })

    return () => {
      cancelled = true
      window.clearTimeout(fallbackTimeoutId)
      window.clearInterval(progressIntervalId)
    }
  }, [props.selectedNextMove, trimmedSourcePrompt, questionSetRetryKey])

  useEffect(() => {
    if (activeQuestionIndex > Math.max(selectedQuestions.length - 1, 0)) {
      setActiveQuestionIndex(Math.max(selectedQuestions.length - 1, 0))
    }
  }, [activeQuestionIndex, selectedQuestions.length])

  useEffect(() => {
    const justCompleted = allQuestionsAnswered && !wasAllQuestionsAnsweredRef.current
    wasAllQuestionsAnsweredRef.current = allQuestionsAnswered
    if (!justCompleted) return

    window.setTimeout(() => {
      generateButtonRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
      generateButtonRef.current?.animate(
        [
          { transform: "scale(1)", boxShadow: "0 10px 18px rgba(37,99,235,0.16)" },
          { transform: "scale(1.045)", boxShadow: "0 0 0 8px rgba(59,130,246,0.18), 0 14px 28px rgba(37,99,235,0.28)" },
          { transform: "scale(1)", boxShadow: "0 10px 18px rgba(37,99,235,0.16)" }
        ],
        { duration: 900, easing: "ease-out" }
      )
    }, 120)
  }, [allQuestionsAnswered])

  async function handleGeneratePrompt() {
    if (props.selectedNextMove === "none" || !canGeneratePrompt) return

    const selectedMove = props.selectedNextMove
    const answersSnapshot = { ...props.nextMoveAnswers }
    const readableAnswersSnapshot = Object.fromEntries(
      selectedQuestions.flatMap((question) => {
        const answer = getNextMoveV2AnswerText(answersSnapshot, question.id)
        return answer ? [[question.id, answer] as const] : []
      })
    )
    const fallbackPrompt = buildNextMoveV2StaticPrompt({
      choice: selectedMove,
      answers: answersSnapshot,
      sourcePrompt: description
    })
    const requestId = ++promptGenerationRequestRef.current
    setCopyFeedback(null)
    setPromptGenerating(true)
    try {
      const nextPrompt = await props.onPromptGenerate(
        selectedMove,
        readableAnswersSnapshot,
        fallbackPrompt,
        trimmedSourcePrompt
      )
      if (requestId !== promptGenerationRequestRef.current) return
      setGeneratedPrompt(nextPrompt.trim() || fallbackPrompt)
    } catch {
      if (requestId !== promptGenerationRequestRef.current) return
      setGeneratedPrompt(fallbackPrompt)
    } finally {
      if (requestId === promptGenerationRequestRef.current) {
        setPromptGenerating(false)
      }
    }
  }

  function handleAnswerChange(questionId: string, value: string) {
    promptGenerationRequestRef.current += 1
    setGeneratedPrompt("")
    setPromptGenerating(false)
    setCopyFeedback(null)
    props.onNextMoveAnswerChange(questionId, value)
  }

  function handleOptionToggle(question: PostTrackerNextMoveQuestion, option: string) {
    const selectedOptions = parseNextMoveV2SelectedOptions(props.nextMoveAnswers[question.id])
    const nextOptions = selectedOptions.includes(option)
      ? selectedOptions.filter((selectedOption) => selectedOption !== option)
      : [...selectedOptions, option]

    handleAnswerChange(question.id, serializeNextMoveV2SelectedOptions(nextOptions))
    if (option === NEXT_MOVE_V2_OTHER_OPTION && selectedOptions.includes(NEXT_MOVE_V2_OTHER_OPTION)) {
      props.onNextMoveAnswerChange(`${question.id}__other`, "")
    }
  }

  function handleQuestionTabClick(index: number) {
    setActiveQuestionIndex(index)
  }

  function handleNextQuestion() {
    const nextIndex = Math.min(activeQuestionIndex + 1, Math.max(selectedQuestions.length - 1, 0))
    setActiveQuestionIndex(nextIndex)
  }

  function handleDescriptionEditStart() {
    setDescriptionDraft(description)
    setDescriptionEditing(true)
  }

  async function handleCopyGeneratedPrompt() {
    if (!generatedPrompt) return
    const copied = await props.onNextMovePromptSubmit(generatedPrompt)
    setCopyFeedback({
      message: copied
        ? "Prompt copied. Paste it into Replit and click Send."
        : "Copy failed. Focus the page and click Copy Prompt again.",
      tone: copied ? "success" : "error"
    })
  }

  function handleDescriptionEditCancel() {
    setDescriptionDraft(description)
    setDescriptionEditing(false)
  }

  function handleDescriptionSubmit() {
    const nextDescription = descriptionDraft.trim()
    if (!nextDescription) return

    setDescription(nextDescription)
    setDescriptionDraft(nextDescription)
    setDescriptionEditing(false)

    if (props.selectedNextMove !== "none") {
      props.onNextMoveSelect(props.selectedNextMove)
      props.onDescriptionEdited(props.selectedNextMove)
      setGeneratedPrompt("")
      setSessionQuestions([])
      setQuestionSetError(false)
      setQuestionSetLoading(true)
      setQuestionSetProgressPercent(8)
      setQuestionSetRetryKey((current) => current + 1)
    }
  }

  if (selectedOption && props.selectedNextMove !== "none") {
    if (questionSetLoading) {
      return (
        <div style={styles.testingCard}>
          <PostTrackerPageHeader title={selectedOption.label} onBack={props.onBack ?? (() => props.onNextMoveSelect("none"))} />
          <NextMoveWorkflowSteps activeStep={2} />
          <div style={styles.nextMoveQuestionPanel}>
            <strong>Preparing questions...</strong>
            <div style={styles.nextMoveProgressTrack} aria-label="Preparing questions progress">
              <div style={styles.nextMoveProgressFill(questionSetProgressPercent)} />
            </div>
          </div>
        </div>
      )
    }

    if (questionSetError) {
      return (
        <div style={styles.testingCard}>
          <PostTrackerPageHeader title={selectedOption.label} onBack={props.onBack ?? (() => props.onNextMoveSelect("none"))} />
          <NextMoveWorkflowSteps activeStep={2} />
          <div style={styles.nextMoveQuestionPanel}>
            <strong>Questions unavailable</strong>
            <p style={styles.nextMoveQuestionNote}>
              The LLM did not return a complete question set. Retry to generate questions for this path.
            </p>
            <button
              type="button"
              style={styles.nextMovePrimaryAction(false)}
              onClick={() => {
                if (!selectedChoice) return
                props.onQuestionsRetried(selectedChoice)
                setQuestionSetRetryKey((current) => current + 1)
              }}
            >
              Retry Questions
            </button>
          </div>
        </div>
      )
    }

    return (
      <div style={styles.testingCard}>
        <PostTrackerPageHeader title={selectedOption.label} onBack={props.onBack ?? (() => props.onNextMoveSelect("none"))} />
        <NextMoveWorkflowSteps activeStep={workflowStage} generated={Boolean(generatedPrompt)} />
        <div style={styles.nextMoveQuestionPanel}>
          <div style={styles.nextMoveQuestionHeader}>
            <strong>Next Move questions</strong>
            <span>
              {answeredQuestionCount}/{selectedQuestions.length} answered
            </span>
          </div>
          {trimmedSourcePrompt ? (
            <div style={styles.nextMoveDraftContext}>
              <div style={styles.nextMoveDescriptionHeader}>
                <strong>Description</strong>
                {!descriptionEditing ? (
                  <button type="button" style={styles.nextMoveInlineEdit} onClick={handleDescriptionEditStart}>
                    Edit
                  </button>
                ) : null}
              </div>
              {descriptionEditing ? (
                <>
                  <textarea
                    value={descriptionDraft}
                    onChange={(event) => setDescriptionDraft(event.currentTarget.value)}
                    rows={3}
                    style={styles.nextMoveTextarea}
                  />
                  <div style={styles.nextMoveEditActions}>
                    <button
                      type="button"
                      style={styles.nextMovePrimaryAction(!descriptionDraft.trim())}
                      disabled={!descriptionDraft.trim()}
                      onClick={handleDescriptionSubmit}
                    >
                      Submit & Regenerate Questions
                    </button>
                    <button type="button" style={styles.nextMoveGhostAction} onClick={handleDescriptionEditCancel}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <span>{trimmedSourcePrompt}</span>
              )}
            </div>
          ) : null}
          <div style={styles.nextMoveQuestionTabs}>
            {selectedQuestions.map((question, index) => {
              const answered = hasNextMoveV2AnsweredValue(
                props.nextMoveAnswers[question.id],
                props.nextMoveAnswers[`${question.id}__other`]
              )
              return (
                <button
                  key={question.id}
                  type="button"
                  style={styles.nextMoveQuestionTab(index === activeQuestionIndex, answered)}
                  data-reeva-question-state={index === activeQuestionIndex ? "active" : answered ? "answered" : "remaining"}
                  aria-current={index === activeQuestionIndex ? "step" : undefined}
                  aria-label={`Question ${index + 1}: ${answered ? "answered" : "not answered"}${index === activeQuestionIndex ? ", current" : ""}`}
                  onClick={() => handleQuestionTabClick(index)}
                >
                  {answered && index !== activeQuestionIndex ? "✓" : index + 1}
                </button>
              )
            })}
          </div>
          {activeQuestion ? (
            <div style={styles.nextMoveActiveQuestion} data-reeva-question-state="current-card">
              <span style={styles.nextMoveQuestionPosition}>
                Question {activeQuestionIndex + 1} of {selectedQuestions.length}
              </span>
              <p style={styles.nextMoveQuestionLabel}>{activeQuestion.label}</p>
              <p style={styles.nextMoveQuestionNote}>
                {[activeQuestion.helper, "Select all that apply."].filter(Boolean).join(" ")}
              </p>
              <div style={styles.nextMoveOptionList}>
                {buildNextMoveV2VisibleOptions(activeQuestion.options).map((option) => {
                  const selectedOptions = parseNextMoveV2SelectedOptions(activeAnswer)
                  const selected = selectedOptions.includes(option)
                  return (
                    <div key={option} style={styles.nextMoveOptionGroup}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        style={styles.nextMoveOptionButton(selected)}
                        onClick={() => handleOptionToggle(activeQuestion, option)}
                      >
                        {option}
                      </button>
                      {option === NEXT_MOVE_V2_OTHER_OPTION && selected ? (
                        <textarea
                          value={activeOtherAnswer}
                          placeholder={activeQuestion.placeholder}
                          onChange={(event) => {
                            handleAnswerChange(`${activeQuestion.id}__other`, event.currentTarget.value)
                          }}
                          rows={2}
                          style={styles.nextMoveTextarea}
                        />
                      ) : null}
                    </div>
                  )
                })}
              </div>
              {hasNextMoveV2AnsweredValue(activeAnswer, activeOtherAnswer) && activeQuestionIndex < selectedQuestions.length - 1 ? (
                <button type="button" style={styles.nextMoveSecondaryAction} onClick={handleNextQuestion}>
                  Next question
                </button>
              ) : null}
            </div>
          ) : null}
          {props.selectedNextMove === "bug_fix" ? (
            <div style={styles.nextMoveRouteBox}>
              <strong>Visual evidence</strong>
              <p style={styles.nextMoveQuestionNote}>
                Before submitting the generated prompt, attach screenshots or a screen recording of the bug directly in the AI agent.
              </p>
            </div>
          ) : null}
          <button
            type="button"
            ref={generateButtonRef}
            style={styles.nextMovePrimaryAction(!canGeneratePrompt || promptGenerating)}
            disabled={!canGeneratePrompt || promptGenerating}
            onClick={() => void handleGeneratePrompt()}
          >
            {promptGenerating ? "Generating Prompt..." : "Generate New Prompt"}
          </button>
          {generatedPrompt ? (
            <div style={styles.testingPromptBlock}>
              <PromptCard
                label="Generated prompt"
                prompt={generatedPrompt}
                note="Review the generated prompt, then copy it when it matches the next move you want."
                action={{
                  label: "Copy Prompt",
                  onClick: () => void handleCopyGeneratedPrompt(),
                  feedbackMessage: copyFeedback?.message,
                  feedbackTone: copyFeedback?.tone
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div style={styles.testingCard}>
      <div>
        <span style={styles.testingEyebrow}>Prompt Optimizer v2</span>
        <h3 style={styles.testingTitle}>Choose Next Move</h3>
      </div>
      {trimmedSourcePrompt ? (
        <div style={styles.nextMoveDraftContext}>
          <div style={styles.nextMoveDescriptionHeader}>
            <strong>Description</strong>
            {!descriptionEditing ? (
              <button type="button" style={styles.nextMoveInlineEdit} onClick={handleDescriptionEditStart}>
                Edit
              </button>
            ) : null}
          </div>
          {descriptionEditing ? (
            <>
              <textarea
                value={descriptionDraft}
                onChange={(event) => setDescriptionDraft(event.currentTarget.value)}
                rows={3}
                style={styles.nextMoveTextarea}
              />
              <div style={styles.nextMoveEditActions}>
                <button
                  type="button"
                  style={styles.nextMovePrimaryAction(!descriptionDraft.trim())}
                  disabled={!descriptionDraft.trim()}
                  onClick={handleDescriptionSubmit}
                >
                  Save Description
                </button>
                <button type="button" style={styles.nextMoveGhostAction} onClick={handleDescriptionEditCancel}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <span>{trimmedSourcePrompt}</span>
          )}
        </div>
      ) : null}
      <div style={styles.nextMoveGrid}>
        {POST_TRACKER_NEXT_MOVE_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={props.selectedNextMove === option.id}
            onClick={() => props.onNextMoveSelect(option.id)}
            style={styles.nextMoveButton(props.selectedNextMove === option.id)}
          >
            <strong style={styles.nextMoveTitle}>{option.label}</strong>
            <span style={styles.nextMoveDescription}>{option.description}</span>
          </button>
        ))}
      </div>
      <div style={styles.nextMoveSelectedBox}>
        <strong>Decision-tree flow</strong>
        <span>
          Choose a path to answer stable multiple-choice questions before reeva AI generates the prompt.
        </span>
      </div>
    </div>
  )
}

function NextMoveWorkflowSteps(props: {
  activeStep: 1 | 2 | 3
  generated?: boolean
}) {
  const steps = ["Description", "Answer questions", "Generate prompt"]

  return (
    <div style={styles.nextMoveWorkflowBar} data-reeva-surface="next-move-workflow" aria-label="Next Move progress">
      {steps.map((label, index) => {
        const step = (index + 1) as 1 | 2 | 3
        const complete = step < props.activeStep || (step === 3 && Boolean(props.generated))
        const active = step === props.activeStep && !complete
        return (
          <div
            key={label}
            style={styles.nextMoveWorkflowStep(active, complete)}
            data-reeva-workflow-state={complete ? "complete" : active ? "active" : "pending"}
            aria-current={active ? "step" : undefined}
          >
            <span style={styles.nextMoveWorkflowNumber(active, complete)}>{complete ? "✓" : step}</span>
            <span>{label}</span>
          </div>
        )
      })}
    </div>
  )
}

function ProjectCatalogPanel(props: {
  items: ProjectCatalogItemRecord[]
}) {
  const hasItems = props.items.length > 0

  return (
    <div style={styles.projectCatalogLayout}>
      <div style={styles.projectCatalogIntro} data-reeva-surface="project-catalog-intro">
        <strong style={styles.projectCatalogTitle}>Saved PRDs</strong>
        <p style={styles.projectCatalogCopy}>
          Projects stores the PRDs you generate from Project Planning so larger future work can start from the right plan.
        </p>
      </div>
      {hasItems ? (
        <div style={styles.projectCatalogList}>
          {props.items.map((item) => (
            <article key={item.id} style={styles.projectCatalogCard} data-reeva-surface="project-catalog-card">
              <div style={styles.projectCatalogCardHeader}>
                <strong style={styles.projectCatalogCardTitle}>{item.title}</strong>
                <span style={styles.projectCatalogDate}>
                  {new Date(item.updatedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric"
                  })}
                </span>
              </div>
              {item.summary ? <p style={styles.projectCatalogSummary}>{item.summary}</p> : null}
              <div style={styles.projectCatalogMeta}>
                <span>{item.phaseTitles.length || 0} phases</span>
                <span>{item.projectLabel}</span>
              </div>
              {item.phaseTitles.length ? (
                <div style={styles.projectCatalogPhaseList}>
                  {item.phaseTitles.slice(0, 4).map((title) => (
                    <span key={title} style={styles.projectCatalogPhasePill}>
                      {title}
                    </span>
                  ))}
                  {item.phaseTitles.length > 4 ? (
                    <span style={styles.projectCatalogPhasePill}>+{item.phaseTitles.length - 4} more</span>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <div style={styles.projectCatalogEmpty}>
          <strong>No PRDs saved yet.</strong>
          <span>Generated PRDs will appear here after you submit them from Project Planning.</span>
        </div>
      )}
    </div>
  )
}

function ProjectTrackerStatusCard(props: {
  tracker: ProjectTrackerRecord
  onToggle: () => void
}) {
  const activePhase = props.tracker.phases[props.tracker.currentPhaseIndex] ?? null
  const completedCount = props.tracker.phases.filter((phase) => phase.status === "completed").length
  const totalPhases = props.tracker.phases.length
  const completed = Boolean(props.tracker.completedAt) || Boolean(totalPhases && completedCount === totalPhases)
  const displayedCompletedCount = completed ? totalPhases : completedCount
  const phaseNumber = activePhase ? props.tracker.currentPhaseIndex + 1 : props.tracker.phases.length
  const statusCopy = completed
    ? "Project planning phases completed"
    : props.tracker.enabled
    ? activePhase
      ? `Phase ${phaseNumber} of ${totalPhases}: ${activePhase.title}`
      : "All tracked phases are complete"
    : "Project tracker is paused"

  return (
    <div style={styles.trackerCard} data-reeva-surface="project-tracker">
      <div style={styles.trackerHeader}>
        <div style={styles.trackerTitleGroup}>
          <span style={styles.trackerEyebrow}>Project Tracker Mode</span>
          <strong style={styles.trackerTitle}>{statusCopy}</strong>
        </div>
        <button
          type="button"
          onClick={props.onToggle}
          role="switch"
          aria-checked={props.tracker.enabled}
          disabled={completed}
          style={styles.trackerToggle(props.tracker.enabled, completed)}
        >
          <span style={styles.trackerToggleKnob(props.tracker.enabled)} />
          <span style={styles.trackerToggleLabel}>{completed ? "Done" : props.tracker.enabled ? "On" : "Off"}</span>
        </button>
      </div>
      <div style={styles.trackerProgressTrack} aria-hidden="true">
        <div
          style={styles.trackerProgressFill(
            totalPhases ? Math.min(100, Math.round((displayedCompletedCount / totalPhases) * 100)) : 0
          )}
        />
      </div>
    </div>
  )
}

function buildReviewDebugText(input: {
  tracker: ProjectTrackerRecord | null
  viewModel: ReviewPopupViewModel
}) {
  const trace = input.viewModel.deepAnalysisV2Trace ?? null
  const preliminaryResult =
    /preliminary|still running|finishing/i.test(input.viewModel.workflowHelper ?? "") ||
    /preliminary|still running|finishing/i.test(input.viewModel.promptNote ?? "")
  const trackerRequirementMatches = (trace?.requirementMatches ?? [])
    .map((match) => {
      const status = match.status
      if (status !== "pass" && status !== "missing" && status !== "unclear") return null
      return {
        requirementText: match.requirementText,
        status
      }
    })
    .filter((match): match is { requirementText: string; status: "pass" | "missing" | "unclear" } => Boolean(match))
  const normalizedTraceStatus = trace?.overallStatus
    .toLowerCase()
    .replace(/\s+/g, "_") as "pass" | "needs_confirmation" | "risky" | "fail" | "unavailable" | undefined
  const normalizedTraceConfidence = trace?.confidence
    .replace(/^Confidence:\s*/i, "")
    .toLowerCase()
    .replace(/\s+/g, "_") as "low" | "medium" | "high" | undefined
  const trackerAdvanceRecommended = trace
    ? shouldAdvanceProjectTrackerFromAnalysis({
        overallStatus: normalizedTraceStatus ?? "unavailable",
        confidence: normalizedTraceConfidence ?? "low",
        ignoredExternalValidation: trace.ignoredExternalValidation,
        actionableMissingItems: trace.actionableMissingItems,
        phaseAdvanceBasis: trace.phaseAdvanceBasis,
        phaseCompletionClaimed: trace.phaseCompletionClaimed,
        requirementMatches: trackerRequirementMatches
      })
    : false
  const payload = {
    copiedAt: new Date().toISOString(),
    tracker: buildProjectTrackerDebugMetadata({
      record: input.tracker,
      advanceRecommended: trackerAdvanceRecommended
    }),
    review: {
      state: input.viewModel.state,
      mode: input.viewModel.mode,
      preliminaryResult,
      resultFinal: !preliminaryResult,
      statusBadge: input.viewModel.statusBadge.label,
      decision: input.viewModel.decision,
      recommendedAction: input.viewModel.recommendedAction,
      confidenceLabel: input.viewModel.confidenceLabel,
      confidenceNote: input.viewModel.confidenceNote,
      missingItems: input.viewModel.missingItems,
      checkedArtifacts: input.viewModel.checkedArtifacts,
      uncheckedArtifacts: input.viewModel.uncheckedArtifacts,
      checklistRows: input.viewModel.checklistRows,
      nextMoveDecision: input.viewModel.nextMoveDecision,
      deepAnalysisV2Trace: trace,
      generatedPrompt: input.viewModel.prompt
    }
  }

  return JSON.stringify(payload, null, 2)
}

function ReviewDebugCopyPanel(props: {
  tracker: ProjectTrackerRecord | null
  viewModel: ReviewPopupViewModel
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle")
  const debugText = buildReviewDebugText(props)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(debugText)
      setCopyState("copied")
      window.setTimeout(() => setCopyState("idle"), 1400)
    } catch {
      setCopyState("failed")
      window.setTimeout(() => setCopyState("idle"), 1800)
    }
  }

  return (
    <div style={styles.reviewDebugCard}>
      <button type="button" style={styles.reviewDebugButton} onClick={() => void handleCopy()}>
        {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy debug"}
      </button>
    </div>
  )
}

function menuItemStyle(open: boolean, status: ProjectContextStatus) {
  return {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    width: "100%",
    borderRadius: 12,
    border: "none",
    background: open ? "rgba(7,102,254,0.08)" : "transparent",
    color: open ? "#0766fe" : "#334155",
    padding: "11px 12px",
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "none"
  } as const
}

const styles = {
  handoffNotice: {
    border: "1px solid rgba(147,197,253,0.32)",
    borderRadius: 14,
    background: "rgba(15,23,42,0.72)",
    color: "#dbeafe",
    padding: "12px 14px",
    margin: "0 0 14px",
    fontSize: 14,
    lineHeight: 1.45,
    fontWeight: 800,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 12px 24px rgba(0,0,0,0.16)"
  },
  workflowHelper: {
    margin: "2px 0 0",
    fontSize: 14,
    lineHeight: 1.5,
    color: "#475569"
  },
  promptActionStack: {
    display: "grid",
    gap: 10,
    minWidth: 0
  },
  contextBannerCard: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: 16,
    rowGap: 8,
    borderRadius: 16,
    border: "1px solid rgba(147,197,253,0.26)",
    background: "linear-gradient(180deg, rgba(18,31,55,0.96), rgba(13,23,42,0.98))",
    padding: "16px 18px",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 16px 34px rgba(0,0,0,0.18)"
  },
  contextBannerTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 10,
    minWidth: 0
  },
  contextBannerButton: {
    gridColumn: "2",
    gridRow: "1 / span 2",
    border: "1px solid rgba(147,197,253,0.32)",
    borderRadius: 999,
    background: "rgba(30,58,105,0.88)",
    color: "#eaf2ff",
    padding: "10px 16px",
    fontSize: 13,
    lineHeight: 1.2,
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
    boxShadow: "0 8px 18px rgba(0,0,0,0.18)"
  },
  contextBannerCopy: {
    margin: 0,
    gridColumn: "1",
    fontSize: 14,
    lineHeight: 1.55,
    color: "#dbeafe",
    fontWeight: 650
  },
  retryAnalysisCard: {
    display: "grid",
    gap: 12,
    borderRadius: 16,
    border: "1px solid rgba(37,99,235,0.16)",
    background: "#eff6ff",
    padding: 14
  },
  retryAnalysisTextGroup: {
    display: "grid",
    gap: 4
  },
  retryAnalysisTitle: {
    color: "#1e3a8a",
    fontSize: 14,
    lineHeight: 1.25,
    fontWeight: 900
  },
  retryAnalysisCopy: {
    margin: 0,
    color: "#1d4ed8",
    fontSize: 13,
    lineHeight: 1.45,
    fontWeight: 650
  },
  trackerCard: {
    display: "grid",
    gap: 10,
    borderRadius: 18,
    border: "1px solid rgba(37,99,235,0.18)",
    background: "linear-gradient(180deg, rgba(219,234,254,0.34), rgba(248,250,252,0.78))",
    padding: 16
  },
  trackerHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  trackerTitleGroup: {
    display: "grid",
    gap: 3,
    minWidth: 0
  },
  trackerEyebrow: {
    fontSize: 11,
    lineHeight: 1.2,
    color: "#2563eb",
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: 0
  },
  trackerTitle: {
    fontSize: 13,
    lineHeight: 1.35,
    color: "#0f172a",
    fontWeight: 900,
    overflowWrap: "anywhere"
  },
  trackerToggle: (enabled: boolean, disabled = false) =>
    ({
      display: "inline-flex",
      alignItems: "center",
      gap: 7,
      minWidth: 64,
      border: "1px solid rgba(37,99,235,0.18)",
      borderRadius: 999,
      background: enabled ? "#2563eb" : "#ffffff",
      color: enabled ? "#ffffff" : "#475569",
      padding: "5px 8px",
      fontSize: 11,
      lineHeight: 1,
      fontWeight: 900,
      cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.78 : 1
    }) as const,
  trackerToggleKnob: (enabled: boolean) =>
    ({
      width: 14,
      height: 14,
      borderRadius: 999,
      background: enabled ? "#ffffff" : "#cbd5e1",
      boxShadow: "0 1px 4px rgba(15,23,42,0.18)"
    }) as const,
  trackerToggleLabel: {
    lineHeight: 1
  },
  trackerProgressTrack: {
    height: 6,
    overflow: "hidden",
    borderRadius: 999,
    background: "rgba(148,163,184,0.22)"
  },
  trackerProgressFill: (percent: number) =>
    ({
      width: `${percent}%`,
      height: "100%",
      borderRadius: 999,
      background: "#2563eb",
      transition: "width 180ms ease"
    }) as const,
  testingCard: {
    display: "grid",
    gap: 14,
    borderRadius: 16,
    border: "1px solid rgba(7,102,254,0.22)",
    background: "#eff6ff",
    padding: 16
  },
  testingEyebrow: {
    color: "#075fd6",
    fontSize: 11,
    lineHeight: 1,
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase"
  },
  testingTitle: {
    margin: "7px 0 4px",
    color: "#0f3f91",
    fontSize: 17,
    lineHeight: 1.25,
    fontWeight: 950
  },
  testingCopy: {
    margin: 0,
    color: "#1d4ed8",
    fontSize: 13,
    lineHeight: 1.45,
    fontWeight: 650
  },
  testingActions: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 8
  },
  testingChoiceButton: (active: boolean) =>
    ({
      border: active ? "1px solid rgba(7,102,254,0.75)" : "1px solid rgba(7,102,254,0.22)",
      borderRadius: 12,
      background: active ? "#dbeafe" : "#ffffff",
      color: "#0f3f91",
      padding: "11px 12px",
      fontSize: 13,
      lineHeight: 1.2,
      fontWeight: 900,
      cursor: "pointer",
      textAlign: "left",
      boxShadow: active ? "0 8px 18px rgba(7,102,254,0.12)" : "none"
    }) as const,
  testingPromptBlock: {
    display: "grid",
    gap: 10
  },
  testingCompleteBox: {
    display: "grid",
    gap: 10,
    borderRadius: 12,
    background: "#ffffff",
    border: "1px solid rgba(7,102,254,0.2)",
    padding: 12,
    color: "#1d4ed8",
    fontSize: 13,
    lineHeight: 1.4,
    fontWeight: 650
  },
  testingCompleteHeader: {
    display: "grid",
    gap: 7
  },
  testingCompletePill: {
    justifySelf: "start",
    borderRadius: 999,
    border: "1px solid rgba(147,197,253,0.5)",
    background: "linear-gradient(135deg, #0b6bff, #3b82f6)",
    color: "#ffffff",
    padding: "7px 11px",
    fontSize: 11,
    lineHeight: 1,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: 0
  },
  testingPrimaryButton: {
    justifySelf: "start",
    border: "1px solid rgba(7,102,254,0.28)",
    borderRadius: 999,
    background: "#0766fe",
    color: "#ffffff",
    padding: "10px 13px",
    fontSize: 12,
    lineHeight: 1,
    fontWeight: 900,
    cursor: "pointer",
    boxShadow: "0 10px 18px rgba(7,102,254,0.16)"
  },
  nextMovePageHeader: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    alignItems: "center",
    gap: 10
  },
  nextMoveBackButton: {
    width: 38,
    height: 38,
    borderRadius: 999,
    border: "1px solid rgba(7,102,254,0.24)",
    background: "#ffffff",
    color: "#075fd6",
    fontSize: 18,
    lineHeight: 1,
    fontWeight: 950,
    cursor: "pointer"
  },
  nextMovePageTitle: {
    margin: 0,
    color: "#0f3f91",
    fontSize: 22,
    lineHeight: 1.2,
    fontWeight: 950
  },
  nextMoveWorkflowBar: {
    position: "sticky",
    top: 0,
    zIndex: 4,
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 6,
    borderRadius: 12,
    border: "1px solid rgba(37,99,235,0.18)",
    background: "rgba(248,250,252,0.96)",
    padding: 7,
    boxShadow: "0 8px 20px rgba(15,23,42,0.08)",
    backdropFilter: "blur(12px)"
  },
  nextMoveWorkflowStep: (active: boolean, complete: boolean) =>
    ({
      minWidth: 0,
      minHeight: 48,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
      borderRadius: 8,
      border: active
        ? "1px solid rgba(37,99,235,0.56)"
        : complete
          ? "1px solid rgba(22,163,74,0.34)"
          : "1px solid transparent",
      background: active ? "#dbeafe" : complete ? "#dcfce7" : "transparent",
      color: active ? "#1d4ed8" : complete ? "#166534" : "#64748b",
      fontSize: 11,
      lineHeight: 1.25,
      fontWeight: 850,
      textAlign: "center",
      padding: "7px 8px"
    }) as const,
  nextMoveWorkflowNumber: (active: boolean, complete: boolean) =>
    ({
      flexShrink: 0,
      width: 22,
      height: 22,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 999,
      background: active ? "#2563eb" : complete ? "#16a34a" : "#cbd5e1",
      color: "#ffffff",
      fontSize: 11,
      lineHeight: 1,
      fontWeight: 950
    }) as const,
  nextMoveGrid: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 8
  },
  nextMoveButton: (active: boolean) =>
    ({
      display: "grid",
      gap: 4,
      border: active ? "1px solid rgba(7,102,254,0.7)" : "1px solid rgba(148,163,184,0.22)",
      borderRadius: 12,
      background: active ? "#eff6ff" : "#ffffff",
      color: "#0f172a",
      padding: 11,
      textAlign: "left",
      cursor: "pointer",
      boxShadow: active ? "0 8px 16px rgba(7,102,254,0.12)" : "none"
    }) as const,
  nextMoveTitle: {
    color: "#0f3f91",
    fontSize: 13,
    lineHeight: 1.2,
    fontWeight: 900
  },
  nextMoveDescription: {
    color: "#475569",
    fontSize: 12,
    lineHeight: 1.4,
    fontWeight: 650
  },
  nextMoveSelectedBox: {
    display: "grid",
    gap: 3,
    borderRadius: 12,
    background: "#f8fafc",
    border: "1px solid rgba(148,163,184,0.22)",
    padding: 10,
    color: "#334155",
    fontSize: 12,
    lineHeight: 1.4,
    fontWeight: 650
  },
  nextMoveQuestionPanel: {
    display: "grid",
    gap: 10,
    borderRadius: 12,
    background: "#ffffff",
    border: "1px solid rgba(148,163,184,0.22)",
    padding: 12
  },
  nextMoveProgressTrack: {
    width: "100%",
    height: 9,
    borderRadius: 999,
    overflow: "hidden",
    background: "rgba(37,99,235,0.16)",
    border: "1px solid rgba(96,165,250,0.22)"
  },
  nextMoveProgressFill: (percent: number) =>
    ({
      width: `${Math.max(0, Math.min(100, percent))}%`,
      height: "100%",
      borderRadius: 999,
      background: "linear-gradient(90deg, #2563eb, #60a5fa)",
      boxShadow: "0 0 18px rgba(96,165,250,0.36)",
      transition: "width 140ms ease"
    }) as const,
  nextMoveProgressMeta: {
    color: "#93c5fd",
    fontSize: 12,
    lineHeight: 1.35,
    fontWeight: 750
  },
  nextMoveQuestionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    color: "#0f172a",
    fontSize: 14,
    lineHeight: 1.2,
    fontWeight: 900
  },
  nextMoveQuestionList: {
    display: "grid",
    gap: 9
  },
  nextMoveDraftContext: {
    display: "grid",
    gap: 4,
    borderRadius: 10,
    background: "#f8fafc",
    border: "1px solid rgba(148,163,184,0.2)",
    padding: "9px 10px",
    color: "#475569",
    fontSize: 12,
    lineHeight: 1.4,
    fontWeight: 650,
    maxHeight: 104,
    overflow: "auto"
  },
  nextMoveDescriptionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  nextMoveInlineEdit: {
    border: "1px solid rgba(37,99,235,0.22)",
    borderRadius: 999,
    background: "#ffffff",
    color: "#2563eb",
    padding: "7px 10px",
    fontSize: 11,
    lineHeight: 1,
    fontWeight: 900,
    cursor: "pointer"
  },
  nextMoveEditActions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap"
  },
  nextMoveQuestionTabs: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    flexWrap: "wrap"
  },
  nextMoveQuestionTab: (active: boolean, answered: boolean) =>
    ({
      width: 38,
      height: 38,
      borderRadius: 999,
      border: active
        ? "2px solid rgba(147,197,253,0.95)"
        : answered
          ? "1px solid rgba(96,165,250,0.78)"
          : "1px solid rgba(148,163,184,0.32)",
      background: active ? "#1d4ed8" : answered ? "rgba(37,99,235,0.32)" : "rgba(15,23,42,0.56)",
      color: active ? "#ffffff" : answered ? "#bfdbfe" : "#dbeafe",
      fontSize: 14,
      lineHeight: 1,
      fontWeight: 900,
      cursor: "pointer",
      boxShadow: active ? "0 0 0 4px rgba(59,130,246,0.22), 0 8px 16px rgba(37,99,235,0.22)" : "none",
      transform: active ? "scale(1.05)" : "none"
    }) as const,
  nextMoveActiveQuestion: {
    display: "grid",
    gap: 12,
    borderRadius: 12,
    background: "#f8fafc",
    border: "1px solid rgba(148,163,184,0.22)",
    padding: 14
  },
  nextMoveQuestionPosition: {
    justifySelf: "start",
    borderRadius: 999,
    background: "#dbeafe",
    color: "#1d4ed8",
    padding: "6px 9px",
    fontSize: 11,
    lineHeight: 1,
    fontWeight: 900
  },
  nextMoveOptionList: {
    display: "grid",
    gap: 8
  },
  nextMoveOptionGroup: {
    display: "grid",
    gap: 8
  },
  nextMoveOptionButton: (selected: boolean) =>
    ({
      width: "100%",
      border: selected ? "1px solid rgba(37,99,235,0.72)" : "1px solid rgba(148,163,184,0.28)",
      borderRadius: 12,
      background: selected ? "#dbeafe" : "#ffffff",
      color: selected ? "#1d4ed8" : "#0f172a",
      padding: "13px 14px",
      textAlign: "left",
      fontSize: 14,
      lineHeight: 1.4,
      fontWeight: 850,
      cursor: "pointer",
      boxShadow: selected ? "0 8px 16px rgba(37,99,235,0.12)" : "none"
    }) as const,
  nextMoveQuestionField: {
    display: "grid",
    gap: 5
  },
  nextMoveQuestionLabel: {
    margin: 0,
    color: "#334155",
    fontSize: 16,
    lineHeight: 1.35,
    fontWeight: 850
  },
  nextMoveQuestionSource: {
    justifySelf: "start",
    borderRadius: 999,
    background: "rgba(15, 23, 42, 0.06)",
    color: "#64748b",
    padding: "4px 8px",
    fontSize: 10,
    lineHeight: 1.2,
    fontWeight: 850,
    letterSpacing: 0
  },
  nextMoveTextarea: {
    width: "100%",
    boxSizing: "border-box",
    resize: "vertical",
    minHeight: 58,
    border: "1px solid rgba(148,163,184,0.28)",
    borderRadius: 10,
    background: "#f8fafc",
    color: "#0f172a",
    padding: "9px 10px",
    fontSize: 12,
    lineHeight: 1.4,
    fontWeight: 650,
    outline: "none",
    fontFamily: "inherit"
  },
  nextMoveQuestionNote: {
    margin: 0,
    color: "#64748b",
    fontSize: 14,
    lineHeight: 1.45,
    fontWeight: 650
  },
  nextMoveRouteBox: {
    display: "grid",
    gap: 9
  },
  nextMovePrimaryAction: (disabled: boolean) =>
    ({
      justifySelf: "start",
      border: "1px solid rgba(37,99,235,0.2)",
      borderRadius: 999,
      background: disabled ? "#cbd5e1" : "#2563eb",
      color: "#ffffff",
      padding: "10px 13px",
      fontSize: 12,
      lineHeight: 1,
      fontWeight: 900,
      cursor: disabled ? "default" : "pointer",
      boxShadow: disabled ? "none" : "0 10px 18px rgba(37,99,235,0.16)",
      opacity: disabled ? 0.76 : 1
    }) as const,
  nextMoveSecondaryAction: {
    border: "1px solid rgba(37,99,235,0.22)",
    borderRadius: 999,
    background: "#ffffff",
    color: "#2563eb",
    padding: "10px 13px",
    fontSize: 12,
    lineHeight: 1,
    fontWeight: 900,
    cursor: "pointer"
  },
  nextMoveGhostAction: {
    border: "1px solid rgba(148,163,184,0.22)",
    borderRadius: 999,
    background: "#f8fafc",
    color: "#475569",
    padding: "10px 13px",
    fontSize: 12,
    lineHeight: 1,
    fontWeight: 900,
    cursor: "pointer"
  },
  bugScreenshotPreviewCard: {
    display: "grid",
    gap: 6,
    borderRadius: 12,
    border: "1px solid rgba(148,163,184,0.22)",
    background: "#f8fafc",
    padding: 8
  },
  bugScreenshotPreviewGrid: {
    display: "grid",
    gap: 10
  },
  bugScreenshotPreview: {
    width: "100%",
    maxHeight: 180,
    objectFit: "cover",
    borderRadius: 8,
    border: "1px solid rgba(15,23,42,0.08)"
  },
  bugScreenshotMeta: {
    color: "#64748b",
    fontSize: 11,
    lineHeight: 1.25,
    fontWeight: 750
  },
  hiddenFileInput: {
    display: "none"
  },
  bugScreenshotError: {
    margin: 0,
    color: "#b91c1c",
    fontSize: 12,
    lineHeight: 1.4,
    fontWeight: 750
  },
  bugScreenshotActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8
  },
  projectCatalogLayout: {
    display: "grid",
    gap: 14
  },
  projectCatalogIntro: {
    display: "grid",
    gap: 6,
    borderRadius: 16,
    border: "1px solid rgba(37,99,235,0.14)",
    background: "#f8fafc",
    padding: 14
  },
  projectCatalogTitle: {
    color: "#0f172a",
    fontSize: 15,
    lineHeight: 1.2,
    fontWeight: 950
  },
  projectCatalogCopy: {
    margin: 0,
    color: "#475569",
    fontSize: 13,
    lineHeight: 1.45,
    fontWeight: 650
  },
  projectCatalogList: {
    display: "grid",
    gap: 10
  },
  projectCatalogCard: {
    display: "grid",
    gap: 9,
    borderRadius: 14,
    border: "1px solid rgba(148,163,184,0.22)",
    background: "#ffffff",
    padding: 13,
    boxShadow: "0 10px 24px rgba(15,23,42,0.06)"
  },
  projectCatalogCardHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10
  },
  projectCatalogCardTitle: {
    color: "#0f172a",
    fontSize: 14,
    lineHeight: 1.25,
    fontWeight: 950,
    overflowWrap: "anywhere"
  },
  projectCatalogDate: {
    flexShrink: 0,
    color: "#64748b",
    fontSize: 11,
    lineHeight: 1.2,
    fontWeight: 800
  },
  projectCatalogSummary: {
    margin: 0,
    color: "#475569",
    fontSize: 12,
    lineHeight: 1.45,
    fontWeight: 650,
    overflowWrap: "anywhere"
  },
  projectCatalogMeta: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    color: "#64748b",
    fontSize: 11,
    lineHeight: 1.2,
    fontWeight: 850
  },
  projectCatalogPhaseList: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6
  },
  projectCatalogPhasePill: {
    borderRadius: 999,
    background: "#eff6ff",
    color: "#2563eb",
    padding: "5px 8px",
    fontSize: 11,
    lineHeight: 1,
    fontWeight: 850
  },
  projectCatalogEmpty: {
    display: "grid",
    gap: 5,
    borderRadius: 14,
    border: "1px dashed rgba(148,163,184,0.36)",
    background: "#ffffff",
    color: "#475569",
    padding: 16,
    fontSize: 13,
    lineHeight: 1.4,
    fontWeight: 650
  },
  reviewDebugCard: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    borderRadius: 14,
    border: "1px solid rgba(37,99,235,0.18)",
    background: "transparent",
    padding: 0
  },
  reviewDebugButton: {
    border: "1px solid rgba(37,99,235,0.24)",
    borderRadius: 999,
    background: "rgba(37,99,235,0.08)",
    color: "#1d4ed8",
    padding: "10px 12px",
    fontSize: 12,
    lineHeight: 1,
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap"
  },
  backButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    border: "1px solid rgba(148,163,184,0.22)",
    borderRadius: 999,
    background: "#ffffff",
    color: "#334155",
    padding: "10px 13px",
    fontSize: 13,
    lineHeight: 1,
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 8px 20px rgba(15,23,42,0.08)"
  },
  backIconButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
    border: "1px solid rgba(148,163,184,0.22)",
    borderRadius: 999,
    background: "#ffffff",
    color: "#334155",
    padding: 0,
    fontSize: 22,
    lineHeight: 1,
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 8px 20px rgba(15,23,42,0.08)"
  },
  settingsIcon: {
    fontSize: 15,
    lineHeight: 1
  },
  settingsLabel: {
    lineHeight: 1
  },
  settingsIndicator: (status: ProjectContextStatus) =>
    ({
      position: "relative",
      width: 8,
      height: 8,
      borderRadius: 999,
      background: status === "conflicted" ? "#ef4444" : "#f59e0b",
      boxShadow:
        status === "conflicted"
          ? "0 0 0 3px rgba(239,68,68,0.16)"
          : "0 0 0 3px rgba(245,158,11,0.16)"
    }) as const
} as const
