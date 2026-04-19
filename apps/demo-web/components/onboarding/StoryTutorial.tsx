"use client"

import Image from "next/image"
import { useEffect, useMemo, useRef, useState, type CSSProperties, type TouchEvent } from "react"
import { ReevaLogo } from "../brand/ReevaLogo"

type StorySlide = {
  id: string
  text: string
  title?: string
  buttonLabel: string
  images: Array<{
    src: string
    alt: string
    fit?: "cover" | "contain"
    position?: string
    variant?: "default" | "wide-shot"
  }>
}

const slides: StorySlide[] = [
  {
    id: "hamada-request",
    text: "حمادة راح ع مطعم بيشتغل بالذكاء الاصطناعي وطلب منهم برغر بهل شكل لانو جوعان كتير",
    buttonLabel: "شوف شو اجاه",
    images: [{ src: "/onboarding/slide-1.png", alt: "طلب حمادة للبرغر", fit: "contain", position: "center center", variant: "wide-shot" }]
  },
  {
    id: "hamada-result",
    text: "المطعم ذكي بس مو كتير جبله برغر سمك ني",
    buttonLabel: "شوفو سعاد شو طلبت",
    images: [{ src: "/onboarding/slide-2.png", alt: "برغر سمك ني" }]
  },
  {
    id: "souad-request",
    text: "سعاد بتحب التفاصيل طلبت منو برغر بس بطريقة مفصلة وبدون حد لانها بتتحسس منو",
    buttonLabel: "النتيجة؟",
    images: [{ src: "/onboarding/slide-3.png", alt: "طلب سعاد المفصل", fit: "contain", position: "center center", variant: "wide-shot" }]
  },
  {
    id: "souad-result",
    text: "وصلها هاد الطبق بس هي حريصة بدها تشوف اذا في بقلبه اي نوع حد",
    buttonLabel: "معقول تلاقي حد بقلبه؟",
    images: [{ src: "/onboarding/slide-4.png", alt: "برغر سعاد" }]
  },
  {
    id: "jalapeno-twist",
    text: "لقت هالبينو للاسف وكانت رح تروح فيها",
    buttonLabel: "كيفك مع الذكاء الاصطناعي؟",
    images: [{ src: "/onboarding/slide-5.png", alt: "هالبينو داخل الطبق" }]
  },
  {
    id: "reeva-story",
    title: "reeva AI",
    text: "هي اضافة على المتصفح بتساعدكم تتواصلوا بشكل اوضح مع الذكاء الاصطناعي وبتجنبكم تكاليف عالية بسبب اخطاء التواصل معه بالاخص وقت تبنو سوفتوير باستخدامه (vibe coding) او بالتصميم\nمن خلال:",
    buttonLabel: "الميزة الرئيسية الأولى",
    images: [{ src: "/onboarding/slide-6c.png", alt: "ايقونة reeva AI داخل الواجهة", fit: "contain", position: "center center", variant: "wide-shot" }]
  },
  {
    id: "reeva-feature-prompt",
    text: "تحسين البرومبت من خلال الاجابة ع اسئلة سريعة اختيار من متعدد",
    buttonLabel: "الميزة الرئيسية الثانية",
    images: [{ src: "/onboarding/slide-6a.png", alt: "ميزة تحسين البرومبت", fit: "contain", position: "center top", variant: "wide-shot" }]
  },
  {
    id: "reeva-feature-analysis",
    text: "مراجعة وتحليل جواب وعمل الذكاء الاصطناعي واقتراح برومبت لتحسين عمله",
    buttonLabel: "جاهزين تجربو نموذجه الأولي؟",
    images: [{ src: "/onboarding/slide-6b.png", alt: "ميزة تحليل جواب الذكاء الاصطناعي", fit: "contain", position: "center top", variant: "wide-shot" }]
  }
]

