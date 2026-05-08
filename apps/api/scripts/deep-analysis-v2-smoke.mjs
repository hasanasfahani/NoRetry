import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "esbuild"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const apiRoot = path.resolve(scriptDir, "..")
const repoRoot = path.resolve(apiRoot, "../..")

async function main() {
  const outdir = await mkdtemp(path.join(os.tmpdir(), "api-deep-analysis-v2-smoke-"))
  try {
    await build({
      entryPoints: [path.resolve(apiRoot, "lib/deep-analysis-v2.ts")],
      outdir,
      bundle: true,
      format: "esm",
      platform: "node",
      tsconfig: path.resolve(repoRoot, "tsconfig.base.json")
    })

    const mod = await import(pathToFileURL(path.join(outdir, "deep-analysis-v2.js")).href)
    const { buildDeepAnalysisV2Fallback, runDeepAnalysisV2 } = mod

    const input = {
      promptText:
        "Act like Replit’s coding agent. I am building a simple booking app. Phase 1 goal: create the booking form UI only. Reply very briefly like a coding agent after completing the work. Do not include code. Say what you changed, confirm Phase 1 is done, and tell me the next phase.",
      responseText:
        "Created booking form UI with fields (name, email, date, time, service, notes), added validation states, and basic layout styling. Phase 1 complete. Next phase: connect form to backend (submit handler + data storage).",
      projectContext: "Building a booking app in phases for a non-technical founder.",
      currentState: "Phase 1 UI was requested.",
      taskType: "creation",
      surface: "chatgpt"
    }

    const fallback = buildDeepAnalysisV2Fallback(input, 12)
    assert.equal(fallback.version, "deep-analysis-v2.v1")
    assert.equal(fallback.overallStatus, "pass")
    assert.equal(fallback.providerMetadata.provider, "fallback")
    assert.equal(fallback.providerMetadata.usedFallback, true)
    assert.equal(fallback.assistantSuggestedNextMove, "connect form to backend (submit handler + data storage)")
    assert.equal(fallback.nextStepSource, "assistant_suggestion")
    assert.equal(fallback.promptIntent, "implement_next_step")
    assert.deepEqual(fallback.nextStepRequirements, [
      "Add required field validation",
      "Show clear error messages",
      "Prevent empty submission",
      "Show a booking confirmation summary"
    ])
    assert.deepEqual(fallback.blockedScope, ["Do not connect a backend yet"])
    assert.match(fallback.generatedPrompt, /- Add required field validation/)
    assert.match(fallback.generatedPrompt, /Do not connect a backend yet\./)
    assert.match(fallback.generatedPrompt, /After you finish, confirm which requirements were completed and suggest the next step\./)

    const kimiOutput = JSON.stringify({
      version: "deep-analysis-v2.v1",
      requirements: [{ id: "phase_1_ui", text: "Complete Phase 1: create the booking form UI only.", source: "submitted_prompt" }],
      requirementMatches: [
        {
          requirementId: "phase_1_ui",
          requirementText: "Complete Phase 1: create the booking form UI only.",
          status: "pass",
          evidence: ["Created booking form UI."],
          note: "The answer confirms the requested UI work."
        }
      ],
      overallStatus: "pass",
      assistantSuggestedNextMove: "connect form to backend",
      recommendedNextMove: "Continue with validation before backend.",
      nextStepSource: "assistant_suggestion",
      nextStepRequirements: [
        "Add required field validation",
        "Show clear error messages",
        "Prevent empty submission",
        "Show a booking confirmation summary"
      ],
      blockedScope: ["backend", "API", "database", "storage"],
      promptIntent: "implement_next_step",
      generatedPrompt:
        "Please implement the best next step now:\n- Add required field validation\n- Show clear error messages\n- Prevent empty submission\n- Show a booking confirmation summary\n\nDo not connect backend, API, database, or storage yet.\n\nAfter you finish, confirm which requirements were completed and suggest the next step.",
      confidence: "high",
      userExplanation: "The answer satisfies the request and the safer next step is validation.",
      providerMetadata: {
        provider: "kimi",
        timedOut: false,
        usedFallback: false
      }
    })
    const kimiResult = await runDeepAnalysisV2(input, {
      callJson: async () => kimiOutput,
      now: () => 100
    })
    assert.equal(kimiResult.overallStatus, "pass")
    assert.equal(kimiResult.providerMetadata.provider, "kimi")
    assert.equal(kimiResult.providerMetadata.usedFallback, false)
    assert.equal(kimiResult.providerMetadata.latencyMs, 0)
    assert.equal(kimiResult.nextStepSource, "assistant_suggestion")
    assert.equal(kimiResult.promptIntent, "implement_next_step")
    assert.deepEqual(kimiResult.nextStepRequirements, [
      "Add required field validation",
      "Show clear error messages",
      "Prevent empty submission",
      "Show a booking confirmation summary"
    ])
    assert.deepEqual(kimiResult.blockedScope, ["backend", "API", "database", "storage"])

    const repairedKimiOutput = JSON.stringify({
      ...JSON.parse(kimiOutput),
      generatedPrompt: "Please implement the best next step now:\n- Add required field validation",
      nextStepRequirements: [
        "Add required field validation",
        "Show clear error messages",
        "Prevent empty submission",
        "Show a booking confirmation summary"
      ],
      blockedScope: ["backend", "API", "database", "storage"]
    })
    const repairedKimiResult = await runDeepAnalysisV2(input, {
      callJson: async () => repairedKimiOutput
    })
    assert.match(repairedKimiResult.generatedPrompt, /Show clear error messages/)
    assert.match(repairedKimiResult.generatedPrompt, /Prevent empty submission/)
    assert.match(repairedKimiResult.generatedPrompt, /Show a booking confirmation summary/)
    assert.match(repairedKimiResult.generatedPrompt, /Do not add backend, add API, add database, or add storage yet\./)
    assert.match(repairedKimiResult.generatedPrompt, /After you finish, confirm which requirements were completed and suggest the next step\.$/)

    const noSuggestionKimiOutput = JSON.stringify({
      ...JSON.parse(kimiOutput),
      assistantSuggestedNextMove: null,
      nextStepSource: "assistant_suggestion",
      promptIntent: "implement_next_step",
      recommendedNextMove: "Ask the assistant to suggest the safest next step.",
      nextStepRequirements: [],
      generatedPrompt: ""
    })
    const noSuggestionResult = await runDeepAnalysisV2(input, {
      callJson: async () => noSuggestionKimiOutput
    })
    assert.equal(noSuggestionResult.nextStepSource, "unavailable")
    assert.equal(noSuggestionResult.promptIntent, "ask_for_next_step")
    assert.match(noSuggestionResult.generatedPrompt, /suggest the safest next step/i)

    const invalidResult = await runDeepAnalysisV2(input, {
      callJson: async () => JSON.stringify({ confidence: "certain" })
    })
    assert.equal(invalidResult.providerMetadata.provider, "fallback")
    assert.equal(invalidResult.providerMetadata.usedFallback, true)
    assert.equal(invalidResult.providerMetadata.providerAttempted, "kimi")
    assert.equal(invalidResult.providerMetadata.fallbackReason, "invalid_json")
    assert.equal(invalidResult.overallStatus, "pass")

    const emptyResult = await runDeepAnalysisV2(input, {
      callJson: async () => null
    })
    assert.equal(emptyResult.providerMetadata.provider, "fallback")
    assert.equal(emptyResult.providerMetadata.usedFallback, true)
    assert.equal(emptyResult.providerMetadata.providerAttempted, "kimi")
    assert.equal(emptyResult.providerMetadata.fallbackReason, "empty_response")

    const deepSeekOutput = JSON.stringify({
      ...JSON.parse(kimiOutput),
      providerMetadata: {
        provider: "deepseek",
        timedOut: false,
        usedFallback: false
      }
    })
    const deepSeekResult = await runDeepAnalysisV2(input, {
      callKimiJson: async () => {
        throw new Error("Kimi failed fast")
      },
      callDeepSeekJson: async () => deepSeekOutput,
      now: () => 100
    })
    assert.equal(deepSeekResult.providerMetadata.provider, "deepseek")
    assert.equal(deepSeekResult.providerMetadata.usedFallback, false)

    const timedOutResult = await runDeepAnalysisV2(input, {
      callKimiJson: async () => new Promise((resolve) => setTimeout(() => resolve(kimiOutput), 40)),
      callDeepSeekJson: async () => {
        throw new Error("DeepSeek should not run after Kimi timeout")
      },
      hardTimeoutMs: 1
    })
    assert.equal(timedOutResult.providerMetadata.provider, "fallback")
    assert.equal(timedOutResult.providerMetadata.timedOut, true)
    assert.equal(timedOutResult.providerMetadata.providerAttempted, "kimi")
    assert.equal(timedOutResult.providerMetadata.fallbackReason, "timeout")

    const healthOk = await mod.checkDeepAnalysisV2ProviderHealth({
      callJson: async () => JSON.stringify({ ok: true }),
      now: () => 100
    })
    assert.equal(healthOk.ok, true)
    assert.equal(healthOk.provider, "kimi")

    console.log("api-deep-analysis-v2-smoke: ok")
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
