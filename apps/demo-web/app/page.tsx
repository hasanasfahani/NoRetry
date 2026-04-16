"use client"

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react"
import {
  type AfterAnalysisResult,
  analyzePromptLocally,
  buildAttemptIntentFromSubmittedPrompt,
  detectIntent,
  preprocessResponse,
  type AnalyzePromptResponse,
  type ClarificationQuestion,
  type ExtendQuestionsResponse,
  type PromptIntent,
  type RefinePromptResponse
} from "@prompt-optimizer/shared"
import { ReviewPopup } from "../components/review-popup/review/ReviewPopup"
import type { ReviewPopupViewModel } from "../components/review-popup/review/review-types"
import type { PopupAction } from "../components/review-popup/shared/types"
import { buildPromptModeFallbackQuestions, formatPromptModeStructuredDraft } from "../lib/prompt-mode"
import { buildLevelMap, findNextUnansweredQuestionIndex, mergeUniqueQuestions, normalizePlannerAnswers } from "@prompt-optimizer/extension/lib/core/after-orchestration"
import { buildReviewErrorViewModel, buildReviewLoadingViewModel, mapAfterAnalysisToReviewViewModel } from "@prompt-optimizer/extension/lib/review/mappers/review-view-model"
import { classifyReviewTaskType } from "@prompt-optimizer/extension/lib/review/services/review-task-type"
import type { ReviewPromptModeState, ReviewPopupSurface } from "@prompt-optimizer/extension/lib/review/types"

const API_BASE = process.env.NEXT_PUBLIC_REEVA_API_URL?.replace(/\/$/, "") || "http://localhost:3000"
const OTHER_OPTION = "Other"

function LogoMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" rx="24" fill="#2f6efb" />
      <circle cx="50" cy="50" r="33" fill="none" stroke="#fff" strokeWidth="7" />
      <circle cx="50" cy="50" r="22" fill="none" stroke="#fff" strokeWidth="7" />
      <circle cx="50" cy="50" r="11" fill="none" stroke="#fff" strokeWidth="7" />
      <circle cx="50" cy="50" r="3" fill="#fff" />
    </svg>
  )
}

function formatChecklistStatus(status: string) {
  if (status === "met") return "Confirmed"
  if (status === "missed") return "Missing"
  if (status === "not_sure") return "Needs review"
  if (status === "blocked") return "Blocked"
  return status
}

