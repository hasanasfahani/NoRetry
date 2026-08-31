# Deep Analysis v2 Rollout

Deep Analysis v2 uses one structured AI analysis result for requirement matching, next-step detection, and the generated follow-up prompt.

## Rollout modes

Set `PLASMO_PUBLIC_DEEP_ANALYSIS_V2_ROLLOUT` before building or running the extension.

- `on`: run Deep Analysis v2 and apply it to the popup.
- `shadow`: run Deep Analysis v2, attach telemetry/admin snapshots, but keep the legacy deep analysis user-facing.
- `off`: skip Deep Analysis v2 and use the legacy deep analysis path.

The default is `on` so the current v2 popup behavior stays active unless the env var is changed.

## Telemetry

When v2 runs, next-move telemetry records a compact `deepAnalysisV2Decision` snapshot:

- rollout mode and whether it was applied
- provider/model/latency
- overall status and confidence
- requirement count and missing count
- assistant-suggested next move
- prompt intent and next-step source
- next-step requirements and blocked scope
- generated prompt

Shadow-mode, fallback-provider, and low-confidence v2 cases are promoted into the admin eval candidate review queue.

## Manual testing

Use these modes while testing:

- `PLASMO_PUBLIC_DEEP_ANALYSIS_V2_ROLLOUT=on` to verify the popup uses v2.
- `PLASMO_PUBLIC_DEEP_ANALYSIS_V2_ROLLOUT=shadow` to compare v2 telemetry against the legacy popup.
- `PLASMO_PUBLIC_DEEP_ANALYSIS_V2_ROLLOUT=off` to confirm the old path is still available.

For live provider testing, run the API with `PROMPT_OPTIMIZER_USE_MOCKS=false` and valid Kimi/DeepSeek env keys.

## Phase 6 eval gate

Run the v2 release-confidence checks before changing the v2 prompt, fallback, or rollout behavior:

```bash
npm run test:deep-analysis-v2:ci
```

The eval suite focuses on the core product promise:

- match the submitted prompt requirements against the assistant answer
- ask for confirmation when a requested item is missing or contradicted
- extract the assistant's suggested next move
- generate a short, action-only next prompt that asks the assistant to confirm completed requirements and suggest the next step

The current cases cover the booking-app Phase 1 flow, long ChatGPT code answers, missing next-step confirmation, no-code format violations, missing requested code, UI-only scope drift, generic prompt-intent flows, and proof-before-advancing behavior.

Generate non-blocking silver eval candidates with:

```bash
npm run generate:deep-analysis-v2-silver
```

Silver cases are written to `apps/api/.tmp/deep-analysis-v2-silver-cases.json`. They are not part of CI and should be reviewed before promotion into the gold safety set.

## Phase 7 live validation

Use the manual validation guide before launch:

```text
apps/extension/docs/deep-analysis-v2-manual-validation.md
```

After testing real ChatGPT/Replit/Lovable answers, generate the live readiness report:

```bash
npm run report:deep-analysis-v2-live
```

This summarizes captured v2 candidates, provider/fallback counts, confidence, pending review count, latency p50/p90, prompt intent/source counts, and generated-prompt quality issues.
