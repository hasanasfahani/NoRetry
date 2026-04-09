import type { PlasmoCSConfig, PlasmoGetRootContainer } from "plasmo"
import { useEffect, useMemo, useRef, useState } from "react"
import type {
  AnalyzePromptResponse,
  AfterAnalysisResult,
  ClarificationQuestion,
  DetectOutcomeResponse,
  DiagnoseFailureResponse,
  SessionSummary,
  Attempt
} from "@prompt-optimizer/shared/src/schemas"
import { DETECTION_THRESHOLDS } from "@prompt-optimizer/shared/src/constants"
import { analyzePromptLocally, buildPromptFromAnswers } from "@prompt-optimizer/shared/src/analyzePrompt"
import {
  buildAttemptIntentFromBefore,
  mapPromptIntentToTaskType,
  preprocessResponse
} from "@prompt-optimizer/shared"
import { summarizeSessionMemory } from "@prompt-optimizer/shared/src/session"
import { AfterVerdictPanel } from "../components/AfterVerdictPanel"
import { OptimizerShell } from "../components/OptimizerShell"
import { analyzeAfterAttempt, analyzePromptRemote, detectOutcome, diagnoseFailure, extendQuestions, refinePrompt, sendFeedback } from "../lib/api"
import {
  findLatestChatGptAssistantMessage,
  findLatestChatGptUserMessage,
  readChatGptAssistantText,
  readChatGptUserText
} from "../lib/after/chatgpt"
import {
  attachAnalysisResult,
  createAttempt,
  getActiveAttempt,
  getLatestSubmittedAttempt,
  markAttemptSubmitted
} from "../lib/attempt-session-manager"
import {
  collectChangedFilesSummary,
  collectVisibleErrorSummary,
  collectVisibleOutputSnippet,
  findPromptInput,
  findSubmitButton,
  getPromptSurface,
  isPromptLikeElement,
  isSupportedPromptPage,
  readPromptValue,
  writePromptValue
} from "../lib/replit"
import { getSessionSummary, hasSeenOnboarding, markOnboardingSeen, saveSessionSummary } from "../lib/storage"

export const config: PlasmoCSConfig = {
  matches: ["https://replit.com/*", "https://www.replit.com/*", "https://chatgpt.com/*", "https://chat.openai.com/*"],
  all_frames: false
}

export const getRootContainer: PlasmoGetRootContainer = async () => {
  let host = document.getElementById("prompt-optimizer-root")
  if (!host) {
    host = document.createElement("div")
    host.id = "prompt-optimizer-root"
    document.body.appendChild(host)
  }

  return host
}

type PendingPrompt = {
  id: string
  prompt: string
  intent: AnalyzePromptResponse["intent"]
  sentAt: number
}

