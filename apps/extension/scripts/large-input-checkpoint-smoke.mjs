import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "esbuild"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(scriptDir, "..")
const repoRoot = path.resolve(extensionRoot, "../..")

const prdPrompt = [
  "Implement this PRD one phase at a time.",
  "",
  "## Product Overview",
  "Water Intake MVP for busy professionals.",
  "",
  "## Problem",
  "Busy professionals forget to drink water during focused work.",
  "",
  "## Target User",
  "Busy professionals aged 25-40 who work long hours at desks.",
  "",
  "## Primary Goal",
  "Establish consistent daily hydration habits.",
  "",
  "## Scope",
  "Single-user mobile app with manual logging, daily goals, streak counting, and basic reminders.",
  "",
  "## Core Requirements",
  "- Log water intake with preset cup sizes in two taps",
  "- View daily progress ring against personalized goal",
  "- Receive smart reminders based on last log time",
  "",
  "## Success Criteria",
  "- User completes first log in under 10 seconds",
  "- Progress ring updates immediately after each log",
  "",
  "## Implementation Phases",
  "Phase 1 — Core Logging Loop",
  "Goal: Validate that users will manually log water when reminded.",
  "Deliverables:",
  "- Tap-based intake logger with 250ml/500ml presets",
  "- Daily progress ring with goal setter",
  "Acceptance Criteria:",
  "- User completes first log in under 10 seconds",
  "- Progress ring updates immediately after each log",
  "",
  "Phase 2 — Smart Reminders",
  "Goal: Drive habit formation through contextual push notifications.",
  "Deliverables:",
  "- Time-based reminder with snooze option",
  "- Streak counter with visual flame indicator",
  "Acceptance Criteria:",
  "- Reminder fires within 15 min of scheduled time",
  "- Streak increments after midnight with goal met",
  "",
  "## Assumptions / Risks",
  "- Users tolerate daily push notifications",
  "",
  "Implementation handoff:",
  "- Implement Phase 1 only in the first assistant response.",
  "- Do not start Phase 2 until Phase 1 is finished and validated against its acceptance criteria.",
  "- After finishing Phase 1, explain what changed and show concrete validation proof.",
  "- Wait for my confirmation before starting the next phase."
].join("\n")

function preprocessResponse(responseText) {
  return {
    response_text: responseText,
    response_length: responseText.length,
    first_excerpt: responseText,
    last_excerpt: responseText,
    key_paragraphs: [responseText],
    has_code_blocks: false,
    mentioned_files: [],
    change_claims: [],
    validation_signals: [],
    certainty_signals: [],
    uncertainty_signals: [],
    success_signals: [],
    failure_signals: []
  }
}

