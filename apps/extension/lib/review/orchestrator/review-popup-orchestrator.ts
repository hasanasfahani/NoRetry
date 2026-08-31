import type { AfterAnalysisResult } from "@prompt-optimizer/shared/src/schemas"
import type { ReviewPopupViewModel } from "../../../components/review-popup/review/review-types"
import { mapDeepAnalysisV2ToReviewViewModel } from "../deep-analysis-v2-view-model"
import { getDeepAnalysisV2RolloutMode, shouldApplyDeepAnalysisV2 } from "../deep-analysis-v2-rollout"
import { buildReviewErrorViewModel, buildReviewLoadingViewModel, mapAfterAnalysisToReviewViewModel } from "../mappers/review-view-model"
import { buildReviewTargetKey, buildUserSafeReviewErrorMessage, getReviewAnalysisContext, type ReviewAnalysisRunner } from "../services/review-analysis"
import { getAfterReviewCache, saveAfterReviewCache } from "../../storage"
import type {
  ReviewPopupControllerState,
  ReviewPopupMode,
  ReviewResultCache,
  ReviewTarget,
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
  shouldSuppressSoftFallback?: () => boolean
  onDecisionShown?: (input: {
    target: ReviewTarget
    mode: ReviewPopupMode
    result: AfterAnalysisResult
    reviewContract: NonNullable<ReviewResultCache["quick"]>["reviewContract"]
    viewModel: ReviewPopupViewModel
    cacheStatus: "hit" | "miss"
  }) => void
  onPrimaryActionClicked?: (input: {
    target: ReviewTarget
    mode: ReviewPopupMode
    result: AfterAnalysisResult
    reviewContract: NonNullable<ReviewResultCache["quick"]>["reviewContract"]
    viewModel: ReviewPopupViewModel
  }) => void | Promise<void>
}

type CachedReviewPayload = NonNullable<ReviewResultCache["quick"]> & {
  analysisContext?: ReturnType<typeof getReviewAnalysisContext>
  deepAnalysisV2Applied?: boolean
  deepAnalysisV2?: NonNullable<ReturnType<typeof getReviewAnalysisContext>>["deepAnalysisV2"]
}

const TARGET_RESOLUTION_RETRY_DELAYS_MS = [180, 420, 820]
const DEEP_ANALYSIS_SOFT_FALLBACK_MS = 3_800
const DEEP_ANALYSIS_READY_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const DEEP_ANALYSIS_UNAVAILABLE_CACHE_TTL_MS = 60 * 1000

function traceDeepAnalysisV2(event: string, detail: Record<string, unknown> = {}) {
  console.info("[reeva AI][DeepAnalysisV2Trace]", {
    event,
    ...detail
  })
}

function copyPromptFromCachedResult(input: {
  result: AfterAnalysisResult
  reviewContract: NonNullable<ReviewResultCache["quick"]>["reviewContract"]
  deepAnalysisV2Prompt?: string | null
}) {
  return (
    input.deepAnalysisV2Prompt ||
    input.reviewContract?.copyPromptText ||
    input.result.next_prompt_output?.next_prompt ||
    input.reviewContract?.promptText ||
    input.result.next_prompt
  )
}

function buildPersistentCacheInput(target: ReviewTarget) {
  return {
    threadIdentity: target.threadIdentity,
    responseIdentity: target.responseIdentity,
    normalizedText: target.normalizedResponseText
  }
}

function payloadFromResult(result: AfterAnalysisResult | null): CachedReviewPayload | null {
  if (!result) return null
  const context = getReviewAnalysisContext(result)
  return {
    result,
    reviewContract: context?.reviewContract ?? null,
    goalContract: context?.goalContract ?? null,
    analysisContext: context,
    deepAnalysisV2Applied: context?.deepAnalysisV2Applied ?? false,
    deepAnalysisV2: context?.deepAnalysisV2 ?? null
  }
}

