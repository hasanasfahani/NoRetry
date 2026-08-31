import type { AfterAnalysisResult } from "@prompt-optimizer/shared/src/schemas"
import type { ReviewContract } from "./contracts"

export function isNoRetryPromptText(prompt: string | null | undefined) {
  const normalized = (prompt ?? "").trim()
  return /^no retry needed\b/i.test(normalized) || /^nothing critical missing\b/i.test(normalized)
}

export function getNoRetryCandidatePrompt(result: AfterAnalysisResult, contract?: ReviewContract | null) {
  return (
    contract?.copyPromptText ||
    contract?.promptText ||
    result.next_prompt_output?.next_prompt ||
    result.next_prompt ||
    ""
  )
}

export function isNoRetryAnalysisResult(result: AfterAnalysisResult, contract?: ReviewContract | null) {
  const strategyMode = contract?.analysisDebug?.smart.strategy.mode || null

  return strategyMode === "no_retry" || isNoRetryPromptText(getNoRetryCandidatePrompt(result, contract))
}
