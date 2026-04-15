import type { AfterAnalysisResult, ResponsePreprocessorOutput, Stage1Output, Stage2Output, VerdictOutput } from "@prompt-optimizer/shared/src/schemas"
import type { ReviewTarget } from "../types"
import { isAnswerQualityTask } from "./review-task-type"

export type ReviewAnalysisInput = {
  target: ReviewTarget
  mode: "quick" | "deep"
  quickBaseline: AfterAnalysisResult | null
}

export type ReviewAnalysisRunner = (input: ReviewAnalysisInput) => Promise<AfterAnalysisResult>

type CreateReviewAnalysisRunnerInput = {
  analyzeAfterAttempt: (input: {
    attempt: ReviewTarget["attempt"]
    response_summary: unknown
    response_text_fallback: string
    deep_analysis: boolean
    project_context: string
    current_state: string
    error_summary: string
    changed_file_paths_summary: string[]
  }) => Promise<AfterAnalysisResult>
  attachAnalysisResult: (
    attemptId: string,
    responseText: string,
    analysis: AfterAnalysisResult,
    responseMessageId?: string | null
  ) => Promise<unknown>
  preprocessResponse: (responseText: string) => unknown
  getProjectMemoryContext: () => {
    projectContext: string
    currentState: string
  }
  collectChangedFilesSummary: () => string[]
  collectVisibleErrorSummary: () => string
}

type RuntimeSignal = {
  label: string
  patterns: RegExp[]
  verified: boolean
}

const GOAL_STOPWORDS = new Set([
  "the",
  "this",
  "that",
  "with",
  "from",
  "into",
  "your",
  "their",
  "there",
  "please",
  "latest",
  "request",
  "response",
  "answer",
  "issue"
])

const WEAK_GOAL_PATTERNS = [
  /^solve(?: it| this| the problem)?$/i,
  /^fix(?: it| this| the problem)?$/i,
  /^make it work$/i,
  /^make it better$/i,
  /^handle it$/i,
  /^improve it$/i,
  /^solve the requested task$/i,
  /^the user's latest request$/i,
  /^the user’s latest request$/i
]

const PROMPT_ARTIFACT_SECTION_PATTERNS = [
  /task\s*\/\s*goal:/i,
  /key requirements:/i,
  /constraints:/i,
  /required inputs?(?: or ingredients)?:/i,
  /output format:/i,
  /quality bar\s*\/\s*style guardrails:/i,
  /style:/i,
  /requirements:/i,
  /output:/i
]

const PROMPT_ARTIFACT_CHECKLIST_LABELS = [
  "The generated prompt preserves the user’s core goal",
  "The generated prompt preserves important constraints",
  "The generated prompt is structured and clear",
  "The generated prompt is usable as a send-ready prompt"
] as const

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function countStructuredSteps(text: string) {
  const matches = text.match(/(^|\n)\s*(?:\d+[.)]|[-*])\s+/g)
  return matches?.length ?? 0
}

function countListStyleIdeas(text: string) {
  const matches = text.match(/(^|\n)\s*(?:[-*]|\d+[.)])\s+/g)
  return matches?.length ?? 0
}

function hasHtmlStructure(text: string) {
  return /<html\b|<body\b|<head\b|<!doctype html>|<section\b|<main\b/i.test(text)
}

