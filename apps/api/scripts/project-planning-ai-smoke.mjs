import assert from "node:assert/strict"
import {
  AnalyzeProjectPlanningResponseSchema,
  PROJECT_PLANNING_CLIENT_TIMEOUT_MS,
  PROJECT_PLANNING_DRAFT_CLIENT_TIMEOUT_MS,
  PROJECT_PLANNING_DRAFT_PROVIDER_TIMEOUT_MS,
  PROJECT_PLANNING_PROVIDER_TIMEOUT_MS,
  ProjectPlanningQuestionSchema,
  ProjectPlanningDiagnosticsSchema
} from "../../../packages/shared/src/project-planning.ts"
import { projectPlanningAiTestInternals } from "../lib/project-planning-ai.ts"

const {
  buildProjectPlanningAnalysisPromptInput,
  buildProjectPlanningDraftPromptInput,
  buildProjectPlanningRequestMetadata,
  buildCoverageFromPrdSnapshot,
  buildCompactDraftContext,
  buildDraftFromCompactPrd,
  buildPrdFieldsFromCompactDraft,
  buildProjectPlanningDraftResponseFromCompactData,
  buildPrdSnapshotFromCompactSections,
  buildPrdSnapshotFromCoverageReport,
  buildQuestionsFromCompactTuples,
  buildResolvedDraftInputs,
  createPlanningDiagnostics,
  runProjectPlanningAnalysisProviderRace,
  runProjectPlanningDraftProviderRace,
  selectProjectPlanningProvider,
  validatePrdSpecificity,
  validatePrdSnapshotSpecificity,
  validateQuestionnaireSpecificity
} = projectPlanningAiTestInternals

const waterDescription = "water intake app"
const compactPromptDescription = "A compact water intake app with quick-add logging, hydration reminders, daily progress, unit selection, daily reset, notification permission, and edit/delete intake entries."

assert.ok(
  PROJECT_PLANNING_PROVIDER_TIMEOUT_MS >= 12_000 && PROJECT_PLANNING_PROVIDER_TIMEOUT_MS <= 15_000,
  "Expected Project Planning provider timeout to stay inside the 12-15s latency budget."
)

assert.ok(
  PROJECT_PLANNING_CLIENT_TIMEOUT_MS <= 20_000,
  "Expected legacy Project Planning analysis client timeout to avoid long waits."
)

assert.ok(
  PROJECT_PLANNING_DRAFT_PROVIDER_TIMEOUT_MS <= 30_000,
  "Expected Build PRD Draft provider timeout to keep waits under 30 seconds."
)

assert.ok(
  PROJECT_PLANNING_DRAFT_CLIENT_TIMEOUT_MS >= PROJECT_PLANNING_DRAFT_PROVIDER_TIMEOUT_MS + 3_000,
  "Expected Build PRD Draft client timeout to leave room for provider completion."
)

const selectedKimiProvider = selectProjectPlanningProvider({
  provider: "kimi",
  hasKimiApiKey: true,
  hasDeepSeekApiKey: true,
  systemPrompt: "system",
  userPrompt: "user",
  maxTokens: 100
})

assert.equal(selectedKimiProvider.name, "Kimi")
assert.equal(selectedKimiProvider.configured, true)

const selectedDeepSeekProvider = selectProjectPlanningProvider({
  provider: "deepseek",
  hasKimiApiKey: true,
  hasDeepSeekApiKey: true,
  systemPrompt: "system",
  userPrompt: "user",
  maxTokens: 100
})

assert.equal(selectedDeepSeekProvider.name, "DeepSeek")
assert.equal(selectedDeepSeekProvider.configured, true)

const missingSelectedProvider = selectProjectPlanningProvider({
  provider: "kimi",
  hasKimiApiKey: false,
  hasDeepSeekApiKey: true,
  systemPrompt: "system",
  userPrompt: "user",
  maxTokens: 100
})

assert.equal(missingSelectedProvider.name, "Kimi")
assert.equal(
  missingSelectedProvider.configured,
  false,
  "Expected Project Planning to avoid hidden fallback when the selected provider is missing."
)

const analysisPromptInput = buildProjectPlanningAnalysisPromptInput({
  projectLabel: "Water Intake",
  description: compactPromptDescription
})

assert.ok(analysisPromptInput.maxTokens <= 500, "Expected Gather Requirements to use a short output budget.")
assert.ok(
  analysisPromptInput.systemPrompt.length + analysisPromptInput.userPrompt.length < 1400,
  "Expected Gather Requirements prompt to stay compact."
)
assert.equal(
  (analysisPromptInput.userPrompt.match(/concrete/g) ?? []).length,
  1,
  "Expected Gather Requirements prompt to keep one concise concreteness instruction."
)

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const validWaterAnalysisJson = JSON.stringify({
  s: [
    ["problem", "partial", "Users forget water intake during the day.", "target user context"],
    ["target_user", "missing", "", "primary audience"],
    ["goal_outcome", "partial", "Help users meet a hydration goal.", "exact daily goal"],
    ["scope", "partial", "MVP covers water logging and reminders.", "units"],
    ["core_requirements", "partial", "Water intake log, reminders, daily progress.", "edit/delete entries; permission"],
    ["non_goals", "missing", "", "excluded wellness features"],
    ["constraints", "missing", "", "platform and privacy constraints"],
    ["success_criteria", "missing", "", "proof hydration tracking works"],
    ["assumptions_risks", "missing", "", "notification permission risk"]
  ],
  q: [
    [
      "hydration_goal",
      ["goal_outcome"],
      "What daily hydration goal should the water intake app track first?",
      "This controls progress and reminder timing.",
      "single",
      ["Fixed goal", "Custom goal", "Other"]
    ],
    [
      "water_logging",
      ["core_requirements"],
      "How should users log water intake in the MVP?",
      "This defines the fastest water logging path.",
      "multi",
      ["Quick-add cups", "Manual amount", "Edit/delete entries", "Other"]
    ],
    [
      "reminders",
      ["core_requirements", "success_criteria"],
      "What reminder behavior should support daily hydration progress?",
      "This clarifies notification permission and reminder expectations.",
      "single",
      ["Scheduled reminders", "Goal-based nudges", "Other"]
    ]
  ]
})

const validWaterAnalysisObjectJson = JSON.stringify({
  summary: "Water intake app has partial PRD coverage and needs hydration-specific scope decisions.",
  sections: [
    { key: "problem", status: "partial", draft: "Users forget water intake during the day.", missing: ["target user context"] },
    { key: "target_user", status: "missing", draft: "", missing: ["primary audience"] },
    { key: "goal_outcome", status: "partial", draft: "Help users meet a hydration goal.", missing: ["exact daily goal"] },
    { key: "scope", status: "partial", draft: "MVP covers water logging and reminders.", missing: ["units"] },
    { key: "core_requirements", status: "partial", draft: "Water intake log, reminders, daily progress.", missing: ["edit/delete entries", "permission"] },
    { key: "non_goals", status: "missing", draft: "", missing: ["excluded wellness features"] },
    { key: "constraints", status: "missing", draft: "", missing: ["platform and privacy constraints"] },
    { key: "success_criteria", status: "missing", draft: "", missing: ["proof hydration tracking works"] },
    { key: "assumptions_risks", status: "missing", draft: "", missing: ["notification permission risk"] }
  ],
  questions: [
    {
      id: "hydration_goal",
      section: "goal_outcome",
      question: "What daily hydration goal should the water intake app track first?",
      why: "This controls progress and reminder timing.",
      mode: "single",
      options: ["Fixed goal", "Custom goal", "Other"]
    },
    {
      id: "water_logging",
      section: "core_requirements",
      question: "How should users log water intake in the MVP?",
      why: "This defines the fastest water logging path.",
      mode: "multi",
      options: ["Quick-add cups", "Manual amount", "Edit/delete entries", "Other"]
    },
    {
      id: "reminders",
      sections: ["core_requirements", "success_criteria"],
      question: "What reminder behavior should support daily hydration progress?",
      why: "This clarifies notification permission and reminder expectations.",
      mode: "single",
      options: ["Scheduled reminders", "Goal-based nudges", "Other"]
    }
  ]
})

