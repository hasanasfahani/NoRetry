# Next-Move Eval Runbook

This runbook explains how to operate the next-move eval framework as a product safety system for non-technical builders using Replit, Lovable, and similar app-building tools.

## Purpose

The next-move system decides what the user should do after the assistant answers:

- continue to the next phase
- finish missing requirements
- review or validate before advancing
- clarify a product decision
- move to a new task
- continue an optional enhancement

The eval framework checks whether that decision protects the user from moving ahead too early.

The core product promise is:

> If the app-building assistant says something is done, reeva still checks whether the user's original requirement is actually satisfied before recommending the next step.

## What The Eval Protects

The eval is focused on trust moments that matter to non-technical users:

- a Replit app UI exists, but data is not saved
- a Lovable page looks good, but the submit button does not work
- the assistant wants to deploy before browser validation
- Supabase or auth setup needs a user decision before implementation
- a Stripe checkout screen exists, but payment processing is incomplete
- the assistant claims launch readiness without proof for login, payments, or saved data
- mobile layout is broken even though desktop looks close

These cases prevent the system from confusing visual progress with real completion.

## Roles

**User**

The non-technical builder who asked for an app, feature, fix, or validation step.

**Assistant**

The coding agent or app-building agent that produced the latest answer.

**AI Interpreter**

The model-backed layer that interprets what the assistant is asking to do next.

**Local Fallback**

The older heuristic backup that interprets next moves with deterministic rules.

**Final Decision**

The product decision shown to the user after the interpreter result is combined with review state, requirement satisfaction, validation status, and safety gates.

**Eval Case**

One scenario with a known expected outcome.

**Rubric**

Executable product-safety rules that explain what must be true, beyond simple label matching.

## Quality Gates

The strict CI gate currently requires:

- overall pass rate: 100%
- interpreter pass rate: 100%
- AI-selected decision pass rate: 100%
- hard-gate pass rate: 100%
- rubric pass rate: 100%

The strict command is:

```bash
npm run test:review-next-move:ci
```

The GitHub Actions workflow runs this same gate and uploads a JSON report artifact.

## Reading The Report

The eval prints six important sections.

**Overall**

Whether each case passed every required check.

**Interpreter**

Whether the AI interpreter understood the assistant's intent correctly.

**AI-selected decision**

Whether the final decision using the selected AI/fallback signal matched the expected product outcome.

**Fallback decision**

Whether the old local fallback would have made the same correct final decision.

This is informative, not the primary release gate.

**Hard gate**

Whether unsatisfied requirements were blocked from advancing.

This should always stay at 100%.

**Rubric**

Whether product-safety rules passed.

This should always stay at 100%.

## Reading The Cleanup Report

The cleanup report helps decide when fallback logic can be simplified.

**AI passed, fallback missed**

These are cases where the AI interpreter adds value beyond the old fallback.

Use these cases to identify fallback branches that are weaker than the AI path.

**Fallback passed, AI missed**

These are cases where fallback is still protecting the product.

Do not remove fallback behavior while this count is above zero.

**Both missed expected decision**

These cases mean the product logic itself likely needs work.

Treat these as high priority.

**AI/local signal disagreements**

These are cases where AI and fallback interpreted the assistant differently.

They are not automatically bad, but they should be reviewed before removing fallback branches.

**Low-confidence AI fallback uses**

These cases prove the low-confidence safety valve is still active.

Do not remove this path until the dataset and live telemetry show it is no longer needed.

## Reading The Cleanup Plan

Phase 10 adds a cleanup plan beneath the cleanup report. The cleanup report says what happened; the cleanup plan says what to do about it.

**Status**

`ready_for_narrow_cleanup` means the current eval has no fallback-only saves and no cases where both AI and fallback missed the expected decision.

This does not mean all fallback can be removed. It means a small, reviewed fallback cleanup can begin.

**Can start narrow cleanup**

This should be `yes` before removing or weakening a specific fallback branch.

**Can remove all fallback**

This should stay `no` until the product has enough eval coverage and production telemetry to prove the fallback is no longer needed.

**Cleanup candidates**

These are local fallback behaviors that should not be protected if they disagree with the AI path.

