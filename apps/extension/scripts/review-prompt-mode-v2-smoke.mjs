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
      path.resolve(extensionRoot, "lib/review/orchestrator/review-prompt-mode-v2-orchestrator.ts"),
      path.resolve(extensionRoot, "lib/review/v2/prompt-mode-v2-service.ts"),
      path.resolve(extensionRoot, "lib/review/v2/section-schemas.ts"),
      path.resolve(extensionRoot, "lib/review/v2/gap-compression.ts"),
      path.resolve(extensionRoot, "lib/review/v2/prompt-mode-v2-assembly.ts"),
      path.resolve(extensionRoot, "lib/review/v2/prompt-mode-v2-progress.ts")
    ],
    outdir,
    bundle: true,
    format: "esm",
    platform: "node"
  })
}

function allChoiceQuestions(sections) {
  return sections.flatMap((section) => section.questionTemplates)
}

function normalize(text) {
  return text.replace(/\s+/g, " ").trim().toLowerCase()
}

async function main() {
  const outdir = await mkdtemp(path.join(os.tmpdir(), "review-prompt-mode-v2-"))
  try {
    await bundleModules(outdir)

    const orchestratorMod = await import(pathToFileURL(path.join(outdir, "orchestrator/review-prompt-mode-v2-orchestrator.js")).href)
    const serviceMod = await import(pathToFileURL(path.join(outdir, "v2/prompt-mode-v2-service.js")).href)
    const schemasMod = await import(pathToFileURL(path.join(outdir, "v2/section-schemas.js")).href)
    const compressionMod = await import(pathToFileURL(path.join(outdir, "v2/gap-compression.js")).href)
    const assemblyMod = await import(pathToFileURL(path.join(outdir, "v2/prompt-mode-v2-assembly.js")).href)
    const progressMod = await import(pathToFileURL(path.join(outdir, "v2/prompt-mode-v2-progress.js")).href)

    const { createReviewPromptModeV2Orchestrator } = orchestratorMod
    const {
      REVIEW_PROMPT_MODE_V2_SECTION_SCHEMAS,
      buildPromptModeV2SectionStates
    } = schemasMod
    const {
      assessPromptModeV2Intent,
      buildPromptModeV2NextQuestion
    } = serviceMod
    const { mergePromptModeV2Answer } = compressionMod
    const { assemblePromptModeV2Prompt } = assemblyMod
    const { computePromptModeV2ProgressState } = progressMod

    assert.deepEqual(Object.keys(REVIEW_PROMPT_MODE_V2_SECTION_SCHEMAS).sort(), [
      "creation",
      "modification",
      "problem_solving",
      "product_thinking",
      "prompt_optimization",
      "shipping"
    ])

    for (const [taskType, sections] of Object.entries(REVIEW_PROMPT_MODE_V2_SECTION_SCHEMAS)) {
      assert.ok(sections.length > 0, `${taskType} should define sections`)
      for (const question of allChoiceQuestions(sections)) {
        assert.notEqual(question.mode, "text", `${question.id} should not use text mode`)
        assert.ok(question.options?.length, `${question.id} should have options`)
        assert.equal(
          question.options.filter((option) => option === "Other").length,
          0,
          `${question.id} should not include Other`
        )
      }
    }

    const creationAssessment = assessPromptModeV2Intent({
      promptText:
        "Compose a single-serving dairy-free lunch salad with ingredients, step-by-step instructions, calories per serving, and under 300 kcal.",
      beforeIntent: "BUILD"
    })
    assert.equal(creationAssessment.goalContract.deliverableType, "recipe")

    const creationSections = buildPromptModeV2SectionStates({
      taskType: "creation",
      promptText:
        "Compose a single-serving dairy-free lunch salad with ingredients, step-by-step instructions, calories per serving, and under 300 kcal.",
      goalContract: creationAssessment.goalContract
    })
    const constraintsSection = creationSections.find((section) => section.id === "constraints")
    const outputFormatSection = creationSections.find((section) => section.id === "output_format")
    assert.ok(constraintsSection)
    assert.ok(outputFormatSection)
    assert.notEqual(constraintsSection.status, "unresolved")
    assert.notEqual(outputFormatSection.status, "unresolved")

    const recipeQuestionPrompt = "Create a healthy chicken salad recipe for lunch."
    const recipeQuestionAssessment = assessPromptModeV2Intent({
      promptText: recipeQuestionPrompt,
      beforeIntent: "BUILD"
    })
    const recipeQuestionSections = buildPromptModeV2SectionStates({
      taskType: "creation",
      promptText: recipeQuestionPrompt,
      goalContract: recipeQuestionAssessment.goalContract
    })
    const creationQuestion = buildPromptModeV2NextQuestion({
      taskType: "creation",
      promptText: recipeQuestionPrompt,
      goalContract: recipeQuestionAssessment.goalContract,
      sections: recipeQuestionSections,
      additionalNotes: [],
      state: {
        answerState: {},
        otherAnswerState: {},
        clarifyingQuestion: null,
        clarifyingAnswer: ""
      }
    })
    assert.ok(creationQuestion)
    assert.notEqual(creationQuestion.sectionId, "constraints")
    assert.notEqual(creationQuestion.sectionId, "output_format")
    assert.equal(/salad|recipe|lunch/i.test(`${creationQuestion.label} ${creationQuestion.helper}`), true)
    assert.equal(
      creationQuestion.options.some((option) => /breakfast|lunch|dinner|snack/i.test(option)) ||
        creationQuestion.options.some((option) => /high protein|low calorie|quick|budget/i.test(option)) ||
        creationQuestion.options.some((option) => /just me|meal prep|guests|kids/i.test(option)),
      true
    )

    const healthyMealStates = []
    const healthyMealOrchestrator = createReviewPromptModeV2Orchestrator({
      onStateChange: (nextState) => {
        healthyMealStates.push(nextState)
      }
    })
    await healthyMealOrchestrator.open({
      promptText: "healthy meal",
      beforeIntent: "BUILD"
    })
    for (let index = 0; index < 16; index += 1) {
      const flowState = healthyMealOrchestrator.getState()
      const activeQuestion = flowState.questionHistory[flowState.activeQuestionIndex]
      if (!activeQuestion) break
      if (activeQuestion.mode === "single") {
        healthyMealOrchestrator.setAnswer(activeQuestion, activeQuestion.options[0] ?? "")
        continue
      }
      healthyMealOrchestrator.setAnswerDraft(activeQuestion, [activeQuestion.options[0] ?? ""])
      healthyMealOrchestrator.continueQuestion()
    }
    const healthyMealFinalState = healthyMealOrchestrator.getState()
    assert.equal(healthyMealFinalState.questionHistory.length > 6, true)
    assert.equal(healthyMealFinalState.questionHistory.some((question) => question.sectionId === "definition_of_complete"), true)
    assert.equal(healthyMealFinalState.questionHistory.some((question) => question.sectionId === "note_box"), true)
    assert.equal(new Set(healthyMealFinalState.questionHistory.map((question) => question.id)).size, healthyMealFinalState.questionHistory.length)
    assert.equal(healthyMealFinalState.questionHistory.some((question) => question.depth === "secondary"), true)
    assert.equal(healthyMealFinalState.questionHistory.every((question) => question.mode !== "text"), true)

    const debugQuestionPrompt = "Debug the browser extension popup blank-on-open issue."
    const debugAssessment = assessPromptModeV2Intent({
      promptText: debugQuestionPrompt,
      beforeIntent: "DEBUG"
    })
    const debugSections = buildPromptModeV2SectionStates({
      taskType: "problem_solving",
      promptText: debugQuestionPrompt,
      goalContract: debugAssessment.goalContract
    }).map((section) =>
      section.id === "expected_behavior"
        ? {
            ...section,
            status: "unresolved",
            askedCount: 0,
            resolvedSignals: [],
            resolvedContent: [],
            partialContent: [],
            unresolvedGaps: ["Need at least 1 concrete detail for expected behavior."],
            contradictions: []
          }
        : section
    )
    const debugQuestion = buildPromptModeV2NextQuestion({
      taskType: "problem_solving",
      promptText: debugQuestionPrompt,
      goalContract: debugAssessment.goalContract,
      sections: debugSections,
      additionalNotes: [],
      state: {
        answerState: {},
        otherAnswerState: {},
        clarifyingQuestion: null,
        clarifyingAnswer: ""
      }
    })
    assert.ok(debugQuestion)
    assert.notEqual(debugQuestion.mode, "text")
    assert.equal(/popup|blank|extension|root cause/i.test(`${debugQuestion.label} ${debugQuestion.helper}`), true)
    assert.equal(debugQuestion.options.some((option) => /error|logs|reproduce|screenshot|root cause|fix|render|stable/i.test(option)), true)
    const debugFlowStates = []
    const debugOrchestrator = createReviewPromptModeV2Orchestrator({
      onStateChange: (nextState) => {
        debugFlowStates.push(nextState)
      }
    })
    await debugOrchestrator.open({
      promptText: debugQuestionPrompt,
      beforeIntent: "DEBUG"
    })
    debugOrchestrator.selectTaskType("problem_solving")
    for (let index = 0; index < 16; index += 1) {
      const flowState = debugOrchestrator.getState()
      const activeQuestion = flowState.questionHistory[flowState.activeQuestionIndex]
      if (!activeQuestion) break
      if (activeQuestion.mode === "single") {
        debugOrchestrator.setAnswer(activeQuestion, activeQuestion.options[0] ?? "")
        continue
      }
      debugOrchestrator.setAnswerDraft(activeQuestion, [activeQuestion.options[0] ?? ""])
      debugOrchestrator.continueQuestion()
    }
    const debugFinalState = debugOrchestrator.getState()
    assert.equal(debugFinalState.questionHistory.length > 6, true)
    assert.equal(debugFinalState.questionHistory.some((question) => question.sectionId === "fix_proof"), true)
    assert.equal(debugFinalState.questionHistory.some((question) => question.depth === "secondary"), true)
    assert.equal(new Set(debugFinalState.questionHistory.map((question) => question.id)).size, debugFinalState.questionHistory.length)
    assert.equal(debugFinalState.questionHistory.every((question) => question.mode !== "text"), true)

    const productQuestionPrompt = "Help decide whether Prompt Mode v2 rollout or answer-quality review trust should come first."
    const productAssessment = assessPromptModeV2Intent({
      promptText: productQuestionPrompt,
      beforeIntent: "OTHER"
    })
    const productSections = buildPromptModeV2SectionStates({
      taskType: "creation",
      promptText: productQuestionPrompt,
      goalContract: productAssessment.goalContract
    }).map((section) =>
      section.id === "goal"
        ? {
            ...section,
            status: "unresolved",
            askedCount: 0,
            resolvedSignals: [],
            resolvedContent: [],
            partialContent: [],
            unresolvedGaps: ["Need at least 1 concrete detail for goal."],
            contradictions: []
          }
        : section
    )
    const productQuestion = buildPromptModeV2NextQuestion({
      taskType: "creation",
      promptText: productQuestionPrompt,
      goalContract: productAssessment.goalContract,
      sections: productSections,
      additionalNotes: [],
      state: {
        answerState: {},
        otherAnswerState: {},
        clarifyingQuestion: null,
        clarifyingAnswer: ""
      }
    })
    assert.ok(productQuestion)
    assert.notEqual(productQuestion.mode, "text")
    assert.equal(/prompt mode v2|answer-quality|review trust|prioritize/i.test(`${productQuestion.label} ${productQuestion.helper}`), true)
    assert.equal(productQuestion.options.length >= 4, true)
    const productFlowStates = []
    const productOrchestrator = createReviewPromptModeV2Orchestrator({
      onStateChange: (nextState) => {
        productFlowStates.push(nextState)
      }
    })
    await productOrchestrator.open({
      promptText: productQuestionPrompt,
      beforeIntent: "OTHER"
    })
    for (let index = 0; index < 16; index += 1) {
      const flowState = productOrchestrator.getState()
      const activeQuestion = flowState.questionHistory[flowState.activeQuestionIndex]
      if (!activeQuestion) break
      if (activeQuestion.mode === "single") {
        productOrchestrator.setAnswer(activeQuestion, activeQuestion.options[0] ?? "")
        continue
      }
      productOrchestrator.setAnswerDraft(activeQuestion, [activeQuestion.options[0] ?? ""])
      productOrchestrator.continueQuestion()
    }
    const productFinalState = productOrchestrator.getState()
    assert.equal(productFinalState.questionHistory.length > 7, true)
    assert.equal(productFinalState.selectedTaskType, "creation")
    assert.equal(productFinalState.selectedTemplateKind, "creation")
    assert.equal(productFinalState.questionHistory.some((question) => question.sectionId === "constraints"), true)
    assert.equal(productFinalState.questionHistory.some((question) => question.depth === "secondary"), true)
    assert.equal(new Set(productFinalState.questionHistory.map((question) => question.id)).size, productFinalState.questionHistory.length)
    assert.equal(productFinalState.questionHistory.every((question) => question.mode !== "text"), true)

    const marketingPrompt = "marketing planwhat"
    const marketingAssessment = assessPromptModeV2Intent({
      promptText: marketingPrompt,
      beforeIntent: "BUILD"
    })
    const marketingSections = buildPromptModeV2SectionStates({
      taskType: "creation",
      promptText: marketingPrompt,
      goalContract: marketingAssessment.goalContract
    }).map((section) =>
      section.id === "goal"
        ? {
            ...section,
            status: "unresolved",
            askedCount: 0,
            resolvedSignals: [],
            resolvedContent: [],
            partialContent: [],
            unresolvedGaps: ["Need at least 1 concrete detail for goal."],
            contradictions: []
          }
        : section
    )
    const marketingQuestion = buildPromptModeV2NextQuestion({
      taskType: "creation",
      promptText: marketingPrompt,
      goalContract: marketingAssessment.goalContract,
      sections: marketingSections,
      additionalNotes: [],
      state: {
        answerState: {},
        otherAnswerState: {},
        clarifyingQuestion: null,
        clarifyingAnswer: ""
      }
    })
    assert.ok(marketingQuestion)
    assert.equal(/marketing/i.test(marketingQuestion.label), true)
    assert.equal(marketingQuestion.options.some((option) => /product launch|lead generation|brand awareness|retention/i.test(option)), true)
    assert.equal(marketingQuestion.options.every((option) => !/recipe|rewrite|code/i.test(option)), true)

    const genericMarketingPrompt = "marketing help"
    const genericMarketingAssessment = assessPromptModeV2Intent({
      promptText: genericMarketingPrompt,
      beforeIntent: "BUILD"
    })
    const genericMarketingSections = buildPromptModeV2SectionStates({
      taskType: "creation",
      promptText: genericMarketingPrompt,
      goalContract: genericMarketingAssessment.goalContract
    }).map((section) =>
      section.id === "goal"
        ? {
            ...section,
            status: "unresolved",
            askedCount: 0,
            resolvedSignals: [],
            resolvedContent: [],
            partialContent: [],
            unresolvedGaps: ["Need at least 1 concrete detail for goal."],
            contradictions: []
          }
        : section
    )
    const genericMarketingQuestion = buildPromptModeV2NextQuestion({
      taskType: "creation",
      promptText: genericMarketingPrompt,
      goalContract: genericMarketingAssessment.goalContract,
      sections: genericMarketingSections,
      additionalNotes: [],
      state: {
        answerState: {},
        otherAnswerState: {},
        clarifyingQuestion: null,
        clarifyingAnswer: ""
      }
    })
    assert.ok(genericMarketingQuestion)
    assert.equal(/marketing/i.test(genericMarketingQuestion.label), true)
    assert.equal(genericMarketingQuestion.options.some((option) => /product launch|lead generation|brand awareness|retention/i.test(option)), true)
    assert.equal(genericMarketingQuestion.options.every((option) => !/recipe|rewrite|code/i.test(option)), true)

    const studyPrompt = "study plan"
    const studyAssessment = assessPromptModeV2Intent({
      promptText: studyPrompt,
      beforeIntent: "BUILD"
    })
    const studySections = buildPromptModeV2SectionStates({
      taskType: "creation",
      promptText: studyPrompt,
      goalContract: studyAssessment.goalContract
    }).map((section) =>
      section.id === "goal"
        ? {
            ...section,
            status: "unresolved",
            askedCount: 0,
            resolvedSignals: [],
            resolvedContent: [],
            partialContent: [],
            unresolvedGaps: ["Need at least 1 concrete detail for goal."],
            contradictions: []
          }
        : section
    )
    const studyQuestion = buildPromptModeV2NextQuestion({
      taskType: "creation",
      promptText: studyPrompt,
      goalContract: studyAssessment.goalContract,
      sections: studySections,
      additionalNotes: [],
      state: {
        answerState: {},
        otherAnswerState: {},
        clarifyingQuestion: null,
        clarifyingAnswer: ""
      }
    })
    assert.ok(studyQuestion)
    assert.equal(/study plan/i.test(studyQuestion.label), true)
    assert.equal(studyQuestion.options.some((option) => /exam preparation|learning a new skill|teaching|study routine/i.test(option)), true)

    const legacySourcedStates = []
    const legacySourcedOrchestrator = createReviewPromptModeV2Orchestrator({
      getSurface: () => "REPLIT",
      getSessionSummary: () => null,
      extendQuestions: async () => ({
        clarification_questions: [
          {
            id: "legacy-procurement-q1",
            label: "What is this procurement checklist mainly for?",
            helper: "Start with the operational goal so the rest of the checklist stays relevant.",
            mode: "single",
            options: ["Vendor selection", "Purchase approval", "Compliance review", "Renewal planning", "Other"]
          }
        ],
        ai_available: true
      }),
      onStateChange: (nextState) => {
        legacySourcedStates.push(nextState)
      }
    })
    await legacySourcedOrchestrator.open({
      promptText: "procurement checklist",
      beforeIntent: "BUILD"
    })
    const legacySourcedState = legacySourcedOrchestrator.getState()
    const legacySourcedQuestion = legacySourcedState.questionHistory[legacySourcedState.activeQuestionIndex]
    assert.ok(legacySourcedQuestion)
    assert.equal(legacySourcedQuestion.label, "What is this procurement checklist mainly for?")
    assert.equal(legacySourcedQuestion.options.includes("Other"), false)
    assert.equal(legacySourcedState.questionHistory.length, 1)

    const mergeBaseSections = buildPromptModeV2SectionStates({
      taskType: "creation",
      promptText: "Build a recipe with ingredients and instructions.",
      goalContract: creationAssessment.goalContract
    })
    const noteQuestion = {
      id: "pmv2:creation:note_box:creation-note-box",
      sectionId: "note_box",
      sectionLabel: "Note box",
      label: "Anything else should shape the result?",
      helper: "Pick any final preference that matters enough to guide the answer.",
      mode: "multi",
      options: ["Keep it simple", "Optimize for health or performance"]
    }
    const noteMerge = mergePromptModeV2Answer({
      taskType: "creation",
      sections: mergeBaseSections,
      question: noteQuestion,
      answerValue: ["Keep it simple", "Optimize for health or performance"],
      additionalNotes: []
    })
    assert.equal(
      noteMerge.sections.find((section) => section.id === "note_box")?.resolvedSignals.some((signal) => normalize(signal).includes("keep it simple")),
      true
    )
    assert.deepEqual(noteMerge.additionalNotes, [])

    const assembledCreation = assemblePromptModeV2Prompt({
      taskType: "creation",
      sourcePrompt: "Build a lunch salad.",
      goalContract: creationAssessment.goalContract,
      sections: noteMerge.sections,
      additionalNotes: []
    })
    assert.match(assembledCreation.promptDraft, /^Create$/m)
    assert.match(assembledCreation.promptDraft, /^Goal:/m)
    assert.equal(Array.isArray(assembledCreation.validation.assumedItems), true)

    const weakStrengthProgress = computePromptModeV2ProgressState({
      sections: noteMerge.sections.map((section) =>
        section.id === "definition_of_complete"
          ? {
              ...section,
              status: "unresolved",
              resolvedContent: [],
              partialContent: [],
              unresolvedGaps: ["Need at least 1 concrete detail for definition of complete."]
            }
          : section
      ),
      questionHistoryLength: 6,
      validation: {
        missingItems: ["Need at least 1 concrete detail for definition of complete."],
        assumedItems: [],
        contradictions: ["Conflicting input for output format"]
      },
      promptReady: false
    })
    assert.equal(weakStrengthProgress.progressLabel === "good" || weakStrengthProgress.progressLabel === "great", true)
    assert.equal(weakStrengthProgress.strengthScore < weakStrengthProgress.progressScore, true)
    assert.equal(
      weakStrengthProgress.nextLevelLabel === null || weakStrengthProgress.meaningfulStepsToNextLevel >= 1,
      true
    )

    const modificationSections = buildPromptModeV2SectionStates({
      taskType: "modification",
      promptText: "Update the pricing page headline without changing the rest of the layout.",
      goalContract: assessPromptModeV2Intent({
        promptText: "Update the pricing page headline without changing the rest of the layout.",
        beforeIntent: "BUILD"
      }).goalContract
    }).map((section) => {
      if (section.id === "current_state") {
        return {
          ...section,
          status: "resolved",
          resolvedContent: ["Existing pricing page headline and layout are already live"],
          unresolvedGaps: [],
          resolvedSignals: ["Existing pricing page headline and layout are already live"]
        }
      }
      if (section.id === "requested_change") {
        return {
          ...section,
          status: "resolved",
          resolvedContent: ["Refresh the headline copy only"],
          unresolvedGaps: [],
          resolvedSignals: ["Refresh the headline copy only"]
        }
      }
      if (section.id === "scope_boundaries") {
        return {
          ...section,
          status: "resolved",
          resolvedContent: ["Touch only the hero headline", "Do not change the page layout"],
          unresolvedGaps: [],
          resolvedSignals: ["Touch only the hero headline", "Do not change the page layout"]
        }
      }
      return section
    })
    const assembledModification = assemblePromptModeV2Prompt({
      taskType: "modification",
      sourcePrompt: "Update the pricing page headline without changing the rest of the layout.",
      goalContract: creationAssessment.goalContract,
      sections: modificationSections,
      additionalNotes: []
    })
    assert.match(assembledModification.promptDraft, /^Task:/m)
    assert.match(assembledModification.promptDraft, /^Only change:/m)
    assert.match(assembledModification.promptDraft, /^Do not change:/m)

    const assembledProblem = assemblePromptModeV2Prompt({
      taskType: "problem_solving",
      sourcePrompt: debugQuestionPrompt,
      goalContract: debugAssessment.goalContract,
      sections: debugFinalState.sections,
      additionalNotes: []
    })
    assert.match(assembledProblem.promptDraft, /^Task:/m)
    assert.match(assembledProblem.promptDraft, /^Problem:/m)
    assert.match(assembledProblem.promptDraft, /^Expected behavior:/m)

    const lowConfidenceAssessment = assessPromptModeV2Intent({
      promptText: "help",
      beforeIntent: "OTHER"
    })
    assert.equal(lowConfidenceAssessment.confidence, "low")
    assert.ok(lowConfidenceAssessment.clarifyingQuestion)
    assert.equal(lowConfidenceAssessment.likelyTaskTypes.length >= 2, true)

    const lowConfidenceStates = []
    const lowConfidenceOrchestrator = createReviewPromptModeV2Orchestrator({
      onStateChange: (nextState) => {
        lowConfidenceStates.push(nextState)
      }
    })

    await lowConfidenceOrchestrator.open({
      promptText: "healthy meal",
      beforeIntent: "OTHER"
    })

    let lowConfidenceState = lowConfidenceOrchestrator.getState()
    assert.equal(lowConfidenceState.popupState, "questions")
    assert.equal(lowConfidenceState.intentConfidence, "low")
    assert.equal(lowConfidenceState.selectedTaskType, "creation")
    assert.equal(lowConfidenceState.selectedTemplateKind, "creation")
    assert.equal(lowConfidenceState.clarifyingQuestion, null)
    assert.equal(lowConfidenceState.sections.length > 0, true)
    assert.equal(lowConfidenceState.questionHistory.length > 0, true)

    const capturedStates = []
    const orchestrator = createReviewPromptModeV2Orchestrator({
      onStateChange: (state) => {
        capturedStates.push(state)
      }
    })

    await orchestrator.open({
      promptText: "Write a release checklist for shipping a browser extension update with post-ship verification.",
      beforeIntent: "BUILD"
    })

    let state = orchestrator.getState()
    assert.equal(state.popupState === "entry" || state.popupState === "questions", true)
    assert.equal(state.likelyTaskTypes.length > 0, true)
    assert.equal(
      state.likelyTaskTypes.some((chip) => chip.type === "creation"),
      true
    )

    if (state.popupState === "entry") {
      orchestrator.selectTaskType("creation")
      state = orchestrator.getState()
    }

    assert.equal(state.popupState, "questions")
    assert.equal(Boolean(state.selectedTaskType), true)
    assert.equal(state.sections.length > 0, true)
    assert.equal(state.questionHistory.length > 0, true)

    const firstQuestion = state.questionHistory[state.activeQuestionIndex]
    assert.ok(firstQuestion)
    assert.equal(normalize(firstQuestion.sectionLabel).length > 0, true)
    assert.notEqual(firstQuestion.mode, "text")

    if (firstQuestion.mode === "multi") {
      const initialQuestionId = firstQuestion.id
      orchestrator.setAnswerDraft(firstQuestion, [firstQuestion.options[0]])
      state = orchestrator.getState()
      assert.equal(state.questionHistory[state.activeQuestionIndex]?.id, initialQuestionId)
      orchestrator.continueQuestion()
      state = orchestrator.getState()
      const stored = state.answerState[firstQuestion.id]
      assert.ok(Array.isArray(stored))
      assert.equal(stored.includes(firstQuestion.options[0]), true)
      assert.notEqual(state.questionHistory[state.activeQuestionIndex]?.id, initialQuestionId)
      const section = state.sections.find((item) => item.id === firstQuestion.sectionId)
      assert.ok(section)
      assert.notEqual(section.status, "unresolved")
      assert.equal(section.resolvedSignals.some((signal) => normalize(signal).includes(normalize(firstQuestion.options[0]))), true)
    } else if (firstQuestion.mode === "single") {
      const initialQuestionId = firstQuestion.id
      orchestrator.setAnswer(firstQuestion, firstQuestion.options[0])
      state = orchestrator.getState()
      assert.equal(state.answerState[firstQuestion.id], firstQuestion.options[0])
      assert.notEqual(state.questionHistory[state.activeQuestionIndex]?.id, initialQuestionId)
      const section = state.sections.find((item) => item.id === firstQuestion.sectionId)
      assert.ok(section)
      assert.notEqual(section.status, "unresolved")
      assert.equal(section.resolvedSignals.some((signal) => normalize(signal).includes(normalize(firstQuestion.options[0]))), true)
    } else {
      throw new Error("Prompt Mode v2 should not generate text questions.")
    }

    orchestrator.generatePrompt()
    state = orchestrator.getState()
    assert.equal(state.promptReady, true)
    assert.equal(Boolean(state.promptDraft.trim()), true)
    assert.ok(state.validation)
    assert.ok(state.progress)
    assert.match(state.promptDraft, /^Create$/m)
    assert.equal(typeof state.progress.progressScore, "number")
    assert.equal(typeof state.progress.strengthScore, "number")
    assert.equal(state.progress.progressScore >= state.progress.strengthScore || state.progress.strengthScore >= 0, true)

    assert.equal(capturedStates.some((entry) => entry.popupState === "loading"), true)
    assert.equal(
      capturedStates.some((entry) => entry.popupState === "entry") || capturedStates.some((entry) => entry.popupState === "questions"),
      true
    )
    assert.equal(capturedStates.some((entry) => entry.popupState === "questions"), true)
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
