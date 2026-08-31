import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "esbuild"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(scriptDir, "..")
const fixturePath = path.resolve(extensionRoot, "lib/review/evals/fixtures/next-move-ai-responses.json")
const fixtureSchemaVersion = 1
const evalModes = new Set(["replay", "inline", "record"])
const defaultThresholds = {
  overall: 1,
  interpreter: 1,
  aiDecision: 1,
  hardGate: 1,
  rubric: 1
}

async function bundleModules(outdir) {
  await build({
    entryPoints: [
      path.resolve(extensionRoot, "lib/review/evals/next-move-cases.ts"),
      path.resolve(extensionRoot, "lib/review/evals/next-move-rubric.ts"),
      path.resolve(extensionRoot, "lib/review/analysis-answer-model.ts"),
      path.resolve(extensionRoot, "lib/review/next-move-decision.ts")
    ],
    outdir,
    bundle: true,
    format: "esm",
    platform: "node"
  })
}

function buildDecisionInput(testCase, answerModel) {
  const review = testCase.input.review
  return {
    analysisStatus: review.analysisStatus,
    confidence: review.confidence,
    workflowState: review.workflowState ?? null,
    noRetryRecommended: review.noRetryRecommended,
    decisionText: review.decisionText,
    recommendationText: review.recommendationText,
    promptLabel: review.promptLabel ?? "Next move",
    promptText: review.promptText ?? review.recommendationText,
    phaseProgress: null,
    assistantSuggestedNextStep: answerModel.suggestedNextStep,
    assistantNextStepSignal: answerModel.nextStepSignal
  }
}

function resolveEvalMode() {
  const mode = process.env.NEXT_MOVE_EVAL_MODE || "replay"
  if (evalModes.has(mode)) return mode
  throw new Error(`Unsupported NEXT_MOVE_EVAL_MODE=${mode}. Expected one of: ${Array.from(evalModes).join(", ")}`)
}

