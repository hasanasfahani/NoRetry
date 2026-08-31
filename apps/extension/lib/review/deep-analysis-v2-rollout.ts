export type DeepAnalysisV2RolloutMode = "off" | "shadow" | "on"

export const DEEP_ANALYSIS_V2_ROLLOUT_ENV_KEY = "PLASMO_PUBLIC_DEEP_ANALYSIS_V2_ROLLOUT"
export const DEFAULT_DEEP_ANALYSIS_V2_ROLLOUT_MODE: DeepAnalysisV2RolloutMode = "on"

type ProcessLike = {
  env?: Record<string, string | undefined>
}

declare const process: ProcessLike | undefined

export function normalizeDeepAnalysisV2RolloutMode(
  value: string | null | undefined
): DeepAnalysisV2RolloutMode {
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

  return DEFAULT_DEEP_ANALYSIS_V2_ROLLOUT_MODE
}

export function getDeepAnalysisV2RolloutMode(): DeepAnalysisV2RolloutMode {
  const rawValue =
    typeof process !== "undefined" ? process.env?.[DEEP_ANALYSIS_V2_ROLLOUT_ENV_KEY] : undefined

  return normalizeDeepAnalysisV2RolloutMode(rawValue)
}

export function shouldRunDeepAnalysisV2(
  mode: DeepAnalysisV2RolloutMode = getDeepAnalysisV2RolloutMode()
) {
  return mode === "shadow" || mode === "on"
}

export function shouldApplyDeepAnalysisV2(
  mode: DeepAnalysisV2RolloutMode = getDeepAnalysisV2RolloutMode()
) {
  return mode === "on"
}
