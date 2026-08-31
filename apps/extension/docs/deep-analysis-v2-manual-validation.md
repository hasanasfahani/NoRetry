# Deep Analysis v2 Manual Validation

Phase 6 turns live testing into launch evidence.

## Goal

Manually test Deep Analysis v2 on real assistant answers and measure:

- whether v2 starts after the assistant answer is complete
- whether the popup opens with a cached/prewarmed result
- whether requirement matching agrees with the submitted prompt
- whether the generated prompt is specific and action-only
- whether prompt intent/source match the situation
- whether next-step requirements and blocked scope are reflected in the generated prompt
- whether latency is acceptable
- whether admin candidates capture useful review data

## Setup

Start the admin/API app:

```bash
npm run dev:admin
```

Run the extension with the API base pointed at the admin/API app and v2 enabled:

```bash
PLASMO_PUBLIC_API_BASE_URL=http://localhost:3002 PLASMO_PUBLIC_DEEP_ANALYSIS_V2_ROLLOUT=on npm run dev:extension
```

For live provider testing, run the API with valid Kimi/DeepSeek keys and:

```bash
PROMPT_OPTIMIZER_USE_MOCKS=false
```

Open the admin portal:

```text
http://localhost:3002/admin/eval-review
```

## Test Matrix

Capture at least 10 real samples:

- ChatGPT short Replit-style Phase 1 completion
- ChatGPT long code answer
- Replit coding-agent completion
- Lovable completion
- answer missing the requested next step
- answer suggesting backend too early
- partial/incomplete implementation
- answer with validation proof
- answer with no proof
- confusing or ambiguous assistant answer

## Per-Sample Checklist

For each sample:

1. Submit the prompt to the target assistant.
2. Wait until the assistant controls return and the streaming/generating indicator is gone.
3. Open the extension popup immediately.
4. Record whether the result appears quickly or waits for analysis.
5. Check whether the decision matches the submitted prompt requirements.
6. Check whether the next prompt is specific, short, and not a generic template.
7. Check the admin portal candidate card for provider, rollout mode, latency, status, and generated prompt.
8. Check the Deep Analysis v2 trace:
   - `Prompt intent` matches the situation.
   - `Next step source` is honest (`assistant_suggestion`, `project_memory`, `system_inferred`, or `unavailable`).
   - `Next step requirements` are concrete enough to implement.
   - `Blocked scope` appears in the generated prompt as a clear `Do not...` line when needed.
9. Mark the candidate as accepted, rejected, needs edit, or product-rule issue.

## Live Report

Generate a local launch-readiness report:

```bash
npm run report:deep-analysis-v2-live
```

By default, the report reads:

```text
apps/api/.tmp/admin-next-move-eval-candidates.json
```

and writes:

```text
apps/api/.tmp/deep-analysis-v2-live-report.md
```

If your candidate file is elsewhere:

```bash
DEEP_ANALYSIS_V2_LIVE_CANDIDATES_INPUT=/path/to/admin-next-move-eval-candidates.json npm run report:deep-analysis-v2-live
```

The report summarizes:

- provider/fallback counts
- latency p50/p90
- prompt intent counts
- next-step source counts
- generated-prompt quality issues
- recent-case next-step requirements and blocked scope

## Launch Rule Of Thumb

Keep v2 `on` only when:

- at least 10 real samples are captured
- all pending v2 candidates are reviewed
- p90 latency is acceptable for the user experience
- fallback and low-confidence rates are low
- generated-prompt quality issues are zero or reviewed
- any wrong decisions are added to evals before launch

If not, switch to:

```bash
PLASMO_PUBLIC_DEEP_ANALYSIS_V2_ROLLOUT=shadow
```
