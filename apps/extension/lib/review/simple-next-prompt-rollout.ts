export type SimpleNextPromptRolloutMode = "off" | "shadow" | "on"

export const SIMPLE_NEXT_PROMPT_ROLLOUT_ENV_KEY = "PLASMO_PUBLIC_SIMPLE_NEXT_PROMPT_ROLLOUT"
export const DEFAULT_SIMPLE_NEXT_PROMPT_ROLLOUT_MODE: SimpleNextPromptRolloutMode = "on"

type ProcessLike = {
  env?: Record<string, string | undefined>
}

declare const process: ProcessLike | undefined

export function normalizeSimpleNextPromptRolloutMode(
  value: string | null | undefined
): SimpleNextPromptRolloutMode {
  const normalized = (value ?? "").trim().toLowerCase()

  if (normalized === "off" || normalized === "0" || normalized === "false" || normalized === "disabled") {
    return "off"
  }

  if (normalized === "shadow" || normalized === "observe" || normalized === "monitor") {
    return "shadow"
  }

  if (normalized === "on" || normalized === "1" || normalized === "true" || normalized === "enabled") {
    return "on"
  }

  return DEFAULT_SIMPLE_NEXT_PROMPT_ROLLOUT_MODE
}

export function getSimpleNextPromptRolloutMode(): SimpleNextPromptRolloutMode {
  const rawValue =
    typeof process !== "undefined" ? process.env?.[SIMPLE_NEXT_PROMPT_ROLLOUT_ENV_KEY] : undefined

  return normalizeSimpleNextPromptRolloutMode(rawValue)
}

export function shouldBuildSimpleNextPromptDecision(
  mode: SimpleNextPromptRolloutMode = getSimpleNextPromptRolloutMode()
) {
  return mode === "shadow" || mode === "on"
}

export function shouldApplySimpleNextPromptDecision(
  mode: SimpleNextPromptRolloutMode = getSimpleNextPromptRolloutMode()
) {
  return mode === "on"
}
