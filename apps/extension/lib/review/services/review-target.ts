import type { Attempt } from "@prompt-optimizer/shared/src/schemas"
import type { ReviewTargetResolution } from "../types"
import { classifyReviewTaskType } from "./review-task-type"

type AssistantSnapshot = {
  node: HTMLElement | null
  text: string
  identity: string
}

type UserSnapshot = {
  text: string
}

type ThreadSnapshot = {
  identity: string
}

type CreateReviewTargetResolverInput = {
  getLatestAssistantResponse: () => AssistantSnapshot
  getAnswerCompletionState?: () => {
    isStreamingActive: boolean
    assistantControlsVisible: boolean
    reason: string
  }
  getLatestUserPrompt: () => UserSnapshot
  getThread: () => ThreadSnapshot
  getLatestSubmittedAttempt: () => Promise<Attempt | null>
  getPinnedSubmittedAttempt?: () => Attempt | null
  getReviewableAttempts?: () => Promise<Attempt[]>
  ensureSubmittedAttempt?: () => Promise<Attempt | null>
  readAssistantMessageIdentity: (node: HTMLElement | null, text: string) => string
  normalizeResponseText: (value: string) => string
}

function normalizePromptText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeComparisonText(value: string) {
  return normalizePromptText(value).toLowerCase()
}

function normalizeAttemptResponseText(normalizeResponseText: (value: string) => string, attempt: Attempt) {
  const responseText = attempt.response_text?.trim() ?? ""
  if (!responseText) return ""
  return normalizePromptText(normalizeResponseText(responseText))
}

function matchesSubmittedAttempt(latestUserPrompt: string, attempt: Attempt) {
  if (!latestUserPrompt) return true

  const normalizedPrompt = normalizePromptText(latestUserPrompt)
  const candidates = [attempt.raw_prompt, attempt.optimized_prompt]
    .map((value) => normalizePromptText(value))
    .filter(Boolean)

  return candidates.includes(normalizedPrompt)
}

function buildPromptCandidates(latestUserPrompt: string, attempt: Attempt | null) {
  const candidates = new Set<string>()

  if (latestUserPrompt) {
    const normalizedLatestPrompt = normalizePromptText(latestUserPrompt)
    if (normalizedLatestPrompt) candidates.add(normalizedLatestPrompt)
  }

  if (!attempt) return candidates

  for (const value of [attempt.raw_prompt, attempt.optimized_prompt]) {
    const normalizedValue = normalizePromptText(value)
    if (normalizedValue) candidates.add(normalizedValue)
  }

  return candidates
}

function hasPromptContextInResponse(responseText: string, attempt: Attempt) {
  const normalizedResponse = normalizeComparisonText(responseText)
  if (!normalizedResponse) return false

  const candidates = [attempt.raw_prompt, attempt.optimized_prompt, attempt.intent.goal]
    .map((value) => normalizeComparisonText(value))
    .filter((value) => value.length >= 24)

  return candidates.some((candidate) => {
    if (normalizedResponse.includes(candidate)) return true

    const prefix = candidate.slice(0, 96).trim()
    if (prefix.length >= 24 && normalizedResponse.includes(prefix)) return true

    return false
  })
}

function matchesResolvedAssistantResponse(params: {
  attempt: Attempt
  responseIdentity: string
  responseText: string
  normalizeResponseText: (value: string) => string
}) {
  const { attempt, responseIdentity, responseText, normalizeResponseText } = params
  const normalizedCurrentResponse = normalizePromptText(normalizeResponseText(responseText))
  const normalizedAttemptResponse = normalizeAttemptResponseText(normalizeResponseText, attempt)

  if (responseIdentity && attempt.response_message_id && attempt.response_message_id === responseIdentity) {
    return true
  }

  if (normalizedCurrentResponse && normalizedAttemptResponse && normalizedAttemptResponse === normalizedCurrentResponse) {
    return true
  }

  if (hasPromptContextInResponse(responseText, attempt)) {
    return true
  }

  return false
}

function logReviewTarget(message: string, details?: Record<string, unknown>) {
  if (details) {
    console.debug("[reeva AI][ReviewTarget]", message, details)
    return
  }

  console.debug("[reeva AI][ReviewTarget]", message)
}