function isPersistedPayloadFresh(payload: CachedReviewPayload | null, updatedAt?: string) {
  if (!payload) return false
  const analysis = payload.deepAnalysisV2 ?? payload.analysisContext?.deepAnalysisV2 ?? null
  if (!analysis) return true
  const updatedAtMs = updatedAt ? Date.parse(updatedAt) : Number.NaN
  const ageMs = Number.isFinite(updatedAtMs) ? Date.now() - updatedAtMs : 0
  if (analysis.analysisState === "v2_ready" && analysis.overallStatus !== "unavailable") {
    return ageMs <= DEEP_ANALYSIS_READY_CACHE_TTL_MS
  }
  return ageMs <= DEEP_ANALYSIS_UNAVAILABLE_CACHE_TTL_MS
}

function buildControllerState(
  patch: Partial<ReviewPopupControllerState> & Pick<ReviewPopupControllerState, "popupState" | "activeMode">
): ReviewPopupControllerState {
  return {
    surface: patch.surface ?? "answer_mode",
    popupState: patch.popupState,
    activeMode: patch.activeMode,
    analysisState: patch.analysisState ?? (
      patch.popupState === "loading"
        ? "v2_running"
        : patch.popupState === "quick_review"
          ? "quick_check_ready"
          : patch.popupState === "deep_review"
            ? "v2_ready"
            : patch.popupState === "error"
              ? "v2_unavailable"
              : "idle"
    ),
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
  let cacheGeneration = 0
  let inFlightCache: {
    targetKey: string
    quick?: Promise<CachedReviewPayload>
    deep?: Promise<CachedReviewPayload>
  } | null = null

  function emit(state: ReviewPopupViewState) {
    input.onStateChange(state)
  }

  function close() {
    activeRequestId += 1
    input.onOpenChange(false)
  }

  function invalidate() {
    cacheGeneration += 1
    cache = null
    inFlightCache = null
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

  function ensureTargetCache(targetKey: string) {
    if (!cache || cache.targetKey !== targetKey) {
      cacheGeneration += 1
      cache = {
        targetKey,
        quick: null,
        deep: null
      }
    }

    if (!inFlightCache || inFlightCache.targetKey !== targetKey) {
      inFlightCache = {
        targetKey
      }
    }
  }

  async function hydratePersistentCache(
    target: ReviewTarget,
    targetKey: string,
    options: { bypassPersistentCache?: boolean } = {}
  ) {
    ensureTargetCache(targetKey)
    if (options.bypassPersistentCache) return
    if (cache?.quick && cache?.deep) return

    const persisted = await getAfterReviewCache(buildPersistentCacheInput(target)).catch((error) => {
      console.warn("[reeva AI][ReviewPopup]", "failed to read persistent review cache", error)
      return null
    })
    if (!persisted || cache?.targetKey !== targetKey) return

    const quickPayload = payloadFromResult(persisted.quick)
    const deepPayload = payloadFromResult(persisted.deep)

    if (!cache.quick && quickPayload) {
      cache.quick = quickPayload
    }

    if (!cache.deep && isPersistedPayloadFresh(deepPayload, persisted.updatedAt)) {
      const deepAnalysis = deepPayload?.deepAnalysisV2 ?? deepPayload?.analysisContext?.deepAnalysisV2 ?? null
      const deepAnalysisV2Authoritative = shouldApplyDeepAnalysisV2(getDeepAnalysisV2RolloutMode())
      if (deepAnalysisV2Authoritative && !deepAnalysis) return

      cache.deep = deepPayload
      if (deepAnalysis) {
        traceDeepAnalysisV2("v2_cache_hit", {
          source: "persistent",
          targetKey,
          analysisId: deepAnalysis.analysisId,
          analysisState: deepAnalysis.analysisState
        })
      }
    }
  }

  async function savePersistentCachePayload(inputPayload: {
    target: ReviewTarget
    mode: ReviewPopupMode
    result: AfterAnalysisResult
  }) {
    const cacheInput = buildPersistentCacheInput(inputPayload.target)
    const existing = await getAfterReviewCache(cacheInput).catch(() => null)
    await saveAfterReviewCache({
      ...cacheInput,
      quick:
        inputPayload.mode === "quick"
          ? inputPayload.result
          : cache?.quick?.result ?? existing?.quick ?? null,
      deep:
        inputPayload.mode === "deep"
          ? inputPayload.result
          : cache?.deep?.result ?? existing?.deep ?? null,
      deepArtifactSignature: existing?.deepArtifactSignature
    })
  }

  async function runAndCache(inputPayload: {
    target: ReviewTarget
    targetKey: string
    mode: ReviewPopupMode
    bypassPersistentCache?: boolean
  }): Promise<CachedReviewPayload> {
    const { target, targetKey, mode, bypassPersistentCache } = inputPayload
    ensureTargetCache(targetKey)
    await hydratePersistentCache(target, targetKey, { bypassPersistentCache })

    const cachedResult = mode === "deep" ? cache?.deep : cache?.quick
    if (cachedResult) return cachedResult

    const inFlight = mode === "deep" ? inFlightCache?.deep : inFlightCache?.quick
    if (inFlight) return inFlight

    const generation = cacheGeneration
    const promise = input.runAnalysis({
      target,
      mode,
      quickBaseline: cache?.quick?.result ?? null
    }).then(async (result) => {
      const context = getReviewAnalysisContext(result)
      const payload: CachedReviewPayload = {
        result,
        reviewContract: context?.reviewContract ?? null,
        goalContract: context?.goalContract ?? null,
        analysisContext: context,
        deepAnalysisV2Applied: context?.deepAnalysisV2Applied ?? false,
        deepAnalysisV2: context?.deepAnalysisV2 ?? null
      }

      if (generation === cacheGeneration && cache?.targetKey === targetKey) {
        if (mode === "deep") cache.deep = payload
        else cache.quick = payload
      }

      if (generation === cacheGeneration && inFlightCache?.targetKey === targetKey) {
        if (mode === "deep") delete inFlightCache.deep
        else delete inFlightCache.quick
      }

      await savePersistentCachePayload({ target, mode, result }).catch((error) => {
        console.warn("[reeva AI][ReviewPopup]", "failed to save persistent review cache", error)
      })

      return payload
    }).catch((error) => {
      if (generation === cacheGeneration && inFlightCache?.targetKey === targetKey) {
        if (mode === "deep") delete inFlightCache.deep
        else delete inFlightCache.quick
      }
      throw error
    })

    if (mode === "deep") inFlightCache!.deep = promise
    else inFlightCache!.quick = promise

    return promise
  }

  async function isTargetStillFresh(targetKey: string) {
    const latestResolution = await input.resolveTarget()
    if (!latestResolution.ok) return latestResolution.reason === "still_updating" ? false : true
    return buildReviewTargetKey(latestResolution.target) === targetKey
  }

  function buildSoftFallbackViewModel(inputPayload: {
    result: AfterAnalysisResult
    reviewContract: CachedReviewPayload["reviewContract"]
    target: ReviewTarget
    quickBaseline: AfterAnalysisResult | null
    onCopyPrompt: () => void
  }) {
    const viewModel = mapAfterAnalysisToReviewViewModel({
      result: inputPayload.result,
      reviewContract: inputPayload.reviewContract,
      mode: "quick",
      taskType: inputPayload.target.taskType,
      quickBaseline: inputPayload.quickBaseline,
      onCopyPrompt: inputPayload.onCopyPrompt
    })

    return {
      ...viewModel,
      mode: "deep" as const,
      eyebrow: "Reality check",
      workflowHelper: "Deep analysis is finishing. This quick check will update when the full result is ready.",
      confidenceNote: `${viewModel.confidenceNote} Deep Analysis v2 is still running in the background.`,
      promptActions: [],
      promptNote: "This is a preliminary quick check. Wait for Deep Analysis v2 before submitting a final prompt."
    }
  }

  async function load(mode: ReviewPopupMode, options: { bypassPersistentCache?: boolean } = {}) {
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
    ensureTargetCache(targetKey)
    await hydratePersistentCache(target, targetKey, options)

    const cachedResult = mode === "deep" ? cache?.deep : cache?.quick
    if (cachedResult) {
      const cachedPayload = cachedResult as CachedReviewPayload
      const cachedContext = cachedPayload.analysisContext ?? getReviewAnalysisContext(cachedPayload.result)
      const cachedDeepAnalysisV2 =
        mode === "deep" && (cachedPayload.deepAnalysisV2Applied ?? cachedContext?.deepAnalysisV2Applied)
          ? cachedPayload.deepAnalysisV2 ?? cachedContext?.deepAnalysisV2 ?? null
          : null
      const deepAnalysisV2Authoritative =
        mode === "deep" && shouldApplyDeepAnalysisV2(getDeepAnalysisV2RolloutMode())
      if (deepAnalysisV2Authoritative && !cachedDeepAnalysisV2) {
        traceDeepAnalysisV2("v2_marked_stale", {
          reason: "v2_superseded_by_newer_hash",
          targetKey,
          source: "cached_deep_without_v2",
          cachedHasAnalysisContext: Boolean(cachedPayload.analysisContext),
          cachedApplied: cachedPayload.deepAnalysisV2Applied ?? cachedContext?.deepAnalysisV2Applied ?? false,
          cachedHasDeepAnalysisV2: Boolean(cachedPayload.deepAnalysisV2 ?? cachedContext?.deepAnalysisV2)
        })
        if (cache) cache.deep = null
        // Continue into a fresh v2 analysis below.
      } else {
        const cachedViewModel = cachedDeepAnalysisV2
          ? mapDeepAnalysisV2ToReviewViewModel({
              analysis: cachedDeepAnalysisV2,
              mode,
              onCopyPrompt: async () => {
                await input.onPrimaryActionClicked?.({
                  target,
                  mode,
                  result: cachedPayload.result,
                  reviewContract: cachedPayload.reviewContract,
                  viewModel: cachedViewModel
                })
                input.onCopyPrompt(
                  copyPromptFromCachedResult({
                    result: cachedPayload.result,
                    reviewContract: cachedPayload.reviewContract,
                    deepAnalysisV2Prompt: cachedDeepAnalysisV2.generatedPrompt
                  })
                )
              }
            })
          : mapAfterAnalysisToReviewViewModel({
              result: cachedPayload.result,
              reviewContract: cachedPayload.reviewContract,
              mode,
              taskType: target.taskType,
              quickBaseline: cache?.quick?.result ?? null,
              onCopyPrompt: async () => {
                await input.onPrimaryActionClicked?.({
                  target,
                  mode,
                  result: cachedPayload.result,
                  reviewContract: cachedPayload.reviewContract,
                  viewModel: cachedViewModel
                })
                input.onCopyPrompt(
                  copyPromptFromCachedResult({
                    result: cachedPayload.result,
                    reviewContract: cachedPayload.reviewContract
                  })
                )
              }
            })
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
          viewModel: cachedViewModel
        })
        input.onDecisionShown?.({
          target,
          mode,
          result: cachedPayload.result,
          reviewContract: cachedPayload.reviewContract,
          viewModel: cachedViewModel,
          cacheStatus: "hit"
        })
        return
      }
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

    let softFallbackTimerId: ReturnType<typeof setTimeout> | null = null
    let deepAnalysisFinished = false

    try {
      const deepPayloadPromise = runAndCache({
        target,
        mode,
        targetKey,
        bypassPersistentCache: options.bypassPersistentCache
      })
      if (mode === "deep" && !input.shouldSuppressSoftFallback?.()) {
        softFallbackTimerId = globalThis.setTimeout(() => {
          if (deepAnalysisFinished || requestId !== activeRequestId) return
          void runAndCache({ target, targetKey, mode: "quick" })
            .then(async (quickPayload) => {
              if (deepAnalysisFinished || requestId !== activeRequestId) return
              if (!(await isTargetStillFresh(targetKey))) return
              const quickViewModel = buildSoftFallbackViewModel({
                result: quickPayload.result,
                reviewContract: quickPayload.reviewContract,
                target,
                quickBaseline: quickPayload.result,
                onCopyPrompt: async () => {
                  await input.onPrimaryActionClicked?.({
                    target,
                    mode,
                    result: quickPayload.result,
                    reviewContract: quickPayload.reviewContract,
                    viewModel: quickViewModel
                  })
                  input.onCopyPrompt(
                    copyPromptFromCachedResult({
                      result: quickPayload.result,
                      reviewContract: quickPayload.reviewContract
                    })
                  )
                }
              })
              emit({
                controller: buildControllerState({
                  surface: "answer_mode",
                  popupState: "deep_review",
                  activeMode: mode,
                  targetKey,
                  cacheStatus: "miss",
                  analysisStarted: true,
                  analysisFinished: false
                }),
                viewModel: quickViewModel
              })
            })
            .catch(() => {})
        }, DEEP_ANALYSIS_SOFT_FALLBACK_MS)
      }

      const cachedPayload = await deepPayloadPromise
      deepAnalysisFinished = true
      if (softFallbackTimerId) globalThis.clearTimeout(softFallbackTimerId)
      if (requestId !== activeRequestId) return
      if (!(await isTargetStillFresh(targetKey))) {
        invalidate()
        void load(mode, options)
        return
      }

      const result = cachedPayload.result
      const context = getReviewAnalysisContext(result)

      const deepAnalysisV2 =
        mode === "deep" && context?.deepAnalysisV2Applied
          ? context.deepAnalysisV2 ?? null
          : null
      if (mode === "deep" && context?.deepAnalysisV2Applied && !deepAnalysisV2) {
        traceDeepAnalysisV2("v2_marked_unavailable", {
          reason: "v2_mapping_failed",
          targetKey
        })
      }
      const viewModel = deepAnalysisV2
        ? mapDeepAnalysisV2ToReviewViewModel({
            analysis: deepAnalysisV2,
            mode,
            onCopyPrompt: async () => {
              await input.onPrimaryActionClicked?.({
                target,
                mode,
                result,
                reviewContract: context?.reviewContract ?? null,
                viewModel
              })
              input.onCopyPrompt(
                copyPromptFromCachedResult({
                  result,
                  reviewContract: context?.reviewContract ?? null,
                  deepAnalysisV2Prompt: deepAnalysisV2.generatedPrompt
                })
              )
            }
          })
        : mapAfterAnalysisToReviewViewModel({
            result,
            reviewContract: context?.reviewContract ?? null,
            mode,
            taskType: target.taskType,
            quickBaseline: cache?.quick?.result ?? null,
            onCopyPrompt: async () => {
              await input.onPrimaryActionClicked?.({
                target,
                mode,
                result,
                reviewContract: context?.reviewContract ?? null,
                viewModel
              })
              input.onCopyPrompt(
                copyPromptFromCachedResult({
                  result,
                  reviewContract: context?.reviewContract ?? null
                })
              )
            }
          })
      emit({
        controller: buildControllerState({
          surface: "answer_mode",
          popupState: mode === "deep" ? "deep_review" : "quick_review",
          activeMode: mode,
          analysisState: deepAnalysisV2?.analysisState ?? (mode === "deep" ? "v2_unavailable" : "quick_check_ready"),
          targetKey,
          cacheStatus: "miss",
          analysisStarted: true,
          analysisFinished: true
        }),
        viewModel
      })
      if (deepAnalysisV2) {
        traceDeepAnalysisV2("v2_applied_to_popup", {
          analysisId: deepAnalysisV2.analysisId,
          state: deepAnalysisV2.analysisState,
          targetKey
        })
      }
      input.onDecisionShown?.({
        target,
        mode,
        result,
        reviewContract: context?.reviewContract ?? null,
        viewModel,
        cacheStatus: "miss"
      })
    } catch {
      deepAnalysisFinished = true
      if (softFallbackTimerId) globalThis.clearTimeout(softFallbackTimerId)
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
    retry: (mode: ReviewPopupMode = "deep") => {
      invalidate()
      return load(mode, { bypassPersistentCache: true })
    },
    prewarm: async (mode: ReviewPopupMode = "deep") => {
      const requestId = activeRequestId
      const targetResolution = await resolveTargetWithRetry(requestId)
      if (!targetResolution.ok) return false

      const target = targetResolution.target
      const targetKey = buildReviewTargetKey(target)
      await runAndCache({ target, targetKey, mode })
      return true
    },
    invalidate,
    close
  }
}
