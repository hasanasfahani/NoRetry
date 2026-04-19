"use client"

import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react"
import { ReevaLogo } from "../components/brand/ReevaLogo"
import {
  type AfterAnalysisResult,
  analyzePromptLocally,
  buildLevelMap,
  buildAttemptIntentFromSubmittedPrompt,
  buildPromptModeFallbackQuestions,
  detectIntent,
  findNextUnansweredQuestionIndex,
  formatPromptModeStructuredDraft,
  mergeUniqueQuestions,
  normalizePlannerAnswers,
  preprocessResponse,
  type AnalyzePromptResponse,
  type ClarificationQuestion,
  type ExtendQuestionsResponse,
  type PromptIntent,
  type RefinePromptResponse,
  classifyReviewTaskType
} from "@prompt-optimizer/shared"
import { ReviewPopup } from "../components/review-popup/review/ReviewPopup"
import { ProductTutorial } from "../components/onboarding/ProductTutorial"
import { StoryTutorial } from "../components/onboarding/StoryTutorial"
import type { ReviewPopupViewModel } from "../components/review-popup/review/review-types"
import type { PopupAction } from "../components/review-popup/shared/types"
import { buildReviewErrorViewModel, buildReviewLoadingViewModel, mapAfterAnalysisToReviewViewModel } from "../lib/review-view-model"
import { buildSmartReviewContract } from "../lib/smart-review-contract"
import type { ReviewPromptModeState, ReviewPopupSurface } from "../lib/review-types"
import type { ReviewContract } from "../../extension/lib/review/contracts"

const API_BASE = process.env.NEXT_PUBLIC_REEVA_API_URL?.replace(/\/$/, "") || "http://localhost:3000"
const OTHER_OPTION = "Other"

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

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return parts.filter(Boolean).map((part, index) => {
    const boldMatch = /^\*\*([^*]+)\*\*$/.exec(part)
    if (boldMatch) {
      return (
        <strong key={`inline-${index}`} style={styles.answerStrong}>
          {boldMatch[1]}
        </strong>
      )
    }
    return <Fragment key={`inline-${index}`}>{part}</Fragment>
  })
}

function renderAnswerRichText(text: string): ReactNode {
  const normalized = text.replace(/\r\n/g, "\n").trim()
  if (!normalized) return null

  const lines = normalized.split("\n")
  const blocks: ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]?.trim()
    if (!line) {
      index += 1
      continue
    }

    if (line.startsWith("```")) {
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !lines[index]?.trim().startsWith("```")) {
        codeLines.push(lines[index] ?? "")
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push(
        <pre key={`code-${index}`} style={styles.answerCodeBlock}>
          <code>{codeLines.join("\n")}</code>
        </pre>
      )
      continue
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line)
    if (headingMatch) {
      const level = headingMatch[1].length
      const content = headingMatch[2]
      const headingStyle =
        level === 1 ? styles.answerH1 : level === 2 ? styles.answerH2 : styles.answerH3
      blocks.push(
        <div key={`heading-${index}`} style={headingStyle}>
          {renderInlineMarkdown(content)}
        </div>
      )
      index += 1
      continue
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*[-*]\s+/, "").trim())
        index += 1
      }
      blocks.push(
        <ul key={`ul-${index}`} style={styles.answerList}>
          {items.map((item, itemIndex) => (
            <li key={`ul-item-${itemIndex}`} style={styles.answerListItem}>
              {renderInlineMarkdown(item)}
            </li>
          ))}
        </ul>
      )
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*\d+\.\s+/, "").trim())
        index += 1
      }
      blocks.push(
        <ol key={`ol-${index}`} style={styles.answerOrderedList}>
          {items.map((item, itemIndex) => (
            <li key={`ol-item-${itemIndex}`} style={styles.answerListItem}>
              {renderInlineMarkdown(item)}
            </li>
          ))}
        </ol>
      )
      continue
    }

    const paragraphLines: string[] = []
    while (
      index < lines.length &&
      lines[index]?.trim() &&
      !/^(#{1,3})\s+/.test(lines[index] ?? "") &&
      !/^\s*[-*]\s+/.test(lines[index] ?? "") &&
      !/^\s*\d+\.\s+/.test(lines[index] ?? "") &&
      !(lines[index]?.trim().startsWith("```"))
    ) {
      paragraphLines.push((lines[index] ?? "").trim())
      index += 1
    }

    blocks.push(
      <p key={`p-${index}`} style={styles.answerParagraph}>
        {renderInlineMarkdown(paragraphLines.join(" "))}
      </p>
    )
  }

  return blocks
}