export function createReviewTargetResolver(input: CreateReviewTargetResolverInput) {
  return async function resolveReviewTarget(): Promise<ReviewTargetResolution> {
    const assistant = input.getLatestAssistantResponse()
    const responseText = assistant.text.trim()
    const completionState = input.getAnswerCompletionState?.()
    if (completionState && (completionState.isStreamingActive || (responseText && !completionState.assistantControlsVisible))) {
      logReviewTarget("target resolution paused", {
        reason: "still_updating",
        completionReason: completionState?.reason ?? "unknown",
        streaming: completionState?.isStreamingActive ?? false,
        assistantControlsVisible: completionState?.assistantControlsVisible ?? false,
        responseLength: responseText.length
      })
      return { ok: false, reason: "still_updating" }
    }

    if (!responseText) {
      logReviewTarget("target resolution failed", {
        reason: "no_response",
        responseLength: 0
      })
      return { ok: false, reason: "no_response" }
    }

    const latestUserPrompt = input.getLatestUserPrompt().text.trim()
    const responseIdentity = assistant.identity || input.readAssistantMessageIdentity(assistant.node, assistant.text)
    const latestSubmittedAttempt = await input.getLatestSubmittedAttempt()
    const pinnedSubmittedAttempt = input.getPinnedSubmittedAttempt?.() ?? null
    const reviewableAttempts =
      (await input.getReviewableAttempts?.()) ??
      (latestSubmittedAttempt ? [latestSubmittedAttempt] : [])

    const latestAttempt = reviewableAttempts[0] ?? null
    const responseMatchedAttempt =
      reviewableAttempts.find((candidate) =>
        matchesResolvedAssistantResponse({
          attempt: candidate,
          responseIdentity,
          responseText: assistant.text,
          normalizeResponseText: input.normalizeResponseText
        })
      ) ?? null
    const promptMatchedAttempt =
      latestUserPrompt
        ? reviewableAttempts.find((candidate) => matchesSubmittedAttempt(latestUserPrompt, candidate)) ?? null
        : null

    const pinnedAttemptMatchesResponse =
      pinnedSubmittedAttempt &&
      matchesResolvedAssistantResponse({
        attempt: pinnedSubmittedAttempt,
        responseIdentity,
        responseText: assistant.text,
        normalizeResponseText: input.normalizeResponseText
      })
    const pinnedAttemptMatchesPrompt =
      pinnedSubmittedAttempt && latestUserPrompt
        ? matchesSubmittedAttempt(latestUserPrompt, pinnedSubmittedAttempt)
        : false

    let attempt =
      responseMatchedAttempt ??
      (pinnedAttemptMatchesResponse || (!responseMatchedAttempt && pinnedSubmittedAttempt)
        ? pinnedSubmittedAttempt
        : null) ??
      promptMatchedAttempt ??
      latestAttempt

    logReviewTarget("latest submitted attempt read", {
      attemptId: attempt?.attempt_id ?? null,
      latestAttemptId: latestAttempt?.attempt_id ?? null,
      pinnedAttemptId: pinnedSubmittedAttempt?.attempt_id ?? null,
      pinnedAttemptMatchesResponse,
      pinnedAttemptMatchesPrompt,
      responseMatchedAttemptId: responseMatchedAttempt?.attempt_id ?? null,
      candidateCount: reviewableAttempts.length,
      latestUserPromptLength: latestUserPrompt.length,
      rawPromptLength: attempt?.raw_prompt?.length ?? 0,
      optimizedPromptLength: attempt?.optimized_prompt?.length ?? 0,
      responseLength: responseText.length
    })

    if (!attempt && input.ensureSubmittedAttempt) {
      const ensuredAttempt = await input.ensureSubmittedAttempt()
      if (ensuredAttempt) {
        attempt = ensuredAttempt
      }
      logReviewTarget("ensure submitted attempt fallback used", {
        attemptId: ensuredAttempt?.attempt_id ?? null,
        latestUserPromptLength: latestUserPrompt.length
      })
    }

    if (!attempt) {
      logReviewTarget("target resolution failed", {
        reason: "no_submitted_attempt",
        responseLength: responseText.length
      })
      return { ok: false, reason: "no_submitted_attempt" }
    }

    if (!latestUserPrompt && !responseMatchedAttempt && !pinnedSubmittedAttempt && input.ensureSubmittedAttempt) {
      const ensuredAttempt = await input.ensureSubmittedAttempt()
      if (ensuredAttempt) {
        attempt = ensuredAttempt
      }
      logReviewTarget("missing prompt attempt fallback used", {
        attemptId: ensuredAttempt?.attempt_id ?? null,
        responseIdentity,
        responseLength: responseText.length
      })
    }

    if (!responseMatchedAttempt && latestUserPrompt && !matchesSubmittedAttempt(latestUserPrompt, attempt)) {
      const ensuredAttempt = input.ensureSubmittedAttempt ? await input.ensureSubmittedAttempt() : null
      if (ensuredAttempt && matchesSubmittedAttempt(latestUserPrompt, ensuredAttempt)) {
        attempt = ensuredAttempt
      } else if (latestAttempt) {
        attempt = latestAttempt
      } else {
        logReviewTarget("target resolution failed", {
          reason: "no_submitted_attempt",
          mismatch: true,
          latestUserPromptLength: latestUserPrompt.length,
          attemptId: attempt.attempt_id
        })
        return { ok: false, reason: "no_submitted_attempt" }
      }
    }

    if (!latestUserPrompt && responseMatchedAttempt) {
      attempt = responseMatchedAttempt
    }

    const normalizedResponseText = normalizePromptText(responseText)
    const promptCandidates = buildPromptCandidates(latestUserPrompt, attempt)
    if (normalizedResponseText && promptCandidates.has(normalizedResponseText)) {
      logReviewTarget("target resolution failed", {
        reason: "no_response",
        echoedPrompt: true,
        attemptId: attempt.attempt_id,
        latestUserPromptLength: latestUserPrompt.length,
        responseLength: responseText.length
      })
      return { ok: false, reason: "no_response" }
    }

    const threadIdentity = input.getThread().identity

    logReviewTarget("target resolution succeeded", {
      attemptId: attempt.attempt_id,
      threadIdentity,
      responseIdentity,
      latestUserPromptLength: latestUserPrompt.length,
      responseLength: responseText.length
    })

    return {
      ok: true,
      target: {
        attempt,
        taskType: classifyReviewTaskType(attempt),
        responseText: assistant.text,
        responseIdentity,
        threadIdentity,
        normalizedResponseText: input.normalizeResponseText(assistant.text)
      }
    }
  }
}