const waterRequirementsMetadata = buildProjectPlanningRequestMetadata({
  description: waterDescription,
  projectLabel: "Water Intake",
  promptKind: "requirements"
})
const invoiceRequirementsMetadata = buildProjectPlanningRequestMetadata({
  description: "invoice generator",
  projectLabel: "Invoice Generator",
  promptKind: "requirements"
})

assert.notEqual(
  invoiceRequirementsMetadata.descriptionHash,
  waterRequirementsMetadata.descriptionHash,
  "Expected changed project description to produce a new debug hash."
)
assert.equal(invoiceRequirementsMetadata.descriptionPreview, "invoice generator")

const racedAnalysis = await runProjectPlanningAnalysisProviderRace({
  description: waterDescription,
  systemPrompt: "system",
  userPrompt: "user",
  maxTokens: 100,
  timeoutMs: 200,
  providers: [
    {
      name: "Kimi",
      configured: true,
      call: async () => {
        await delay(60)
        return validWaterAnalysisJson
      }
    },
    {
      name: "DeepSeek",
      configured: true,
      call: async () => {
        await delay(5)
        return validWaterAnalysisJson
      }
    }
  ]
})

assert.equal(racedAnalysis.diagnostics.providerName, "DeepSeek")
assert.equal(racedAnalysis.diagnostics.fallbackUsed, false)
assert.equal(
  racedAnalysis.diagnostics.providerAttempts?.some((attempt) => attempt.providerName === "DeepSeek" && attempt.status === "success"),
  true
)
assert.equal(
  racedAnalysis.diagnostics.providerAttempts?.some((attempt) => attempt.providerName === "Kimi" && attempt.status === "aborted"),
  true,
  "Expected the slower race participant to be traced as aborted."
)

const objectAnalysis = await runProjectPlanningAnalysisProviderRace({
  description: waterDescription,
  systemPrompt: "system",
  userPrompt: "user",
  maxTokens: 100,
  timeoutMs: 500,
  metadata: waterRequirementsMetadata,
  providers: [
    {
      name: "Kimi",
      configured: true,
      call: async () => validWaterAnalysisObjectJson
    }
  ]
})

assert.equal(objectAnalysis.diagnostics.providerName, "Kimi")
assert.equal(objectAnalysis.diagnostics.promptKind, "requirements")
assert.equal(objectAnalysis.diagnostics.descriptionPreview, waterDescription)
assert.equal(objectAnalysis.diagnostics.descriptionHash, waterRequirementsMetadata.descriptionHash)
assert.equal(
  objectAnalysis.questions.some((question) => /hydration|water/i.test(question.label)),
  true,
  "Expected object-shaped requirements JSON to return domain-specific questions."
)

const invalidThenValidAnalysis = await runProjectPlanningAnalysisProviderRace({
  description: waterDescription,
  systemPrompt: "system",
  userPrompt: "user",
  maxTokens: 100,
  timeoutMs: 200,
  providers: [
    {
      name: "Kimi",
      configured: true,
      call: async () => "{\"s\":[],\"q\":[]}"
    },
    {
      name: "DeepSeek",
      configured: true,
      call: async () => {
        await delay(10)
        return validWaterAnalysisJson
      }
    }
  ]
})

assert.equal(invalidThenValidAnalysis.diagnostics.providerName, "DeepSeek")
assert.equal(
  invalidThenValidAnalysis.diagnostics.providerAttempts?.some((attempt) => attempt.providerName === "Kimi" && attempt.status === "failed"),
  true,
  "Expected invalid provider output not to win the Gather Requirements race."
)

const repairedAnalysis = await runProjectPlanningAnalysisProviderRace({
  description: waterDescription,
  systemPrompt: "system",
  userPrompt: "user",
  maxTokens: 100,
  timeoutMs: 2500,
  metadata: waterRequirementsMetadata,
  providers: [
    {
      name: "Kimi",
      configured: true,
      call: async () => `{"summary":"broken","sections":[{"key":"problem","status":"partial"`,
      repairJson: async () => validWaterAnalysisObjectJson
    }
  ]
})

assert.equal(repairedAnalysis.diagnostics.providerName, "Kimi")
assert.equal(repairedAnalysis.diagnostics.malformedJson, true)
assert.equal(repairedAnalysis.diagnostics.repairAttempted, true)
assert.equal(repairedAnalysis.diagnostics.repairSucceeded, true)
assert.equal(repairedAnalysis.diagnostics.providerAttempts?.[0]?.repairSucceeded, true)
assert.equal(
  repairedAnalysis.questions.some((question) => /hydration|water/i.test(question.label)),
  true,
  "Expected malformed-JSON-only LLM repair to recover a domain-specific questionnaire."
)

let retryAnalysisCallCount = 0
const retriedAnalysis = await runProjectPlanningAnalysisProviderRace({
  description: waterDescription,
  systemPrompt: "system",
  userPrompt: "user",
  maxTokens: 100,
  timeoutMs: 1200,
  providers: [
    {
      name: "Kimi",
      configured: true,
      call: async () => {
        retryAnalysisCallCount += 1
        return retryAnalysisCallCount === 1 ? null : validWaterAnalysisJson
      }
    }
  ]
})

assert.equal(retriedAnalysis.diagnostics.providerName, "Kimi")
assert.equal(retryAnalysisCallCount, 2, "Expected Gather Requirements to retry once after an empty provider response.")
assert.equal(
  retriedAnalysis.diagnostics.providerAttempts?.[0]?.retryCount,
  1,
  "Expected Gather Requirements diagnostics to expose the successful retry count."
)

await assert.rejects(
  () => runProjectPlanningAnalysisProviderRace({
    description: waterDescription,
    systemPrompt: "system",
    userPrompt: "user",
    maxTokens: 100,
    timeoutMs: 80,
    providers: [
      {
        name: "Kimi",
        configured: true,
        call: async (signal) => {
          await delay(120)
          if (signal.aborted) throw new Error("aborted")
          return validWaterAnalysisJson
        }
      },
      {
        name: "DeepSeek",
        configured: true,
        call: async (signal) => {
          await delay(120)
          if (signal.aborted) throw new Error("aborted")
          return validWaterAnalysisJson
        }
      }
    ]
  }),
  (error) =>
    error instanceof Error &&
    /timed out/i.test(error.message) &&
    error.diagnostics?.errorReason === "provider_timeout" &&
    error.diagnostics?.fallbackUsed === false
)

