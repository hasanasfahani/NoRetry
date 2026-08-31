import { useEffect, useState, type CSSProperties, type ReactNode } from "react"

type PopupShellProps = {
  open: boolean
  title: string
  eyebrow?: string
  leadingAction?: ReactNode
  headerAction?: ReactNode
  children: ReactNode
  onClose: () => void
}

type PopupTheme = "dark" | "light"

const POPUP_THEME_STORAGE_KEY = "reeva-popup-theme"

export function PopupShell(props: PopupShellProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [theme, setTheme] = useState<PopupTheme>(() => {
    try {
      const stored = window.localStorage.getItem(POPUP_THEME_STORAGE_KEY)
      return stored === "light" ? "light" : "dark"
    } catch {
      return "dark"
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(POPUP_THEME_STORAGE_KEY, theme)
    } catch {
      // Theme preference is nice-to-have; keep the popup usable if storage is unavailable.
    }
  }, [theme])

  if (!props.open) return null

  return (
    <>
      <style>{popupThemeCss}</style>
      <button type="button" style={styles.scrim} onClick={props.onClose} aria-label="Close review popup" />
      <section style={styles.panel} data-reeva-popup="true" data-reeva-theme={theme}>
        <div style={styles.header}>
          {props.leadingAction ? <div style={styles.leadingAction}>{props.leadingAction}</div> : null}
          <div style={styles.titleWrap}>
            <ReviewPopupBrand theme={theme} />
            {props.eyebrow ? <p style={styles.eyebrow}>{props.eyebrow}</p> : null}
            {props.title.trim() ? <h3 style={styles.title}>{props.title}</h3> : null}
          </div>
          <div style={styles.headerActions}>
            <div style={styles.menuWrap}>
              <button
                type="button"
                style={menuButtonStyle(menuOpen)}
                onClick={() => setMenuOpen((current) => !current)}
                aria-label="Open popup menu"
                aria-expanded={menuOpen}
              >
                ⋮
              </button>
              {menuOpen ? (
                <div style={styles.menuPanel} onClick={() => setMenuOpen(false)}>
                  {props.headerAction ? props.headerAction : null}
                  <button
                    type="button"
                    style={styles.menuItemButton}
                    onClick={() => {
                      setTheme((current) => (current === "dark" ? "light" : "dark"))
                    }}
                  >
                    {theme === "dark" ? "Use light mode" : "Use dark mode"}
                  </button>
                  <button
                    type="button"
                    style={styles.menuItemButton}
                    onClick={() => {
                      setMenuOpen(false)
                      props.onClose()
                    }}
                  >
                    Close popup
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div style={styles.body}>{props.children}</div>
      </section>
    </>
  )
}

const popupThemeCss = `
section[data-reeva-popup="true"] {
  color-scheme: dark;
  scrollbar-color: rgba(96,165,250,0.52) rgba(15,23,42,0.28);
  scrollbar-width: thin;
  scrollbar-gutter: stable;
  overflow-x: hidden;
}

section[data-reeva-popup="true"]::-webkit-scrollbar {
  width: 10px;
}

section[data-reeva-popup="true"]::-webkit-scrollbar-track {
  background: rgba(15,23,42,0.24);
}

section[data-reeva-popup="true"]::-webkit-scrollbar-thumb {
  background: rgba(96,165,250,0.46);
  border: 2px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
}

section[data-reeva-popup="true"],
section[data-reeva-popup="true"] * {
  box-sizing: border-box;
  max-width: 100%;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] {
  background:
    radial-gradient(circle at 14% 0%, rgba(7,102,254,0.28), transparent 34%),
    radial-gradient(circle at 92% 8%, rgba(59,130,246,0.16), transparent 30%),
    linear-gradient(180deg, rgba(9,14,28,0.94), rgba(12,18,34,0.96)) !important;
  border-color: rgba(96,165,250,0.24) !important;
  box-shadow: 0 32px 88px rgba(0,0,0,0.48), inset 0 1px 0 rgba(255,255,255,0.08) !important;
  backdrop-filter: blur(22px) saturate(1.28);
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] h1,
section[data-reeva-popup="true"][data-reeva-theme="dark"] h2,
section[data-reeva-popup="true"][data-reeva-theme="dark"] h3,
section[data-reeva-popup="true"][data-reeva-theme="dark"] h4,
section[data-reeva-popup="true"][data-reeva-theme="dark"] strong {
  color: #f8fbff !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] p,
section[data-reeva-popup="true"][data-reeva-theme="dark"] span,
section[data-reeva-popup="true"][data-reeva-theme="dark"] li,
section[data-reeva-popup="true"][data-reeva-theme="dark"] label {
  color: #d9e7ff !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] p[style*="uppercase"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] span[style*="uppercase"] {
  color: #8bbdff !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] span[style*="background: #ffffff"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] span[style*="background: #fff"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] span[style*="background: rgb(255"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] span[style*="background: rgb(255,255,255"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] span[style*="background: #fef3c7"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] span[style*="background: rgb(254, 243, 199"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] span[style*="background: rgb(254,243,199"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] span[style*="background: rgba(219,234,254"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] span[style*="background: rgba(255"] {
  background: rgba(20,31,54,0.82) !important;
  color: #d9e7ff !important;
  border-color: rgba(96,165,250,0.28) !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-tone="success"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-tone="info"] {
  background: linear-gradient(180deg, rgba(37,99,235,0.26), rgba(29,78,216,0.2)) !important;
  color: #bfdbfe !important;
  border-color: rgba(96,165,250,0.42) !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-tone="warning"] {
  background: linear-gradient(180deg, rgba(245,158,11,0.24), rgba(146,64,14,0.2)) !important;
  color: #fde68a !important;
  border-color: rgba(251,191,36,0.44) !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-tone="danger"] {
  background: linear-gradient(180deg, rgba(239,68,68,0.22), rgba(127,29,29,0.2)) !important;
  color: #fecaca !important;
  border-color: rgba(248,113,113,0.4) !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-tone="neutral"] {
  background: rgba(30,41,59,0.82) !important;
  color: #cbd5e1 !important;
  border-color: rgba(148,163,184,0.28) !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] section,
section[data-reeva-popup="true"][data-reeva-theme="dark"] div[style*="background: #ffffff"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] div[style*="background: #fff"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] div[style*="background: rgb(255"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] div[style*="background: rgb(255,255,255"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] div[style*="background: rgba(255"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] div[style*="background: #f8fafc"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] div[style*="background: rgb(248, 250, 252"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] div[style*="background: rgb(248,250,252"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] div[style*="background: #eff6ff"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] div[style*="background: rgb(239, 246, 255"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] div[style*="background: rgb(239,246,255"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] div[style*="background: #dbeafe"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] div[style*="background: rgb(219, 234, 254"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] div[style*="background: rgb(219,234,254"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] div[style*="background: #eaf3ff"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] div[style*="background: rgb(234, 243, 255"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] div[style*="background: rgb(234,243,255"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] div[style*="background: rgba(219,234,254"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] div[style*="background: rgba(239,246,255"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] div[style*="background: rgb(241,245,249"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] div[style*="background: rgb(226,232,240"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] div[style*="background: rgb(203,213,225"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] div[style*="background: linear-gradient(180deg, rgba(239,246,255"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] div[style*="background: linear-gradient(180deg, rgba(255"] {
  background: linear-gradient(180deg, rgba(20,31,54,0.74), rgba(13,22,42,0.72)) !important;
  border-color: rgba(96,165,250,0.2) !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.045) !important;
  backdrop-filter: blur(14px);
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] button {
  border-color: rgba(96,165,250,0.26) !important;
  background: linear-gradient(180deg, rgba(30,44,73,0.88), rgba(20,31,54,0.84)) !important;
  color: #eaf3ff !important;
  box-shadow: none !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] button[aria-pressed="true"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] button[style*="#0766fe"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] button[style*="#2563eb"] {
  background: linear-gradient(135deg, #0b6bff, #3b82f6) !important;
  color: #ffffff !important;
  border-color: rgba(147,197,253,0.55) !important;
  box-shadow: 0 14px 28px rgba(7,102,254,0.26) !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] textarea,
section[data-reeva-popup="true"][data-reeva-theme="dark"] input,
section[data-reeva-popup="true"][data-reeva-theme="dark"] select,
section[data-reeva-popup="true"][data-reeva-theme="dark"] pre {
  background: rgba(5,10,22,0.56) !important;
  color: #f8fbff !important;
  border-color: rgba(96,165,250,0.24) !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.05) !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] textarea::placeholder,
section[data-reeva-popup="true"][data-reeva-theme="dark"] input::placeholder {
  color: rgba(191,219,254,0.58) !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-surface="planning-generation"] {
  background: linear-gradient(180deg, rgba(28,43,70,0.96), rgba(18,30,52,0.96)) !important;
  border-color: rgba(96,165,250,0.3) !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 16px 36px rgba(0,0,0,0.16) !important;
  backdrop-filter: none;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-surface="planning-prd"] {
  background: linear-gradient(180deg, rgba(18,30,52,0.98), rgba(10,19,37,0.98)) !important;
  border-color: rgba(96,165,250,0.26) !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.055), 0 20px 44px rgba(0,0,0,0.2) !important;
  backdrop-filter: none;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-surface="planning-phase"] {
  background: rgba(27,42,68,0.78) !important;
  border-color: rgba(96,165,250,0.22) !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04) !important;
  backdrop-filter: none;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-surface="project-tracker"] {
  background: linear-gradient(180deg, rgba(24,39,65,0.96), rgba(15,27,48,0.96)) !important;
  border-color: rgba(96,165,250,0.28) !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.055) !important;
  backdrop-filter: none;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-surface="project-tracker"] strong {
  color: #f1f6ff !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-surface="project-tracker"] > div:last-child {
  background: rgba(96,165,250,0.13) !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-surface="project-catalog-intro"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-surface="project-catalog-card"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-surface="project-context-summary"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-surface="project-preferences"] {
  background: linear-gradient(180deg, rgba(24,39,65,0.96), rgba(15,27,48,0.96)) !important;
  border-color: rgba(96,165,250,0.28) !important;
  color: #dbeafe !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.055) !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-surface="project-catalog-intro"] strong,
section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-surface="project-catalog-card"] strong,
section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-surface="project-context-summary"] p,
section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-surface="project-preferences"] p,
section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-surface="project-preference-group"] span {
  color: #e6efff !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-surface="project-catalog-intro"] p,
section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-surface="project-catalog-card"] p,
section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-surface="project-catalog-card"] > div,
section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-surface="project-context-summary"] [style*="color: rgb(100, 116, 139"],
section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-surface="project-preferences"] [style*="color: rgb(100, 116, 139"] {
  color: #b9c9e4 !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-surface="project-catalog-card"] span[style*="background"] {
  background: rgba(59,130,246,0.16) !important;
  color: #9ec5ff !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-surface="next-move-workflow"] {
  background: rgba(10,20,38,0.96) !important;
  border-color: rgba(96,165,250,0.24) !important;
  box-shadow: 0 10px 24px rgba(0,0,0,0.2) !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-workflow-state="active"] {
  background: rgba(37,99,235,0.28) !important;
  color: #dbeafe !important;
  border-color: rgba(96,165,250,0.58) !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-workflow-state="complete"] {
  background: rgba(22,163,74,0.2) !important;
  color: #bbf7d0 !important;
  border-color: rgba(74,222,128,0.4) !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] button[data-reeva-question-state="active"] {
  background: #2563eb !important;
  color: #ffffff !important;
  border-color: #93c5fd !important;
  box-shadow: 0 0 0 4px rgba(59,130,246,0.2), 0 8px 18px rgba(37,99,235,0.24) !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] button[data-reeva-question-state="answered"] {
  background: rgba(22,163,74,0.26) !important;
  color: #bbf7d0 !important;
  border-color: rgba(74,222,128,0.52) !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] button[data-reeva-question-state="remaining"] {
  background: rgba(15,23,42,0.72) !important;
  color: #94a3b8 !important;
  border-color: rgba(148,163,184,0.24) !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-question-state="current-card"] {
  background: rgba(22,36,60,0.92) !important;
  border-color: rgba(96,165,250,0.42) !important;
  box-shadow: inset 3px 0 0 #3b82f6 !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-surface="planning-prd"] p,
section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-surface="planning-prd"] li {
  color: #d9e7ff !important;
}

section[data-reeva-popup="true"][data-reeva-theme="dark"] [data-reeva-surface="planning-prd"] p[style*="uppercase"] {
  color: #86b9ff !important;
}

section[data-reeva-popup="true"][data-reeva-theme="light"] {
  color-scheme: light;
}
`

function ReviewPopupBrand({ theme }: { theme: PopupTheme }) {
  const [darkLogoFailed, setDarkLogoFailed] = useState(false)

  if (theme === "dark") {
    return (
      <div style={styles.darkBrandRow} aria-label="reeva AI">
        {darkLogoFailed ? (
          <span style={styles.darkBrandFallback}>reeva AI</span>
        ) : (
          <img
            src={chrome.runtime.getURL("reeva-dark-logo.png")}
            alt="reeva AI"
            style={styles.darkBrandImage}
            onError={() => setDarkLogoFailed(true)}
          />
        )}
      </div>
    )
  }

  return (
    <div style={styles.brandRow} aria-label="reeva AI">
      <svg viewBox="0 0 1024 1024" style={styles.brandIcon} aria-hidden="true">
        <circle cx="512" cy="512" r="305" fill="none" stroke="#0766fe" strokeWidth="38" />
        <circle cx="512" cy="512" r="228" fill="none" stroke="#0766fe" strokeWidth="34" />
        <circle cx="512" cy="512" r="153" fill="none" stroke="#0766fe" strokeWidth="30" />
        <circle cx="512" cy="512" r="85" fill="none" stroke="#0766fe" strokeWidth="26" />
        <circle cx="512" cy="512" r="28" fill="#0766fe" />
        <path d="M452 186L512 154L572 186L540 236H484L452 186Z" fill="#ffffff" />
      </svg>
      <span style={styles.brandWordmark}>reeva AI</span>
    </div>
  )
}

function menuButtonStyle(open: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 42,
    height: 42,
    borderRadius: 999,
    border: open ? "1px solid rgba(7,102,254,0.24)" : "1px solid rgba(148,163,184,0.2)",
    background: open ? "rgba(7,102,254,0.08)" : "#ffffff",
    color: open ? "#0766fe" : "#64748b",
    fontSize: 24,
    lineHeight: 1,
    padding: 0,
    cursor: "pointer",
    boxShadow: "0 8px 20px rgba(15,23,42,0.08)"
  }
}

const styles: Record<string, CSSProperties> = {
  scrim: {
    position: "fixed",
    inset: 0,
    border: "none",
    background: "rgba(15, 23, 42, 0.14)",
    backdropFilter: "blur(2px)",
    zIndex: 2147483644,
    cursor: "default"
  },
  panel: {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: 560,
    maxWidth: "calc(100vw - 16px)",
    maxHeight: "calc(100vh - 112px)",
    overflow: "auto",
    overflowX: "hidden",
    borderRadius: 28,
    border: "1px solid rgba(148, 163, 184, 0.22)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.98))",
    boxShadow: "0 32px 80px rgba(15, 23, 42, 0.18)",
    padding: 22,
    zIndex: 2147483645
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "flex-start",
    gap: 12,
    marginBottom: 18
  },
  leadingAction: {
    flex: "0 0 auto"
  },
  headerActions: {
    display: "inline-flex",
    alignItems: "flex-start",
    gap: 10,
    marginLeft: "auto"
  },
  menuWrap: {
    position: "relative"
  },
  menuPanel: {
    position: "absolute",
    top: 48,
    right: 0,
    minWidth: 180,
    display: "grid",
    gap: 6,
    borderRadius: 18,
    border: "1px solid rgba(148,163,184,0.18)",
    background: "rgba(255,255,255,0.98)",
    boxShadow: "0 18px 44px rgba(15,23,42,0.14)",
    padding: 8,
    zIndex: 2
  },
  menuItemButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "flex-start",
    width: "100%",
    border: "none",
    borderRadius: 12,
    background: "transparent",
    color: "#334155",
    padding: "11px 12px",
    fontSize: 13,
    lineHeight: 1.3,
    fontWeight: 700,
    cursor: "pointer"
  } satisfies CSSProperties,
  titleWrap: {
    flex: "1 1 auto",
    display: "grid",
    gap: 8,
    alignContent: "start"
  },
  brandRow: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    justifySelf: "start"
  },
  brandIcon: {
    width: 32,
    height: 32,
    display: "block",
    flex: "0 0 auto"
  },
  brandWordmark: {
    fontSize: 19,
    lineHeight: 1,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: "#0f172a"
  },
  darkBrandRow: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    justifySelf: "start",
    minWidth: 0
  },
  darkBrandImage: {
    display: "block",
    width: 154,
    maxWidth: "min(46vw, 184px)",
    height: "auto",
    objectFit: "contain"
  },
  darkBrandFallback: {
    fontSize: 19,
    lineHeight: 1,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: "#f8fbff"
  },
  eyebrow: {
    margin: 0,
    fontSize: 12,
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    color: "#64748b",
    fontWeight: 700,
    paddingTop: 2
  },
  title: {
    margin: "6px 0 0",
    fontSize: 28,
    lineHeight: 1.05,
    color: "#0f172a"
  },
  body: {
    display: "grid",
    gap: 14
  }
}
