import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "esbuild"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const apiRoot = path.resolve(scriptDir, "..")
const repoRoot = path.resolve(apiRoot, "../..")

const defaultCompletionCta = "After you finish, confirm which requirements were completed and suggest the next step."

async function bundleModules(outdir) {
  await build({
    entryPoints: [
      path.resolve(apiRoot, "lib/deep-analysis-v2.ts"),
      path.resolve(apiRoot, "lib/evals/deep-analysis-v2-cases.ts")
    ],
    outdir,
    bundle: true,
    format: "esm",
    platform: "node",
    tsconfig: path.resolve(repoRoot, "tsconfig.base.json")
  })
}

function includesAll(value, expected = []) {
  return expected.filter((item) => !value.includes(item))
}

function excludesAll(value, forbidden = []) {
  return forbidden.filter((item) => value.includes(item))
}

function normalizeInput(testCase) {
  return {
    projectContext: "",
    currentState: "",
    taskType: "creation",
    surface: "unknown",
    ...testCase.input
  }
}

function evaluateCase(testCase, result) {
  const failures = []

  if (result.overallStatus !== testCase.expected.overallStatus) {
    failures.push(`overallStatus: expected ${testCase.expected.overallStatus}, got ${result.overallStatus}`)
  }

  if (testCase.expected.provider && result.providerMetadata.provider !== testCase.expected.provider) {
    failures.push(`provider: expected ${testCase.expected.provider}, got ${result.providerMetadata.provider}`)
  }

  const missingRequirementTexts = result.requirementMatches
    .filter((match) => match.status !== "pass")
    .map((match) => match.requirementText)

  for (const expectedMissing of testCase.expected.missingRequirementIncludes ?? []) {
    if (!missingRequirementTexts.includes(expectedMissing)) {
      failures.push(
        `missingRequirementIncludes: expected ${JSON.stringify(expectedMissing)} in ${JSON.stringify(missingRequirementTexts)}`
      )
    }
  }

  for (const forbiddenMissing of testCase.expected.missingRequirementExcludes ?? []) {
    if (missingRequirementTexts.includes(forbiddenMissing)) {
      failures.push(`missingRequirementExcludes: did not expect ${JSON.stringify(forbiddenMissing)}`)
    }
  }

  for (const missingPromptText of includesAll(result.generatedPrompt, testCase.expected.generatedPromptIncludes)) {
    failures.push(`generatedPromptIncludes: missing ${JSON.stringify(missingPromptText)}`)
  }

  for (const forbiddenPromptText of excludesAll(result.generatedPrompt, testCase.expected.generatedPromptExcludes)) {
    failures.push(`generatedPromptExcludes: found forbidden text ${JSON.stringify(forbiddenPromptText)}`)
  }

  if (
    testCase.expected.generatedPromptEndsWith &&
    !result.generatedPrompt.endsWith(testCase.expected.generatedPromptEndsWith)
  ) {
    failures.push(`generatedPromptEndsWith: expected prompt to end with ${JSON.stringify(testCase.expected.generatedPromptEndsWith)}`)
  }

  if (result.overallStatus === "pass" && !result.generatedPrompt.endsWith(defaultCompletionCta)) {
    failures.push("generatedPrompt: pass prompts must ask the assistant to confirm requirements and suggest the next step")
  }

  const assistantSuggestedNextMove = result.assistantSuggestedNextMove ?? ""
  for (const expectedSuggestion of testCase.expected.assistantSuggestedNextMoveIncludes ?? []) {
    if (!assistantSuggestedNextMove.includes(expectedSuggestion)) {
      failures.push(
        `assistantSuggestedNextMoveIncludes: missing ${JSON.stringify(expectedSuggestion)} in ${JSON.stringify(assistantSuggestedNextMove)}`
      )
    }
  }

  for (const expectedRecommendation of testCase.expected.recommendedNextMoveIncludes ?? []) {
    if (!result.recommendedNextMove.includes(expectedRecommendation)) {
      failures.push(
        `recommendedNextMoveIncludes: missing ${JSON.stringify(expectedRecommendation)} in ${JSON.stringify(result.recommendedNextMove)}`
      )
    }
  }

  if (testCase.expected.nextStepSource && result.nextStepSource !== testCase.expected.nextStepSource) {
    failures.push(`nextStepSource: expected ${testCase.expected.nextStepSource}, got ${result.nextStepSource}`)
  }

  if (testCase.expected.promptIntent && result.promptIntent !== testCase.expected.promptIntent) {
    failures.push(`promptIntent: expected ${testCase.expected.promptIntent}, got ${result.promptIntent}`)
  }

  for (const expectedRequirement of testCase.expected.nextStepRequirementsInclude ?? []) {
    if (!result.nextStepRequirements.some((item) => item.includes(expectedRequirement))) {
      failures.push(
        `nextStepRequirementsInclude: missing ${JSON.stringify(expectedRequirement)} in ${JSON.stringify(result.nextStepRequirements)}`
      )
    }
  }

  for (const expectedBlockedScope of testCase.expected.blockedScopeIncludes ?? []) {
    if (!result.blockedScope.some((item) => item.includes(expectedBlockedScope))) {
      failures.push(`blockedScopeIncludes: missing ${JSON.stringify(expectedBlockedScope)} in ${JSON.stringify(result.blockedScope)}`)
    }
  }

  if (!result.userExplanation.trim()) {
    failures.push("userExplanation: expected a user-facing explanation")
  }

  return failures
}

function percent(pass, total) {
  return `${((pass / Math.max(total, 1)) * 100).toFixed(1)}%`
}

async function main() {
  const outdir = await mkdtemp(path.join(os.tmpdir(), "deep-analysis-v2-eval-"))
  try {
    await bundleModules(outdir)
    const casesMod = await import(pathToFileURL(path.join(outdir, "evals/deep-analysis-v2-cases.js")).href)
    const deepAnalysisMod = await import(pathToFileURL(path.join(outdir, "deep-analysis-v2.js")).href)
    const { getDeepAnalysisV2EvalCases } = casesMod
    const { buildDeepAnalysisV2Fallback } = deepAnalysisMod
    const cases = getDeepAnalysisV2EvalCases()

    const results = cases.map((testCase) => {
      const result = buildDeepAnalysisV2Fallback(normalizeInput(testCase), 10)
      const failures = evaluateCase(testCase, result)
      return {
        id: testCase.id,
        title: testCase.title,
        category: testCase.category,
        passed: failures.length === 0,
        failures
      }
    })

    const passed = results.filter((item) => item.passed).length
    console.log("Deep Analysis v2 Eval")
    console.log(`Cases: ${passed}/${results.length} (${percent(passed, results.length)})`)

    for (const result of results) {
      console.log(`${result.passed ? "PASS" : "FAIL"} ${result.id} [${result.category}]`)
      for (const failure of result.failures) {
        console.log(`  - ${failure}`)
      }
    }

    if (passed !== results.length) {
      process.exitCode = 1
    }
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
