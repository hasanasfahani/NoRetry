# Next Move Evals

These evals test whether the next-move interpreter and final review decision keep a user on the safest next step.

For the full operating guide, see [`../../../docs/next-move-eval-runbook.md`](../../../docs/next-move-eval-runbook.md).

## Files

- `next-move-cases.ts` defines the scenario, expected result, and human-readable rubric.
- `next-move-rubric.ts` turns product-safety rules into executable checks.
- `fixtures/next-move-ai-responses.json` stores deterministic AI interpreter responses for replay mode.
- `../../scripts/next-move-eval.mjs` runs the eval.

## Modes

Default replay mode is CI-safe:

```bash
npm run test:next-move-eval
```

Replay mode loads every AI response from `fixtures/next-move-ai-responses.json` and fails if any case is missing a fixture.

Inline mode uses the `aiFixture` values embedded in `next-move-cases.ts`:

```bash
NEXT_MOVE_EVAL_MODE=inline npm run test:next-move-eval
```

Record mode rebuilds `fixtures/next-move-ai-responses.json` from the embedded fixtures and then runs the eval:

```bash
NEXT_MOVE_EVAL_MODE=record npm run test:next-move-eval
```

Use record mode after intentionally adding or changing approved fixtures.

## Suite Commands

Run the full next-move interpreter/eval suite:

```bash
npm run test:next-move
```

Run the next-move suite plus broader review-routing smoke coverage:

```bash
npm run test:review-next-move
```

Run the strict CI versions:

```bash
npm run test:next-move:ci
npm run test:review-next-move:ci
```

Write a machine-readable JSON report:

```bash
npm run test:next-move-eval:report
```

Run the Phase 10 fallback-cleanup readiness gate:

```bash
npm run test:next-move-eval:cleanup
```

Export pending production candidates into a review report:

```bash
npm run test:next-move-candidates:export
```

From the repo root:

```bash
npm run test:next-move:report
npm run test:next-move:cleanup
npm run test:next-move:candidates
```

The same commands are also available from the repo root:

```bash
npm run test:next-move
npm run test:next-move:ci
npm run test:review-next-move
npm run test:review-next-move:ci
```

## Thresholds

Replay mode enforces conservative default thresholds:

- overall pass rate: `100%`
- interpreter pass rate: `100%`
- AI-selected decision pass rate: `100%`
- hard-gate pass rate: `100%`
- rubric pass rate: `100%`

You can override them with decimal values from `0` to `1`:

```bash
NEXT_MOVE_EVAL_MIN_OVERALL=0.95 npm run test:next-move-eval
```

Supported threshold variables:

- `NEXT_MOVE_EVAL_MIN_OVERALL`
- `NEXT_MOVE_EVAL_MIN_INTERPRETER`
- `NEXT_MOVE_EVAL_MIN_AI_DECISION`
- `NEXT_MOVE_EVAL_MIN_HARD_GATE`
- `NEXT_MOVE_EVAL_MIN_RUBRIC`

Cleanup gate variables:

- `NEXT_MOVE_EVAL_REQUIRE_CLEANUP_READY=1` fails when fallback cleanup has known blockers.
- `NEXT_MOVE_EVAL_REQUIRE_NO_FALLBACK_ONLY_SAVES=1` fails when any case is still saved only by fallback.

## JSON Reports

Set `NEXT_MOVE_EVAL_REPORT_PATH` to write the eval result as JSON:

```bash
NEXT_MOVE_EVAL_REPORT_PATH=.tmp/next-move-eval-report.json npm run test:next-move-eval
```

The report includes:

- fixture mode and fixture coverage
- thresholds and threshold failures
- aggregate pass counts and rates
- cleanup report buckets
- cleanup readiness plan and cleanup gate failures
- per-case interpreter, decision, rubric, and fallback details

## GitHub Actions

`.github/workflows/review-next-move.yml` runs the strict replay gate on pull requests and pushes that touch review, next-move, package, or shared-schema files.

The workflow runs:

```bash
npm run test:review-next-move:ci
```

It also uploads `apps/extension/.tmp/next-move-eval-report.json` as a workflow artifact for inspection.

## Cleanup Report

The eval prints a fallback cleanup report after the pass/fail list:

- `AI passed, fallback missed` shows cases where the AI interpreter is carrying behavior the old heuristic cannot.
- `Fallback passed, AI missed` shows cases where fallback is still protecting the product.
- `AI/local signal disagreements` shows cases to inspect before removing fallback branches.
- `Low-confidence AI fallback uses` shows where the low-confidence safety valve is still active.

## Cleanup Plan

Phase 10 adds a cleanup plan after the cleanup report. It turns the raw buckets into recommended actions:

- `ready_for_narrow_cleanup` means there are no fallback-only saves and no cases where both paths missed.
- `cleanup_candidate` marks local fallback behavior that should not be preserved if it conflicts with the AI path.
- `protected` marks fallback behavior that should stay, especially low-confidence AI fallback and AI-unavailable fallback.

The cleanup script requires readiness but still does not allow removing all fallback behavior:

```bash
npm run test:next-move-eval:cleanup
```

## Production Candidate Review

The live extension stores local next-move telemetry and creates pending eval candidates when it sees learning signals such as AI/local disagreement or low-confidence fallback use.

When the extension API base points at the admin/API app, it also syncs candidates to `POST /api/admin/eval-candidates`. For local testing with the admin script, use:

```bash
PLASMO_PUBLIC_API_BASE_URL=http://localhost:3002
```

Review candidates in the separate admin portal:

```bash
npm run dev:admin
```

Then open:

```text
http://localhost:3002/admin/eval-review
```

Paste/import candidate JSON, review each candidate, choose a status, add notes, and export the reviewed JSON for fixture/rubric promotion.

You can also export a Markdown report with:

```bash
npm run test:next-move-candidates:export
```

Candidates are suggestions only. A human reviewer must accept, reject, edit, or mark product-rule changes before any case is promoted into fixtures or rubrics.

## Adding A Case

1. Add the scenario to `next-move-cases.ts`.
2. Include the expected interpreter result, selected signal source, final decision, and hard-gate expectation.
3. Run inline mode to check the case shape.
4. Run record mode to update replay fixtures.
5. Run default replay mode to confirm deterministic coverage.

The current dataset is intentionally focused on Replit/Lovable trust moments: unfinished data saving, broken booking submits, deployment without proof, unresolved Supabase choices, Stripe readiness, launch confidence, mobile layout misses, and broken primary actions.
