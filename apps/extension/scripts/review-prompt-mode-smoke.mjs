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
      path.resolve(extensionRoot, "lib/review/orchestrator/review-prompt-mode-orchestrator.ts"),
      path.resolve(extensionRoot, "lib/review/services/review-prompt-mode.ts")
    ],
    outdir,
    bundle: true,
    format: "esm",
    platform: "node"
  })
}

function makeQuestion(id, label, options) {
  return {
    id,
    label,
    helper: `${label} helper`,
    mode: "single",
    options
  }
}

async function main() {
  const outdir = await mkdtemp(path.join(os.tmpdir(), "review-prompt-mode-"))
  try {
    await bundleModules(outdir)

    const orchestratorMod = await import(pathToFileURL(path.join(outdir, "orchestrator/review-prompt-mode-orchestrator.js")).href)
    const { createReviewPromptModeOrchestrator } = orchestratorMod

    const states = []
    const prompt = "website code for a basic CV. css and html"
    let resolveBranch
    let lastRefineInput = null

    const orchestrator = createReviewPromptModeOrchestrator({
      getPlatform: () => "replit",
      getSurface: () => "REPLIT",
      getSessionSummary: () => null,
      getProjectMemoryContext: () => ({ projectContext: "", currentState: "" }),
      extendQuestions: async (input) => {
        if (!input.existing_questions.length) {
          return {
            clarification_questions: [
              makeQuestion("q1", "What matters most in the first draft?", [
                "Correct structure first",
                "Requested format first",
                "Usable starter content",
                "Minimal starter only",
                "Other"
              ])
            ],
            ai_available: true
          }
        }

        const firstAnswer = input.answers.q1
        if (firstAnswer === "Requested format first") {
          return new Promise((resolve) => {
            resolveBranch = () =>
              resolve({
                clarification_questions: [
                  makeQuestion("q2b", "Which format detail matters most next?", ["HTML structure", "Embedded CSS", "Both"]),
                  makeQuestion("q3", "What content should the starter emphasize?", ["Experience first", "Skills first", "Balanced summary"])
                ],
                ai_available: true
              })
          })
        }

        return {
          clarification_questions: [makeQuestion("q2", "What should the starter include next?", ["Header", "Experience section", "Skills section", "Other"])],
          ai_available: true
        }
      },
      refinePrompt: async (input) => {
        lastRefineInput = input
        return {
          improved_prompt:
            "Create a basic CV website using HTML with embedded CSS. Keep it clean, readable, and ready to use as a polished starter, with special attention to the requested format details."
        }
      },
      onStateChange: (state) => {
        states.push(state)
      }
    })

    await orchestrator.open({
      promptText: prompt,
      beforeIntent: "BUILD"
    })

    let state = orchestrator.getState()
    assert.equal(state.planningGoal, prompt)
    assert.equal(state.popupState, "questions")
    assert.equal(state.questionHistory.length > 0, true)
    assert.equal(state.questionHistory[0].label, "What matters most in the first draft?")

    await orchestrator.setAnswer(state.questionHistory[0], "Correct structure first")
    state = orchestrator.getState()
    assert.equal(state.questionHistory.length, 2)
    assert.equal(state.questionHistory[1].id, "q2")

    orchestrator.setActiveQuestionIndex(0)
    const branchAdvancePromise = orchestrator.setAnswer(state.questionHistory[0], "Requested format first")
    state = orchestrator.getState()
    assert.equal(state.isLoadingQuestions, true)
    assert.equal(state.answerState.q1, "Requested format first")
    resolveBranch()
    await branchAdvancePromise
    state = orchestrator.getState()
    assert.equal(state.questionHistory.length, 3)
    assert.equal(state.questionHistory[1].id, "q2b")
    assert.equal(state.questionHistory[2].id, "q3")
    assert.equal(state.isLoadingQuestions, false)
    assert.equal(state.activeQuestionIndex, 1)

    await orchestrator.setAnswer(state.questionHistory[1], "Embedded CSS")
    state = orchestrator.getState()
    assert.equal(state.activeQuestionIndex, 2)
    assert.equal(state.questionHistory[state.activeQuestionIndex].id, "q3")

    await orchestrator.generatePrompt()
    state = orchestrator.getState()
    assert.equal(state.promptReady, true)
    assert.match(state.promptDraft, /Task \/ goal:/)
    assert.match(state.promptDraft, /Key requirements:/)
    assert.match(state.promptDraft, /Output format:/)
    assert.equal(state.promptDraft.includes("embedded CSS"), true)
    assert.equal(state.promptDraft.includes("HTML"), true)
    assert.equal(Boolean(lastRefineInput), true)
    assert.match(lastRefineInput.prompt, /Rewrite the user's typed draft into a strong, polished prompt/)
    assert.match(lastRefineInput.prompt, /Original Draft/)
    assert.match(lastRefineInput.prompt, /Clarified Choices/)
    assert.match(lastRefineInput.prompt, /Output Guidance/)

    assert.equal(states.some((entry) => entry.popupState === "loading"), true)
    assert.equal(states.some((entry) => entry.isLoadingQuestions === true), true)
    console.log("review-prompt-mode-smoke: ok")
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}

await main()
