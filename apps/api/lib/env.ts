import * as z from "zod"
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

function loadLocalEnvFile() {
  const currentDir = dirname(fileURLToPath(import.meta.url))
  const candidatePaths = [
    resolve(currentDir, "../.env.local"),
    resolve(currentDir, "../../../.env.local")
  ]

  for (const filePath of candidatePaths) {
    if (!existsSync(filePath)) continue

    const file = readFileSync(filePath, "utf8")
    for (const line of file.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const separatorIndex = trimmed.indexOf("=")
      if (separatorIndex === -1) continue
      const key = trimmed.slice(0, separatorIndex).trim()
      const value = trimmed.slice(separatorIndex + 1).trim()
      if (!(key in process.env)) {
        process.env[key] = value
      }
    }
  }
}

loadLocalEnvFile()

const EnvSchema = z.object({
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),
  KIMI_API_KEY: z.string().optional(),
  KIMI_MODEL: z.string().default("kimi-k2-turbo-preview"),
  DATABASE_URL: z.string().optional(),
  PROMPT_OPTIMIZER_USE_MOCKS: z.string().default("true"),
  PROMPT_OPTIMIZER_ENABLE_DB: z.string().default("false")
})

export const env = EnvSchema.parse({
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
  KIMI_API_KEY: process.env.KIMI_API_KEY,
  KIMI_MODEL: process.env.KIMI_MODEL,
  DATABASE_URL: process.env.DATABASE_URL,
  PROMPT_OPTIMIZER_USE_MOCKS: process.env.PROMPT_OPTIMIZER_USE_MOCKS,
  PROMPT_OPTIMIZER_ENABLE_DB: process.env.PROMPT_OPTIMIZER_ENABLE_DB
})

export const runtimeFlags = {
  useMocks: env.PROMPT_OPTIMIZER_USE_MOCKS === "true" || (!env.DEEPSEEK_API_KEY && !env.KIMI_API_KEY),
  enableDb: env.PROMPT_OPTIMIZER_ENABLE_DB === "true" && Boolean(env.DATABASE_URL)
}
