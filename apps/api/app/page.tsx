export default function HomePage() {
  return (
    <main className="page-shell">
      <div className="card">
        <p className="eyebrow">NoRetry</p>
        <h1>Lean backend for Replit prompt prevention and failure diagnosis.</h1>
        <p>
          This API keeps the expensive path selective: prompt analysis is concise, outcome detection is rules-only, and
          diagnosis runs only when a visible failure pattern appears.
        </p>
        <ul>
          <li>`POST /api/analyze-prompt` for before-send scoring and rewrite suggestions</li>
          <li>`POST /api/detect-outcome` for rules-only visible outcome detection</li>
          <li>`POST /api/diagnose-failure` for selective minimal-context diagnosis</li>
          <li>`POST /api/feedback` for explicit worked / didn&apos;t work signals</li>
        </ul>
      </div>
    </main>
  )
}
