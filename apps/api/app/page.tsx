const DOWNLOAD_TARGET = "#download"

const workflow = [
  {
    name: "Plan",
    title: "Know what should be built first.",
    body:
      "reeva AI turns your app idea into MVP scope, feature boundaries, implementation phases, and acceptance criteria before you ask Replit to build."
  },
  {
    name: "Prompt",
    title: "Give Replit a scoped next move.",
    body:
      "Choose whether you are adding a small feature, planning a large feature, fixing a bug, or making a small change. reeva AI asks the right questions and creates the prompt."
  },
  {
    name: "Review",
    title: "Stop guessing whether the work is done.",
    body:
      "reeva AI compares Replit's response against the original prompt so you can see what was completed, what is missing, what is unclear, and what still needs testing."
  },
  {
    name: "Repair",
    title: "Fix gaps without adding new chaos.",
    body:
      "When something is missing, reeva AI creates a focused repair prompt that addresses unresolved requirements without starting unrelated work."
  },
  {
    name: "Test",
    title: "Validate before expanding scope.",
    body:
      "Create manual testing scenarios for happy paths, edge cases, persistence, mobile behavior, and clear pass/fail checks."
  }
]

const capabilities = [
  "Define a realistic MVP",
  "Turn ideas into clear requirements",
  "Create better prompts for Replit",
  "Review what the AI agent completed",
  "Detect missing or incomplete work",
  "Prevent scope creep",
  "Generate focused repair prompts",
  "Test before adding more features",
  "Keep your product aligned as it grows"
]

const builders = [
  "Startup founders",
  "Indie hackers",
  "Product managers",
  "Operators",
  "Agencies",
  "Creators",
  "Non-technical teams building MVPs with AI"
]

export default function HomePage() {
  return (
    <main className="site-shell">
      <header className="site-nav" aria-label="reeva AI navigation">
        <a className="brand-mark" href="#top" aria-label="reeva AI home">
          reeva AI
        </a>
        <nav className="nav-links" aria-label="Main navigation">
          <a href="#workflow">Workflow</a>
          <a href="#builders">Builders</a>
          <a href="#context">Context</a>
        </nav>
        <a className="nav-cta" href={DOWNLOAD_TARGET}>
          Download
        </a>
      </header>

      <section className="hero-section" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Make every token count.</p>
          <h1>Build apps on Replit without the chaos.</h1>
          <p className="hero-lede">
            reeva AI helps non-technical builders plan, prompt, review, repair, and test software
            built with AI agents on Replit.
          </p>
          <p className="hero-support">
            It gives you a clear workflow around your AI coding agent, so you can move from idea to
            MVP with more control, less confusion, and better decisions.
          </p>
          <div className="hero-actions">
            <a className="primary-cta" href={DOWNLOAD_TARGET}>
              Download reeva AI
            </a>
            <a className="secondary-cta" href="#workflow">
              See how it works
            </a>
          </div>
        </div>

        <div className="product-panel" aria-label="reeva AI workflow preview">
          <div className="panel-topline">
            <span>Replit build session</span>
            <strong>Guided by reeva AI</strong>
          </div>
          <div className="agent-card prompt-card">
            <span>Next move</span>
            <p>Add booking confirmation emails without changing the checkout flow.</p>
          </div>
          <div className="agent-card review-card">
            <span>Review result</span>
            <ul>
              <li>Completed: email trigger added</li>
              <li>Missing: failed-send state</li>
              <li>Test next: mobile booking path</li>
            </ul>
          </div>
          <div className="quality-row">
            <span>Plan</span>
            <span>Prompt</span>
            <span>Review</span>
            <span>Repair</span>
            <span>Test</span>
          </div>
        </div>
      </section>

      <section className="problem-section">
        <p className="eyebrow">Replit can build fast.</p>
        <h2>But knowing what to build next is still hard.</h2>
        <div className="split-copy">
          <p>
            AI coding agents make software development faster than ever. But for non-technical
            users, the hard part is not only generating code.
          </p>
          <p>
            The hard part is knowing what to ask, what to build first, whether the result is
            complete, and when it is safe to move forward.
          </p>
        </div>
      </section>

      <section className="layer-section">
        <div className="section-heading">
          <p className="eyebrow">Your product workflow layer for Replit</p>
          <h2>reeva AI is not another coding agent.</h2>
          <p>
            It is the planning, prompting, review, and quality-control layer around the agent
            building your product on Replit.
          </p>
        </div>
        <div className="capability-grid">
          {capabilities.map((item) => (
            <div className="capability-card" key={item}>
              {item}
            </div>
          ))}
        </div>
      </section>

      <section className="workflow-section" id="workflow">
        <div className="section-heading">
          <p className="eyebrow">How reeva AI works</p>
          <h2>Plan the work. Prompt with clarity. Review the result.</h2>
        </div>
        <div className="workflow-grid">
          {workflow.map((step, index) => (
            <article className="workflow-card" key={step.name}>
              <span className="step-number">{String(index + 1).padStart(2, "0")}</span>
              <h3>{step.name}</h3>
              <strong>{step.title}</strong>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="builders-section" id="builders">
        <div className="section-heading">
          <p className="eyebrow">Built for non-technical builders</p>
          <h2>You do not need to become a developer.</h2>
          <p>
            You need a clearer way to direct the AI agent and make product decisions with confidence.
          </p>
        </div>
        <div className="builder-list">
          {builders.map((builder) => (
            <span key={builder}>{builder}</span>
          ))}
        </div>
      </section>

      <section className="context-section" id="context">
        <p className="eyebrow">Stay in control as your product grows</p>
        <h2>Every next prompt stays connected to the product you are actually building.</h2>
        <p>
          reeva AI keeps your product purpose, current scope, completed work, protected behavior,
          constraints, known issues, and definition of done organized as your MVP grows.
        </p>
      </section>

      <section className="closing-section" id="download">
        <p className="eyebrow">From idea to MVP, guided step by step.</p>
        <h2>Build with AI. Think like a product team.</h2>
        <p>
          Turn Replit development from an unpredictable AI conversation into a clear product
          workflow.
        </p>
        <div className="closing-mantra">
          <span>Plan</span>
          <span>Prompt</span>
          <span>Review</span>
          <span>Repair</span>
          <span>Test</span>
        </div>
        <div className="hero-actions center-actions">
          <a className="primary-cta" href={DOWNLOAD_TARGET}>
            Download reeva AI
          </a>
          <a className="secondary-cta" href="#workflow">
            See how it works
          </a>
        </div>
      </section>
    </main>
  )
}
