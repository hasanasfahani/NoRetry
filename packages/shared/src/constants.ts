export const PROMPT_INTENTS = [
  "BUILD",
  "DEBUG",
  "REFACTOR",
  "DESIGN_UI",
  "EXPLAIN",
  "PLAN",
  "OTHER"
] as const

export const STRENGTH_SCORES = ["LOW", "MID", "HIGH"] as const

export const DETECTION_THRESHOLDS = {
  retryWindowMs: 1000 * 60 * 4,
  loopRetryCount: 2,
  changedFilesBroadThreshold: 8,
  changedFilesSimplePromptThreshold: 4,
  outputSnippetMaxChars: 500,
  sessionPromptLimit: 3,
  longPromptChars: 2400,
  emptyPromptMinChars: 4,
  afterRateLimitPerHour: 6
} as const

export const SUPPORTED_HOSTS = ["replit.com", "www.replit.com", "chatgpt.com", "chat.openai.com"]