Examples this gate can surface:

- local continuation behavior on assistant clarification questions
- broad local continuation behavior when the AI sees unfinished core work or optional future work

**Protected fallback paths**

These should stay:

- low-confidence AI fallback
- AI-unavailable fallback

These paths protect users when the model output is weak or the interpreter cannot run.

## Cleanup Gate

The Phase 10 cleanup gate is stricter than the normal report, but it is about cleanup readiness rather than product correctness.

Run it from the extension workspace:

```bash
npm run test:next-move-eval:cleanup
```

Run it from the repo root:

```bash
npm run test:next-move:cleanup
```

The cleanup gate enables:

- `NEXT_MOVE_EVAL_REQUIRE_CLEANUP_READY=1`
- `NEXT_MOVE_EVAL_REQUIRE_NO_FALLBACK_ONLY_SAVES=1`

This fails if fallback cleanup becomes unsafe.

## Production Feedback Loop

The extension now records local next-move telemetry when the review popup shows a decision and when the primary next-move action is clicked.

Captured fields include:

- user request and assistant answer, trimmed for local review
- final next-move decision shown to the user
- AI signal, local fallback signal, selected signal source, and agreement
- simplified requirement-match decision, rollout mode, and whether it was applied to the popup
- review mode, task type, workflow state, analysis status, and confidence
- user action when the primary next-move button is clicked

Telemetry is stored locally in extension storage. It is used to create pending eval candidates when the system sees useful learning signals such as AI/local disagreement, AI-only/local-only signals, low-confidence fallback use, or missing next-move signals.

When the extension API base points at the admin/API app, pending candidates are also pushed to:

```text
POST /api/admin/eval-candidates
```

For local testing, make sure the extension and admin portal use the same API port. With the current admin script, the extension should be built with:

```bash
PLASMO_PUBLIC_API_BASE_URL=http://localhost:3002
```

## Eval Review

For the MVP workflow, PM review happens in the separate admin portal, not inside the extension UI.

The simplified next-prompt flow has a rollout switch documented in:

```text
apps/extension/docs/simple-next-prompt-rollout.md
```

Use `shadow` mode to collect simple-flow telemetry without changing the user-facing popup, and `off` mode to roll back to the older decision path.

Start the admin web app from the repo root:

```bash
npm run dev:admin
```

Then open:

```text
http://localhost:3002/admin/eval-review
```

Use the admin portal to inspect synced candidates, import candidate JSON when needed, inspect the user request and assistant answer, compare AI/fallback signals, add reviewer notes, and mark each candidate:

- accept
- reject
- needs edit
- product-rule issue

The admin portal stores the review workspace in the browser for the MVP. Export the reviewed JSON when the decisions should be promoted into fixtures, rubrics, or product-rule work.

You can also export candidates into a PM-readable Markdown report:


```bash
npm run test:next-move:candidates
```

By default this reads:

```bash
apps/extension/.tmp/next-move-eval-candidates.json
```

and writes:

```bash
apps/extension/.tmp/next-move-eval-candidates.md
```

Use this report for GitHub PR review when candidates should be promoted into the eval dataset.

Important rule: telemetry can suggest eval cases automatically, but a human must approve the candidate before it changes fixtures, rubrics, or product rules.

## Failure Triage

When the eval fails, use this order.

1. Check hard-gate failures first.

If hard gate fails, the system may let users advance with unsatisfied requirements. Fix this before anything else.

2. Check rubric failures.

Rubric failures usually mean the final label may look close, but the product behavior violates a trust rule.

3. Check AI-selected decision failures.

These mean the final user-facing recommendation is wrong.

4. Check interpreter failures.

These mean the AI intent interpretation fixture, prompt, or expectation needs review.

5. Check fallback-only saves.

If fallback is still saving a case, fallback cleanup is premature.

## Adding A New Case

Use this checklist:

1. Start from a realistic user workflow.

Prefer Replit/Lovable-style examples with concrete app-building risks.

2. Define the user's original requirement.

Example: "customers can submit a booking" or "CRM saves customers."

3. Define what the assistant said.

Include the misleading or risky next move if there is one.