function hasCssSignals(text: string) {
  return /<style\b|```css\b|[.#][\w-]+\s*\{|color\s*:|font-family\s*:|max-width\s*:/i.test(text)
}

function countPromptArtifactSections(text: string) {
  return PROMPT_ARTIFACT_SECTION_PATTERNS.filter((pattern) => pattern.test(text)).length
}

function isStructuredPromptArtifactText(text: string) {
  return countPromptArtifactSections(text) >= 2
}

function extractPromptArtifactConstraints(promptText: string) {
  const constraints: string[] = []
  const normalizedPrompt = promptText.trim()

  const servingsMatch = normalizedPrompt.match(/(\d+(?:\s*[-–]\s*\d+)?)\s*(?:servings?|people|kids?|children)\b/i)
  if (servingsMatch) {
    constraints.push(
      `${servingsMatch[1].replace(/\s+/g, "")} ${/people|kids?|children/i.test(servingsMatch[0]) ? "people" : "servings"}`
    )
  }

  const minuteMatch = normalizedPrompt.match(/(\d+)\s*[-–]?\s*minutes?\b/i)
  if (minuteMatch) constraints.push(`${minuteMatch[1]} minutes`)

  const phrasePatterns = [
    /\bhtml\b/i,
    /\bcss\b/i,
    /\bjavascript\b/i,
    /\bjson\b/i,
    /\bstep[-\s]?by[-\s]?step\b/i,
    /\bingredients?\b/i,
    /\bquantities\b/i,
    /\bcalories per serving\b/i,
    /\bstovetop\b/i,
    /\boven[-\s]?baked\b/i,
    /\bnut[-\s]?free\b/i,
    /\blow[-\s]?carb\b/i,
    /\bprofessional\b/i
  ]

  for (const pattern of phrasePatterns) {
    const match = normalizedPrompt.match(pattern)
    if (match) constraints.push(match[0])
  }

  const exclusionMatch = normalizedPrompt.match(/\b(?:without|exclude|excluding|no)\s+([a-z][a-z\s-]+)/i)
  if (exclusionMatch) constraints.push(`without ${normalizeSentence(exclusionMatch[1])}`)

  return [...new Set(constraints.map((item) => item.trim()).filter(Boolean))].slice(0, 6)
}

function constraintAppearsInResponse(constraint: string, responseText: string) {
  const constraintText = normalize(constraint)
  const response = normalize(responseText)
  if (!constraintText) return true
  if (response.includes(constraintText)) return true

  const tokens = extractMeaningfulTokens(constraint)
  if (!tokens.length) return true

  const matched = tokens.filter((token) => response.includes(token))
  return matched.length >= Math.min(tokens.length, 2)
}

function buildPromptArtifactChecklist(input: {
  promptText: string
  responseText: string
  responseSummary: ResponsePreprocessorOutput
}) {
  const { promptText, responseText, responseSummary } = input
  const extractedConstraints = extractPromptArtifactConstraints(promptText)
  const normalizedResponse = normalize(responseText)
  const promptKeywords = extractPromptKeywords(promptText)
  const goalMatched =
    promptKeywords.length === 0 ||
    promptKeywords.filter((keyword) => normalizedResponse.includes(keyword)).length >= Math.min(2, promptKeywords.length)
  const preservedConstraints = extractedConstraints.filter((constraint) =>
    constraintAppearsInResponse(constraint, responseText)
  )
  const structured = countPromptArtifactSections(responseText) >= 2
  const sendReady = structured && responseSummary.response_length >= 180 && responseSummary.uncertainty_signals.length < 3

  return {
    checklist: [
      {
        label: PROMPT_ARTIFACT_CHECKLIST_LABELS[0],
        status: goalMatched ? "met" : "not_sure"
      },
      {
        label: PROMPT_ARTIFACT_CHECKLIST_LABELS[1],
        status:
          extractedConstraints.length === 0
            ? "met"
            : preservedConstraints.length === extractedConstraints.length
              ? "met"
              : preservedConstraints.length > 0
                ? "not_sure"
                : "missed"
      },
      {
        label: PROMPT_ARTIFACT_CHECKLIST_LABELS[2],
        status: structured ? "met" : "not_sure"
      },
      {
        label: PROMPT_ARTIFACT_CHECKLIST_LABELS[3],
        status: sendReady ? "met" : structured ? "not_sure" : "missed"
      }
    ] satisfies AfterAnalysisResult["acceptance_checklist"],
    extractedConstraints,
    preservedConstraints,
    goalMatched,
    structured,
    sendReady
  }
}

function isPromptArtifactChecklistLabel(label: string) {
  const normalizedLabel = normalize(label)
  if (!normalizedLabel) return false
  if (label.includes("\n")) return true
  if (PROMPT_ARTIFACT_SECTION_PATTERNS.some((pattern) => pattern.test(label))) return true
  if (label.length > 120) return true
  return /^task\s*\/\s*goal\b/i.test(label.trim())
}

function matchesCreationFormatAndScope(input: {
  promptText: string
  responseText: string
  responseSummary: ResponsePreprocessorOutput
}) {
  const { promptText, responseText, responseSummary } = input
  const normalizedPrompt = normalize(promptText)
  const normalizedResponse = normalize(responseText)
  const wantsHtml = /\bhtml\b/i.test(promptText)
  const wantsCss = /\bcss\b/i.test(promptText)
  const wantsJs = /\bjavascript\b|\bjs\b/i.test(promptText)
  const wantsWebsite = /\bwebsite\b|\bpage\b|\bsite\b/i.test(promptText)
  const wantsCv = /\bcv\b|\bresume\b/i.test(promptText)

  const hasHtml = responseSummary.has_code_blocks || hasHtmlStructure(responseText) || responseSummary.mentioned_files.some((file) => /\.html$/i.test(file))
  const hasCss = hasCssSignals(responseText) || responseSummary.mentioned_files.some((file) => /\.css$/i.test(file))
  const hasJs = /```(?:js|javascript)\b|<script\b|function\s+\w+|const\s+\w+/i.test(responseText) || responseSummary.mentioned_files.some((file) => /\.(?:js|ts|tsx)$/i.test(file))
  const staysInScope = !/\bbackend\b|\bapi\b|\bdatabase\b|\bserver\b|\bauth\b/i.test(normalizedResponse)
  const cvSignals = /\bcv\b|\bresume\b|\bexperience\b|\beducation\b|\bskills\b|\bcontact\b/i.test(normalizedResponse)
  const websiteSignals = hasHtml || /\blayout\b|\bsection\b|\bpage\b/i.test(normalizedResponse)

  if (wantsHtml && !hasHtml) return false
  if (wantsCss && !hasCss) return false
  if (wantsJs && !hasJs) return false
  if (wantsWebsite && !websiteSignals) return false
  if (wantsCv && !cvSignals) return false

  return staysInScope && (hasHtml || hasCss || hasJs || responseSummary.has_code_blocks)
}

function extractPromptKeywords(prompt: string) {
  const stopwords = new Set([
    "give",
    "me",
    "the",
    "how",
    "what",
    "when",
    "where",
    "which",
    "this",
    "that",
    "with",
    "from",
    "into",
    "your",
    "their",
    "there",
    "please",
    "instructions",
    "steps"
  ])

  return prompt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !stopwords.has(token))
    .filter((token, index, all) => all.indexOf(token) === index)
    .slice(0, 6)
}

function extractMeaningfulTokens(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !GOAL_STOPWORDS.has(token))
    .filter((token, index, all) => all.indexOf(token) === index)
}

function isWeakGoal(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return true
  if (WEAK_GOAL_PATTERNS.some((pattern) => pattern.test(trimmed))) return true
  const tokens = extractMeaningfulTokens(trimmed)
  return tokens.length < 2
}

