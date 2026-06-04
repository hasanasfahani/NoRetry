import { existsSync, readFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "esbuild"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const apiRoot = path.resolve(scriptDir, "..")
const repoRoot = path.resolve(apiRoot, "../..")

function loadLocalEnvFile(filePath) {
  if (!existsSync(filePath)) return
  const file = readFileSync(filePath, "utf8")
  for (const line of file.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const separatorIndex = trimmed.indexOf("=")
    if (separatorIndex === -1) continue
    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()
    if (!(key in process.env)) process.env[key] = value
  }
}

function estimateTokens(...parts) {
  return Math.max(1, Math.ceil(parts.join("").length / 4))
}

async function main() {
  loadLocalEnvFile(path.resolve(repoRoot, ".env.local"))
  loadLocalEnvFile(path.resolve(apiRoot, ".env.local"))

  const outdir = await mkdtemp(path.join(os.tmpdir(), "deep-analysis-v2-full-race-"))
  try {
    await build({
      entryPoints: [path.resolve(apiRoot, "lib/deep-analysis-v2.ts")],
      outdir,
      bundle: true,
      format: "esm",
      platform: "node",
      tsconfig: path.resolve(repoRoot, "tsconfig.base.json")
    })

    const mod = await import(pathToFileURL(path.join(outdir, "deep-analysis-v2.js")).href)
    const input = {
      promptText:
        "Act like Replit’s coding agent. Phase 1 is booking form UI only. Do not add backend or storage yet. Reply briefly with what changed, confirm completion, and suggest the next phase.",
      responseText:
        "Completed Phase 1: Booking Form UI. Changes made: Created responsive booking form layout. Added input fields for name, date, time, service/details. Added validation states and submit button UI. Styled form for desktop/mobile usability. Added loading/empty/error UI placeholders only, with no backend logic. Phase 1 is done. Next phase: connect form functionality, add validation logic, and show a booking confirmation flow before backend or storage.",
      projectContext: "Building a simple booking app in phases for a non-technical founder.",
      currentState: "Phase 1 UI-only work was requested.",
      taskType: "creation",
      surface: "chatgpt"
    }

    const startedAt = Date.now()
    const result = await mod.runDeepAnalysisV2(input)
    const totalLatencyMs = Date.now() - startedAt
    const metadata = result.providerMetadata
    const output = {
      ok: result.overallStatus !== "unavailable",
      verdict: result.overallStatus,
      winningProvider: metadata.provider,
      model: metadata.model ?? null,
      firstValidJsonLatencyMs: metadata.provider === "none" ? null : metadata.latencyMs ?? totalLatencyMs,
      totalLatencyMs,
      deepSeekFullAnalysisLatencyMs:
        metadata.provider === "deepseek" ? metadata.latencyMs ?? null : metadata.deepSeekLatencyMs ?? null,
      kimiFullAnalysisLatencyMs:
        metadata.provider === "kimi" ? metadata.latencyMs ?? null : metadata.kimiLatencyMs ?? null,
      timeoutRate: metadata.timedOut ? 1 : 0,
      jsonParseSuccessRate: metadata.provider === "none" ? 0 : 1,
      promptTokenEstimate: estimateTokens(input.promptText, input.responseText, input.projectContext, input.currentState),
      outputTokenEstimate: estimateTokens(result.generatedPrompt, result.userExplanation),
      promptIntent: result.promptIntent,
      nextStepSource: result.nextStepSource,
      generatedPromptPreview: result.generatedPrompt.slice(0, 260)
    }

    console.log(JSON.stringify(output, null, 2))
    if (totalLatencyMs > 30000) process.exitCode = 1
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
