import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "esbuild"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(scriptDir, "..")

async function main() {
  const outdir = await mkdtemp(path.join(os.tmpdir(), "simple-next-prompt-smoke-"))
  try {
    await build({
      entryPoints: [
        path.resolve(extensionRoot, "lib/review/simple-requirement-extractor.ts"),
        path.resolve(extensionRoot, "lib/review/simple-requirement-confirmation.ts"),
        path.resolve(extensionRoot, "lib/review/simple-confirmation-prompt.ts"),
        path.resolve(extensionRoot, "lib/review/simple-next-step-prompt.ts"),
        path.resolve(extensionRoot, "lib/review/simple-next-prompt-decision-builder.ts"),
        path.resolve(extensionRoot, "lib/review/simple-next-prompt-rollout.ts"),
        path.resolve(extensionRoot, "lib/review/mappers/review-view-model.ts"),
        path.resolve(extensionRoot, "lib/review/next-move-telemetry.ts")
      ],
      outdir,
      bundle: true,
      format: "esm",
      platform: "node"
    })

    const mod = await import(pathToFileURL(path.join(outdir, "simple-requirement-extractor.js")).href)
    const { extractSimplePromptRequirements } = mod
    const confirmationMod = await import(pathToFileURL(path.join(outdir, "simple-requirement-confirmation.js")).href)
    const { checkSimpleRequirementConfirmations } = confirmationMod
    const confirmationPromptMod = await import(pathToFileURL(path.join(outdir, "simple-confirmation-prompt.js")).href)
    const { buildSimpleConfirmationPrompt } = confirmationPromptMod
    const nextStepPromptMod = await import(pathToFileURL(path.join(outdir, "simple-next-step-prompt.js")).href)
    const { buildSimpleNextStepPrompt, extractSimpleAssistantSuggestedNextMove } = nextStepPromptMod
    const decisionBuilderMod = await import(pathToFileURL(path.join(outdir, "simple-next-prompt-decision-builder.js")).href)
    const { buildSimpleNextPromptDecision } = decisionBuilderMod
    const rolloutMod = await import(pathToFileURL(path.join(outdir, "simple-next-prompt-rollout.js")).href)
    const {
      normalizeSimpleNextPromptRolloutMode,
      shouldApplySimpleNextPromptDecision,
      shouldBuildSimpleNextPromptDecision
    } = rolloutMod
    const viewModelMod = await import(pathToFileURL(path.join(outdir, "mappers/review-view-model.js")).href)
    const { mapAfterAnalysisToReviewViewModel } = viewModelMod
    const telemetryMod = await import(pathToFileURL(path.join(outdir, "next-move-telemetry.js")).href)
    const { buildNextMoveTelemetryEvent } = telemetryMod

    const bookingPrompt = [
      "Act like Replit’s coding agent. I am building a simple booking app.",
      "",
      "Phase 1 goal: create the booking form UI only.",
      "",
      "Reply very briefly like a coding agent after completing the work. Do not include code. Say what you changed, confirm Phase 1 is done, and tell me the next phase."
    ].join("\n")

    const extraction = extractSimplePromptRequirements(bookingPrompt)
    const texts = extraction.requirements.map((item) => item.text)
    const categories = extraction.requirements.map((item) => item.category)

    assert.equal(extraction.version, "simple-next-prompt-decision.v1")
    assert.equal(normalizeSimpleNextPromptRolloutMode("off"), "off")
    assert.equal(normalizeSimpleNextPromptRolloutMode("shadow"), "shadow")
    assert.equal(normalizeSimpleNextPromptRolloutMode("on"), "on")
    assert.equal(normalizeSimpleNextPromptRolloutMode("surprise"), "on")
    assert.equal(shouldBuildSimpleNextPromptDecision("off"), false)
    assert.equal(shouldBuildSimpleNextPromptDecision("shadow"), true)
    assert.equal(shouldBuildSimpleNextPromptDecision("on"), true)
    assert.equal(shouldApplySimpleNextPromptDecision("shadow"), false)
    assert.equal(shouldApplySimpleNextPromptDecision("on"), true)
    assert.equal(extraction.confidence, "high")
    assert.match(extraction.notes[0], /Extracted \d+ explicit prompt requirements/)
    assert.ok(texts.some((text) => /Complete Phase 1: create the booking form UI only/i.test(text)))
    assert.ok(texts.includes("Keep this step scoped to UI only."))
    assert.ok(texts.includes("Reply briefly."))
    assert.ok(texts.includes("Do not include code."))
    assert.ok(texts.includes("Say what changed."))
    assert.ok(texts.includes("Confirm Phase 1 is complete."))
    assert.ok(texts.includes("Suggest the next step."))
    assert.ok(categories.includes("task_goal"))
    assert.ok(categories.includes("scope_boundary"))
    assert.ok(categories.includes("format"))
    assert.ok(categories.includes("confirmation"))
    assert.ok(categories.includes("next_step_request"))

    const passingAnswer = [
      "Created booking form UI with fields: name, email, date, time, and submit button.",
      "Added basic layout and input validation states.",
      "Phase 1 complete.",
      "Next phase: implement form state handling and submission logic."
    ].join("\n")
    const check = checkSimpleRequirementConfirmations({
      requirements: extraction.requirements,
      responseText: passingAnswer
    })
    assert.equal(check.status, "pass")
    assert.equal(check.missingConfirmation.length, 0)
    assert.ok(check.confirmed.some((item) => item.text === "Do not include code."))
    assert.ok(check.confirmed.some((item) => item.text === "Confirm Phase 1 is complete."))
    assert.ok(check.confirmed.some((item) => item.text === "Suggest the next step."))
    assert.equal(buildSimpleConfirmationPrompt({ requirementCheck: check }), null)
    const suggestedNextMove = extractSimpleAssistantSuggestedNextMove(passingAnswer)
    assert.equal(suggestedNextMove.rawText, "Next phase: implement form state handling and submission logic.")
    assert.equal(suggestedNextMove.normalizedText, "implement form state handling and submission logic")
    assert.equal(suggestedNextMove.confidence, "high")
    const nextStepPrompt = buildSimpleNextStepPrompt({
      requirementCheck: check,
      promptText: bookingPrompt,
      responseText: passingAnswer
    })
    assert.equal(
      nextStepPrompt,
      [
        "Please implement the best next step now:",
        "- Add required field validation",
        "- Show clear error messages",
        "- Prevent empty submission",
        "- Show a booking confirmation summary",
        "",
        "Do not connect a backend yet.",
        "",
        "After you finish, confirm which requirements were completed and suggest the next step."
      ].join("\n")
    )
    const passingDecision = buildSimpleNextPromptDecision({
      promptText: bookingPrompt,
      responseText: passingAnswer
    })
    assert.equal(passingDecision.version, "simple-next-prompt-decision.v1")
    assert.equal(passingDecision.status, "ready_for_next_prompt")
    assert.equal(passingDecision.requirementCheck.status, "pass")
    assert.equal(passingDecision.promptPolicy.askAssistantToSuggestNextStep, true)
    assert.equal(passingDecision.promptPolicy.hideInternalReasoning, true)
    assert.equal(passingDecision.optimizedPrompt, nextStepPrompt)
    const readyViewModel = mapAfterAnalysisToReviewViewModel({
      result: makeAnalysisResult({
        status: "FAILED",
        confidence: "low",
        nextPrompt: "Old generic fallback prompt"
      }),
      reviewContract: makeReviewContract({
        simpleNextPromptDecision: passingDecision,
        overallDecision: "Old final decision says this is incomplete.",
        recommendation: "Old recommendation says finish missing requirements.",
        confidence: "low",
        workflowState: "blocked"
      }),
      mode: "deep",
      taskType: "creation",
      quickBaseline: null,
      onCopyPrompt: () => {}
    })
    assert.equal(readyViewModel.statusBadge.label, "Looks good")
    assert.equal(readyViewModel.statusBadge.tone, "success")
    assert.equal(readyViewModel.decision, "The answer matches the requested requirements.")
    assert.equal(readyViewModel.recommendedAction, "Use the optimized prompt to continue with the best next step.")
    assert.equal(readyViewModel.nextMoveDecision.status, "ready_for_next_phase")
    assert.equal(readyViewModel.nextMoveDecision.recommendation.kind, "start_next_phase")
    assert.equal(readyViewModel.prompt, nextStepPrompt)
    assert.equal(readyViewModel.promptActions[0].label, "Submit next prompt")
    assert.equal(readyViewModel.requirementMatchSummary.status, "pass")
    assert.equal(readyViewModel.requirementMatchSummary.missingCount, 0)
    assert.ok(readyViewModel.requirementMatchSummary.confirmedCount > 0)
    assert.deepEqual(readyViewModel.missingItems, [])
    const readyTelemetry = buildNextMoveTelemetryEvent({
      eventType: "decision_shown",
      target: makeReviewTarget({ promptText: bookingPrompt, responseText: passingAnswer }),
      result: makeAnalysisResult({
        status: "SUCCESS",
        confidence: "high",
        nextPrompt: nextStepPrompt
      }),
      reviewContract: makeReviewContract({
        simpleNextPromptDecision: passingDecision,
        overallDecision: "Old final decision says this is incomplete.",
        recommendation: "Old recommendation says finish missing requirements.",
        confidence: "low",
        workflowState: "blocked"
      }),
      viewModel: readyViewModel,
      mode: "deep",
      projectKey: "test-project",
      projectLabel: "Test Project"
    })
    assert.equal(readyTelemetry.simpleNextPromptDecision.status, "ready_for_next_prompt")
    assert.equal(readyTelemetry.simpleNextPromptDecision.requirementStatus, "pass")
    assert.equal(readyTelemetry.simpleNextPromptDecision.rolloutMode, "on")
    assert.equal(readyTelemetry.simpleNextPromptDecision.applied, true)
    assert.equal(readyTelemetry.simpleNextPromptDecision.optimizedPrompt, nextStepPrompt)
    assert.equal(readyTelemetry.simpleNextPromptDecision.missingCount, 0)

    const backendSuggestionAnswer = [
      "Created booking form UI with fields: name, email, phone, date, time, service, notes, validation states, and submit button.",
      "Basic responsive layout added.",
      "Phase 1 complete.",
      "Next phase: connect form to backend (API endpoint + data handling)."
    ].join("\n")
    const backendSuggestionCheck = checkSimpleRequirementConfirmations({
      requirements: extraction.requirements,
      responseText: backendSuggestionAnswer
    })
    assert.equal(backendSuggestionCheck.status, "pass")
    assert.equal(extractSimpleAssistantSuggestedNextMove(backendSuggestionAnswer).rawText, "Next phase: connect form to backend (API endpoint + data handling).")
    assert.equal(extractSimpleAssistantSuggestedNextMove(backendSuggestionAnswer).normalizedText, "connect form to backend (API endpoint + data handling)")
    const backendSuggestionPrompt = buildSimpleNextStepPrompt({
      requirementCheck: backendSuggestionCheck,
      promptText: bookingPrompt,
      responseText: backendSuggestionAnswer
    })
    assert.match(backendSuggestionPrompt, /- Add required field validation/)
    assert.match(backendSuggestionPrompt, /Do not connect a backend yet\./)
    assert.doesNotMatch(backendSuggestionPrompt, /API endpoint|data handling/)

    const missingNextStepCheck = checkSimpleRequirementConfirmations({
      requirements: extraction.requirements,
      responseText: "Created the booking form UI with name, email, date, time, and submit button. Phase 1 complete."
    })
    assert.equal(missingNextStepCheck.status, "needs_confirmation")
    assert.ok(missingNextStepCheck.missingConfirmation.some((item) => item.text === "Suggest the next step."))
    const missingNextStepPrompt = buildSimpleConfirmationPrompt({ requirementCheck: missingNextStepCheck })
    assert.match(missingNextStepPrompt, /^Before we move forward, confirm these requirements from my last prompt:/)
    assert.match(missingNextStepPrompt, /- Suggest the next step\./)
    assert.match(missingNextStepPrompt, /For each one, answer:\n- Completed, with evidence\n- Not completed yet, with what remains/)
    assert.match(missingNextStepPrompt, /Do not add new scope yet\./)
    assert.ok(missingNextStepPrompt.endsWith("After confirming, suggest what the next step should be."))
    const missingNextStepDecision = buildSimpleNextPromptDecision({
      promptText: bookingPrompt,
      responseText: "Created the booking form UI with name, email, date, time, and submit button. Phase 1 complete."
    })
    assert.equal(missingNextStepDecision.status, "needs_confirmation")
    assert.equal(missingNextStepDecision.requirementCheck.status, "needs_confirmation")
    assert.equal(missingNextStepDecision.optimizedPrompt, missingNextStepPrompt)
    const missingViewModel = mapAfterAnalysisToReviewViewModel({
      result: makeAnalysisResult({
        status: "SUCCESS",
        confidence: "high",
        nextPrompt: "No retry needed. The visible answer already covers the requested parts."
      }),
      reviewContract: makeReviewContract({
        simpleNextPromptDecision: missingNextStepDecision,
        overallDecision: "Old final decision says the answer is ready.",
        recommendation: "Old recommendation says continue without retrying.",
        confidence: "high",
        workflowState: "safe_to_proceed"
      }),
      mode: "deep",
      taskType: "creation",
      quickBaseline: null,
      onCopyPrompt: () => {}
    })
    assert.equal(missingViewModel.statusBadge.label, "Needs confirmation")
    assert.equal(missingViewModel.statusBadge.tone, "warning")
    assert.equal(missingViewModel.decision, "Some requested requirements still need confirmation.")
    assert.equal(missingViewModel.recommendedAction, "Ask the assistant to confirm the missing points before moving forward.")
    assert.equal(missingViewModel.nextMoveDecision.status, "incomplete")
    assert.equal(missingViewModel.nextMoveDecision.recommendation.kind, "finish_missing_requirements")
    assert.equal(missingViewModel.prompt, missingNextStepPrompt)
    assert.equal(missingViewModel.promptActions[0].label, "Confirm requirements")
    assert.equal(missingViewModel.requirementMatchSummary.status, "needs_confirmation")
    assert.equal(missingViewModel.requirementMatchSummary.missingCount, 1)
    assert.ok(missingViewModel.requirementMatchSummary.rows.some((row) => row.label.includes("Suggest the next step.")))
    assert.deepEqual(missingViewModel.missingItems, ["Suggest the next step."])
    const shadowViewModel = mapAfterAnalysisToReviewViewModel({
      result: makeAnalysisResult({
        status: "SUCCESS",
        confidence: "high",
        nextPrompt: "Old fallback prompt"
      }),
      reviewContract: makeReviewContract({
        simpleNextPromptDecision: missingNextStepDecision,
        simpleNextPromptRolloutMode: "shadow",
        simpleNextPromptApplied: false,
        overallDecision: "Old final decision says the answer is ready.",
        recommendation: "Old recommendation says continue without retrying.",
        confidence: "high",
        workflowState: "safe_to_proceed"
      }),
      mode: "deep",
      taskType: "creation",
      quickBaseline: null,
      onCopyPrompt: () => {}
    })
    assert.equal(shadowViewModel.requirementMatchSummary, null)
    assert.notEqual(shadowViewModel.promptActions[0]?.label, "Confirm requirements")
    const missingTelemetry = buildNextMoveTelemetryEvent({
      eventType: "decision_shown",
      target: makeReviewTarget({
        promptText: bookingPrompt,
        responseText: "Created the booking form UI with name, email, date, time, and submit button. Phase 1 complete."
      }),
      result: makeAnalysisResult({
        status: "SUCCESS",
        confidence: "high",
        nextPrompt: missingNextStepPrompt
      }),
      reviewContract: makeReviewContract({
        simpleNextPromptDecision: missingNextStepDecision,
        overallDecision: "Old final decision says the answer is ready.",
        recommendation: "Old recommendation says continue without retrying.",
        confidence: "high",
        workflowState: "safe_to_proceed"
      }),
      viewModel: missingViewModel,
      mode: "deep"
    })
    assert.equal(missingTelemetry.simpleNextPromptDecision.status, "needs_confirmation")
    assert.equal(missingTelemetry.simpleNextPromptDecision.requirementStatus, "needs_confirmation")
    assert.equal(missingTelemetry.simpleNextPromptDecision.rolloutMode, "on")
    assert.equal(missingTelemetry.simpleNextPromptDecision.applied, true)
    assert.deepEqual(missingTelemetry.simpleNextPromptDecision.missingRequirements, ["Suggest the next step."])
    assert.equal(
      buildSimpleNextStepPrompt({
        requirementCheck: missingNextStepCheck,
        promptText: bookingPrompt,
        responseText: "Created the booking form UI with name, email, date, time, and submit button. Phase 1 complete."
      }),
      null
    )

    const codeAnswerCheck = checkSimpleRequirementConfirmations({
      requirements: extraction.requirements,
      responseText: [
        "Created the booking form UI.",
        "```html",
        "<form></form>",
        "```",
        "Phase 1 complete. Next phase: validation."
      ].join("\n")
    })
    assert.equal(codeAnswerCheck.status, "needs_confirmation")
    assert.ok(codeAnswerCheck.missingConfirmation.some((item) => item.text === "Do not include code."))

    const genericPrompt = buildSimpleNextStepPrompt({
      requirementCheck: { status: "pass", confirmed: [], missingConfirmation: [] },
      promptText: "Build my app in phases.",
      responseText: "Done. Next step: add a dashboard."
    })
    assert.equal(
      genericPrompt,
      [
        "Please implement the best next step now:",
        "- Add a dashboard",
        "",
        "After you finish, confirm which requirements were completed and suggest the next step."
      ].join("\n")
    )

    const emptyExtraction = extractSimplePromptRequirements("")
    assert.equal(emptyExtraction.confidence, "low")
    assert.deepEqual(emptyExtraction.requirements, [])
    assert.equal(emptyExtraction.notes[0], "Prompt is empty.")

    console.log("simple-next-prompt-smoke: ok")
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}

function makeAnalysisResult(input = {}) {
  return {
    status: input.status ?? "SUCCESS",
    confidence: input.confidence ?? "high",
    confidence_reason: input.confidenceReason ?? "",
    next_prompt: input.nextPrompt ?? "",
    next_prompt_output: { next_prompt: input.nextPrompt ?? "" },
    stage_2: {
      missing_criteria: [],
      analysis_notes: []
    },
    acceptance_checklist: [],
    changed_files: [],
    evidence: []
  }
}

function makeReviewContract(input) {
  return {
    taskFamily: "creation",
    checklistSource: "decomposed",
    sanitizationChanges: [],
    overallDecision: input.overallDecision,
    recommendation: input.recommendation,
    confidence: input.confidence,
    confidenceNote: "Old confidence note.",
    confidenceReasons: ["Old confidence reason."],
    failureTypes: [],
    evidenceSummary: {
      items: [],
      counts: {
        claimed: 0,
        evidenced: 0,
        contradicted: 0,
        unclear: 0
      }
    },
    attemptMemory: null,
    requirements: [
      {
        id: "old_requirement",
        label: "Old requirement row",
        type: "old",
        priority: "P1",
        status: input.confidence === "high" ? "pass" : "fail",
        evidence: ["Old evidence."]
      }
    ],
    topFailures: [],
    topPasses: [],
    missingItems: ["Old missing item"],
    whyItems: ["Old why item"],
    proofSummary: "Old proof summary.",
    checkedItems: ["Old checked item"],
    uncheckedItems: ["Old unchecked item"],
    promptLabel: "Old prompt label",
    promptText: "Old prompt text",
    promptNote: "Old prompt note",
    copyPromptText: "Old copy prompt text",
    nextMoveShort: "Old next move.",
    feedbackPrompt: "Old feedback prompt.",
    phaseProgress: null,
    analysisDebug: {
      promptVersion: "test",
      selectedPath: "smart",
      comparisonSummary: "test",
      baseline: {
        working: [],
        gaps: [],
        nextMove: "Old baseline move",
        judgments: []
      },
      smart: {
        working: [],
        gaps: [],
        nextMove: input.simpleNextPromptDecision.optimizedPrompt,
        assistantSuggestedNextStep: input.simpleNextPromptDecision.assistantSuggestedNextMove?.rawText ?? null,
        assistantNextStepSignal: null,
        assistantNextStepSignalLocal: null,
        assistantNextStepSignalAi: null,
        assistantNextStepSignalSource: "none",
        assistantNextStepSignalAgreement: "none",
        assistantSignalDecision: null,
        simpleNextPromptDecision: input.simpleNextPromptDecision,
        simpleNextPromptRolloutMode: input.simpleNextPromptRolloutMode ?? "on",
        simpleNextPromptApplied: input.simpleNextPromptApplied ?? true,
        workflowState: input.workflowState,
        phaseProgress: null,
        strategy: {
          mode: "direct_revise",
          reason: "Old strategy reason."
        },
        judgments: [],
        judgeNotes: [],
        validatorNotes: []
      }
    }
  }
}

function makeReviewTarget(input) {
  return {
    attempt: {
      attempt_id: "attempt-simple-1",
      raw_prompt: input.promptText,
      optimized_prompt: input.promptText,
      intent: {
        goal: input.promptText,
        task_type: "build",
        acceptance_criteria: [],
        constraints: []
      },
      status: "submitted",
      created_at: new Date().toISOString()
    },
    responseText: input.responseText,
    responseMessageId: "response-simple-1",
    threadIdentity: "thread-simple-1",
    responseIdentity: "response-simple-1",
    taskType: "creation"
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
