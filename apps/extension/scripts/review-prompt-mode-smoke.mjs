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
      path.resolve(extensionRoot, "lib/review/services/review-prompt-mode.ts"),
      path.resolve(extensionRoot, "lib/goal/goal-normalizer.ts")
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

function findConstraint(goalContract, type, predicate = null) {
  return goalContract.hardConstraints.find((item) => item.type === type && (!predicate || predicate(item)))
}

async function main() {
  const outdir = await mkdtemp(path.join(os.tmpdir(), "review-prompt-mode-"))
  try {
    await bundleModules(outdir)

    const orchestratorMod = await import(pathToFileURL(path.join(outdir, "review/orchestrator/review-prompt-mode-orchestrator.js")).href)
    const promptModeServicesMod = await import(pathToFileURL(path.join(outdir, "review/services/review-prompt-mode.js")).href)
    const goalNormalizerMod = await import(pathToFileURL(path.join(outdir, "goal/goal-normalizer.js")).href)
    const { createReviewPromptModeOrchestrator } = orchestratorMod
    const { formatPromptModeStructuredDraft } = promptModeServicesMod
    const { normalizeGoalContract } = goalNormalizerMod

    const underFiveGoal = normalizeGoalContract({
      promptText: "Build one lunch recipe that stays under 5 min.",
      taskFamily: "creation"
    })
    const underFiveTime = findConstraint(underFiveGoal, "time")
    assert.equal(underFiveTime?.value?.max, 5)
    assert.equal(underFiveTime?.value?.exact ?? null, null)

    const maxFiveGoal = normalizeGoalContract({
      promptText: "Task / goal:\nBuild one lunch recipe.\nKey requirements:\n- Max cook time?: 5 min.",
      taskFamily: "creation"
    })
    const maxFiveTime = findConstraint(maxFiveGoal, "time")
    assert.equal(maxFiveTime?.value?.max, 5)
    assert.equal(maxFiveTime?.value?.exact ?? null, null)

    const proteinGoal = normalizeGoalContract({
      promptText: "Make a high-protein lunch with at least 55 g protein and under 300 kcal.",
      taskFamily: "creation"
    })
    const proteinConstraint = findConstraint(proteinGoal, "protein", (item) => typeof item.value === "object" && item.value?.min != null)
    const calorieConstraint = findConstraint(proteinGoal, "calories")
    assert.equal(proteinConstraint?.value?.min, 55)
    assert.equal(proteinConstraint?.value?.exact ?? null, null)
    assert.equal(calorieConstraint?.value?.max, 300)
    assert.equal(calorieConstraint?.value?.exact ?? null, null)

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
              makeQuestion("q1", "Which part of the CV should the first draft emphasize?", [
                "Layout structure first",
                "Embedded styling first",
                "Balanced starter content",
                "Minimal starter only",
                "Other"
              ])
            ],
            ai_available: true
          }
        }

        const firstAnswer = input.answers.q1
        if (firstAnswer === "Embedded styling first" && input.existing_questions.length === 1) {
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

        if (firstAnswer === "Embedded styling first") {
          return {
            clarification_questions: [],
            ai_available: true
          }
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
    assert.equal(state.questionHistory[0].label, "Which part of the CV should the first draft emphasize?")

    await orchestrator.setAnswer(state.questionHistory[0], "Layout structure first")
    state = orchestrator.getState()
    assert.equal(state.questionHistory.length >= 2, true)
    assert.equal(state.activeQuestionIndex >= 1, true)

    orchestrator.setActiveQuestionIndex(0)
    const branchAdvancePromise = orchestrator.setAnswer(state.questionHistory[0], "Embedded styling first")
    state = orchestrator.getState()
    assert.equal(state.isLoadingQuestions, true)
    assert.equal(state.answerState.q1, "Embedded styling first")
    resolveBranch()
    await branchAdvancePromise
    state = orchestrator.getState()
    assert.equal(state.questionHistory.length >= 2, true)
    assert.equal(state.isLoadingQuestions, false)
    assert.equal(state.activeQuestionIndex, 1)

    const secondQuestion = state.questionHistory[state.activeQuestionIndex]
    const secondOption = secondQuestion.options.find((option) => option !== "Other") ?? secondQuestion.options[0]
    await orchestrator.setAnswer(secondQuestion, secondOption)
    state = orchestrator.getState()
    assert.equal(state.activeQuestionIndex >= 1, true)

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

    const exclusionStructuredPrompt = formatPromptModeStructuredDraft({
      sourcePrompt: "Suggest a healthy desk breakfast without oats. Any ingredients you dislike?: Berries. Keep it dairy-free.",
      planningGoal: "Suggest a healthy desk breakfast without oats. Any ingredients you dislike?: Berries. Keep it dairy-free.",
      refinedPrompt: "Suggest one healthy desk breakfast I can prep quickly.",
      localAnalysis: {
        score: 62,
        intent: "BUILD",
        missing_elements: [],
        suggestions: [],
        rewrite: "",
        draft_prompt: "",
        clarity_issues: [],
        clarification_questions: []
      },
      answeredPath: ["Desk-friendly", "Quick to prep"],
      constraints: []
    })
    assert.match(exclusionStructuredPrompt, /Do not use oats\./)
    assert.match(exclusionStructuredPrompt, /Do not use berries\./)
    assert.match(exclusionStructuredPrompt, /Keep it dairy-free\./)

    const recommendationStructuredPrompt = formatPromptModeStructuredDraft({
      sourcePrompt:
        "Recommend one modern Dubai waterfront promenade landmark within a 15-minute walk of a Downtown/Burj area hotel that a couple can visit late this afternoon for a total cost of $20-$50. Reply with only: attraction name, exact entry fee, today's opening hours, and a 2-sentence walking route.",
      planningGoal:
        "Recommend one modern Dubai waterfront promenade landmark within a 15-minute walk of a Downtown/Burj area hotel that a couple can visit late this afternoon for a total cost of $20-$50.",
      refinedPrompt:
        "Recommend one modern Dubai waterfront promenade landmark within a 15-minute walk of a Downtown/Burj area hotel that a couple can visit late this afternoon for a total cost of $20-$50.",
      localAnalysis: {
        score: 64,
        intent: "OTHER",
        missing_elements: [],
        suggestions: [],
        rewrite: "",
        draft_prompt: "",
        clarity_issues: [],
        clarification_questions: []
      },
      answeredPath: ["Downtown Dubai / Burj area", "Waterfront promenade", "On-site cash/card"],
      constraints: []
    })
    assert.doesNotMatch(recommendationStructuredPrompt, /Quality bar \/ style guardrails:/)
    assert.doesNotMatch(recommendationStructuredPrompt, /Keep the request clear, specific, and easy for the AI assistant to follow\./)

    assert.equal(states.some((entry) => entry.popupState === "loading"), true)
    assert.equal(states.some((entry) => entry.isLoadingQuestions === true), true)

    const filteredStates = []
    const filteredOrchestrator = createReviewPromptModeOrchestrator({
      getPlatform: () => "replit",
      getSurface: () => "REPLIT",
      getSessionSummary: () => null,
      getProjectMemoryContext: () => ({ projectContext: "", currentState: "" }),
      extendQuestions: async (input) => {
        if (!input.existing_questions.length) {
          return {
            clarification_questions: [
              makeQuestion("generic-servings", "How many servings should this make?", [
                "1 serving",
                "2 servings",
                "4 servings",
                "Other"
              ])
            ],
            ai_available: true
          }
        }
        return {
          clarification_questions: [],
          ai_available: true
        }
      },
      refinePrompt: async () => ({ improved_prompt: "unused" }),
      onStateChange: (state) => {
        filteredStates.push(state)
      }
    })

    await filteredOrchestrator.open({
      promptText:
        "Build a single-serving vegan microwave lunch under 5 min with rice. Include ingredients and step-by-step instructions.",
      beforeIntent: "BUILD"
    })

    const filteredState = filteredOrchestrator.getState()
    assert.equal(filteredState.popupState, "questions")
    assert.equal(filteredState.questionHistory.length > 0, true)
    assert.equal(filteredState.questionHistory[0].label, "Which current requirement is least negotiable?")
    assert.notEqual(filteredState.questionHistory[0].label, "How many servings should this make?")

    console.log("review-prompt-mode-smoke: ok")
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}

await main()