function normalizeSentence(value: string) {
  const trimmed = value.replace(/\s+/g, " ").trim()
  if (!trimmed) return ""
  const sentence = trimmed.replace(/[.]+$/g, "")
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`
}

function pickFirstMeaningful(values: Array<string | null | undefined>) {
  return values.map((value) => value?.trim() ?? "").find(Boolean) ?? ""
}

function buildNormalizedGoal(target: ReviewTarget, responseSummary: ResponsePreprocessorOutput) {
  const rawGoal = pickFirstMeaningful([
    target.attempt.intent.goal,
    target.attempt.optimized_prompt,
    target.attempt.raw_prompt
  ])

  if (!isWeakGoal(rawGoal)) return normalizeSentence(rawGoal)

  if (target.taskType === "debug") {
    const runtimeSignals = buildExtensionRuntimeSignals(rawGoal, target.responseText)
    if (runtimeSignals?.length) {
      return "Confirm the runtime fix end to end: extension loads, the content script attaches, the target input is detected, the icon renders in the DOM, and the icon is visible in the UI"
    }

    return "Identify the failure point, apply the fix, and confirm the runtime result"
  }

  const concreteChange = responseSummary.change_claims[0]
  if (concreteChange) {
    return normalizeSentence(`Implement the requested fix and show evidence it resolves the issue. ${concreteChange}`)
  }

  if (responseSummary.mentioned_files.length) {
    return normalizeSentence(
      `Implement the requested fix and show evidence the issue is resolved in ${responseSummary.mentioned_files.slice(0, 2).join(" and ")}`
    )
  }

  return "Implement the requested fix and show evidence the issue is resolved"
}

function isGenericChecklistLabel(label: string, normalizedGoal: string, rawPrompt: string) {
  const normalizedLabel = normalize(label)
  if (!normalizedLabel) return true
  if (isPromptArtifactChecklistLabel(label)) return true
  if (WEAK_GOAL_PATTERNS.some((pattern) => pattern.test(label.trim()))) return true
  if (normalizedLabel === normalize(normalizedGoal) && isWeakGoal(normalizedGoal)) return true
  if (normalizedLabel === normalize(rawPrompt)) return true
  if (/^the user'?s latest request$/i.test(label.trim())) return true
  if (/^solve/.test(normalizedLabel) || /^fix/.test(normalizedLabel)) return extractMeaningfulTokens(label).length < 2
  return false
}

function responseHasGoalSignal(normalizedGoal: string, responseText: string) {
  const goalTokens = extractMeaningfulTokens(normalizedGoal)
  if (!goalTokens.length) return false
  const haystack = normalize(responseText)
  const matched = goalTokens.filter((token) => haystack.includes(token))
  return matched.length >= Math.min(2, goalTokens.length)
}

function buildFallbackStructuredChecklist(
  target: ReviewTarget,
  responseSummary: ResponsePreprocessorOutput,
  normalizedGoal: string
): AfterAnalysisResult["acceptance_checklist"] {
  if (isStructuredPromptArtifactText(target.responseText)) {
    return buildPromptArtifactChecklist({
      promptText: target.attempt.raw_prompt || target.attempt.optimized_prompt || target.attempt.intent.goal || "",
      responseText: target.responseText,
      responseSummary
    }).checklist
  }

  if (target.taskType === "debug") {
    const runtimeSignals = buildExtensionRuntimeSignals(
      target.attempt.raw_prompt || target.attempt.optimized_prompt || target.attempt.intent.goal || "",
      target.responseText
    )

    if (runtimeSignals?.length) {
      return runtimeSignals.map((signal) => ({
        label: signal.label,
        status: signal.verified ? "met" : "not_sure"
      }))
    }

    return [
      {
        label: "The root cause is identified",
        status: /\b(root cause|failure point|likely cause)\b/i.test(target.responseText) ? "met" : "not_sure"
      },
      {
        label: "The concrete fix is implemented",
        status:
          responseSummary.change_claims.length > 0 ||
          responseSummary.mentioned_files.length > 0 ||
          responseSummary.has_code_blocks
            ? "met"
            : "not_sure"
      },
      {
        label: "The runtime result is confirmed",
        status:
          responseSummary.validation_signals.length > 0 ||
          /\b(runtime|live|browser|ui)\b.*\b(verified|confirmed|works|resolved)\b/i.test(target.responseText)
            ? "met"
            : "not_sure"
      }
    ]
  }

  const intentCriteria = target.attempt.intent.acceptance_criteria
    .map((item) => normalizeSentence(item))
    .filter((item) => item && !isGenericChecklistLabel(item, normalizedGoal, target.attempt.raw_prompt))
    .slice(0, 4)

  if (intentCriteria.length) {
    return intentCriteria.map((label) => ({
      label,
      status: responseHasGoalSignal(label, target.responseText) ? "met" : "not_sure"
    }))
  }

  return [
    {
      label: "The answer names the concrete change or fix",
      status:
        responseSummary.change_claims.length > 0 ||
        responseSummary.mentioned_files.length > 0 ||
        responseSummary.has_code_blocks
          ? "met"
          : "not_sure"
    },
    {
      label: "The answer explains how the change addresses the goal",
      status: responseHasGoalSignal(normalizedGoal, target.responseText) ? "met" : "not_sure"
    },
    {
      label: "The answer shows evidence the result works",
      status:
        responseSummary.validation_signals.length > 0 || responseSummary.success_signals.length > 0
          ? "met"
          : "not_sure"
    }
  ]
}

function sanitizeChecklist(
  result: AfterAnalysisResult,
  target: ReviewTarget,
  responseSummary: ResponsePreprocessorOutput,
  normalizedGoal: string
) {
  const rawPrompt = target.attempt.raw_prompt || target.attempt.optimized_prompt || target.attempt.intent.goal || ""
  const meaningfulRaw = result.acceptance_checklist
    .map((item) => ({
      label: normalizeSentence(item.label),
      status: item.status
    }))
    .filter((item) => item.label && !isGenericChecklistLabel(item.label, normalizedGoal, rawPrompt))

  if (meaningfulRaw.length) return meaningfulRaw.slice(0, 6)

  return buildFallbackStructuredChecklist(target, responseSummary, normalizedGoal).slice(0, 6)
}

function buildEvidencePool(result: AfterAnalysisResult, responseSummary: ResponsePreprocessorOutput) {
  return Array.from(
    new Set(
      [
        ...result.stage_1.claimed_evidence,
        ...responseSummary.change_claims,
        ...responseSummary.validation_signals,
        ...responseSummary.success_signals,
        ...responseSummary.key_paragraphs
      ]
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ).slice(0, 10)
}

function evidenceMatchesChecklist(label: string, evidence: string) {
  const labelTokens = extractMeaningfulTokens(label)
  const evidenceText = normalize(evidence)

  if (/extension loads/i.test(label)) return /\bextension\b.*\b(load|install|running)\b/i.test(evidence)
  if (/content script attaches/i.test(label)) return /\bcontent script\b.*\b(attached|attach|running|loaded|mounted)\b/i.test(evidence)
  if (/dom selector works/i.test(label)) return /\b(selector|textarea|prompt input|target input)\b.*\b(found|detect|match|resolve)\b/i.test(evidence)
  if (/renders in the dom/i.test(label)) return /\b(icon|button|launcher)\b.*\b(render|insert|mount|dom)\b/i.test(evidence)
  if (/visible in the ui/i.test(label)) return /\b(icon|button|launcher)\b.*\b(visible|showing|appears|displayed)\b/i.test(evidence)

  const overlap = labelTokens.filter((token) => evidenceText.includes(token))
  return overlap.length >= Math.min(2, labelTokens.length)
}

function mapEvidenceToChecklist(checklist: AfterAnalysisResult["acceptance_checklist"], evidencePool: string[]) {
  return checklist.map((item) => {
    const matches = evidencePool.filter((evidence) => evidenceMatchesChecklist(item.label, evidence)).slice(0, 1)
    return {
      item,
      evidence: matches
    }
  })
}

function deriveDeepStatusFromChecklist(
  checklist: AfterAnalysisResult["acceptance_checklist"],
  problemFit: AfterAnalysisResult["stage_2"]["problem_fit"]
) {
  const metCount = checklist.filter((item) => item.status === "met").length
  const missedCount = checklist.filter((item) => item.status === "missed").length
  const unresolvedCount = checklist.length - metCount

  if (problemFit === "wrong_direction") {
    return {
      status: "WRONG_DIRECTION" as const,
      confidence: "low" as const,
      promptStrategy: "retry_cleanly" as const
    }
  }

  if (unresolvedCount === 0) {
    return {
      status: "SUCCESS" as const,
      confidence: "high" as const,
      promptStrategy: "validate" as const
    }
  }

  if (missedCount > 0 && metCount === 0) {
    return {
      status: "FAILED" as const,
      confidence: "low" as const,
      promptStrategy: "fix_missing" as const
    }
  }

  return {
    status: "PARTIAL" as const,
    confidence: missedCount > 1 ? ("low" as const) : ("medium" as const),
    promptStrategy: "fix_missing" as const
  }
}

function buildChecklistDerivedPrompt(input: {
  normalizedGoal: string
  unresolvedLabels: string[]
  status: AfterAnalysisResult["status"]
  taskType: ReviewTarget["taskType"]
}) {
  const { normalizedGoal, unresolvedLabels, status, taskType } = input
  const promptArtifactReview = unresolvedLabels.some((label) =>
    PROMPT_ARTIFACT_CHECKLIST_LABELS.includes(label as (typeof PROMPT_ARTIFACT_CHECKLIST_LABELS)[number])
  )

  if (!unresolvedLabels.length) {
    return `No retry needed. The visible checklist is fully confirmed for this goal: ${normalizedGoal}.`
  }

  if (promptArtifactReview) {
    return [
      `Rewrite the generated prompt so it fixes only these gaps: ${unresolvedLabels.join("; ")}.`,
      "Keep the original goal intact, preserve the important constraints, and return a clearer send-ready prompt."
    ].join("\n")
  }

  if (taskType === "debug") {
    return [
      "Do not assume the previous fix worked.",
      "Confirm the single most likely runtime gap first, then run one minimal diagnostic step.",
      `Check: ${unresolvedLabels[0]}.`,
      "Report what is confirmed and what is still unverified."
    ].join("\n")
  }

  if (taskType === "verification") {
    return [
      `Verify only these unresolved points: ${unresolvedLabels.join("; ")}.`,
      "For each one, show the exact proof or say plainly that it is still unproven."
    ].join("\n")
  }

  const primaryGap = unresolvedLabels[0]
  const remaining = unresolvedLabels.slice(1, 3)

  if (status === "WRONG_DIRECTION") {
    return [
      `The answer drifted away from the real target: ${normalizedGoal}.`,
      `Replace it with the minimum concrete fix for: ${primaryGap}.`,
      "Explain how the change solves the issue and show one clear proof the result works."
    ].join("\n")
  }

  return [
    `Fix only what is still missing: ${primaryGap}.`,
    remaining.length ? `Then cover: ${remaining.join("; ")}.` : "",
    "Show the exact change, explain how it solves the issue, and provide one clear proof the result works."
  ]
    .filter(Boolean)
    .join("\n")
}

function buildGroundedDeepResult(
  result: AfterAnalysisResult,
  target: ReviewTarget,
  responseSummary: ResponsePreprocessorOutput
): AfterAnalysisResult {
  const normalizedGoal = buildNormalizedGoal(target, responseSummary)
  const sanitizedChecklist = sanitizeChecklist(result, target, responseSummary, normalizedGoal)

  if (!sanitizedChecklist.length) {
    throw new Error("Deep review could not be grounded safely.")
  }

  const evidencePool = buildEvidencePool(result, responseSummary)
  const mappedChecklist = mapEvidenceToChecklist(sanitizedChecklist, evidencePool).map(({ item, evidence }) => ({
    ...item,
    status: item.status === "met" && evidence.length === 0 ? "not_sure" : item.status
  }))
  const proofLinks = mapEvidenceToChecklist(mappedChecklist, evidencePool)
  const checkedArtifacts = proofLinks
    .filter((entry) => entry.item.status === "met" && entry.evidence.length)
    .map((entry) => `${entry.item.label}: ${entry.evidence[0]}`)
    .slice(0, 4)
  const unresolvedLabels = mappedChecklist
    .filter((item) => item.status !== "met")
    .map((item) => item.label)
  const proofBackedMissing = unresolvedLabels.map((label) => label)
  const derived = deriveDeepStatusFromChecklist(mappedChecklist, result.stage_2.problem_fit)
  const promptStrategy =
    target.taskType === "debug" && derived.status === "PARTIAL" ? "narrow_scope" : derived.promptStrategy
  const normalizedGoalNote =
    isWeakGoal(target.attempt.intent.goal || "") || isWeakGoal(target.attempt.raw_prompt || "")
      ? [`Deep review normalized the goal to: ${normalizedGoal}.`]
      : []
  const confidenceReason =
    derived.status === "SUCCESS"
      ? `The full checklist is confirmed for this goal: ${normalizedGoal}.`
      : derived.status === "WRONG_DIRECTION"
        ? `The answer does not stay on the normalized goal: ${normalizedGoal}.`
        : `Only ${mappedChecklist.filter((item) => item.status === "met").length} of ${mappedChecklist.length} checklist items are confirmed for this goal: ${normalizedGoal}.`
  const groundedFindings =
    derived.status === "WRONG_DIRECTION"
      ? [
          `The answer drifted away from the normalized goal: ${normalizedGoal}.`,
          unresolvedLabels[0] ? `${unresolvedLabels[0]} is still unresolved.` : "",
          "The current answer should be replaced with a narrower, goal-matching fix."
        ]
      : derived.status === "FAILED"
        ? [
            unresolvedLabels[0] ? `${unresolvedLabels[0]} is still missing.` : "",
            unresolvedLabels[1] ? `${unresolvedLabels[1]} is also still missing.` : "",
            "The answer does not yet show enough proof to trust the result."
          ]
        : derived.status === "PARTIAL"
          ? [
              "The answer makes progress, but the result is not proven yet.",
              unresolvedLabels[0] ? `${unresolvedLabels[0]} is still unresolved.` : "",
              checkedArtifacts[0]
                ? `One supported point was shown: ${checkedArtifacts[0]}.`
                : "No strong proof was shown for the unresolved parts."
            ]
          : [
              `The answer stays on the normalized goal: ${normalizedGoal}.`,
              checkedArtifacts[0] ? `The strongest visible proof was: ${checkedArtifacts[0]}.` : "",
              "The checklist is fully confirmed."
            ]
  const groundedAnalysisNotes =
    proofLinks
      .filter((entry) => entry.item.status === "met" && entry.evidence.length)
      .map((entry) => `"${entry.item.label}" is supported by: ${entry.evidence[0]}.`)
      .slice(0, 2)
  const nextPrompt = buildChecklistDerivedPrompt({
    normalizedGoal,
    unresolvedLabels,
    status: derived.status,
    taskType: target.taskType
  })

  return {
    ...result,
    status: derived.status,
    confidence: derived.confidence,
    confidence_reason: confidenceReason,
    findings: [...normalizedGoalNote, ...groundedFindings].filter(Boolean).slice(0, 3),
    issues: proofBackedMissing.slice(0, 6),
    next_prompt: nextPrompt,
    prompt_strategy: promptStrategy,
    stage_1: {
      ...result.stage_1,
      claimed_evidence: checkedArtifacts,
      assistant_action_summary: normalizeSentence(`${result.stage_1.assistant_action_summary} Goal under review: ${normalizedGoal}.`)
    },
    stage_2: {
      ...result.stage_2,
      addressed_criteria: mappedChecklist.filter((item) => item.status === "met").map((item) => item.label),
      missing_criteria: proofBackedMissing.slice(0, 6),
      analysis_notes: [...normalizedGoalNote, ...groundedAnalysisNotes].filter(Boolean).slice(0, 4),
      problem_fit: derived.status === "WRONG_DIRECTION" ? "wrong_direction" : unresolvedLabels.length ? "partial" : "correct"
    },
    verdict: {
      ...result.verdict,
      status: derived.status,
      confidence: derived.confidence,
      confidence_reason: confidenceReason,
      findings: [...normalizedGoalNote, ...groundedFindings].filter(Boolean).slice(0, 3),
      issues: proofBackedMissing.slice(0, 6)
    },
    next_prompt_output: {
      next_prompt: nextPrompt,
      prompt_strategy: promptStrategy
    },
    acceptance_checklist: mappedChecklist
  }
}

function containsAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text))
}

function buildExtensionRuntimeSignals(promptText: string, responseText: string) {
  const normalizedPrompt = normalize(promptText)
  const normalizedResponse = responseText
  const promptLooksLikeExtensionDebug =
    /\b(extension|content script|replit|icon|launcher|textarea|prompt area|dom|selector|visible)\b/i.test(promptText)

  if (!promptLooksLikeExtensionDebug) return null

  const signals: RuntimeSignal[] = [
    {
      label: "Extension loads",
      patterns: [/\bextension\b.*\b(load(ed)?|install(ed)?|running)\b/i, /\bloaded extension\b/i],
      verified: false
    },
    {
      label: "Content script attaches",
      patterns: [/\bcontent script\b.*\b(attached|attach(es|ed)?|running|loaded|mounted)\b/i],
      verified: false
    },
    {
      label: "DOM selector works",
      patterns: [/\b(selector|textarea|prompt input|target input)\b.*\b(found|detect(ed)?|matched|resolv(ed|es))\b/i],
      verified: false
    },
    {
      label: "Icon renders in the DOM",
      patterns: [/\b(icon|button|launcher)\b.*\b(render(ed|s)?|insert(ed|s)?|mount(ed|s)?|in the dom)\b/i],
      verified: false
    },
    {
      label: "Icon is visible in the UI",
      patterns: [/\b(icon|button|launcher)\b.*\b(visible|showing|appears|displayed)\b/i],
      verified: false
    }
  ]

  return signals.map((signal) => ({
    ...signal,
    verified: containsAny(normalizedResponse, signal.patterns)
  }))
}

function buildGenericDebugChecklist(responseText: string) {
  const runtimeConfirmed = /\b(runtime|live|browser|ui)\b.*\b(verified|confirmed|checked)\b/i.test(responseText)
  const failurePointFound = /\b(root cause|failure point|likely cause|selector|attachment|mount)\b/i.test(responseText)
  const diagnosticStepNamed = /\b(log|console|inspect|check|confirm|verify)\b/i.test(responseText)

  return [
    {
      label: "Current runtime state is confirmed",
      status: runtimeConfirmed ? "met" : "not_sure"
    },
    {
      label: "Most likely failure point is identified",
      status: failurePointFound ? "met" : "not_sure"
    },
    {
      label: "One minimal diagnostic step is proposed before more changes",
      status: diagnosticStepNamed ? "met" : "not_sure"
    }
  ] satisfies AfterAnalysisResult["acceptance_checklist"]
}

function isDebugContinuation(
  result: AfterAnalysisResult,
  responseSummary: ResponsePreprocessorOutput,
  target: ReviewTarget,
  mode: "quick" | "deep"
) {
  if (target.taskType !== "debug") return false

  const unresolved =
    (result.status !== "SUCCESS" && result.status !== "LIKELY_SUCCESS") ||
    result.stage_2.problem_fit !== "correct" ||
    result.acceptance_checklist.some((item) => item.status !== "met")

  const promptStillOpen = /\bstill\b|\bnot visible\b|\bnot showing\b|\bnot working\b|\bdoesn'?t\b|\bfailing\b/i.test(
    target.attempt.raw_prompt || target.attempt.optimized_prompt || target.attempt.intent.goal || ""
  )
  const codeChanged =
    responseSummary.change_claims.length > 0 ||
    responseSummary.mentioned_files.length > 0 ||
    responseSummary.has_code_blocks
  const runtimeSignals = buildExtensionRuntimeSignals(
    target.attempt.raw_prompt || target.attempt.optimized_prompt || target.attempt.intent.goal || "",
    target.responseText
  )
  const runtimeVerified = runtimeSignals?.some((signal) => signal.verified) ?? /\b(runtime|live|browser|ui)\b.*\b(verified|confirmed|works)\b/i.test(target.responseText)
  const runtimeStillOpen = runtimeSignals?.some((signal) => !signal.verified) ?? !runtimeVerified

  if (mode === "quick") {
    return promptStillOpen && (codeChanged || runtimeStillOpen)
  }

  return unresolved && (promptStillOpen || codeChanged || !runtimeVerified)
}

function buildDebugContinuationResult(
  result: AfterAnalysisResult,
  target: ReviewTarget,
  responseSummary: ResponsePreprocessorOutput,
  mode: "quick" | "deep"
): AfterAnalysisResult {
  const promptText = target.attempt.raw_prompt || target.attempt.optimized_prompt || target.attempt.intent.goal || ""
  const runtimeSignals = buildExtensionRuntimeSignals(promptText, target.responseText)
  const checklist =
    runtimeSignals?.map((signal) => ({
      label: signal.label,
      status: signal.verified ? "met" : "not_sure"
    })) ?? buildGenericDebugChecklist(target.responseText)

  const missingRuntime = checklist.filter((item) => item.status !== "met").map((item) => `${item.label} is still unverified.`)
  const codeEvidence = [...responseSummary.change_claims, ...responseSummary.mentioned_files].filter(Boolean).slice(0, 4)

  const findings = [
    "The assistant applied a fix without verifying runtime behavior.",
    "There is no confirmation loop showing whether the issue was actually resolved.",
    "The root cause still appears hypothesized rather than proven."
  ]

  const nextPrompt =
    mode === "quick"
      ? [
          "Do one lightweight diagnostic check before changing more code.",
          "",
          "Confirm the current runtime state for these points:",
          ...checklist.map((item, index) => `${index + 1}. ${item.label}`),
          "",
          "Then name the single most likely failure point in the previous fix and run one minimal diagnostic check first.",
          "Say what is confirmed and what is still unverified."
        ].join("\n")
      : [
          "Do not assume the previous fix worked yet.",
          "",
          "First confirm the current runtime state for these points:",
          ...checklist.map((item, index) => `${index + 1}. ${item.label}`),
          "",
          "Then identify the single most likely failure point in the previous fix and run one minimal diagnostic step before changing more code.",
          "If any point is still unverified, say that plainly."
        ].join("\n")

  return {
    ...result,
    status: "PARTIAL",
    confidence: mode === "deep" ? "low" : "medium",
    confidence_reason: "The code may have changed, but runtime behavior is still not verified.",
    findings,
    issues: missingRuntime.length ? missingRuntime.slice(0, 5) : result.issues,
    next_prompt: nextPrompt,
    prompt_strategy: "narrow_scope",
    stage_1: {
      ...result.stage_1,
      claimed_evidence: codeEvidence.length ? codeEvidence : result.stage_1.claimed_evidence,
      response_mode: "implemented"
    },
    stage_2: {
      ...result.stage_2,
      missing_criteria: missingRuntime.length ? missingRuntime : result.stage_2.missing_criteria,
      analysis_notes: findings,
      addressed_criteria: checklist.filter((item) => item.status === "met").map((item) => item.label),
      problem_fit: "partial"
    },
    verdict: {
      ...result.verdict,
      status: "PARTIAL",
      confidence: mode === "deep" ? "low" : "medium",
      confidence_reason: "The fix is not runtime-verified yet.",
      findings,
      issues: missingRuntime.length ? missingRuntime.slice(0, 5) : result.verdict.issues
    },
    next_prompt_output: {
      next_prompt: nextPrompt,
      prompt_strategy: "narrow_scope"
    },
    acceptance_checklist: checklist
  }
}

function buildInformationalReviewResult(input: {
  target: ReviewTarget
  mode: "quick" | "deep"
  responseSummary: ResponsePreprocessorOutput
}): AfterAnalysisResult {
  const { target, mode, responseSummary } = input
  const isPromptArtifact = isStructuredPromptArtifactText(target.responseText)
  const isCreation = target.taskType === "creation"
  const isWriting = target.taskType === "writing"
  const isInstructional = target.taskType === "instructional"
  const isAdvice = target.taskType === "advice"
  const isIdeation = target.taskType === "ideation"
  const promptText = target.attempt.optimized_prompt || target.attempt.raw_prompt || target.attempt.intent.goal || ""
  const normalizedResponse = normalize(target.responseText)
  const promptArtifactSignals = isPromptArtifact
    ? buildPromptArtifactChecklist({
        promptText,
        responseText: target.responseText,
        responseSummary
      })
    : null
  const promptKeywords = extractPromptKeywords(promptText)
  const keywordMatches = promptKeywords.filter((keyword) => normalizedResponse.includes(keyword)).length
  const structuredSteps = countStructuredSteps(target.responseText)
  const ideaCount = countListStyleIdeas(target.responseText)
  const directAnswer = isPromptArtifact
    ? promptArtifactSignals?.goalMatched ?? false
    : target.responseText.trim().length >= 80 && (keywordMatches >= 1 || promptKeywords.length === 0)
  const creationMatchesFormat = isCreation
    ? matchesCreationFormatAndScope({
        promptText,
        responseText: target.responseText,
        responseSummary
      })
    : false
  const clearEnough = isPromptArtifact
    ? promptArtifactSignals?.structured ?? false
    : isInstructional
    ? structuredSteps >= 2 || responseSummary.response_length >= 180
    : isAdvice || isIdeation
      ? ideaCount >= 3 || responseSummary.response_length >= 160
      : isCreation
        ? creationMatchesFormat
        : isWriting
          ? responseSummary.response_length >= 80
      : responseSummary.response_length >= 120
  const completeEnough =
    isPromptArtifact
      ? promptArtifactSignals?.sendReady ?? false
      : isInstructional
      ? structuredSteps >= 3 || responseSummary.response_length >= 260
      : isAdvice || isIdeation
        ? (ideaCount >= 4 && responseSummary.response_length >= 220) || responseSummary.key_paragraphs.length >= 2
        : isCreation
          ? responseSummary.has_code_blocks || responseSummary.mentioned_files.length >= 1 || responseSummary.response_length >= 260
          : isWriting
            ? responseSummary.response_length >= 120 && responseSummary.key_paragraphs.length >= 1
        : responseSummary.response_length >= 180 && responseSummary.key_paragraphs.length >= 1
  const uncertaintyHeavy = responseSummary.uncertainty_signals.length >= 3
  const missingItems: string[] = []

  if (!directAnswer) {
    missingItems.push(
      isPromptArtifact
        ? "The generated prompt should preserve the user's core goal more clearly."
        : isCreation
        ? "The answer should directly provide the requested deliverable."
        : isWriting
          ? "The answer should directly provide the requested rewritten text."
        :
      isInstructional
        ? "The answer should directly address the requested instructions."
        : isAdvice || isIdeation
          ? "The answer should directly address the requested ideas or recommendations."
          : "The answer should address the question more directly."
    )
  }
  if (!clearEnough) {
    missingItems.push(
      isPromptArtifact
        ? "The generated prompt should use a clearer structured format with labeled sections."
        : isCreation
        ? "The generated output should be clearer, more usable, and closer to the requested format."
        : isWriting
          ? "The rewrite should read more clearly and match the requested tone."
        :
      isInstructional
        ? "The steps should be clearer and easier to follow."
        : isAdvice || isIdeation
          ? "The ideas should be clearer, easier to scan, and easier to choose from."
          : "The explanation should be clearer and easier to follow."
    )
  }
  if (!completeEnough) {
    missingItems.push(
      isPromptArtifact
        ? "The generated prompt should be usable as a send-ready prompt without important gaps."
        : isCreation
        ? "The generated deliverable is missing important requested parts."
        : isWriting
          ? "The rewrite is missing polish, completeness, or the requested tone shift."
        :
      isInstructional
        ? "The answer is missing steps or practical detail."
        : isAdvice || isIdeation
          ? "The answer needs more variety, practicality, or useful detail."
          : "The explanation needs more completeness or context."
    )
  }
  if (isPromptArtifact && promptArtifactSignals) {
    const unresolvedConstraints =
      promptArtifactSignals.extractedConstraints.length === 0
        ? []
        : promptArtifactSignals.extractedConstraints.filter(
            (constraint) => !promptArtifactSignals.preservedConstraints.includes(constraint)
          )

    if (unresolvedConstraints.length) {
      missingItems.push(`The generated prompt is missing or weak on these constraints: ${unresolvedConstraints.join("; ")}.`)
    }
  }
  if (uncertaintyHeavy) {
    missingItems.push("The answer uses too much uncertainty for a dependable guide.")
  }

  const success = missingItems.length === 0
  const confidence: AfterAnalysisResult["confidence"] = success
    ? mode === "deep"
      ? "high"
      : "medium"
    : missingItems.length >= 3
      ? "low"
      : "medium"
  const status: AfterAnalysisResult["status"] = success ? "SUCCESS" : "PARTIAL"

  const checklist = isPromptArtifact && promptArtifactSignals
    ? promptArtifactSignals.checklist
    : [
    {
      label: isCreation
        ? "The answer provides the requested deliverable"
        : isWriting
          ? "The answer provides the requested rewrite"
          : isInstructional
            ? "The answer directly gives the requested instructions"
            : isAdvice || isIdeation
              ? "The answer directly gives relevant ideas for the request"
              : "The answer directly addresses the requested explanation",
      status: directAnswer ? "met" : "missed"
    },
    {
      label: isCreation
        ? "The output matches the requested format and scope"
        : isWriting
          ? "The rewrite matches the requested tone and clarity"
          : isInstructional
            ? "The steps are clear enough to follow"
            : isAdvice || isIdeation
              ? "The ideas are clear and easy to use"
              : "The explanation is clear enough to follow",
      status: clearEnough ? "met" : "not_sure"
    },
    {
      label: isCreation
        ? "The deliverable is complete enough to use as a starting point"
        : isWriting
          ? "The rewritten text is polished enough to use"
          : isInstructional
            ? "The answer is complete enough to use"
            : isAdvice || isIdeation
              ? "The answer offers enough practical variety to use"
              : "The explanation is complete enough to use",
      status: completeEnough && !uncertaintyHeavy ? "met" : missingItems.length ? "not_sure" : "met"
    }
  ] satisfies AfterAnalysisResult["acceptance_checklist"]

  const findings = success
    ? [
        isPromptArtifact
          ? "The generated prompt keeps the original goal and reads like a usable execution brief."
          : isCreation
          ? "The answer directly provides the requested deliverable."
          : isWriting
            ? "The answer directly provides a usable rewrite."
          :
        isInstructional
          ? "The answer directly provides a usable step-by-step guide."
          : isAdvice
            ? "The answer directly provides usable recommendations for the request."
            : isIdeation
              ? "The answer provides a usable set of ideas to choose from."
          : "The answer directly explains the requested topic in a usable way.",
        mode === "deep"
          ? "Deep review checked the answer for missing steps, ambiguity, and major omissions."
          : "Quick review checked whether the answer was direct, clear, and reasonably complete."
      ]
    : [
        ...(directAnswer ? [] : [isPromptArtifact ? "The generated prompt does not clearly preserve the original goal yet." : "The answer does not fully answer the original question yet."]),
        ...(clearEnough
          ? []
          : [
              isPromptArtifact
                ? "The generated prompt still needs a clearer structure before it is ready to send."
                : isCreation
                ? "The generated output does not clearly match the requested format or scope yet."
                : isWriting
                  ? "The rewrite still does not clearly match the requested tone or polish."
                  : isInstructional
                    ? "The steps are not yet clear enough to follow confidently."
                    : "The explanation is still unclear in important places."
            ]),
        ...(completeEnough
          ? []
          : [
              isPromptArtifact
                ? "The generated prompt is not fully send-ready yet."
                : isCreation
                ? "Important requested parts of the deliverable are still missing."
                : isWriting
                  ? "The rewrite still needs more completeness or polish."
                  : isInstructional
                    ? "Some important steps or details are still missing."
                    : "Some important context or completeness is still missing."
            ])
      ].slice(0, 3)

  const issues = success ? [] : missingItems.slice(0, 4)
  const stage1: Stage1Output = {
    assistant_action_summary: isPromptArtifact
      ? "Provided a structured prompt artifact for the user's request."
      : isCreation
      ? "Provided a generated deliverable for the request."
      : isWriting
        ? "Provided a rewritten version of the text."
        : isInstructional
          ? "Provided step-by-step guidance."
          : isAdvice
            ? "Provided advice-oriented suggestions."
            : isIdeation
              ? "Provided a set of ideas for the request."
              : "Provided an explanatory answer to the user's question.",
    claimed_evidence: success
      ? [
          directAnswer ? (isPromptArtifact ? "The generated prompt preserves the user’s core goal." : "The answer directly addressed the question.") : "",
          clearEnough
            ? isPromptArtifact
              ? "The generated prompt uses a clear structured format."
              : isCreation
              ? "The output matches the requested format closely enough to inspect."
              : isWriting
                ? "The rewrite reads clearly and reflects the requested tone shift."
              : isInstructional
              ? "The answer used a structured set of steps."
              : isAdvice || isIdeation
                ? "The answer presented clear, scannable ideas."
                : "The explanation was presented clearly enough to follow."
            : "",
          completeEnough
            ? isPromptArtifact
              ? "The generated prompt is polished enough to send as-is."
              : isCreation
              ? "The deliverable includes the main requested parts without obvious gaps."
              : isWriting
                ? "The rewritten text is complete enough to use directly."
              : isAdvice || isIdeation
              ? "The answer covered enough practical options without obvious gaps."
              : "The answer covered the main practical details without obvious gaps."
            : ""
        ].filter(Boolean)
      : [],
    response_mode: "explained",
    scope_assessment: "narrow"
  }

  const stage2: Stage2Output = {
    addressed_criteria: checklist.filter((item) => item.status === "met").map((item) => item.label),
    missing_criteria: missingItems,
    constraint_risks: uncertaintyHeavy ? ["The answer still contains ambiguity that could confuse the next step."] : [],
    problem_fit: success ? "correct" : "partial",
    analysis_notes: success
      ? [
          isPromptArtifact
            ? "This was reviewed as a generated prompt artifact, not as a proof-of-fix task."
            : isCreation
            ? "This was reviewed as a generated deliverable, not as a proof-of-fix task."
            : isWriting
              ? "This was reviewed as a rewrite/quality task, not as a proof-of-fix task."
            :
          isInstructional
            ? "This was reviewed as an instructions/usability task, not as an implementation proof task."
            : isAdvice
              ? "This was reviewed as an advice/usability task, not as an implementation proof task."
              : isIdeation
                ? "This was reviewed as an ideation/usability task, not as an implementation proof task."
            : "This was reviewed as an explanation/usability task, not as an implementation proof task."
        ]
      : [
          isPromptArtifact
            ? "The generated prompt should be judged on goal preservation, constraint coverage, structure, and send-ready quality."
            : isCreation
            ? "The answer should be judged on relevance, completeness, and usability of the generated output, not on proof artifacts."
            : isWriting
              ? "The answer should be judged on rewrite quality and tone fit, not on implementation artifacts."
            :
          isInstructional
            ? "The answer should be judged on usability and completeness, not on implementation artifacts."
            : isAdvice
              ? "The answer should be judged on relevance, practicality, and completeness, not on implementation artifacts."
              : isIdeation
                ? "The answer should be judged on idea quality and usefulness, not on implementation artifacts."
            : "The answer should be judged on clarity and completeness, not on implementation artifacts."
        ]
  }

  const verdict: VerdictOutput = {
    status,
    confidence,
    confidence_reason: success
      ? mode === "deep"
        ? isPromptArtifact
          ? "The generated prompt preserves the goal, keeps the important constraints, and is ready to send."
          : "The answer is clear, complete enough, and does not show major omissions."
        : isPromptArtifact
          ? "The generated prompt looks usable and on target."
          : "The answer appears direct and usable for the question that was asked."
      : missingItems[0] || "The answer is not complete enough yet.",
    findings,
    issues
  }

  const followUpPrompt = success
    ? "No retry needed. The answer already addresses the question clearly enough."
    : isPromptArtifact
      ? `Rewrite the generated prompt, but fix only these gaps:\n${missingItems.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
      : isCreation
      ? `Generate this again, but fix only these gaps:\n${missingItems.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
      : isWriting
        ? `Rewrite this again, but fix only these gaps:\n${missingItems.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
    : isInstructional
      ? `Answer this again as a concise step-by-step guide. Fix these gaps only:\n${missingItems.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
      : isAdvice || isIdeation
        ? `Answer this again with more useful, practical suggestions. Fix these gaps only:\n${missingItems.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
      : `Answer this again more clearly and completely. Fix these gaps only:\n${missingItems.map((item, index) => `${index + 1}. ${item}`).join("\n")}`

  return {
    status,
    confidence,
    confidence_reason: verdict.confidence_reason,
    inspection_depth: mode === "deep" ? "targeted_text" : "summary_only",
    findings,
    issues,
    next_prompt: followUpPrompt,
    prompt_strategy: success ? "validate" : "retry_cleanly",
    stage_1: stage1,
    stage_2: stage2,
    verdict,
    next_prompt_output: {
      next_prompt: followUpPrompt,
      prompt_strategy: success ? "validate" : "retry_cleanly"
    },
    acceptance_checklist: checklist,
    response_summary: responseSummary,
    used_fallback_intent: false,
    token_usage_total: 0
  }
}

export function buildReviewTargetKey(target: ReviewTarget) {
  return [
    target.threadIdentity,
    target.attempt.attempt_id,
    target.responseIdentity || "no-response-id",
    target.normalizedResponseText
  ].join("::")
}

export function buildUserSafeReviewErrorMessage(
  reason: "no_response" | "no_submitted_attempt" | "still_updating" | "request_failed" | "unknown"
) {
  switch (reason) {
    case "no_response":
      return "Send a prompt first, then open Review to inspect the assistant's reply."
    case "no_submitted_attempt":
      return "We couldn't match the latest reply to a sent prompt yet. Try again once the thread settles."
    case "still_updating":
      return "The response is still updating. Try again once it settles."
    case "request_failed":
      return "We couldn’t complete the review this time."
    default:
      return "We couldn’t prepare the review right now."
  }
}

export function createReviewAnalysisRunner(input: CreateReviewAnalysisRunnerInput): ReviewAnalysisRunner {
  return async function runReviewAnalysis({ target, mode }) {
    const projectMemory = input.getProjectMemoryContext()
    const responseSummary = input.preprocessResponse(target.responseText) as ResponsePreprocessorOutput
    const changedFiles = input.collectChangedFilesSummary()
    const promptArtifactReview =
      target.taskType !== "debug" &&
      target.taskType !== "verification" &&
      isStructuredPromptArtifactText(target.responseText)

    if (promptArtifactReview || isAnswerQualityTask(target.taskType)) {
      const informationalResult = buildInformationalReviewResult({
        target,
        mode,
        responseSummary
      })

      await input.attachAnalysisResult(
        target.attempt.attempt_id,
        target.responseText,
        informationalResult,
        target.responseIdentity
      )

      return informationalResult
    }

    const rawResult = await input.analyzeAfterAttempt({
      attempt: target.attempt,
      response_summary: responseSummary,
      response_text_fallback: target.responseText,
      deep_analysis: mode === "deep",
      project_context: projectMemory.projectContext,
      current_state: projectMemory.currentState,
      error_summary: input.collectVisibleErrorSummary(),
      changed_file_paths_summary: changedFiles
    })

    const intermediateResult = isDebugContinuation(rawResult, responseSummary, target, mode)
      ? buildDebugContinuationResult(rawResult, target, responseSummary, mode)
      : rawResult
    const result =
      mode === "deep"
        ? buildGroundedDeepResult(intermediateResult, target, responseSummary)
        : intermediateResult

    await input.attachAnalysisResult(
      target.attempt.attempt_id,
      target.responseText,
      result,
      target.responseIdentity
    )

    return result
  }
}