export function StoryTutorial({ open, onClose }: { open: boolean; onClose: (reason: "skip" | "complete") => void }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const touchStartXRef = useRef<number | null>(null)
  const touchDeltaXRef = useRef(0)

  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setActiveIndex(0)
    }
  }, [open])

  const progress = useMemo(() => ((activeIndex + 1) / slides.length) * 100, [activeIndex])

  if (!open) return null

  function goToSlide(index: number) {
    setActiveIndex(Math.max(0, Math.min(index, slides.length - 1)))
  }

  function handleNext() {
    if (activeIndex >= slides.length - 1) {
      onClose("complete")
      return
    }
    goToSlide(activeIndex + 1)
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    touchStartXRef.current = event.touches[0]?.clientX ?? null
    touchDeltaXRef.current = 0
  }

  function handleTouchMove(event: TouchEvent<HTMLDivElement>) {
    if (touchStartXRef.current === null) return
    touchDeltaXRef.current = (event.touches[0]?.clientX ?? 0) - touchStartXRef.current
  }

  function handleTouchEnd() {
    const delta = touchDeltaXRef.current
    touchStartXRef.current = null
    touchDeltaXRef.current = 0
    if (Math.abs(delta) < 42) return
    if (delta < 0) {
      goToSlide(activeIndex + 1)
    } else {
      goToSlide(activeIndex - 1)
    }
  }

  const slide = slides[activeIndex]

  return (
    <div style={styles.backdrop} dir="rtl">
      <div style={styles.ambientGlowA} />
      <div style={styles.ambientGlowB} />
      <div style={styles.shell}>
        <div style={styles.topBar}>
          <button type="button" onClick={() => onClose("skip")} style={styles.skipButton}>
            تخطي
          </button>
          <div style={styles.storyLabel}>قصة قصيرة قبل التجربة</div>
          <div style={styles.topLogoWrap}>
            <ReevaLogo width={128} height={34} priority />
          </div>
        </div>

        <div style={styles.progressRail}>
          <div style={{ ...styles.progressFill, width: `${progress}%` }} />
        </div>

        <section
          style={styles.slide}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div style={styles.slideCard}>
            <div style={styles.slideMeta}>
              <span style={styles.slideIndex}>0{activeIndex + 1}</span>
              <div style={styles.dots}>
                {slides.map((dot, dotIndex) => (
                  <button
                    key={dot.id}
                    type="button"
                    aria-label={`الانتقال إلى الشريحة ${dotIndex + 1}`}
                    onClick={() => goToSlide(dotIndex)}
                    style={{
                      ...styles.dot,
                      ...(dotIndex === activeIndex ? styles.dotActive : null)
                    }}
                  />
                ))}
              </div>
            </div>

            <div style={slide.images.length > 1 ? styles.imageStack : styles.imageGridOne}>
              {slide.images.map((image, imageIndex) => (
                <div
                  key={image.src}
                  style={
                    image.variant === "wide-shot"
                      ? styles.mediaWideShot
                      : slide.images.length > 1
                        ? styles.mediaStacked
                        : styles.mediaHero
                  }
                >
                  <Image
                    src={image.src}
                    alt={image.alt}
                    fill
                    sizes="(max-width: 768px) 100vw, 480px"
                    style={{
                      objectFit: image.fit ?? "contain",
                      objectPosition: image.position ?? (imageIndex === 0 ? "center top" : "center center")
                    }}
                    priority={activeIndex <= 1}
                  />
                  <div style={styles.mediaShade} />
                </div>
              ))}
            </div>

            <div style={styles.copyWrap}>
              {slide.title ? <p style={styles.slideTitle}>{slide.title}</p> : null}
              <p style={styles.slideText}>{slide.text}</p>
            </div>

            <div style={styles.footerRow}>
              <button type="button" onClick={handleNext} style={styles.nextButton}>
                {slide.buttonLabel}
              </button>
              <div style={styles.secondaryNav}>
                <button type="button" onClick={() => goToSlide(activeIndex - 1)} style={styles.navButton} disabled={activeIndex === 0}>
                  السابق
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 1400,
    background:
      "radial-gradient(circle at 20% 10%, rgba(7, 102, 254, 0.24), transparent 28%), radial-gradient(circle at 80% 85%, rgba(53, 208, 184, 0.18), transparent 24%), linear-gradient(180deg, #09111f 0%, #0d1630 50%, #101936 100%)",
    overflowX: "hidden",
    overflowY: "auto"
  },
  ambientGlowA: {
    position: "absolute",
    top: -120,
    right: -80,
    width: 240,
    height: 240,
    borderRadius: "50%",
    background: "rgba(7, 102, 254, 0.28)",
    filter: "blur(60px)"
  },
  ambientGlowB: {
    position: "absolute",
    bottom: -120,
    left: -60,
    width: 220,
    height: 220,
    borderRadius: "50%",
    background: "rgba(71, 232, 191, 0.18)",
    filter: "blur(70px)"
  },
  shell: {
    position: "relative",
    minHeight: "100%",
    display: "grid",
    gridTemplateRows: "auto auto 1fr",
    padding: "16px 14px 18px"
  },
  topBar: {
    display: "grid",
    gridTemplateColumns: "minmax(88px, auto) 1fr auto",
    alignItems: "center",
    gap: 12,
    marginBottom: 12
  },
  topLogoWrap: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end"
  },
  storyLabel: {
    color: "rgba(228, 237, 255, 0.76)",
    fontSize: 14,
    textAlign: "center",
    fontWeight: 700,
    letterSpacing: "-0.01em"
  },
  skipButton: {
    borderRadius: 999,
    background: "rgba(255,255,255,0.1)",
    color: "#fff",
    padding: "10px 14px",
    border: "1px solid rgba(255,255,255,0.14)",
    fontWeight: 700,
    fontSize: 14,
    backdropFilter: "blur(12px)"
  },
  progressRail: {
    width: "100%",
    height: 6,
    borderRadius: 999,
    background: "rgba(255,255,255,0.1)",
    overflow: "hidden",
    marginBottom: 14,
    direction: "rtl"
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    background: "linear-gradient(90deg, #0766fe 0%, #57c9ff 100%)",
    boxShadow: "0 0 24px rgba(7, 102, 254, 0.6)",
    marginLeft: "auto"
  },
  slide: {
    paddingBottom: 6
  },
  slideCard: {
    minHeight: "calc(100vh - 124px)",
    borderRadius: 30,
    padding: 16,
    background: "linear-gradient(180deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.06) 100%)",
    border: "1px solid rgba(255,255,255,0.14)",
    boxShadow: "0 24px 80px rgba(0,0,0,0.28)",
    backdropFilter: "blur(18px)",
    display: "grid",
    gridTemplateRows: "auto auto 1fr auto",
    gap: 14
  },
  slideMeta: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  slideIndex: {
    color: "rgba(241, 247, 255, 0.82)",
    fontSize: 13,
    letterSpacing: "0.18em",
    fontWeight: 800
  },
  dots: {
    display: "flex",
    alignItems: "center",
    gap: 8
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: "50%",
    background: "rgba(255,255,255,0.24)",
    padding: 0
  },
  dotActive: {
    width: 28,
    borderRadius: 999,
    background: "#0766fe",
    boxShadow: "0 0 18px rgba(7, 102, 254, 0.44)"
  },
  imageGridOne: {
    display: "grid"
  },
  imageStack: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 10
  },
  mediaHero: {
    position: "relative",
    minHeight: 330,
    borderRadius: 24,
    overflow: "hidden",
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.12)"
  },
  mediaStacked: {
    position: "relative",
    minHeight: 210,
    borderRadius: 22,
    overflow: "hidden",
    background: "rgba(7, 14, 28, 0.82)",
    border: "1px solid rgba(255,255,255,0.12)"
  },
  mediaWideShot: {
    position: "relative",
    minHeight: 164,
    borderRadius: 22,
    overflow: "hidden",
    background:
      "linear-gradient(180deg, rgba(13, 23, 46, 0.96) 0%, rgba(9, 17, 34, 0.98) 100%)",
    border: "1px solid rgba(255,255,255,0.12)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 20px 40px rgba(0,0,0,0.22)"
  },
  mediaShade: {
    position: "absolute",
    inset: 0,
    background: "linear-gradient(180deg, rgba(8,15,32,0.08) 0%, rgba(8,15,32,0.18) 100%)"
  },
  copyWrap: {
    alignSelf: "start",
    display: "grid",
    gap: 8
  },
  slideTitle: {
    margin: 0,
    color: "#f8fbff",
    fontSize: 30,
    lineHeight: 1.2,
    fontWeight: 900,
    textAlign: "center",
    letterSpacing: "-0.03em",
    textShadow: "0 2px 14px rgba(0,0,0,0.22)"
  },
  slideText: {
    margin: 0,
    color: "#f8fbff",
    fontSize: 26,
    lineHeight: 1.5,
    fontWeight: 700,
    whiteSpace: "pre-line",
    textShadow: "0 2px 14px rgba(0,0,0,0.22)",
    textAlign: "right"
  },
  footerRow: {
    display: "grid",
    gap: 10
  },
  nextButton: {
    width: "100%",
    borderRadius: 20,
    background: "linear-gradient(135deg, #0766fe 0%, #2d8cff 100%)",
    color: "#fff",
    padding: "17px 18px",
    boxShadow: "0 20px 36px rgba(7, 102, 254, 0.35)",
    fontWeight: 800,
    fontSize: 18
  },
  secondaryNav: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 10
  },
  navButton: {
    borderRadius: 16,
    background: "rgba(255,255,255,0.1)",
    color: "#eef4ff",
    padding: "13px 14px",
    border: "1px solid rgba(255,255,255,0.1)",
    fontWeight: 700,
    fontSize: 15
  }
}
