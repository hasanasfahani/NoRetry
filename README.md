# NoRetry

NoRetry is a Replit-first MVP that improves prompts before send, detects visible failure patterns after send, and only spends LLM tokens when a likely problem actually needs explanation.

## Phase 1: Architecture

### Product architecture

The MVP is split into six lean layers:

1. `BEFORE`: always-on prompt analysis with a compact score, intent detection, missing context hints, and optional rewrite.
2. `DETECTION`: rules-only post-send outcome checks using visible output snippets, errors, changed file metadata, and retry timing.
3. `AFTER`: selective failure diagnosis using minimized payloads and a short structured LLM prompt.
4. `SESSION MEMORY`: local-first memory for the last three prompts, retries, last intent, and last probable status.
5. `FEEDBACK LOOP`: apply fix, copy fix, and retry directly back into the Replit input.
6. `PATTERN CACHE`: repeated failure shapes reuse cached templates before escalating to fresh diagnosis.

### Full user journey

1. User installs the browser extension.
2. They open Replit and the content script activates only on supported Replit pages.
3. A one-time onboarding card explains the three core actions in under ten seconds.
4. As the user types, the extension detects the prompt field and runs cheap before-analysis.
5. A low-noise badge shows `LOW`, `MID`, or `HIGH`.
6. Clicking the badge opens the panel with score, intent, missing context, guided follow-up questions, and an editable improved draft.
7. On submit, the extension stores a tiny session event and waits briefly for visible outcome signals.
8. The detection layer runs with rules only.
9. If everything looks fine, the product stays quiet.
10. If retry, error, scope drift, or looping signals appear, the extension shows a subtle CTA.
11. If the user asks for explanation, the AFTER endpoint receives only the prompt, trimmed output snippet, error summary, file-count metadata, flags, and tiny session summary.
12. The extension returns a diagnosis with likely failure reasons, misunderstanding, next fixes, and an optional improved retry prompt.
13. The user can apply the fix back into the prompt box, copy it, or retry immediately.

### Proposed stack

- Browser extension: Plasmo + React + TypeScript
- Backend API: Next.js App Router route handlers
- Shared contracts: Zod + shared TypeScript package
- Database: PostgreSQL via Prisma, with in-memory fallback for MVP/local mode
- LLM providers: DeepSeek with Kimi fallback, defaulting to mock mode when no key is configured

Why this stack:

- Plasmo gives fast browser-extension iteration without inventing build plumbing.
- Next route handlers are enough for a small API surface and easy local deployment.
- Shared schemas keep extension and backend payloads aligned.
- Prisma allows a clean upgrade from anonymous local-first MVP to persisted sessions.
- Mock mode keeps the MVP usable even when backend keys or DB setup are not ready.

### Extension architecture

`apps/extension/contents/replit-agent.tsx`
- Replit-only content script
- Detects prompt surfaces with lightweight DOM heuristics
- Injects the floating strength badge and panel
- Observes submit actions, visible outcomes, and retry timing
- Stores tiny session memory locally

`apps/extension/components/OptimizerShell.tsx`
- Low-noise UI shell for onboarding, before analysis, issue CTA, and after diagnosis

`apps/extension/lib/replit.ts`
- Replit DOM helpers for finding inputs, inserting rewrites, and collecting visible snippets

`apps/extension/lib/api.ts`
- Minimal extension-to-backend client
- Falls back to local heuristics when the backend is unavailable

### Backend architecture

`apps/api/app/api/analyze-prompt/route.ts`
- Before-send scoring endpoint
- Uses local heuristics first and optional LLM enhancement second

`apps/api/app/api/refine-prompt/route.ts`
- Before-send AI draft refinement endpoint
- Turns user answers into a stronger prompt draft with minimal payload

`apps/api/app/api/detect-outcome/route.ts`
- Rules-only outcome detection
- Saves prompt and outcome metadata without storing full code or logs

`apps/api/app/api/diagnose-failure/route.ts`
- Selective diagnosis endpoint
- Enforces diagnosis rate limits per session
- Uses pattern cache before escalating to fresh LLM calls

`apps/api/lib/repository.ts`
- In-memory repository by default
- Prisma persistence when enabled

### Data model

The Prisma schema includes:

- `Session`
- `PromptEvent`
- `OutcomeEvent`
- `Diagnosis`
- `PatternCache`
- `UserFeedback`

This supports:

- anonymous local-first usage
- future auth and sync
- lightweight event storage only
- cheap pattern reuse

### Cost-saving strategy

The core rule is enforced throughout the codebase: analyze only what matters, only when needed.

- BEFORE analysis is short and bounded.
- DETECTION uses no LLM.
- AFTER only runs for retries, visible errors, looping, or explicit user request.
- Output snippets are trimmed aggressively.
- Session memory stores only tiny summaries, not full history.
- Pattern templates let repeated issues reuse cache output.
- Session-level rate limiting prevents diagnosis spam.

## Phase 2: Milestones, MVP line, and tradeoffs

### MVP milestones