async function readFixtureFile() {
  try {
    const raw = await readFile(fixturePath, "utf8")
    return JSON.parse(raw)
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

function buildFixtureFile(cases) {
  const responses = {}

  for (const testCase of cases) {
    if (testCase.aiFixture) {
      responses[testCase.id] = testCase.aiFixture
    }
  }

  return {
    schemaVersion: fixtureSchemaVersion,
    promptVersion: "assistant-next-move-interpreter.v1",
    generatedFrom: "inline-next-move-eval-cases",
    responses
  }
}

async function writeFixtureFile(cases) {
  const fixtureFile = buildFixtureFile(cases)
  const tmpPath = `${fixturePath}.tmp`
  await mkdir(path.dirname(fixturePath), { recursive: true })
  await writeFile(tmpPath, `${JSON.stringify(fixtureFile, null, 2)}\n`)
  await rename(tmpPath, fixturePath)
  return fixtureFile
}

function validateFixtureCoverage(cases, fixtureFile) {
  const failures = []
  const responses = fixtureFile?.responses ?? {}

  if (!fixtureFile) {
    return ["fixture: replay mode requires lib/review/evals/fixtures/next-move-ai-responses.json"]
  }

  if (fixtureFile.schemaVersion !== fixtureSchemaVersion) {
    failures.push(`fixture: expected schemaVersion ${fixtureSchemaVersion}, got ${JSON.stringify(fixtureFile.schemaVersion)}`)
  }

  for (const testCase of cases) {
    if (!responses[testCase.id]) {
      failures.push(`fixture: missing replay response for ${testCase.id}`)
    }
  }

  for (const caseId of Object.keys(responses)) {
    if (!cases.some((testCase) => testCase.id === caseId)) {
      failures.push(`fixture: response exists for unknown case ${caseId}`)
    }
  }

  return failures
}

function resolveAiFixture(input) {
  const replayFixture = input.fixtureFile?.responses?.[input.testCase.id] ?? null
  if (input.mode === "replay") return replayFixture
  if (input.mode === "record") return replayFixture ?? input.testCase.aiFixture ?? null
  return input.testCase.aiFixture ?? null
}

function decisionSnapshot(decision) {
  return {
    status: decision.status,
    recommendationKind: decision.recommendation.kind
  }
}

function selectedSignalSnapshot(model) {
  return {
    source: model.nextStepSignalSource,
    agreement: model.nextStepSignalAgreement,
    kind: model.nextStepSignal?.kind ?? "none",
    nextMoveType: model.nextStepSignal?.nextMoveType ?? "none",
    currentStepClaim: model.nextStepSignal?.currentStepClaim ?? "none",
    confidenceLevel: model.nextStepSignal?.confidenceLevel ?? "none",
    targetLabel: model.nextStepSignal?.targetLabel ?? null,
    targetPhaseNumber: model.nextStepSignal?.targetPhaseNumber ?? null
  }
}

function aiSignalSnapshot(model) {
  const signal = model.nextStepSignalAi
  if (!signal) return null
  return {
    kind: signal.kind,
    nextMoveType: signal.nextMoveType,
    currentStepClaim: signal.currentStepClaim,
    confidenceLevel: signal.confidenceLevel,
    targetLabel: signal.targetLabel,
    targetPhaseNumber: signal.targetPhaseNumber,
    requiresApproval: signal.requiresApproval,
    suggestsImplementation: signal.suggestsImplementation,
    suggestsClarification: signal.suggestsClarification,
    suggestsValidation: signal.suggestsValidation,
    suggestsCompletion: signal.suggestsCompletion
  }
}

function localSignalSnapshot(model) {
  const signal = model.nextStepSignalLocal
  if (!signal) return null
  return {
    kind: signal.kind,
    nextMoveType: signal.nextMoveType,
    currentStepClaim: signal.currentStepClaim,
    confidenceLevel: signal.confidenceLevel,
    targetLabel: signal.targetLabel,
    targetPhaseNumber: signal.targetPhaseNumber
  }
}

function valuesEqual(actual, expected) {
  return actual === expected
}

function checkExpectedFields(label, actual, expected) {
  const failures = []
  if (!expected) return failures

  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = actual?.[key]
    if (!valuesEqual(actualValue, expectedValue)) {
      failures.push(`${label}.${key}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`)
    }
  }

  return failures
}

function checkDecision(label, actual, expected) {
  return checkExpectedFields(label, decisionSnapshot(actual), expected)
}

function countBy(results, predicate) {
  return results.filter(predicate).length
}

function ratio(pass, total) {
  if (total === 0) return 0
  return pass / total
}

function percent(pass, total) {
  return `${(ratio(pass, total) * 100).toFixed(1)}%`
}

function parseThreshold(name, fallback) {
  const raw = process.env[name]
  if (raw == null || raw.trim() === "") return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a number from 0 to 1. Received: ${JSON.stringify(raw)}`)
  }
  return value
}

function resolveThresholds() {
  return {
    overall: parseThreshold("NEXT_MOVE_EVAL_MIN_OVERALL", defaultThresholds.overall),
    interpreter: parseThreshold("NEXT_MOVE_EVAL_MIN_INTERPRETER", defaultThresholds.interpreter),
    aiDecision: parseThreshold("NEXT_MOVE_EVAL_MIN_AI_DECISION", defaultThresholds.aiDecision),
    hardGate: parseThreshold("NEXT_MOVE_EVAL_MIN_HARD_GATE", defaultThresholds.hardGate),
    rubric: parseThreshold("NEXT_MOVE_EVAL_MIN_RUBRIC", defaultThresholds.rubric)
  }
}

function parseBooleanFlag(name) {
  const raw = process.env[name]
  if (raw == null || raw.trim() === "") return false
  return /^(1|true|yes)$/i.test(raw.trim())
}

function resolveCleanupGate() {
  return {
    requireCleanupReady: parseBooleanFlag("NEXT_MOVE_EVAL_REQUIRE_CLEANUP_READY"),
    requireNoFallbackOnlySaves: parseBooleanFlag("NEXT_MOVE_EVAL_REQUIRE_NO_FALLBACK_ONLY_SAVES")
  }
}

function buildEvalMetrics(results) {
  const total = results.length
  const passed = countBy(results, (item) => item.passed)
  const hardGatePassed = countBy(results, (item) => item.hardGateFailures.length === 0)
  const aiDecisionPassed = countBy(results, (item) => item.aiDecisionFailures.length === 0)
  const fallbackDecisionPassed = countBy(results, (item) => item.fallbackDecisionFailures.length === 0)
  const interpreterPassed = countBy(results, (item) => item.interpreterFailures.length === 0)
  const rubricPassed = countBy(results, (item) => item.rubricFailures.length === 0)
  const aiSelected = countBy(results, (item) => item.selected.source === "ai")
  const fallbackSelected = countBy(results, (item) => item.selected.source === "local_heuristic")
  const agreement = countBy(results, (item) => item.selected.agreement === "agree")
  const disagreement = countBy(results, (item) => item.selected.agreement === "disagree")

  return {
    total,
    passed,
    hardGatePassed,
    aiDecisionPassed,
    fallbackDecisionPassed,
    interpreterPassed,
    rubricPassed,
    aiSelected,
    fallbackSelected,
    agreement,
    disagreement,
    rates: {
      overall: ratio(passed, total),
      interpreter: ratio(interpreterPassed, total),
      aiDecision: ratio(aiDecisionPassed, total),
      hardGate: ratio(hardGatePassed, total),
      rubric: ratio(rubricPassed, total)
    }
  }
}

function formatThreshold(value) {
  return `${(value * 100).toFixed(1)}%`
}

function evaluateThresholds(metrics, thresholds) {
  const checks = [
    ["overall", "Overall"],
    ["interpreter", "Interpreter"],
    ["aiDecision", "AI-selected decision"],
    ["hardGate", "Hard gate"],
    ["rubric", "Rubric"]
  ]
  const failures = []

  for (const [key, label] of checks) {
    const actual = metrics.rates[key]
    const expected = thresholds[key]
    if (actual < expected) {
      failures.push(
        `${label} threshold failed: expected >= ${formatThreshold(expected)}, got ${formatThreshold(actual)}`
      )
    }
  }

  return failures
}

function formatCaseResult(result) {
  const status = result.passed ? "PASS" : "FAIL"
  return `${status} ${result.id} [${result.category}] selected=${result.selected.source}/${result.selected.kind} final=${result.aiDecision.status}/${result.aiDecision.recommendationKind}`
}

function decisionMatchesExpected(decision, expected) {
  return decision.status === expected.status && decision.recommendationKind === expected.recommendationKind
}

function formatDecision(decision) {
  return `${decision.status}/${decision.recommendationKind}`
}

function formatSignal(signal) {
  if (!signal) return "none"
  return `${signal.kind ?? "none"}/${signal.currentStepClaim ?? "none"}/${signal.nextMoveType ?? "none"}`
}

function buildCleanupReport(results) {
  const aiOnlyWins = results.filter((item) => item.aiDecisionPass && !item.fallbackDecisionPass)
  const fallbackOnlySaves = results.filter((item) => !item.aiDecisionPass && item.fallbackDecisionPass)
  const bothFail = results.filter((item) => !item.aiDecisionPass && !item.fallbackDecisionPass)
  const signalDisagreements = results.filter((item) => item.selected.agreement === "disagree")
  const lowConfidenceFallbacks = results.filter(
    (item) => item.aiSignal?.confidenceLevel === "low" && item.selected.source === "local_heuristic"
  )

  return {
    aiOnlyWins,
    fallbackOnlySaves,
    bothFail,
    signalDisagreements,
    lowConfidenceFallbacks
  }
}

function summarizeCleanupItem(item) {
  return {
    id: item.id,
    title: item.title,
    category: item.category,
    expectedDecision: item.expectedDecision,
    aiDecision: item.aiDecision,
    fallbackDecision: item.fallbackDecision,
    selected: item.selected,
    aiSignal: item.aiSignal,
    localSignal: item.localSignal
  }
}

function buildSerializableCleanupReport(results) {
  const report = buildCleanupReport(results)
  return {
    aiOnlyWins: report.aiOnlyWins.map(summarizeCleanupItem),
    fallbackOnlySaves: report.fallbackOnlySaves.map(summarizeCleanupItem),
    bothFail: report.bothFail.map(summarizeCleanupItem),
    signalDisagreements: report.signalDisagreements.map(summarizeCleanupItem),
    lowConfidenceFallbacks: report.lowConfidenceFallbacks.map(summarizeCleanupItem)
  }
}

function caseIds(items) {
  return items.map((item) => item.id)
}

function buildCleanupRecommendation(input) {
  return {
    id: input.id,
    status: input.status,
    recommendedAction: input.recommendedAction,
    rationale: input.rationale,
    evidenceCaseIds: caseIds(input.evidence)
  }
}

function buildFallbackCleanupPlan(results) {
  const report = buildCleanupReport(results)
  const clarificationWins = report.aiOnlyWins.filter(
    (item) => item.selected.kind === "clarify_decision" || item.expectedDecision.recommendationKind === "clarify_product_decision"
  )
  const optionalOrPartialWins = report.aiOnlyWins.filter(
    (item) =>
      item.selected.kind === "offer_optional_enhancement" ||
      item.expectedDecision.recommendationKind === "review_before_advancing"
  )
  const canStartNarrowCleanup = report.fallbackOnlySaves.length === 0 && report.bothFail.length === 0
  const canRemoveAllFallback = false
  const blockers = [
    ...report.fallbackOnlySaves.map((item) => `fallback-only-save:${item.id}`),
    ...report.bothFail.map((item) => `both-fail:${item.id}`)
  ]

  return {
    status: canStartNarrowCleanup ? "ready_for_narrow_cleanup" : "cleanup_blocked",
    canStartNarrowCleanup,
    canRemoveAllFallback,
    summary: {
      aiOnlyWins: report.aiOnlyWins.length,
      fallbackOnlySaves: report.fallbackOnlySaves.length,
      bothFail: report.bothFail.length,
      signalDisagreements: report.signalDisagreements.length,
      lowConfidenceFallbacks: report.lowConfidenceFallbacks.length
    },
    blockers,
    protectedFallbackEvidence: caseIds(report.lowConfidenceFallbacks),
    recommendations: [
      buildCleanupRecommendation({
        id: "keep-low-confidence-fallback",
        status: report.lowConfidenceFallbacks.length ? "protected" : "watch",
        recommendedAction:
          "Keep the local fallback path for low-confidence AI interpretations. It is still an active safety valve.",
        rationale:
          "Fallback is selected when the AI interpretation is too weak, so removing this path would reduce resilience.",
        evidence: report.lowConfidenceFallbacks
      }),
      buildCleanupRecommendation({
        id: "do-not-preserve-local-clarification-behavior",
        status: clarificationWins.length ? "cleanup_candidate" : "no_current_evidence",
        recommendedAction:
          "Treat local continuation classifications on assistant clarification questions as removable or lower priority behavior.",
        rationale:
          "The AI path correctly blocks for user decisions where the local heuristic would keep implementation moving.",
        evidence: clarificationWins
      }),
      buildCleanupRecommendation({
        id: "do-not-preserve-local-partial-work-behavior",
        status: optionalOrPartialWins.length ? "cleanup_candidate" : "no_current_evidence",
        recommendedAction:
          "Prefer AI partial-work and optional-enhancement interpretation over broad local continuation behavior.",
        rationale:
          "The AI path better distinguishes unfinished core work from future polish or optional add-ons.",
        evidence: optionalOrPartialWins
      }),
      buildCleanupRecommendation({
        id: "keep-ai-unavailable-fallback",
        status: "protected",
        recommendedAction:
          "Keep the local fallback for interpreter outages until live telemetry shows AI availability is consistently safe.",
        rationale:
          "The replay eval proves AI quality, but it does not prove the production interpreter is always reachable.",
        evidence: []
      })
    ],
    nextActions: [
      "Review cleanup_candidate recommendations before changing fallback code.",
      "Remove or weaken one narrow local branch at a time.",
      "Keep the low-confidence and AI-unavailable fallback paths.",
      "Run the cleanup gate after each cleanup patch.",
      "Add real-world Replit and Lovable misses before broader fallback removal."
    ]
  }
}

function evaluateCleanupGate(cleanupPlan, cleanupGate) {
  const failures = []

  if (cleanupGate.requireNoFallbackOnlySaves && cleanupPlan.summary.fallbackOnlySaves > 0) {
    failures.push(
      `Cleanup gate failed: expected zero fallback-only saves, got ${cleanupPlan.summary.fallbackOnlySaves}.`
    )
  }

  if (cleanupGate.requireCleanupReady && !cleanupPlan.canStartNarrowCleanup) {
    failures.push(
      `Cleanup gate failed: fallback cleanup is not ready. Blockers: ${cleanupPlan.blockers.join(", ") || "none"}`
    )
  }

  return failures
}

function buildReportPayload(input) {
  const { results, fixtureSummary, metrics, thresholds, thresholdFailures, cleanupGate, cleanupGateFailures, cleanupPlan } =
    input
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    fixture: fixtureSummary,
    thresholds,
    thresholdFailures,
    cleanupGate,
    cleanupGateFailures,
    metrics,
    cleanup: buildSerializableCleanupReport(results),
    cleanupPlan,
    cases: results.map((result) => ({
      id: result.id,
      title: result.title,
      category: result.category,
      passed: result.passed,
      failures: result.failures,
      interpreterFailures: result.interpreterFailures,
      selectedSourceFailures: result.selectedSourceFailures,
      agreementFailures: result.agreementFailures,
      aiDecisionFailures: result.aiDecisionFailures,
      fallbackDecisionFailures: result.fallbackDecisionFailures,
      hardGateFailures: result.hardGateFailures,
      rubricFailures: result.rubricFailures,
      rubricPassedRules: result.rubricPassedRules,
      fixtureSource: result.fixtureSource,
      expectedDecision: result.expectedDecision,
      aiDecisionPass: result.aiDecisionPass,
      fallbackDecisionPass: result.fallbackDecisionPass,
      selected: result.selected,
      aiSignal: result.aiSignal,
      localSignal: result.localSignal,
      aiDecision: result.aiDecision,
      fallbackDecision: result.fallbackDecision
    }))
  }
}

function resolveReportPath() {
  const raw = process.env.NEXT_MOVE_EVAL_REPORT_PATH
  if (!raw?.trim()) return null
  return path.resolve(process.cwd(), raw.trim())
}

async function writeReportFile(input) {
  const reportPath = resolveReportPath()
  if (!reportPath) return null

  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(buildReportPayload(input), null, 2)}\n`)
  return reportPath
}