export default function PromptOptimizerApp() {
  const OTHER_OPTION = "Other"
  const [mounted, setMounted] = useState(false)
  const [inputBindingVersion, setInputBindingVersion] = useState(0)
  const [panelOpen, setPanelOpen] = useState(false)
  const [onboardingVisible, setOnboardingVisible] = useState(false)
  const [promptPreview, setPromptPreview] = useState("")
  const [beforeResult, setBeforeResult] = useState<AnalyzePromptResponse | null>(null)
  const [isAnalyzingPrompt, setIsAnalyzingPrompt] = useState(false)
  const [detection, setDetection] = useState<DetectOutcomeResponse | null>(null)
  const [diagnosis, setDiagnosis] = useState<DiagnoseFailureResponse | null>(null)
  const [session, setSession] = useState<SessionSummary | null>(null)
  const [issueVisible, setIssueVisible] = useState(false)
  const [hasSubmittedPrompt, setHasSubmittedPrompt] = useState(false)
  const [answerState, setAnswerState] = useState<Record<string, string | string[]>>({})
  const [otherAnswerState, setOtherAnswerState] = useState<Record<string, string>>({})
  const [editableDraft, setEditableDraft] = useState("")
  const [aiDraftNotes, setAiDraftNotes] = useState<string[]>([])
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false)
  const [isAddingQuestions, setIsAddingQuestions] = useState(false)
  const [draftReady, setDraftReady] = useState(false)
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(false)
  const [questionLoadError, setQuestionLoadError] = useState<string | null>(null)
  const [afterVerdict, setAfterVerdict] = useState<AfterAnalysisResult | null>(null)
  const [isEvaluatingAfterResponse, setIsEvaluatingAfterResponse] = useState(false)
  const promptRef = useRef<HTMLElement | null>(null)
  const submitRef = useRef<HTMLButtonElement | null>(null)
  const pendingPromptRef = useRef<PendingPrompt | null>(null)
  const retryTimeoutRef = useRef<number | null>(null)
  const outcomeEventIdRef = useRef<string | null>(null)
  const lastAnalyzedPromptRef = useRef("")
  const analyzingPromptRef = useRef<string | null>(null)
  const analysisRequestIdRef = useRef(0)
  const lastFocusedPromptRef = useRef<HTMLElement | null>(null)
  const lastPromptValueRef = useRef("")
  const latestAssistantNodeRef = useRef<HTMLElement | null>(null)
  const lastEvaluatedAssistantTextRef = useRef("")

  function buildAfterPlaceholder(
    finding: string,
    issues: string[] = [],
    nextPrompt = ""
  ): AfterAnalysisResult {
    return {
      status: "UNVERIFIED",
      confidence: "low",
      confidence_reason: issues[0] || "",
      inspection_depth: "summary_only",
      findings: [finding],
      issues,
      next_prompt: nextPrompt,
      prompt_strategy: "retry_cleanly",
      stage_1: {
        assistant_action_summary: finding,
        claimed_evidence: [],
        response_mode: "uncertain",
        scope_assessment: "moderate"
      },
      stage_2: {
        addressed_criteria: [],
        missing_criteria: [],
        constraint_risks: issues,
        problem_fit: "partial",
        analysis_notes: []
      },
      verdict: {
        status: "UNVERIFIED",
        confidence: "low",
        confidence_reason: issues[0] || "",
        findings: [finding],
        issues
      },
      next_prompt_output: {
        next_prompt: nextPrompt,
        prompt_strategy: "retry_cleanly"
      },
      response_summary: {
        response_text: "",
        response_length: 0,
        first_excerpt: "",
        last_excerpt: "",
        key_paragraphs: [],
        has_code_blocks: false,
        mentioned_files: [],
        certainty_signals: [],
        uncertainty_signals: [],
        success_signals: [],
        failure_signals: []
      },
      used_fallback_intent: true,
      token_usage_total: 0
    }
  }

  function getAttemptPlatform(): Attempt["platform"] {
    return getPromptSurface() === "CHATGPT" ? "chatgpt" : "replit"
  }

  async function saveDraftAttempt(promptText: string, improvedPrompt?: string | null) {
    const optimizedPrompt = (improvedPrompt ?? beforeResult?.rewrite ?? promptText).trim()
    const attempt = await createAttempt({
      attempt_id: crypto.randomUUID(),
      platform: getAttemptPlatform(),
      raw_prompt: promptText.trim(),
      optimized_prompt: optimizedPrompt,
      intent: buildAttemptIntentFromBefore(
        promptText,
        optimizedPrompt,
        beforeResult?.intent,
        beforeResult?.clarification_questions ?? [],
        normalizeAnswers(answerState)
      )
    })
    return attempt
  }

  async function ensureSubmittedAttempt() {
    const userMessage = readChatGptUserText(findLatestChatGptUserMessage())
    const inferredPrompt = userMessage || lastPromptValueRef.current.trim() || promptPreview.trim()
    const normalizedPrompt = inferredPrompt.trim()
    const latestSubmitted = await getLatestSubmittedAttempt()
    if (
      latestSubmitted &&
      (!normalizedPrompt ||
        latestSubmitted.raw_prompt.trim() === normalizedPrompt ||
        latestSubmitted.optimized_prompt.trim() === normalizedPrompt)
    ) {
      return latestSubmitted
    }

    const activeAttempt = await getActiveAttempt()
    if (activeAttempt) {
      const submitted = await markAttemptSubmitted(activeAttempt.attempt_id)
      if (submitted) return submitted
    }

    if (!inferredPrompt) return null

    const fallbackAttempt = await createAttempt({
      attempt_id: crypto.randomUUID(),
      platform: getAttemptPlatform(),
      raw_prompt: inferredPrompt,
      optimized_prompt: inferredPrompt,
      intent: {
        task_type: mapPromptIntentToTaskType(beforeResult?.intent),
        goal: inferredPrompt,
        constraints: [],
        acceptance_criteria: []
      }
    })
    return markAttemptSubmitted(fallbackAttempt.attempt_id)
  }

  async function runAfterEvaluation(force = false, deepAnalysis = false) {
    const latestMessage = findLatestChatGptAssistantMessage()
    const fallbackVisibleOutput = collectVisibleOutputSnippet().trim()
    const text = readChatGptAssistantText(latestMessage) || fallbackVisibleOutput
    if (!text || (!force && text === lastEvaluatedAssistantTextRef.current)) {
      return false
    }

    const attempt = await ensureSubmittedAttempt()
    if (!attempt) return false

    latestAssistantNodeRef.current = latestMessage
    setIsEvaluatingAfterResponse(true)

    try {
      const responseSummary = preprocessResponse(text)
      const result = await analyzeAfterAttempt({
        attempt,
        response_summary: responseSummary,
        response_text_fallback: text,
        deep_analysis: deepAnalysis
      })
      setAfterVerdict(result)
      await attachAnalysisResult(attempt.attempt_id, text, result, latestMessage?.getAttribute("data-message-id"))
      lastEvaluatedAssistantTextRef.current = text
      return true
    } finally {
      setIsEvaluatingAfterResponse(false)
    }
  }

  const currentSession = useMemo<SessionSummary>(
    () =>
      session ?? {
        sessionId: crypto.randomUUID(),
        lastPrompts: [],
        lastOptimizedPrompts: [],
        retryCount: 0,
        lastIssueDetected: null,
        lastProbableStatus: "UNKNOWN"
      },
    [session]
  )

  useEffect(() => {
    if (!isSupportedPromptPage()) return

    void getSessionSummary().then((existing) => {
      if (existing) setSession(existing)
    })

    void hasSeenOnboarding().then((seen) => {
      if (!seen) setOnboardingVisible(true)
    })

    const scan = () => {
      const input = findPromptInput()
      if (!input) {
        promptRef.current = null
        submitRef.current = null
        positionHost()
        return
      }

      const inputChanged = promptRef.current !== input
      promptRef.current = input
      lastFocusedPromptRef.current = input
      submitRef.current = findSubmitButton(input)
      positionHost()
      if (inputChanged) {
        setInputBindingVersion((current) => current + 1)
      }
    }

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement) || !isPromptLikeElement(target)) return

      const inputChanged = promptRef.current !== target
      promptRef.current = target
      lastFocusedPromptRef.current = target
      submitRef.current = findSubmitButton(target)
      positionHost()
      if (inputChanged) {
        setInputBindingVersion((current) => current + 1)
      }
    }

    scan()
    const observer = new MutationObserver(scan)
    observer.observe(document.body, { childList: true, subtree: true })
    document.addEventListener("focusin", handleFocusIn)
    window.addEventListener("resize", positionHost)
    window.addEventListener("scroll", positionHost, true)
    setMounted(true)

    return () => {
      observer.disconnect()
      document.removeEventListener("focusin", handleFocusIn)
      window.removeEventListener("resize", positionHost)
      window.removeEventListener("scroll", positionHost, true)
      if (retryTimeoutRef.current) window.clearTimeout(retryTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    const input = promptRef.current

    let debounceId: number | null = null

    const bindPromptTarget = (target: HTMLElement) => {
      const inputChanged = promptRef.current !== target
      promptRef.current = target
      lastFocusedPromptRef.current = target
      submitRef.current = findSubmitButton(target)
      positionHost()
      if (inputChanged) {
        setInputBindingVersion((current) => current + 1)
      }
    }

    const handleInput = (sourceInput?: HTMLElement) => {
      const activeInput = sourceInput ?? promptRef.current
      if (!activeInput) return

      const prompt = readPromptValue(activeInput)
      lastPromptValueRef.current = prompt
      setPromptPreview(prompt.slice(0, 220))
      setIssueVisible(false)
      setDiagnosis(null)
      if (!prompt.trim()) {
        setIsAnalyzingPrompt(false)
      }

      if (debounceId) window.clearTimeout(debounceId)
      debounceId = window.setTimeout(async () => {
        const normalizedPrompt = prompt.trim()
        if (!normalizedPrompt) {
          setIsAnalyzingPrompt(false)
          return
        }

        setIsAnalyzingPrompt(true)
        const alreadyAnalyzedSamePrompt = normalizedPrompt.length > 0 && normalizedPrompt === lastAnalyzedPromptRef.current
        const alreadyAnalyzingSamePrompt =
          normalizedPrompt.length > 0 && normalizedPrompt === analyzingPromptRef.current

        if (alreadyAnalyzedSamePrompt || alreadyAnalyzingSamePrompt) {
          setIsAnalyzingPrompt(false)
          return
        }

        analyzingPromptRef.current = normalizedPrompt
        const requestId = ++analysisRequestIdRef.current

        try {
          const result = analyzePromptLocally(prompt, summarizeSessionMemory(currentSession))

          if (requestId !== analysisRequestIdRef.current) {
            return
          }

          const latestPromptValue = promptRef.current ? readPromptValue(promptRef.current).trim() : promptPreview.trim()
          const promptChangedDuringAnalysis = latestPromptValue !== normalizedPrompt

          if (promptChangedDuringAnalysis) {
            return
          }

          const promptChanged = normalizedPrompt !== lastAnalyzedPromptRef.current
          setBeforeResult(result)
          if (promptChanged) {
            setAnswerState({})
            setOtherAnswerState({})
            setAiDraftNotes([])
            setEditableDraft("")
            setDraftReady(false)
            lastAnalyzedPromptRef.current = normalizedPrompt
          }
        } finally {
          setIsAnalyzingPrompt(false)
          if (analyzingPromptRef.current === normalizedPrompt) {
            analyzingPromptRef.current = null
          }
        }
      }, 800)
    }

    const handleDocumentInput = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return

      const candidate =
        isPromptLikeElement(target)
          ? target
          : target.closest<HTMLElement>("textarea, input, [role='textbox'], [contenteditable='true']")

      if (!candidate || !isPromptLikeElement(candidate)) return

      bindPromptTarget(candidate)
      handleInput(candidate)
    }

    const handleKeydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        void handleSubmit()
      }
    }

    const submitButton = submitRef.current
    document.addEventListener("input", handleDocumentInput, true)
    input?.addEventListener("keydown", handleKeydown)
    submitButton?.addEventListener("click", handleSubmit)
    handleInput(input ?? undefined)

    return () => {
      document.removeEventListener("input", handleDocumentInput, true)
      input?.removeEventListener("keydown", handleKeydown)
      submitButton?.removeEventListener("click", handleSubmit)
      if (debounceId) window.clearTimeout(debounceId)
    }
  }, [currentSession, inputBindingVersion])

  useEffect(() => {
    if (getPromptSurface() !== "CHATGPT") return

    let stableTimer: number | null = null

    const observer = new MutationObserver(() => {
      if (stableTimer) window.clearTimeout(stableTimer)
      stableTimer = window.setTimeout(() => {
        void runAfterEvaluation()
      }, 800)
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    })

    return () => {
      observer.disconnect()
      if (stableTimer) window.clearTimeout(stableTimer)
    }
  }, [answerState, beforeResult, otherAnswerState])

  async function handleOpenAfterPanel() {
    if (afterVerdict) {
      return
    }

    setAfterVerdict(
      buildAfterPlaceholder("NoRetry is checking the latest AI answer.")
    )
    setIsEvaluatingAfterResponse(true)

    try {
      const opened = await runAfterEvaluation(true)
      if (!opened) {
        setAfterVerdict(
          buildAfterPlaceholder(
            "NoRetry could not capture the latest AI answer yet.",
            ["Wait for the answer to finish, then click the thunder again."],
            "Please restate your final result, list the concrete changes you made, and verify whether the original request is now fully satisfied."
          )
        )
      }
    } catch (error) {
      setAfterVerdict(
        buildAfterPlaceholder(
          error instanceof Error ? error.message : "NoRetry hit a problem while analyzing the latest answer.",
          ["Try clicking the thunder again after the response fully settles."],
          "Analyze your last answer again. Tell me exactly what you changed, what remains missing, and give me the next focused prompt to continue."
        )
      )
    } finally {
      setIsEvaluatingAfterResponse(false)
    }
  }

  async function handleRunDeepAnalysis() {
    if (!afterVerdict || isEvaluatingAfterResponse) return

    setIsEvaluatingAfterResponse(true)

    try {
      const opened = await runAfterEvaluation(true, true)
      if (!opened) {
        setAfterVerdict(
          buildAfterPlaceholder(
            "NoRetry could not re-open the latest AI answer for a deeper review.",
            ["Wait for the answer to finish, then try Deep Analyze again."],
            afterVerdict.next_prompt
          )
        )
      }
    } catch (error) {
      setAfterVerdict(
        buildAfterPlaceholder(
          error instanceof Error ? error.message : "NoRetry could not complete a deeper review.",
          ["Try Deep Analyze again after the response fully settles."],
          afterVerdict.next_prompt
        )
      )
    } finally {
      setIsEvaluatingAfterResponse(false)
    }
  }

  async function handleSubmit() {
    const input = promptRef.current
    if (!input) return
    const prompt = readPromptValue(input).trim()
    if (!prompt) return

    const now = Date.now()
    const retryCount =
      pendingPromptRef.current && now - pendingPromptRef.current.sentAt < DETECTION_THRESHOLDS.retryWindowMs
        ? currentSession.retryCount + 1
        : currentSession.retryCount

    pendingPromptRef.current = {
      id: crypto.randomUUID(),
      prompt,
      intent: beforeResult?.intent ?? "OTHER",
      sentAt: now
    }
    const activeAttempt = await getActiveAttempt()
    if (activeAttempt) {
      await markAttemptSubmitted(activeAttempt.attempt_id, {
        raw_prompt: prompt,
        optimized_prompt: beforeResult?.rewrite ?? prompt,
        intent: buildAttemptIntentFromBefore(
          prompt,
          beforeResult?.rewrite ?? prompt,
          beforeResult?.intent,
          beforeResult?.clarification_questions ?? [],
          normalizeAnswers(answerState)
        )
      })
    } else {
      const fallbackAttempt = await createAttempt({
        attempt_id: crypto.randomUUID(),
        platform: getAttemptPlatform(),
        raw_prompt: prompt,
        optimized_prompt: beforeResult?.rewrite ?? prompt,
        intent: buildAttemptIntentFromBefore(
          prompt,
          beforeResult?.rewrite ?? prompt,
          beforeResult?.intent,
          beforeResult?.clarification_questions ?? [],
          normalizeAnswers(answerState)
        )
      })
      await markAttemptSubmitted(fallbackAttempt.attempt_id)
    }
    setAfterVerdict(null)
    latestAssistantNodeRef.current = null
    setHasSubmittedPrompt(true)

    const nextSession: SessionSummary = {
      ...currentSession,
      lastPrompts: [...currentSession.lastPrompts.slice(-2), prompt],
      lastOptimizedPrompts: beforeResult?.rewrite
        ? [...currentSession.lastOptimizedPrompts.slice(-2), beforeResult.rewrite]
        : currentSession.lastOptimizedPrompts,
      lastIntent: beforeResult?.intent ?? "OTHER",
      retryCount
    }

    setSession(nextSession)
    await saveSessionSummary(nextSession)

    if (retryTimeoutRef.current) {
      window.clearTimeout(retryTimeoutRef.current)
    }

    retryTimeoutRef.current = window.setTimeout(() => {
      // Delay the outcome check slightly so we inspect only visible results, not transient UI churn.
      void inspectOutcome()
    }, 3500)
  }

  async function inspectOutcome() {
    if (!pendingPromptRef.current) return

    const outputSnippet = collectVisibleOutputSnippet()
    const errorSummary = collectVisibleErrorSummary()
    const changedFiles = collectChangedFilesSummary()
    const result = await detectOutcome({
      session_id: currentSession.sessionId,
      prompt_id: pendingPromptRef.current.id,
      original_prompt: pendingPromptRef.current.prompt,
      optimized_prompt: beforeResult?.rewrite ?? null,
      strength_score: beforeResult?.score ?? "MID",
      final_sent_prompt: pendingPromptRef.current.prompt,
      prompt_intent: pendingPromptRef.current.intent,
      output_snippet: outputSnippet,
      error_summary: errorSummary,
      retry_count: currentSession.retryCount,
      changed_files_count: changedFiles.length,
      changed_file_paths_summary: changedFiles,
      timestamps: {
        promptSentAt: new Date(pendingPromptRef.current.sentAt).toISOString(),
        evaluatedAt: new Date().toISOString()
      }
    })

    setDetection(result)
    outcomeEventIdRef.current = result.outcome_event_id
    setIssueVisible(result.should_suggest_diagnosis)

    const nextSession: SessionSummary = {
      ...currentSession,
      lastIssueDetected: result.concise_issue,
      lastProbableStatus: result.probable_status
    }
    setSession(nextSession)
    await saveSessionSummary(nextSession)
  }

  async function handleExplain() {
    if (!pendingPromptRef.current) return
    const changedFiles = collectChangedFilesSummary()

    const result = await diagnoseFailure({
      session_id: currentSession.sessionId,
      prompt_id: pendingPromptRef.current.id,
      outcome_event_id: outcomeEventIdRef.current ?? undefined,
      final_sent_prompt: pendingPromptRef.current.prompt,
      prompt_intent: pendingPromptRef.current.intent,
      output_snippet: collectVisibleOutputSnippet(),
      error_summary: collectVisibleErrorSummary(),
      changed_files_count: changedFiles.length,
      changed_file_paths_summary: changedFiles,
      detection_flags: detection?.detection_flags ?? {
        retry_pattern: currentSession.retryCount > 0,
        error_detected: Boolean(collectVisibleErrorSummary()),
        scope_drift: false,
        possible_vagueness: false,
        looping_behavior: currentSession.retryCount >= 2,
        overreach_detected: false
      },
      sessionSummary: summarizeSessionMemory(currentSession)
    })

    setDiagnosis(result)
    setPanelOpen(true)
    setIssueVisible(false)
  }

  function handleRewrite() {
    const input = promptRef.current
    if (!input || !beforeResult?.rewrite) return
    writePromptValue(input, beforeResult.rewrite)
    void saveDraftAttempt(promptPreview || beforeResult.rewrite, beforeResult.rewrite)
    setPanelOpen(false)
  }

  function handleReplacePrompt() {
    const input = promptRef.current
    if (!draftReady || !input || !editableDraft.trim()) return
    writePromptValue(input, editableDraft.trim())
    const sourcePrompt = promptPreview || readPromptValue(input)
    void saveDraftAttempt(sourcePrompt, editableDraft.trim())
    setPanelOpen(false)
  }

  function normalizeAnswers(
    baseAnswers: Record<string, string | string[]>,
    baseOtherAnswers: Record<string, string> = otherAnswerState
  ) {
    const normalizedEntries = Object.entries(baseAnswers).flatMap(([questionId, value]) => {
      const otherValue = baseOtherAnswers[questionId]?.trim() ?? ""

      if (Array.isArray(value)) {
        const withoutOther = value.filter((item) => item !== OTHER_OPTION)
        const normalizedArray = otherValue ? [...withoutOther, otherValue] : withoutOther
        return normalizedArray.length ? [[questionId, normalizedArray] as const] : []
      }

      if (value === OTHER_OPTION) {
        return otherValue ? [[questionId, otherValue] as const] : []
      }

      return typeof value === "string" && value.trim() ? [[questionId, value] as const] : []
    })

    return Object.fromEntries(normalizedEntries) as Record<string, string | string[]>
  }

  async function handleGenerateAiDraft(answerOverride?: Record<string, string | string[]>) {
    if (!beforeResult) return
    setIsGeneratingDraft(true)
    const answers = normalizeAnswers(answerOverride ?? answerState)

    try {
      const sourcePrompt = promptRef.current ? readPromptValue(promptRef.current) : promptPreview
      const result = await refinePrompt({
        prompt: sourcePrompt || promptPreview,
        surface: getPromptSurface(),
        intent: beforeResult.intent,
        answers,
        sessionSummary: summarizeSessionMemory(currentSession)
      })
      setEditableDraft(result.improved_prompt)
      setAiDraftNotes(result.notes)
      setDraftReady(true)
    } catch {
      const sourcePrompt = promptRef.current ? readPromptValue(promptRef.current) : promptPreview
      setEditableDraft(buildPromptFromAnswers(sourcePrompt || promptPreview, answers))
      setAiDraftNotes(["AI draft generation failed, so a local fallback draft was created."])
      setDraftReady(true)
    } finally {
      setIsGeneratingDraft(false)
    }
  }

  async function handleAddQuestions() {
    if (!beforeResult) return
    setIsAddingQuestions(true)
    setQuestionLoadError(null)

    try {
      const sourcePrompt = promptRef.current ? readPromptValue(promptRef.current).trim() : promptPreview.trim()
      const result = await extendQuestions({
        prompt: sourcePrompt || promptPreview,
        surface: getPromptSurface(),
        intent: beforeResult.intent,
        existing_questions: beforeResult.clarification_questions,
        answers: normalizeAnswers(answerState),
        sessionSummary: summarizeSessionMemory(currentSession)
      })

      if (result.clarification_questions.length) {
        setBeforeResult({
          ...beforeResult,
          clarification_questions: [...beforeResult.clarification_questions, ...result.clarification_questions],
          question_source: "AI",
          ai_available: result.ai_available
        })
      } else {
        setQuestionLoadError("No more strong follow-up questions were available for this prompt yet.")
      }
    } catch (error) {
      setQuestionLoadError(error instanceof Error ? error.message : "Could not load more questions.")
    } finally {
      setIsAddingQuestions(false)
    }
  }

  function handleApplyFix() {
    const input = promptRef.current
    if (!input || !diagnosis?.improved_retry_prompt) return
    writePromptValue(input, diagnosis.improved_retry_prompt)
    setPanelOpen(false)
  }

  async function handleCopyFix() {
    if (!diagnosis?.improved_retry_prompt) return
    await navigator.clipboard.writeText(diagnosis.improved_retry_prompt)
  }

  function handleRetry() {
    handleApplyFix()
    setPanelOpen(false)
  }

  async function markWorked() {
    if (outcomeEventIdRef.current) {
      await sendFeedback(outcomeEventIdRef.current, "WORKED")
    }
    const nextSession = { ...currentSession, lastProbableStatus: "SUCCESS" as const }
    setSession(nextSession)
    await saveSessionSummary(nextSession)
    setIssueVisible(false)
    setPanelOpen(false)
  }

  async function markDidNotWork() {
    if (outcomeEventIdRef.current) {
      await sendFeedback(outcomeEventIdRef.current, "DID_NOT_WORK")
    }
    setIssueVisible(true)
    setPanelOpen(true)
  }

  async function dismissOnboarding() {
    setOnboardingVisible(false)
    setPanelOpen(false)
    await markOnboardingSeen()
  }

  async function syncPromptFromPage() {
    const latestInput = findPromptInput()
    if (latestInput) {
      promptRef.current = latestInput
      lastFocusedPromptRef.current = latestInput
      submitRef.current = findSubmitButton(latestInput)
      positionHost()
    }

    const sourceInput = latestInput ?? lastFocusedPromptRef.current ?? promptRef.current
    const prompt = sourceInput ? readPromptValue(sourceInput).trim() : lastPromptValueRef.current.trim()

    setPromptPreview(prompt.slice(0, 220))

    if (!prompt) {
      setBeforeResult(null)
      setIsAnalyzingPrompt(false)
      setQuestionLoadError(null)
      return null
    }

    const normalizedPrompt = prompt.trim()
    const alreadyAnalyzedSamePrompt = normalizedPrompt === lastAnalyzedPromptRef.current && beforeResult !== null
    if (alreadyAnalyzedSamePrompt) {
      setIsAnalyzingPrompt(false)
      return {
        prompt: normalizedPrompt,
        result: beforeResult
      }
    }

    const requestId = ++analysisRequestIdRef.current
    setIsAnalyzingPrompt(true)
    const result = analyzePromptLocally(prompt, summarizeSessionMemory(currentSession))

    if (requestId !== analysisRequestIdRef.current) {
      return
    }

    setBeforeResult(result)
    setAnswerState({})
    setOtherAnswerState({})
    setAiDraftNotes([])
    setEditableDraft("")
    setDraftReady(false)
    lastAnalyzedPromptRef.current = normalizedPrompt
    setIsAnalyzingPrompt(false)
    return {
      prompt: normalizedPrompt,
      result
    }
  }

  async function loadAiQuestionsForCurrentPrompt(sourcePrompt: string, current: AnalyzePromptResponse | null) {
    if (!current) return
    if (current.question_source === "AI" && current.clarification_questions.length > 0) return
    if (isLoadingQuestions) return

    setIsLoadingQuestions(true)
    setQuestionLoadError(null)

    try {
      let nextQuestions: AnalyzePromptResponse["clarification_questions"] = []
      let nextQuestionSource: AnalyzePromptResponse["question_source"] = "NONE"
      let nextAiAvailable = false
      let nextScore = current.score
      let nextIntent = current.intent
      let nextMissing = current.missing_elements
      let nextSuggestions = current.suggestions
      let nextRewrite = current.rewrite

      try {
        const extendResult = await extendQuestions({
          prompt: sourcePrompt,
          surface: getPromptSurface(),
          intent: current.intent,
          existing_questions: [],
          answers: {},
          sessionSummary: summarizeSessionMemory(currentSession)
        })

        nextQuestions = extendResult.clarification_questions.slice(0, 5)
        nextQuestionSource = extendResult.clarification_questions.length
          ? extendResult.ai_available
            ? "AI"
            : "FALLBACK"
          : "NONE"
        nextAiAvailable = extendResult.ai_available
      } catch (error) {
        nextAiAvailable = false
        setQuestionLoadError(error instanceof Error ? error.message : "AI question loading failed")
      }

      if (!nextAiAvailable) {
        try {
          const analyzeResult = await analyzePromptRemote({
            prompt: sourcePrompt,
            surface: getPromptSurface(),
            sessionSummary: summarizeSessionMemory(currentSession)
          })

          nextScore = analyzeResult.score
          nextIntent = analyzeResult.intent
          nextMissing = analyzeResult.missing_elements
          nextSuggestions = analyzeResult.suggestions
          nextRewrite = analyzeResult.rewrite

          if (analyzeResult.clarification_questions.length) {
            nextQuestions = analyzeResult.clarification_questions.slice(0, 5)
            nextQuestionSource = analyzeResult.ai_available ? "AI" : "FALLBACK"
            nextAiAvailable = analyzeResult.ai_available
            setQuestionLoadError(null)
          }
        } catch (error) {
          setQuestionLoadError((currentError) =>
            currentError ?? (error instanceof Error ? error.message : "AI question loading failed")
          )
          // Keep the local score-only state if both AI calls fail.
        }
      }

      setBeforeResult((previous) => {
        if (!previous) return previous

        return {
          ...previous,
          score: nextScore,
          intent: nextIntent,
          missing_elements: nextMissing,
          suggestions: nextSuggestions,
          rewrite: nextRewrite,
          clarification_questions: nextQuestions,
          question_source: nextQuestions.length ? nextQuestionSource : "NONE",
          ai_available: nextAiAvailable
        }
      })
    } finally {
      setIsLoadingQuestions(false)
    }
  }

  function updateDraft(
    nextAnswers: Record<string, string | string[]>,
    basePrompt?: string,
    nextOtherAnswers: Record<string, string> = otherAnswerState
  ) {
    const currentInput = promptRef.current ? readPromptValue(promptRef.current) : ""
    const sourcePrompt = basePrompt ?? currentInput ?? promptPreview
    setEditableDraft(buildPromptFromAnswers(sourcePrompt || promptPreview, normalizeAnswers(nextAnswers, nextOtherAnswers)))
  }

  function handleAnswerChange(question: ClarificationQuestion, value: string) {
    const nextAnswers = {
      ...answerState,
      [question.id]: value
    }
    setAnswerState(nextAnswers)
    setDraftReady(false)
    setAiDraftNotes([])
    updateDraft(nextAnswers)
  }

  function handleToggleMultiAnswer(question: ClarificationQuestion, value: string) {
    const currentValues = Array.isArray(answerState[question.id]) ? (answerState[question.id] as string[]) : []
    const nextValues = currentValues.includes(value)
      ? currentValues.filter((item) => item !== value)
      : [...currentValues, value]

    const nextAnswers = {
      ...answerState,
      [question.id]: nextValues
    }
    setAnswerState(nextAnswers)
    setDraftReady(false)
    setAiDraftNotes([])
    updateDraft(nextAnswers)
  }

  function handleOtherAnswerChange(question: ClarificationQuestion, value: string) {
    const nextOtherAnswers = {
      ...otherAnswerState,
      [question.id]: value
    }

    setOtherAnswerState(nextOtherAnswers)
    setDraftReady(false)
    setAiDraftNotes([])
    updateDraft(answerState, undefined, nextOtherAnswers)
  }

  function isAnswered(
    question: ClarificationQuestion,
    answers: Record<string, string | string[]>,
    otherAnswers: Record<string, string> = otherAnswerState
  ) {
    const value = answers[question.id]
    const otherValue = otherAnswers[question.id]?.trim() ?? ""
    return question.mode === "multi"
      ? Array.isArray(value) && value.length > 0 && (!value.includes(OTHER_OPTION) || otherValue.length > 0)
      : typeof value === "string" && value.trim().length > 0 && (value !== OTHER_OPTION || otherValue.length > 0)
  }

  function positionHost() {
    const host = document.getElementById("prompt-optimizer-root")
    const input = promptRef.current
    const submitButton = submitRef.current
    if (!host) return

    if (!input) {
      host.style.position = "fixed"
      host.style.top = "16px"
      host.style.right = "16px"
      host.style.left = "auto"
      return
    }

    if (submitButton) {
      const inputRect = input.getBoundingClientRect()
      const badgeTop = window.scrollY + inputRect.top - 26
      const badgeLeft = window.scrollX + inputRect.right - 28
      host.style.position = "absolute"
      host.style.top = `${badgeTop}px`
      host.style.left = `${badgeLeft}px`
      host.style.right = "auto"
      return
    }

    const rect = input.getBoundingClientRect()
    host.style.position = "absolute"
    host.style.top = `${window.scrollY + rect.top - 26}px`
    host.style.left = `${window.scrollX + rect.right - 28}px`
    host.style.right = "auto"
  }

  return (
    <>
      <OptimizerShell
        mounted={mounted}
        panelOpen={panelOpen}
        promptPreview={promptPreview}
        beforeResult={beforeResult}
        isAnalyzingPrompt={isAnalyzingPrompt}
        diagnosis={diagnosis}
        detection={detection}
        session={session}
        onboardingVisible={onboardingVisible}
        issueVisible={hasSubmittedPrompt && issueVisible}
        answerState={answerState}
        otherAnswerState={otherAnswerState}
        editableDraft={editableDraft}
        aiDraftNotes={aiDraftNotes}
        isGeneratingDraft={isGeneratingDraft}
        isAddingQuestions={isAddingQuestions}
        answeredCount={
          (beforeResult?.clarification_questions ?? []).filter((question) =>
            isAnswered(question, answerState, otherAnswerState)
          ).length
        }
        totalQuestions={beforeResult?.clarification_questions?.length ?? 0}
        draftReady={draftReady}
        isLoadingQuestions={isLoadingQuestions}
        isEvaluatingAfterResponse={isEvaluatingAfterResponse}
        onClosePanel={() => setPanelOpen(false)}
        onOpenPanel={() => {
          void syncPromptFromPage().then((snapshot) => {
            if (!snapshot) return
            void loadAiQuestionsForCurrentPrompt(snapshot.prompt, snapshot.result)
          })
          setPanelOpen(true)
        }}
        onOpenAfterPanel={() => void handleOpenAfterPanel()}
        onRewrite={handleRewrite}
        onExplain={() => void handleExplain()}
        onApplyFix={handleApplyFix}
        onCopyFix={() => void handleCopyFix()}
        onRetry={handleRetry}
        onDismissOnboarding={() => void dismissOnboarding()}
        onWorked={() => void markWorked()}
        onDidNotWork={() => void markDidNotWork()}
        onAnswerChange={handleAnswerChange}
        onToggleMultiAnswer={handleToggleMultiAnswer}
        onOtherAnswerChange={handleOtherAnswerChange}
        onDraftChange={setEditableDraft}
        onReplacePrompt={handleReplacePrompt}
        onGenerateAiDraft={() => void handleGenerateAiDraft()}
        onAddQuestions={() => void handleAddQuestions()}
      />
      {afterVerdict ? (
        <AfterVerdictPanel
          verdict={afterVerdict}
          isEvaluating={isEvaluatingAfterResponse}
          onCopyNextPrompt={() => void navigator.clipboard.writeText(afterVerdict.next_prompt)}
          onRunDeepAnalysis={() => void handleRunDeepAnalysis()}
          onClose={() => setAfterVerdict(null)}
        />
      ) : null}
    </>
  )
}
