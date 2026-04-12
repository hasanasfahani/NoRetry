# AFTER Review Trust Contract

This document defines how AFTER should analyze one AI answer consistently enough to earn user trust.

## Core Principle

The same reviewed answer must keep the same review contract every time:

- same target answer
- same goal
- same acceptance criteria
- same criterion sources
- same criterion priorities
- same verdict rules

Quick and deep review are allowed to differ only in evidence depth, not in what success means.

## 1. Freeze One Review Contract Per Answer

When AFTER opens on an answer, it creates one immutable review contract:

- `target_signature`
- canonical goal
- canonical criteria
- criterion source
- criterion layer
- criterion priority

That contract is reused for:

- re-opening the same answer
- switching between quick and deep
- re-running the same answer later

## 2. Criterion Provenance Is Mandatory

Every criterion must carry a source:

- `submitted_prompt`
- `definition_of_done`
- `user_intent`
- `constraint`
- `validation`

This keeps the checklist explainable and prevents criteria from being invented by the answer itself.

## 3. Core Vs Validation

Criteria are split into two layers:

- `core`
- `validation`

Core criteria represent the user-facing outcome. Validation criteria represent quality or verification checks such as runtime stability and console health.

## 4. Quick And Deep Share One Checklist

Quick review and deep review must use the exact same criteria labels and priorities for a given answer.

Allowed difference:

- Quick may return `not_sure`
- Deep should resolve the same criteria into binary outcomes whenever visible evidence is sufficient

Not allowed:

- adding criteria in deep
- dropping criteria in deep
- renaming criteria in deep

## 5. Verdict Is Rule-Based

The top badge should be derived from checklist outcomes, not invented independently.

High-level rule:

- any missed core criterion => fail the answer as incomplete
- all core met but validation unresolved => likely success
- all core and validation met with stronger inspection => success
- wrong-direction evidence => wrong direction

## 6. Deep Review Is Binary

Deep review should avoid `not_sure` for the fixed checklist when the visible evidence is sufficient to decide. If evidence is still not enough, the criterion should remain explicitly unresolved in the verdict reasoning rather than mutate the checklist.

## 7. Deep Must Explain The Delta

If deep changes any criterion outcome relative to quick, it should explain what tightened and why. The user should understand what extra scrutiny deep applied.

## 8. Evidence Levels

Evidence should be monotonic:

- `limited`: mostly claim-level support
- `moderate`: targeted support for the fixed checklist
- `strong`: deep review resolved the full fixed checklist with direct support

Deep should never lower trust by changing the checklist contract or making the result less specific.

## 9. Regression Cases

The trust contract is only durable if it is tested against real fixtures.

Each regression case should freeze:

- submitted prompt
- project memory
- current state
- answer text
- expected review contract
- expected quick verdict
- expected deep verdict

The regression runner should fail if any of these drift for the same answer.