function printCaseList(title, items, formatter) {
  console.log(`${title}: ${items.length}`)
  for (const item of items) {
    console.log(`  - ${formatter(item)}`)
  }
}

function printCleanupReport(results) {
  const report = buildCleanupReport(results)

  console.log("")
  console.log("Fallback Cleanup Report")
  printCaseList("AI passed, fallback missed", report.aiOnlyWins, (item) =>
    `${item.id}: expected=${formatDecision(item.expectedDecision)}, ai=${formatDecision(item.aiDecision)}, fallback=${formatDecision(item.fallbackDecision)}`
  )
  printCaseList("Fallback passed, AI missed", report.fallbackOnlySaves, (item) =>
    `${item.id}: expected=${formatDecision(item.expectedDecision)}, ai=${formatDecision(item.aiDecision)}, fallback=${formatDecision(item.fallbackDecision)}`
  )
  printCaseList("Both missed expected decision", report.bothFail, (item) =>
    `${item.id}: expected=${formatDecision(item.expectedDecision)}, ai=${formatDecision(item.aiDecision)}, fallback=${formatDecision(item.fallbackDecision)}`
  )
  printCaseList("AI/local signal disagreements", report.signalDisagreements, (item) =>
    `${item.id}: selected=${item.selected.source}/${item.selected.kind}, ai=${formatSignal(item.aiSignal)}, local=${formatSignal(item.localSignal)}`
  )
  printCaseList("Low-confidence AI fallback uses", report.lowConfidenceFallbacks, (item) =>
    `${item.id}: ai=${formatSignal(item.aiSignal)}, selected=${item.selected.source}/${item.selected.kind}`
  )
}

