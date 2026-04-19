"use client"

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode, type RefObject } from "react"
import { ReevaLogo } from "../brand/ReevaLogo"

type ProductTutorialStep = {
  id: string
  text: ReactNode
  targetRef: RefObject<HTMLElement | null>
}

type ProductTutorialProps = {
  open: boolean
  steps: ProductTutorialStep[]
  onClose: () => void
}

type SpotlightRect = {
  top: number
  left: number
  width: number
  height: number
}

export function ProductTutorial({ open, steps, onClose }: ProductTutorialProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [rect, setRect] = useState<SpotlightRect | null>(null)
  const [viewportHeight, setViewportHeight] = useState(900)

  useEffect(() => {
    if (!open) {
      setActiveIndex(0)
      setRect(null)
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    const updateViewportHeight = () => setViewportHeight(window.innerHeight)
    updateViewportHeight()
    window.addEventListener("resize", updateViewportHeight)
    return () => window.removeEventListener("resize", updateViewportHeight)
  }, [open])

  const activeStep = steps[activeIndex]

  useEffect(() => {
    if (!open || !activeStep?.targetRef.current) return

    const updateRect = () => {
      const node = activeStep.targetRef.current
      if (!node) return
      const bounds = node.getBoundingClientRect()
      const padding = 10
      setRect({
        top: Math.max(12, bounds.top - padding),
        left: Math.max(12, bounds.left - padding),
        width: Math.min(window.innerWidth - 24, bounds.width + padding * 2),
        height: bounds.height + padding * 2
      })

      const reservedBottomSpace = 290
      const desiredBottom = viewportHeight - reservedBottomSpace
      if (bounds.bottom > desiredBottom) {
        const delta = bounds.bottom - desiredBottom
        window.scrollBy({
          top: delta,
          behavior: "smooth"
        })
        window.setTimeout(updateRect, 260)
      }
    }

    activeStep.targetRef.current.scrollIntoView({
      behavior: "smooth",
      block: activeIndex >= 3 ? "start" : "nearest"
    })

    const timer = window.setTimeout(updateRect, 220)
    window.addEventListener("resize", updateRect)
    window.addEventListener("scroll", updateRect, true)

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener("resize", updateRect)
      window.removeEventListener("scroll", updateRect, true)
    }
  }, [open, activeIndex, activeStep])

  const progress = useMemo(() => ((activeIndex + 1) / Math.max(1, steps.length)) * 100, [activeIndex, steps.length])

  if (!open || !activeStep) return null

  function handleNext() {
    if (activeIndex >= steps.length - 1) {
      onClose()
      return
    }
    setActiveIndex((current) => Math.min(current + 1, steps.length - 1))
  }

  function handleBack() {
    setActiveIndex((current) => Math.max(current - 1, 0))
  }

  return (
    <div style={styles.backdrop}>
      {rect ? (
        <>
          <div style={{ ...styles.scrimBand, top: 0, left: 0, right: 0, height: rect.top }} />
          <div
            style={{
              ...styles.scrimBand,
              top: rect.top,
              left: 0,
              width: rect.left,
              height: rect.height
            }}
          />
          <div
            style={{
              ...styles.scrimBand,
              top: rect.top,
              left: rect.left + rect.width,
              right: 0,
              height: rect.height
            }}
          />
          <div
            style={{
              ...styles.scrimBand,
              top: rect.top + rect.height,
              left: 0,
              right: 0,
              bottom: 0
            }}
          />
          <div
            style={{
              ...styles.spotlight,
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height
            }}
          />
        </>
      ) : (
        <div style={{ ...styles.scrimBand, inset: 0 }} />
      )}

      <div style={styles.topBar}>
        <div style={styles.brandWrap}>
          <ReevaLogo width={124} height={32} />
        </div>
      </div>

      <div style={styles.panel}>
        <div style={styles.progressRail}>
          <div style={{ ...styles.progressFill, width: `${progress}%` }} />
        </div>

        <div style={styles.stepMeta}>
          <span style={styles.stepIndex}>0{activeIndex + 1}</span>
          <span style={styles.stepCount}>من {steps.length}</span>
        </div>

        <div style={styles.text}>{activeStep.text}</div>

        <div style={styles.actions}>
          {activeIndex > 0 ? (
            <button type="button" onClick={handleBack} style={styles.secondaryButton}>
              السابق
            </button>
          ) : <div />}
          <button type="button" onClick={handleNext} style={styles.primaryButton}>
            {activeIndex === steps.length - 1 ? "ابدأ" : "التالي"}
          </button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 1450
  },
  scrimBand: {
    position: "absolute",
    background: "rgba(4, 10, 24, 0.46)",
    backdropFilter: "blur(5px)"
  },
  spotlight: {
    position: "fixed",
    borderRadius: 24,
    border: "1px solid rgba(139, 196, 255, 0.28)",
    boxShadow: "0 0 0 2px rgba(7,102,254,0.22), 0 24px 60px rgba(0,0,0,0.34)",
    background: "rgba(255,255,255,0.02)",
    pointerEvents: "none",
    transition: "all 260ms ease"
  },
  topBar: {
    position: "fixed",
    top: 16,
    left: 14,
    right: 14,
    zIndex: 2,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 12
  },
  brandWrap: {
    display: "flex",
    alignItems: "center",
    opacity: 0.96
  },
  panel: {
    position: "fixed",
    left: 14,
    right: 14,
    bottom: 18,
    zIndex: 2,
    borderRadius: 28,
    padding: 18,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%)",
    backdropFilter: "blur(18px)",
    boxShadow: "0 28px 80px rgba(0,0,0,0.34)",
    display: "grid",
    gap: 14
  },
  progressRail: {
    width: "100%",
    height: 6,
    borderRadius: 999,
    background: "rgba(255,255,255,0.1)",
    overflow: "hidden",
    direction: "rtl"
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    background: "linear-gradient(90deg, #0766fe 0%, #57c9ff 100%)",
    boxShadow: "0 0 24px rgba(7, 102, 254, 0.6)",
    marginLeft: "auto"
  },
  stepMeta: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    direction: "rtl",
    color: "rgba(226, 235, 255, 0.74)",
    fontSize: 13,
    fontWeight: 700
  },
  stepIndex: {
    letterSpacing: "0.18em"
  },
  stepCount: {},
  text: {
    margin: 0,
    color: "#f7fbff",
    fontSize: 24,
    lineHeight: 1.5,
    fontWeight: 700,
    textAlign: "right"
  },
  actions: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10
  },
  primaryButton: {
    borderRadius: 18,
    background: "linear-gradient(135deg, #0766fe 0%, #2d8cff 100%)",
    color: "#fff",
    padding: "15px 16px",
    fontWeight: 800,
    fontSize: 16,
    boxShadow: "0 20px 36px rgba(7, 102, 254, 0.3)"
  },
  secondaryButton: {
    borderRadius: 18,
    background: "rgba(255,255,255,0.08)",
    color: "#eef4ff",
    padding: "15px 16px",
    border: "1px solid rgba(255,255,255,0.12)",
    fontWeight: 800,
    fontSize: 16
  }
}