const genericQuestions = [
  {
    id: "target",
    criterion: "target_user",
    label: "Who is this first version mainly for?",
    helper: "Keep it simple and name the main person this product is helping first.",
    mode: "single",
    options: ["Just me", "Customers", "My internal team", "Admins or operators", "Other"]
  },
  {
    id: "success",
    criterion: "success_criteria",
    label: "What would make this first release feel clearly successful?",
    helper: "Think about the outcome you would want to see after using it.",
    mode: "multi",
    options: ["The core flow works end to end", "The experience feels simple and clear", "Other"]
  }
]

assert.match(
  validateQuestionnaireSpecificity({
    description: waterDescription,
    questions: genericQuestions
  }) ?? "",
  /generic|concrete terms/i,
  "Expected generic questionnaire to fail quality gate."
)

let genericRepairCallCount = 0
await assert.rejects(
  () => runProjectPlanningAnalysisProviderRace({
    description: waterDescription,
    systemPrompt: "system",
    userPrompt: "user",
    maxTokens: 100,
    timeoutMs: 500,
    metadata: waterRequirementsMetadata,
    providers: [
      {
        name: "Kimi",
        configured: true,
        call: async () => JSON.stringify({
          ...JSON.parse(validWaterAnalysisObjectJson),
          questions: genericQuestions.map((question) => ({
            id: question.id,
            section: question.criterion,
            question: question.label,
            why: question.helper,
            mode: question.mode,
            options: question.options
          }))
        }),
        repairJson: async () => {
          genericRepairCallCount += 1
          return validWaterAnalysisObjectJson
        }
      }
    ]
  }),
  (error) =>
    error instanceof Error &&
    error.diagnostics?.providerAttempts?.[0]?.errorReason === "questionnaire_quality_failed" &&
    error.diagnostics?.providerAttempts?.[0]?.repairAttempted !== true
)
assert.equal(genericRepairCallCount, 0, "Expected valid-but-generic JSON not to call repair.")

const waterQuestions = [
  {
    id: "hydration_goal",
    criterion: "goal_outcome",
    label: "What hydration goal should the water intake app help users track first?",
    helper: "This decides how daily progress and reminders are calculated.",
    mode: "single",
    options: ["Fixed daily water goal", "Goal based on body weight", "Custom user-entered goal", "Other"]
  },
  {
    id: "logging_method",
    criterion: "core_requirements",
    label: "How should users log water intake in the MVP?",
    helper: "Pick the fastest logging method for the first water tracking release.",
    mode: "multi",
    options: ["Quick-add common cup sizes", "Manual amount entry", "Edit or delete logged entries", "Other"]
  }
]

assert.equal(
  validateQuestionnaireSpecificity({
    description: waterDescription,
    questions: waterQuestions
  }),
  null,
  "Expected domain-specific water questions to pass quality gate."
)

const coverageReport = {
  buckets: [
    {
      key: "scope",
      title: "Scope",
      status: "partial",
      confidence: 0.7,
      evidenceSnippets: [],
      resolvedValue: "MVP should focus on daily water logging and reminder setup."
    }
  ],
  summary: { present: 0, partial: 1, missing: 0, conflicting: 0 }
}

const waterPrdSnapshot = {
  problem: {
    status: "partial",
    draft: "Users forget to track water intake during the day.",
    missing: ["Target user context"]
  },
  target_user: {
    status: "missing",
    draft: "",
    missing: ["Who should use the water intake app first?"]
  },
  goal_outcome: {
    status: "partial",
    draft: "Help users meet a daily hydration goal.",
    missing: ["Exact goal behavior"]
  },
  scope: {
    status: "partial",
    draft: "MVP focused on water logging, reminders, and progress.",
    missing: ["Unit handling"]
  },
  core_requirements: {
    status: "partial",
    draft: "Water intake log, reminders, and daily progress.",
    missing: ["Edit/delete entries", "Notification permission"]
  },
  non_goals: {
    status: "missing",
    draft: "",
    missing: ["Out-of-scope wellness features"]
  },
  constraints: {
    status: "missing",
    draft: "",
    missing: ["Platform constraints"]
  },
  success_criteria: {
    status: "missing",
    draft: "",
    missing: ["What proves the app works?"]
  },
  assumptions_risks: {
    status: "missing",
    draft: "",
    missing: ["Reminder fatigue"]
  }
}

const draftInput = {
  projectLabel: "Water Intake",
  description: waterDescription,
  intakeFields: {
    appIdea: "water intake app",
    targetUsers: "People who forget to hydrate during busy days.",
    problem: "They do not know whether they reached their daily hydration goal.",
    firstVersion: "Set a daily goal, log water, edit entries, see progress, and receive reminders.",
    skipForNow: "No wearable integrations.",
    anythingElse: "Support cups and liters."
  },
  coverageReport,
  prdSnapshot: waterPrdSnapshot,
  questions: waterQuestions.map((question) => ({
    ...question,
    fillsSections: [question.criterion]
  })),
  answerState: {
    hydration_goal: "Fixed daily water goal",
    logging_method: ["Quick-add common cup sizes", "Edit or delete logged entries"]
  },
  otherAnswerState: {}
}

const resolvedDraftInputs = buildResolvedDraftInputs(draftInput)
const compactDraftContext = buildCompactDraftContext(resolvedDraftInputs, waterPrdSnapshot)
const draftPromptInput = buildProjectPlanningDraftPromptInput({
  projectLabel: draftInput.projectLabel,
  compactDraftContext
})
const draftPromptContext = JSON.parse(draftPromptInput.userPrompt.split("\n")[0])

assert.ok(
  draftPromptInput.maxTokens >= 1000 && draftPromptInput.maxTokens <= 1150,
  "Expected Build PRD Draft to use a bounded but complete output budget."
)
assert.ok(
  draftPromptInput.systemPrompt.length + draftPromptInput.userPrompt.length < 3200,
  `Expected Build PRD Draft prompt to stay compact. length=${draftPromptInput.systemPrompt.length + draftPromptInput.userPrompt.length}`
)
assert.match(draftPromptInput.systemPrompt, /from the intake/i)
assert.match(draftPromptInput.systemPrompt, /valid JSON object/i)
assert.match(draftPromptInput.userPrompt, /intake wins/i)
assert.match(draftPromptInput.userPrompt, /Infer gaps in assumptionsRisks/i)
assert.match(draftPromptInput.userPrompt, /arrays only for list fields/i)
assert.match(draftPromptInput.userPrompt, /Exactly 3 implementation phases/i)
assert.match(draftPromptInput.userPrompt, /buildScope=2/i)
assert.match(draftPromptInput.userPrompt, /outOfScope=1/i)
assert.match(draftPromptInput.userPrompt, /validationProof=1/i)
assert.match(
  draftPromptInput.userPrompt,
  /No cohorts, studies, app-store\/public beta, business reports, or real-user metrics in phase fields/i,
  "Expected Build PRD Draft to keep external validation out of implementation phase fields."
)
assert.match(draftPromptInput.userPrompt, /under 14 words/i)
assert.equal(
  resolvedDraftInputs.intakeFields.firstVersion,
  "Set a daily goal, log water, edit entries, see progress, and receive reminders.",
  "Expected Build PRD Draft to preserve explicit intake fields."
)
assert.equal(
  compactDraftContext.intake.skipForNow,
  "No wearable integrations.",
  "Expected compact draft context to carry the intake non-goals field."
)
assert.equal(
  draftPromptContext.intake.problem,
  "They do not know whether they reached their daily hydration goal.",
  "Expected the draft prompt to send intake fields as first-class context."
)
assert.doesNotMatch(
  draftPromptInput.userPrompt,
  /Return compact JSON only\.\s+Draft the final MVP PRD/i,
  "Expected Build PRD Draft to avoid the older verbose prompt body."
)