function dedupeQuestions(questions: ClarificationQuestion[]) {
  const seen = new Set<string>()

  return questions.filter((question) => {
    const key = `${question.id}:${question.label}`.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function buildVisibleOptions(question: ClarificationQuestion) {
  const options = question.options.filter(Boolean)
  return options.includes(OTHER_OPTION) ? options : [...options, OTHER_OPTION]
}

function isMulti(question: ClarificationQuestion) {
  return question.mode === "multi"
}

function normalizeAnswerValue(question: ClarificationQuestion, answer: string | string[] | undefined, otherDraft: string | undefined) {
  if (!answer) return ""

  if (Array.isArray(answer)) {
    return answer.map((item) => item.trim()).filter(Boolean).join(", ")
  }

  if (answer === OTHER_OPTION) {
    return otherDraft?.trim() ?? ""
  }

  return answer.trim()
}

function buildAnsweredPath(
  questions: ClarificationQuestion[],
  answers: Record<string, string | string[]>,
  otherDrafts: Record<string, string>
) {
  return questions
    .map((question) => {
      const value = normalizeAnswerValue(question, answers[question.id], otherDrafts[question.id])
      return value ? `${question.label}: ${value}` : ""
    })
    .filter(Boolean)
}

function buildPromptConstraints(
  questions: ClarificationQuestion[],
  answers: Record<string, string | string[]>,
  otherDrafts: Record<string, string>
) {
  return questions
    .map((question) => normalizeAnswerValue(question, answers[question.id], otherDrafts[question.id]))
    .filter(Boolean)
}

export default function DemoPage() {
  const promptSectionRef = useRef<HTMLElement | null>(null)
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null)
  const [prompt, setPrompt] = useState("")
  const [activePrompt, setActivePrompt] = useState("")
  const [assistantAnswer, setAssistantAnswer] = useState("")
  const [renderedAnswer, setRenderedAnswer] = useState("")
  const [answerState, setAnswerState] = useState<"idle" | "loading" | "complete">("idle")

  const [popupOpen, setPopupOpen] = useState(false)
  const [popupSurface, setPopupSurface] = useState<ReviewPopupSurface>("prompt_mode")
  const [promptBootLoading, setPromptBootLoading] = useState(false)
  const [promptLoading, setPromptLoading] = useState(false)
  const [promptStatus, setPromptStatus] = useState("Reading your prompt...")
  const [promptIntent, setPromptIntent] = useState<PromptIntent>("OTHER")
  const [promptAnalysis, setPromptAnalysis] = useState<AnalyzePromptResponse | null>(null)
  const [questions, setQuestions] = useState<ClarificationQuestion[]>([])
  const [questionLevels, setQuestionLevels] = useState<Record<string, number>>({})
  const [currentLevelQuestions, setCurrentLevelQuestions] = useState<ClarificationQuestion[]>([])
  const [currentLevel, setCurrentLevel] = useState(1)
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [otherDrafts, setOtherDrafts] = useState<Record<string, string>>({})
  const [refineLoading, setRefineLoading] = useState(false)
  const [improvedPrompt, setImprovedPrompt] = useState("")
  const [refineNotes, setRefineNotes] = useState<string[]>([])

  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysis, setAnalysis] = useState<AfterAnalysisResult | null>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)

  const [waitlistName, setWaitlistName] = useState("")
  const [waitlistEmail, setWaitlistEmail] = useState("")
  const [waitlistLoading, setWaitlistLoading] = useState(false)
  const [waitlistMessage, setWaitlistMessage] = useState("")
  const autoAdvanceKeyRef = useRef("")
  const answerRequestIdRef = useRef(0)

  useEffect(() => {
    if (answerState !== "loading" || !assistantAnswer) return

    setRenderedAnswer("")
    let index = 0
    const timer = window.setInterval(() => {
      index += Math.max(1, Math.ceil(assistantAnswer.length / 90))
      setRenderedAnswer(assistantAnswer.slice(0, index))

      if (index >= assistantAnswer.length) {
        window.clearInterval(timer)
        setRenderedAnswer(assistantAnswer)
        setAnswerState("complete")
      }
    }, 28)

    return () => window.clearInterval(timer)
  }, [answerState, assistantAnswer])

  const currentQuestion = questions[activeQuestionIndex] ?? null
  const visiblePrompt = improvedPrompt || prompt
  const analysisReady = answerState === "complete" && renderedAnswer.trim().length > 0
  const canSubmitPrompt = visiblePrompt.trim().length > 0 && answerState !== "loading"
  const answeredPath = useMemo(() => buildAnsweredPath(questions, answers, otherDrafts), [questions, answers, otherDrafts])
  const promptConstraints = useMemo(() => buildPromptConstraints(questions, answers, otherDrafts), [questions, answers, otherDrafts])

  const primaryAction = useMemo(() => {
    if (analysisReady) {
      return {
        mode: "analysis" as const,
        label: "Analyze"
      }
    }

    return {
      mode: "prompt" as const,
      label: "reeva AI"
    }
  }, [analysisReady])

  useEffect(() => {
    if (!currentQuestion || promptLoading || refineLoading) return
    if (activeQuestionIndex >= questions.length - 1) return

    const activeAnswer = answers[currentQuestion.id]
    const normalized = normalizeAnswerValue(currentQuestion, activeAnswer, otherDrafts[currentQuestion.id])
    if (!normalized) return
    if (activeAnswer === OTHER_OPTION) return

    const key = `${currentQuestion.id}:${normalized}:${activeQuestionIndex}`
    if (autoAdvanceKeyRef.current === key) return
    autoAdvanceKeyRef.current = key

    const timer = window.setTimeout(() => {
      setActiveQuestionIndex((index) => Math.min(index + 1, questions.length - 1))
    }, 110)

    return () => window.clearTimeout(timer)
  }, [currentQuestion, answers, otherDrafts, activeQuestionIndex, questions.length, promptLoading, refineLoading])

  async function fetchJson<T>(path: string, body: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    })

    const data = (await response.json().catch(() => null)) as T & { error?: string } | null

    if (!response.ok) {
      throw new Error(data?.error || "Request failed.")
    }

    return data as T
  }

  async function openPromptMode() {
    const nextPrompt = prompt.trim()
    if (!nextPrompt) return

    setPopupSurface("prompt_mode")
    setPopupOpen(true)
    setPromptBootLoading(true)
    setPromptLoading(true)
    setPromptStatus("Reading your prompt...")
    const instantAnalysis = analyzePromptLocally(nextPrompt)
    const instantFallback = buildPromptModeFallbackQuestions({
      promptText: nextPrompt,
      localAnalysis: instantAnalysis
    })
    setPromptAnalysis(instantAnalysis)
    setPromptIntent(instantAnalysis.intent)
    const seededQuestions = dedupeQuestions(instantFallback.questionHistory)
    setQuestions(seededQuestions)
    setQuestionLevels(buildLevelMap(seededQuestions, 1))
    setCurrentLevelQuestions(seededQuestions)
    setCurrentLevel(1)
    setActiveQuestionIndex(0)
    setAnswers({})
    setOtherDrafts({})
    setImprovedPrompt("")
    setRefineNotes([])

    try {
      const analysisResult = await fetchJson<AnalyzePromptResponse>(`${API_BASE}/api/analyze-prompt`, {
        prompt: nextPrompt,
        surface: "CHATGPT"
      })

      setPromptAnalysis(analysisResult)
      setPromptIntent(analysisResult.intent)

      let nextQuestions = dedupeQuestions(analysisResult.clarification_questions || [])

      if (!nextQuestions.length) {
        setPromptStatus("Preparing the first question...")
        const extended = await fetchJson<ExtendQuestionsResponse>(`${API_BASE}/api/extend-questions`, {
          prompt: nextPrompt,
          surface: "CHATGPT",
          intent: analysisResult.intent,
          existing_questions: [],
          answers: {}
        })
        nextQuestions = dedupeQuestions(extended.clarification_questions || [])
      }

      if (!nextQuestions.length) {
        const fallback = buildPromptModeFallbackQuestions({
          promptText: nextPrompt,
          localAnalysis: analysisResult
        })
        nextQuestions = dedupeQuestions(fallback.questionHistory)
      }

      setQuestions(nextQuestions)
      setQuestionLevels(buildLevelMap(nextQuestions, 1))
      setCurrentLevelQuestions(nextQuestions)
      setCurrentLevel(1)
      setActiveQuestionIndex(0)
      setPromptStatus("Preparing the first question...")
    } catch (error) {
      setPromptStatus(error instanceof Error ? error.message : "Unable to start prompt mode.")
    } finally {
      setPromptLoading(false)
      setPromptBootLoading(false)
    }
  }

  async function advanceQuestion(nextAnswers: Record<string, string | string[]>) {
    const nextUnansweredIndex = findNextUnansweredQuestionIndex({
      currentLevelQuestions,
      answerState: Object.fromEntries(
        Object.entries(nextAnswers).map(([key, value]) => [key, Array.isArray(value) ? value[0] ?? "" : value ?? ""])
      ),
      otherAnswerState: otherDrafts,
      otherOption: OTHER_OPTION
    })

    if (nextUnansweredIndex >= 0) {
      const nextQuestion = currentLevelQuestions[nextUnansweredIndex]
      const historyIndex = questions.findIndex((question) => question.id === nextQuestion?.id)
      if (historyIndex >= 0) {
        setActiveQuestionIndex(historyIndex)
      }
      return
    }

    setPromptLoading(true)
    setPromptStatus("Preparing the next question...")

    try {
      const extended = await fetchJson<ExtendQuestionsResponse>(`${API_BASE}/api/extend-questions`, {
        prompt: prompt.trim(),
        surface: "CHATGPT",
        intent: promptIntent,
        existing_questions: questions,
        answers: normalizePlannerAnswers({
          answerState: Object.fromEntries(
            Object.entries(nextAnswers).map(([key, value]) => [key, Array.isArray(value) ? value[0] ?? "" : value ?? ""])
          ),
          otherAnswerState: otherDrafts,
          otherOption: OTHER_OPTION
        })
      })

      const returnedQuestions = dedupeQuestions(extended.clarification_questions || [])
      if (returnedQuestions.length) {
        const nextLevel = currentLevel + 1
        const mergedQuestions = mergeUniqueQuestions(questions, returnedQuestions)
        setQuestions(mergedQuestions)
        setQuestionLevels((current) => ({
          ...current,
          ...buildLevelMap(returnedQuestions, nextLevel)
        }))
        setCurrentLevelQuestions(returnedQuestions)
        setCurrentLevel(nextLevel)
        setActiveQuestionIndex(questions.length)
        setPromptStatus("Preparing the next question...")
        return
      }

      const fallback = buildPromptModeFallbackQuestions({
        promptText: prompt.trim(),
        localAnalysis: promptAnalysis ?? {
          score: "MID",
          intent: promptIntent,
          missing_elements: [],
          suggestions: [],
          rewrite: null,
          clarification_questions: [],
          draft_prompt: null,
          question_source: "FALLBACK",
          ai_available: false
        }
      })

      const returnedFallback = dedupeQuestions(
        fallback.questionHistory.filter((question) => !questions.some((existing) => existing.id === question.id))
      )

      if (returnedFallback.length) {
        const nextLevel = currentLevel + 1
        const mergedQuestions = mergeUniqueQuestions(questions, returnedFallback)
        setQuestions(mergedQuestions)
        setQuestionLevels((current) => ({
          ...current,
          ...buildLevelMap(returnedFallback, nextLevel)
        }))
        setCurrentLevelQuestions(returnedFallback)
        setCurrentLevel(nextLevel)
        setActiveQuestionIndex(questions.length)
      }
      setPromptStatus("Preparing the next question...")
    } catch (error) {
      setPromptStatus(error instanceof Error ? error.message : "Unable to load the next question.")
    } finally {
      setPromptLoading(false)
    }
  }

  async function chooseOption(question: ClarificationQuestion, option: string) {
    if (option === OTHER_OPTION) {
      setAnswers((current) => ({
        ...current,
        [question.id]: OTHER_OPTION
      }))
      return
    }

    const current = answers[question.id]
    let nextValue: string | string[]

    if (isMulti(question)) {
      const list = Array.isArray(current) ? current : typeof current === "string" ? [current] : []
      nextValue = list.includes(option) ? list.filter((item) => item !== option) : [...list, option]
      if (!(nextValue as string[]).length) {
        nextValue = []
      }
    } else {
      nextValue = option
    }

    const nextAnswers = {
      ...answers,
      [question.id]: nextValue
    }

    setAnswers(nextAnswers)

    if (!isMulti(question)) {
      await advanceQuestion(nextAnswers)
    }
  }

  async function submitOther(question: ClarificationQuestion) {
    const value = otherDrafts[question.id]?.trim()
    if (!value) return

    const nextAnswers = {
      ...answers,
      [question.id]: isMulti(question) ? [value] : value
    }

    setAnswers(nextAnswers)
    await advanceQuestion(nextAnswers)
  }

  async function generatePrompt() {
    const nextPrompt = prompt.trim()
    if (!nextPrompt) return

    setRefineLoading(true)
    setPromptStatus("Building the decision path for a stronger prompt...")

    try {
      const refined = await fetchJson<RefinePromptResponse>(`${API_BASE}/api/refine-prompt`, {
        prompt: nextPrompt,
        surface: "CHATGPT",
        intent: promptIntent,
        answers
      })

      const structuredPrompt = formatPromptModeStructuredDraft({
        sourcePrompt: nextPrompt,
        planningGoal: nextPrompt,
        refinedPrompt: refined.improved_prompt,
        localAnalysis:
          promptAnalysis ?? {
            score: "MID",
            intent: promptIntent,
            missing_elements: [],
            suggestions: [],
            rewrite: null,
            clarification_questions: [],
            draft_prompt: null,
            question_source: "FALLBACK",
            ai_available: false
          },
        answeredPath,
        constraints: promptConstraints
      })

      setImprovedPrompt(structuredPrompt)
      setRefineNotes(refined.notes)
      setPromptStatus("Ready — let’s make your prompt harder to misread.")
    } catch (error) {
      setPromptStatus(error instanceof Error ? error.message : "Unable to generate an improved prompt.")
    } finally {
      setRefineLoading(false)
    }
  }

  async function submitPrompt() {
    const nextPrompt = visiblePrompt.trim()
    if (!nextPrompt) return
    const requestId = ++answerRequestIdRef.current

    setActivePrompt(nextPrompt)
    setAssistantAnswer("")
    setRenderedAnswer("")
    setAnswerState("loading")
    setAnalysis(null)
    setAnalysisError(null)
    setAnalysisLoading(false)
    setPopupOpen(false)

    try {
      const result = await fetchJson<{ answer: string }>("/api/demo-answer", { prompt: nextPrompt })
      if (requestId !== answerRequestIdRef.current) return
      setAssistantAnswer(result.answer)
    } catch (error) {
      if (requestId !== answerRequestIdRef.current) return
      setAssistantAnswer(error instanceof Error ? error.message : "The demo answer could not be generated.")
    }
  }

  function revealPromptEditor() {
    window.requestAnimationFrame(() => {
      promptSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      })

      window.setTimeout(() => {
        promptInputRef.current?.focus()
        promptInputRef.current?.setSelectionRange(promptInputRef.current.value.length, promptInputRef.current.value.length)
      }, 180)
    })
  }

  async function openAnalysisMode() {
    if (!analysisReady || !activePrompt.trim()) return

    setPopupSurface("answer_mode")
    setPopupOpen(true)

    if (analysis || analysisLoading) return

    setAnalysisLoading(true)
    setAnalysisError(null)

    try {
      const intent = detectIntent(activePrompt)
      const attemptIntent = buildAttemptIntentFromSubmittedPrompt(activePrompt, intent)
      const now = new Date().toISOString()

      const result = await fetchJson<AfterAnalysisResult>(`${API_BASE}/api/analyze-after`, {
        attempt: {
          attempt_id: `demo-${Date.now()}`,
          platform: "chatgpt",
          raw_prompt: activePrompt,
          optimized_prompt: activePrompt,
          intent: attemptIntent,
          status: "submitted",
          created_at: now,
          submitted_at: now,
          response_text: renderedAnswer,
          response_message_id: null,
          analysis_result: null,
          token_usage_total: 0,
          stage_cache: {}
        },
        response_summary: preprocessResponse(renderedAnswer),
        response_text_fallback: renderedAnswer,
        deep_analysis: true,
        baseline_acceptance_criteria: [],
        baseline_acceptance_checklist: [],
        baseline_review_contract: null,
        project_context: "reeva AI event demo web app",
        current_state: "Visitor is testing a prompt and answer flow inside the standalone demo.",
        error_summary: null,
        changed_file_paths_summary: []
      })

      setAnalysis(result)
    } catch (error) {
      setAnalysis(null)
      setAnalysisError(error instanceof Error ? error.message : "The analysis service is unavailable right now.")
    } finally {
      setAnalysisLoading(false)
    }
  }

  async function submitWaitlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setWaitlistLoading(true)
    setWaitlistMessage("")

    try {
      const result = await fetchJson<{ message: string }>("/api/waitlist", {
        name: waitlistName,
        email: waitlistEmail
      })
      setWaitlistMessage(result.message)
      setWaitlistName("")
      setWaitlistEmail("")
    } catch (error) {
      setWaitlistMessage(error instanceof Error ? error.message : "Unable to join the waitlist.")
    } finally {
      setWaitlistLoading(false)
    }
  }

  const promptModeState: ReviewPromptModeState = {
    popupState: promptStatus.toLowerCase().includes("unable")
      ? "error"
      : promptBootLoading
        ? "loading"
        : questions.length || improvedPrompt
        ? "questions"
        : "questions",
    sessionKey: "demo-session",
    sourcePrompt: prompt,
    planningGoal: prompt,
    planningAttempt: null,
    analysisSeed: null,
    localAnalysis: promptAnalysis,
    questionHistory: questions,
    questionLevels,
    currentLevelQuestions,
    currentLevel,
    activeQuestionIndex,
    answerState: Object.fromEntries(
      Object.entries(answers).map(([key, value]) => [key, Array.isArray(value) ? value[0] ?? "" : value ?? ""])
    ),
    otherAnswerState: otherDrafts,
    isLoadingQuestions: promptLoading,
    isGeneratingPrompt: refineLoading,
    promptDraft: improvedPrompt,
    promptReady: Boolean(improvedPrompt),
    errorMessage: promptStatus.toLowerCase().includes("unable") ? promptStatus : null
  }

  const promptActions: PopupAction[] = improvedPrompt
    ? [
        {
          id: "copy-improved-prompt",
          label: "Copy prompt",
          kind: "secondary",
          onClick: () => {
            if (navigator.clipboard?.writeText) {
              void navigator.clipboard.writeText(improvedPrompt)
            }
          }
        },
        {
          id: "use-improved-prompt",
          label: "Submit prompt",
          kind: "primary",
          onClick: () => {
            setPrompt(improvedPrompt)
            setImprovedPrompt("")
            setRefineNotes([])
            setPopupOpen(false)
            revealPromptEditor()
          }
        }
      ]
    : []

  const modeActions: PopupAction[] = [
    {
      id: "mode-prompt",
      label: "Prompt",
      kind: popupSurface === "prompt_mode" ? "primary" : "secondary",
      onClick: () => {
        setPopupSurface("prompt_mode")
        setPopupOpen(true)
      }
    },
    {
      id: "mode-answer",
      label: "Answer",
      kind: popupSurface === "answer_mode" ? "primary" : "secondary",
      disabled: !analysisReady,
      onClick: () => {
        if (!analysisReady) return
        void openAnalysisMode()
      }
    }
  ]

  const reviewViewModel: ReviewPopupViewModel = useMemo(() => {
    if (analysisLoading) {
      return buildReviewLoadingViewModel("deep")
    }

    if (analysisError) {
      return buildReviewErrorViewModel(analysisError, "deep")
    }

    if (!analysis) {
      return buildReviewLoadingViewModel("deep")
    }

    const taskType = classifyReviewTaskType({
      raw_prompt: activePrompt || prompt,
      optimized_prompt: activePrompt || prompt,
      intent: buildAttemptIntentFromSubmittedPrompt(activePrompt || prompt, detectIntent(activePrompt || prompt))
    })

    return mapAfterAnalysisToReviewViewModel({
      result: analysis,
      mode: "deep",
      taskType,
      quickBaseline: null,
      onCopyPrompt: () => {
        if (analysis.next_prompt && navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(analysis.next_prompt)
        }
      }
    })
  }, [analysis, analysisError, analysisLoading, activePrompt, prompt])

  return (
    <main style={styles.page}>
      <section style={styles.shell}>
        <div style={styles.hero}>
          <div style={styles.brandRow}>
            <LogoMark />
            <div>
              <div style={styles.brandName}>reeva AI</div>
              <div style={styles.brandLine}>The trust layer for AI.</div>
            </div>
          </div>
          <h1 style={styles.headline}>Try reeva AI in seconds</h1>
          <p style={styles.subheadline}>Enter a prompt and then click the reeva AI button.</p>
        </div>

        <section ref={promptSectionRef} style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.kicker}>Prompt playground</span>
            <span style={styles.modeChip}>{analysisReady ? "Answer ready" : "Prompt mode"}</span>
          </div>

          <div style={styles.promptWrap}>
            <textarea
              ref={promptInputRef}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask for a product recommendation, rewrite, HTML file, recipe, or explanation..."
              style={styles.promptInput}
            />

            <button
              type="button"
              onClick={primaryAction.mode === "analysis" ? openAnalysisMode : openPromptMode}
              className="pressable pressable-strong"
              style={{
                ...styles.reevaButton,
                ...(primaryAction.mode === "analysis" ? styles.reevaButtonActive : {})
              }}
            >
              <span style={styles.reevaButtonBadge}>{primaryAction.mode === "analysis" ? "Analyze" : "reeva AI"}</span>
            </button>
          </div>

          <div style={styles.runRow}>
            <button type="button" onClick={submitPrompt} className="pressable pressable-dark" style={styles.primaryCta} disabled={!canSubmitPrompt}>
              {answerState === "loading" ? "Generating answer..." : "Run prompt"}
            </button>
            <span style={styles.helperCopy}>
              {analysisReady
                ? "Now tap Analyze to see what reeva AI trusts, questions, or would tighten."
                : "While you’re typing, the floating button acts like the extension’s prompt mode."}
            </span>
          </div>
        </section>

        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.kicker}>Assistant answer</span>
            <span style={styles.modeChip}>{answerState === "complete" ? "Analysis available" : "Demo response"}</span>
          </div>
          <div style={styles.answerBox}>
            {renderedAnswer || "Your demo answer will appear here after you submit the prompt."}
          </div>
        </section>

        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.kicker}>Join the waitlist</span>
            <span style={styles.modeChip}>Event access</span>
          </div>
          <form onSubmit={submitWaitlist} style={styles.waitlistForm}>
            <input
              value={waitlistName}
              onChange={(event) => setWaitlistName(event.target.value)}
              placeholder="Name"
              style={styles.field}
            />
            <input
              value={waitlistEmail}
              onChange={(event) => setWaitlistEmail(event.target.value)}
              placeholder="Email"
              style={styles.field}
              type="email"
            />
            <button type="submit" className="pressable pressable-dark" style={styles.primaryCta} disabled={waitlistLoading}>
              {waitlistLoading ? "Joining..." : "Join the waitlist"}
            </button>
            {waitlistMessage ? <p style={styles.waitlistMessage}>{waitlistMessage}</p> : null}
          </form>
        </section>
      </section>

      <ReviewPopup
        open={popupOpen}
        surface={popupSurface}
        viewModel={reviewViewModel}
        promptModeState={promptModeState}
        modeActions={modeActions}
        promptActions={promptActions}
        onPromptQuestionIndexChange={setActiveQuestionIndex}
        onPromptAnswerChange={(questionId, value) => {
          const question = questions.find((item) => item.id === questionId)
          if (!question) return
          void chooseOption(question, value)
        }}
        onPromptOtherAnswerChange={(questionId, value) =>
          setOtherDrafts((drafts) => ({
            ...drafts,
            [questionId]: value
          }))
        }
        onPromptAdvanceOther={() => {
          const question = questions[activeQuestionIndex]
          if (!question) return
          if (question.mode === "multi") {
            void advanceQuestion(answers)
            return
          }
          void submitOther(question)
        }}
        onPromptGenerate={() => {
          void generatePrompt()
        }}
        onClose={() => setPopupOpen(false)}
      />
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    padding: "24px 14px 48px"
  },
  shell: {
    maxWidth: 520,
    margin: "0 auto",
    display: "grid",
    gap: 16
  },
  hero: {
    padding: "6px 4px 2px"
  },
  brandRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 18
  },
  brandName: {
    fontSize: 15,
    fontWeight: 700
  },
  brandLine: {
    fontSize: 13,
    color: "var(--muted)"
  },
  headline: {
    fontSize: 38,
    lineHeight: 1.02,
    margin: "0 0 10px",
    letterSpacing: "-0.04em"
  },
  subheadline: {
    margin: 0,
    color: "var(--muted)",
    fontSize: 16,
    lineHeight: 1.5
  },
  card: {
    background: "var(--panel)",
    border: "1px solid var(--line)",
    borderRadius: 24,
    padding: 18,
    boxShadow: "var(--shadow)",
    backdropFilter: "blur(14px)"
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
    gap: 8
  },
  kicker: {
    fontSize: 12,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "var(--muted)",
    fontWeight: 700
  },
  modeChip: {
    fontSize: 12,
    padding: "7px 10px",
    borderRadius: 999,
    background: "var(--brand-soft)",
    color: "var(--brand-deep)",
    fontWeight: 700
  },
  promptWrap: {
    position: "relative"
  },
  promptInput: {
    width: "100%",
    minHeight: 188,
    borderRadius: 22,
    border: "1px solid rgba(29, 46, 92, 0.12)",
    padding: "20px 18px 18px",
    paddingRight: 120,
    resize: "vertical",
    background: "rgba(255,255,255,0.96)",
    color: "var(--ink)",
    lineHeight: 1.55,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)"
  },
  reevaButton: {
    position: "absolute",
    top: 12,
    right: 12,
    background: "linear-gradient(135deg, #2f6efb 0%, #5d45ff 100%)",
    color: "#fff",
    borderRadius: 999,
    padding: "10px 14px",
    boxShadow: "0 16px 28px rgba(49, 73, 181, 0.28)"
  },
  reevaButtonActive: {
    background: "linear-gradient(135deg, #0d7d53 0%, #2daa6c 100%)"
  },
  reevaButtonBadge: {
    fontSize: 13,
    fontWeight: 700
  },
  improvedPromptBox: {
    marginTop: 14,
    padding: 14,
    borderRadius: 18,
    background: "rgba(47, 110, 251, 0.08)"
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--brand-deep)",
    marginBottom: 6
  },
  improvedPromptText: {
    margin: 0,
    whiteSpace: "pre-wrap",
    lineHeight: 1.6
  },
  noteList: {
    margin: "10px 0 0",
    paddingLeft: 18,
    color: "var(--muted)",
    lineHeight: 1.6
  },
  runRow: {
    display: "grid",
    gap: 10,
    marginTop: 14
  },
  primaryCta: {
    background: "var(--ink)",
    color: "#fff",
    borderRadius: 18,
    padding: "15px 16px",
    fontWeight: 700
  },
  helperCopy: {
    fontSize: 14,
    lineHeight: 1.5,
    color: "var(--muted)"
  },
  answerBox: {
    minHeight: 220,
    borderRadius: 22,
    border: "1px solid rgba(29, 46, 92, 0.1)",
    padding: 18,
    background: "rgba(255,255,255,0.96)",
    whiteSpace: "pre-wrap",
    lineHeight: 1.65
  },
  waitlistForm: {
    display: "grid",
    gap: 12
  },
  field: {
    width: "100%",
    borderRadius: 16,
    border: "1px solid rgba(29, 46, 92, 0.12)",
    padding: "14px 14px",
    background: "#fff"
  },
  waitlistMessage: {
    margin: 0,
    fontSize: 14,
    color: "var(--good)"
  },
  overlay: {},
  sheet: {},
  sheetHeader: {},
  sheetEyebrow: {},
  sheetTitle: {},
  closeButton: {},
  loadingBox: {},
  questionFlow: {},
  progressText: {},
  questionTitle: {},
  questionHelper: {},
  optionGrid: {},
  optionButton: {},
  optionButtonSelected: {},
  otherWrap: {},
  otherInput: {},
  secondaryCta: {},
  analysisFlow: {},
  verdictBox: {},
  verdictLabel: {},
  verdictSummary: {},
  checklist: {},
  checkItem: {},
  checkLabel: {},
  checkStatus: {},
  nextMoveBox: {},
  nextMoveText: {}
}
