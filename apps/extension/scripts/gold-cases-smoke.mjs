import assert from "node:assert/strict"
import { readdir, readFile, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "esbuild"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(scriptDir, "..")

async function bundleModules(outdir) {
  await build({
    entryPoints: [
      path.resolve(extensionRoot, "lib/review/services/review-task-type.ts"),
      path.resolve(extensionRoot, "lib/review/services/review-analysis.ts"),
      path.resolve(extensionRoot, "lib/review/services/review-prompt-mode.ts"),
      path.resolve(extensionRoot, "lib/review/mappers/review-view-model.ts")
    ],
    outdir,
    bundle: true,
    format: "esm",
    platform: "node"
  })
}

function makeAttempt(prompt, taskType = "other") {
  return {
    attempt_id: `attempt-${Math.random().toString(36).slice(2, 8)}`,
    platform: "replit",
    raw_prompt: prompt,
    optimized_prompt: prompt,
    intent: {
      task_type: taskType,
      goal: prompt,
      constraints: [],
      acceptance_criteria: []
    },
    status: "submitted",
    created_at: new Date().toISOString(),
    submitted_at: new Date().toISOString(),
    response_text: null,
    response_message_id: null,
    analysis_result: null,
    token_usage_total: 0,
    stage_cache: {}
  }
}

function preprocessResponse(responseText) {
  return {
    response_text: responseText,
    response_length: responseText.length,
    first_excerpt: responseText.slice(0, 120),
    last_excerpt: responseText.slice(-120),
    key_paragraphs: responseText.split(/\n{2,}/).slice(0, 2),
    has_code_blocks: responseText.includes("```"),
    mentioned_files: Array.from(new Set(responseText.match(/\b[\w./-]+\.(?:html|css|js|ts|tsx)\b/gi) ?? [])),
    change_claims: [],
    validation_signals: [],
    certainty_signals: [],
    uncertainty_signals: [],
    success_signals: [],
    failure_signals: []
  }
}

function makeProofResult() {
  return {
    status: "PARTIAL",
    confidence: "medium",
    confidence_reason: "Proof is still incomplete.",
    inspection_depth: "targeted_text",
    findings: ["A concrete fix was proposed."],
    issues: ["Runtime verification is still missing."],
    next_prompt: "Verify the missing proof.",
    prompt_strategy: "fix_missing",
    stage_1: {
      assistant_action_summary: "Proposed a fix.",
      claimed_evidence: ["Updated the relevant logic."],
      response_mode: "implemented",
      scope_assessment: "narrow"
    },
    stage_2: {
      addressed_criteria: ["The answer names the concrete fix"],
      missing_criteria: ["The answer shows evidence the result works"],
      constraint_risks: [],
      problem_fit: "partial",
      analysis_notes: ["Proof is still incomplete."]
    },
    verdict: {
      status: "PARTIAL",
      confidence: "medium",
      confidence_reason: "Proof is still incomplete.",
      findings: ["A concrete fix was proposed."],
      issues: ["The result is not proven."]
    },
    next_prompt_output: {
      next_prompt: "Verify the missing proof.",
      prompt_strategy: "fix_missing"
    },
    acceptance_checklist: [
      { label: "The answer names the concrete fix", status: "met" },
      { label: "The answer shows evidence the result works", status: "not_sure" }
    ],
    response_summary: preprocessResponse("Updated the logic."),
    used_fallback_intent: false,
    token_usage_total: 0
  }
}

async function main() {
  const outdir = await mkdtemp(path.join(os.tmpdir(), "gold-review-cases-"))
  try {
    await bundleModules(outdir)
    const taskTypeMod = await import(pathToFileURL(path.join(outdir, "services/review-task-type.js")).href)
    const analysisMod = await import(pathToFileURL(path.join(outdir, "services/review-analysis.js")).href)
    const promptModeMod = await import(pathToFileURL(path.join(outdir, "services/review-prompt-mode.js")).href)
    const viewModelMod = await import(pathToFileURL(path.join(outdir, "mappers/review-view-model.js")).href)

    const { classifyReviewTaskType } = taskTypeMod
    const { createReviewAnalysisRunner } = analysisMod
    const { buildPromptModePromptContract } = promptModeMod
    const { mapAfterAnalysisToReviewViewModel } = viewModelMod

    const runner = createReviewAnalysisRunner({
      analyzeAfterAttempt: async () => makeProofResult(),
      attachAnalysisResult: async () => null,
      preprocessResponse,
      getProjectMemoryContext: () => ({ projectContext: "", currentState: "" }),
      collectChangedFilesSummary: () => [],
      collectVisibleErrorSummary: () => ""
    })

    for (const file of await readdir(path.join(scriptDir, "gold-review-cases"))) {
      const testCase = JSON.parse(await readFile(path.join(scriptDir, "gold-review-cases", file), "utf8"))
      const attempt = makeAttempt(testCase.prompt, testCase.initialTaskType ?? "other")
      const taskType = classifyReviewTaskType(attempt)
      assert.equal(taskType, testCase.expectedTaskType, `${testCase.name}: task type mismatch`)
      const result = await runner({
        target: {
          attempt,
          taskType,
          responseText: testCase.response,
          responseIdentity: `${testCase.name}-response`,
          threadIdentity: `${testCase.name}-thread`,
          normalizedResponseText: testCase.response.toLowerCase()
        },
        mode: "deep",
        quickBaseline: null
      })
      const labels = result.acceptance_checklist.map((item) => item.label).join("\n")
      for (const expected of testCase.mustIncludeChecklist) {
        assert.match(labels, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${testCase.name}: missing checklist ${expected}`)
      }
      const viewModel = mapAfterAnalysisToReviewViewModel({
        result,
        mode: "deep",
        taskType,
        quickBaseline: null,
        onCopyPrompt: () => {}
      })
      const viewText = [
        viewModel.decision,
        viewModel.recommendedAction,
        ...viewModel.missingItems,
        ...viewModel.whyItems,
        ...viewModel.uncheckedArtifacts,
        ...viewModel.checklistRows.map((item) => item.label)
      ].join("\n")
      for (const forbidden of testCase.forbiddenPhrases) {
        assert.doesNotMatch(viewText, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `${testCase.name}: forbidden phrase ${forbidden}`)
      }
    }

    for (const file of await readdir(path.join(scriptDir, "gold-prompt-cases"))) {
      const testCase = JSON.parse(await readFile(path.join(scriptDir, "gold-prompt-cases", file), "utf8"))
      const contract = buildPromptModePromptContract({
        sourcePrompt: testCase.sourcePrompt,
        planningGoal: testCase.planningGoal,
        refinedPrompt: testCase.refinedPrompt,
        localAnalysis: {
          score: "MID",
          intent: "BUILD",
          missing_elements: [],
          suggestions: [],
          rewrite: null,
          clarification_questions: [],
          draft_prompt: null,
          question_source: "NONE",
          ai_available: false
        },
        answeredPath: testCase.answeredPath,
        constraints: testCase.constraints
      })
      for (const expected of testCase.expectedIncludes) {
        assert.match(contract.renderedPrompt, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${testCase.name}: missing ${expected}`)
      }
      for (const forbidden of testCase.forbiddenPhrases) {
        assert.doesNotMatch(contract.renderedPrompt, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `${testCase.name}: forbidden phrase ${forbidden}`)
      }
    }

    console.log("gold-cases-smoke: ok")
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
