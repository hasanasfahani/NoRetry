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
  getLatestUserPrompt: () => UserSnapshot
  getThread: () => ThreadSnapshot
  getLatestSubmittedAttempt: () => Promise<Attempt | null>
  getReviewableAttempts?: () => Promise<Attempt[]>
  ensureSubmittedAttempt?: () => Promise<Attempt | null>
  readAssistantMessageIdentity: (node: HTMLElement | null, text: string) => string
  normalizeResponseText: (value: string) => string
}

function normalizePromptText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function matchesSubmittedAttempt(latestUserPrompt: string, attempt: Attempt) {
  if (!latestUserPrompt) return true

  const normalizedPrompt = normalizePromptText(latestUserPrompt)
  const candidates = [attempt.raw_prompt, attempt.optimized_prompt]
    .map((value) => normalizePromptText(value))
    .filter(Boolean)

  return candidates.includes(normalizedPrompt)
}

function logReviewTarget(message: string, details?: Record<string, unknown>) {
  if (details) {
    console.debug("[NoRetry][ReviewTarget]", message, details)
    return
  }

  console.debug("[NoRetry][ReviewTarget]", message)
}

export function createReviewTargetResolver(input: CreateReviewTargetResolverInput) {
  return async function resolveReviewTarget(): Promise<ReviewTargetResolution> {
    const assistant = input.getLatestAssistantResponse()
    const responseText = assistant.text.trim()
    if (!responseText) {
      logReviewTarget("target resolution failed", {
        reason: "no_response",
        responseLength: 0
      })
      return { ok: false, reason: "no_response" }
    }

    const latestUserPrompt = input.getLatestUserPrompt().text.trim()
    const latestSubmittedAttempt = await input.getLatestSubmittedAttempt()
    const reviewableAttempts =
      (await input.getReviewableAttempts?.()) ??
      (latestSubmittedAttempt ? [latestSubmittedAttempt] : [])

    const latestAttempt = reviewableAttempts[0] ?? null
    let attempt =
      latestUserPrompt
        ? reviewableAttempts.find((candidate) => matchesSubmittedAttempt(latestUserPrompt, candidate)) ?? null
        : latestAttempt

    logReviewTarget("latest submitted attempt read", {
      attemptId: attempt?.attempt_id ?? null,
      latestAttemptId: latestAttempt?.attempt_id ?? null,
      candidateCount: reviewableAttempts.length,
      latestUserPromptLength: latestUserPrompt.length,
      rawPromptLength: attempt?.raw_prompt?.length ?? 0,
      optimizedPromptLength: attempt?.optimized_prompt?.length ?? 0,
      responseLength: responseText.length
    })

    if (!attempt && input.ensureSubmittedAttempt) {
      attempt = await input.ensureSubmittedAttempt()
      logReviewTarget("ensure submitted attempt fallback used", {
        attemptId: attempt?.attempt_id ?? null,
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

    if (!matchesSubmittedAttempt(latestUserPrompt, attempt)) {
      const ensuredAttempt = input.ensureSubmittedAttempt ? await input.ensureSubmittedAttempt() : null
      if (ensuredAttempt && matchesSubmittedAttempt(latestUserPrompt, ensuredAttempt)) {
        attempt = ensuredAttempt
      } else if (!latestUserPrompt && latestAttempt) {
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

    const threadIdentity = input.getThread().identity
    const responseIdentity = assistant.identity || input.readAssistantMessageIdentity(assistant.node, assistant.text)

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
