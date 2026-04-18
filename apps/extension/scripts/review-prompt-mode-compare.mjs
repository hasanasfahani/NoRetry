import assert from "node:assert/strict"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "esbuild"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(scriptDir, "..")
const casesDir = path.resolve(scriptDir, "prompt-mode-compare-cases")

async function bundleModules(outdir) {
  await build({
    entryPoints: [
      path.resolve(extensionRoot, "lib/review/orchestrator/review-prompt-mode-orchestrator.ts"),
      path.resolve(extensionRoot, "lib/review/orchestrator/review-prompt-mode-v2-orchestrator.ts"),
      path.resolve(extensionRoot, "lib/review/v2/comparison-harness.ts")
    ],
    outdir,
    bundle: true,
    format: "esm",
    platform: "node"
  })
}

async function loadCases() {
  const entries = (await readdir(casesDir)).filter((entry) => entry.endsWith(".json")).sort()
  return Promise.all(
    entries.map(async (entry) => JSON.parse(await readFile(path.join(casesDir, entry), "utf8")))
  )
}

function findV2Question(state, answerSpec) {
  const bySection = answerSpec.sectionId
    ? state.questionHistory.find((question) => question.sectionId === answerSpec.sectionId)
    : null
  if (bySection) return bySection
  if (answerSpec.questionIdContains) {
    const normalizedNeedle = answerSpec.questionIdContains.toLowerCase()
    const byId = state.questionHistory.find((question) => question.id.toLowerCase().includes(normalizedNeedle))
    if (byId) return byId
  }
  return state.questionHistory[state.activeQuestionIndex] ?? null
}

async function runLegacyCase(caseData, createReviewPromptModeOrchestrator) {
  const states = []
  let initialQuestionsDelivered = false

  const orchestrator = createReviewPromptModeOrchestrator({
    getPlatform: () => "replit",
    getSurface: () => "REPLIT",
    getSessionSummary: () => null,
    getProjectMemoryContext: () => ({ projectContext: "", currentState: "" }),
    extendQuestions: async () => {
      if (initialQuestionsDelivered) {
        return {
          clarification_questions: [],
          ai_available: true
        }
      }
      initialQuestionsDelivered = true
      return {
        clarification_questions: caseData.legacy.questions.map((question) => ({
          id: question.id,
          label: question.label,
          helper: question.helper,
          mode: "single",
          options: question.options
        })),
        ai_available: true
      }
    },
    refinePrompt: async ({ prompt }) => ({
      improved_prompt: prompt
    }),
    onStateChange: (state) => {
      states.push(state)
    }
  })

  await orchestrator.open({
    promptText: caseData.promptText,
    beforeIntent: caseData.beforeIntent
  })

  let state = orchestrator.getState()
  assert.equal(state.popupState, "questions")

  for (let index = 0; index < caseData.legacy.questions.length; index += 1) {
    const legacyQuestion = caseData.legacy.questions[index]
    const question = state.questionHistory[index] ?? state.currentLevelQuestions[index] ?? state.questionHistory[state.activeQuestionIndex]
    assert.ok(question, `Legacy displayed question should exist for ${caseData.id} at index ${index}`)
    await orchestrator.setAnswer(question, legacyQuestion.answer)
    state = orchestrator.getState()
  }

  await orchestrator.generatePrompt()
  state = orchestrator.getState()
  assert.equal(state.promptReady, true, `Legacy prompt should be ready for ${caseData.id}`)

  return {
    questions: state.questionHistory.map((question) => ({
      label: question.label,
      helper: question.helper ?? ""
    })),
    promptDraft: state.promptDraft,
    validation: null,
    state,
    states
  }
}

async function runV2Case(caseData, createReviewPromptModeV2Orchestrator) {
  const states = []
  const orchestrator = createReviewPromptModeV2Orchestrator({
    onStateChange: (state) => {
      states.push(state)
    }
  })

  await orchestrator.open({
    promptText: caseData.promptText,
    beforeIntent: caseData.beforeIntent
  })

  let state = orchestrator.getState()
  assert.equal(state.popupState, "entry")

  if (state.clarifyingQuestion && caseData.v2.clarifyingAnswer) {
    orchestrator.setClarifyingAnswer(caseData.v2.clarifyingAnswer)
    state = orchestrator.getState()
  }

  orchestrator.selectTaskType(caseData.taskType)
  state = orchestrator.getState()
  assert.equal(state.selectedTaskType, caseData.taskType)

  for (const answerSpec of caseData.v2.answers) {
    state = orchestrator.getState()
    const question = findV2Question(state, answerSpec)
    assert.ok(question, `V2 question should exist for ${caseData.id}`)

    if (Array.isArray(answerSpec.answer)) {
      orchestrator.setAnswer(question, answerSpec.answer)
      if (answerSpec.other) {
        orchestrator.setOtherAnswer(question, answerSpec.other)
        orchestrator.advanceOther()
      }
    } else if (answerSpec.answer === "Other" && answerSpec.other) {
      orchestrator.setAnswer(question, "Other")
      orchestrator.setOtherAnswer(question, answerSpec.other)
      orchestrator.advanceOther()
    } else {
      orchestrator.setAnswer(question, answerSpec.answer)
    }
  }

  orchestrator.generatePrompt()
  state = orchestrator.getState()
  assert.equal(state.promptReady, true, `V2 prompt should be ready for ${caseData.id}`)

  return {
    questions: state.questionHistory.map((question) => ({
      label: question.label,
      helper: question.helper ?? ""
    })),
    promptDraft: state.promptDraft,
    validation: state.validation,
    state,
    states
  }
}

async function main() {
  const outdir = await mkdtemp(path.join(os.tmpdir(), "review-prompt-mode-compare-"))
  try {
    await bundleModules(outdir)

    const legacyMod = await import(pathToFileURL(path.join(outdir, "orchestrator/review-prompt-mode-orchestrator.js")).href)
    const v2Mod = await import(pathToFileURL(path.join(outdir, "orchestrator/review-prompt-mode-v2-orchestrator.js")).href)
    const harnessMod = await import(pathToFileURL(path.join(outdir, "v2/comparison-harness.js")).href)

    const { createReviewPromptModeOrchestrator } = legacyMod
    const { createReviewPromptModeV2Orchestrator } = v2Mod
    const { summarizePromptModeComparison } = harnessMod

    const cases = await loadCases()
    assert.equal(cases.length >= 6, true)

    const comparisons = []

    for (const caseData of cases) {
      const legacy = await runLegacyCase(caseData, createReviewPromptModeOrchestrator)
      const v2 = await runV2Case(caseData, createReviewPromptModeV2Orchestrator)
      const summary = summarizePromptModeComparison({
        promptText: caseData.promptText,
        legacy,
        v2
      })

      assert.equal(Boolean(legacy.promptDraft.trim()), true)
      assert.equal(Boolean(v2.promptDraft.trim()), true)
      assert.equal(summary.legacy.questionRelevance >= 0, true)
      assert.equal(summary.v2.questionRelevance >= 0, true)
      assert.equal(summary.v2.promptQuality >= summary.legacy.promptQuality || summary.v2.unresolvedGaps <= summary.legacy.unresolvedGaps, true)

      comparisons.push({
        id: caseData.id,
        taskType: caseData.taskType,
        summary
      })
    }

    console.log(JSON.stringify(comparisons, null, 2))
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
