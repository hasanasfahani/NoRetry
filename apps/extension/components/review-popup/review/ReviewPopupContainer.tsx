import { ReviewPopup } from "./ReviewPopup"
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
import type { ProjectTrackerRecord } from "../../../lib/project-tracker/project-tracker"

type ReviewPopupContainerProps = {
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
  surfaceActions: PopupAction[]
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
  onPostTrackerBugScreenshotAdd: (input: { dataUrl: string; mimeType: string }) => Promise<void> | void
  onPostTrackerBugScreenshotClear: () => void
  onPostTrackerNextMovePromptGenerate: (
    choice: "small_feature" | "large_feature" | "bug_fix" | "small_change",
    answers: Record<string, string>
  ) => Promise<string>
  onPostTrackerNextMovePromptSubmit: (
    choice: "small_feature" | "large_feature" | "bug_fix" | "small_change",
    prompt: string
  ) => void
  onPostTrackerNextMoveV2Open: (
    description: string,
    choice: "small_feature" | "large_feature" | "bug_fix" | "small_change"
  ) => void
  onNextMoveV2QuestionSetLoad: (
    choice: "small_feature" | "large_feature" | "bug_fix" | "small_change",
    sourcePromptOverride?: string
  ) => Promise<Array<{
    label: string
    helper?: string
    options?: string[]
    placeholder: string
    source: "ai" | "fallback"
    provider?: string
  }>>
  onNextMoveV2PromptGenerate: (
    choice: "small_feature" | "large_feature" | "bug_fix" | "small_change",
    answers: Record<string, string>,
    fallbackPrompt: string,
    sourcePromptOverride?: string
  ) => Promise<string>
  onNextMoveV2PathSelected: (
    choice: "small_feature" | "large_feature" | "bug_fix" | "small_change"
  ) => void
  onNextMoveV2QuestionAnswered: (input: {
    choice: "small_feature" | "large_feature" | "bug_fix" | "small_change"
    answeredCount: number
    questionCount: number
    allAnswered: boolean
  }) => void
  onNextMoveV2DescriptionEdited: (
    choice: "small_feature" | "large_feature" | "bug_fix" | "small_change"
  ) => void
  onNextMoveV2QuestionsRetried: (
    choice: "small_feature" | "large_feature" | "bug_fix" | "small_change"
  ) => void
  onNextMoveV2PromptSubmit: (prompt: string) => Promise<boolean>
  onRetryAnalysis: () => void
  onClose: () => void
}

