import { useEffect, useState, type CSSProperties } from "react"
import { StatusBadge } from "../shared/StatusBadge"
import { buildReplitDeepContextRequestPrompt } from "../../../lib/core/project-context"
import type { ImportedProjectContextRecord } from "../../../lib/core/project-context"
import type {
  ProjectContextStatus,
  ProjectPreferenceSettings,
} from "../../../lib/session/project-settings"
import type {
  ArchitectureConfirmationState,
  StructuredProjectPhase
} from "../../../lib/session/project-memory"
import type { ProjectSyncStatus } from "../../../lib/sync/sync-types"

function normalizeInlineCopy(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function ensureStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[]
  return value.map((item) => String(item).trim()).filter(Boolean)
}

function shouldShowFeatureArea(value: string) {
  const normalized = normalizeInlineCopy(value)
  if (!normalized) return false
  if (normalized.length > 56) return false
  if (/^(give|write|create|make|build|fix|update|change|remove|add|show|summarize|summarise|explain|review|check)\b/i.test(normalized)) {
    return false
  }
  if (/\bsummary of the project\b|\bshort summary\b|\bcurrent request\b/i.test(normalized)) {
    return false
  }
  return true
}

function extractSnapshotCandidate(text: string) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    if (/^#+\s+/.test(line)) continue
    const bullet = line.replace(/^\s*(?:[-*]|\d+\.)\s*/, "").trim()
    if (!bullet) continue
    return normalizeInlineCopy(bullet)
  }

  return ""
}

type ProjectSettingsPanelProps = {
  mode: "context" | "settings"
  contextStatus: ProjectContextStatus
  contextWarnings: string[]
  contextStaleReasons: string[]
  contextConflictReasons: string[]
  projectLabel: string
  syncStatus: ProjectSyncStatus
  syncMessage: string | null
  importedContext: ImportedProjectContextRecord | null
  preferences: ProjectPreferenceSettings
  featureArea: string
  currentPhase: StructuredProjectPhase | null
  protectedAreas: string[]
  protectedCount: number
  constraintCount: number
  importOpen: boolean
  draft: string
  saving: boolean
  savingPreferences: boolean
  savingProjectFocus: boolean
  deletingContext: boolean
  onToggleImport: () => void
  onDraftChange: (value: string) => void
  onCopyRequest: () => void
  onImport: () => void
  onDeleteContext: () => void
  onPreferencesSave: (next: ProjectPreferenceSettings) => Promise<void> | void
  onProtectedAreasChange: (areas: string[]) => void
  onFeatureAreaChange: (value: string) => void
  onPhaseChange: (value: StructuredProjectPhase | null) => void
}

export function ArchitectureConfirmationPanel(props: {
  confirmation: ArchitectureConfirmationState
  saving: boolean
  onEdit: () => void
  onDraftChange: (value: string) => void
  onConfirm: () => void
}) {
  const sourceLabel = props.confirmation.source === "planning" ? "your planning answers and PRD" : "the Architecture section you imported"

  return (
    <div style={styles.architectureConfirmationLayout}>
      <div>
        <p style={styles.architectureConfirmationEyebrow}>Project architecture</p>
        <p style={styles.architectureConfirmationTitle}>Does this architecture record look right?</p>
        <p style={styles.architectureConfirmationBody}>
          This list was derived from {sourceLabel}. Nothing enters project memory until you choose Looks right.
        </p>
      </div>

      {props.confirmation.editing ? (
        <textarea
          style={styles.architectureConfirmationTextarea}
          value={props.confirmation.draft}
          onChange={(event) => props.onDraftChange(event.target.value)}
          disabled={props.saving}
          aria-label="Edit architecture list"
        />
      ) : (
        <pre style={styles.architectureConfirmationList}>{props.confirmation.draft}</pre>
      )}

      <p style={styles.architectureConfirmationHint}>
        To correct the list, keep the Stack, Data model, Access rules, and Conventions headings and edit their bullet points.
      </p>
      <div style={styles.actionRow}>
        <button type="button" style={styles.primaryButton} onClick={props.onConfirm} disabled={props.saving}>
          {props.saving ? "Saving..." : "Looks right"}
        </button>
        <button type="button" style={styles.secondaryButton} onClick={props.onEdit} disabled={props.saving || props.confirmation.editing}>
          Edit
        </button>
      </div>
    </div>
  )
}