1. Shared contracts, rules, and token-budget constants
2. Replit-only extension with prompt surface detection and badge/panel injection
3. Before-analysis flow with local fallback and optional rewrite insertion
4. Rules-only post-send detection flow
5. Selective diagnosis endpoint with pattern caching
6. Session memory, explicit feedback, and local-first storage
7. Prisma schema, env template, README, and test checklist

### MVP vs later

MVP includes:

- Replit only
- one-time onboarding
- prompt strength scoring
- intent detection
- missing context hints
- guided follow-up questions
- editable improved prompt drafts
- rewrite insertion and replace-in-Replit flow
- rules-only outcome detection
- selective diagnosis
- local-first session memory
- PostgreSQL-ready schema

Later:

- account personalization by user type
- richer scope drift heuristics from actual file diffs
- account sync and dashboards
- per-team pattern learning
- support for more prompt surfaces or platforms

### Key risks and tradeoffs

- Replit DOM changes could break selector heuristics. The MVP uses modular selector helpers to keep updates isolated.
- Visible changed-file metadata is heuristic-based, not authoritative. This is intentional to avoid deep observability.
- The extension currently relies on brief polling and DOM scraping because Replit does not expose a stable public extension API for Agent internals.
- Mock mode is the default safe experience for local setup, which means full LLM diagnosis requires explicit configuration.

## Phase 3: Implementation notes

### Repo structure

```text
.
├── apps
│   ├── api
│   └── extension
├── packages
│   └── shared
├── prisma
│   └── schema.prisma
├── .env.example
├── package.json
└── README.md
```

### Important product decisions implemented in code

- Replit only: `apps/extension/contents/replit-agent.tsx`
- Before-analysis local fallback: `apps/extension/lib/api.ts`
- Rules-only detection engine: `packages/shared/src/detection.ts`
- Pattern memory templates: `packages/shared/src/patterns.ts`
- Rate limit and trimming: `apps/api/lib/cost-control.ts`
- Minimal payload contracts: `packages/shared/src/schemas.ts`
- Lightweight session memory: `packages/shared/src/session.ts` and `apps/extension/lib/storage.ts`

### Setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment variables:

```bash
cp .env.example .env.local
```

3. Start the API:

```bash
npm run dev:api
```

4. Start the extension:

```bash
npm run dev:extension
```

5. Load the generated extension into Chromium and open Replit.

### Local-only and mock mode

If both `DEEPSEEK_API_KEY` and `KIMI_API_KEY` are missing, or `PROMPT_OPTIMIZER_USE_MOCKS=true`, the app still works:

- prompt analysis uses local heuristics
- guided questions use local heuristics
- prompt draft generation uses local refinement rules
- detection stays local/rules-only
- diagnosis uses pattern-cache templates instead of live LLM calls

This keeps the MVP functioning while preserving the product loop.

## Phase 4: Testing and scenarios

### Short testing checklist

- Confirm the extension activates only on `replit.com`.
- Confirm onboarding appears once, then disappears after dismissal.
- Type a vague prompt and verify `LOW` or `MID` score plus rewrite.
- Answer guided questions and verify the improved draft updates.
- Click `Generate AI draft` and verify the draft becomes more concrete.
- Replace the prompt and verify it lands back in the prompt box.
- Submit a prompt, then trigger a visible error and verify issue CTA appears.
- Click “Explain what went wrong” and verify diagnosis card renders.
- Click “Apply Fix” and verify the improved prompt is inserted.
- Click “This worked” and “Didn’t work” and verify session state updates.
- Disable the backend and confirm local fallback still works.

### Realistic Replit usage scenarios

1. Build scenario
- Prompt: “build auth”
- Expected: low score, asks for files, auth provider, and success criteria

2. Debug scenario
- Prompt: “fix the login bug”
- Replit returns a generic answer or an error
- Expected: issue CTA appears, diagnosis suggests adding the exact error and affected file

3. Scope drift scenario
- Prompt: “change the signup button copy”
- Replit touches multiple files and config
- Expected: scope drift or overreach warning, retry prompt narrows to the exact component only

4. Retry loop scenario
- User resubmits twice after failure
- Expected: looping behavior flag and cached retry-loop diagnosis

### Exactly how cost control is enforced in code

- Token and behavior thresholds live in `packages/shared/src/constants.ts`.
- Output trimming and session diagnosis throttling live in `apps/api/lib/cost-control.ts`.
- Detection avoids LLM calls entirely in `packages/shared/src/detection.ts`.
- The extension falls back to local heuristics in `apps/extension/lib/api.ts` instead of failing open.
- Before-send AI refinement is isolated to `apps/api/app/api/refine-prompt/route.ts` so it stays optional and measurable.
- Pattern reuse is implemented in `packages/shared/src/patterns.ts` and `apps/api/lib/repository.ts`.
- The diagnosis path only accepts minimized fields defined in `packages/shared/src/schemas.ts`.

## Privacy and security

- No full codebase capture
- No full file contents by default
- No full logs by default
- No hidden reasoning or chain-of-thought tracking
- Snippets are aggressively trimmed
- Session memory is lightweight and easy to reset

This MVP is deliberately small, fast, and modular so it can prove value before growing into anything heavier.
