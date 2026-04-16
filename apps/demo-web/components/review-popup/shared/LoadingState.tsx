import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"

type LoadingMode = "answer" | "prompt"

type LoadingStateProps = {
  mode: LoadingMode
  complete?: boolean
  onComplete?: () => void
}

type LoadingStage = {
  threshold: number
  status: string
  support: string
}

const ANSWER_STAGES: LoadingStage[] = [
  {
    threshold: 0,
    status: "Reading the latest answer...",
    support: "reeva AI is scanning the latest assistant reply before judging how trustworthy it really is."
  },
  {
    threshold: 15,
    status: "Separating confidence from correctness...",
    support: "It is distinguishing polished language from claims that are actually supported."
  },
  {
    threshold: 35,
    status: "Checking for missing context and weak assumptions...",
    support: "It is looking for missing framing, hidden assumptions, and context gaps that could distort the verdict."
  },
  {
    threshold: 55,
    status: "Looking for claims that deserve proof...",
    support: "It is isolating claims that sound plausible but still need visible support."
  },
  {
    threshold: 75,
    status: "Spotting blind spots, gaps, and risky leaps...",
    support: "It is tightening the review around weak links, unproven leaps, and risky omissions."
  },
  {
    threshold: 90,
    status: "Turning the analysis into a clear verdict...",
    support: "It is converting the review into a verdict that is easier to trust and act on."
  },
  {
    threshold: 100,
    status: "Done — your answer now has a trust check.",
    support: "The analysis is ready."
  }
]

const PROMPT_STAGES: LoadingStage[] = [
  {
    threshold: 0,
    status: "Reading your prompt...",
    support: "reeva AI is starting from your exact wording so the next question is grounded in what you actually mean."
  },
  {
    threshold: 15,
    status: "Checking what the AI may misunderstand...",
    support: "It is spotting where the current draft could be read the wrong way."
  },
  {
    threshold: 35,
    status: "Finding what is missing, vague, or underspecified...",
    support: "It is pulling out the gaps that matter most before the next question is asked."
  },
  {
    threshold: 55,
    status: "Choosing the most important clarification first...",
    support: "It is deciding which clarification will strengthen the prompt the fastest."
  },
  {
    threshold: 75,
    status: "Building the decision path for a stronger prompt...",
    support: "It is shaping the branch logic so the prompt can improve through the shortest useful path."
  },
  {
    threshold: 90,
    status: "Preparing the first question...",
    support: "It is packaging the next question so the prompt tree starts clearly, not mechanically."
  },
  {
    threshold: 100,
    status: "Ready — let’s make your prompt harder to misread.",
    support: "The first step is ready."
  }
]

function getProgress(elapsedMs: number) {
  if (elapsedMs <= 900) {
    return 25 * (elapsedMs / 900)
  }

  if (elapsedMs <= 4100) {
    return 25 + 55 * ((elapsedMs - 900) / 3200)
  }

  const tailElapsed = elapsedMs - 4100
  return Math.min(94.8, 80 + 15 * (1 - Math.exp(-tailElapsed / 2200)))
}

function stageForProgress(stages: LoadingStage[], progress: number, complete: boolean) {
  if (complete) {
    return stages[stages.length - 1]
  }

  let activeStage = stages[0]
  for (const stage of stages) {
    if (progress >= stage.threshold) {
      activeStage = stage
    } else {
      break
    }
  }
  return activeStage
}

export function LoadingState(props: LoadingStateProps) {
  const stages = props.mode === "answer" ? ANSWER_STAGES : PROMPT_STAGES
  const [progress, setProgress] = useState(0)
  const completionTimerRef = useRef<number | null>(null)
  const startTimeRef = useRef<number>(0)

  useEffect(() => {
    startTimeRef.current = performance.now()
    setProgress(0)
    return () => {
      if (completionTimerRef.current) {
        window.clearTimeout(completionTimerRef.current)
      }
    }
  }, [props.mode])

  useEffect(() => {
    if (props.complete) {
      if (completionTimerRef.current) {
        window.clearTimeout(completionTimerRef.current)
      }
      setProgress(100)
      completionTimerRef.current = window.setTimeout(() => {
        props.onComplete?.()
      }, 420)
      return
    }

    let frame = 0
    const tick = () => {
      const nextProgress = getProgress(performance.now() - startTimeRef.current)
      setProgress((current) => (nextProgress > current ? nextProgress : current))
      frame = window.setTimeout(tick, 90)
    }

    tick()

    return () => {
      window.clearTimeout(frame)
    }
  }, [props.complete, props.onComplete])

  const activeStage = useMemo(() => stageForProgress(stages, progress, Boolean(props.complete)), [progress, props.complete, stages])

  return (
    <div style={styles.wrap}>
      <style>
        {`
          @keyframes reevaLoadingShimmer {
            0% { transform: translateX(-140%); }
            100% { transform: translateX(180%); }
          }
          @keyframes reevaLoadingPulse {
            0%, 100% { opacity: 0.65; }
            50% { opacity: 1; }
          }
        `}
      </style>
      <div style={styles.progressMeta}>
        <span style={styles.kicker}>{props.mode === "answer" ? "Trust check" : "Prompt planner"}</span>
        <span style={styles.percent}>{Math.round(progress)}%</span>
      </div>
      <div style={styles.barTrack}>
        <div
          style={{
            ...styles.barFill,
            width: `${progress}%`,
            transition: props.complete ? "width 320ms cubic-bezier(0.22, 1, 0.36, 1)" : "width 120ms linear"
          }}
        >
          <span style={styles.barGlow} />
        </div>
      </div>
      <p style={styles.status}>{activeStage.status}</p>
      <p style={styles.support}>{activeStage.support}</p>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    display: "grid",
    gap: 12
  },
  progressMeta: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  kicker: {
    fontSize: 12,
    lineHeight: 1.2,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#64748b",
    fontWeight: 700
  },
  percent: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.2,
    color: "#4338ca",
    fontWeight: 800,
    fontVariantNumeric: "tabular-nums"
  },
  barTrack: {
    position: "relative",
    height: 12,
    borderRadius: 999,
    background: "rgba(226,232,240,0.9)",
    overflow: "hidden",
    boxShadow: "inset 0 1px 1px rgba(255,255,255,0.6)"
  },
  barFill: {
    position: "relative",
    height: "100%",
    borderRadius: 999,
    background: "linear-gradient(90deg, #60a5fa 0%, #4f46e5 58%, #4338ca 100%)",
    overflow: "hidden",
    boxShadow: "0 6px 18px rgba(79,70,229,0.22)"
  },
  barGlow: {
    position: "absolute",
    inset: 0,
    width: "34%",
    background: "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.45) 45%, rgba(255,255,255,0) 100%)",
    animation: "reevaLoadingShimmer 1.35s linear infinite"
  },
  status: {
    margin: 0,
    color: "#0f172a",
    fontSize: 15,
    lineHeight: 1.45,
    fontWeight: 700
  },
  support: {
    margin: 0,
    color: "#64748b",
    fontSize: 13,
    lineHeight: 1.55,
    animation: "reevaLoadingPulse 1.6s ease-in-out infinite"
  }
}
