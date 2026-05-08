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
  KIMI_MODEL: z.string().default("kimi-k2.6"),
  DEEP_ANALYSIS_V2_HARD_TIMEOUT_MS: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  PROMPT_OPTIMIZER_USE_MOCKS: z.string().default("true"),
  PROMPT_OPTIMIZER_ENABLE_DB: z.string().default("false"),
  PROMPT_OPTIMIZER_ENABLE_BILLING: z.string().default("false"),
  PROMPT_OPTIMIZER_ENABLE_TEAMS: z.string().default("false"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_PRO_MONTHLY: z.string().optional(),
  STRIPE_PRICE_PRO_YEARLY: z.string().optional(),
  STRIPE_PRICE_TEAM_MONTHLY: z.string().optional(),
  STRIPE_PRICE_TEAM_YEARLY: z.string().optional()
})

export const env = EnvSchema.parse({
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
  KIMI_API_KEY: process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY,
  KIMI_MODEL: process.env.KIMI_MODEL || process.env.MOONSHOT_MODEL,
  DEEP_ANALYSIS_V2_HARD_TIMEOUT_MS: process.env.DEEP_ANALYSIS_V2_HARD_TIMEOUT_MS,
  DATABASE_URL: process.env.DATABASE_URL,
  PROMPT_OPTIMIZER_USE_MOCKS: process.env.PROMPT_OPTIMIZER_USE_MOCKS,
  PROMPT_OPTIMIZER_ENABLE_DB: process.env.PROMPT_OPTIMIZER_ENABLE_DB,
  PROMPT_OPTIMIZER_ENABLE_BILLING: process.env.PROMPT_OPTIMIZER_ENABLE_BILLING,
  PROMPT_OPTIMIZER_ENABLE_TEAMS: process.env.PROMPT_OPTIMIZER_ENABLE_TEAMS,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  STRIPE_PRICE_PRO_MONTHLY: process.env.STRIPE_PRICE_PRO_MONTHLY,
  STRIPE_PRICE_PRO_YEARLY: process.env.STRIPE_PRICE_PRO_YEARLY,
  STRIPE_PRICE_TEAM_MONTHLY: process.env.STRIPE_PRICE_TEAM_MONTHLY,
  STRIPE_PRICE_TEAM_YEARLY: process.env.STRIPE_PRICE_TEAM_YEARLY
})

export const runtimeFlags = {
  useMocks: env.PROMPT_OPTIMIZER_USE_MOCKS === "true" || (!env.DEEPSEEK_API_KEY && !env.KIMI_API_KEY),
  enableDb: env.PROMPT_OPTIMIZER_ENABLE_DB === "true" && Boolean(env.DATABASE_URL),
  enableBilling: env.PROMPT_OPTIMIZER_ENABLE_BILLING === "true",
  enableTeams: env.PROMPT_OPTIMIZER_ENABLE_TEAMS === "true"
}

export const billingEnv = {
  stripeSecretKey: env.STRIPE_SECRET_KEY ?? null,
  stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null,
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET ?? null,
  stripePriceProMonthly: env.STRIPE_PRICE_PRO_MONTHLY ?? null,
  stripePriceProYearly: env.STRIPE_PRICE_PRO_YEARLY ?? null,
  stripePriceTeamMonthly: env.STRIPE_PRICE_TEAM_MONTHLY ?? null,
  stripePriceTeamYearly: env.STRIPE_PRICE_TEAM_YEARLY ?? null
}