function printCleanupPlan(cleanupPlan, cleanupGate, cleanupGateFailures) {
  console.log("")
  console.log("Fallback Cleanup Plan")
  console.log(`Status: ${cleanupPlan.status}`)
  console.log(`Can start narrow cleanup: ${cleanupPlan.canStartNarrowCleanup ? "yes" : "no"}`)
  console.log(`Can remove all fallback: ${cleanupPlan.canRemoveAllFallback ? "yes" : "no"}`)
  console.log(
    `Cleanup gate: requireCleanupReady=${cleanupGate.requireCleanupReady}, requireNoFallbackOnlySaves=${cleanupGate.requireNoFallbackOnlySaves}`
  )
  for (const failure of cleanupGateFailures) {
    console.log(`Cleanup gate failure: ${failure}`)
  }
  for (const recommendation of cleanupPlan.recommendations) {
    console.log(
      `  - ${recommendation.id} [${recommendation.status}]: ${recommendation.recommendedAction} Evidence: ${
        recommendation.evidenceCaseIds.length ? recommendation.evidenceCaseIds.join(", ") : "none"
      }`
    )
  }
}

function printSummary(results, fixtureSummary, metrics, thresholds, thresholdFailures, cleanupGate, cleanupGateFailures, cleanupPlan) {
  console.log("Next Move Eval")
  console.log(`Cases: ${metrics.total}`)
  console.log(`Mode: ${fixtureSummary.mode}`)
  console.log(fixtureSummary.label)
  console.log("")
  console.log(`Overall: ${metrics.passed}/${metrics.total} (${percent(metrics.passed, metrics.total)})`)
  console.log(`Interpreter: ${metrics.interpreterPassed}/${metrics.total} (${percent(metrics.interpreterPassed, metrics.total)})`)
  console.log(`AI-selected decision: ${metrics.aiDecisionPassed}/${metrics.total} (${percent(metrics.aiDecisionPassed, metrics.total)})`)
  console.log(`Fallback decision: ${metrics.fallbackDecisionPassed}/${metrics.total} (${percent(metrics.fallbackDecisionPassed, metrics.total)})`)
  console.log(`Hard gate: ${metrics.hardGatePassed}/${metrics.total} (${percent(metrics.hardGatePassed, metrics.total)})`)
  console.log(`Rubric: ${metrics.rubricPassed}/${metrics.total} (${percent(metrics.rubricPassed, metrics.total)})`)
  console.log("")
  console.log(
    `Thresholds: overall>=${formatThreshold(thresholds.overall)}, interpreter>=${formatThreshold(thresholds.interpreter)}, aiDecision>=${formatThreshold(thresholds.aiDecision)}, hardGate>=${formatThreshold(thresholds.hardGate)}, rubric>=${formatThreshold(thresholds.rubric)}`
  )
  if (thresholdFailures.length) {
    for (const failure of thresholdFailures) {
      console.log(`Threshold failure: ${failure}`)
    }
  }
  console.log("")
  console.log(`Selected source: ai=${metrics.aiSelected}, local_heuristic=${metrics.fallbackSelected}`)
  console.log(`AI/local agreement: agree=${metrics.agreement}, disagree=${metrics.disagreement}`)
  console.log("")

  for (const result of results) {
    console.log(formatCaseResult(result))
    if (!result.passed) {
      for (const failure of result.failures) {
        console.log(`  - ${failure}`)
      }
    }
  }

  printCleanupReport(results)
  printCleanupPlan(cleanupPlan, cleanupGate, cleanupGateFailures)
}