export default function DemoPage() {
  const promptSectionRef = useRef<HTMLElement | null>(null)
  const promptPlaygroundRef = useRef<HTMLDivElement | null>(null)
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null)
  const promptOptimizeButtonRef = useRef<HTMLButtonElement | null>(null)
  const runPromptButtonRef = useRef<HTMLButtonElement | null>(null)
  const answerSectionRef = useRef<HTMLElement | null>(null)
  const analysisButtonRef = useRef<HTMLButtonElement | null>(null)
  const waitlistSectionRef = useRef<HTMLElement | null>(null)
  const [prompt, setPrompt] = useState("")
  const [activePrompt, setActivePrompt] = useState("")
  const [assistantAnswer, setAssistantAnswer] = useState("")
  const [renderedAnswer, setRenderedAnswer] = useState("")
  const [answerState, setAnswerState] = useState<"idle" | "loading" | "complete">("idle")

  const [popupOpen, setPopupOpen] = useState(false)
  const [popupSurface, setPopupSurface] = useState<ReviewPopupSurface>("prompt_mode")
  const [storyTutorialOpen, setStoryTutorialOpen] = useState(true)
  const [productTutorialOpen, setProductTutorialOpen] = useState(false)
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
  const [smartReviewContract, setSmartReviewContract] = useState<ReviewContract | null>(null)
  const [smartReviewLoading, setSmartReviewLoading] = useState(false)

  const [waitlistName, setWaitlistName] = useState("")
  const [waitlistEmail, setWaitlistEmail] = useState("")
  const [waitlistLoading, setWaitlistLoading] = useState(false)
  const [waitlistMessage, setWaitlistMessage] = useState("")
  const [toastMessage, setToastMessage] = useState("")
  const autoAdvanceKeyRef = useRef("")
  const answerRequestIdRef = useRef(0)
  const toastTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (answerState !== "loading" || !assistantAnswer) return

    setRenderedAnswer("")
    let index = 0
    const timer = window.setInterval(() => {
      index += Math.max(1, Math.ceil(assistantAnswer.length / 60))
      setRenderedAnswer(assistantAnswer.slice(0, index))

      if (index >= assistantAnswer.length) {
        window.clearInterval(timer)
        setRenderedAnswer(assistantAnswer)
        setAnswerState("complete")
      }
    }, 18)

    return () => window.clearInterval(timer)
  }, [answerState, assistantAnswer])

  const currentQuestion = questions[activeQuestionIndex] ?? null
  const fullAnswerText = useMemo(() => assistantAnswer.trim() || renderedAnswer.trim(), [assistantAnswer, renderedAnswer])
  const visiblePrompt = improvedPrompt || prompt
  const analysisReady = answerState === "complete" && fullAnswerText.length > 0
  const canSubmitPrompt = visiblePrompt.trim().length > 0 && answerState !== "loading"
  const showPromptOptimizeNudge =
    prompt.trim().length > 0 && answerState !== "complete" && !promptBootLoading && !promptLoading && !popupOpen
  const showAnalysisNudge = analysisReady && !analysisLoading && !popupOpen
  const answeredPath = useMemo(() => buildAnsweredPath(questions, answers, otherDrafts), [questions, answers, otherDrafts])
  const promptConstraints = useMemo(() => buildPromptConstraints(questions, answers, otherDrafts), [questions, answers, otherDrafts])

  const primaryAction = useMemo(
    () => ({
      mode: "prompt" as const,
      label: "AI Prompt Optimization"
    }),
    []
  )

  const productTutorialSteps = useMemo(
    () => [
      {
        id: "prompt-box",
        text: "اكتب برومبت قصير",
        targetRef: promptPlaygroundRef
      },
      {
        id: "prompt-optimize",
        text: "اكبس هنا واجب على اي عدد تريده من الاسئلة ثم اكبس Generate Prompt Now",
        targetRef: promptOptimizeButtonRef
      },
      {
        id: "run-prompt",
        text: "اكبس هنا بعد اضافة البرمبت",
        targetRef: runPromptButtonRef
      },
      {
        id: "ai-analysis",
        text: "اكبس هنا لتحليل الجواب واقتراح برومبت لتحسينه اذا كان غير مناسب",
        targetRef: analysisButtonRef
      },
      {
        id: "join-waitlist",
        text: (
          <>
            أضيفوا اسمكم وايميلكم لدعمنا و لتكونوا من اوائل الأشخاص يلي بيحصلوا على{" "}
            <span style={{ direction: "ltr", unicodeBidi: "isolate", display: "inline-block" }}>reeva AI</span>{" "}
            عند الإطلاق
          </>
        ),
        targetRef: waitlistSectionRef
      }
    ],
    []
  )

  useEffect(() => {
    if (!currentQuestion || promptLoading || refineLoading) return
    if (activeQuestionIndex >= questions.length - 1) return

    const activeAnswer = answers[currentQuestion.id]
    const normalized = normalizeAnswerValue(currentQuestion, activeAnswer, otherDrafts[currentQuestion.id])
    if (!normalized) return
    if (activeAnswer === OTHER_OPTION || (Array.isArray(activeAnswer) && activeAnswer.includes(OTHER_OPTION))) return

    const key = `${currentQuestion.id}:${normalized}:${activeQuestionIndex}`
    if (autoAdvanceKeyRef.current === key) return
    autoAdvanceKeyRef.current = key

    const timer = window.setTimeout(() => {
      setActiveQuestionIndex((index) => Math.min(index + 1, questions.length - 1))
    }, 110)

    return () => window.clearTimeout(timer)
  }, [currentQuestion, answers, otherDrafts, activeQuestionIndex, questions.length, promptLoading, refineLoading])

  useEffect(() => {
    if (answerState !== "complete" || !fullAnswerText) return
    window.requestAnimationFrame(() => {
      answerSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      })
    })
  }, [answerState, fullAnswerText])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current)
      }
    }
  }, [])

  function showToast(message: string) {
    setToastMessage(message)
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current)
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage("")
      toastTimerRef.current = null
    }, 3200)
  }

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
      setPromptBootLoading(false)
      setPromptLoading(false)
    }
  }

  async function advanceQuestion(nextAnswers: Record<string, string | string[]>) {
    const nextUnansweredIndex = findNextUnansweredQuestionIndex({
      currentLevelQuestions,
      answerState: nextAnswers,
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
          answerState: nextAnswers,
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

    if (answerState !== "idle" || assistantAnswer.trim() || renderedAnswer.trim()) {
      showToast("You can't run another prompt in this demo page. Refresh the page to run another prompt.")
      return
    }

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
    if (!analysisReady || !activePrompt.trim()) {
      showToast("No answer to analyze yet")
      return
    }

    setPopupSurface("answer_mode")
    setPopupOpen(true)

    if ((analysis && smartReviewContract) || analysisLoading || smartReviewLoading) return

    setAnalysisLoading(true)
    setSmartReviewLoading(true)
    setAnalysisError(null)

    try {
      const intent = detectIntent(activePrompt)
      const attemptIntent = buildAttemptIntentFromSubmittedPrompt(activePrompt, intent)
      const now = new Date().toISOString()
      const responseText = fullAnswerText
      const taskType = classifyReviewTaskType({
        raw_prompt: activePrompt,
        optimized_prompt: activePrompt,
        intent: attemptIntent
      })

      setSmartReviewContract(null)

      const [result, contract] = await Promise.all([
        fetchJson<AfterAnalysisResult>(`${API_BASE}/api/analyze-after`, {
          attempt: {
            attempt_id: `demo-${Date.now()}`,
            platform: "chatgpt",
            raw_prompt: activePrompt,
            optimized_prompt: activePrompt,
            intent: attemptIntent,
            status: "submitted",
            created_at: now,
            submitted_at: now,
            response_text: responseText,
            response_message_id: null,
            analysis_result: null,
            token_usage_total: 0,
            stage_cache: {}
          },
          response_summary: preprocessResponse(responseText),
          response_text_fallback: responseText,
          deep_analysis: true,
          baseline_acceptance_criteria: [],
          baseline_acceptance_checklist: [],
          baseline_review_contract: null,
          project_context: "reeva AI event demo web app",
          current_state: "Visitor is testing a prompt and answer flow inside the standalone demo.",
          error_summary: null,
          changed_file_paths_summary: []
        }),
        buildSmartReviewContract({
          promptText: activePrompt,
          responseText,
          taskType
        })
      ])

      setAnalysis(result)
      setSmartReviewContract(contract)
    } catch (error) {
      setAnalysis(null)
      setSmartReviewContract(null)
      setAnalysisError(error instanceof Error ? error.message : "The analysis service is unavailable right now.")
    } finally {
      setAnalysisLoading(false)
      setSmartReviewLoading(false)
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
      showToast(result.message)
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
    answerState: answers,
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
    if (analysisLoading || smartReviewLoading) {
      return buildReviewLoadingViewModel("deep")
    }

    if (analysisError) {
      return buildReviewErrorViewModel(analysisError, "deep")
    }

    if (!analysis) {
      return buildReviewLoadingViewModel("deep")
    }

    if (!smartReviewContract) {
      return buildReviewErrorViewModel("The smart analysis result is unavailable right now.", "deep")
    }

    const taskType = classifyReviewTaskType({
      raw_prompt: activePrompt || prompt,
      optimized_prompt: activePrompt || prompt,
      intent: buildAttemptIntentFromSubmittedPrompt(activePrompt || prompt, detectIntent(activePrompt || prompt))
    })

    return mapAfterAnalysisToReviewViewModel({
      result: analysis,
      reviewContract: smartReviewContract,
      mode: "deep",
      taskType,
      quickBaseline: null,
      onCopyPrompt: () => {
        const nextPrompt = (smartReviewContract?.copyPromptText || smartReviewContract?.promptText || analysis.next_prompt || "").trim()
        if (!nextPrompt) return
        setPrompt(nextPrompt)
        setActivePrompt(nextPrompt)
        setPopupSurface("prompt_mode")
        setPopupOpen(false)
        revealPromptEditor()
      }
    })
  }, [analysis, analysisError, analysisLoading, smartReviewLoading, activePrompt, prompt, smartReviewContract])

  return (
    <main style={styles.page}>
      <StoryTutorial
        open={storyTutorialOpen}
        onClose={(reason) => {
          setStoryTutorialOpen(false)
          if (reason === "complete") {
            window.setTimeout(() => setProductTutorialOpen(true), 180)
          }
        }}
      />
      <ProductTutorial
        open={productTutorialOpen}
        steps={productTutorialSteps}
        onClose={() => {
          setProductTutorialOpen(false)
          window.requestAnimationFrame(() => {
            window.scrollTo({ top: 0, behavior: "smooth" })
          })
        }}
      />
      {toastMessage ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            top: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1200,
            maxWidth: "min(92vw, 720px)",
            width: "fit-content",
            background: "rgba(17, 24, 39, 0.96)",
            color: "#fff",
            border: "1px solid rgba(7, 102, 254, 0.3)",
            boxShadow: "0 20px 48px rgba(15, 23, 42, 0.22)",
            borderRadius: 16,
            padding: "14px 18px",
            fontSize: 14,
            lineHeight: 1.45,
            fontWeight: 600
          }}
        >
          {toastMessage}
        </div>
      ) : null}
      <section style={styles.shell}>
        <div style={styles.hero}>
          <div style={styles.brandRow}>
            <div style={styles.brandStack}>
              <ReevaLogo width={220} height={56} priority />
              <div style={styles.brandLine}>Demo only</div>
            </div>
          </div>
        </div>

        <section ref={promptSectionRef} style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.kicker}>Prompt playground</span>
            <span style={styles.modeChip}>{analysisReady ? "Answer ready" : "Prompt mode"}</span>
          </div>

          <div ref={promptPlaygroundRef} style={styles.promptWrap}>
            <textarea
              ref={promptInputRef}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask for a product recommendation, rewrite, HTML file, recipe, or explanation..."
              style={styles.promptInput}
            />

            <button
              ref={promptOptimizeButtonRef}
              type="button"
              onClick={openPromptMode}
              className={`pressable pressable-strong${showPromptOptimizeNudge ? " cta-nudge" : ""}`}
              style={{
                ...styles.reevaButton
              }}
            >
              <span style={styles.reevaButtonBadge}>{primaryAction.label}</span>
            </button>
          </div>

          <div style={styles.runRow}>
            <button
              ref={runPromptButtonRef}
              type="button"
              onClick={submitPrompt}
              className={`pressable pressable-dark${answerState === "loading" ? " cta-loading" : ""}`}
              style={styles.primaryCta}
              disabled={!canSubmitPrompt}
            >
              {answerState === "loading" ? "Generating answer..." : "Run prompt"}
            </button>
            <span style={styles.helperCopy}>
              {analysisReady
                ? "Your answer is ready below. Review it and run Analyze from that section."
                : "While you’re typing, the floating button acts like the extension’s prompt mode."}
            </span>
          </div>
        </section>

        <section ref={answerSectionRef} style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.kicker}>Assistant answer</span>
            <button
              ref={analysisButtonRef}
              type="button"
              onClick={() => void openAnalysisMode()}
              className={`pressable pressable-strong${showAnalysisNudge ? " cta-nudge" : ""}`}
              style={styles.analysisHeaderButton}
            >
              AI Analysis
            </button>
          </div>
          <div style={styles.answerBox}>
            {renderedAnswer ? (
              <div style={styles.answerRichText}>{renderAnswerRichText(renderedAnswer)}</div>
            ) : (
              "Your demo answer will appear here after you submit the prompt."
            )}
          </div>
          {analysisReady ? (
            <div style={styles.answerActionRow}>
              <span style={styles.helperCopy}>Check whether reeva AI trusts the answer or would tighten the next move.</span>
            </div>
          ) : null}
        </section>

        <section ref={waitlistSectionRef} style={styles.card}>
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

        {productTutorialOpen ? <div aria-hidden="true" style={styles.tutorialScrollSpacer} /> : null}
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
    padding: "24px 14px 48px",
    background:
      "radial-gradient(circle at 12% 6%, rgba(7, 102, 254, 0.18), transparent 22%), radial-gradient(circle at 88% 78%, rgba(87, 201, 255, 0.12), transparent 18%)"
  },
  shell: {
    maxWidth: 520,
    margin: "0 auto",
    display: "grid",
    gap: 16
  },
  hero: {
    padding: "2px 4px 4px"
  },
  brandRow: {
    display: "flex",
    alignItems: "flex-start",
    marginBottom: 12
  },
  brandStack: {
    display: "grid",
    gap: 8
  },
  brandLine: {
    fontSize: 14,
    color: "rgba(225, 236, 255, 0.78)",
    fontWeight: 600,
    letterSpacing: "-0.01em"
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
    borderRadius: 28,
    padding: 18,
    boxShadow: "var(--shadow)",
    backdropFilter: "blur(18px)"
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
    color: "#dbe8ff",
    fontWeight: 700
  },
  promptWrap: {
    position: "relative"
  },
  promptInput: {
    width: "100%",
    minHeight: 188,
    borderRadius: 22,
    border: "1px solid rgba(255,255,255,0.12)",
    padding: "20px 18px 18px",
    paddingRight: 120,
    resize: "vertical",
    background: "rgba(8, 15, 32, 0.82)",
    color: "var(--ink)",
    lineHeight: 1.55,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)"
  },
  reevaButton: {
    position: "absolute",
    top: 12,
    right: 12,
    background: "#0766fe",
    color: "#fff",
    borderRadius: 999,
    padding: "10px 14px",
    boxShadow: "0 16px 28px rgba(7, 102, 254, 0.28)"
  },
  reevaButtonBadge: {
    fontSize: 13,
    fontWeight: 700
  },
  improvedPromptBox: {
    marginTop: 14,
    padding: 14,
    borderRadius: 18,
    background: "rgba(7, 102, 254, 0.12)"
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
    background: "linear-gradient(135deg, #0766fe 0%, #2d8cff 100%)",
    color: "#fff",
    borderRadius: 18,
    padding: "15px 16px",
    fontWeight: 700,
    boxShadow: "0 20px 36px rgba(7, 102, 254, 0.26)"
  },
  helperCopy: {
    fontSize: 14,
    lineHeight: 1.5,
    color: "var(--muted)"
  },
  answerBox: {
    minHeight: 220,
    borderRadius: 22,
    border: "1px solid rgba(255,255,255,0.12)",
    padding: 18,
    background: "rgba(8, 15, 32, 0.82)",
    lineHeight: 1.65
  },
  answerRichText: {
    display: "grid",
    gap: 12
  },
  answerH1: {
    margin: 0,
    fontSize: 30,
    lineHeight: 1.1,
    fontWeight: 900,
    color: "#f8fbff",
    letterSpacing: "-0.03em"
  },
  answerH2: {
    margin: 0,
    fontSize: 23,
    lineHeight: 1.15,
    fontWeight: 850,
    color: "#f8fbff",
    letterSpacing: "-0.02em"
  },
  answerH3: {
    margin: 0,
    fontSize: 18,
    lineHeight: 1.2,
    fontWeight: 800,
    color: "#eef4ff"
  },
  answerParagraph: {
    margin: 0,
    color: "rgba(236, 243, 255, 0.88)",
    fontSize: 16,
    lineHeight: 1.7
  },
  answerStrong: {
    color: "#ffffff",
    fontWeight: 800
  },
  answerList: {
    margin: 0,
    paddingLeft: 20,
    display: "grid",
    gap: 8,
    color: "rgba(236, 243, 255, 0.88)"
  },
  answerOrderedList: {
    margin: 0,
    paddingLeft: 22,
    display: "grid",
    gap: 8,
    color: "rgba(236, 243, 255, 0.88)"
  },
  answerListItem: {
    fontSize: 15,
    lineHeight: 1.65
  },
  answerCodeBlock: {
    margin: 0,
    padding: "14px 15px",
    borderRadius: 16,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "#dfeaff",
    overflowX: "auto",
    fontSize: 14,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap"
  },
  answerActionRow: {
    display: "grid",
    gap: 10,
    marginTop: 14
  },
  analysisHeaderButton: {
    background: "#0766fe",
    color: "#fff",
    borderRadius: 999,
    padding: "10px 14px",
    fontWeight: 700,
    boxShadow: "0 16px 28px rgba(7, 102, 254, 0.22)"
  },
  waitlistForm: {
    display: "grid",
    gap: 12
  },
  field: {
    width: "100%",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.12)",
    padding: "14px 14px",
    background: "rgba(8, 15, 32, 0.82)",
    color: "#f7fbff"
  },
  waitlistMessage: {
    margin: 0,
    fontSize: 14,
    color: "var(--good)"
  },
  tutorialScrollSpacer: {
    height: 340
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
