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
      path.resolve(extensionRoot, "lib/review/services/review-target.ts"),
      path.resolve(extensionRoot, "lib/review/orchestrator/review-popup-orchestrator.ts"),
      path.resolve(extensionRoot, "lib/core/after-orchestration.ts")
    ],
    outdir,
    entryNames: "[name]",
    bundle: true,
    format: "esm",
    platform: "node"
  })
}

function makeAttempt(id, prompt, createdAt) {
  return {
    attempt_id: id,
    platform: "replit",
    raw_prompt: prompt,
    optimized_prompt: prompt,
    intent: {
      task_type: "build",
      goal: prompt,
      constraints: [],
      acceptance_criteria: []
    },
    status: "submitted",
    created_at: createdAt,
    submitted_at: createdAt,
    response_text: null,
    response_message_id: null,
    analysis_result: null,
    token_usage_total: 0,
    stage_cache: {}
  }
}

async function main() {
  const outdir = await mkdtemp(path.join(os.tmpdir(), "review-answer-mode-"))
  try {
    await bundleModules(outdir)

    const targetMod = await import(pathToFileURL(path.join(outdir, "review-target.js")).href)
    const orchestratorMod = await import(pathToFileURL(path.join(outdir, "review-popup-orchestrator.js")).href)
    const afterMod = await import(pathToFileURL(path.join(outdir, "after-orchestration.js")).href)
    const { createReviewTargetResolver } = targetMod
    const { createReviewPopupOrchestrator } = orchestratorMod
    const { buildAfterPlaceholder } = afterMod

    const olderAttempt = makeAttempt("attempt-old", "old prompt", "2026-04-15T09:00:00.000Z")
    const matchingAttempt = makeAttempt("attempt-new", "website code for a basic CV. css and html", "2026-04-15T09:01:00.000Z")

    const resolver = createReviewTargetResolver({
      getLatestAssistantResponse: () => ({
        node: null,
        text: "Here is a complete HTML document with embedded CSS.",
        identity: "assistant-1"
      }),
      getLatestUserPrompt: () => ({
        text: "website code for a basic CV. css and html"
      }),
      getThread: () => ({
        identity: "thread-1"
      }),
      getLatestSubmittedAttempt: async () => olderAttempt,
      getReviewableAttempts: async () => [olderAttempt, matchingAttempt],
      ensureSubmittedAttempt: async () => null,
      readAssistantMessageIdentity: () => "assistant-1",
      normalizeResponseText: (value) => value.trim().toLowerCase()
    })

    const resolved = await resolver()
    assert.equal(resolved.ok, true)
    assert.equal(resolved.target.attempt.attempt_id, "attempt-new")

    const fallbackAttempt = makeAttempt("attempt-fallback", "latest prompt", "2026-04-15T09:02:00.000Z")
    const fallbackResolver = createReviewTargetResolver({
      getLatestAssistantResponse: () => ({
        node: null,
        text: "Latest assistant reply",
        identity: "assistant-2"
      }),
      getLatestUserPrompt: () => ({
        text: "latest prompt"
      }),
      getThread: () => ({
        identity: "thread-2"
      }),
      getLatestSubmittedAttempt: async () => null,
      getReviewableAttempts: async () => [],
      ensureSubmittedAttempt: async () => fallbackAttempt,
      readAssistantMessageIdentity: () => "assistant-2",
      normalizeResponseText: (value) => value.trim().toLowerCase()
    })

    const fallbackResolved = await fallbackResolver()
    assert.equal(fallbackResolved.ok, true)
    assert.equal(fallbackResolved.target.attempt.attempt_id, "attempt-fallback")

    const states = []
    let resolveCalls = 0
    const orchestrator = createReviewPopupOrchestrator({
      resolveTarget: async () => {
        resolveCalls += 1
        if (resolveCalls < 3) {
          return { ok: false, reason: "no_submitted_attempt" }
        }
        return {
          ok: true,
          target: {
            attempt: matchingAttempt,
            taskType: "creation",
            responseText: "Fresh assistant reply",
            responseIdentity: "assistant-3",
            threadIdentity: "thread-3",
            normalizedResponseText: "fresh assistant reply"
          }
        }
      },
      runAnalysis: async () =>
        ({
          ...buildAfterPlaceholder("Looks grounded now", [], "next prompt"),
          status: "SUCCESS",
          confidence: "high",
          acceptance_checklist: [
            {
              label: "The answer addresses the requested output",
              status: "met"
            }
          ],
          findings: ["The answer matches the requested goal."],
          response_summary: {
            response_text: "Fresh assistant reply",
            response_length: 20,
            first_excerpt: "Fresh assistant reply",
            last_excerpt: "Fresh assistant reply",
            key_paragraphs: [],
            has_code_blocks: false,
            mentioned_files: [],
            certainty_signals: [],
            uncertainty_signals: [],
            success_signals: [],
            failure_signals: []
          }
        }),
      onStateChange: (state) => {
        states.push(state)
      },
      onOpenChange: () => {},
      onCopyPrompt: () => {}
    })

    await orchestrator.open()
    const finalState = states.at(-1)
    assert.equal(resolveCalls, 3)
    assert.equal(finalState.controller.popupState, "deep_review")
    assert.equal(finalState.controller.errorReason, null)

    console.log("review-answer-mode-smoke: ok")
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}

await main()
