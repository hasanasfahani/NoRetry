# Simple Next-Prompt Rollout

Phase 12 adds a small rollout switch around the simplified requirement-match flow.

## Modes

Set `PLASMO_PUBLIC_SIMPLE_NEXT_PROMPT_ROLLOUT` before starting or building the extension.

```bash
PLASMO_PUBLIC_SIMPLE_NEXT_PROMPT_ROLLOUT=on npm run dev --workspace @prompt-optimizer/extension
```

**on**

The simplified flow runs and controls the review popup. This is the default.

**shadow**

The simplified flow runs, records telemetry, and appears in admin eval candidates, but the old popup decision stays user-facing.

```bash
PLASMO_PUBLIC_SIMPLE_NEXT_PROMPT_ROLLOUT=shadow npm run dev --workspace @prompt-optimizer/extension
```

**off**

The simplified flow is disabled. The old review path controls the popup and no simplified decision snapshot is generated.

```bash
PLASMO_PUBLIC_SIMPLE_NEXT_PROMPT_ROLLOUT=off npm run dev --workspace @prompt-optimizer/extension
```

## Rollout Checks

Before shipping `on`, run:

```bash
npm run test:simple-next-prompt --workspace @prompt-optimizer/extension
npm run test:simple-next-prompt-eval --workspace @prompt-optimizer/extension
npm run test:next-move-interpreter --workspace @prompt-optimizer/extension
npm run test:review-routing --workspace @prompt-optimizer/extension
npx esbuild apps/extension/contents/replit-agent.tsx --bundle --format=esm --platform=browser --outfile=/tmp/replit-agent-phase12.js --tsconfig=apps/extension/tsconfig.json
```

## Manual Test

Use a short coding-agent answer on ChatGPT, Replit, or Lovable:

```text
Act like Replit's coding agent. I am building a simple booking app.
Phase 1 goal: create the booking form UI only.
Reply very briefly like a coding agent after completing the work. Do not include code. Say what you changed, confirm Phase 1 is done, and tell me the next phase.
```

Expected behavior in `on` mode:

- if the assistant confirms all requested requirements, the popup should show that requirements pass
- if anything is not confirmed, the popup should ask for confirmation first
- when requirements pass, the generated prompt should be action-only and should ask the assistant to suggest the next step after finishing

## Admin Review

Open the admin portal at:

```text
http://localhost:3002/admin/eval-review
```

The candidate card shows the simple-flow decision, rollout mode, whether the decision was applied, missing requirements, assistant-suggested next move, and generated prompt.

Use `shadow` mode when reviewing new behavior before exposing it to users.

## Rollback

If the popup starts recommending the wrong next move:

1. Restart the extension with `PLASMO_PUBLIC_SIMPLE_NEXT_PROMPT_ROLLOUT=shadow` to keep collecting evidence without affecting users.
2. Restart with `PLASMO_PUBLIC_SIMPLE_NEXT_PROMPT_ROLLOUT=off` if the old path must fully take over.
3. Review captured candidates in the admin portal and add failing cases to the eval dataset before turning `on` again.
