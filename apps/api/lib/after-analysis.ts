import {
  AfterPipelineResponseSchema,
  IntentExtractionOutputSchema,
  NextPromptOutputSchema,
  Stage1OutputSchema,
  Stage2OutputSchema,
  VerdictOutputSchema,
  type AfterPipelineRequest,
  type AttemptIntent
} from "@prompt-optimizer/shared"
import { buildResponseExcerpts, compressGoal } from "@prompt-optimizer/shared"
import * as z from "zod"
import { trimForBudget } from "./cost-control"
import { callDeepSeekJson } from "./deepseek"
import { callKimiJson } from "./kimi"

const AFTER_STAGE_SOFT_DEADLINE_MS = 8000
const AFTER_DEEP_STAGE_SOFT_DEADLINE_MS = 16000
const EVIDENCE_EXCERPT_LIMIT = 320

const EvidenceTargetingSchema = z.object({
  selected_candidate_ids: z.array(z.string()).max(4).default([]),
  risk_flags: z.array(z.string()).max(4).default([]),
  inspection_goal: z.string().max(180).default("")
})

const DetailInspectionSchema = z.object({
  supported_claims: z.array(z.string()).max(4).default([]),
  contradictions: z.array(z.string()).max(4).default([]),
  unresolved_risks: z.array(z.string()).max(4).default([]),
  evidence_strength: z.enum(["weak", "moderate", "strong"]).default("weak"),
  inspection_depth: z.enum(["summary_only", "targeted_text", "targeted_code"]).default("summary_only")
})

type EvidenceCandidate = {
  id: string
  type: "code" | "claim" | "file" | "constraint" | "paragraph"
  label: string
  excerpt: string
}

function dedupe(items: string[], limit = 6) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, limit)
}

