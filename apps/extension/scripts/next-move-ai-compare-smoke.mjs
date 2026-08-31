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
      path.resolve(extensionRoot, "lib/review/assistant-next-move-llm.ts"),
      path.resolve(extensionRoot, "lib/review/analysis-answer-model.ts"),
      path.resolve(extensionRoot, "lib/review/next-move-decision.ts")
    ],
    outdir,
    bundle: true,
    format: "esm",
    platform: "node"
  })
}

function compareEntry(input) {
  return {
    name: input.name,
    promptText: input.promptText,
    responseText: input.responseText,
    taskFamily: input.taskFamily ?? "creation",
    analysisStatus: input.analysisStatus,
    confidence: input.confidence ?? "high",
    workflowState: input.workflowState ?? "safe_to_proceed",
    noRetryRecommended: input.noRetryRecommended,
    decisionText: input.decisionText,
    recommendationText: input.recommendationText,
    aiPayload: input.aiPayload
  }
}

async function main() {
  const outdir = await mkdtemp(path.join(os.tmpdir(), "next-move-ai-compare-"))
  try {
    await bundleModules(outdir)

    const answerModelMod = await import(pathToFileURL(path.join(outdir, "analysis-answer-model.js")).href)
    const decisionMod = await import(pathToFileURL(path.join(outdir, "next-move-decision.js")).href)
    const llmMod = await import(pathToFileURL(path.join(outdir, "assistant-next-move-llm.js")).href)

    const { buildAnalysisAnswerModel, buildAnalysisAnswerModelWithInterpreter } = answerModelMod
    const { buildNextMoveDecision } = decisionMod
    const { ASSISTANT_NEXT_MOVE_INTERPRETER_PROMPT_VERSION } = llmMod

    const cases = [
      compareEntry({
        name: "phase-approval-agreement",
        promptText: "Implement Phase 1 only and stop for approval.",
        responseText:
          "Phase 1 code is ready in the canvas. It covers the requested MVP and stops here. I'm ready for Phase 2 when you are.",
        analysisStatus: "SUCCESS",
        noRetryRecommended: true,
        decisionText: "Nothing critical is missing — safe to proceed.",
        recommendationText: "Continue only with the next approved step.",
        aiPayload: {
          promptVersion: ASSISTANT_NEXT_MOVE_INTERPRETER_PROMPT_VERSION,
          currentStepClaim: "complete",
          nextMoveType: "approval_request",
          nextMoveSummary: "Assistant says the current step is complete and is asking for approval to continue.",
          targetLabel: "Phase 2",
          targetPhaseNumber: 2,
          requiresApproval: true,
          suggestsImplementation: true,
          suggestsClarification: false,
          suggestsValidation: false,
          suggestsCompletion: false,
          confidenceLevel: "high"
        }
      }),
      compareEntry({
        name: "optional-enhancement-agreement",
        promptText: "The dashboard is complete.",
        responseText: "The current dashboard is done. If you want, I can add Stripe checkout next.",
        analysisStatus: "SUCCESS",
        noRetryRecommended: true,
        decisionText: "The current dashboard is complete.",
        recommendationText: "Continue only if you want the optional next step.",
        aiPayload: {
          promptVersion: ASSISTANT_NEXT_MOVE_INTERPRETER_PROMPT_VERSION,
          currentStepClaim: "complete",
          nextMoveType: "optional_enhancement",
          nextMoveSummary: "Assistant offers Stripe checkout as an optional next step.",
          targetLabel: "Stripe checkout",
          targetPhaseNumber: null,
          requiresApproval: false,
          suggestsImplementation: true,
          suggestsClarification: false,
          suggestsValidation: false,
          suggestsCompletion: false,
          confidenceLevel: "high"
        }
      }),
      compareEntry({
        name: "mixed-signal-ambiguous",
        promptText: "Finish the dashboard export step first.",
        responseText:
          "The current dashboard works, but I still need to fix the export formatting before we move on. After that, I can add CSV download if you want.",
        analysisStatus: "PARTIAL",
        noRetryRecommended: false,
        workflowState: "implementation_underway",
        confidence: "medium",
        decisionText: "The current export step still needs work.",
        recommendationText: "Finish the current export step before adding more.",
        aiPayload: {
          promptVersion: ASSISTANT_NEXT_MOVE_INTERPRETER_PROMPT_VERSION,
          currentStepClaim: "partial",
          nextMoveType: "optional_enhancement",
          nextMoveSummary: "Assistant offers CSV export as an optional follow-up once the current work is done.",
          targetLabel: "CSV export",
          targetPhaseNumber: null,
          requiresApproval: false,
          suggestsImplementation: true,
          suggestsClarification: false,
          suggestsValidation: false,
          suggestsCompletion: false,
          confidenceLevel: "high"
        }
      }),
      compareEntry({
        name: "low-confidence-ai-fallback",
        promptText: "Provide code for phase 1 only and stop until my confirmation to start phase 2.",
        responseText: "Phase 1 code is ready in the canvas. I'm ready for Phase 2.",
        analysisStatus: "SUCCESS",
        noRetryRecommended: true,
        decisionText: "Nothing critical is missing — safe to proceed.",
        recommendationText: "Continue only with the next approved step.",
        aiPayload: {
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
        }
      }),
      compareEntry({
        name: "validation-hold-even-with-ai",
        promptText: "Implement Phase 1 only and stop for approval.",
        responseText: "Phase 1 is complete. I'm ready for Phase 2 whenever you approve it.",
        analysisStatus: "SUCCESS",
        noRetryRecommended: true,
        workflowState: "validation_needed",
        decisionText: "The current step still needs visible proof.",
        recommendationText: "Validate the current step before continuing.",
        aiPayload: {
          promptVersion: ASSISTANT_NEXT_MOVE_INTERPRETER_PROMPT_VERSION,
          currentStepClaim: "complete",
          nextMoveType: "approval_request",
          nextMoveSummary: "Assistant is asking for approval to continue.",
          targetLabel: "Phase 2",
          targetPhaseNumber: 2,
          requiresApproval: true,
          suggestsImplementation: true,
          suggestsClarification: false,
          suggestsValidation: false,
          suggestsCompletion: false,
          confidenceLevel: "high"
        }
      })
    ]

    const results = []

    for (const testCase of cases) {
      const localModel = buildAnalysisAnswerModel({
        responseText: testCase.responseText,
        promptText: testCase.promptText,
        taskFamily: testCase.taskFamily
      })
      const aiModel = await buildAnalysisAnswerModelWithInterpreter({
        responseText: testCase.responseText,
        promptText: testCase.promptText,
        taskFamily: testCase.taskFamily,
        interpretPrompt: async () => JSON.stringify(testCase.aiPayload)
      })

      const decision = buildNextMoveDecision({
        analysisStatus: testCase.analysisStatus,
        confidence: testCase.confidence,
        workflowState: testCase.workflowState,
        noRetryRecommended: testCase.noRetryRecommended,
        decisionText: testCase.decisionText,
        recommendationText: testCase.recommendationText,
        promptLabel: "Next move",
        promptText: testCase.recommendationText,
        phaseProgress: null,
        assistantSuggestedNextStep: aiModel.suggestedNextStep,
        assistantNextStepSignal: aiModel.nextStepSignal
      })

      results.push({
        name: testCase.name,
        localSource: localModel.nextStepSignal?.source ?? "none",
        localKind: localModel.nextStepSignal?.kind ?? "none",
        aiSource: aiModel.nextStepSignalAi?.source ?? "none",
        selectedSource: aiModel.nextStepSignalSource,
        agreement: aiModel.nextStepSignalAgreement,
        selectedKind: aiModel.nextStepSignal?.kind ?? "none",
        recommendationKind: decision.recommendation.kind,
        decisionStatus: decision.status
      })
    }

    assert.equal(results.find((item) => item.name === "phase-approval-agreement")?.agreement, "agree")
    assert.equal(results.find((item) => item.name === "phase-approval-agreement")?.selectedSource, "ai")
    assert.equal(
      results.find((item) => item.name === "optional-enhancement-agreement")?.recommendationKind,
      "continue_optional_enhancement"
    )
    assert.equal(results.find((item) => item.name === "mixed-signal-ambiguous")?.selectedSource, "ai")
    assert.equal(results.find((item) => item.name === "mixed-signal-ambiguous")?.recommendationKind, "review_before_advancing")
    assert.equal(results.find((item) => item.name === "low-confidence-ai-fallback")?.selectedSource, "local_heuristic")
    assert.equal(results.find((item) => item.name === "validation-hold-even-with-ai")?.recommendationKind, "review_before_advancing")

    const agreementCount = results.filter((item) => item.agreement === "agree").length
    const disagreementCount = results.filter((item) => item.agreement === "disagree").length
    const aiSelectedCount = results.filter((item) => item.selectedSource === "ai").length
    const fallbackSelectedCount = results.filter((item) => item.selectedSource === "local_heuristic").length

    assert.ok(agreementCount >= 2)
    assert.ok(disagreementCount >= 1)
    assert.ok(aiSelectedCount >= 3)
    assert.ok(fallbackSelectedCount >= 1)

    console.log(
      JSON.stringify(
        {
          summary: {
            totalCases: results.length,
            agreementCount,
            disagreementCount,
            aiSelectedCount,
            fallbackSelectedCount
          },
          results
        },
        null,
        2
      )
    )
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}

await main()
