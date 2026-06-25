const DOWNLOAD_TARGET = "#download"
const LINKEDIN_URL = "https://www.linkedin.com/company/reevaai/"
const INSTAGRAM_URL = "https://www.instagram.com/try.reevaai/"

const problemCards = [
  {
    title: "Looks finished",
    detail: "Logic may be missing"
  },
  {
    title: "Says “done”",
    detail: "Evidence is unclear"
  },
  {
    title: "Moves fast",
    detail: "Scope can drift"
  }
]

const beforeItems = ["Vague prompts", "Endless retries", "Scope creep", "No test plan"]
const afterItems = ["Clear next move", "Scoped prompt", "Review result", "Test checklist"]

const productCards = [
  {
    title: "Next Move",
    body: "Know what to ask next.",
    preview: "Add booking validation"
  },
  {
    title: "Prompt Builder",
    body: "Turn intent into scope.",
    preview: "No checkout changes"
  },
  {
    title: "Review Result",
    body: "Check what’s complete.",
    preview: "Missing save logic"
  },
  {
    title: "Repair Prompt",
    body: "Fix only the gap.",
    preview: "Add error state"
  },
  {
    title: "Test Checklist",
    body: "Validate before moving on.",
    preview: "Submit, refresh, verify"
  }
]

function LinkedInIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path
        fill="currentColor"
        d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V8.98h3.42v1.57h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.29ZM5.32 7.41a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13Zm1.78 13.04H3.54V8.98H7.1v11.47ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z"
      />
    </svg>
  )
}

function InstagramIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path
        fill="currentColor"
        d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.22.42.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.05.42 2.22.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.42 2.22-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.05.36-2.22.42-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.22-.42-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.16-.42-.36-1.05-.42-2.22-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.42-2.22.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.05-.36 2.22-.42 1.27-.06 1.65-.07 4.85-.07ZM12 0C8.74 0 8.33.01 7.05.07 5.77.13 4.9.33 4.14.63c-.79.31-1.46.72-2.12 1.39C1.35 2.68.94 3.35.63 4.14.33 4.9.13 5.77.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.28.26 2.15.56 2.91.31.79.72 1.46 1.39 2.12.66.67 1.33 1.08 2.12 1.39.76.3 1.63.5 2.91.56 1.28.06 1.69.07 4.95.07s3.67-.01 4.95-.07c1.28-.06 2.15-.26 2.91-.56.79-.31 1.46-.72 2.12-1.39.67-.66 1.08-1.33 1.39-2.12.3-.76.5-1.63.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.28-.26-2.15-.56-2.91-.31-.79-.72-1.46-1.39-2.12C21.32 1.35 20.65.94 19.86.63c-.76-.3-1.63-.5-2.91-.56C15.67.01 15.26 0 12 0Zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32ZM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm7.85-10.4a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0Z"
      />
    </svg>
  )
}

export default function HomePage() {
  return (
    <main className="site-shell">
      <header className="site-nav" aria-label="reeva AI navigation">
        <a className="brand-mark" href="#top" aria-label="reeva AI home">
          <img src="/reeva-logo.png" alt="reeva AI" />
        </a>
        <nav className="nav-links" aria-label="Main navigation">
          <a href="#top">Product</a>
          <a href="#control">How it works</a>
          <a href="#proof">Example</a>
          <a href={DOWNLOAD_TARGET}>Download</a>
        </nav>
        <a className="nav-cta" href={DOWNLOAD_TARGET}>
          Download
        </a>
      </header>

      <section className="hero-section" id="top">
        <div className="hero-copy">
          <p className="signal-badge">Make every token count</p>
          <h1>Build better Replit apps without losing control.</h1>
          <p className="hero-lede">
            Plan smarter prompts, review AI output, fix gaps, and test before moving forward.
          </p>
          <div className="hero-actions">
            <a className="primary-cta" href={DOWNLOAD_TARGET}>
              Download reeva AI
            </a>
            <a className="secondary-cta" href="#control">
              See how it works
            </a>
          </div>
        </div>

        <div className="hero-product" aria-label="Replit and reeva AI product mockup">
          <div className="replit-pane">
            <div className="mock-toolbar">
              <span />
              <span />
              <span />
              <strong>Replit</strong>
            </div>
            <div className="code-lines" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="agent-note">AI says: Done</div>
          </div>
          <aside className="reeva-pane">
            <div className="pane-header">
              <span>reeva AI</span>
              <strong>In control</strong>
            </div>
            <div className="mini-card accent-card">
              <span>Next Move</span>
              <p>Add booking validation.</p>
            </div>
            <div className="mini-card">
              <span>Review Result</span>
              <p>Data saving is missing.</p>
            </div>
            <div className="check-card">
              <span>Test Checklist</span>
              <label>Submit</label>
              <label>Refresh</label>
              <label>Verify</label>
            </div>
          </aside>
        </div>
      </section>

      <section className="problem-section" id="clarity">
        <div className="section-heading compact-heading">
          <p className="eyebrow">Replit builds fast. reeva AI keeps you in control.</p>
          <h2>AI builds fast. But is it actually done?</h2>
        </div>
        <div className="problem-grid">
          {problemCards.map((item) => (
            <div className="problem-card" key={item.title}>
              <strong>{item.title}</strong>
              <span>{item.detail}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="comparison-section">
        <div className="section-heading">
          <h2>From AI chaos to product clarity</h2>
        </div>
        <div className="comparison-grid">
          <div className="comparison-card before-card">
            <span>Before</span>
            {beforeItems.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
          <div className="comparison-card after-card">
            <span>After</span>
            {afterItems.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        </div>
      </section>

      <section className="workflow-section" id="control">
        <div className="section-heading">
          <p className="eyebrow">Your control layer for Replit</p>
          <h2>Know the next move.</h2>
        </div>
        <div className="workflow-grid">
          {productCards.map((card) => (
            <article className="workflow-card" key={card.title}>
              <span>{card.title}</span>
              <h3>{card.body}</h3>
              <div className="ui-example">{card.preview}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="proof-section" id="proof">
        <div className="section-heading">
          <h2>Catch what AI misses</h2>
        </div>
        <div className="proof-card">
          <div>
            <span>User asked</span>
            <p>Add a booking form</p>
          </div>
          <div>
            <span>AI says</span>
            <p>Done</p>
          </div>
          <div className="findings">
            <span>reeva AI finds</span>
            <p>Data not saved</p>
            <p>No confirmation state</p>
            <p>No failed-submit test</p>
          </div>
          <div className="next-test">
            <span>Next test</span>
            <p>Submit, refresh, verify.</p>
          </div>
        </div>
      </section>

      <section className="closing-section" id="download">
        <h2>Build with AI. Move with confidence.</h2>
        <p>Use reeva AI with Replit before wasting more tokens.</p>
        <div className="hero-actions center-actions">
          <a className="primary-cta" href={DOWNLOAD_TARGET}>
            Download reeva AI
          </a>
        </div>
      </section>

      <footer className="site-footer" aria-label="Footer links">
        <div className="social-links" aria-label="Contact us on social media">
          <span>Contact us</span>
          <a href={LINKEDIN_URL} target="_blank" rel="noreferrer" aria-label="reeva AI on LinkedIn">
            <LinkedInIcon />
          </a>
          <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer" aria-label="reeva AI on Instagram">
            <InstagramIcon />
          </a>
        </div>
        <div className="legal-links" aria-label="Legal links">
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms &amp; Conditions</a>
        </div>
      </footer>
    </main>
  )
}