4. Define review state.

Set `analysisStatus`, `workflowState`, `noRetryRecommended`, and recommendation text to reflect whether the requirement is actually satisfied.

5. Define the expected interpreter output.

This should describe the assistant's intent, not whether the user should approve it.

6. Define the expected final decision.

This is the product recommendation the user should see.

7. Add rubric notes.

Write what must be protected in plain language.

8. Run inline mode.

```bash
NEXT_MOVE_EVAL_MODE=inline npm run test:next-move-eval
```

9. Record fixtures.

```bash
NEXT_MOVE_EVAL_MODE=record npm run test:next-move-eval
```

10. Run the CI gate.

```bash
npm run test:review-next-move:ci
```

## Case Template

```ts
{
  id: "platform-specific-risk-short-name",
  title: "Human-readable scenario title",
  category: "requirement_gate",
  input: {
    promptText: "What the user asked for",
    responseText: "What the assistant answered",
    taskFamily: "coding",
    review: {
      analysisStatus: "PARTIAL",
      confidence: "high",
      workflowState: "implementation_underway",
      noRetryRecommended: false,
      decisionText: "What the review found",
      recommendationText: "What the user should do next",
      promptText: "Prompt text for the next action"
    }
  },
  aiFixture: {
    promptVersion: "assistant-next-move-interpreter.v1",
    currentStepClaim: "partial",
    nextMoveType: "optional_enhancement",
    nextMoveSummary: "Assistant offers future work while current work is unfinished.",
    targetLabel: "future work",
    targetPhaseNumber: null,
    requiresApproval: false,
    suggestsImplementation: true,
    suggestsClarification: false,
    suggestsValidation: false,
    suggestsCompletion: false,
    confidenceLevel: "high"
  },
  expected: {
    interpreter: {
      currentStepClaim: "partial",
      nextMoveType: "optional_enhancement"
    },
    selectedSignalSource: "ai",
    decision: {
      status: "risky",
      recommendationKind: "review_before_advancing"
    },
    hardGate: {
      requirementSatisfied: false,
      mustBlockAdvancement: true,
      rationale: "The original user requirement is not satisfied yet."
    }
  },
  rubric: {
    must: [
      "Protect the user's original requirement.",
      "Block optional future work until the current step is complete."
    ],
    rejectIf: ["The final decision recommends optional future work now."]
  }
}
```

## When To Relax Thresholds

Default thresholds are intentionally strict.

Only relax a threshold when:

- the eval is running in an explicitly non-blocking experiment
- the change has a clear owner and expiration date
- hard gate and rubric remain at 100%

Do not relax hard-gate or rubric thresholds for production CI.

## When To Remove Fallback Branches

Fallback cleanup should wait until:

- `Fallback passed, AI missed` is zero
- low-confidence fallback use is understood
- the relevant disagreement cases have been reviewed
- the dataset covers the user workflows affected by the fallback branch
- the strict CI gate passes after cleanup

Fallback removal should be incremental. Remove one narrow branch, run the gate, and inspect the cleanup report again.

## Phase 10 Cleanup Rules

Use these rules for the first cleanup pass:

1. Keep the low-confidence AI fallback.

This is still used by the eval and should not be removed.

2. Keep fallback for AI outages.

The eval proves answer quality, not service availability.

3. Do not preserve local behavior just because it exists.

If AI passes and fallback misses, the fallback behavior is a cleanup candidate, not a feature to protect.

4. Clean one branch at a time.

After each cleanup patch, run:

```bash
npm run test:next-move:cleanup
```

5. Add cases before larger cleanup.

Before broad fallback reduction, add more real Replit and Lovable examples around auth, saved data, deployment, Stripe, mobile, and broken primary actions.

## Current Baseline

Current checked baseline:

- cases: 18
- overall: 100%
- interpreter: 100%
- AI-selected decision: 100%
- hard gate: 100%
- rubric: 100%
- fallback decision: 100%
- AI passed, fallback missed: 0
- fallback passed, AI missed: 0
- low-confidence AI fallback uses: 1
- cleanup status: ready for narrow cleanup
- can remove all fallback: no
