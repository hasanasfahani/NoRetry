import type { AfterAnalysisResult } from "@prompt-optimizer/shared/src/schemas"
import { buildReviewErrorViewModel, buildReviewLoadingViewModel, mapAfterAnalysisToReviewViewModel } from "../mappers/review-view-model"
import { buildReviewTargetKey, buildUserSafeReviewErrorMessage, getReviewAnalysisContext, type ReviewAnalysisRunner } from "../services/review-analysis"
import type {
  ReviewPopupControllerState,
  ReviewPopupMode,
  ReviewResultCache,
  ReviewTargetResolution
} from "../types"

type ReviewPopupViewState = {
  controller: ReviewPopupControllerState
  viewModel: ReturnType<typeof buildReviewLoadingViewModel>
}

type CreateReviewPopupOrchestratorInput = {
  resolveTarget: () => Promise<ReviewTargetResolution>
  runAnalysis: ReviewAnalysisRunner
  onStateChange: (state: ReviewPopupViewState) => void
  onOpenChange: (open: boolean) => void
  onCopyPrompt: (prompt: string) => void
}

const TARGET_RESOLUTION_RETRY_DELAYS_MS = [180, 420, 820]

function buildControllerState(
  patch: Partial<ReviewPopupControllerState> & Pick<ReviewPopupControllerState, "popupState" | "activeMode">
): ReviewPopupControllerState {
  return {
    surface: patch.surface ?? "answer_mode",
    popupState: patch.popupState,
    activeMode: patch.activeMode,
    targetKey: patch.targetKey ?? null,
    cacheStatus: patch.cacheStatus ?? "none",
    analysisStarted: patch.analysisStarted ?? false,
    analysisFinished: patch.analysisFinished ?? false,
    errorReason: patch.errorReason ?? null
  }
}

export function createReviewPopupOrchestrator(input: CreateReviewPopupOrchestratorInput) {
  let activeRequestId = 0
  let cache: ReviewResultCache | null = null

  function emit(state: ReviewPopupViewState) {
    input.onStateChange(state)
  }

  function close() {
    activeRequestId += 1
    input.onOpenChange(false)
  }

  function invalidate() {
    cache = null
    console.debug("[reeva AI][ReviewPopup]", "cache invalidated")
  }

  function shouldRetryTargetResolution(result: ReviewTargetResolution) {
    return !result.ok && (result.reason === "no_response" || result.reason === "no_submitted_attempt")
  }

  async function wait(delayMs: number) {
    await new Promise((resolve) => globalThis.setTimeout(resolve, delayMs))
  }

  async function resolveTargetWithRetry(requestId: number) {
    let lastResolution = await input.resolveTarget()
    if (!shouldRetryTargetResolution(lastResolution)) {
      return lastResolution
    }

    for (const delayMs of TARGET_RESOLUTION_RETRY_DELAYS_MS) {
      if (requestId !== activeRequestId) return lastResolution
      console.debug("[reeva AI][ReviewPopup]", "retrying target resolution", {
        reason: lastResolution.ok ? "resolved" : lastResolution.reason,
        delayMs
      })
      await wait(delayMs)
      if (requestId !== activeRequestId) return lastResolution
      lastResolution = await input.resolveTarget()
      if (!shouldRetryTargetResolution(lastResolution)) {
        return lastResolution
      }
    }

    return lastResolution
  }

  async function load(mode: ReviewPopupMode) {
    const requestId = ++activeRequestId
    input.onOpenChange(true)
    emit({
      controller: buildControllerState({
        surface: "answer_mode",
        popupState: "loading",
        activeMode: mode,
        cacheStatus: "none",
        analysisStarted: false,
        analysisFinished: false
      }),
      viewModel: buildReviewLoadingViewModel(mode)
    })

    const targetResolution = await resolveTargetWithRetry(requestId)
    if (requestId !== activeRequestId) return

    if (!targetResolution.ok) {
      const message = buildUserSafeReviewErrorMessage(targetResolution.reason)
      emit({
        controller: buildControllerState({
          surface: "answer_mode",
          popupState: "error",
          activeMode: mode,
          cacheStatus: "none",
          analysisStarted: false,
          analysisFinished: false,
          errorReason: targetResolution.reason
        }),
        viewModel: buildReviewErrorViewModel(message, mode)
      })
      return
    }

    const target = targetResolution.target
    const targetKey = buildReviewTargetKey(target)
    if (!cache || cache.targetKey !== targetKey) {
      cache = {
        targetKey,
        quick: null,
        deep: null
      }
    }

    const cachedResult = mode === "deep" ? cache.deep : cache.quick
    if (cachedResult) {
      emit({
        controller: buildControllerState({
          surface: "answer_mode",
          popupState: mode === "deep" ? "deep_review" : "quick_review",
          activeMode: mode,
          targetKey,
          cacheStatus: "hit",
          analysisStarted: true,
          analysisFinished: true
        }),
        viewModel: mapAfterAnalysisToReviewViewModel({
          result: cachedResult.result,
          reviewContract: cachedResult.reviewContract,
          mode,
          taskType: target.taskType,
          quickBaseline: cache.quick?.result ?? null,
          onCopyPrompt: () => input.onCopyPrompt(
            cachedResult.reviewContract?.copyPromptText ||
            cachedResult.result.next_prompt_output?.next_prompt ||
            cachedResult.reviewContract?.promptText ||
            cachedResult.result.next_prompt
          )
        })
      })
      return
    }

    emit({
      controller: buildControllerState({
        surface: "answer_mode",
        popupState: "loading",
        activeMode: mode,
        targetKey,
        cacheStatus: "miss",
        analysisStarted: true,
        analysisFinished: false
      }),
      viewModel: buildReviewLoadingViewModel(mode)
    })

    try {
      const result = await input.runAnalysis({
        target,
        mode,
        quickBaseline: cache.quick?.result ?? null
      })
      if (requestId !== activeRequestId) return

      const context = getReviewAnalysisContext(result)
      const cachedPayload = {
        result,
        reviewContract: context?.reviewContract ?? null,
        goalContract: context?.goalContract ?? null
      }
      if (mode === "deep") cache.deep = cachedPayload
      else cache.quick = cachedPayload

      emit({
        controller: buildControllerState({
          surface: "answer_mode",
          popupState: mode === "deep" ? "deep_review" : "quick_review",
          activeMode: mode,
          targetKey,
          cacheStatus: "miss",
          analysisStarted: true,
          analysisFinished: true
        }),
        viewModel: mapAfterAnalysisToReviewViewModel({
          result,
          reviewContract: context?.reviewContract ?? null,
          mode,
          taskType: target.taskType,
          quickBaseline: cache.quick?.result ?? null,
          onCopyPrompt: () => input.onCopyPrompt(
            context?.reviewContract?.copyPromptText ||
            result.next_prompt_output?.next_prompt ||
            context?.reviewContract?.promptText ||
            result.next_prompt
          )
        })
      })
    } catch {
      if (requestId !== activeRequestId) return
      emit({
        controller: buildControllerState({
          surface: "answer_mode",
          popupState: "error",
          activeMode: mode,
          targetKey,
          cacheStatus: "miss",
          analysisStarted: true,
          analysisFinished: true,
          errorReason: "request_failed"
        }),
        viewModel: buildReviewErrorViewModel(buildUserSafeReviewErrorMessage("request_failed"), mode)
      })
    }
  }

  return {
    open: () => load("deep"),
    switchMode: (mode: ReviewPopupMode) => load(mode),
    invalidate,
    close
  }
}