assert.equal(compactDraftContext.desc, waterDescription)
assert.equal(
  compactDraftContext.s.find((section) => section[0] === "scope")?.[2],
  "MVP focused on water logging, reminders, and progress."
)
assert.deepEqual(compactDraftContext.a[0].f, ["goal_outcome"])
assert.equal(compactDraftContext.a[1].ans, "Quick-add common cup sizes; Edit or delete logged entries")

const compatibilitySnapshot = buildPrdSnapshotFromCoverageReport(coverageReport)
assert.equal(compatibilitySnapshot.scope.status, "partial")
assert.equal(compatibilitySnapshot.scope.draft, "MVP should focus on daily water logging and reminder setup.")

const validWaterDraftPayload = {
  d: [
    "Water Intake App MVP PRD",
    "A focused water intake app for daily hydration goals, logging, reminders, and progress tracking.",
    "Users forget how much water they drank and need simple intake tracking throughout the day.",
    "People who want lightweight hydration tracking without a broader wellness platform.",
    "Help users log water quickly, stay aware of daily progress, and receive reminder nudges.",
    "The MVP includes hydration goal setup, quick-add logging, edit/delete entries, reminders, unit selection, daily reset, and notification permission handling."
  ],
  r: [
    "Set a daily hydration goal",
    "Log water intake with quick-add amounts",
    "Edit or delete water intake entries",
    "Show daily hydration progress",
    "Request notification permission before reminders"
  ],
  n: ["No meal tracking", "No wearable integrations"],
  c: ["Keep state simple", "Support clear notification permission states"],
  sc: ["A user can set a goal", "A user can log and correct intake", "Daily progress resets clearly"],
  ar: ["Reminder timing may need tuning", "Users may ignore notification permission"],
  p: [
    [
      "Hydration Goal and Intake Data",
      "Create the goal and water intake log foundation.",
      ["Store daily hydration goal", "Represent intake entries"],
      ["Do not build reminders in this phase"],
      ["Goal amount, unit, entry amount, entry timestamp"],
      ["Daily hydration goal state", "Water intake entries with amount, unit, and timestamp"],
      ["A goal can be saved", "A water entry can be represented and listed"],
      ["Show saved goal and one listed intake entry"]
    ],
    [
      "Water Logging and Entry Management",
      "Build the main logging UI.",
      ["Add quick-add logging controls", "Add edit/delete entry behavior"],
      ["Do not build weekly history in this phase"],
      ["Daily total derived from entries"],
      ["Quick-add amount controls", "Edit/delete controls for intake entries"],
      ["A user can log water quickly", "A user can correct or remove an entry"],
      ["Show add, edit, and delete changing the daily total"]
    ],
    [
      "Daily Progress and Reminders",
      "Add progress reset and reminder permission behavior.",
      ["Show progress toward the daily goal", "Handle reminder permission and interval settings"],
      ["Do not add social sharing"],
      ["Reminder interval, permission state, daily reset date"],
      ["Daily progress indicator", "Notification permission and reminder setup"],
      ["Progress reflects logged intake", "Reminder setup explains permission state"],
      ["Show progress reaching the goal and permission messaging"]
    ]
  ]
}

const validWaterDraftObjectJson = JSON.stringify({
  title: "Water Intake App MVP PRD",
  overview: "A focused water intake app for daily hydration goals, logging, reminders, and progress tracking.",
  problem: "Users forget how much water they drank and need simple intake tracking throughout the day.",
  targetUser: "People who want lightweight hydration tracking without a broader wellness platform.",
  goal: "Help users log water quickly, stay aware of daily progress, and receive reminder nudges.",
  scope: "The MVP includes hydration goal setup, quick-add logging, edit/delete entries, reminders, unit selection, daily reset, and notification permission handling.",
  requirements: [
    "Set a daily hydration goal",
    "Log water intake with quick-add amounts",
    "Edit or delete water intake entries",
    "Show daily hydration progress",
    "Request notification permission before reminders"
  ],
  nonGoals: ["No meal tracking", "No wearable integrations"],
  constraints: ["Keep state simple", "Support clear notification permission states"],
  successCriteria: ["A user can set a goal", "A user can log and correct intake", "Daily progress resets clearly"],
  assumptionsRisks: ["Reminder timing may need tuning", "Users may ignore notification permission"],
  phases: [
    {
      title: "Hydration Goal and Intake Data",
      goal: "Create the goal and water intake log foundation.",
      buildScope: ["Store daily hydration goal", "Represent intake entries"],
      outOfScope: ["Do not build reminders in this phase"],
      dataState: ["Goal amount, unit, entry amount, entry timestamp"],
      deliverables: ["Daily hydration goal state", "Water intake entries with amount, unit, and timestamp"],
      acceptanceCriteria: ["A goal can be saved", "A water entry can be represented and listed"],
      validationProof: ["Show saved goal and one listed intake entry"]
    },
    {
      title: "Water Logging and Entry Management",
      goal: "Build the main logging UI.",
      buildScope: ["Add quick-add logging controls", "Add edit/delete entry behavior"],
      outOfScope: ["Do not build weekly history in this phase"],
      dataState: ["Daily total derived from entries"],
      deliverables: ["Quick-add amount controls", "Edit/delete controls for intake entries"],
      acceptanceCriteria: ["A user can log water quickly", "A user can correct or remove an entry"],
      validationProof: ["Show add, edit, and delete changing the daily total"]
    },
    {
      title: "Daily Progress and Reminders",
      goal: "Add progress reset and reminder permission behavior.",
      buildScope: ["Show progress toward the daily goal", "Handle reminder permission and interval settings"],
      outOfScope: ["Do not add social sharing"],
      dataState: ["Reminder interval, permission state, daily reset date"],
      deliverables: ["Daily progress indicator", "Notification permission and reminder setup"],
      acceptanceCriteria: ["Progress reflects logged intake", "Reminder setup explains permission state"],
      validationProof: ["Show progress reaching the goal and permission messaging"]
    }
  ]
})

const validWaterDraftFlatJson = JSON.stringify({
  title: "Water Intake App MVP PRD",
  overview: "A focused water intake app for daily hydration goals, logging, reminders, and progress tracking.",
  problem: "Users forget how much water they drank and need simple intake tracking throughout the day.",
  targetUser: "People who want lightweight hydration tracking without a broader wellness platform.",
  goal: "Help users log water quickly, stay aware of daily progress, and receive reminder nudges.",
  scope: "Hydration goal setup, quick-add logging, edit/delete entries, reminders, unit selection, daily reset, and notification permission handling.",
  requirements: "- Set a daily hydration goal\n- Log water intake with quick-add amounts\n- Edit or delete water intake entries\n- Show daily hydration progress",
  nonGoals: "- No meal tracking\n- No wearable integrations",
  constraints: "- Keep state simple\n- Support clear notification permission states",
  successCriteria: "- A user can set a goal\n- A user can log and correct intake\n- Daily progress resets clearly",
  assumptionsRisks: "- Reminder timing may need tuning\n- Users may ignore notification permission",
  phase1Title: "Hydration Goal and Intake Data",
  phase1Goal: "Create the goal and water intake log foundation.",
  phase1Deliverables: "- Daily hydration goal state\n- Water intake entries with amount, unit, and timestamp",
  phase1AcceptanceCriteria: "- A goal can be saved\n- A water entry can be represented and listed",
  phase2Title: "Water Logging and Entry Management",
  phase2Goal: "Build the main logging UI.",
  phase2Deliverables: "- Quick-add amount controls\n- Edit/delete controls for intake entries",
  phase2AcceptanceCriteria: "- A user can log water quickly\n- A user can correct or remove an entry",
  phase3Title: "Daily Progress and Reminders",
  phase3Goal: "Add progress reset and reminder permission behavior.",
  phase3Deliverables: "- Daily progress indicator\n- Notification permission and reminder setup",
  phase3AcceptanceCriteria: "- Progress reflects logged intake\n- Reminder setup explains permission state"
})

