# Phase 1 Architecture

## Scope

Phase 1 standardizes the extension around two product capabilities only:

- AFTER answer analysis
- Empty-chat prompt optimization

It does **not** preserve a separate BEFORE architecture track. Any prompt-shaping flow should now be treated as part of the shared prompt-optimization capability.

## Layer Boundaries

### 1. Core

The core owns product behavior that should stay identical across websites.

Responsibilities:

- Attempt/session orchestration
- AFTER answer analysis flow
- Empty-chat optimization flow
- Next-step planner state machine
- Acceptance-criteria extraction inputs
- Reuse and stale-result rules

The core must never read raw DOM directly.

### 2. Surface Adapters

Surface adapters translate one website into normalized product snapshots.

Responsibilities:

- Read the current draft prompt
- Write the draft prompt back into the host input
- Detect the latest assistant response
- Detect the latest submitted user prompt when possible
- Produce response identity for reuse matching
- Produce thread identity for stale-state protection
- Provide safe panel mount/anchor context

Surface adapters are the only place where host-specific selectors or DOM assumptions should live.

### 3. Extension Shell

The extension shell owns the rendering and event wiring for the browser extension channel.

Responsibilities:

- Render the popup/panel
- Listen for user actions
- Ask the active adapter for snapshots
- Pass normalized snapshots into the core

The shell should stay thin and avoid website-specific branching beyond choosing the active adapter.

## Normalized Snapshot Model

Every surface adapter should provide the same normalized shapes:

- `DraftPromptSnapshot`
- `AssistantResponseSnapshot`
- `UserPromptSnapshot`
- `ThreadSnapshot`
- `PanelMountContext`

These become the only inputs the core needs from any website.

## Directory Direction

Target direction for the extension:

- `apps/extension/lib/core`
  - shared orchestration and product logic
- `apps/extension/lib/surfaces`
  - adapter contract and resolver
- `apps/extension/lib/surfaces/chatgpt`
  - ChatGPT adapter
- `apps/extension/lib/surfaces/replit`
  - Replit adapter
- `apps/extension/components`
  - channel UI
- `apps/extension/contents`
  - extension-shell mounting entrypoints

## Phase 1 Completion Criteria

Phase 1 is complete only when:

1. ChatGPT and Replit both run through the same adapter contract
2. AFTER logic consumes normalized snapshots only
3. Empty-chat optimization consumes normalized snapshots only
4. No host-specific DOM logic leaks into the shared orchestration path
5. ChatGPT and Replit pass the same runtime checklist
