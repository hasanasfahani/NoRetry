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

async function main() {
  loadLocalEnvFile(path.resolve(repoRoot, ".env.local"))
  loadLocalEnvFile(path.resolve(apiRoot, ".env.local"))

  const outdir = await mkdtemp(path.join(os.tmpdir(), "deep-analysis-v2-health-"))
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
    const result = await mod.checkDeepAnalysisV2ProviderHealth()
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exitCode = 1
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
