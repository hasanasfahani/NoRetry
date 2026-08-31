import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "esbuild"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(scriptDir, "..")

async function bundleModules(outdir) {
  await build({
    entryPoints: [
      path.resolve(extensionRoot, "lib/review/assistant-next-step-signal.ts"),
      path.resolve(extensionRoot, "lib/review/assistant-next-move-llm.ts"),
      path.resolve(extensionRoot, "lib/review/analysis-answer-model.ts"),
      path.resolve(extensionRoot, "lib/review/next-move-decision.ts"),
      path.resolve(extensionRoot, "lib/review/phase-progress.ts")
    ],
    outdir,
    bundle: true,
    format: "esm",
    platform: "node"
  })
}

async function main() {
  const outdir = await mkdtemp(path.join(os.tmpdir(), "next-move-interpreter-smoke-"))
  try {
    await bundleModules(outdir)

    const signalMod = await import(pathToFileURL(path.join(outdir, "assistant-next-step-signal.js")).href)
    const llmMod = await import(pathToFileURL(path.join(outdir, "assistant-next-move-llm.js")).href)
    const answerModelMod = await import(pathToFileURL(path.join(outdir, "analysis-answer-model.js")).href)
    const decisionMod = await import(pathToFileURL(path.join(outdir, "next-move-decision.js")).href)
    const phaseProgressMod = await import(pathToFileURL(path.join(outdir, "phase-progress.js")).href)

    const { extractAssistantNextStepSignal } = signalMod
    const {
      ASSISTANT_NEXT_MOVE_INTERPRETER_PROMPT_VERSION,
      buildAssistantNextMoveInterpreterPrompt,
      runAssistantNextMoveLlmInterpreter
    } = llmMod
    const { buildAnalysisAnswerModel, buildAnalysisAnswerModelWithInterpreter } = answerModelMod
    const { buildAssistantSignalFirstDecision, buildNextMoveDecision } = decisionMod
    const { deriveReviewPhaseProgress } = phaseProgressMod

    const summaryOnlyContext = {
      rawMarkdown: [
        "# Implementation Phases",
        "The implementation is split into three phases. Phase 1 builds the core integration and reminder engine. Phase 2 adds user customization and settings. Phase 3 polishes the experience and adds basic analytics."
      ].join("\n"),
      currentState: "Current focus: Phase 1 only."
    }

    const phaseProgress = deriveReviewPhaseProgress({
      promptText: "Implement Phase 1 only and stop for approval.",
      responseText: "Done — Phase 1 is implemented. Waiting for your approval to move to Phase 2 (customization & settings).",
      importedContext: summaryOnlyContext,
      projectMemory: null
    })

    assert.ok(phaseProgress)
    assert.equal(phaseProgress?.nextPhaseLabel, "Phase 2 — User Customization And Settings")

    const phraseVariants = [
      {
        response: "Done — Phase 1 is implemented. Waiting for your approval to move to Phase 2 (customization & settings).",
        expectedKind: "approval_to_continue",
        expectedPhase: 2
      },
      {
        response: "Phase 1 code is ready in the canvas. I'm ready for Phase 2.",
        expectedKind: "approval_to_continue",
        expectedPhase: 2
      },
      {
        response: "We are ready for Phase 2 whenever you are.",
        expectedKind: "approval_to_continue",
        expectedPhase: 2
      },
      {
        response: "The current step is complete. Next, continue by building the history screen.",
        expectedKind: "continue_current_work",
        expectedPhase: null
      },
      {
        response: "The core flow works, but the reminder scheduler still needs one more pass before we move on.",
        expectedKind: "continue_current_work",
        expectedPhase: null
      },
      {
        response: "This is mostly done, but I still need to fix the history view before we move on.",
        expectedKind: "finish_missing_piece",
        expectedPhase: null
      },
      {
        response: "If you want, I can add tests next.",
        expectedKind: "offer_optional_enhancement",
        expectedPhase: null
      },
      {
        response: "Would you like me to connect a backend next?",
        expectedKind: "offer_optional_enhancement",
        expectedPhase: null
      },
      {
        response: "Let me know if you want reminders next.",
        expectedKind: "clarify_decision",
        expectedPhase: null
      },
      {
        response: "I can implement this with Clerk or Supabase Auth. Which provider do you want me to use before I wire the flow?",
        expectedKind: "clarify_decision",
        expectedPhase: null
      },
      {
        response: "I need to know whether submissions should go into the leads table or the contacts table first.",
        expectedKind: "clarify_decision",
        expectedPhase: null
      },
      {
        response:
          "The checkout page UI is built. Payment processing still needs the Stripe session endpoint, and I can add coupon codes next.",
        expectedKind: "offer_optional_enhancement",
        expectedPhase: null,
        expectedClaim: "partial"
      },
      {
        response: "Before we move on, please verify this in the browser.",
        expectedKind: "validate_or_test",
        expectedPhase: null
      },
      {
        response: "This is done.",
        expectedKind: "task_complete",
        expectedPhase: null
      }
    ]

    for (const sample of phraseVariants) {
      const signal = extractAssistantNextStepSignal(sample.response)
      assert.ok(signal, `Expected a signal for: ${sample.response}`)
      assert.equal(signal?.kind, sample.expectedKind)
      assert.equal(signal?.targetPhaseNumber ?? null, sample.expectedPhase)
      if (sample.expectedClaim) {
        assert.equal(signal?.currentStepClaim, sample.expectedClaim)
      }
      assert.equal(signal?.source, "local_heuristic")
      assert.ok(signal?.nextMoveType)
      assert.ok(signal?.confidenceLevel)
    }

    const approvalModel = buildAnalysisAnswerModel({
      responseText: "Done — Phase 1 is implemented. Waiting for your approval to move to Phase 2 (customization & settings).",
      promptText: "Implement Phase 1 only and stop for approval.",
      taskFamily: "creation"
    })
    assert.equal(approvalModel.nextStepSignal?.kind, "approval_to_continue")
    assert.equal(approvalModel.nextStepSignal?.nextMoveType, "approval_request")
    assert.equal(approvalModel.nextStepSignal?.currentStepClaim, "complete")
    assert.equal(approvalModel.nextStepSignal?.confidenceLevel, "high")

    const interpreterPrompt = buildAssistantNextMoveInterpreterPrompt({
      promptText: "Provide code for Phase 1 only, then stop for approval.",
      responseText:
        "Phase 1 code is ready in the canvas. It covers the requested MVP and stops here. I'm ready for Phase 2 when you are."
    })
    assert.match(interpreterPrompt, new RegExp(ASSISTANT_NEXT_MOVE_INTERPRETER_PROMPT_VERSION.replace(".", "\\.")))
    assert.match(interpreterPrompt, /Return JSON only/i)
    assert.match(interpreterPrompt, /Latest actionable lines:/i)

    const aiApprovalSignal = await runAssistantNextMoveLlmInterpreter({
      promptText: "Provide code for Phase 1 only, then stop for approval.",
      responseText:
        "Phase 1 code is ready in the canvas. It covers the requested MVP and stops here. I'm ready for Phase 2 when you are.",
      taskType: "coding",
      interpretPrompt: async () =>
        JSON.stringify({
          promptVersion: ASSISTANT_NEXT_MOVE_INTERPRETER_PROMPT_VERSION,
          currentStepClaim: "complete",
          nextMoveType: "approval_request",
          nextMoveSummary: "Assistant says the current step is complete and is asking for approval to continue.",
          targetLabel: "Phase 2 — Reminders & History",
          targetPhaseNumber: 2,
          requiresApproval: true,
          suggestsImplementation: true,
          suggestsClarification: false,
          suggestsValidation: false,
          suggestsCompletion: false,
          confidenceLevel: "high"
        })
    })
    assert.equal(aiApprovalSignal?.source, "ai")
    assert.equal(aiApprovalSignal?.nextMoveType, "approval_request")
    assert.equal(aiApprovalSignal?.targetPhaseNumber, 2)
    assert.equal(aiApprovalSignal?.confidenceLevel, "high")

    const aiFencedSignal = await runAssistantNextMoveLlmInterpreter({
      promptText: "Ship this fix and tell me what to validate next.",
      responseText: "The fix is in. Before moving on, please verify it in the browser.",
      taskType: "coding",
      interpretPrompt: async () => `\`\`\`json
${JSON.stringify({
  promptVersion: ASSISTANT_NEXT_MOVE_INTERPRETER_PROMPT_VERSION,
  currentStepClaim: "complete",
  nextMoveType: "validation_request",
  nextMoveSummary: "Assistant wants a validation pass before continuing.",
  targetLabel: null,
  targetPhaseNumber: null,
  requiresApproval: false,
  suggestsImplementation: false,
  suggestsClarification: false,
  suggestsValidation: true,
  suggestsCompletion: false,
  confidenceLevel: "medium"
})}
\`\`\``
    })
    assert.equal(aiFencedSignal?.nextMoveType, "validation_request")
    assert.equal(aiFencedSignal?.suggestsValidation, true)
    assert.equal(aiFencedSignal?.confidenceLevel, "medium")

    const invalidAiSignal = await runAssistantNextMoveLlmInterpreter({
      promptText: "Continue only if the current step is truly complete.",
      responseText: "Everything is done. Maybe go ahead.",
      taskType: "coding",
      interpretPrompt: async () =>
        JSON.stringify({
          promptVersion: ASSISTANT_NEXT_MOVE_INTERPRETER_PROMPT_VERSION,
          currentStepClaim: "complete",
          nextMoveType: "approval_request",
          nextMoveSummary: "",
          targetLabel: "Phase 2",
          targetPhaseNumber: 2,
          requiresApproval: "yes",
          suggestsImplementation: true,
          suggestsClarification: false,
          suggestsValidation: false,
          suggestsCompletion: false,
          confidenceLevel: "high"
        })
    })
    assert.equal(invalidAiSignal, null)

    const aiBackedAnswerModel = await buildAnalysisAnswerModelWithInterpreter({
      responseText: "Phase 1 code is ready in the canvas. It covers the requested MVP and stops here. I'm ready for Phase 2 when you are.",
      promptText: "Provide code for Phase 1 only, then stop for approval.",
      taskFamily: "creation",
      interpretPrompt: async () =>
        JSON.stringify({
          promptVersion: ASSISTANT_NEXT_MOVE_INTERPRETER_PROMPT_VERSION,
          currentStepClaim: "complete",
          nextMoveType: "approval_request",
          nextMoveSummary: "Assistant says the current step is complete and is asking for approval to continue.",
          targetLabel: "Phase 2 — Reminders & History",
          targetPhaseNumber: 2,
          requiresApproval: true,
          suggestsImplementation: true,
          suggestsClarification: false,
          suggestsValidation: false,
          suggestsCompletion: false,
          confidenceLevel: "high"
        })
    })
    assert.equal(aiBackedAnswerModel.nextStepSignal?.source, "ai")
    assert.equal(aiBackedAnswerModel.nextStepSignalSource, "ai")
    assert.equal(aiBackedAnswerModel.nextStepSignalLocal?.source, "local_heuristic")
    assert.equal(aiBackedAnswerModel.nextStepSignalAi?.source, "ai")
    assert.equal(aiBackedAnswerModel.nextStepSignalAgreement, "agree")
    assert.equal(aiBackedAnswerModel.nextStepSignal?.kind, "approval_to_continue")
    assert.equal(aiBackedAnswerModel.nextStepSignal?.targetPhaseNumber, 2)

    const fallbackAnswerModel = await buildAnalysisAnswerModelWithInterpreter({
      responseText: "Phase 1 code is ready in the canvas. I'm ready for Phase 2.",
      promptText: "Provide code for phase 1 only and stop until my confirmation to start phase 2.",
      taskFamily: "creation",
      interpretPrompt: async () =>
        JSON.stringify({
          promptVersion: ASSISTANT_NEXT_MOVE_INTERPRETER_PROMPT_VERSION,
          currentStepClaim: "complete",
          nextMoveType: "unknown",
          nextMoveSummary: "The signal is too weak to interpret confidently.",
          targetLabel: null,
          targetPhaseNumber: null,
          requiresApproval: false,
          suggestsImplementation: false,
          suggestsClarification: false,
          suggestsValidation: false,
          suggestsCompletion: false,
          confidenceLevel: "low"
        })
    })
    assert.equal(fallbackAnswerModel.nextStepSignal?.source, "local_heuristic")
    assert.equal(fallbackAnswerModel.nextStepSignalSource, "local_heuristic")
    assert.equal(fallbackAnswerModel.nextStepSignalAi?.source, "ai")
    assert.equal(fallbackAnswerModel.nextStepSignalAgreement, "disagree")
    assert.equal(fallbackAnswerModel.nextStepSignal?.kind, "approval_to_continue")

    const mixedSignalModel = buildAnalysisAnswerModel({
      responseText:
        "The current dashboard works, but I still need to fix the export formatting before we move on. After that, I can add CSV download if you want.",
      promptText: "Finish the dashboard export step first.",
      taskFamily: "creation"
    })
    assert.equal(mixedSignalModel.nextStepSignal?.currentStepClaim, "partial")
    assert.ok(
      mixedSignalModel.nextStepSignal?.kind === "finish_missing_piece" ||
        mixedSignalModel.nextStepSignal?.kind === "continue_current_work" ||
        mixedSignalModel.nextStepSignal?.kind === "offer_optional_enhancement"
    )

    const aiDisagreementModel = await buildAnalysisAnswerModelWithInterpreter({
      responseText:
        "The current dashboard works, but I still need to fix the export formatting before we move on. After that, I can add CSV download if you want.",
      promptText: "Finish the dashboard export step first.",
      taskFamily: "creation",
      interpretPrompt: async () =>
        JSON.stringify({
          promptVersion: ASSISTANT_NEXT_MOVE_INTERPRETER_PROMPT_VERSION,
          currentStepClaim: "partial",
          nextMoveType: "optional_enhancement",
          nextMoveSummary: "Assistant offers an optional CSV export after the current work is done.",
          targetLabel: "CSV export",
          targetPhaseNumber: null,
          requiresApproval: false,
          suggestsImplementation: true,
          suggestsClarification: false,
          suggestsValidation: false,
          suggestsCompletion: false,
          confidenceLevel: "high"
        })
    })
    assert.equal(aiDisagreementModel.nextStepSignalSource, "ai")
    assert.ok(
      aiDisagreementModel.nextStepSignalAgreement === "disagree" ||
        aiDisagreementModel.nextStepSignalAgreement === "agree"
    )
    assert.equal(aiDisagreementModel.nextStepSignal?.kind, "offer_optional_enhancement")

    const mixedSignalDecision = buildAssistantSignalFirstDecision({
      analysisStatus: "PARTIAL",
      confidence: "medium",
      workflowState: "implementation_underway",
      noRetryRecommended: false,
      decisionText: "The current export step still needs work.",
      recommendationText: "Finish the current export step before adding more.",
      promptLabel: "Next move",
      promptText: "Continue with the optional next step.",
      phaseProgress: null,
      assistantSuggestedNextStep: aiDisagreementModel.suggestedNextStep,
      assistantNextStepSignal: aiDisagreementModel.nextStepSignal
    })
    assert.equal(mixedSignalDecision?.decision.recommendation.kind, "review_before_advancing")
    assert.match(mixedSignalDecision?.decision.assistantPrompt.body ?? "", /validate|finish|current step/i)

    const blockedAdvance = buildAssistantSignalFirstDecision({
      analysisStatus: "PARTIAL",
      confidence: "medium",
      workflowState: "implementation_underway",
      noRetryRecommended: false,
      decisionText: "The current step still has missing pieces.",
      recommendationText: "Finish the current step before moving on.",
      promptLabel: "Next move",
      promptText: "Continue with the next step.",
      phaseProgress,
      assistantSuggestedNextStep: approvalModel.suggestedNextStep,
      assistantNextStepSignal: approvalModel.nextStepSignal
    })
    assert.equal(blockedAdvance?.decision.recommendation.kind, "finish_missing_requirements")
    assert.match(blockedAdvance?.decision.assistantPrompt.body ?? "", /do not start the next step yet/i)

    const allowedAdvance = buildAssistantSignalFirstDecision({
      analysisStatus: "SUCCESS",
      confidence: "high",
      workflowState: "safe_to_proceed",
      noRetryRecommended: true,
      decisionText: "Nothing critical is missing — safe to proceed.",
      recommendationText: "Continue without retrying this answer.",
      promptLabel: "Next move",
      promptText: "Continue with the next step.",
      phaseProgress,
      assistantSuggestedNextStep: approvalModel.suggestedNextStep,
      assistantNextStepSignal: approvalModel.nextStepSignal
    })
    assert.equal(allowedAdvance?.decision.status, "ready_for_next_phase")
    assert.match(allowedAdvance?.decision.assistantPrompt.body ?? "", /preserve the accepted work/i)

    const completeWordingAdvance = buildAssistantSignalFirstDecision({
      analysisStatus: "SUCCESS",
      confidence: "high",
      workflowState: "safe_to_proceed",
      noRetryRecommended: true,
      decisionText: "The answer satisfies the main visible requirements.",
      recommendationText: "The current phase is complete and can use the next scoped step.",
      promptLabel: "Next move",
      promptText: "Continue with the next step.",
      phaseProgress,
      assistantSuggestedNextStep: approvalModel.suggestedNextStep,
      assistantNextStepSignal: approvalModel.nextStepSignal
    })
    assert.equal(completeWordingAdvance?.decision.status, "ready_for_next_phase")
    assert.equal(completeWordingAdvance?.decision.recommendation.kind, "start_next_phase")

    const noisyReviewAdvance = buildAssistantSignalFirstDecision({
      analysisStatus: "PARTIAL",
      confidence: "medium",
      workflowState: "implementation_underway",
      noRetryRecommended: false,
      decisionText: "The answer satisfies the main visible requirements.",
      recommendationText: "You can use this as-is.",
      promptLabel: "Next move",
      promptText: "You can use this as-is.",
      phaseProgress,
      assistantSuggestedNextStep: approvalModel.suggestedNextStep,
      assistantNextStepSignal: approvalModel.nextStepSignal
    })
    assert.equal(noisyReviewAdvance?.decision.status, "ready_for_next_phase")
    assert.equal(noisyReviewAdvance?.decision.recommendation.kind, "start_next_phase")

    const validationBlockedAdvance = buildAssistantSignalFirstDecision({
      analysisStatus: "SUCCESS",
      confidence: "high",
      workflowState: "validation_needed",
      noRetryRecommended: true,
      decisionText: "The implementation still needs visible proof before moving on.",
      recommendationText: "Validate the current step with concrete proof first.",
      promptLabel: "Next move",
      promptText: "Continue with the next step.",
      phaseProgress,
      assistantSuggestedNextStep: approvalModel.suggestedNextStep,
      assistantNextStepSignal: approvalModel.nextStepSignal
    })
    assert.equal(validationBlockedAdvance?.decision.status, "risky")
    assert.equal(validationBlockedAdvance?.decision.recommendation.kind, "review_before_advancing")

    const optionalEnhancementModel = buildAnalysisAnswerModel({
      responseText: "The current task is complete. If you want, I can add analytics next.",
      promptText: "Ship the current dashboard first.",
      taskFamily: "creation"
    })
    const optionalEnhancementDecision = buildAssistantSignalFirstDecision({
      analysisStatus: "SUCCESS",
      confidence: "high",
      workflowState: "safe_to_proceed",
      noRetryRecommended: true,
      decisionText: "The visible answer satisfies the current task.",
      recommendationText: "Continue without retrying this answer.",
      promptLabel: "Next move",
      promptText: "Continue with the optional next step.",
      phaseProgress: null,
      assistantSuggestedNextStep: optionalEnhancementModel.suggestedNextStep,
      assistantNextStepSignal: optionalEnhancementModel.nextStepSignal
    })
    assert.equal(optionalEnhancementDecision?.decision.recommendation.kind, "continue_optional_enhancement")
    assert.match(optionalEnhancementDecision?.decision.assistantPrompt.body ?? "", /optional next step only/i)

    const blockedOptionalEnhancementDecision = buildAssistantSignalFirstDecision({
      analysisStatus: "PARTIAL",
      confidence: "medium",
      workflowState: "safe_to_proceed",
      noRetryRecommended: true,
      decisionText: "The current task still has visible gaps.",
      recommendationText: "Finish the current step before adding more.",
      promptLabel: "Next move",
      promptText: "Continue with the optional next step.",
      phaseProgress: null,
      assistantSuggestedNextStep: optionalEnhancementModel.suggestedNextStep,
      assistantNextStepSignal: optionalEnhancementModel.nextStepSignal
    })
    assert.equal(blockedOptionalEnhancementDecision?.decision.recommendation.kind, "review_before_advancing")

    const taskCompleteDecision = buildNextMoveDecision({
      analysisStatus: "SUCCESS",
      confidence: "high",
      workflowState: "safe_to_proceed",
      noRetryRecommended: true,
      decisionText: "Nothing critical is missing — safe to proceed.",
      recommendationText: "Continue without retrying this answer.",
      promptLabel: "Next move",
      promptText: "No retry needed.",
      phaseProgress: null,
      assistantSuggestedNextStep: null,
      assistantNextStepSignal: extractAssistantNextStepSignal("This is done.")
    })
    assert.equal(taskCompleteDecision.recommendation.kind, "move_to_next_task")

    const incompleteDespiteNoRetryDecision = buildNextMoveDecision({
      analysisStatus: "PARTIAL",
      confidence: "medium",
      workflowState: "safe_to_proceed",
      noRetryRecommended: true,
      decisionText: "The answer still misses part of the request.",
      recommendationText: "Finish the missing requirements first.",
      promptLabel: "Next move",
      promptText: "No retry needed.",
      phaseProgress: null,
      assistantSuggestedNextStep: null,
      assistantNextStepSignal: extractAssistantNextStepSignal("This is done.")
    })
    assert.notEqual(incompleteDespiteNoRetryDecision.recommendation.kind, "move_to_next_task")

    const postPrdOptionalSignal = buildAnalysisAnswerModel({
      responseText: "The current dashboard is done. If you want, I can add Stripe checkout next.",
      promptText: "The dashboard is complete.",
      taskFamily: "creation"
    })
    assert.equal(postPrdOptionalSignal.nextStepSignal?.kind, "offer_optional_enhancement")

    const postPrdOptionalDecision = buildNextMoveDecision({
      analysisStatus: "SUCCESS",
      confidence: "high",
      workflowState: "safe_to_proceed",
      noRetryRecommended: true,
      decisionText: "The current dashboard is complete.",
      recommendationText: "Continue only if you want the optional next step.",
      promptLabel: "Next move",
      promptText: "Continue with the optional next step only.",
      phaseProgress: null,
      assistantSuggestedNextStep: postPrdOptionalSignal.suggestedNextStep,
      assistantNextStepSignal: postPrdOptionalSignal.nextStepSignal
    })
    assert.equal(postPrdOptionalDecision.recommendation.kind, "continue_optional_enhancement")
    assert.match(postPrdOptionalDecision.recommendation.primaryCtaLabel, /optional step/i)

    console.log("next-move-interpreter-smoke: ok")
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}

await main()
