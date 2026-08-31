# Lovable Rollout Guide

## Scope

Lovable support is intentionally isolated from Replit and ChatGPT. The extension treats Lovable as its own prompt surface with:

- a dedicated surface adapter
- Lovable-specific prompt and submit selectors
- lightweight passive artifact collection only
- a runtime feature flag for fast rollback

## Supported Experience

The rollout targets Lovable's prompt-driven workspace/editor surfaces on:

- `https://lovable.dev/*`
- `https://www.lovable.dev/*`

The extension is intentionally blocked on obvious non-tool routes such as:

- docs
- pricing
- login / sign-up
- legal / privacy / terms

That keeps the extension off marketing and account pages while allowing the actual product workspace to evolve independently.

## Feature Flag

Lovable support is controlled by:

```env
PLASMO_PUBLIC_ENABLE_LOVABLE=true
```

Behavior:

- unset: Lovable support stays on by default
- `true`: Lovable support enabled
- `false`: Lovable support disabled without changing Replit or ChatGPT

## What Lovable Collects

Lovable currently uses a low-risk passive artifact path:

- latest assistant response text
- visible workspace output snippet
- visible error summary
- stable thread identity derived from the Lovable path
- project label metadata when a visible heading/title is available

It does **not** attempt Replit-style file, build, runtime, or telemetry mining.

## QA Checklist

Run these checks before enabling Lovable broadly:

1. Open a Lovable workspace/editor page and confirm the floating icon mounts near the composer.
2. Type in the Lovable composer and confirm typing mode activates.
3. Submit a prompt and confirm quick analysis binds to the returned assistant answer.
4. Open deep analysis and confirm it reads the same answer as quick analysis.
5. Generate a prompt in Prompt Mode and confirm it writes back into the Lovable composer.
6. Confirm the extension does **not** appear on:
   - `lovable.dev/pricing`
   - `lovable.dev/docs`
   - login / sign-up pages
7. Re-test Replit after any Lovable changes:
   - typing mode
   - quick analysis
   - deep analysis
   - prompt mode write-back

## Smoke Test

Use the Lovable-specific smoke test:

```bash
npm run test:lovable-surface --workspace @prompt-optimizer/extension
```

This verifies:

- host detection
- feature-flag gating
- stable thread identity
- Lovable passive artifact collection

## Rollback

If Lovable changes its DOM or causes instability:

1. Set `PLASMO_PUBLIC_ENABLE_LOVABLE=false`
2. restart the extension dev/build process
3. reload the unpacked extension

No Replit-specific code needs to be reverted for Lovable rollback.

## Guardrails

- Keep Lovable selectors and DOM assumptions in Lovable-specific files only.
- Do not widen Replit selectors to support Lovable.
- Keep Lovable artifact collection lightweight unless there is a real need for deeper workspace evidence.
- Prefer adapter-level changes over global content-script branching.
