import type { ReviewRequirement } from "./contracts"
import type { FailureType } from "./failure-taxonomy"
import { chooseRetryStrategy, type RetryStrategy } from "./retry-strategy"

function topFailureLabels(topFailures: ReviewRequirement[], limit: number) {
  return topFailures.slice(0, limit).map((item) => item.label)
}

export function buildNextMove(input: {
  topFailures: ReviewRequirement[]
  failureTypes: FailureType[]
}) {
  const { topFailures, failureTypes } = input
  const retryStrategy: RetryStrategy = chooseRetryStrategy({ topFailures, failureTypes })
  if (!topFailures.length) {
    return {
      retryStrategy,
      promptLabel: "Nothing critical missing — safe to proceed",
      promptText: "No retry needed.",
      promptNote: "The visible answer already covers the main requirements.",
      nextMoveShort: "No retry needed."
    }
  }

  const focus = topFailureLabels(topFailures, retryStrategy === "request_missing_sections_only" ? 4 : 3)
  const focusList = focus.map((item, index) => `${index + 1}. ${item}`).join("\n")

  if (retryStrategy === "request_proof_only") {
    return {
      retryStrategy,
      promptLabel: "Next best move",
      promptText: `Ask only for visible proof of these requirements:\n${focusList}`,
      promptNote: "Do not broaden the retry beyond the missing proof.",
      nextMoveShort: `Ask only for proof of: ${focus.join("; ")}.`
    }
  }

  if (retryStrategy === "request_missing_sections_only") {
    return {
      retryStrategy,
      promptLabel: "Next best move",
      promptText: `Ask only for the missing sections:\n${focusList}`,
      promptNote: "Keep the retry focused on the missing deliverable parts.",
      nextMoveShort: `Request only the missing sections: ${focus.join("; ")}.`
    }
  }

  if (retryStrategy === "restart_with_clean_prompt") {
    return {
      retryStrategy,
      promptLabel: "Next best move",
      promptText: `Restart from the correct target and explicitly require:\n${focusList}`,
      promptNote: "The current answer is pointed in the wrong direction.",
      nextMoveShort: `Restart from the correct target and require: ${focus.join("; ")}.`
    }
  }

  if (retryStrategy === "narrow_scope") {
    return {
      retryStrategy,
      promptLabel: "Next best move",
      promptText: `Retry with a narrower scope and fix only:\n${focusList}`,
      promptNote: "Avoid rewriting the whole task.",
      nextMoveShort: `Narrow the retry to: ${focus.join("; ")}.`
    }
  }

  return {
    retryStrategy,
    promptLabel: "Next best move",
    promptText: `Retry only for these failed requirements:\n${focusList}`,
    promptNote: "Focus only on the specific failed requirements.",
    nextMoveShort: `Retry only for: ${focus.join("; ")}.`
  }
}