export function ProjectSettingsPanel(props: ProjectSettingsPanelProps) {
  const hasContext = props.contextStatus !== "missing"
  const showContextPage = props.mode === "context"
  const showSettingsPage = props.mode === "settings"
  const ready = props.contextStatus === "active"
  const syncLabel =
    props.syncStatus === "guest"
      ? "Guest only"
      : props.syncStatus === "syncing"
        ? "Syncing"
        : props.syncStatus === "synced"
          ? "Synced"
          : props.syncStatus === "failed"
            ? "Sync failed"
            : "Local only"
  const summary = props.importedContext?.summary
  const presentSections = ensureStringArray(summary?.presentSections)
  const relevantFiles = ensureStringArray(summary?.relevantFiles)
  const blockers = ensureStringArray(summary?.blockers)
  const definitionOfDone = ensureStringArray(summary?.definitionOfDone)
  const [detailsOpen, setDetailsOpen] = useState(!hasContext)
  const [snapshotExpanded, setSnapshotExpanded] = useState(false)
  const [isEditingPreferences, setIsEditingPreferences] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [preferenceDraft, setPreferenceDraft] = useState<ProjectPreferenceSettings>(props.preferences)
  const statusLabel =
    props.contextStatus === "conflicted"
      ? "Needs attention"
      : props.contextStatus === "stale"
        ? "Refresh suggested"
        : ready
          ? "Context connected"
          : "Context missing"
  const importLabel = hasContext
    ? props.contextStatus === "active"
      ? "Refresh markdown brief"
      : "Update markdown brief"
    : "Paste markdown brief"
  const displayFeatureArea = shouldShowFeatureArea(props.featureArea) ? props.featureArea : ""
  const primaryActionLabel = hasContext
    ? props.contextStatus === "conflicted"
      ? "Refresh project context"
      : importLabel
    : "Copy Replit request"
  const secondaryActionLabel = props.importOpen
    ? hasContext
      ? "Close editor"
      : "Hide markdown box"
    : hasContext
      ? "Edit saved context"
      : "Paste markdown brief"
  const markdownSnapshot =
    extractSnapshotCandidate(props.importedContext?.projectContext ?? "") ||
    extractSnapshotCandidate(props.importedContext?.currentState ?? "") ||
    extractSnapshotCandidate(props.importedContext?.rawMarkdown ?? "")
  const leadingConflictReason = props.contextConflictReasons[0] ?? ""
  const contextSummaryText = markdownSnapshot
    ? `"${markdownSnapshot}"`
      : displayFeatureArea
        ? `reeva AI is currently anchored around ${displayFeatureArea}. Refresh the markdown brief whenever this focus, the protected scope, or the current delivery goal changes.`
      : presentSections.length
        ? `Saved brief coverage: ${presentSections.slice(0, 3).join(", ")}${presentSections.length > 3 ? ", and more" : ""}.`
        : "Use this section to review what reeva AI currently remembers about the project and refresh it when the project shifts."
  const snapshotNeedsClamp = contextSummaryText.length > 180
  const visibleSummaryText =
    snapshotNeedsClamp && !snapshotExpanded
      ? `${contextSummaryText.slice(0, 180).trimEnd()}…`
      : contextSummaryText
  const contextRequestPrompt = buildReplitDeepContextRequestPrompt(props.projectLabel || "project")

  useEffect(() => {
    setPreferenceDraft(props.preferences)
  }, [props.preferences])

  useEffect(() => {
    if (!hasContext || !props.deletingContext) return
    setConfirmDeleteOpen(false)
  }, [hasContext, props.deletingContext])

  async function handleUpdatePreferences() {
    await props.onPreferencesSave(preferenceDraft)
    setIsEditingPreferences(false)
  }

  function handleCancelPreferences() {
    setPreferenceDraft(props.preferences)
    setIsEditingPreferences(false)
  }

  function handleOpenDeleteConfirmation() {
    setConfirmDeleteOpen(true)
  }

  function handleCloseDeleteConfirmation() {
    if (props.deletingContext) return
    setConfirmDeleteOpen(false)
  }

  function handleConfirmDelete() {
    void props.onDeleteContext()
  }

  return (
    <>
      <div style={styles.layout}>
        {showContextPage && !hasContext ? (
        <>
        <div style={styles.contextHero}>
          <div style={styles.contextHeroGlow} />
          <div style={styles.contextHeroContent}>
            <div style={styles.contextHeroTop}>
              {props.contextStatus !== "conflicted" ? (
                <StatusBadge
                  label={statusLabel}
                  tone={props.contextStatus === "active" ? "success" : "warning"}
                />
              ) : (
                <span />
              )}
                <div style={styles.contextHeroMeta}>
                  <span style={styles.contextMiniStat}>{syncLabel}</span>
                <span style={styles.contextMiniStat}>{presentSections.length} sections saved</span>
                </div>
            </div>
            <div style={styles.summaryCopy}>
              <p style={styles.heroTitle}>
                Start by adding one markdown brief from Replit.
              </p>
              <p style={styles.heroBody}>
                Submit the request to Replit, ask it to generate the handoff, then paste the markdown brief here. After that, reeva AI can act more like a product manager with project memory.
              </p>
              {props.syncMessage ? <p style={styles.syncMessage}>{props.syncMessage}</p> : null}
            </div>
            <div style={styles.contextSteps}>
              <div style={styles.stepCard}>
                <span style={styles.stepNumber}>1</span>
                <span style={styles.stepText}>Submit request</span>
              </div>
              <div style={styles.stepCard}>
                <span style={styles.stepNumber}>2</span>
                <span style={styles.stepText}>Paste markdown</span>
              </div>
              <div style={styles.stepCard}>
                <span style={styles.stepNumber}>3</span>
                <span style={styles.stepText}>Submit brief</span>
              </div>
            </div>
          </div>
        </div>
        <section style={styles.workflowSection}>
          <div style={styles.sectionHeader}>
            <div style={styles.summaryCopy}>
              <p style={styles.sectionTitle}>Replit context request</p>
              <p style={styles.sectionBody}>Copy this prompt first so Replit can generate the markdown handoff.</p>
            </div>
            <StatusBadge label="Step 1" tone="info" />
          </div>
          <pre style={styles.requestPreview}>{contextRequestPrompt}</pre>
          <button type="button" style={styles.primaryButton} onClick={props.onCopyRequest}>
            Copy Prompt
          </button>
        </section>
        <section style={styles.workflowSection}>
          <div style={styles.sectionHeader}>
            <div style={styles.summaryCopy}>
              <p style={styles.sectionTitle}>Markdown brief</p>
              <p style={styles.sectionBody}>Paste the handoff Replit returns, then submit it as project context.</p>
            </div>
            <StatusBadge label={hasContext ? "Submitted" : "Waiting"} tone={hasContext ? "success" : "warning"} />
          </div>
          <textarea
            style={styles.textarea}
            value={props.draft}
            onChange={(event) => props.onDraftChange(event.target.value)}
            placeholder={`# Project Overview\n- What this project/app does\n- Main architecture or important components\n- Important constraints or requirements\n\n# Current State\n- What I am working on right now\n- Current bug/problem\n- Latest findings\n- Best next likely step`}
            disabled={props.saving}
          />
          <div style={styles.actionRow}>
            <button
              type="button"
              style={styles.primaryButton}
              onClick={props.onImport}
              disabled={props.saving || !props.draft.trim()}
            >
              {props.saving ? "Submitting markdown brief..." : "Submit markdown brief"}
            </button>
          </div>
        </section>
        </>
        ) : showContextPage ? (
        <div style={styles.contextHero}>
          <div style={styles.contextHeroGlow} />
          <div style={styles.contextHeroContent}>
            <div style={styles.contextHeroTop}>
              {props.contextStatus !== "conflicted" ? (
                <StatusBadge
                  label={statusLabel}
                  tone={props.contextStatus === "active" ? "success" : "warning"}
                />
              ) : (
                <span />
              )}
              <div style={styles.contextHeroMeta}>
                <span style={styles.contextMiniStat}>{syncLabel}</span>
                <span style={styles.contextMiniStat}>{presentSections.length} sections saved</span>
              </div>
            </div>
            <div style={styles.summaryCopy}>
              <p style={styles.heroTitle}>
                {ready
                  ? "Saved project context is active."
                  : props.contextStatus === "stale"
                    ? "Your saved context still helps, but it should be refreshed."
                    : "This request may conflict with your saved project rules."}
              </p>
              <p style={styles.heroBody}>
                {ready
                  ? "reeva AI can now use project memory to skip obvious questions, protect scope, and judge assistant work against the real project."
                  : props.contextStatus === "stale"
                    ? "Refresh the markdown brief when the feature area, current bug, or protected scope has changed."
                    : "reeva AI paused here because the current ask looks broader or riskier than the context you saved for this project."}
              </p>
              {props.syncMessage ? <p style={styles.syncMessage}>{props.syncMessage}</p> : null}
            </div>
            <div style={styles.connectedSummaryRow}>
              {props.contextStatus === "conflicted" && leadingConflictReason ? (
                <div style={styles.conflictReasonCard}>
                  <p style={styles.conflictReasonLabel}>Conflict detected</p>
                  <p style={styles.conflictReasonText}>{leadingConflictReason}</p>
                </div>
              ) : null}
              <div style={styles.connectedStatsRow}>
                {displayFeatureArea ? <span style={styles.connectedSummaryChip}>Focus: {displayFeatureArea}</span> : null}
                {props.currentPhase ? <span style={styles.connectedSummaryChip}>Phase: {props.currentPhase.replace(/_/g, " ")}</span> : null}
                <span style={styles.connectedSummaryChip}>{presentSections.length} sections saved</span>
                {props.protectedCount > 0 ? <span style={styles.connectedSummaryChip}>{props.protectedCount} protected areas</span> : null}
              </div>
            </div>
            <div style={styles.primaryActionRow}>
              <button type="button" style={styles.primaryButton} onClick={props.onToggleImport}>
                {props.importOpen ? "Hide markdown box" : primaryActionLabel}
              </button>
              <button type="button" style={styles.secondaryButton} onClick={props.onToggleImport}>
                {secondaryActionLabel}
              </button>
            </div>
            <div style={styles.destructiveActionRow}>
              <button
                type="button"
                style={styles.destructiveButton}
                onClick={handleOpenDeleteConfirmation}
                disabled={props.saving || props.deletingContext}
              >
                {props.deletingContext ? "Deleting context..." : "Delete saved context"}
              </button>
            </div>
          </div>
        </div>
        ) : null}

        {showContextPage && hasContext ? (
          <section style={styles.workflowSection}>
            <div style={styles.sectionHeader}>
              <div style={styles.summaryCopy}>
                <p style={styles.sectionTitle}>Markdown brief</p>
                <p style={styles.sectionBody}>The submitted markdown handoff is saved as project context.</p>
              </div>
              <StatusBadge label="Submitted" tone="success" />
            </div>
          </section>
        ) : null}

        {showContextPage && hasContext && props.importOpen ? (
          <div style={styles.editor}>
            <p style={styles.editorHint}>
              Paste the markdown handoff from Replit here. reeva AI will save it as project context and use it on the next prompt-mode pass.
            </p>
            <textarea
              style={styles.textarea}
              value={props.draft}
              onChange={(event) => props.onDraftChange(event.target.value)}
              placeholder={`# Project Overview\n- What this project/app does\n- Main architecture or important components\n- Important constraints or requirements\n\n# Current State\n- What I am working on right now\n- Current bug/problem\n- Latest findings\n- Best next likely step`}
              disabled={props.saving}
            />
            <div style={styles.actionRow}>
              <button
                type="button"
                style={styles.primaryButton}
                onClick={props.onImport}
                disabled={props.saving || !props.draft.trim()}
              >
                {props.saving ? "Submitting markdown brief..." : "Submit markdown brief"}
              </button>
            </div>
          </div>
        ) : null}

        {showContextPage && hasContext ? (
          <div style={styles.summaryHub} data-reeva-surface="project-context-summary">
            <div style={styles.summaryHubHeader}>
              <div style={styles.summaryCopy}>
                <p style={styles.headline}>Saved context summary</p>
                <p style={markdownSnapshot ? styles.snapshotBody : styles.body}>
                  {visibleSummaryText}
                </p>
                {snapshotNeedsClamp ? (
                  <button
                    type="button"
                    style={styles.inlineTextButton}
                    onClick={() => setSnapshotExpanded((current) => !current)}
                  >
                    {snapshotExpanded ? "See less" : "See more"}
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                style={styles.ghostButton}
                onClick={() => setDetailsOpen((current) => !current)}
              >
                {detailsOpen ? "Hide details" : "View saved brief"}
              </button>
            </div>

            <div style={styles.metaGrid}>
              <div style={styles.metaCard}>
                <p style={styles.metaLabel}>Markdown sections</p>
                <p style={styles.metaValue}>{presentSections.length}</p>
              </div>
              <div style={styles.metaCard}>
                <p style={styles.metaLabel}>Saved constraints</p>
                <p style={styles.metaValue}>{props.constraintCount}</p>
              </div>
              {props.importedContext?.parsedAt ? (
                <div style={styles.metaCard}>
                  <p style={styles.metaLabel}>Last import</p>
                  <p style={styles.metaValue}>{new Date(props.importedContext.parsedAt).toLocaleString()}</p>
                </div>
              ) : null}
            </div>

            {detailsOpen && summary ? (
              <div style={styles.detailGrid}>
                {relevantFiles.length ? (
                  <div style={styles.detailCard}>
                    <p style={styles.detailLabel}>Relevant files</p>
                    {relevantFiles.slice(0, 3).map((item) => (
                      <p key={`file-${item}`} style={styles.detailItem}>
                        {item}
                      </p>
                    ))}
                  </div>
                ) : null}

                {blockers.length ? (
                  <div style={styles.detailCard}>
                    <p style={styles.detailLabel}>Current blockers</p>
                    {blockers.slice(0, 3).map((item) => (
                      <p key={`blocker-${item}`} style={styles.detailItem}>
                        {item}
                      </p>
                    ))}
                  </div>
                ) : null}

                {definitionOfDone.length ? (
                  <div style={styles.detailCard}>
                    <p style={styles.detailLabel}>Definition of done</p>
                    {definitionOfDone.slice(0, 2).map((item) => (
                      <p key={`done-${item}`} style={styles.detailItem}>
                        {item}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {showSettingsPage ? (
        <div style={styles.preferenceSection} data-reeva-surface="project-preferences">
          <div style={styles.preferenceHeader}>
            <div style={styles.summaryCopy}>
              <p style={styles.headline}>Project preferences</p>
              <p style={styles.body}>
                These defaults shape how reeva AI drafts prompts and judges assistant replies for this project.
              </p>
            </div>
            <div style={styles.preferenceHeaderActions}>
              {props.savingPreferences ? <p style={styles.savingLabel}>Saving…</p> : null}
              {!isEditingPreferences ? (
                <button type="button" style={styles.editButton} onClick={() => setIsEditingPreferences(true)}>
                  Edit
                </button>
              ) : (
                <div style={styles.preferenceEditActions}>
                  <button
                    type="button"
                    style={styles.cancelButton}
                    onClick={handleCancelPreferences}
                    disabled={props.savingPreferences}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    style={styles.updateButton}
                    onClick={() => void handleUpdatePreferences()}
                    disabled={props.savingPreferences}
                  >
                    Update
                  </button>
                </div>
              )}
            </div>
          </div>

          <PreferenceGroup
            label="Collaboration mode"
            helper="Set how cautious reeva AI should be before asking the coding assistant to act."
            value={preferenceDraft.collaborationMode}
            disabled={props.savingPreferences || !isEditingPreferences}
            options={[
              { value: "fast", label: "Fast", description: "Infer more and ask fewer questions." },
              { value: "careful", label: "Careful", description: "Balance speed with safer clarifications." },
              { value: "plan_first", label: "Plan first", description: "Push the assistant to plan before broad edits." }
            ]}
            onChange={(value) => setPreferenceDraft((current) => ({ ...current, collaborationMode: value }))}
          />

          <PreferenceGroup
            label="Proof preference"
            helper="Define what the assistant should show back before its work feels trustworthy."
            value={preferenceDraft.proofPreference}
            disabled={props.savingPreferences || !isEditingPreferences}
            options={[
              { value: "standard", label: "Standard", description: "Ask for normal validation and confirmation." },
              { value: "proof_required", label: "Proof required", description: "Require explicit proof before claiming success." },
              { value: "files_first", label: "Files first", description: "Ask for changed files first, then validation." }
            ]}
            onChange={(value) => setPreferenceDraft((current) => ({ ...current, proofPreference: value }))}
          />

          <PreferenceGroup
            label="Scope default"
            helper="Control whether reeva AI should assume the change must stay tightly scoped."
            value={preferenceDraft.scopePreference}
            disabled={props.savingPreferences || !isEditingPreferences}
            options={[
              { value: "narrow", label: "Narrow", description: "Prefer the smallest safe change by default." },
              { value: "balanced", label: "Balanced", description: "Allow a slightly broader change when clearly helpful." }
            ]}
            onChange={(value) => setPreferenceDraft((current) => ({ ...current, scopePreference: value }))}
          />

          <PreferenceGroup
            label="Explanation style"
            helper="Choose how the assistant should explain its understanding, scope, and proof."
            value={preferenceDraft.explanationStyle}
            disabled={props.savingPreferences || !isEditingPreferences}
            options={[
              { value: "plain_language", label: "Plain language", description: "Keep explanations easy for non-technical users." },
              { value: "technical", label: "Technical", description: "Allow more implementation-specific wording." }
            ]}
            onChange={(value) => setPreferenceDraft((current) => ({ ...current, explanationStyle: value }))}
          />
        </div>
        ) : null}

      </div>
      {confirmDeleteOpen ? (
        <div style={styles.confirmOverlay}>
          <div style={styles.confirmCard}>
            <p style={styles.confirmEyebrow}>Delete project context</p>
            <p style={styles.confirmTitle}>Remove the saved markdown brief and project memory?</p>
            <p style={styles.confirmBody}>
              This will clear the saved project context for this project. Your project preferences will stay, and you can import a new markdown brief later.
            </p>
            <div style={styles.confirmActions}>
              <button
                type="button"
                style={styles.confirmCancelButton}
                onClick={handleCloseDeleteConfirmation}
                disabled={props.deletingContext}
              >
                Cancel
              </button>
              <button
                type="button"
                style={styles.confirmDeleteButton}
                onClick={handleConfirmDelete}
                disabled={props.deletingContext}
              >
                {props.deletingContext ? "Deleting..." : "Delete context"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function PreferenceGroup<T extends string>(props: {
  label: string
  helper: string
  value: T
  disabled?: boolean
  options: Array<{ value: T; label: string; description: string }>
  onChange: (value: T) => void
}) {
  return (
    <div style={styles.preferenceGroup} data-reeva-surface="project-preference-group">
      <div style={styles.preferenceCopy}>
        <p style={styles.preferenceLabel}>{props.label}</p>
        <p style={styles.preferenceHelper}>{props.helper}</p>
      </div>
      <div style={styles.preferenceOptionGrid}>
        {props.options.map((option) => {
          const active = props.value === option.value
          return (
            <button
              key={option.value}
              type="button"
              style={styles.preferenceOption(active, Boolean(props.disabled))}
              onClick={() => props.onChange(option.value)}
              disabled={props.disabled}
            >
              <span style={styles.preferenceOptionTitle(active)}>{option.label}</span>
              <span style={styles.preferenceOptionDescription}>{option.description}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

const styles = {
  architectureConfirmationLayout: {
    display: "grid",
    gap: 16,
    padding: "6px 2px 2px"
  } as CSSProperties,
  architectureConfirmationEyebrow: {
    margin: "0 0 6px",
    color: "#2563eb",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.1em",
    textTransform: "uppercase"
  } as CSSProperties,
  architectureConfirmationTitle: {
    margin: 0,
    color: "#0f172a",
    fontSize: 20,
    fontWeight: 800,
    lineHeight: 1.25
  } as CSSProperties,
  architectureConfirmationBody: {
    margin: "8px 0 0",
    color: "#475569",
    fontSize: 13,
    lineHeight: 1.55
  } as CSSProperties,
  architectureConfirmationList: {
    margin: 0,
    padding: 14,
    border: "1px solid rgba(15,23,42,0.12)",
    borderRadius: 14,
    background: "#f8fafc",
    color: "#1e293b",
    fontFamily: "inherit",
    fontSize: 13,
    lineHeight: 1.55,
    whiteSpace: "pre-wrap"
  } as CSSProperties,
  architectureConfirmationTextarea: {
    width: "100%",
    minHeight: 240,
    resize: "vertical",
    boxSizing: "border-box",
    padding: 14,
    border: "1px solid rgba(37,99,235,0.3)",
    borderRadius: 14,
    background: "#fff",
    color: "#1e293b",
    fontFamily: "inherit",
    fontSize: 13,
    lineHeight: 1.55
  } as CSSProperties,
  architectureConfirmationHint: {
    margin: 0,
    color: "#64748b",
    fontSize: 12,
    lineHeight: 1.45
  } as CSSProperties,
  layout: {
    display: "grid",
    gap: 14
  } satisfies CSSProperties,
  contextHero: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 24,
    border: "1px solid rgba(7,102,254,0.2)",
    background: "linear-gradient(145deg, rgba(7,102,254,0.12), rgba(14,165,233,0.08) 42%, rgba(255,255,255,0.98))",
    boxShadow: "0 18px 44px rgba(15,23,42,0.1)"
  } satisfies CSSProperties,
  contextHeroGlow: {
    position: "absolute",
    width: 170,
    height: 170,
    right: -68,
    top: -72,
    borderRadius: 999,
    background: "radial-gradient(circle, rgba(7,102,254,0.28), rgba(7,102,254,0))",
    pointerEvents: "none"
  } satisfies CSSProperties,
  contextHeroContent: {
    position: "relative",
    display: "grid",
    gap: 14,
    padding: 16
  } satisfies CSSProperties,
  contextHeroTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  } satisfies CSSProperties,
  contextHeroMeta: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: 8
  } satisfies CSSProperties,
  contextMiniStat: {
    borderRadius: 999,
    background: "rgba(255,255,255,0.72)",
    border: "1px solid rgba(148,163,184,0.18)",
    color: "#475569",
    padding: "7px 10px",
    fontSize: 11,
    lineHeight: 1,
    fontWeight: 800
  } satisfies CSSProperties,
  heroTitle: {
    margin: 0,
    fontSize: 20,
    lineHeight: 1.15,
    letterSpacing: "-0.03em",
    color: "#0f172a",
    fontWeight: 900
  } satisfies CSSProperties,
  heroBody: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.55,
    color: "#334155",
    fontWeight: 600
  } satisfies CSSProperties,
  syncMessage: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.45,
    color: "#475569",
    fontWeight: 600
  } satisfies CSSProperties,
  contextSteps: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 8
  } satisfies CSSProperties,
  stepCard: {
    display: "grid",
    gap: 7,
    alignContent: "start",
    borderRadius: 16,
    border: "1px solid rgba(148,163,184,0.16)",
    background: "rgba(255,255,255,0.78)",
    padding: "10px 11px",
    minHeight: 72
  } satisfies CSSProperties,
  stepNumber: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 22,
    height: 22,
    borderRadius: 999,
    background: "#0766fe",
    color: "#ffffff",
    fontSize: 11,
    fontWeight: 900
  } satisfies CSSProperties,
  stepText: {
    fontSize: 12,
    lineHeight: 1.3,
    color: "#0f172a",
    fontWeight: 800
  } satisfies CSSProperties,
  primaryActionRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)",
    gap: 10
  } satisfies CSSProperties,
  destructiveActionRow: {
    display: "flex",
    justifyContent: "flex-start"
  } satisfies CSSProperties,
  confirmOverlay: {
    position: "fixed",
    inset: 0,
    display: "grid",
    placeItems: "center",
    padding: 20,
    background: "rgba(15,23,42,0.22)",
    backdropFilter: "blur(3px)",
    zIndex: 2147483646
  } satisfies CSSProperties,
  confirmCard: {
    width: "min(100%, 360px)",
    display: "grid",
    gap: 10,
    borderRadius: 22,
    border: "1px solid rgba(239,68,68,0.18)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(254,242,242,0.98))",
    boxShadow: "0 24px 60px rgba(15,23,42,0.18)",
    padding: 18
  } satisfies CSSProperties,
  confirmEyebrow: {
    margin: 0,
    fontSize: 11,
    lineHeight: 1.3,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#b91c1c",
    fontWeight: 900
  } satisfies CSSProperties,
  confirmTitle: {
    margin: 0,
    fontSize: 18,
    lineHeight: 1.2,
    color: "#0f172a",
    fontWeight: 900
  } satisfies CSSProperties,
  confirmBody: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.55,
    color: "#475569",
    fontWeight: 600
  } satisfies CSSProperties,
  confirmActions: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
    marginTop: 4
  } satisfies CSSProperties,
  confirmCancelButton: {
    border: "1px solid rgba(148,163,184,0.22)",
    borderRadius: 999,
    background: "#ffffff",
    color: "#475569",
    padding: "11px 14px",
    fontSize: 12,
    lineHeight: 1.2,
    fontWeight: 800,
    cursor: "pointer"
  } satisfies CSSProperties,
  confirmDeleteButton: {
    border: "1px solid rgba(239,68,68,0.18)",
    borderRadius: 999,
    background: "#dc2626",
    color: "#ffffff",
    padding: "11px 14px",
    fontSize: 12,
    lineHeight: 1.2,
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 10px 24px rgba(220,38,38,0.22)"
  } satisfies CSSProperties,
  connectedSummaryRow: {
    display: "grid",
    gap: 8
  } satisfies CSSProperties,
  connectedStatsRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8
  } satisfies CSSProperties,
  connectedSummaryChip: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    border: "1px solid rgba(148,163,184,0.18)",
    background: "rgba(255,255,255,0.84)",
    color: "#334155",
    padding: "8px 11px",
    fontSize: 12,
    lineHeight: 1.2,
    fontWeight: 700
  } satisfies CSSProperties,
  conflictReasonCard: {
    display: "grid",
    gap: 4,
    borderRadius: 18,
    border: "1px solid rgba(239,68,68,0.18)",
    background: "rgba(255,255,255,0.84)",
    padding: "12px 14px"
  } satisfies CSSProperties,
  conflictReasonLabel: {
    margin: 0,
    fontSize: 11,
    lineHeight: 1.3,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "#b91c1c",
    fontWeight: 900
  } satisfies CSSProperties,
  conflictReasonText: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.5,
    color: "#7f1d1d",
    fontWeight: 700
  } satisfies CSSProperties,
  summaryRow: {
    display: "grid",
    gap: 10
  } satisfies CSSProperties,
  summaryHub: {
    display: "grid",
    gap: 12,
    borderRadius: 18,
    border: "1px solid rgba(148,163,184,0.18)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,250,252,0.98))",
    padding: 14
  } satisfies CSSProperties,
  summaryHubHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12
  } satisfies CSSProperties,
  summaryCopy: {
    display: "grid",
    gap: 6
  } satisfies CSSProperties,
  warningStack: {
    display: "grid",
    gap: 10
  } satisfies CSSProperties,
  staleCard: {
    display: "grid",
    gap: 4,
    borderRadius: 16,
    border: "1px solid rgba(245,158,11,0.24)",
    background: "rgba(255,247,237,0.92)",
    padding: "12px 14px"
  } satisfies CSSProperties,
  conflictCard: {
    display: "grid",
    gap: 4,
    borderRadius: 16,
    border: "1px solid rgba(239,68,68,0.22)",
    background: "rgba(254,242,242,0.94)",
    padding: "12px 14px"
  } satisfies CSSProperties,
  warningLabel: {
    margin: 0,
    fontSize: 11,
    lineHeight: 1.3,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "#92400e",
    fontWeight: 800
  } satisfies CSSProperties,
  warningText: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: "#7c2d12",
    fontWeight: 600
  } satisfies CSSProperties,
  headline: {
    margin: 0,
    fontSize: 15,
    lineHeight: 1.45,
    color: "#0f172a",
    fontWeight: 700
  } satisfies CSSProperties,
  body: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.55,
    color: "#475569"
  } satisfies CSSProperties,
  snapshotBody: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.6,
    color: "#1e293b",
    fontWeight: 600
  } satisfies CSSProperties,
  inlineTextButton: {
    appearance: "none",
    border: "none",
    background: "transparent",
    padding: 0,
    margin: 0,
    justifySelf: "start",
    color: "#0766fe",
    fontSize: 12,
    lineHeight: 1.2,
    fontWeight: 800,
    cursor: "pointer"
  } satisfies CSSProperties,
  metaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
    gap: 10
  } satisfies CSSProperties,
  detailGrid: {
    display: "grid",
    gap: 10
  } satisfies CSSProperties,
  preferenceSection: {
    display: "grid",
    gap: 14,
    borderRadius: 18,
    border: "1px solid rgba(148,163,184,0.18)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.95), rgba(248,250,252,0.98))",
    padding: 14
  } satisfies CSSProperties,
  preferenceHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12
  } satisfies CSSProperties,
  preferenceHeaderActions: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8
  } satisfies CSSProperties,
  preferenceEditActions: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8
  } satisfies CSSProperties,
  metaCard: {
    borderRadius: 16,
    border: "1px solid rgba(148,163,184,0.18)",
    background: "rgba(248,250,252,0.9)",
    padding: "12px 14px",
    display: "grid",
    gap: 6
  } satisfies CSSProperties,
  metaLabel: {
    margin: 0,
    fontSize: 11,
    lineHeight: 1.3,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "#64748b",
    fontWeight: 800
  } satisfies CSSProperties,
  metaValue: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.45,
    color: "#0f172a",
    fontWeight: 700
  } satisfies CSSProperties,
  detailCard: {
    borderRadius: 16,
    border: "1px solid rgba(148,163,184,0.18)",
    background: "#ffffff",
    padding: "12px 14px",
    display: "grid",
    gap: 6
  } satisfies CSSProperties,
  detailLabel: {
    margin: 0,
    fontSize: 11,
    lineHeight: 1.3,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "#64748b",
    fontWeight: 800
  } satisfies CSSProperties,
  detailItem: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: "#0f172a"
  } satisfies CSSProperties,
  savingLabel: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.4,
    color: "#0766fe",
    fontWeight: 700
  } satisfies CSSProperties,
  editButton: {
    border: "1px solid rgba(148,163,184,0.22)",
    borderRadius: 999,
    background: "#ffffff",
    color: "#334155",
    padding: "10px 14px",
    fontSize: 12,
    lineHeight: 1.2,
    fontWeight: 800,
    cursor: "pointer"
  } satisfies CSSProperties,
  cancelButton: {
    border: "1px solid rgba(148,163,184,0.22)",
    borderRadius: 999,
    background: "#ffffff",
    color: "#475569",
    padding: "10px 14px",
    fontSize: 12,
    lineHeight: 1.2,
    fontWeight: 800,
    cursor: "pointer"
  } satisfies CSSProperties,
  updateButton: {
    border: "none",
    borderRadius: 999,
    background: "#0766fe",
    color: "#ffffff",
    padding: "10px 14px",
    fontSize: 12,
    lineHeight: 1.2,
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 12px 24px rgba(7,102,254,0.18)"
  } satisfies CSSProperties,
  preferenceGroup: {
    display: "grid",
    gap: 8
  } satisfies CSSProperties,
  preferenceCopy: {
    display: "grid",
    gap: 4
  } satisfies CSSProperties,
  preferenceLabel: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.4,
    color: "#0f172a",
    fontWeight: 800
  } satisfies CSSProperties,
  preferenceHelper: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.5,
    color: "#64748b"
  } satisfies CSSProperties,
  preferenceOptionGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: 8
  } satisfies CSSProperties,
  preferenceOption: (active: boolean, disabled: boolean) =>
    ({
      display: "grid",
      gap: 4,
      textAlign: "left",
      borderRadius: 16,
      border: active ? "1px solid rgba(7,102,254,0.28)" : "1px solid rgba(148,163,184,0.18)",
      background: active ? "rgba(7,102,254,0.08)" : "#ffffff",
      color: "#0f172a",
      padding: "12px 14px",
      cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.68 : 1
    }) satisfies CSSProperties,
  preferenceOptionTitle: (active: boolean) =>
    ({
      fontSize: 13,
      lineHeight: 1.3,
      fontWeight: 800,
      color: active ? "#0766fe" : "#0f172a"
    }) satisfies CSSProperties,
  preferenceOptionDescription: {
    fontSize: 12,
    lineHeight: 1.45,
    color: "#64748b"
  } satisfies CSSProperties,
  inlineInputRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 10
  } satisfies CSSProperties,
  textInput: {
    width: "100%",
    borderRadius: 14,
    border: "1px solid rgba(148,163,184,0.24)",
    padding: "11px 14px",
    fontSize: 13,
    lineHeight: 1.5,
    color: "#0f172a",
    background: "#ffffff"
  } satisfies CSSProperties,
  smallPrimaryButton: {
    border: "1px solid rgba(7,102,254,0.22)",
    borderRadius: 14,
    background: "#0766fe",
    color: "#ffffff",
    padding: "11px 14px",
    fontWeight: 800,
    cursor: "pointer",
    minWidth: 78
  } satisfies CSSProperties,
  suggestionRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8
  } satisfies CSSProperties,
  suggestionChip: (active: boolean, disabled: boolean) =>
    ({
      border: active ? "1px solid rgba(7,102,254,0.24)" : "1px solid rgba(148,163,184,0.22)",
      borderRadius: 999,
      background: active ? "rgba(7,102,254,0.08)" : "rgba(255,255,255,0.92)",
      color: active ? "#0766fe" : "#334155",
      padding: "9px 12px",
      fontWeight: 700,
      fontSize: 12,
      cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.68 : 1
    }) satisfies CSSProperties,
  phaseGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))",
    gap: 8
  } satisfies CSSProperties,
  phaseOption: (active: boolean, disabled: boolean) =>
    ({
      display: "grid",
      gap: 4,
      textAlign: "left",
      borderRadius: 16,
      border: active ? "1px solid rgba(7,102,254,0.28)" : "1px solid rgba(148,163,184,0.18)",
      background: active ? "rgba(7,102,254,0.08)" : "#ffffff",
      color: "#0f172a",
      padding: "12px 14px",
      cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.68 : 1
    }) satisfies CSSProperties,
  tagRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8
  } satisfies CSSProperties,
  selectedTag: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    border: "1px solid rgba(7,102,254,0.2)",
    borderRadius: 999,
    background: "rgba(7,102,254,0.08)",
    color: "#0766fe",
    padding: "9px 12px",
    fontSize: 12,
    fontWeight: 800,
    cursor: "pointer"
  } satisfies CSSProperties,
  tagRemove: {
    fontSize: 14,
    lineHeight: 1
  } satisfies CSSProperties,
  emptyState: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.5,
    color: "#64748b"
  } satisfies CSSProperties,
  actionRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10
  } satisfies CSSProperties,
  workflowSection: {
    display: "grid",
    gap: 14,
    borderRadius: 18,
    border: "1px solid rgba(96,165,250,0.24)",
    background: "linear-gradient(180deg, rgba(17,30,54,0.92), rgba(13,23,42,0.9))",
    padding: 16,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)"
  } satisfies CSSProperties,
  sectionHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12
  } satisfies CSSProperties,
  sectionTitle: {
    margin: 0,
    fontSize: 16,
    lineHeight: 1.3,
    color: "#f8fbff",
    fontWeight: 850
  } satisfies CSSProperties,
  sectionBody: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: "#cfe0ff",
    fontWeight: 650
  } satisfies CSSProperties,
  requestPreview: {
    maxHeight: 150,
    overflow: "auto",
    margin: 0,
    borderRadius: 14,
    border: "1px solid rgba(96,165,250,0.22)",
    background: "rgba(5,12,26,0.58)",
    color: "#b9d4ff",
    padding: "13px 14px",
    fontSize: 12,
    lineHeight: 1.55,
    whiteSpace: "pre-wrap",
    fontFamily:
      'ui-monospace, SFMono-Regular, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
  } satisfies CSSProperties,
  secondaryButton: {
    border: "1px solid rgba(7,102,254,0.2)",
    borderRadius: 999,
    background: "rgba(7,102,254,0.08)",
    color: "#0766fe",
    padding: "12px 18px",
    fontWeight: 800,
    cursor: "pointer"
  } satisfies CSSProperties,
  ghostButton: {
    border: "1px solid rgba(148,163,184,0.22)",
    borderRadius: 999,
    background: "rgba(255,255,255,0.9)",
    color: "#334155",
    padding: "12px 18px",
    fontWeight: 700,
    cursor: "pointer"
  } satisfies CSSProperties,
  editor: {
    display: "grid",
    gap: 10,
    borderRadius: 18,
    border: "1px solid rgba(7,102,254,0.14)",
    background: "linear-gradient(180deg, rgba(239,246,255,0.76), rgba(248,250,252,0.82))",
    padding: 14
  } satisfies CSSProperties,
  editorHint: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.55,
    color: "#1e3a8a",
    fontWeight: 600
  } satisfies CSSProperties,
  textarea: {
    width: "100%",
    minHeight: 180,
    resize: "vertical",
    borderRadius: 18,
    border: "1px solid rgba(96,165,250,0.26)",
    padding: "14px 16px",
    fontSize: 13,
    lineHeight: 1.6,
    color: "#dbeafe",
    background: "rgba(5,12,26,0.54)",
    fontFamily:
      'ui-monospace, SFMono-Regular, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
  } satisfies CSSProperties,
  primaryButton: {
    border: "1px solid rgba(7,102,254,0.22)",
    borderRadius: 999,
    background: "#0766fe",
    color: "#ffffff",
    padding: "12px 18px",
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 10px 24px rgba(7,102,254,0.24)"
  } satisfies CSSProperties,
  destructiveButton: {
    border: "1px solid rgba(239,68,68,0.2)",
    borderRadius: 999,
    background: "rgba(254,242,242,0.98)",
    color: "#b91c1c",
    padding: "10px 16px",
    fontWeight: 800,
    cursor: "pointer"
  } satisfies CSSProperties
}