function conciseGoal(goal: string, limit = 140) {
  const trimmed = goal.trim()
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit - 1).trimEnd()}…`
}

function limitText(value: string, limit: number) {
  if (value.length <= limit) return value
  return `${value.slice(0, limit - 1).trimEnd()}…`
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "your",
  "have",
  "will",
  "into",
  "about",
  "after",
  "before",
  "then",
  "when",
  "what",
  "where",
  "which",
  "they",
  "them",
  "their",
  "because",
  "should",
  "could",
  "would",
  "there",
  "please",
  "just",
  "only",
  "keep",
  "focus",
  "tell",
  "exactly"
])

function extractMeaningfulTokens(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token))
}

function hasGoalEvidence(goal: string, responseSummary: AfterPipelineRequest["response_summary"]) {
  const goalTokens = extractMeaningfulTokens(goal)
  if (!goalTokens.length) return true

  const haystack = [
    responseSummary.first_excerpt,
    responseSummary.last_excerpt,
    ...responseSummary.key_paragraphs,
    ...responseSummary.mentioned_files
  ]
    .join(" ")
    .toLowerCase()

  const matched = goalTokens.filter((token) => haystack.includes(token))
  return matched.length >= Math.min(2, goalTokens.length)
}

function responseFocusSnippet(responseSummary: AfterPipelineRequest["response_summary"]) {
  const snippet = responseSummary.key_paragraphs[0] || responseSummary.first_excerpt || responseSummary.last_excerpt
  return conciseGoal(snippet || "the visible answer")
}

function summarizeVisibleAnswer(responseSummary: AfterPipelineRequest["response_summary"]) {
  const snippet = responseFocusSnippet(responseSummary)
  const compact = snippet.replace(/\s+/g, " ").trim()
  if (!compact) return "The answer stayed on the visible topic."

  const sentenceLike = /[.!?]/.test(compact)
  if (sentenceLike || compact.length > 90) return compact

  return `The answer appears focused on: ${compact}`
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function extractCodeBlocks(rawResponse: string) {
  const matches = [...rawResponse.matchAll(/```[\s\S]*?```/g)]
  return matches
    .map((match) => normalizeWhitespace(match[0]))
    .filter(Boolean)
    .map((block) => limitText(block, EVIDENCE_EXCERPT_LIMIT))
}

function extractParagraphs(rawResponse: string) {
  return rawResponse
    .split(/\n{2,}/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean)
}

function extractClaimSentences(rawResponse: string) {
  return rawResponse
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normalizeWhitespace(sentence))
    .filter((sentence) => /\b(i fixed|i updated|i changed|this should|this now|i implemented|the issue was|i added|i removed)\b/i.test(sentence))
}

function candidateMatchesIntent(candidate: string, intent: AttemptIntent) {
  const haystack = candidate.toLowerCase()
  const goalTokens = extractMeaningfulTokens(intent.goal).slice(0, 6)
  const constraintTokens = intent.constraints.flatMap((item) => extractMeaningfulTokens(item)).slice(0, 6)
  const criteriaTokens = intent.acceptance_criteria.flatMap((item) => extractMeaningfulTokens(item)).slice(0, 8)
  return [...goalTokens, ...constraintTokens, ...criteriaTokens].some((token) => haystack.includes(token))
}

function buildEvidenceCandidates(
  rawResponse: string,
  intent: AttemptIntent,
  responseSummary: AfterPipelineRequest["response_summary"]
) {
  const candidates: EvidenceCandidate[] = []
  const seen = new Set<string>()

  const addCandidate = (candidate: EvidenceCandidate) => {
    const key = `${candidate.type}:${candidate.excerpt}`
    if (!candidate.excerpt || seen.has(key)) return
    seen.add(key)
    candidates.push(candidate)
  }

  extractClaimSentences(rawResponse)
    .slice(0, 4)
    .forEach((sentence, index) =>
      addCandidate({
        id: `claim-${index + 1}`,
        type: "claim",
        label: `Claim sentence ${index + 1}`,
        excerpt: limitText(sentence, EVIDENCE_EXCERPT_LIMIT)
      })
    )

  extractCodeBlocks(rawResponse)
    .slice(0, 3)
    .forEach((block, index) =>
      addCandidate({
        id: `code-${index + 1}`,
        type: "code",
        label: `Code block ${index + 1}`,
        excerpt: block
      })
    )

  const paragraphs = extractParagraphs(rawResponse)
  const paragraphsBySignal = paragraphs.filter(
    (paragraph) =>
      candidateMatchesIntent(paragraph, intent) ||
      /\b(file|component|function|handler|render|style|popup|button|error|fix|updated|changed)\b/i.test(paragraph)
  )

  paragraphsBySignal.slice(0, 4).forEach((paragraph, index) =>
    addCandidate({
      id: `paragraph-${index + 1}`,
      type: "paragraph",
      label: `Relevant paragraph ${index + 1}`,
      excerpt: limitText(paragraph, EVIDENCE_EXCERPT_LIMIT)
    })
  )

  responseSummary.mentioned_files.slice(0, 4).forEach((file, index) =>
    addCandidate({
      id: `file-${index + 1}`,
      type: "file",
      label: `Mentioned file ${index + 1}`,
      excerpt: file
    })
  )

  intent.constraints
    .filter((constraint) => constraintMentioned(constraint, responseSummary) || candidateMatchesIntent(constraint, intent))
    .slice(0, 2)
    .forEach((constraint, index) =>
      addCandidate({
        id: `constraint-${index + 1}`,
        type: "constraint",
        label: `Constraint reference ${index + 1}`,
        excerpt: limitText(constraint, EVIDENCE_EXCERPT_LIMIT)
      })
    )

  return candidates.slice(0, 8)
}

function shouldInspectDetails(intent: AttemptIntent, responseSummary: AfterPipelineRequest["response_summary"], stage1: ReturnType<typeof Stage1OutputSchema.parse>) {
  const hasStrictIntent = intent.constraints.length > 0 || intent.acceptance_criteria.length > 1
  const codeHeavyTask = isCodeHeavyTask(intent)

  return (
    codeHeavyTask ||
    responseSummary.has_code_blocks ||
    responseSummary.mentioned_files.length > 0 ||
    responseSummary.success_signals.length > 0 ||
    hasStrictIntent ||
    stage1.response_mode === "uncertain"
  )
}

function isCodeHeavyTask(intent: AttemptIntent) {
  return (
    intent.task_type === "debug" ||
    intent.task_type === "build" ||
    intent.task_type === "refactor" ||
    intent.task_type === "create_ui"
  )
}

function sanitizeEvidenceTargeting(value: unknown) {
  const parsed = EvidenceTargetingSchema.safeParse(value)
  if (parsed.success) return parsed.data

  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  const selectedIds = Array.isArray(candidate.selected_candidate_ids)
    ? candidate.selected_candidate_ids.filter((item): item is string => typeof item === "string").slice(0, 4)
    : []
  const riskFlags = Array.isArray(candidate.risk_flags)
    ? candidate.risk_flags.filter((item): item is string => typeof item === "string").slice(0, 4)
    : []
  const inspectionGoal =
    typeof candidate.inspection_goal === "string"
      ? limitText(candidate.inspection_goal.trim(), 180)
      : ""

  return EvidenceTargetingSchema.parse({
    selected_candidate_ids: selectedIds,
    risk_flags: riskFlags,
    inspection_goal: inspectionGoal
  })
}

function constraintMentioned(constraint: string, responseSummary: AfterPipelineRequest["response_summary"]) {
  const normalizedConstraint = constraint.toLowerCase()
  const haystack = [
    responseSummary.first_excerpt,
    responseSummary.last_excerpt,
    ...responseSummary.key_paragraphs
  ]
    .join(" ")
    .toLowerCase()

  return haystack.includes(normalizedConstraint)
}

function parseLooseJson(raw: string): unknown {
  const cleaned = raw.trim()

  try {
    return JSON.parse(cleaned)
  } catch {
    const startCandidates = [cleaned.indexOf("{"), cleaned.indexOf("[")].filter((index) => index >= 0)
    const start = startCandidates.length ? Math.min(...startCandidates) : -1
    if (start === -1) {
      throw new Error("Model response did not contain JSON")
    }

    for (let end = cleaned.length; end > start; end -= 1) {
      const slice = cleaned.slice(start, end).trim()
      if (!slice) continue

      try {
        return JSON.parse(slice)
      } catch {
        continue
      }
    }

    throw new Error("Model response contained malformed JSON")
  }
}

async function callStructuredJson<T>(
  systemPrompt: string,
  userPrompt: string,
  parser: (value: unknown) => T,
  maxTokens: number
) {
  const trimmedPrompt = trimForBudget(userPrompt, 5000)
  const providers = [
    () => callKimiJson(systemPrompt, trimmedPrompt, maxTokens),
    () => callDeepSeekJson(systemPrompt, trimmedPrompt, maxTokens)
  ]

  for (const callProvider of providers) {
    try {
      const raw = await callProvider()
      if (!raw) continue
      return parser(parseLooseJson(raw))
    } catch {
      continue
    }
  }

  return null
}

function estimateTokensFromText(...parts: string[]) {
  const chars = parts.join("").length
  return Math.max(1, Math.ceil(chars / 4))
}

function needsFallbackIntent(intent: AttemptIntent) {
  return intent.task_type === "other" && intent.constraints.length === 0 && intent.acceptance_criteria.length === 0
}

function buildIntentExtractionPrompts(rawPrompt: string) {
  return {
    system:
      "Extract intent for an AI debugging loop. Return JSON only with keys: task_type, goal, constraints, acceptance_criteria. Keep it minimal and do not invent detailed constraints.",
    user: JSON.stringify({ raw_prompt: rawPrompt })
  }
}

function buildStage1Prompts(payload: AfterPipelineRequest["response_summary"], intent: AttemptIntent) {
  return {
    system:
      "Summarize what the assistant appears to have done. Return JSON only with keys: assistant_action_summary, claimed_evidence, response_mode, scope_assessment.",
    user: JSON.stringify({
      intent_goal: compressGoal(intent.goal),
      task_type: intent.task_type,
      response_summary: {
        response_length: payload.response_length,
        has_code_blocks: payload.has_code_blocks,
        mentioned_files: payload.mentioned_files,
        certainty_signals: payload.certainty_signals,
        uncertainty_signals: payload.uncertainty_signals,
        success_signals: payload.success_signals,
        failure_signals: payload.failure_signals,
        first_excerpt: payload.first_excerpt,
        last_excerpt: payload.last_excerpt,
        key_paragraphs: payload.key_paragraphs
      }
    })
  }
}

function buildStage2Prompts(
  intent: AttemptIntent,
  stage1: ReturnType<typeof Stage1OutputSchema.parse>,
  candidates: EvidenceCandidate[]
) {
  return {
    system:
      "Choose which raw answer excerpts deserve closer inspection. Return JSON only with keys: selected_candidate_ids, risk_flags, inspection_goal. Pick at most 4 IDs.",
    user: JSON.stringify({
      intent: {
        goal: compressGoal(intent.goal),
        constraints: intent.constraints.slice(0, 4),
        acceptance_criteria: intent.acceptance_criteria.slice(0, 4)
      },
      stage_1: stage1,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        type: candidate.type,
        label: candidate.label,
        excerpt: candidate.excerpt
      }))
    })
  }
}

function buildStage3Prompts(
  intent: AttemptIntent,
  stage1: ReturnType<typeof Stage1OutputSchema.parse>,
  stage2: ReturnType<typeof EvidenceTargetingSchema.parse>,
  selectedEvidence: EvidenceCandidate[]
) {
  return {
    system:
      "Inspect the selected raw answer excerpts and decide whether they support the assistant's claims. Return JSON only with keys: supported_claims, contradictions, unresolved_risks, evidence_strength, inspection_depth.",
    user: JSON.stringify({
      intent: {
        goal: compressGoal(intent.goal),
        constraints: intent.constraints.slice(0, 4),
        acceptance_criteria: intent.acceptance_criteria.slice(0, 4)
      },
      stage_1: stage1,
      stage_2: stage2,
      selected_evidence: selectedEvidence.map((candidate) => ({
        type: candidate.type,
        label: candidate.label,
        excerpt: candidate.excerpt
      }))
    })
  }
}

function buildStage4Prompts(
  intent: AttemptIntent,
  stage1: ReturnType<typeof Stage1OutputSchema.parse>,
  stage2: ReturnType<typeof Stage2OutputSchema.parse>,
  detail: ReturnType<typeof DetailInspectionSchema.parse>,
  responseSummary: AfterPipelineRequest["response_summary"]
) {
  return {
    system:
      "Generate a trustworthy verdict for the AI response. Prefer UNVERIFIED over success when evidence is weak. Return JSON only with keys: status, confidence, findings, issues.",
    user: JSON.stringify({
      intent,
      stage_1: stage1,
      stage_2: stage2,
      detail_inspection: detail,
      response_summary: {
        response_length: responseSummary.response_length,
        has_code_blocks: responseSummary.has_code_blocks,
        mentioned_files: responseSummary.mentioned_files,
        certainty_signals: responseSummary.certainty_signals,
        uncertainty_signals: responseSummary.uncertainty_signals,
        success_signals: responseSummary.success_signals,
        failure_signals: responseSummary.failure_signals
      }
    })
  }
}

function buildStage5Prompts(
  optimizedPrompt: string,
  intent: AttemptIntent,
  verdict: ReturnType<typeof VerdictOutputSchema.parse>,
  stage2: ReturnType<typeof Stage2OutputSchema.parse>
) {
  return {
    system:
      "Write the next best prompt for the user. Keep scope tight and focus only on what is missing or risky. Return JSON only with keys: next_prompt, prompt_strategy.",
    user: JSON.stringify({
      optimized_prompt: optimizedPrompt,
      intent,
      verdict,
      missing_criteria: stage2.missing_criteria,
      constraint_risks: stage2.constraint_risks
    })
  }
}

function fallbackStage1(responseSummary: AfterPipelineRequest["response_summary"]) {
  const responseMode =
    responseSummary.has_code_blocks || responseSummary.mentioned_files.length
      ? "implemented"
      : responseSummary.uncertainty_signals.length
        ? "uncertain"
        : responseSummary.success_signals.length
          ? "explained"
          : "suggested"

  const scopeAssessment =
    responseSummary.mentioned_files.length >= 6
      ? "broad"
      : responseSummary.mentioned_files.length >= 2 || responseSummary.response_length > 1800
        ? "moderate"
        : "narrow"

  const summarySource = summarizeVisibleAnswer(responseSummary)

  return Stage1OutputSchema.parse({
    assistant_action_summary: summarySource.slice(0, 220),
    claimed_evidence: dedupe(
      [
        ...responseSummary.success_signals,
        ...responseSummary.mentioned_files,
        ...(responseSummary.has_code_blocks ? ["Included code blocks"] : [])
      ],
      4
    ),
    response_mode: responseMode,
    scope_assessment: scopeAssessment
  })
}

function fallbackStage2(
  intent: AttemptIntent,
  stage1: ReturnType<typeof Stage1OutputSchema.parse>,
  detail: ReturnType<typeof DetailInspectionSchema.parse>,
  responseSummary: AfterPipelineRequest["response_summary"]
) {
  const codeHeavyTask = isCodeHeavyTask(intent)
  const goalMatched = hasGoalEvidence(intent.goal, responseSummary)
  const usesDefaultGoalCriterion = intent.acceptance_criteria.some((criterion) =>
    /prove the answer solved this goal:/i.test(criterion)
  )
  const hasOnTopicSignals =
    goalMatched &&
    (stage1.response_mode === "implemented" ||
      stage1.response_mode === "explained" ||
      responseSummary.success_signals.length > 0 ||
      responseSummary.response_length > 220)

  const addressed =
    (stage1.response_mode === "implemented" || detail.evidence_strength === "strong") && goalMatched
      ? intent.acceptance_criteria.slice(0, 2)
      : !codeHeavyTask && usesDefaultGoalCriterion && goalMatched && detail.inspection_depth !== "summary_only"
        ? intent.acceptance_criteria.slice(0, 1)
        : usesDefaultGoalCriterion && hasOnTopicSignals
        ? intent.acceptance_criteria.slice(0, 1)
        : []
  const rawMissing = intent.acceptance_criteria.filter((criterion) => !addressed.includes(criterion)).slice(0, 4)
  const missing = rawMissing.map((criterion) => {
    if (/prove the answer solved this goal:/i.test(criterion)) {
      if (!codeHeavyTask && goalMatched && detail.inspection_depth !== "summary_only") {
        return ""
      }

      return goalMatched
        ? ""
        : `The answer appears focused on ${responseFocusSnippet(responseSummary)} instead of ${conciseGoal(intent.goal)}.`
    }
    return criterion
  }).filter(Boolean)
  const risks = intent.constraints
    .filter((constraint) => !constraintMentioned(constraint, responseSummary))
    .slice(0, 3)
    .map((constraint) => `The answer did not explicitly address this constraint: ${constraint}`)

  const problemFit = !goalMatched
    ? "wrong_direction"
    : !codeHeavyTask && detail.inspection_depth !== "summary_only"
      ? "correct"
      : stage1.scope_assessment === "broad"
        ? "partial"
        : "correct"

  return Stage2OutputSchema.parse({
    addressed_criteria: addressed,
    missing_criteria: missing,
    constraint_risks: risks,
    problem_fit: problemFit,
    analysis_notes: dedupe(
      [
        stage1.response_mode === "uncertain" ? "The assistant sounded uncertain." : "",
        !goalMatched ? "The visible answer does not share enough signal with the intended goal." : "",
        detail.contradictions.length ? `Possible contradiction: ${detail.contradictions[0]}` : "",
        detail.unresolved_risks.length ? `Unresolved detail risk: ${detail.unresolved_risks[0]}` : "",
        !codeHeavyTask && goalMatched && detail.inspection_depth !== "summary_only" && !missing.length
          ? "The answer appears to directly deliver the requested content."
          : goalMatched && usesDefaultGoalCriterion && !missing.length
          ? "The answer looks on-topic, but NoRetry is relying on inferred validation rather than explicit proof."
          : "",
        missing.length ? "Some acceptance criteria remain unverified." : ""
      ],
      4
    )
  })
}

function fallbackDetailInspection(
  selectedEvidence: EvidenceCandidate[],
  responseSummary: AfterPipelineRequest["response_summary"]
) {
  const hasCode = selectedEvidence.some((candidate) => candidate.type === "code")
  const hasClaims = selectedEvidence.some((candidate) => candidate.type === "claim")
  const evidenceStrength =
    hasCode || responseSummary.mentioned_files.length > 0
      ? "strong"
      : hasClaims || selectedEvidence.length >= 2
        ? "moderate"
        : "weak"

  return DetailInspectionSchema.parse({
    supported_claims: selectedEvidence
      .filter((candidate) => candidate.type === "claim" || candidate.type === "file")
      .slice(0, 2)
      .map((candidate) => candidate.excerpt),
    contradictions: [],
    unresolved_risks:
      evidenceStrength === "weak" && responseSummary.success_signals.length > 0
        ? ["The answer claims success, but the inspected evidence is still limited."]
        : [],
    evidence_strength: evidenceStrength,
    inspection_depth: hasCode ? "targeted_code" : selectedEvidence.length ? "targeted_text" : "summary_only"
  })
}

function fallbackVerdict(
  intent: AttemptIntent,
  responseSummary: AfterPipelineRequest["response_summary"],
  stage1: ReturnType<typeof Stage1OutputSchema.parse>,
  stage2: ReturnType<typeof Stage2OutputSchema.parse>,
  detail: ReturnType<typeof DetailInspectionSchema.parse>,
  usedFallbackIntent: boolean,
  deepAnalysisRequested: boolean
) {
  let status: "SUCCESS" | "LIKELY_SUCCESS" | "PARTIAL" | "FAILED" | "WRONG_DIRECTION" | "UNVERIFIED" = "UNVERIFIED"
  const codeHeavyTask = isCodeHeavyTask(intent)

  if (responseSummary.failure_signals.length) status = "FAILED"
  else if (stage2.problem_fit === "wrong_direction") status = "WRONG_DIRECTION"
  else if (
    !codeHeavyTask &&
    stage2.problem_fit === "correct" &&
    !stage2.missing_criteria.length &&
    !stage2.constraint_risks.length &&
    detail.inspection_depth !== "summary_only"
  ) {
    status = detail.evidence_strength === "strong" ? "SUCCESS" : "LIKELY_SUCCESS"
  } else if (!stage2.missing_criteria.length && responseSummary.success_signals.length) status = "LIKELY_SUCCESS"
  else if (stage2.missing_criteria.length || responseSummary.uncertainty_signals.length) status = "PARTIAL"

  const hasConcreteEvidence = responseSummary.mentioned_files.length > 0 || responseSummary.has_code_blocks
  const confidence =
    status === "FAILED" || status === "WRONG_DIRECTION"
      ? "high"
      : usedFallbackIntent
        ? "low"
        : detail.inspection_depth === "summary_only"
          ? codeHeavyTask
            ? "low"
            : stage2.problem_fit === "correct"
              ? "medium"
              : "low"
          : codeHeavyTask
          ? hasConcreteEvidence
            ? detail.evidence_strength === "strong"
              ? "high"
              : "medium"
            : "low"
          : stage2.problem_fit === "correct" && !stage2.missing_criteria.length && !stage2.constraint_risks.length
            ? "high"
            : "low"

  const confidenceReason =
    usedFallbackIntent
      ? "NoRetry had to infer the goal from the prompt, so this review is more cautious."
      : status === "WRONG_DIRECTION"
        ? "The answer appears to be about a different problem than the saved goal."
        : detail.inspection_depth === "summary_only"
          ? deepAnalysisRequested
            ? "NoRetry attempted a deeper review, but could not inspect enough raw evidence to raise confidence."
            : codeHeavyTask
              ? "NoRetry only reviewed the response summary, not targeted raw evidence."
              : "NoRetry only did a quick review of the answer, so this result is still cautious."
        : codeHeavyTask
          ? hasConcreteEvidence
            ? detail.evidence_strength === "strong"
              ? deepAnalysisRequested
                ? "NoRetry deeply reviewed targeted raw evidence, including implementation details."
                : "NoRetry reviewed targeted raw evidence, including implementation details."
              : "The answer included some implementation evidence, but important details remain limited."
            : "The answer stayed on-topic, but it did not include enough concrete implementation evidence."
          : stage2.problem_fit === "correct"
            ? !stage2.missing_criteria.length && !stage2.constraint_risks.length
              ? deepAnalysisRequested
                ? "NoRetry deeply reviewed the answer and found strong alignment with the requested outcome."
                : "NoRetry found the answer aligned with the requested outcome."
              : "The answer appears aligned with the goal, but some requested details still look unconfirmed."
            : "The answer gave limited concrete evidence, so this review is cautious."

  const primaryFinding =
    status === "WRONG_DIRECTION"
      ? `The answer appears to address ${responseFocusSnippet(responseSummary)} instead of ${conciseGoal(intent.goal)}.`
      : stage2.problem_fit === "correct" && !stage2.missing_criteria.length
        ? `The answer appears aligned with the goal: ${conciseGoal(intent.goal)}.`
        : stage1.assistant_action_summary

  return VerdictOutputSchema.parse({
    status,
    confidence,
    confidence_reason: confidenceReason,
    findings: dedupe(
      [
        primaryFinding,
        stage2.analysis_notes[0] || "",
        detail.supported_claims.length ? `Inspected evidence: ${detail.supported_claims[0]}` : "",
        stage2.missing_criteria.length && !usedFallbackIntent ? stage2.missing_criteria[0] : "",
        responseSummary.failure_signals.length ? `Failure signal: ${responseSummary.failure_signals[0]}` : "",
        hasConcreteEvidence ? `Evidence referenced: ${[...responseSummary.mentioned_files, ...(responseSummary.has_code_blocks ? ["code blocks"] : [])].slice(0, 2).join(", ")}` : ""
      ],
      3
    ),
    issues: dedupe(
      [
        ...stage2.missing_criteria,
        ...stage2.constraint_risks,
        ...detail.contradictions,
        ...detail.unresolved_risks,
        ...(responseSummary.uncertainty_signals.length ? ["The response sounds uncertain."] : []),
        ...(usedFallbackIntent && status !== "WRONG_DIRECTION"
          ? ["NoRetry inferred the goal from the prompt, so this review may be less precise."]
          : [])
      ],
      6
    )
  })
}

function fallbackNextPrompt(
  optimizedPrompt: string,
  verdict: ReturnType<typeof VerdictOutputSchema.parse>,
  stage2: ReturnType<typeof Stage2OutputSchema.parse>
) {
  const focus =
    stage2.missing_criteria[0] ||
    stage2.constraint_risks[0] ||
    verdict.issues[0] ||
    "validate the result against the original request"

  const strategy =
    verdict.status === "FAILED"
      ? "retry_cleanly"
      : stage2.constraint_risks.length
        ? "narrow_scope"
        : stage2.missing_criteria.length
          ? "fix_missing"
          : "validate"

  return NextPromptOutputSchema.parse({
    next_prompt: `${optimizedPrompt}\n\nBefore continuing, focus only on this: ${focus}. Tell me exactly what you changed, what evidence proves it, and whether the original request is now fully satisfied.`,
    prompt_strategy: strategy
  })
}

export async function analyzeAfterAttempt(input: AfterPipelineRequest) {
  const parsed = input
  const deepAnalysisRequested = parsed.deep_analysis ?? false
  const budgetSoftLimit = deepAnalysisRequested ? 2800 : 1800
  const stageSoftDeadline = deepAnalysisRequested ? AFTER_DEEP_STAGE_SOFT_DEADLINE_MS : AFTER_STAGE_SOFT_DEADLINE_MS
  const startedAt = Date.now()
  let tokenUsageTotal = 0
  let intent = parsed.attempt.intent
  let usedFallbackIntent = false
  const elapsed = () => Date.now() - startedAt

  if (needsFallbackIntent(intent)) {
    const prompts = buildIntentExtractionPrompts(parsed.attempt.raw_prompt)
    const maxTokens = tokenUsageTotal >= budgetSoftLimit ? 140 : 220
    const extracted = await callStructuredJson(
      prompts.system,
      prompts.user,
      (value) => IntentExtractionOutputSchema.parse(value),
      maxTokens
    )
    tokenUsageTotal += estimateTokensFromText(prompts.system, prompts.user)
    if (extracted) {
      intent = extracted
      usedFallbackIntent = true
    }
  }

  const stage1Prompts = buildStage1Prompts(parsed.response_summary, intent)
  const stage1 = await callStructuredJson(
    stage1Prompts.system,
    stage1Prompts.user,
    (value) => Stage1OutputSchema.parse(value),
    tokenUsageTotal >= budgetSoftLimit ? 120 : 180
  )
  tokenUsageTotal += estimateTokensFromText(stage1Prompts.system, stage1Prompts.user)
  const safeStage1 = stage1 ?? fallbackStage1(parsed.response_summary)

  const rawResponse = parsed.response_text_fallback || parsed.response_summary.response_text
  const evidenceCandidates = buildEvidenceCandidates(rawResponse, intent, parsed.response_summary)
  const shouldZoomIn = deepAnalysisRequested && evidenceCandidates.length > 0

  let targetedEvidence = EvidenceTargetingSchema.parse({
    selected_candidate_ids: [],
    risk_flags: [],
    inspection_goal: ""
  })

  if (shouldZoomIn) {
    const stage2Prompts = buildStage2Prompts(intent, safeStage1, evidenceCandidates)
    const stage2Targeting = await callStructuredJson(
      stage2Prompts.system,
      stage2Prompts.user,
      (value) => sanitizeEvidenceTargeting(value),
      tokenUsageTotal >= budgetSoftLimit ? 90 : 140
    )
    tokenUsageTotal += estimateTokensFromText(stage2Prompts.system, stage2Prompts.user)
    targetedEvidence =
      stage2Targeting ??
      EvidenceTargetingSchema.parse({
        selected_candidate_ids: evidenceCandidates.slice(0, deepAnalysisRequested ? 4 : 3).map((candidate) => candidate.id),
        risk_flags: parsed.response_summary.success_signals.length ? ["success_claim_needs_evidence"] : [],
        inspection_goal: `Verify whether the visible answer truly supports: ${compressGoal(intent.goal)}`
      })
  }

  const selectedEvidence = (
    targetedEvidence.selected_candidate_ids.length
      ? evidenceCandidates.filter((candidate) => targetedEvidence.selected_candidate_ids.includes(candidate.id))
      : shouldZoomIn
        ? evidenceCandidates.slice(0, deepAnalysisRequested ? 4 : 3)
        : []
  ).slice(0, 4)

  let detailInspection = fallbackDetailInspection(selectedEvidence, parsed.response_summary)
  if (selectedEvidence.length && elapsed() < stageSoftDeadline) {
    const stage3Prompts = buildStage3Prompts(intent, safeStage1, targetedEvidence, selectedEvidence)
    const detail = await callStructuredJson(
      stage3Prompts.system,
      stage3Prompts.user,
      (value) => DetailInspectionSchema.parse(value),
      tokenUsageTotal >= budgetSoftLimit ? 130 : deepAnalysisRequested ? 220 : 170
    )
    tokenUsageTotal += estimateTokensFromText(stage3Prompts.system, stage3Prompts.user)
    detailInspection = detail ?? detailInspection
  }

  const alignmentPrompts = {
    system:
      "Compare the assistant response to the intended goal. Return JSON only with keys: addressed_criteria, missing_criteria, constraint_risks, problem_fit, analysis_notes.",
    user: JSON.stringify({
      intent,
      stage_1: safeStage1,
      detail_inspection: detailInspection,
      response_excerpts: buildResponseExcerpts(parsed.response_summary)
    })
  }
  const stage4Alignment = await callStructuredJson(
    alignmentPrompts.system,
    alignmentPrompts.user,
    (value) => Stage2OutputSchema.parse(value),
    tokenUsageTotal >= budgetSoftLimit ? 130 : deepAnalysisRequested ? 220 : 180
  )
  tokenUsageTotal += estimateTokensFromText(alignmentPrompts.system, alignmentPrompts.user)
  const safeStage2 = stage4Alignment ?? fallbackStage2(intent, safeStage1, detailInspection, parsed.response_summary)

  let safeVerdict = fallbackVerdict(
    intent,
    parsed.response_summary,
    safeStage1,
    safeStage2,
    detailInspection,
    usedFallbackIntent,
    deepAnalysisRequested
  )
  let safeNextPrompt = fallbackNextPrompt(parsed.attempt.optimized_prompt, safeVerdict, safeStage2)

  if (elapsed() < stageSoftDeadline) {
    const stage4Prompts = buildStage4Prompts(intent, safeStage1, safeStage2, detailInspection, parsed.response_summary)
    const verdict = await callStructuredJson(
      stage4Prompts.system,
      stage4Prompts.user,
      (value) => VerdictOutputSchema.parse(value),
      tokenUsageTotal >= budgetSoftLimit ? 120 : deepAnalysisRequested ? 200 : 160
    )
    tokenUsageTotal += estimateTokensFromText(stage4Prompts.system, stage4Prompts.user)
    safeVerdict = verdict ?? safeVerdict
  }

  if (elapsed() < stageSoftDeadline) {
    const stage5Prompts = buildStage5Prompts(parsed.attempt.optimized_prompt, intent, safeVerdict, safeStage2)
    const nextPromptOutput = await callStructuredJson(
      stage5Prompts.system,
      stage5Prompts.user,
      (value) => NextPromptOutputSchema.parse(value),
      tokenUsageTotal >= budgetSoftLimit ? 150 : deepAnalysisRequested ? 240 : 180
    )
    tokenUsageTotal += estimateTokensFromText(stage5Prompts.system, stage5Prompts.user)
    safeNextPrompt = nextPromptOutput ?? safeNextPrompt
  }

  return AfterPipelineResponseSchema.parse({
    status: safeVerdict.status,
    confidence: safeVerdict.confidence,
    confidence_reason: safeVerdict.confidence_reason,
    inspection_depth: detailInspection.inspection_depth,
    findings: safeVerdict.findings,
    issues: safeVerdict.issues,
    next_prompt: safeNextPrompt.next_prompt,
    prompt_strategy: safeNextPrompt.prompt_strategy,
    stage_1: safeStage1,
    stage_2: safeStage2,
    verdict: safeVerdict,
    next_prompt_output: safeNextPrompt,
    response_summary: parsed.response_summary,
    used_fallback_intent: usedFallbackIntent,
    token_usage_total: tokenUsageTotal
  })
}