const validWaterDraftFlatArrayJson = JSON.stringify({
  title: "Water Intake App MVP PRD",
  overview: "A focused water intake app for daily hydration goals, logging, reminders, and progress tracking.",
  problem: "Users forget how much water they drank and need simple intake tracking throughout the day.",
  targetUser: "People who want lightweight hydration tracking without a broader wellness platform.",
  goal: "Help users log water quickly, stay aware of daily progress, and receive reminder nudges.",
  scope: "Hydration goal setup, quick-add logging, edit/delete entries, reminders, unit selection, daily reset, and notification permission handling.",
  requirements: [
    "Set a daily hydration goal",
    "Log water intake with quick-add amounts",
    "Edit or delete water intake entries",
    "Show daily hydration progress"
  ],
  nonGoals: ["No meal tracking", "No wearable integrations"],
  constraints: ["Keep state simple", "Support clear notification permission states"],
  successCriteria: ["A user can set a goal", "A user can log and correct intake", "Daily progress resets clearly"],
  assumptionsRisks: ["Reminder timing may need tuning", "Users may ignore notification permission"],
  phase1Title: "Hydration Goal and Intake Data",
  phase1Goal: "Create the goal and water intake log foundation.",
  phase1BuildScope: ["Store daily hydration goal", "Represent intake entries"],
  phase1OutOfScope: ["Do not build reminders in this phase"],
  phase1DataState: ["Goal amount, unit, entry amount, entry timestamp"],
  phase1Deliverables: ["Daily hydration goal state", "Water intake entries with amount, unit, and timestamp"],
  phase1AcceptanceCriteria: ["A goal can be saved", "A water entry can be represented and listed"],
  phase1ValidationProof: ["Show saved goal and one listed intake entry"],
  phase2Title: "Water Logging and Entry Management",
  phase2Goal: "Build the main logging UI.",
  phase2BuildScope: ["Add quick-add logging controls", "Add edit/delete entry behavior"],
  phase2OutOfScope: ["Do not build weekly history in this phase"],
  phase2DataState: ["Daily total derived from entries"],
  phase2Deliverables: ["Quick-add amount controls", "Edit/delete controls for intake entries"],
  phase2AcceptanceCriteria: ["A user can log water quickly", "A user can correct or remove an entry"],
  phase2ValidationProof: ["Show add, edit, and delete changing the daily total"],
  phase3Title: "Daily Progress and Reminders",
  phase3Goal: "Add progress reset and reminder permission behavior.",
  phase3BuildScope: ["Show progress toward the daily goal", "Handle reminder permission and interval settings"],
  phase3OutOfScope: ["Do not add social sharing"],
  phase3DataState: ["Reminder interval, permission state, daily reset date"],
  phase3Deliverables: ["Daily progress indicator", "Notification permission and reminder setup"],
  phase3AcceptanceCriteria: ["Progress reflects logged intake", "Reminder setup explains permission state"],
  phase3ValidationProof: ["Show progress reaching the goal and permission messaging"]
})

const compactPrdDraft = buildDraftFromCompactPrd(validWaterDraftPayload)