async function main() {
  const outdir = await mkdtemp(path.join(os.tmpdir(), "next-move-eval-"))
  try {
    await bundleModules(outdir)

    const casesMod = await import(pathToFileURL(path.join(outdir, "evals/next-move-cases.js")).href)
    const rubricMod = await import(pathToFileURL(path.join(outdir, "evals/next-move-rubric.js")).href)
    const answerModelMod = await import(pathToFileURL(path.join(outdir, "analysis-answer-model.js")).href)
    const decisionMod = await import(pathToFileURL(path.join(outdir, "next-move-decision.js")).href)

    const { getNextMoveEvalCases } = casesMod
    const { evaluateNextMoveRubric } = rubricMod
    const { buildAnalysisAnswerModel, buildAnalysisAnswerModelWithInterpreter } = answerModelMod
    const { buildNextMoveDecision } = decisionMod

    const cases = getNextMoveEvalCases()
    const mode = resolveEvalMode()
    const thresholds = resolveThresholds()
    const fixtureFile = mode === "record" ? await writeFixtureFile(cases) : mode === "replay" ? await readFixtureFile() : null
    const fixtureCoverageFailures = mode === "inline" ? [] : validateFixtureCoverage(cases, fixtureFile)
    if (fixtureCoverageFailures.length) {
      for (const failure of fixtureCoverageFailures) {
        console.error(failure)
      }
      process.exitCode = 1
      return
    }
    const fixtureSummary = {
      mode,
      loaded: cases.filter((testCase) => Boolean(fixtureFile?.responses?.[testCase.id])).length,
      relativePath: path.relative(extensionRoot, fixturePath),
      label:
        mode === "inline"
          ? "Fixtures: using inline aiFixture values from next-move-cases.ts"
          : `Fixtures: ${cases.filter((testCase) => Boolean(fixtureFile?.responses?.[testCase.id])).length}/${cases.length} loaded from ${path.relative(extensionRoot, fixturePath)}`
    }
    const results = []

    for (const testCase of cases) {
      const aiFixture = resolveAiFixture({
        mode,
        fixtureFile,
        testCase
      })
      const fallbackModel = buildAnalysisAnswerModel({
        promptText: testCase.input.promptText,
        responseText: testCase.input.responseText,
        taskFamily: testCase.input.taskFamily
      })
      const aiModel = await buildAnalysisAnswerModelWithInterpreter({
        promptText: testCase.input.promptText,
        responseText: testCase.input.responseText,
        taskFamily: testCase.input.taskFamily,
        interpretPrompt: async () => (aiFixture ? JSON.stringify(aiFixture) : null)
      })

      const fallbackDecision = buildNextMoveDecision(buildDecisionInput(testCase, fallbackModel))
      const aiDecision = buildNextMoveDecision(buildDecisionInput(testCase, aiModel))
      const selected = selectedSignalSnapshot(aiModel)
      const aiSignal = aiSignalSnapshot(aiModel)
      const localSignal = localSignalSnapshot(fallbackModel)

      const interpreterFailures = checkExpectedFields("interpreter", aiSignal, testCase.expected.interpreter)
      const selectedSourceFailures =
        testCase.expected.selectedSignalSource == null
          ? []
          : checkExpectedFields("selectedSignal", selected, { source: testCase.expected.selectedSignalSource })
      const agreementFailures =
        testCase.expected.signalAgreement == null
          ? []
          : checkExpectedFields("selectedSignal", selected, { agreement: testCase.expected.signalAgreement })
      const aiDecisionFailures = checkDecision("decision", aiDecision, testCase.expected.decision)
      const fallbackDecisionFailures = checkDecision("fallbackDecision", fallbackDecision, testCase.expected.decision)
      const aiDecisionPass = decisionMatchesExpected(decisionSnapshot(aiDecision), testCase.expected.decision)
      const fallbackDecisionPass = decisionMatchesExpected(decisionSnapshot(fallbackDecision), testCase.expected.decision)
      const rubricResult = evaluateNextMoveRubric({
        testCase,
        aiSignal,
        selected,
        aiDecision: decisionSnapshot(aiDecision),
        fallbackDecision: decisionSnapshot(fallbackDecision)
      })
      const hardGateFailures = rubricResult.failures
        .filter((failure) => failure.rule === "rubric.requirement_gate_blocks_advancement")
        .map((failure) => `${failure.rule}: ${failure.message}`)
      const rubricFailures = rubricResult.failures.map((failure) => `${failure.rule}: ${failure.message}`)
      const failures = [
        ...interpreterFailures,
        ...selectedSourceFailures,
        ...agreementFailures,
        ...aiDecisionFailures,
        ...rubricFailures
      ]

      results.push({
        id: testCase.id,
        title: testCase.title,
        category: testCase.category,
        passed: failures.length === 0,
        failures,
        interpreterFailures,
        selectedSourceFailures,
        agreementFailures,
        aiDecisionFailures,
        fallbackDecisionFailures,
        hardGateFailures,
        rubricFailures,
        rubricPassedRules: rubricResult.passedRules,
        fixtureSource: aiFixture ? mode : "none",
        expectedDecision: testCase.expected.decision,
        aiDecisionPass,
        fallbackDecisionPass,
        aiSignal,
        localSignal,
        selected,
        aiDecision: decisionSnapshot(aiDecision),
        fallbackDecision: decisionSnapshot(fallbackDecision)
      })
    }

    const metrics = buildEvalMetrics(results)
    const thresholdFailures = evaluateThresholds(metrics, thresholds)
    const cleanupGate = resolveCleanupGate()
    const cleanupPlan = buildFallbackCleanupPlan(results)
    const cleanupGateFailures = evaluateCleanupGate(cleanupPlan, cleanupGate)
    const reportPath = await writeReportFile({
      results,
      fixtureSummary,
      metrics,
      thresholds,
      thresholdFailures,
      cleanupGate,
      cleanupGateFailures,
      cleanupPlan
    })

    printSummary(results, fixtureSummary, metrics, thresholds, thresholdFailures, cleanupGate, cleanupGateFailures, cleanupPlan)
    if (reportPath) {
      console.log("")
      console.log(`JSON report written to ${reportPath}`)
    }

    if (results.some((item) => !item.passed) || thresholdFailures.length || cleanupGateFailures.length) {
      process.exitCode = 1
    }
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}

await main()
