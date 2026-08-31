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
      path.resolve(extensionRoot, "lib/review/evals/simple-next-prompt-cases.ts"),
      path.resolve(extensionRoot, "lib/review/simple-next-prompt-decision-builder.ts")
    ],
    outdir,
    bundle: true,
    format: "esm",
    platform: "node"
  })
}

function includesAll(value, expected = []) {
  return expected.filter((item) => !value.includes(item))
}

function excludesAll(value, forbidden = []) {
  return forbidden.filter((item) => value.includes(item))
}

function evaluateCase(testCase, decision) {
  const failures = []

  if (!decision) {
    return ["decision: expected a simple next-prompt decision, got null"]
  }

  if (decision.status !== testCase.expected.status) {
    failures.push(`status: expected ${testCase.expected.status}, got ${decision.status}`)
  }

  if (decision.requirementCheck.status !== testCase.expected.requirementStatus) {
    failures.push(
      `requirementStatus: expected ${testCase.expected.requirementStatus}, got ${decision.requirementCheck.status}`
    )
  }

  const missingTexts = decision.requirementCheck.missingConfirmation.map((item) => item.text)
  for (const expectedMissing of testCase.expected.missingIncludes ?? []) {
    if (!missingTexts.includes(expectedMissing)) {
      failures.push(`missingIncludes: expected ${JSON.stringify(expectedMissing)} in ${JSON.stringify(missingTexts)}`)
    }
  }
  for (const forbiddenMissing of testCase.expected.missingExcludes ?? []) {
    if (missingTexts.includes(forbiddenMissing)) {
      failures.push(`missingExcludes: did not expect ${JSON.stringify(forbiddenMissing)}`)
    }
  }

  const missingPromptIncludes = includesAll(decision.optimizedPrompt, testCase.expected.promptIncludes)
  for (const item of missingPromptIncludes) {
    failures.push(`promptIncludes: missing ${JSON.stringify(item)}`)
  }

  const presentPromptExcludes = excludesAll(decision.optimizedPrompt, testCase.expected.promptExcludes)
  for (const item of presentPromptExcludes) {
    failures.push(`promptExcludes: found forbidden text ${JSON.stringify(item)}`)
  }

  if (testCase.expected.promptEndsWith && !decision.optimizedPrompt.endsWith(testCase.expected.promptEndsWith)) {
    failures.push(`promptEndsWith: expected prompt to end with ${JSON.stringify(testCase.expected.promptEndsWith)}`)
  }

  const suggestedText = [
    decision.assistantSuggestedNextMove?.rawText ?? "",
    decision.assistantSuggestedNextMove?.normalizedText ?? ""
  ].join("\n")
  const missingSuggestionIncludes = includesAll(suggestedText, testCase.expected.suggestedNextMoveIncludes)
  for (const item of missingSuggestionIncludes) {
    failures.push(`suggestedNextMoveIncludes: missing ${JSON.stringify(item)}`)
  }

  if (!decision.promptPolicy.askAssistantToSuggestNextStep) {
    failures.push("promptPolicy: askAssistantToSuggestNextStep must be true")
  }
  if (!decision.promptPolicy.hideInternalReasoning) {
    failures.push("promptPolicy: hideInternalReasoning must be true")
  }

  return failures
}

function percent(pass, total) {
  return `${((pass / Math.max(total, 1)) * 100).toFixed(1)}%`
}

async function main() {
  const outdir = await mkdtemp(path.join(os.tmpdir(), "simple-next-prompt-eval-"))
  try {
    await bundleModules(outdir)
    const casesMod = await import(pathToFileURL(path.join(outdir, "evals/simple-next-prompt-cases.js")).href)
    const builderMod = await import(pathToFileURL(path.join(outdir, "simple-next-prompt-decision-builder.js")).href)
    const { getSimpleNextPromptEvalCases } = casesMod
    const { buildSimpleNextPromptDecision } = builderMod
    const cases = getSimpleNextPromptEvalCases()

    const results = cases.map((testCase) => {
      const decision = buildSimpleNextPromptDecision(testCase.input)
      const failures = evaluateCase(testCase, decision)
      return {
        id: testCase.id,
        title: testCase.title,
        category: testCase.category,
        passed: failures.length === 0,
        failures
      }
    })

    const passed = results.filter((item) => item.passed).length
    console.log("Simple Next Prompt Eval")
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
