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
      path.resolve(extensionRoot, "lib/review/services/review-task-type.ts"),
      path.resolve(extensionRoot, "lib/review/services/review-analysis.ts"),
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
  const paragraphs = responseText.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean)
  const mentionedFiles = Array.from(new Set(responseText.match(/\b[\w./-]+\.(?:html|css|js|ts|tsx)\b/gi) ?? []))
  return {
    response_text: responseText,
    response_length: responseText.length,
    first_excerpt: responseText.slice(0, 120),
    last_excerpt: responseText.slice(-120),
    key_paragraphs: paragraphs.slice(0, 2),
    has_code_blocks: responseText.includes("```"),
    mentioned_files: mentionedFiles,
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

function makeBrokenPromptChecklistResult(promptLabel) {
  return {
    ...makeProofResult(),
    confidence_reason: "Only 0 of 1 checklist items are confirmed.",
    findings: ["The generated prompt still needs stronger proof."],
    issues: ["The output is not proven yet."],
    next_prompt: "Show the exact change and prove it works.",
    prompt_strategy: "fix_missing",
    acceptance_checklist: [{ label: promptLabel, status: "not_sure" }]
  }
}

async function main() {
  const outdir = await mkdtemp(path.join(os.tmpdir(), "review-routing-smoke-"))
  try {
    await bundleModules(outdir)

    const taskTypeMod = await import(pathToFileURL(path.join(outdir, "services/review-task-type.js")).href)
    const analysisMod = await import(pathToFileURL(path.join(outdir, "services/review-analysis.js")).href)
    const viewModelMod = await import(pathToFileURL(path.join(outdir, "mappers/review-view-model.js")).href)

    const { classifyReviewTaskType } = taskTypeMod
    const { createReviewAnalysisRunner } = analysisMod
    const { mapAfterAnalysisToReviewViewModel } = viewModelMod

    let analyzeCalls = 0
    const runner = createReviewAnalysisRunner({
      analyzeAfterAttempt: async () => {
        analyzeCalls += 1
        return makeProofResult()
      },
      attachAnalysisResult: async () => null,
      preprocessResponse,
      getProjectMemoryContext: () => ({ projectContext: "", currentState: "" }),
      collectChangedFilesSummary: () => [],
      collectVisibleErrorSummary: () => ""
    })

    const creationAttempt = makeAttempt("website code for a basic CV. css and html", "build")
    const creationTaskType = classifyReviewTaskType(creationAttempt)
    assert.equal(creationTaskType, "creation")
    analyzeCalls = 0
    const creationResult = await runner({
      target: {
        attempt: creationAttempt,
        taskType: creationTaskType,
        responseText: "```html\n<!doctype html>\n<html>\n  <head>\n    <title>Basic CV</title>\n    <style>\n      body { font-family: Arial, sans-serif; margin: 0; }\n      .cv { max-width: 720px; margin: 0 auto; padding: 32px; }\n    </style>\n  </head>\n  <body>\n    <main class=\"cv\">\n      <section>\n        <h1>Jane Doe</h1>\n        <p>Frontend Developer</p>\n      </section>\n      <section>\n        <h2>Experience</h2>\n        <p>Example role summary</p>\n      </section>\n      <section>\n        <h2>Education</h2>\n        <p>Example education summary</p>\n      </section>\n      <section>\n        <h2>Skills</h2>\n        <p>HTML, CSS, JavaScript</p>\n      </section>\n      <section>\n        <h2>Contact</h2>\n        <p>jane@example.com</p>\n      </section>\n    </main>\n  </body>\n</html>\n```",
        responseIdentity: "resp-1",
        threadIdentity: "thread-1",
        normalizedResponseText: "section cv max width"
      },
      mode: "deep",
      quickBaseline: null
    })
    assert.equal(analyzeCalls, 0)
    assert.deepEqual(
      creationResult.acceptance_checklist.map((item) => item.label),
      [
        "The answer provides the requested deliverable",
        "The output matches the requested format and scope",
        "The deliverable is complete enough to use as a starting point"
      ]
    )
    assert.deepEqual(
      creationResult.acceptance_checklist.map((item) => item.status),
      ["met", "met", "met"]
    )
    const creationViewModel = mapAfterAnalysisToReviewViewModel({
      result: creationResult,
      mode: "deep",
      taskType: creationTaskType,
      quickBaseline: null,
      onCopyPrompt: () => {}
    })
    assert.equal(creationViewModel.confidenceLabel, "Confidence: Usable")

    const debugAttempt = makeAttempt("find and fix why the button is not visible", "debug")
    const debugTaskType = classifyReviewTaskType(debugAttempt)
    assert.equal(debugTaskType, "debug")
    analyzeCalls = 0
    await runner({
      target: {
        attempt: debugAttempt,
        taskType: debugTaskType,
        responseText: "I updated the selector and the button mounting logic in app.tsx, but runtime verification is still missing.",
        responseIdentity: "resp-2",
        threadIdentity: "thread-2",
        normalizedResponseText: "updated selector button mounting logic"
      },
      mode: "deep",
      quickBaseline: null
    })
    assert.equal(analyzeCalls, 1)

    const writingAttempt = makeAttempt("rewrite this message to sound more professional", "other")
    const writingTaskType = classifyReviewTaskType(writingAttempt)
    assert.equal(writingTaskType, "writing")
    analyzeCalls = 0
    const writingResult = await runner({
      target: {
        attempt: writingAttempt,
        taskType: writingTaskType,
        responseText: "I appreciate your time and would be glad to discuss this further at your convenience.",
        responseIdentity: "resp-3",
        threadIdentity: "thread-3",
        normalizedResponseText: "i appreciate your time"
      },
      mode: "deep",
      quickBaseline: null
    })
    assert.equal(analyzeCalls, 0)
    assert.deepEqual(
      writingResult.acceptance_checklist.map((item) => item.label),
      [
        "The answer provides the requested rewrite",
        "The rewrite matches the requested tone and clarity",
        "The rewritten text is polished enough to use"
      ]
    )

    const verificationAttempt = makeAttempt("verify whether this solution is actually working", "other")
    const verificationTaskType = classifyReviewTaskType(verificationAttempt)
    assert.equal(verificationTaskType, "verification")
    analyzeCalls = 0
    await runner({
      target: {
        attempt: verificationAttempt,
        taskType: verificationTaskType,
        responseText: "The solution updates the timeout logic, but there is still no runtime proof.",
        responseIdentity: "resp-4",
        threadIdentity: "thread-4",
        normalizedResponseText: "updates timeout logic"
      },
      mode: "deep",
      quickBaseline: null
    })
    assert.equal(analyzeCalls, 1)

    const promptArtifactRunner = createReviewAnalysisRunner({
      analyzeAfterAttempt: async ({ attempt }) => {
        analyzeCalls += 1
        return makeBrokenPromptChecklistResult(`Task / goal: ${attempt.raw_prompt}`)
      },
      attachAnalysisResult: async () => null,
      preprocessResponse,
      getProjectMemoryContext: () => ({ projectContext: "", currentState: "" }),
      collectChangedFilesSummary: () => [],
      collectVisibleErrorSummary: () => ""
    })

    const recipePromptAttempt = makeAttempt("Give me an oven-baked, nut-free preschool lunch for 3-4 kids.", "other")
    const recipePromptTaskType = classifyReviewTaskType(recipePromptAttempt)
    assert.equal(recipePromptTaskType, "creation")
    analyzeCalls = 0
    const recipePromptResult = await promptArtifactRunner({
      target: {
        attempt: recipePromptAttempt,
        taskType: recipePromptTaskType,
        responseText: [
          "Task / goal:",
          "Create an oven-baked, nut-free preschool lunch for 3-4 kids.",
          "",
          "Key requirements:",
          "- Keep it practical for young kids.",
          "",
          "Constraints:",
          "- Oven-baked only.",
          "- Nut-free.",
          "- Make enough for 3-4 kids.",
          "",
          "Output format:",
          "- Include ingredients with quantities.",
          "- Include simple steps.",
          "",
          "Quality bar / style guardrails:",
          "- Keep it realistic and easy to make."
        ].join("\n"),
        responseIdentity: "resp-5",
        threadIdentity: "thread-5",
        normalizedResponseText: "task goal oven baked nut free preschool lunch"
      },
      mode: "deep",
      quickBaseline: null
    })
    assert.equal(analyzeCalls, 0)
    assert.deepEqual(
      recipePromptResult.acceptance_checklist.map((item) => item.label),
      [
        "The generated prompt preserves the user’s core goal",
        "The generated prompt preserves important constraints",
        "The generated prompt is structured and clear",
        "The generated prompt is usable as a send-ready prompt"
      ]
    )
    const recipePromptViewModel = mapAfterAnalysisToReviewViewModel({
      result: recipePromptResult,
      mode: "deep",
      taskType: recipePromptTaskType,
      quickBaseline: null,
      onCopyPrompt: () => {}
    })
    assert.doesNotMatch(recipePromptViewModel.recommendedAction, /exact change|result works|real proof/i)
    assert.equal(recipePromptViewModel.confidenceLabel, "Confidence: Needs review")

    const codePromptAttempt = makeAttempt("Give me a prompt to build a basic CV website with HTML and CSS.", "other")
    const codePromptTaskType = classifyReviewTaskType(codePromptAttempt)
    assert.equal(codePromptTaskType, "creation")
    const codePromptResult = await promptArtifactRunner({
      target: {
        attempt: codePromptAttempt,
        taskType: codePromptTaskType,
        responseText: [
          "Task / goal:",
          "Create a basic CV website using HTML with embedded CSS.",
          "",
          "Key requirements:",
          "- Keep it directly usable as a starter.",
          "",
          "Constraints:",
          "- Use HTML.",
          "- Include CSS.",
          "",
          "Output format:",
          "- Return a send-ready prompt."
        ].join("\n"),
        responseIdentity: "resp-6",
        threadIdentity: "thread-6",
        normalizedResponseText: "task goal cv website html css"
      },
      mode: "deep",
      quickBaseline: null
    })
    assert.deepEqual(
      codePromptResult.acceptance_checklist.map((item) => item.label),
      [
        "The generated prompt preserves the user’s core goal",
        "The generated prompt preserves important constraints",
        "The generated prompt is structured and clear",
        "The generated prompt is usable as a send-ready prompt"
      ]
    )

    const rewritePromptAttempt = makeAttempt("Rewrite this message to sound more professional.", "other")
    const rewritePromptTaskType = classifyReviewTaskType(rewritePromptAttempt)
    assert.equal(rewritePromptTaskType, "writing")
    const rewritePromptResult = await promptArtifactRunner({
      target: {
        attempt: rewritePromptAttempt,
        taskType: rewritePromptTaskType,
        responseText: [
          "Task / goal:",
          "Rewrite the message in a more professional tone.",
          "",
          "Constraints:",
          "- Preserve the original meaning.",
          "- Keep the tone polished and concise.",
          "",
          "Output format:",
          "- Return the rewritten message only."
        ].join("\n"),
        responseIdentity: "resp-7",
        threadIdentity: "thread-7",
        normalizedResponseText: "task goal rewrite message professional tone"
      },
      mode: "deep",
      quickBaseline: null
    })
    assert.deepEqual(
      rewritePromptResult.acceptance_checklist.map((item) => item.label),
      [
        "The generated prompt preserves the user’s core goal",
        "The generated prompt preserves important constraints",
        "The generated prompt is structured and clear",
        "The generated prompt is usable as a send-ready prompt"
      ]
    )

    console.log("review-routing-smoke: ok")
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}

await main()