export function ReviewPopupContainer(props: ReviewPopupContainerProps) {
  return (
    <ReviewPopup
      open={props.open}
      surface={props.surface}
      viewModel={props.viewModel}
      promptModeState={props.promptModeState}
      projectSettingsEnabled={props.projectSettingsEnabled}
      projectPanelView={props.projectPanelView}
      projectContextStatus={props.projectContextStatus}
      projectContextWarnings={props.projectContextWarnings}
      projectContextStaleReasons={props.projectContextStaleReasons}
      projectContextConflictReasons={props.projectContextConflictReasons}
      projectSyncStatus={props.projectSyncStatus}
      projectSyncMessage={props.projectSyncMessage}
      promptProjectContextImportedContext={props.promptProjectContextImportedContext}
      projectPreferences={props.projectPreferences}
      projectCurrentPhase={props.projectCurrentPhase}
      projectProtectedAreas={props.projectProtectedAreas}
      promptProjectContextEnabled={props.promptProjectContextEnabled}
      promptProjectContextReady={props.promptProjectContextReady}
      promptProjectContextLabel={props.promptProjectContextLabel}
      projectCatalogItems={props.projectCatalogItems}
      projectTracker={props.projectTracker}
      latestSubmittedPromptHash={props.latestSubmittedPromptHash}
      projectPlanningPlatformLabel={props.projectPlanningPlatformLabel}
      promptProjectContextFeatureArea={props.promptProjectContextFeatureArea}
      promptProjectContextProtectedCount={props.promptProjectContextProtectedCount}
      promptProjectContextConstraintCount={props.promptProjectContextConstraintCount}
      promptProjectContextImportOpen={props.promptProjectContextImportOpen}
      promptProjectContextDraft={props.promptProjectContextDraft}
      architectureConfirmation={props.architectureConfirmation}
      projectPlanningState={props.projectPlanningState}
      promptProjectContextSaving={props.promptProjectContextSaving}
      projectPlanningSaving={props.projectPlanningSaving}
      projectPlanningGeneratingDraft={props.projectPlanningGeneratingDraft}
      projectPlanningErrorMessage={props.projectPlanningErrorMessage}
      projectPlanningCopyMessage={props.projectPlanningCopyMessage}
      reviewPromptCopyFeedback={props.reviewPromptCopyFeedback}
      projectPlanningDebugPayload={props.projectPlanningDebugPayload}
      promptProjectContextDeleting={props.promptProjectContextDeleting}
      projectPreferencesSaving={props.projectPreferencesSaving}
      projectFocusSaving={props.projectFocusSaving}
      accountState={props.accountState}
      accountSubmitting={props.accountSubmitting}
      bugReportScreenshots={props.bugReportScreenshots}
      bugReportScreenshotCapturing={props.bugReportScreenshotCapturing}
      bugReportScreenshotError={props.bugReportScreenshotError}
      handoffNotice={props.handoffNotice}
      modeActions={props.surfaceActions}
      promptActions={props.promptActions}
      onPromptQuestionIndexChange={props.onPromptQuestionIndexChange}
      onPromptAnswerChange={props.onPromptAnswerChange}
      onPromptToggleMultiAnswer={props.onPromptToggleMultiAnswer}
      onPromptOtherAnswerChange={props.onPromptOtherAnswerChange}
      onPromptAdvanceOther={props.onPromptAdvanceOther}
      onPromptGenerate={props.onPromptGenerate}
      onPromptReviewConflict={props.onPromptReviewConflict}
      onPromptFixMissingContext={props.onPromptFixMissingContext}
      onProjectOnboardingOpen={props.onProjectOnboardingOpen}
      onProjectContextOpen={props.onProjectContextOpen}
      onProjectPlanningOpen={props.onProjectPlanningOpen}
      onProjectsOpen={props.onProjectsOpen}
      onProjectSettingsOpen={props.onProjectSettingsOpen}
      onAccountOpen={props.onAccountOpen}
      onProjectPanelClose={props.onProjectPanelClose}
      onProjectOnboardingChooseInProgress={props.onProjectOnboardingChooseInProgress}
      onProjectOnboardingChooseStartingNow={props.onProjectOnboardingChooseStartingNow}
      onProjectPlanningDraftChange={props.onProjectPlanningDraftChange}
      onProjectPlanningQuestionIndexChange={props.onProjectPlanningQuestionIndexChange}
      onProjectPlanningAnswerChange={props.onProjectPlanningAnswerChange}
      onProjectPlanningToggleMultiAnswer={props.onProjectPlanningToggleMultiAnswer}
      onProjectPlanningOtherAnswerChange={props.onProjectPlanningOtherAnswerChange}
      onProjectPlanningAdvanceQuestion={props.onProjectPlanningAdvanceQuestion}
      onProjectPlanningBackToOnboarding={props.onProjectPlanningBackToOnboarding}
      onProjectPlanningBackToIntake={props.onProjectPlanningBackToIntake}
      onProjectPlanningBuildDraft={props.onProjectPlanningBuildDraft}
      onProjectPlanningReturnToQuestions={props.onProjectPlanningReturnToQuestions}
      onProjectPlanningCopyPrd={props.onProjectPlanningCopyPrd}
      onProjectTrackerToggle={props.onProjectTrackerToggle}
      onProjectPreferencesSave={props.onProjectPreferencesSave}
      onAccountLogin={props.onAccountLogin}
      onAccountRegister={props.onAccountRegister}
      onAccountLogout={props.onAccountLogout}
      onProjectProtectedAreasChange={props.onProjectProtectedAreasChange}
      onProjectFeatureAreaChange={props.onProjectFeatureAreaChange}
      onProjectPhaseChange={props.onProjectPhaseChange}
      onPromptProjectContextToggle={props.onPromptProjectContextToggle}
      onPromptProjectContextDraftChange={props.onPromptProjectContextDraftChange}
      onPromptProjectContextCopyRequest={props.onPromptProjectContextCopyRequest}
      onPromptProjectContextImport={props.onPromptProjectContextImport}
      onPromptProjectContextDelete={props.onPromptProjectContextDelete}
      onArchitectureConfirmationEdit={props.onArchitectureConfirmationEdit}
      onArchitectureConfirmationDraftChange={props.onArchitectureConfirmationDraftChange}
      onArchitectureConfirmationConfirm={props.onArchitectureConfirmationConfirm}
      onPostTrackerTestingChoice={props.onPostTrackerTestingChoice}
      onPostTrackerTestingPromptSubmit={props.onPostTrackerTestingPromptSubmit}
      onPostTrackerBugScreenshotAdd={props.onPostTrackerBugScreenshotAdd}
      onPostTrackerBugScreenshotClear={props.onPostTrackerBugScreenshotClear}
      onPostTrackerNextMovePromptGenerate={props.onPostTrackerNextMovePromptGenerate}
      onPostTrackerNextMovePromptSubmit={props.onPostTrackerNextMovePromptSubmit}
      onPostTrackerNextMoveV2Open={props.onPostTrackerNextMoveV2Open}
      onNextMoveV2QuestionSetLoad={props.onNextMoveV2QuestionSetLoad}
      onNextMoveV2PromptGenerate={props.onNextMoveV2PromptGenerate}
      onNextMoveV2PathSelected={props.onNextMoveV2PathSelected}
      onNextMoveV2QuestionAnswered={props.onNextMoveV2QuestionAnswered}
      onNextMoveV2DescriptionEdited={props.onNextMoveV2DescriptionEdited}
      onNextMoveV2QuestionsRetried={props.onNextMoveV2QuestionsRetried}
      onNextMoveV2PromptSubmit={props.onNextMoveV2PromptSubmit}
      onRetryAnalysis={props.onRetryAnalysis}
      onClose={props.onClose}
    />
  )
}