assert.equal(compactPrdDraft.sections.find((section) => section.id === "problem")?.body.includes("Users forget"), true)
assert.equal(compactPrdDraft.implementationPhases[0].deliverables[0], "Daily hydration goal state")
assert.equal(compactPrdDraft.implementationPhases[0].buildScope[0], "Store daily hydration goal")
assert.match(
  compactPrdDraft.sections.find((section) => section.id === "implementation-phases")?.body ?? "",
  /Hydration Goal and Intake Data: Create the goal and water intake log foundation/i,
  "Expected the implementation phases section to stay a concise summary."
)
assert.doesNotMatch(
  compactPrdDraft.sections.find((section) => section.id === "implementation-phases")?.body ?? "",
  /Data\/state needed/i,
  "Expected detailed phase fields to be rendered separately from the summary section."
)
assert.match(
  compactPrdDraft.sections.find((section) => section.id === "implementation-handoff")?.body ?? "",
  /implement phase 1 only/i,
  "Expected the visible PRD draft to include the implementation handoff."
)
assert.match(compactPrdDraft.submissionPrompt, /implement phase 1 only/i)
assert.match(compactPrdDraft.submissionPrompt, /validated against its acceptance criteria/i)
assert.match(compactPrdDraft.submissionPrompt, /concrete implementation validation proof/i)
assert.match(
  compactPrdDraft.submissionPrompt,
  /real-user studies, cohort metrics, public beta\/app-store release/i,
  "Expected submission prompt to separate external validation and release work from coding deliverables."
)
assert.match(compactPrdDraft.submissionPrompt, /wait for the user's confirmation/i)
assert.match(
  compactPrdDraft.submissionPrompt,
  /Implement this PRD one phase at a time\.\n\nWater Intake App MVP PRD/i,
  "Expected submission prompt headings to preserve blank-line formatting."
)
assert.doesNotMatch(
  compactPrdDraft.submissionPrompt,
  /time\.Water Intake App|criteria\.PRD|rule:-/i,
  "Expected submission prompt text not to collapse headings together."
)
assert.ok(
  compactPrdDraft.submissionPrompt.indexOf("Implementation phases") <
    compactPrdDraft.submissionPrompt.indexOf("Implementation handoff"),
  "Expected implementation handoff to appear after detailed implementation phases."
)

const keyedPrdFields = buildPrdFieldsFromCompactDraft({
  ...validWaterDraftPayload,
  d: {
    title: "Water Intake App MVP PRD",
    overview: "A focused water intake app for hydration goals and daily progress.",
    problem: "Users forget how much water they drank during the day.",
    targetUser: "People who want lightweight hydration tracking.",
    goal: "Help users log water and meet a daily hydration goal.",
    scope: "The MVP covers water logging, reminders, unit selection, and daily reset."
  }
})

assert.equal(keyedPrdFields.problem, "Users forget how much water they drank during the day.")
assert.equal(keyedPrdFields.goal, "Help users log water and meet a daily hydration goal.")

assert.throws(
  () => buildProjectPlanningDraftResponseFromCompactData({
    description: waterDescription,
    resolvedDraftInputs,
    compactData: {
      ...validWaterDraftPayload,
      d: [
        "TableTurn MVP",
        "Mobile-first restaurant booking with manual host confirmation to reduce no-shows.",
        "overview",
        "Restaurants lose walk-ins during peak hours while diners wait too long.",
        "problem",
        "Restaurants need a scoped MVP for booking requests and host confirmation."
      ]
    },
    diagnostics: createPlanningDiagnostics({
      aiAvailable: true,
      providerName: "Kimi",
      durationMs: 42,
      outputQualityStatus: "passed"
    })
  }),
  /mapped/i,
  "Expected shifted literal PRD section names to fail mapping validation."
)

const validWaterDraftJson = JSON.stringify(validWaterDraftPayload)
const waterDraftMetadata = buildProjectPlanningRequestMetadata({
  description: waterDescription,
  projectLabel: "Water Intake",
  promptKind: "prd_draft"
})

const racedDraft = await runProjectPlanningDraftProviderRace({
  description: waterDescription,
  resolvedDraftInputs,
  systemPrompt: "system",
  userPrompt: "user",
  maxTokens: 100,
  timeoutMs: 200,
  providers: [
    {
      name: "Kimi",
      configured: true,
      call: async () => {
        await delay(60)
        return validWaterDraftJson
      }
    },
    {
      name: "DeepSeek",
      configured: true,
      call: async () => {
        await delay(5)
        return validWaterDraftJson
      }
    }
  ]
})

assert.equal(racedDraft.diagnostics.providerName, "DeepSeek")
assert.equal(racedDraft.diagnostics.fallbackUsed, false)
assert.equal(racedDraft.draft.implementationPhases.length, 3)
assert.match(racedDraft.draft.submissionPrompt, /implement phase 1 only/i)
assert.equal(
  racedDraft.diagnostics.providerAttempts?.some((attempt) => attempt.providerName === "Kimi" && attempt.status === "aborted"),
  true,
  "Expected the slower PRD draft race participant to be traced as aborted."
)

const objectDraft = await runProjectPlanningDraftProviderRace({
  description: waterDescription,
  resolvedDraftInputs,
  systemPrompt: "system",
  userPrompt: "user",
  maxTokens: 100,
  timeoutMs: 500,
  metadata: waterDraftMetadata,
  providers: [
    {
      name: "Kimi",
      configured: true,
      call: async () => validWaterDraftObjectJson
    }
  ]
})

assert.equal(objectDraft.diagnostics.providerName, "Kimi")
assert.equal(objectDraft.diagnostics.promptKind, "prd_draft")
assert.equal(objectDraft.diagnostics.descriptionHash, waterDraftMetadata.descriptionHash)
assert.match(objectDraft.draft.sections.find((section) => section.id === "problem")?.body ?? "", /water/i)
assert.equal(objectDraft.draft.implementationPhases.length, 3)

const flatDraft = await runProjectPlanningDraftProviderRace({
  description: waterDescription,
  resolvedDraftInputs,
  systemPrompt: "system",
  userPrompt: "user",
  maxTokens: 100,
  timeoutMs: 500,
  metadata: waterDraftMetadata,
  providers: [
    {
      name: "Kimi",
      configured: true,
      call: async () => validWaterDraftFlatJson
    }
  ]
})

assert.equal(flatDraft.diagnostics.providerName, "Kimi")
assert.equal(flatDraft.draft.implementationPhases.length, 3)
assert.equal(
  flatDraft.draft.implementationPhases[0].deliverables[0],
  "Daily hydration goal state",
  "Expected flat PRD bullet strings to be converted into phase deliverable arrays."
)
assert.match(
  flatDraft.draft.sections.find((section) => section.id === "requirements")?.body ?? "",
  /Set a daily hydration goal/i,
  "Expected flat PRD bullet strings to render in the existing PRD sections."
)

const flatArrayDraft = await runProjectPlanningDraftProviderRace({
  description: waterDescription,
  resolvedDraftInputs,
  systemPrompt: "system",
  userPrompt: "user",
  maxTokens: 100,
  timeoutMs: 500,
  metadata: waterDraftMetadata,
  providers: [
    {
      name: "Kimi",
      configured: true,
      call: async () => validWaterDraftFlatArrayJson
    }
  ]
})

assert.equal(flatArrayDraft.diagnostics.providerName, "Kimi")
assert.equal(
  flatArrayDraft.draft.implementationPhases[0].acceptanceCriteria[0],
  "A goal can be saved",
  "Expected flat PRD array values to be accepted and normalized."
)

const nearValidObjectDraft = await runProjectPlanningDraftProviderRace({
  description: waterDescription,
  resolvedDraftInputs,
  systemPrompt: "system",
  userPrompt: "user",
  maxTokens: 100,
  timeoutMs: 500,
  metadata: waterDraftMetadata,
  providers: [
    {
      name: "Kimi",
      configured: true,
      call: async () => JSON.stringify({
        title: "Water Intake App MVP PRD",
        overview: "A focused water intake app for daily hydration goals, logging, reminders, and progress tracking.",
        problem: "Users forget how much water they drank and need simple intake tracking throughout the day.",
        targetUser: "People who want lightweight hydration tracking.",
        goal: "Help users log water quickly and stay aware of daily progress.",
        scope: "Hydration goal setup, quick-add logging, reminders, and progress tracking.",
        requirements: "Set a daily hydration goal; log water intake; show daily hydration progress",
        nonGoals: "No meal tracking",
        constraints: "Keep state simple",
        successCriteria: "A user can set a goal and log water",
        assumptionsRisks: "Reminder timing may need tuning",
        phases: [
          {
            title: "Hydration Goal and Intake Data",
            goal: "Create the goal and water intake log foundation.",
            deliverables: "Daily hydration goal state",
            acceptanceCriteria: "A goal can be saved"
          }
        ]
      })
    }
  ]
})

assert.equal(nearValidObjectDraft.diagnostics.providerName, "Kimi")
assert.equal(
  nearValidObjectDraft.draft.implementationPhases.length,
  2,
  "Expected near-valid object PRD JSON with one phase to be normalized instead of rejected."
)
assert.deepEqual(
  nearValidObjectDraft.draft.implementationPhases[0].acceptanceCriteria,
  ["A goal can be saved"],
  "Expected string acceptance criteria to be normalized into an array."
)

const invalidThenValidDraft = await runProjectPlanningDraftProviderRace({
  description: waterDescription,
  resolvedDraftInputs,
  systemPrompt: "system",
  userPrompt: "user",
  maxTokens: 100,
  timeoutMs: 200,
  providers: [
    {
      name: "Kimi",
      configured: true,
      call: async () => JSON.stringify({
        ...validWaterDraftPayload,
        p: []
      })
    },
    {
      name: "DeepSeek",
      configured: true,
      call: async () => {
        await delay(10)
        return validWaterDraftJson
      }
    }
  ]
})

assert.equal(invalidThenValidDraft.diagnostics.providerName, "DeepSeek")
assert.equal(
  invalidThenValidDraft.diagnostics.providerAttempts?.some((attempt) => attempt.providerName === "Kimi" && attempt.status === "failed"),
  true,
  "Expected a PRD draft without phases not to win the provider race."
)

const blankPhaseTitleThenValidDraft = await runProjectPlanningDraftProviderRace({
  description: waterDescription,
  resolvedDraftInputs,
  systemPrompt: "system",
  userPrompt: "user",
  maxTokens: 100,
  timeoutMs: 200,
  providers: [
    {
      name: "Kimi",
      configured: true,
      call: async () => JSON.stringify({
        ...validWaterDraftPayload,
        p: validWaterDraftPayload.p.map((phase) => ["", ...phase.slice(1)])
      })
    },
    {
      name: "DeepSeek",
      configured: true,
      call: async () => {
        await delay(10)
        return validWaterDraftJson
      }
    }
  ]
})

assert.equal(blankPhaseTitleThenValidDraft.diagnostics.providerName, "DeepSeek")
assert.equal(
  blankPhaseTitleThenValidDraft.diagnostics.providerAttempts?.some((attempt) => attempt.providerName === "Kimi" && attempt.status === "failed"),
  true,
  "Expected a repaired PRD draft with blank phase titles not to win the provider race."
)
assert.deepEqual(
  blankPhaseTitleThenValidDraft.draft.implementationPhases.map((phase) => phase.title),
  validWaterDraftPayload.p.map((phase) => phase[0]),
  "Expected the winning PRD draft to preserve concrete phase titles."
)

let retryDraftCallCount = 0
const retriedDraft = await runProjectPlanningDraftProviderRace({
  description: waterDescription,
  resolvedDraftInputs,
  systemPrompt: "system",
  userPrompt: "user",
  maxTokens: 100,
  timeoutMs: 1200,
  providers: [
    {
      name: "DeepSeek",
      configured: true,
      call: async () => {
        retryDraftCallCount += 1
        return retryDraftCallCount === 1 ? null : validWaterDraftJson
      }
    }
  ]
})

assert.equal(retriedDraft.diagnostics.providerName, "DeepSeek")
assert.equal(retryDraftCallCount, 2, "Expected Build PRD Draft to retry once after an empty provider response.")
assert.equal(
  retriedDraft.diagnostics.providerAttempts?.[0]?.retryCount,
  1,
  "Expected Build PRD Draft diagnostics to expose the successful retry count."
)

await assert.rejects(
  () => runProjectPlanningDraftProviderRace({
    description: waterDescription,
    resolvedDraftInputs,
    systemPrompt: "system",
    userPrompt: "user",
    maxTokens: 100,
    timeoutMs: 80,
    providers: [
      {
        name: "Kimi",
        configured: true,
        call: async (signal) => {
          await delay(120)
          if (signal.aborted) throw new Error("aborted")
          return validWaterDraftJson
        }
      },
      {
        name: "DeepSeek",
        configured: true,
        call: async (signal) => {
          await delay(120)
          if (signal.aborted) throw new Error("aborted")
          return validWaterDraftJson
        }
      }
    ]
  }),
  (error) =>
    error instanceof Error &&
    /timed out/i.test(error.message) &&
    error.diagnostics?.errorReason === "provider_timeout" &&
    error.diagnostics?.fallbackUsed === false
)

const genericDraft = {
  title: "water intake app PRD draft",
  summary: "A generic PRD.",
  sections: [
    { id: "overview", title: "Product Overview", body: "water intake app" },
    { id: "problem", title: "Problem", body: "The product needs to solve the core user pain described in the planning brief." },
    { id: "target-user", title: "Target User", body: "The first release should focus on the main user described in the planning brief." },
    { id: "goal", title: "Primary Goal", body: "Deliver a first version that solves the main problem clearly." },
    { id: "scope", title: "Scope", body: "Keep the first release focused on the narrowest complete version needed to deliver the core value." },
    { id: "requirements", title: "Core Requirements", body: "Build the must-have flows and product behaviors described in the planning brief." },
    { id: "non-goals", title: "Non-Goals", body: "Do not add unrelated workflows." },
    { id: "constraints", title: "Constraints", body: "Respect the current product boundaries." },
    { id: "success", title: "Success Criteria", body: "The first release should work end to end." },
    { id: "implementation-phases", title: "Implementation Phases", body: "- Phase 1: Core setup\n- Phase 2: Main experience" },
    { id: "assumptions-risks", title: "Assumptions / Risks", body: "Assumptions remain unresolved." }
  ],
  implementationPhases: [
    {
      id: "phase_1",
      title: "Phase 1 - Core setup",
      goal: "Set up the core structure.",
      deliverables: ["Core data shape", "Basic workflow wiring"],
      acceptanceCriteria: ["The main workflow can be started"]
    },
    {
      id: "phase_2",
      title: "Phase 2 - Main experience",
      goal: "Build the primary user-facing experience.",
      deliverables: ["Primary UI"],
      acceptanceCriteria: ["A user can complete the main flow"]
    }
  ],
  submissionPrompt: "PRD handoff"
}

assert.match(
  validatePrdSpecificity({
    description: waterDescription,
    resolvedDraftInputs,
    draft: genericDraft
  }) ?? "",
  /placeholder|generic/i,
  "Expected generic PRD to fail quality gate."
)

const waterDraft = {
  title: "Water Intake App MVP PRD",
  summary: "An MVP for logging water intake, tracking daily hydration progress, and nudging users with reminders.",
  sections: [
    { id: "overview", title: "Product Overview", body: "The water intake app helps users set a daily hydration goal, log each water entry, and see daily progress reset each day." },
    { id: "problem", title: "Problem", body: "Users forget how much water they drank and need a simple way to log intake throughout the day." },
    { id: "target-user", title: "Target User", body: "The MVP targets people who want lightweight hydration tracking without a complex wellness platform." },
    { id: "goal", title: "Primary Goal", body: "Help users log water quickly, compare intake against a fixed daily water goal, and receive reminder nudges." },
    { id: "scope", title: "Scope", body: "The MVP includes daily water goal setup, quick-add cup sizes, manual amount entry, edit/delete intake entries, daily progress, and notification permission handling." },
    { id: "requirements", title: "Core Requirements", body: "- Set a fixed daily water goal\n- Log water with quick-add cup sizes\n- Edit or delete logged water entries\n- Show daily hydration progress\n- Reset progress each day\n- Request notification permission before reminders" },
    { id: "non-goals", title: "Non-Goals", body: "No meal tracking, wearable integrations, social sharing, or advanced analytics in the MVP." },
    { id: "constraints", title: "Constraints", body: "Keep the app lightweight and focused on water tracking, local state, and clear reminder permission handling." },
    { id: "success", title: "Success Criteria", body: "A user can set a hydration goal, log water, edit/delete entries, see daily progress, and understand reminder permission state." },
    { id: "implementation-phases", title: "Implementation Phases", body: "- Phase 1: Hydration goal and water log model\n- Phase 2: Water logging UI and edit/delete entries\n- Phase 3: Daily progress reset and reminder permission states" },
    { id: "assumptions-risks", title: "Assumptions / Risks", body: "Assume a fixed daily water goal is enough for the MVP; reminder timing may need later tuning." }
  ],
  implementationPhases: [
    {
      id: "phase_1",
      title: "Phase 1 - Hydration goal and water log model",
      goal: "Create the state needed for a daily hydration goal and water intake entries.",
      deliverables: ["Daily water goal state", "Water intake log entries with amount and timestamp", "Daily reset boundary"],
      acceptanceCriteria: ["A user can store a daily water goal", "Water entries can be represented with amount and time"]
    },
    {
      id: "phase_2",
      title: "Phase 2 - Water logging UI and edit/delete entries",
      goal: "Let users add, edit, and delete water intake entries from the main tracking screen.",
      deliverables: ["Quick-add cup size buttons", "Manual amount entry", "Edit/delete controls for logged water"],
      acceptanceCriteria: ["A user can log water quickly", "A user can correct or remove an incorrect water entry"]
    },
    {
      id: "phase_3",
      title: "Phase 3 - Daily progress and reminder permission",
      goal: "Show daily hydration progress and handle reminder permission states clearly.",
      deliverables: ["Daily progress indicator", "Daily reset behavior", "Notification permission state for reminders"],
      acceptanceCriteria: ["Progress reflects logged intake against the hydration goal", "Reminder setup explains notification permission"]
    }
  ],
  submissionPrompt: "PRD handoff with water intake app implementation phases"
}

assert.equal(
  validatePrdSpecificity({
    description: waterDescription,
    resolvedDraftInputs,
    draft: waterDraft
  }),
  null,
  "Expected domain-specific water PRD to pass quality gate."
)

const diagnostics = createPlanningDiagnostics({
  aiAvailable: false,
  fallbackUsed: false,
  providerName: "Kimi",
  durationMs: 15004,
  errorReason: "provider_timeout",
  outputQualityStatus: "not_checked"
})

assert.deepEqual(ProjectPlanningDiagnosticsSchema.parse(diagnostics), diagnostics)

const parsedLegacyResponse = AnalyzeProjectPlanningResponseSchema.parse({
  coverageReport: { buckets: [], summary: { present: 0, partial: 0, missing: 0, conflicting: 0 } },
  questions: [],
  aiAvailable: false
})

assert.equal(parsedLegacyResponse.diagnostics.outputQualityStatus, "not_checked")
assert.equal(parsedLegacyResponse.diagnostics.fallbackUsed, false)
assert.equal(parsedLegacyResponse.prdSnapshot.problem.status, "missing")

const parsedLegacyQuestion = ProjectPlanningQuestionSchema.parse({
  id: "legacy_scope",
  criterion: "scope",
  label: "What belongs in the first release?",
  helper: "Clarifies MVP boundaries.",
  mode: "single",
  options: ["Only logging", "Logging and reminders", "Other"]
})

assert.deepEqual(parsedLegacyQuestion.fillsSections, ["scope"])
assert.equal(parsedLegacyQuestion.criterion, "scope")

const parsedFillsSectionsQuestion = ProjectPlanningQuestionSchema.parse({
  id: "water_experience",
  criterion: "user_experience",
  fillsSections: ["core_requirements", "success_criteria", "unknown_section"],
  label: "How should water intake logging feel in the MVP?",
  helper: "This informs required behavior and success criteria.",
  mode: "multi",
  options: ["One-tap logging", "Manual amount entry", "Other"]
})

assert.deepEqual(parsedFillsSectionsQuestion.fillsSections, ["core_requirements", "success_criteria"])
assert.equal(parsedFillsSectionsQuestion.criterion, "core_requirements")

const compactSnapshot = buildPrdSnapshotFromCompactSections([
  ["problem", "partial", "Users forget to track water intake.", "target context"],
  ["user_experience", "partial", "This unknown section should be ignored.", "not part of the contract"],
  ["target_user", "missing", "", "first audience"],
  ["goal_outcome", "partial", "Improve hydration consistency.", "success measure"],
  ["scope", "missing", "", "MVP boundaries"],
  ["core_requirements", "partial", "Water log and reminders.", "units; edit/delete"],
  ["non_goals", "missing", "", "excluded features"],
  ["constraints", "missing", "", "platform constraints"],
  ["success_criteria", "missing", "", "proof the app works"],
  ["assumptions_risks", "missing", "", "notification permission risk"]
])

assert.equal(compactSnapshot.problem.status, "partial")
assert.deepEqual(compactSnapshot.core_requirements.missing, ["units", "edit/delete"])
assert.equal(compactSnapshot.target_user.status, "missing")

const compactQuestions = buildQuestionsFromCompactTuples([
  [
    "water_logging_method",
    ["core_requirements", "scope"],
    "How should users log water intake in the MVP?",
    "This defines the fastest water logging path.",
    "multi",
    ["Quick-add cups", "Manual amount entry", "Edit/delete entries", "Other"]
  ],
  [
    "water_feel",
    ["user_experience"],
    "How should water intake logging feel?",
    "This should fall back to the next unresolved PRD section.",
    "single",
    ["Fast", "Detailed", "Other"]
  ]
], ["target_user", "success_criteria"])

assert.deepEqual(compactQuestions[0].fillsSections, ["core_requirements", "scope"])
assert.equal(compactQuestions[0].criterion, "core_requirements")
assert.deepEqual(compactQuestions[1].fillsSections, ["success_criteria"])
assert.equal(compactQuestions[1].criterion, "success_criteria")

assert.equal(
  validatePrdSnapshotSpecificity({
    description: waterDescription,
    snapshot: compactSnapshot
  }),
  null,
  "Expected domain-specific PRD snapshot to pass quality gate."
)

assert.match(
  validatePrdSnapshotSpecificity({
    description: waterDescription,
    snapshot: buildPrdSnapshotFromCompactSections([
      ["problem", "partial", "The product needs to solve the core user pain.", "target context"]
    ])
  }) ?? "",
  /placeholder/i,
  "Expected placeholder PRD snapshot to fail quality gate."
)

const snapshotCoverage = buildCoverageFromPrdSnapshot({
  problem: {
    status: "partial",
    draft: "Users need a simple way to remember and track water intake.",
    missing: ["Target context"]
  },
  target_user: {
    status: "missing",
    draft: "",
    missing: ["Who should use the water intake app first?"]
  },
  goal_outcome: {
    status: "partial",
    draft: "Help users improve hydration consistency.",
    missing: ["Exact success signal"]
  },
  scope: {
    status: "missing",
    draft: "",
    missing: ["MVP boundaries"]
  },
  core_requirements: {
    status: "partial",
    draft: "Water intake logging and reminders.",
    missing: ["Units", "Edit/delete behavior"]
  },
  non_goals: {
    status: "missing",
    draft: "",
    missing: ["Out-of-scope features"]
  },
  constraints: {
    status: "missing",
    draft: "",
    missing: ["Platform and notification constraints"]
  },
  success_criteria: {
    status: "missing",
    draft: "",
    missing: ["What proves the MVP works?"]
  },
  assumptions_risks: {
    status: "missing",
    draft: "",
    missing: ["Reminder permission risk"]
  }
})

assert.equal(snapshotCoverage.buckets.find((bucket) => bucket.key === "problem")?.status, "partial")
assert.equal(snapshotCoverage.buckets.find((bucket) => bucket.key === "target_user")?.status, "missing")
assert.equal(
  snapshotCoverage.buckets.find((bucket) => bucket.key === "core_requirements")?.resolvedValue,
  "Water intake logging and reminders."
)

const parsedNullableCoverage = AnalyzeProjectPlanningResponseSchema.parse({
  coverageReport: {
    buckets: [
      {
        key: "target_user",
        title: "Target user",
        status: "missing",
        confidence: 0.2,
        evidenceSnippets: [],
        resolvedValue: null
      }
    ],
    summary: { present: 0, partial: 0, missing: 1, conflicting: 0 }
  },
  questions: waterQuestions,
  aiAvailable: true,
  diagnostics
})

assert.equal(
  parsedNullableCoverage.coverageReport.buckets[0].resolvedValue,
  "",
  "Expected nullable LLM coverage values to parse as empty strings for API normalization."
)

console.log("project-planning-ai-smoke: ok")
