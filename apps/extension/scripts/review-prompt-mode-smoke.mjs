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
      path.resolve(extensionRoot, "lib/core/after-orchestration.ts"),
      path.resolve(extensionRoot, "lib/review/orchestrator/review-prompt-mode-orchestrator.ts"),
      path.resolve(extensionRoot, "lib/review/services/review-prompt-mode.ts"),
      path.resolve(extensionRoot, "lib/goal/goal-normalizer.ts"),
      path.resolve(extensionRoot, "lib/core/project-context.ts"),
      path.resolve(extensionRoot, "lib/core/project-context-pack.ts")
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
    const afterOrchestrationMod = await import(pathToFileURL(path.join(outdir, "core/after-orchestration.js")).href)
    const promptModeServicesMod = await import(pathToFileURL(path.join(outdir, "review/services/review-prompt-mode.js")).href)
    const goalNormalizerMod = await import(pathToFileURL(path.join(outdir, "goal/goal-normalizer.js")).href)
    const projectContextMod = await import(pathToFileURL(path.join(outdir, "core/project-context.js")).href)
    const projectContextPackMod = await import(pathToFileURL(path.join(outdir, "core/project-context-pack.js")).href)
    const { createReviewPromptModeOrchestrator } = orchestratorMod
    const { findNextUnansweredQuestionIndexInHistory } = afterOrchestrationMod
    const {
      formatPromptModeStructuredDraft,
      selectPromptModeQuestions,
      buildPromptModeQuestionRequest,
      buildPromptModeFallbackQuestions,
      buildPromptModePromptPlan
    } = promptModeServicesMod
    const { normalizeGoalContract } = goalNormalizerMod
    const { buildImportedProjectContextRecord } = projectContextMod
    const { buildProjectContextPack } = projectContextPackMod

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

    const nextHistoryIndex = findNextUnansweredQuestionIndexInHistory({
      questionHistory: [
        makeQuestion("h1", "First", ["A", "B"]),
        makeQuestion("h2", "Second", ["A", "B"]),
        makeQuestion("h3", "Third", ["A", "B"])
      ],
      startIndex: 1,
      answerState: {
        h1: "A",
        h2: "B"
      },
      otherAnswerState: {},
      otherOption: "Other"
    })
    assert.equal(nextHistoryIndex, 2)

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

    const immediateStates = []
    const immediateAdvanceOrchestrator = createReviewPromptModeOrchestrator({
      getPlatform: () => "replit",
      getSurface: () => "REPLIT",
      getSessionSummary: () => null,
      getProjectMemoryContext: () => ({ projectContext: "", currentState: "" }),
      extendQuestions: async (input) => {
        if (!input.existing_questions.length) {
          return {
            clarification_questions: [
              makeQuestion("m1", "How should the next prompt handle these requested changes?", [
                "Handle all changes in one pass",
                "Split into small sequential steps",
                "Other"
              ]),
              {
                id: "m2",
                label: "Which element's background color should change?",
                helper: "Pick one element.",
                mode: "single",
                options: ["Registration form background", "Page body background", "Other"]
              },
              {
                id: "m3",
                label: "What type of input should the gender field be?",
                helper: "Choose the visible result element for collecting gender.",
                mode: "multi",
                options: ["Dropdown select", "Radio buttons", "Other"]
              },
              {
                id: "m4",
                label: "What password criteria should apply?",
                helper: "Choose the password criteria.",
                mode: "single",
                options: ["Minimum length only", "Minimum length + number", "Other"]
              }
            ],
            ai_available: true
          }
        }

        return {
          clarification_questions: [],
          ai_available: true
        }
      },
      refinePrompt: async () => ({ improved_prompt: "noop" }),
      onStateChange: (nextState) => {
        immediateStates.push(nextState)
      }
    })

    await immediateAdvanceOrchestrator.open({
      promptText: "add the gender to the registration flow, change the background color, add criteria to the password, fix the wording issues.",
      beforeIntent: "BUILD"
    })

    let immediateState = immediateAdvanceOrchestrator.getState()
    assert.equal(immediateState.activeQuestionIndex, 0)

    const q1 = immediateState.questionHistory[0]
    await immediateAdvanceOrchestrator.setAnswer(q1, "Handle all changes in one pass")
    immediateState = immediateAdvanceOrchestrator.getState()
    assert.equal(immediateState.activeQuestionIndex, 1)

    immediateState = immediateAdvanceOrchestrator.getState()
    const q2 = immediateState.questionHistory[immediateState.activeQuestionIndex]
    await immediateAdvanceOrchestrator.setAnswer(q2, "Registration form background")
    immediateState = immediateAdvanceOrchestrator.getState()
    assert.equal(immediateState.activeQuestionIndex, 2)

    const multiQuestion = immediateState.questionHistory.find((question) => question.id === "m3")
    assert.ok(multiQuestion)
    immediateAdvanceOrchestrator.setAnswerDraft(multiQuestion, ["Dropdown select", "Radio buttons"])
    await immediateAdvanceOrchestrator.advanceOther()
    immediateState = immediateAdvanceOrchestrator.getState()
    assert.equal(immediateState.activeQuestionIndex, 3)

    await orchestrator.generatePrompt()
    state = orchestrator.getState()
    assert.equal(state.promptReady, true)
    assert.match(state.promptDraft, /Task \/ goal:/)
    assert.match(state.promptDraft, /Key requirements:/)
    assert.match(state.promptDraft, /Response expectations:/)
    assert.equal(state.promptDraft.includes("embedded CSS"), true)
    assert.equal(state.promptDraft.includes("HTML"), true)
    assert.equal(Boolean(lastRefineInput), true)
    assert.match(lastRefineInput.prompt, /Rewrite the user's typed draft into a strong, polished prompt/)
    assert.match(lastRefineInput.prompt, /Original Draft/)
    assert.match(lastRefineInput.prompt, /Clarified Choices/)
    assert.match(lastRefineInput.prompt, /AI Collaboration Contract/)
    assert.match(lastRefineInput.prompt, /If the change is clearly small and safe, you may implement directly\. Keep any confirmation brief and focused on scope plus validation\./)
    assert.match(lastRefineInput.prompt, /Output Guidance/)
    assert.match(state.promptDraft, /Briefly confirm the scoped change you will make\./)
    assert.match(state.promptDraft, /Keep the implementation narrowly scoped and leave unrelated areas untouched\./)
    assert.match(state.promptDraft, /Report what changed and how you validated it\./)

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

    const importedContext = buildImportedProjectContextRecord(`# Project Overview
- Prompt popup flow

# Current State
- Working on the review popup
`, "2026-04-01T00:00:00.000Z")
    const stalePack = buildProjectContextPack({
      importedContext,
      structuredMemory: {
        stableConstraints: [],
        protectedAreas: ["Authentication"],
        acceptedAssumptions: [],
        preferredPatterns: [],
        knownBadDirections: [],
        currentFeatureArea: "Prompt popup",
        currentPhase: "validation",
        currentWorkflowState: "validation_needed"
      },
      settings: {
        context: {
          status: "active",
          source: "imported_markdown",
          lastImportedAt: importedContext.parsedAt,
          staleReasons: [],
          conflictReasons: [],
          warnings: []
        },
        preferences: {
          collaborationMode: "careful",
          proofPreference: "proof_required",
          explanationStyle: "plain_language",
          scopePreference: "narrow"
        }
      }
    })
    assert.equal(stalePack.contextStatus, "stale")
    assert.equal(stalePack.warnings.length > 0, true)

    const conflictedPack = buildProjectContextPack({
      importedContext,
      structuredMemory: {
        stableConstraints: [],
        protectedAreas: ["Authentication"],
        acceptedAssumptions: [],
        preferredPatterns: [],
        knownBadDirections: [],
        currentFeatureArea: "Prompt popup",
        currentPhase: "implementation",
        currentWorkflowState: "implementation_underway"
      },
      settings: {
        context: {
          status: "active",
          source: "imported_markdown",
          lastImportedAt: importedContext.parsedAt,
          staleReasons: [],
          conflictReasons: [],
          warnings: []
        },
        preferences: {
          collaborationMode: "careful",
          proofPreference: "proof_required",
          explanationStyle: "plain_language",
          scopePreference: "narrow"
        }
      },
      currentRequestText: "Rewrite authentication flow and replace the current sign-in screen."
    })
    assert.equal(conflictedPack.contextStatus, "conflicted")
    assert.equal(conflictedPack.conflictReasons.some((item) => /protected area/i.test(item)), true)

    const contaminatedContext = buildImportedProjectContextRecord(`# Project Overview
- The FAB must appear on every Replit.com page load.

# Current State
- Minimum changes only.

# User Intent To Preserve
- The FAB must appear on every Replit.com page load — this is the single non-negotiable outcome.
- Do not add unrelated extras that the user did not ask for.

# Definition Of Done
- The ⚡ PS FAB is visible at the bottom-right of the screen within 3 seconds of loading any replit.com page.
`, "2026-04-01T00:00:00.000Z")

    const scopedTechnicalPrompt = formatPromptModeStructuredDraft({
      sourcePrompt: "add the gender to the registration flow",
      planningGoal: "Add a gender field to the registration flow.",
      refinedPrompt:
        "Add a gender field to the registration flow. Use a dropdown with Male, Female, and Other. Keep the change scoped to the registration flow only.",
      localAnalysis: {
        score: 61,
        intent: "BUILD",
        missing_elements: [],
        suggestions: [],
        rewrite: "",
        draft_prompt: "",
        clarity_issues: [],
        clarification_questions: []
      },
      answeredPath: ["Dropdown with Male, Female, Other", "Registration flow only", "Submit selected value correctly"],
      constraints: [],
      importedContext: contaminatedContext,
      settings: {
        context: {
          status: "active",
          source: "imported_markdown",
          lastImportedAt: contaminatedContext.parsedAt,
          staleReasons: [],
          conflictReasons: [],
          warnings: []
        },
        preferences: {
          collaborationMode: "careful",
          proofPreference: "standard",
          explanationStyle: "plain_language",
          scopePreference: "narrow"
        }
      },
      structuredMemory: {
        stableConstraints: ["The FAB must appear on every Replit.com page load."],
        protectedAreas: [
          "The FAB must appear on every Replit.com page load — this is the single non-negotiable outcome.",
          "Do not add unrelated extras that the user did not ask for."
        ],
        acceptedAssumptions: [],
        preferredPatterns: [],
        knownBadDirections: [],
        currentFeatureArea: "Floating FAB",
        currentPhase: "implementation",
        currentWorkflowState: "implementation_underway"
      },
      projectContext: contaminatedContext.projectContext,
      currentState: contaminatedContext.currentState
    })
    assert.match(scopedTechnicalPrompt, /Implementation guardrails:/)
    assert.match(scopedTechnicalPrompt, /Acceptance criteria:/)
    assert.match(scopedTechnicalPrompt, /Response expectations:/)
    assert.doesNotMatch(scopedTechnicalPrompt, /Required inputs or ingredients:/)
    assert.doesNotMatch(scopedTechnicalPrompt, /Output format:/)
    assert.doesNotMatch(scopedTechnicalPrompt, /The FAB must appear on every Replit\.com page load/i)
    assert.doesNotMatch(scopedTechnicalPrompt, /bottom-right of the screen/i)
    assert.match(scopedTechnicalPrompt, /Do not add unrelated extras that the user did not ask for\./i)
    assert.match(scopedTechnicalPrompt, /Keep the implementation narrowly scoped and leave unrelated areas untouched\./i)
    assert.match(scopedTechnicalPrompt, /The selected value is submitted with the registration form\./i)
    assert.doesNotMatch(scopedTechnicalPrompt, /Task \/ goal:\n[\s\S]*Success:/i)

    const scopedTechnicalPlan = buildPromptModePromptPlan({
      sourcePrompt: "add the gender to the registration flow",
      planningGoal: "Add a gender field to the registration flow.",
      localAnalysis: {
        score: 61,
        intent: "BUILD",
        missing_elements: [],
        suggestions: [],
        rewrite: "",
        draft_prompt: "",
        clarity_issues: [],
        clarification_questions: []
      },
      answeredPath: ["Dropdown", "After name", "Registration flow only", "Submit selected value correctly"],
      constraints: [],
      importedContext: contaminatedContext,
      settings: {
        context: {
          status: "active",
          source: "imported_markdown",
          lastImportedAt: contaminatedContext.parsedAt,
          staleReasons: [],
          conflictReasons: [],
          warnings: []
        },
        preferences: {
          collaborationMode: "careful",
          proofPreference: "standard",
          explanationStyle: "plain_language",
          scopePreference: "narrow"
        }
      },
      structuredMemory: {
        stableConstraints: ["The FAB must appear on every Replit.com page load."],
        protectedAreas: [
          "The FAB must appear on every Replit.com page load — this is the single non-negotiable outcome.",
          "Do not add unrelated extras that the user did not ask for."
        ],
        acceptedAssumptions: [],
        preferredPatterns: [],
        knownBadDirections: [],
        currentFeatureArea: "Floating FAB",
        currentPhase: "implementation",
        currentWorkflowState: "implementation_underway"
      },
      projectContext: contaminatedContext.projectContext,
      currentState: contaminatedContext.currentState
    })
    assert.doesNotMatch(scopedTechnicalPlan.basePrompt, /The FAB must appear on every Replit\.com page load/i)
    assert.doesNotMatch(scopedTechnicalPlan.basePrompt, /Clicking the FAB while logged out/i)
    assert.doesNotMatch(scopedTechnicalPlan.basePrompt, /\bdist\/\b/i)
    assert.doesNotMatch(scopedTechnicalPlan.basePrompt, /reload in Chrome/i)

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

    const sanitizedQuestions = selectPromptModeQuestions({
      goalContract: null,
      localAnalysis: {
        score: 52,
        intent: "DEBUG",
        missing_elements: [],
        suggestions: [],
        rewrite: "",
        draft_prompt: "",
        clarity_issues: [],
        clarification_questions: []
      },
      promptText: "Fix the onboarding issue in Replit",
      questions: [
        {
          id: "tech-1",
          label: "Which runtime checkpoint should we verify first?",
          helper: "Pick the first diagnostic step before changing the frontend component.",
          mode: "single",
          options: ["Content script attaches", "Target element is detected", "UI renders visibly", "Other"]
        }
      ]
    })
    assert.equal(sanitizedQuestions.length, 1)
    assert.equal(sanitizedQuestions[0].label, "What should the assistant confirm first?")
    assert.doesNotMatch(
      `${sanitizedQuestions[0].label} ${sanitizedQuestions[0].helper} ${sanitizedQuestions[0].options.join(" ")}`,
      /\bcontent script|runtime checkpoint|frontend|component\b/i
    )

    const scopedChangeGoal = normalizeGoalContract({
      promptText: "add the geneder to the registration flow",
      taskFamily: "build"
    })
    assert.equal(scopedChangeGoal.deliverableType, "scoped_change")

    const scopedChangeFallback = buildPromptModeFallbackQuestions({
      promptText: "add the geneder to the registration flow",
      localAnalysis: {
        score: 55,
        intent: "BUILD",
        missing_elements: [],
        suggestions: [],
        rewrite: "",
        draft_prompt: "",
        clarity_issues: [],
        clarification_questions: []
      },
      goalContract: scopedChangeGoal
    })
    assert.equal(
      scopedChangeFallback.questionHistory[0].label,
      "What exact part of the change should the next prompt lock down first?"
    )
    assert.deepEqual(scopedChangeFallback.questionHistory[0].options, [
      "Field type",
      "Allowed options",
      "Form placement",
      "Submit behavior",
      "Scope boundary"
    ])

    const multiChangeGoal = normalizeGoalContract({
      promptText:
        "add the geneder to the registration flow, change the background color, add criteria to the password, fix the wording issues.",
      taskFamily: "build"
    })
    assert.equal(multiChangeGoal.deliverableType, "multi_change")

    const multiChangeFallback = buildPromptModeFallbackQuestions({
      promptText:
        "add the geneder to the registration flow, change the background color, add criteria to the password, fix the wording issues.",
      localAnalysis: {
        score: 54,
        intent: "BUILD",
        missing_elements: [],
        suggestions: [],
        rewrite: "",
        draft_prompt: "",
        clarity_issues: [],
        clarification_questions: []
      },
      goalContract: multiChangeGoal
    })
    assert.equal(
      multiChangeFallback.questionHistory[0].label,
      "How should the next prompt handle these requested changes?"
    )
    assert.deepEqual(multiChangeFallback.questionHistory[0].options, [
      "Prioritize one change first",
      "Handle all changes in one pass",
      "Split into small sequential steps",
      "Do the safest changes first",
      "Other"
    ])

    const multiChangeCoverageQuestions = selectPromptModeQuestions({
      goalContract: multiChangeGoal,
      requestBrief: null,
      localAnalysis: {
        score: 54,
        intent: "BUILD",
        missing_elements: [],
        suggestions: [],
        rewrite: "",
        draft_prompt: "",
        clarity_issues: [],
        clarification_questions: []
      },
      promptText:
        "add the geneder to the registration flow, change the background color, add criteria to the password, fix the wording issues.",
      questions: [
        {
          id: "multi-bg",
          label: "Which element's background color should change?",
          helper: "Specify the exact visible result element whose background color you want to change.",
          mode: "single",
          options: ["Registration form background", "Page body background", "Submit button background", "Header background"]
        },
        {
          id: "multi-gender",
          label: "What type of input should the gender field be?",
          helper: "Choose the visible result element for collecting gender in the registration form.",
          mode: "single",
          options: ["Dropdown select", "Radio buttons", "Text input", "Toggle switch"]
        }
      ],
      existingQuestions: [
        {
          id: "multi-strategy",
          label: "How should the next prompt handle these requested changes?",
          helper: "This request includes several edits. Decide whether the next prompt should prioritize one first or bundle them together.",
          mode: "single",
          options: [
            "Prioritize one change first",
            "Handle all changes in one pass",
            "Split into small sequential steps",
            "Do the safest changes first"
          ]
        }
      ],
      answerState: {
        "multi-strategy": "Handle all changes in one pass"
      },
      otherAnswerState: {}
    })
    assert.equal(multiChangeCoverageQuestions.length, 4)
    assert.deepEqual(
      multiChangeCoverageQuestions.map((question) => question.label),
      [
        "Which element's background color should change?",
        "What type of input should the gender field be?",
        "What password criteria should the next prompt add?",
        "Which wording issues should the next prompt fix?"
      ]
    )

    const multiChangePriorityQuestions = selectPromptModeQuestions({
      goalContract: multiChangeGoal,
      requestBrief: null,
      localAnalysis: {
        score: 54,
        intent: "BUILD",
        missing_elements: [],
        suggestions: [],
        rewrite: "",
        draft_prompt: "",
        clarity_issues: [],
        clarification_questions: []
      },
      promptText:
        "add the geneder to the registration flow, change the background color, add criteria to the password, fix the wording issues.",
      questions: [],
      existingQuestions: [
        {
          id: "multi-priority-strategy",
          label: "How should the next prompt handle these requested changes?",
          helper: "This request includes several edits. Decide whether the next prompt should prioritize one first or bundle them together.",
          mode: "single",
          options: [
            "Prioritize one change first",
            "Handle all changes in one pass",
            "Split into small sequential steps",
            "Do the safest changes first"
          ]
        }
      ],
      answerState: {
        "multi-priority-strategy": "Prioritize one change first"
      },
      otherAnswerState: {}
    })
    assert.equal(
      multiChangePriorityQuestions.some(
        (question) => question.label === "Which change should the next prompt focus on first?"
      ),
      true
    )
    const multiChangePriorityFocus = multiChangePriorityQuestions.find(
      (question) => question.label === "Which change should the next prompt focus on first?"
    )
    assert.deepEqual(multiChangePriorityFocus?.options, [
      "Registration field",
      "Background color",
      "Password criteria",
      "Wording issues",
      "Other"
    ])

    const obviousQuestions = selectPromptModeQuestions({
      goalContract: {
        deliverableType: "page output",
        hardConstraints: [],
        outputRequirements: ["Return a full page output"],
        softPreferences: [],
        assumptions: [],
        riskFlags: [],
        userGoal: "Update the onboarding page"
      },
      requestBrief: {
        rawRequest: "Update the onboarding page",
        goal: "Update the onboarding page",
        userValue: "Improve the onboarding flow",
        artifactType: "page output",
        scope: ["Onboarding page"],
        nonGoals: ["Do not change auth"],
        constraints: ["Keep the existing onboarding flow"],
        assumptions: ["Keep this a narrow change"],
        riskLevel: "medium",
        riskReason: "This touches an existing product flow.",
        successCriteria: ["The onboarding page is updated without changing auth"]
      },
      localAnalysis: {
        score: 58,
        intent: "BUILD",
        missing_elements: [],
        suggestions: [],
        rewrite: "",
        draft_prompt: "",
        clarity_issues: [],
        clarification_questions: []
      },
      promptText: "Update the current onboarding page but do not change auth",
      structuredMemory: {
        stableConstraints: ["Keep the existing onboarding flow"],
        protectedAreas: ["Do not change auth"],
        acceptedAssumptions: ["Keep this a narrow change"],
        preferredPatterns: [],
        knownBadDirections: [],
        currentFeatureArea: "Onboarding page",
        currentPhase: "planning",
        currentWorkflowState: "plan_requested"
      },
      questions: [
        {
          id: "obvious-1",
          label: "What kind of result should the next prompt ask for?",
          helper: "Lock down the exact deliverable before sending the next prompt.",
          mode: "single",
          options: ["Page output", "Recommendation", "Other"]
        },
        {
          id: "useful-1",
          label: "Which part matters most to protect?",
          helper: "Pick what should stay untouched while this change is made.",
          mode: "single",
          options: ["Current onboarding flow", "Authentication flow", "Existing copy", "Other"]
        }
      ],
      existingQuestions: [],
      answerState: {},
      otherAnswerState: {}
    })
    assert.equal(obviousQuestions.length, 1)
    assert.equal(obviousQuestions[0].label, "Which part matters most to protect?")
    assert.match(obviousQuestions[0].helper, /Assume this should stay a narrow change/i)

    const recoveryQuestions = selectPromptModeQuestions({
      goalContract: null,
      requestBrief: {
        rawRequest: "Continue fixing this current Replit screen without breaking anything else",
        goal: "Continue fixing the current Replit screen",
        userValue: "Finish the current change safely",
        artifactType: "other",
        scope: [],
        nonGoals: [],
        constraints: [],
        assumptions: [],
        riskLevel: "high",
        riskReason: "The request sounds mid-project but lacks project context.",
        successCriteria: []
      },
      localAnalysis: {
        score: 51,
        intent: "DEBUG",
        missing_elements: [],
        suggestions: [],
        rewrite: "",
        draft_prompt: "",
        clarity_issues: [],
        clarification_questions: []
      },
      promptText: "Continue fixing this current Replit screen without breaking anything else",
      questions: [],
      existingQuestions: [],
      answerState: {},
      otherAnswerState: {}
    })
    assert.equal(recoveryQuestions.length, 1)
    assert.equal(recoveryQuestions[0].label, "What should reeva assume about the current project?")

    const questionRequest = buildPromptModeQuestionRequest({
      promptText: "Continue fixing this current Replit screen without breaking anything else",
      localAnalysis: {
        score: 51,
        intent: "DEBUG",
        missing_elements: [],
        suggestions: [],
        rewrite: "",
        draft_prompt: "",
        clarity_issues: [],
        clarification_questions: []
      },
      requestBrief: {
        rawRequest: "Continue fixing this current Replit screen without breaking anything else",
        goal: "Continue fixing the current Replit screen",
        userValue: "Finish the current change safely",
        artifactType: "other",
        scope: [],
        nonGoals: [],
        constraints: [],
        assumptions: [],
        riskLevel: "high",
        riskReason: "The request sounds mid-project but lacks project context.",
        successCriteria: []
      },
      existingQuestions: [],
      answerState: {},
      otherAnswerState: {},
      surface: "REPLIT"
    })
    assert.equal(questionRequest.answers._question_context_confidence, "low")
    assert.match(questionRequest.answers._question_tensions, /feature_context|protected_surface/)

    console.log("review-prompt-mode-smoke: ok")
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}

await main()
