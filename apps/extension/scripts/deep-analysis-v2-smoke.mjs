import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "esbuild"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(scriptDir, "..")

async function main() {
  const outdir = await mkdtemp(path.join(os.tmpdir(), "deep-analysis-v2-smoke-"))
  try {
    const apiClientSource = readFileSync(path.resolve(extensionRoot, "lib/api.ts"), "utf8")
    const backgroundSource = readFileSync(path.resolve(extensionRoot, "background.ts"), "utf8")
    const contentScriptSource = readFileSync(path.resolve(extensionRoot, "contents/replit-agent.tsx"), "utf8")
    const optimizerShellSource = readFileSync(path.resolve(extensionRoot, "components/OptimizerShell.tsx"), "utf8")
    assert.match(apiClientSource, /DEEP_ANALYSIS_V2_CLIENT_TIMEOUT_MS/)
    assert.match(backgroundSource, /message\.path === "\/api\/review\/deep-analysis-v2"[\s\S]*DEEP_ANALYSIS_V2_CLIENT_TIMEOUT_MS/)
    assert.match(backgroundSource, /state: "idle" \| "loading" \| "attention"/)
    assert.match(backgroundSource, /action-icon-\$\{kind\}-pulse-\$\{frame\}-\$\{size\}\.png/)
    assert.match(backgroundSource, /setActionBadge\(kind === "onboarding" \? "\+" : "✓"/)
    assert.match(contentScriptSource, /setActionIconLoading\(actionIconToken,\s*true\)[\s\S]*prewarm\("deep"\)[\s\S]*setActionIconLoading\(actionIconToken,\s*false\)/)
    assert.match(contentScriptSource, /triggerActionIconAttention\(\{\s*kind: "review"/)
    assert.match(contentScriptSource, /reviewButtonAttentionKind=\{reviewButtonAttentionKind\}/)
    assert.match(contentScriptSource, /isNewProjectEntryLocation/)
    assert.match(contentScriptSource, /normalizedPath === "\/" \|\| normalizedPath === "\/~"/)
    assert.doesNotMatch(
      contentScriptSource,
      /maybeTriggerOnboardingAttention[\s\S]{0,220}supportsProjectWorkflowSurface/,
      "new-project action-icon attention must be driven by the URL entry point, not prompt-page detection"
    )
    assert.match(contentScriptSource, /clearActionIconAttention\(\)/)
    assert.match(contentScriptSource, /isDeepAnalysisPrewarming=\{isDeepAnalysisPrewarming\}/)
    assert.doesNotMatch(
      contentScriptSource,
      /function maybeScheduleReviewSignalRefresh[\s\S]*?if \(!BACKGROUND_QUICK_REVIEW_ENABLED\)[\s\S]*?return[\s\S]*?scheduleReviewSignalRefresh\(reason\)/,
      "answer-settled deep-analysis prewarm must not be blocked by the quick-review feature flag"
    )
    assert.match(
      contentScriptSource,
      /handleSubmitPostTrackerBugFixPrompt[\s\S]*copyPromptForManualHandoff\(prompt\.trim\(\)/,
      "bug prompt handoff uses the copy-only flow"
    )
    assert.match(optimizerShellSource, /props\.isDeepAnalysisPrewarming[\s\S]*reviewDeepAnalysisSpin/)
    assert.match(optimizerShellSource, /reviewBadgeAttentionPulse/)
    assert.match(optimizerShellSource, /reviewButtonAttentionKind/)

    await build({
      entryPoints: [
        path.resolve(extensionRoot, "lib/review/deep-analysis-v2-contract.ts"),
        path.resolve(extensionRoot, "lib/review/deep-analysis-v2-decision-adapter.ts"),
        path.resolve(extensionRoot, "lib/review/deep-analysis-v2-view-model.ts"),
        path.resolve(extensionRoot, "lib/review/deep-analysis-v2-result-adapter.ts"),
        path.resolve(extensionRoot, "lib/review/deep-analysis-v2-rollout.ts"),
        path.resolve(extensionRoot, "lib/review/next-move-telemetry.ts"),
        path.resolve(extensionRoot, "lib/review/services/review-analysis.ts"),
        path.resolve(extensionRoot, "lib/review/orchestrator/review-popup-orchestrator.ts")
      ],
      outdir,
      entryNames: "[name]",
      bundle: true,
      format: "esm",
      platform: "node"
    })

    const contractMod = await import(pathToFileURL(path.join(outdir, "deep-analysis-v2-contract.js")).href)
    const {
      DEEP_ANALYSIS_V2_VERSION,
      DeepAnalysisV2ResultSchema,
      parseDeepAnalysisV2Result
    } = contractMod
    const viewModelMod = await import(pathToFileURL(path.join(outdir, "deep-analysis-v2-view-model.js")).href)
    const { mapDeepAnalysisV2ToReviewViewModel } = viewModelMod
    const adapterMod = await import(pathToFileURL(path.join(outdir, "deep-analysis-v2-result-adapter.js")).href)
    const { mapDeepAnalysisV2ToAfterAnalysisResult } = adapterMod
    const rolloutMod = await import(pathToFileURL(path.join(outdir, "deep-analysis-v2-rollout.js")).href)
    const {
      normalizeDeepAnalysisV2RolloutMode,
      shouldApplyDeepAnalysisV2,
      shouldRunDeepAnalysisV2
    } = rolloutMod
    const runnerMod = await import(pathToFileURL(path.join(outdir, "review-analysis.js")).href)
    const { createReviewAnalysisRunner, getReviewAnalysisContext } = runnerMod
    const orchestratorMod = await import(pathToFileURL(path.join(outdir, "review-popup-orchestrator.js")).href)
    const { createReviewPopupOrchestrator } = orchestratorMod

    const passResult = parseDeepAnalysisV2Result({
      overallStatus: "pass",
      requirements: [
        { id: "phase_1_ui", text: "Create the booking form UI only." },
        { id: "next_step", text: "Tell me the next phase." }
      ],
      requirementMatches: [
        {
          requirementId: "phase_1_ui",
          requirementText: "Create the booking form UI only.",
          status: "pass",
          evidence: ["Created booking form UI with fields."]
        },
        {
          requirementId: "next_step",
          requirementText: "Tell me the next phase.",
          status: "pass",
          evidence: ["Next phase: connect form to backend."]
        }
      ],
      assistantSuggestedNextMove: "connect form to backend",
      recommendedNextMove: "Continue with validation before backend.",
      nextStepSource: "assistant_suggestion",
      nextStepRequirements: ["Add required field validation"],
      blockedScope: ["Do not connect backend yet"],
      promptIntent: "implement_next_step",
      generatedPrompt: [
        "Please implement the best next step now:",
        "- Add required field validation",
        "",
        "After you finish, confirm which requirements were completed and suggest the next step."
      ].join("\n"),
      confidence: "high",
      userExplanation: "The answer matches the prompt and the safer next move is validation.",
      providerMetadata: {
        provider: "kimi",
        latencyMs: 4200
      }
    })

    assert.equal(passResult.version, DEEP_ANALYSIS_V2_VERSION)
    assert.equal(passResult.providerMetadata.timedOut, false)
    assert.equal(passResult.providerMetadata.usedFallback, false)
    assert.equal(normalizeDeepAnalysisV2RolloutMode("off"), "off")
    assert.equal(normalizeDeepAnalysisV2RolloutMode("shadow"), "shadow")
    assert.equal(normalizeDeepAnalysisV2RolloutMode("on"), "on")
    assert.equal(normalizeDeepAnalysisV2RolloutMode("surprise"), "on")
    assert.equal(shouldRunDeepAnalysisV2("shadow"), true)
    assert.equal(shouldApplyDeepAnalysisV2("shadow"), false)

    const passViewModel = mapDeepAnalysisV2ToReviewViewModel({
      analysis: passResult,
      onCopyPrompt: () => {}
    })
    assert.equal(passViewModel.statusBadge.label, "Ready for testing")
    assert.equal(passViewModel.statusBadge.tone, "success")
    assert.equal(passViewModel.requirementMatchSummary.status, "pass")
    assert.equal(passViewModel.requirementMatchSummary.confirmedCount, 2)
    assert.equal(passViewModel.requirementMatchSummary.missingCount, 0)
    assert.equal(passViewModel.nextMoveDecision.status, "ready_for_next_phase")
    assert.equal(passViewModel.nextMoveDecision.recommendation.kind, "start_next_phase")
    assert.equal(passViewModel.readyForTesting, true)
    assert.equal(passViewModel.promptActions.length, 0)
    assert.equal(passViewModel.prompt, "")
    assert.deepEqual(passViewModel.missingItems, [])
    assert.equal(passViewModel.deepAnalysisV2Trace.providerName, "kimi")
    assert.equal(passViewModel.deepAnalysisV2Trace.timedOut, false)
    assert.equal(passViewModel.deepAnalysisV2Trace.usedFallback, false)

    const validationCarryoverResult = parseDeepAnalysisV2Result({
      ...passResult,
      ignoredExternalValidation: ["Validation proof: 5 student testers complete 3-day logging trial without crashes"],
      phaseAdvanceBasis: "all_non_external_requirements_passed"
    })
    const validationCarryoverViewModel = mapDeepAnalysisV2ToReviewViewModel({
      analysis: validationCarryoverResult,
      onCopyPrompt: () => {}
    })
    assert.equal(validationCarryoverViewModel.statusBadge.label, "Ready for testing")
    assert.equal(validationCarryoverViewModel.requirementMatchSummary.status, "pass")
    assert.equal(validationCarryoverViewModel.requirementMatchSummary.missingCount, 0)
    assert.equal(validationCarryoverViewModel.nextMoveDecision.recommendation.title, "Ready for testing")

    const externalValidationOnlyResult = parseDeepAnalysisV2Result({
      ...passResult,
      assistantSuggestedNextMove: "real-device testing",
      recommendedNextMove: "Use the generated next prompt.",
      nextStepRequirements: ["Real-device testing"],
      ignoredExternalValidation: [
        "Real-device testing (offline mode, accent transcription quality, app restart persistence, low-end device performance)"
      ],
      actionableMissingItems: [],
      phaseAdvanceBasis: "all_non_external_requirements_passed",
      generatedPrompt: [
        "Please implement the best next step now:",
        "- Real-device testing",
        "",
        "After you finish, confirm which requirements were completed and suggest the next step."
      ].join("\n")
    })
    const externalValidationOnlyViewModel = mapDeepAnalysisV2ToReviewViewModel({
      analysis: externalValidationOnlyResult,
      onCopyPrompt: () => {}
    })
    assert.equal(externalValidationOnlyViewModel.readyForTesting, true)
    assert.equal(externalValidationOnlyViewModel.statusBadge.label, "Ready for testing")
    assert.equal(externalValidationOnlyViewModel.recommendedAction, "Confirm whether testing is complete, then choose the next move.")
    assert.equal(externalValidationOnlyViewModel.nextMoveDecision.assistantPrompt.mode, "informational_only")
    assert.equal(externalValidationOnlyViewModel.promptActions.length, 0)

    const genericPassResult = parseDeepAnalysisV2Result({
      ...passResult,
      requirements: [{ id: "submitted_prompt_requirements", text: "Match the submitted prompt requirements." }],
      requirementMatches: [
        {
          requirementId: "submitted_prompt_requirements",
          requirementText: "Match the submitted prompt requirements.",
          status: "unclear",
          evidence: [],
          note: ""
        }
      ],
      confidence: "low",
      phaseAdvanceBasis: "phase_completion_claimed_with_carryover"
    })
    const genericPassViewModel = mapDeepAnalysisV2ToReviewViewModel({
      analysis: genericPassResult,
      onCopyPrompt: () => {}
    })
    assert.equal(genericPassViewModel.requirementMatchSummary.status, "pass")
    assert.equal(genericPassViewModel.requirementMatchSummary.missingCount, 0)
    assert.deepEqual(genericPassViewModel.missingItems, [])
    assert.deepEqual(genericPassViewModel.checklistRows, [])

    const adaptedPassResult = mapDeepAnalysisV2ToAfterAnalysisResult({
      analysis: passResult,
      responseText: "Created booking form UI with fields. Phase 1 complete."
    })
    assert.equal(adaptedPassResult.status, "SUCCESS")
    assert.equal(adaptedPassResult.next_prompt_output.next_prompt, passResult.generatedPrompt)
    assert.equal(adaptedPassResult.acceptance_checklist[0].status, "met")

    const missingResult = parseDeepAnalysisV2Result({
      overallStatus: "needs_confirmation",
      requirements: [{ id: "completion", text: "Confirm Phase 1 is complete." }],
      requirementMatches: [
        {
          requirementId: "completion",
          requirementText: "Confirm Phase 1 is complete.",
          status: "missing",
          evidence: [],
          note: "The answer described work but did not confirm completion."
        }
      ],
      assistantSuggestedNextMove: null,
      recommendedNextMove: "Ask the assistant to confirm the missing requirement before continuing.",
      generatedPrompt: [
        "Before we move forward, confirm these requirements from my last prompt:",
        "",
        "- Confirm Phase 1 is complete.",
        "",
        "After confirming, suggest what the next step should be."
      ].join("\n"),
      confidence: "medium",
      userExplanation: "The answer still needs one explicit confirmation.",
      providerMetadata: {
        provider: "fallback",
        usedFallback: true
      }
    })
    const missingViewModel = mapDeepAnalysisV2ToReviewViewModel({ analysis: missingResult })
    assert.equal(missingViewModel.statusBadge.label, "Needs confirmation")
    assert.equal(missingViewModel.requirementMatchSummary.status, "needs_confirmation")
    assert.equal(missingViewModel.requirementMatchSummary.missingCount, 1)
    assert.equal(missingViewModel.nextMoveDecision.status, "incomplete")
    assert.equal(missingViewModel.nextMoveDecision.recommendation.kind, "finish_missing_requirements")
    assert.deepEqual(missingViewModel.missingItems, ["Confirm Phase 1 is complete."])
    assert.equal(missingViewModel.promptActions.length, 0)

    assert.throws(() => DeepAnalysisV2ResultSchema.parse({
      overallStatus: "pass",
      recommendedNextMove: "Continue.",
      generatedPrompt: "",
      confidence: "certain",
      userExplanation: "Bad confidence enum.",
      providerMetadata: { provider: "kimi" }
    }))

    const reviewTarget = {
      attempt: {
        attempt_id: "attempt-v2",
        platform: "chatgpt",
        raw_prompt: "Act like Replit’s coding agent. Phase 1 goal: create the booking form UI only.",
        optimized_prompt: "Act like Replit’s coding agent. Phase 1 goal: create the booking form UI only.",
        intent: {
          task_type: "build",
          goal: "Create booking form UI only.",
          constraints: [],
          acceptance_criteria: []
        },
        status: "submitted",
        created_at: "2026-05-05T10:00:00.000Z",
        submitted_at: "2026-05-05T10:00:00.000Z",
        response_text: null,
        response_message_id: null,
        analysis_result: null,
        token_usage_total: 0,
        stage_cache: {}
      },
      taskType: "creation",
      responseText: "Created booking form UI with fields. Phase 1 complete. Next phase: backend.",
      responseIdentity: "assistant-v2",
      threadIdentity: "thread-v2",
      normalizedResponseText: "created booking form ui with fields"
    }
    let legacyAnalysisCalled = false
    let v2Calls = 0
    let attached = null
    const runner = createReviewAnalysisRunner({
      analyzeAfterAttempt: async () => {
        legacyAnalysisCalled = true
        throw new Error("legacy path should not run when v2 succeeds")
      },
      attachAnalysisResult: async (attemptId, responseText, analysis) => {
        attached = { attemptId, responseText, analysis }
      },
      preprocessResponse: (responseText) => ({
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
      }),
      getProjectMemoryContext: () => ({
        projectContext: "Booking app built phase by phase.",
        currentState: "Phase 1 UI is being reviewed.",
        importedContext: null,
        structuredMemory: null,
        settings: null
      }),
      collectChangedFilesSummary: () => [],
      collectVisibleErrorSummary: () => "",
      analyzeDeepAnalysisV2: async (request) => {
        v2Calls += 1
        assert.match(request.promptText, /booking form UI/)
        assert.match(request.currentState, /Phase 1/)
        return passResult
      }
    })
    const runnerResult = await runner({
      mode: "deep",
      quickBaseline: null,
      target: reviewTarget
    })
    const runnerContext = getReviewAnalysisContext(runnerResult)
    assert.equal(legacyAnalysisCalled, false)
    assert.equal(attached?.attemptId, "attempt-v2")
    assert.equal(runnerResult.status, "SUCCESS")
    assert.equal(runnerContext.deepAnalysisV2.assistantSuggestedNextMove, "connect form to backend")
    assert.equal(runnerContext.deepAnalysisV2.submittedPromptLength, reviewTarget.attempt.optimized_prompt.length)
    assert.equal(runnerContext.deepAnalysisV2.assistantAnswerLength, reviewTarget.responseText.length)

    const contradictedMissingInputResult = parseDeepAnalysisV2Result({
      ...passResult,
      overallStatus: "risky",
      confidence: "low",
      userExplanation: "No assistant answer was provided for evaluation.",
      recommendedNextMove: "No assistant answer was provided for evaluation.",
      generatedPrompt: "Please provide the original user prompt and the assistant answer.",
      requirementMatches: [
        {
          requirementId: "missing_input",
          requirementText: "No assistant answer was provided for evaluation.",
          status: "unclear",
          evidence: [],
          note: "No assistant answer was provided for evaluation."
        }
      ]
    })
    let contradictionLegacyCalled = false
    const contradictionRunner = createReviewAnalysisRunner({
      analyzeAfterAttempt: async () => {
        contradictionLegacyCalled = true
        throw new Error("legacy path should not run when v2 returns a guarded result")
      },
      attachAnalysisResult: async () => {},
      preprocessResponse: (responseText) => ({
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
      }),
      getProjectMemoryContext: () => ({
        projectContext: "",
        currentState: "",
        importedContext: null,
        structuredMemory: null,
        settings: null
      }),
      collectChangedFilesSummary: () => [],
      collectVisibleErrorSummary: () => "",
      analyzeDeepAnalysisV2: async () => contradictedMissingInputResult
    })
    const contradictionResult = await contradictionRunner({
      mode: "deep",
      quickBaseline: null,
      target: reviewTarget
    })
    const contradictionContext = getReviewAnalysisContext(contradictionResult)
    assert.equal(contradictionLegacyCalled, false)
    assert.equal(contradictionResult.status, "UNVERIFIED")
    assert.equal(contradictionContext.deepAnalysisV2.overallStatus, "unavailable")
    assert.equal(contradictionContext.deepAnalysisV2.generatedPrompt, "")
    assert.equal(contradictionContext.deepAnalysisV2.assistantAnswerLength, reviewTarget.responseText.length)
    assert.match(
      contradictionContext.deepAnalysisV2.providerMetadata.failureMessage,
      /provider_missing_input_contradicted_by_local_capture/
    )

    let recoveryCallCount = 0
    const recoveryRunner = createReviewAnalysisRunner({
      analyzeAfterAttempt: async () => {
        throw new Error("legacy path should not run when missing-input recovery succeeds")
      },
      attachAnalysisResult: async () => {},
      preprocessResponse: (responseText) => ({
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
      }),
      getProjectMemoryContext: () => ({
        projectContext: "",
        currentState: "",
        importedContext: null,
        structuredMemory: null,
        settings: null
      }),
      collectChangedFilesSummary: () => [],
      collectVisibleErrorSummary: () => "",
      analyzeDeepAnalysisV2: async (request) => {
        recoveryCallCount += 1
        if (recoveryCallCount === 1) {
          assert.equal(request.analysisModeHint, "standard")
          return contradictedMissingInputResult
        }
        assert.equal(request.analysisModeHint, "missing_input_recovery")
        return passResult
      }
    })
    const recoveryResult = await recoveryRunner({
      mode: "deep",
      quickBaseline: null,
      target: reviewTarget
    })
    const recoveryContext = getReviewAnalysisContext(recoveryResult)
    assert.equal(recoveryCallCount, 2)
    assert.equal(recoveryResult.status, "SUCCESS")
    assert.equal(recoveryContext.deepAnalysisV2.overallStatus, "pass")
    assert.equal(recoveryContext.deepAnalysisV2.generatedPrompt, passResult.generatedPrompt)

    const schemaOnlyContradictedResult = parseDeepAnalysisV2Result({
      ...passResult,
      overallStatus: "risky",
      confidence: "low",
      promptIntent: "confirm_missing_requirements",
      userExplanation:
        "No user prompt was actually submitted for comparison - only the schema/rules JSON was provided without any assistant answer to evaluate",
      recommendedNextMove:
        "No user prompt was actually submitted for comparison - only the schema/rules JSON was provided without any assistant answer to evaluate",
      generatedPrompt:
        "You have provided the evaluation schema and rules, but I need the actual content to compare: the original user prompt and the assistant answer.",
      requirementMatches: [
        {
          requirementId: "missing_prompt",
          requirementText:
            "No user prompt was actually submitted for comparison - only the schema/rules JSON was provided without any assistant answer to evaluate",
          status: "unclear",
          evidence: [],
          note:
            "Cannot evaluate checklist items without input.checklistItems or actual assistant response content."
        }
      ]
    })
    const schemaOnlyRunner = createReviewAnalysisRunner({
      analyzeAfterAttempt: async () => {
        throw new Error("legacy path should not run when schema-only contradiction is guarded")
      },
      attachAnalysisResult: async () => {},
      preprocessResponse: (responseText) => ({
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
      }),
      getProjectMemoryContext: () => ({
        projectContext: "",
        currentState: "",
        importedContext: null,
        structuredMemory: null,
        settings: null
      }),
      collectChangedFilesSummary: () => [],
      collectVisibleErrorSummary: () => "",
      analyzeDeepAnalysisV2: async () => schemaOnlyContradictedResult
    })
    const schemaOnlyResult = await schemaOnlyRunner({
      mode: "deep",
      quickBaseline: null,
      target: reviewTarget
    })
    const schemaOnlyContext = getReviewAnalysisContext(schemaOnlyResult)
    assert.equal(schemaOnlyResult.status, "UNVERIFIED")
    assert.equal(schemaOnlyContext.deepAnalysisV2.overallStatus, "unavailable")
    assert.deepEqual(schemaOnlyContext.deepAnalysisV2.requirementMatches, [])
    assert.equal(schemaOnlyContext.deepAnalysisV2.generatedPrompt, "")
    assert.match(
      schemaOnlyContext.deepAnalysisV2.providerMetadata.failureMessage,
      /provider_missing_input_contradicted_by_local_capture/
    )

    let largeInputProviderCalls = 0
    let largeInputLegacyCalls = 0
    let largeInputAttached = null
    const largeInputRunner = createReviewAnalysisRunner({
      analyzeAfterAttempt: async () => {
        largeInputLegacyCalls += 1
        throw new Error("legacy path should not run for large input checkpoint")
      },
      attachAnalysisResult: async (attemptId, responseText, analysis) => {
        largeInputAttached = { attemptId, responseText, analysis }
      },
      preprocessResponse: (responseText) => ({
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
      }),
      getProjectMemoryContext: () => ({
        projectContext: "Large PRD implementation is being handled one phase at a time.",
        currentState: "Phase 1 was answered and needs checkpoint confirmation.",
        importedContext: null,
        structuredMemory: null,
        settings: null
      }),
      collectChangedFilesSummary: () => [],
      collectVisibleErrorSummary: () => "",
      analyzeDeepAnalysisV2: async () => {
        largeInputProviderCalls += 1
        throw new Error("provider should not be called for large input checkpoint")
      }
    })
    const largeInputResult = await largeInputRunner({
      mode: "deep",
      quickBaseline: null,
      target: {
        ...reviewTarget,
        attempt: {
          ...reviewTarget.attempt,
          attempt_id: "attempt-large-input",
          raw_prompt: [
            "Implement this PRD one phase at a time.",
            "Product Overview: Water intake app.",
            "## Implementation Phases",
            "Phase 1 — Core Logging Loop",
            "Goal: Validate that users will manually log water when reminded.",
            "Deliverables:",
            "- Installable APK/IPA with logging screen",
            "- In-app onboarding flow for goal setup",
            "Acceptance Criteria:",
            "- User completes first log in under 10 seconds",
            "Phase 2 — Smart Reminders",
            "Goal: Drive habit formation through contextual push notifications.",
            "Deliverables:",
            "- Push notification service with snooze handling",
            "- Streak detail screen with calendar view",
            "Acceptance Criteria:",
            "- Reminder fires within 15 min of scheduled time",
            "Acceptance criteria: User completes first log in under 10 seconds.",
            "Validation proof expected: 5/5 test users log 3+ times without prompting.",
            "Do not start Phase 2 until Phase 1 is finished and validated."
          ].join("\n"),
          optimized_prompt: "",
          analysis_input_size: "large",
          analysis_mode: "large_input_checkpoint",
          analysis_input_signals: [
            "prd_sections",
            "multiple_implementation_phases",
            "acceptance_criteria",
            "validation_proof",
            "phase_handoff"
          ]
        },
        responseText: "Phase 1 completed. Ready for Phase 2 after your confirmation.",
        responseIdentity: "assistant-large-input",
        threadIdentity: "thread-large-input"
      }
    })
    const largeInputContext = getReviewAnalysisContext(largeInputResult)
    assert.equal(largeInputProviderCalls, 0)
    assert.equal(largeInputLegacyCalls, 0)
    assert.equal(largeInputAttached?.attemptId, "attempt-large-input")
    assert.equal(largeInputResult.status, "PARTIAL")
    assert.equal(largeInputContext.deepAnalysisV2.overallStatus, "needs_confirmation")
    assert.equal(largeInputContext.deepAnalysisV2.analysisMode, "large_input_checkpoint")
    assert.equal(largeInputContext.deepAnalysisV2.providerMetadata.provider, "none")
    assert.match(largeInputContext.deepAnalysisV2.generatedPrompt, /Before we move to the next phase/)
    assert.match(largeInputContext.deepAnalysisV2.generatedPrompt, /Current phase: Phase 1 . Core Logging Loop/)
    assert.match(largeInputContext.deepAnalysisV2.generatedPrompt, /Next unstarted phase from the PRD: Phase 2 . Smart Reminders/)
    assert.match(largeInputContext.deepAnalysisV2.generatedPrompt, /Next step details/)
    assert.match(largeInputContext.deepAnalysisV2.generatedPrompt, /Do not implement the next phase yet/)
    assert.match(largeInputContext.deepAnalysisV2.recommendedNextMove, /Phase 2 . Smart Reminders/)
    assert.equal(largeInputAttached?.analysis.deep_analysis_v2_snapshot.analysisMode, "large_input_checkpoint")

    const states = []
    const decisions = []
    const orchestrator = createReviewPopupOrchestrator({
      resolveTarget: async () => ({
        ok: true,
        target: reviewTarget
      }),
      runAnalysis: runner,
      onStateChange: (state) => states.push(state),
      onOpenChange: () => {},
      onCopyPrompt: () => {},
      onDecisionShown: (event) => decisions.push(event)
    })

    const callsBeforePrewarm = v2Calls
    const warmed = await orchestrator.prewarm("deep")
    assert.equal(warmed, true)
    assert.equal(v2Calls, callsBeforePrewarm + 1)

    await orchestrator.open()
    assert.equal(v2Calls, callsBeforePrewarm + 1)
    assert.equal(states.at(-1).controller.cacheStatus, "hit")
    assert.equal(decisions.at(-1).cacheStatus, "hit")

    process.env.PLASMO_PUBLIC_DEEP_ANALYSIS_V2_ROLLOUT = "shadow"
    let shadowV2Calls = 0
    let shadowLegacyCalls = 0
    const shadowRunner = createReviewAnalysisRunner({
      analyzeAfterAttempt: async () => {
        shadowLegacyCalls += 1
        return adaptedPassResult
      },
      attachAnalysisResult: async () => {},
      preprocessResponse: (responseText) => ({
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
      }),
      getProjectMemoryContext: () => ({
        projectContext: "Booking app built phase by phase.",
        currentState: "Phase 1 UI is being reviewed.",
        importedContext: null,
        structuredMemory: null,
        settings: null
      }),
      collectChangedFilesSummary: () => [],
      collectVisibleErrorSummary: () => "",
      analyzeDeepAnalysisV2: async () => {
        shadowV2Calls += 1
        return passResult
      }
    })
    const shadowResult = await shadowRunner({
      mode: "deep",
      quickBaseline: null,
      target: {
        ...reviewTarget,
        taskType: "debug",
        attempt: {
          ...reviewTarget.attempt,
          raw_prompt: "Fix the submit button bug.",
          optimized_prompt: "Fix the submit button bug.",
          intent: {
            ...reviewTarget.attempt.intent,
            goal: "Fix the submit button bug."
          }
        },
        responseText: "Fixed the submit button handler. Phase 1 complete."
      }
    })
    const shadowContext = getReviewAnalysisContext(shadowResult)
    assert.equal(shadowV2Calls, 1)
    assert.equal(shadowLegacyCalls, 1)
    assert.equal(shadowContext.deepAnalysisV2.assistantSuggestedNextMove, "connect form to backend")
    assert.equal(shadowContext.deepAnalysisV2RolloutMode, "shadow")
    assert.equal(shadowContext.deepAnalysisV2Applied, false)

    process.env.PLASMO_PUBLIC_DEEP_ANALYSIS_V2_ROLLOUT = "off"
    let offV2Calls = 0
    let offLegacyCalls = 0
    const offRunner = createReviewAnalysisRunner({
      analyzeAfterAttempt: async () => {
        offLegacyCalls += 1
        return adaptedPassResult
      },
      attachAnalysisResult: async () => {},
      preprocessResponse: (responseText) => ({
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
      }),
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
        offV2Calls += 1
        return passResult
      }
    })
    await offRunner({
      mode: "deep",
      quickBaseline: null,
      target: {
        ...reviewTarget,
        taskType: "debug",
        attempt: {
          ...reviewTarget.attempt,
          raw_prompt: "Fix the submit button bug.",
          optimized_prompt: "Fix the submit button bug.",
          intent: {
            ...reviewTarget.attempt.intent,
            goal: "Fix the submit button bug."
          }
        },
        responseText: "Fixed the submit button handler."
      }
    })
    assert.equal(offV2Calls, 0)
    assert.equal(offLegacyCalls, 1)
    delete process.env.PLASMO_PUBLIC_DEEP_ANALYSIS_V2_ROLLOUT

    console.log("deep-analysis-v2-smoke: ok")
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
