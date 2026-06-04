import { mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "esbuild"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const apiRoot = path.resolve(scriptDir, "..")
const repoRoot = path.resolve(apiRoot, "../..")
const outputPath = path.resolve(
  process.cwd(),
  process.env.DEEP_ANALYSIS_V2_SILVER_OUTPUT_PATH?.trim() || ".tmp/deep-analysis-v2-silver-cases.json"
)

const systemPrompt = [
  "You generate silver eval cases for Deep Analysis v2.",
  "Return JSON only with this shape: { \"cases\": [...] }.",
  "Cases are silver candidates, not launch blockers.",
  "Focus on non-technical users building with ChatGPT, Replit, and Lovable."
].join("\n")

const userPrompt = JSON.stringify(
  {
    task: "Generate prompt-answer eval candidates for requirement matching and next-step recommendation.",
    count: 12,
    surfaces: ["chatgpt", "replit", "lovable"],
    required_case_mix: [
      "good answer passes",
      "missing requested confirmation",
      "assistant suggests backend too early",
      "answer claims completion but lacks proof",
      "scope drift",
      "ambiguous answer needs confirmation"
    ],
    output_case_shape: {
      id: "silver-short-slug",
      title: "short title",
      category: "requirement_match | needs_confirmation | next_prompt | scope_guard | regression",
      input: {
        promptText: "user prompt",
        responseText: "assistant answer",
        projectContext: "compact project memory",
        currentState: "current phase/context",
        taskType: "creation",
        surface: "chatgpt | replit | lovable"
      },
      expected: {
        overallStatus: "pass | needs_confirmation | risky | fail",
        missingRequirementIncludes: ["only if expected missing"],
        generatedPromptIncludes: ["important expected text"],
        generatedPromptExcludes: ["forbidden generic or too-early text"],
        assistantSuggestedNextMoveIncludes: ["only if answer suggests a next move"]
      },
      rubric: {
        must: ["human-readable product rule"],
        rejectIf: ["human-readable reject condition"]
      }
    }
  },
  null,
  2
)

async function bundleKimi(outdir) {
  await build({
    entryPoints: [path.resolve(apiRoot, "lib/kimi.ts")],
    outdir,
    bundle: true,
    format: "esm",
    platform: "node",
    tsconfig: path.resolve(repoRoot, "tsconfig.base.json")
  })
}

function normalizeCases(value) {
  const cases = Array.isArray(value?.cases) ? value.cases : []
  return cases
    .filter((item) => item && typeof item === "object")
    .map((item, index) => ({
      ...item,
      id: String(item.id || `silver-deep-analysis-v2-${index + 1}`),
      silver: true,
      generatedAt: new Date().toISOString(),
      generator: "kimi"
    }))
}

const outdir = path.join(os.tmpdir(), `deep-analysis-v2-silver-${Date.now()}`)

try {
  await mkdir(outdir, { recursive: true })
  await bundleKimi(outdir)
  const { callKimiJson } = await import(pathToFileURL(path.join(outdir, "kimi.js")).href)
  const raw = await callKimiJson(systemPrompt, userPrompt, 5000)

  if (!raw) {
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(
      outputPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          type: "deep-analysis-v2-silver-cases",
          generatedAt: new Date().toISOString(),
          generator: "kimi",
          cases: [],
          note: "No Kimi output was available. Set PROMPT_OPTIMIZER_USE_MOCKS=false and KIMI_API_KEY or MOONSHOT_API_KEY to generate silver cases."
        },
        null,
        2
      )
    )
    console.log(`No Kimi output available. Wrote empty silver case file to ${outputPath}`)
  } else {
    const parsed = JSON.parse(raw)
    const cases = normalizeCases(parsed)
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(
      outputPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          type: "deep-analysis-v2-silver-cases",
          generatedAt: new Date().toISOString(),
          generator: "kimi",
          launchBlocking: false,
          cases
        },
        null,
        2
      )
    )
    console.log(`Generated ${cases.length} silver cases at ${outputPath}`)
  }
} finally {
  await rm(outdir, { recursive: true, force: true })
}