async function main() {
  const outdir = await mkdtemp(path.join(os.tmpdir(), "large-input-checkpoint-smoke-"))
  try {
    await build({
      entryPoints: [
        path.resolve(repoRoot, "packages/shared/src/analysis-input.ts"),
        path.resolve(extensionRoot, "lib/review/services/review-analysis.ts"),
        path.resolve(extensionRoot, "lib/review/deep-analysis-v2-view-model.ts"),
        path.resolve(extensionRoot, "lib/review/next-move-telemetry.ts")
      ],
      outdir,
      entryNames: "[name]",
      bundle: true,
      format: "esm",
      platform: "node"
    })

    const analysisInputMod = await import(pathToFileURL(path.join(outdir, "analysis-input.js")).href)
    const { assessAnalysisInput } = analysisInputMod
    const reviewAnalysisMod = await import(pathToFileURL(path.join(outdir, "review-analysis.js")).href)
    const { createReviewAnalysisRunner, getReviewAnalysisContext } = reviewAnalysisMod
    const viewModelMod = await import(pathToFileURL(path.join(outdir, "deep-analysis-v2-view-model.js")).href)
    const { mapDeepAnalysisV2ToReviewViewModel } = viewModelMod
    const telemetryMod = await import(pathToFileURL(path.join(outdir, "next-move-telemetry.js")).href)
    const { buildNextMoveTelemetryEvent } = telemetryMod

    const assessment = assessAnalysisInput(prdPrompt)
    assert.equal(assessment.analysisInputSize, "large")
    assert.equal(assessment.analysisMode, "large_input_checkpoint")
    assert.ok(assessment.signals.includes("prd_sections"))
    assert.ok(assessment.signals.includes("multiple_implementation_phases"))
    assert.ok(assessment.signals.includes("phase_handoff"))

    const responseText = [
      "Phase 1 — Core Logging Loop completed.",
      "I implemented Phase 1 only and did not start Smart Reminders.",
      "Validation proof: first log completed in under 10 seconds and progress ring updates immediately.",
      "Ready to start Phase 2 after your confirmation."
    ].join(" ")
    const target = {
      attempt: {
        attempt_id: "attempt-large-prd-beta-gate",
        platform: "chatgpt",
        raw_prompt: prdPrompt,
        optimized_prompt: "",
        analysis_input_size: assessment.analysisInputSize,
        analysis_mode: assessment.analysisMode,
        analysis_input_signals: assessment.signals,
        intent: {
          task_type: "build",
          goal: "Implement the PRD one phase at a time.",
          constraints: [],
          acceptance_criteria: []
        },
        status: "submitted",
        created_at: "2026-05-12T10:00:00.000Z",
        submitted_at: "2026-05-12T10:00:00.000Z",
        response_text: null,
        response_message_id: null,
        analysis_result: null,
        token_usage_total: 0,
        stage_cache: {}
      },
      taskType: "creation",
      responseText,
      responseIdentity: "assistant-large-prd-beta-gate",
      threadIdentity: "thread-large-prd-beta-gate",
      normalizedResponseText: responseText.toLowerCase()
    }

    let providerCalls = 0
    let legacyCalls = 0
    let attached = null
    const runner = createReviewAnalysisRunner({
      analyzeAfterAttempt: async () => {
        legacyCalls += 1
        throw new Error("legacy analysis should not run for large input checkpoint")
      },
      attachAnalysisResult: async (attemptId, attachedResponseText, analysis) => {
        attached = { attemptId, responseText: attachedResponseText, analysis }
      },
      preprocessResponse,
      getProjectMemoryContext: () => ({
        projectContext: "",
        currentState: "",
        importedContext: null,
        structuredMemory: null,
        settings: null
      }),
      collectChangedFilesSummary: () => [],
      collectVisibleErrorSummary: () => "",
      analyzeDeepAnalysisV2: async () => {
        providerCalls += 1
        throw new Error("provider should not be called for large input checkpoint")
      }
    })

    const result = await runner({
      mode: "deep",
      quickBaseline: null,
      target
    })
    const context = getReviewAnalysisContext(result)
    assert.equal(providerCalls, 0)
    assert.equal(legacyCalls, 0)
    assert.equal(attached?.attemptId, target.attempt.attempt_id)
    assert.equal(result.status, "PARTIAL")
    assert.equal(context?.deepAnalysisV2Applied, true)
    assert.equal(context?.deepAnalysisV2?.analysisMode, "large_input_checkpoint")
    assert.equal(context?.deepAnalysisV2?.providerMetadata.provider, "none")
    assert.equal(context?.deepAnalysisV2?.overallStatus, "needs_confirmation")
    assert.match(context?.deepAnalysisV2?.generatedPrompt ?? "", /Current phase: Phase 1 . Core Logging Loop/)
    assert.match(context?.deepAnalysisV2?.generatedPrompt ?? "", /Next unstarted phase from the PRD: Phase 2 . Smart Reminders/)
    assert.match(context?.deepAnalysisV2?.generatedPrompt ?? "", /Do not implement the next phase yet/)

    const viewModel = mapDeepAnalysisV2ToReviewViewModel({
      analysis: context.deepAnalysisV2
    })
    assert.equal(viewModel.nextMoveInterpreterNote, "Deep Analysis v2 · large input checkpoint")
    assert.equal(viewModel.nextMoveDecision?.recommendation.primaryCtaLabel, "Confirm requirements")
    assert.match(viewModel.prompt, /Validation proof/)

    const telemetry = buildNextMoveTelemetryEvent({
      eventType: "decision_shown",
      target,
      result,
      reviewContract: null,
      viewModel,
      mode: "deep"
    })
    assert.equal(telemetry.deepAnalysisV2Decision?.analysisMode, "large_input_checkpoint")
    assert.equal(telemetry.deepAnalysisV2Decision?.provider, "none")
    assert.equal(telemetry.deepAnalysisV2Decision?.overallStatus, "needs_confirmation")
    assert.equal(telemetry.deepAnalysisV2Decision?.applied, true)
    assert.match(telemetry.deepAnalysisV2Decision?.generatedPrompt ?? "", /Next step details/)

    console.log("large-input-checkpoint-smoke: ok")
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
