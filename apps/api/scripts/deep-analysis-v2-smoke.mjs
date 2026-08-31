import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "esbuild"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const apiRoot = path.resolve(scriptDir, "..")
const repoRoot = path.resolve(apiRoot, "../..")

async function main() {
  const outdir = await mkdtemp(path.join(os.tmpdir(), "api-deep-analysis-v2-smoke-"))
  try {
    await build({
      entryPoints: [path.resolve(apiRoot, "lib/deep-analysis-v2.ts")],
      outdir,
      bundle: true,
      format: "esm",
      platform: "node",
      tsconfig: path.resolve(repoRoot, "tsconfig.base.json")
    })

    const mod = await import(pathToFileURL(path.join(outdir, "deep-analysis-v2.js")).href)
    const { buildDeepAnalysisV2Fallback, runDeepAnalysisV2 } = mod

    const input = {
      promptText:
        "Act like Replit’s coding agent. I am building a simple booking app. Phase 1 goal: create the booking form UI only. Reply very briefly like a coding agent after completing the work. Do not include code. Say what you changed, confirm Phase 1 is done, and tell me the next phase.",
      responseText:
        "Created booking form UI with fields (name, email, date, time, service, notes), added validation states, and basic layout styling. Phase 1 complete. Next phase: connect form to backend (submit handler + data storage).",
      projectContext: "Building a booking app in phases for a non-technical founder.",
      currentState: "Phase 1 UI was requested.",
      taskType: "creation",
      surface: "chatgpt"
    }

    const fallback = buildDeepAnalysisV2Fallback(input, 12)
    assert.equal(fallback.version, "deep-analysis-v2.v1")
    assert.equal(fallback.overallStatus, "pass")
    assert.equal(fallback.providerMetadata.provider, "fallback")
    assert.equal(fallback.providerMetadata.usedFallback, true)
    assert.equal(fallback.assistantSuggestedNextMove, "connect form to backend (submit handler + data storage)")
    assert.equal(fallback.nextStepSource, "assistant_suggestion")
    assert.equal(fallback.promptIntent, "implement_next_step")
    assert.deepEqual(fallback.nextStepRequirements, [
      "Add required field validation",
      "Show clear error messages",
      "Prevent empty submission",
      "Show a booking confirmation summary"
    ])
    assert.match(fallback.blockedScope.join(" "), /backend/)
    assert.match(fallback.blockedScope.join(" "), /storage/)
    assert.match(fallback.generatedPrompt, /- Add required field validation/)
    assert.match(fallback.generatedPrompt, /Do not connect a backend, or add storage yet\./)
    assert.match(fallback.generatedPrompt, /After you finish, confirm which requirements were completed and suggest the next step\./)

    const nextMoveV2GeneratedPromptInput = {
      ...input,
      promptText: [
        "Implement a focused feature that lets the user who claimed and bought an item add the purchase price before marking it as bought.",
        "The price input should appear on the claimed item during the buy-flow, and the saved price must display on the item in the archived list history.",
        "Keep all existing flows intact: claim, real-time sync, push notifications, and archive behavior must work exactly as before.",
        "Do not add price editing after archive, price totals, price comparison across stores, recipe integration, offline mode support, backend schema migrations beyond a simple price field, auth changes, payments, or UI redesign.",
        "Preserve mobile browser compatibility without app store requirements.",
        "",
        "After you finish, confirm:",
        "- What changed",
        "- Which requested details were completed",
        "- How I can manually test it",
        "- Any risks or follow-up needed"
      ].join("\n"),
      responseText: [
        "I added a purchase price field to claimed items and saved it before the item is archived.",
        "The archive now displays the saved price history.",
        "Claim, sync, push notifications, and archive behavior were preserved."
      ].join("\n")
    }
    const nextMoveV2Fallback = buildDeepAnalysisV2Fallback(nextMoveV2GeneratedPromptInput, 10)
    assert.notDeepEqual(nextMoveV2Fallback.requirementMatches.map((match) => match.requirementText), [
      "Match the submitted prompt requirements."
    ])
    assert.match(nextMoveV2Fallback.requirementMatches[0]?.requirementText ?? "", /purchase price/i)
    assert.match(nextMoveV2Fallback.requirementMatches[1]?.requirementText ?? "", /archived list history/i)
    assert.match(nextMoveV2Fallback.requirementMatches[2]?.requirementText ?? "", /existing flows/i)
    assert.match(nextMoveV2Fallback.requirementMatches[3]?.requirementText ?? "", /mobile browser/i)

    const providerOutput = JSON.stringify({
      verdict: "success",
      score: 0.92,
      issues: ["The answer satisfies the request and the safer next step is validation."],
      missing: [],
      prompt_intent: "implement_next_step",
      next_step_requirements: [
        "Add required field validation",
        "Show clear error messages",
        "Prevent empty submission",
        "Show a booking confirmation summary"
      ],
      blocked_scope: ["Do not connect backend, API, database, or storage yet"],
      next_prompt:
        "Please implement the best next step now:\n- Add required field validation\n- Show clear error messages\n- Prevent empty submission\n- Show a booking confirmation summary\n\nDo not connect backend, API, database, or storage yet.\n\nAfter you finish, confirm which requirements were completed and suggest the next step.",
    })
    const providerResult = await runDeepAnalysisV2(input, {
      callJson: async () => providerOutput,
      now: () => 100
    })
    assert.equal(providerResult.overallStatus, "pass")
    assert.equal(providerResult.providerMetadata.provider, "deepseek")
    assert.equal(providerResult.providerMetadata.usedFallback, false)
    assert.equal(providerResult.providerMetadata.latencyMs, 0)
    assert.equal(providerResult.nextStepSource, "assistant_suggestion")
    assert.equal(providerResult.promptIntent, "implement_next_step")
    assert.deepEqual(providerResult.nextStepRequirements, [
      "Add required field validation",
      "Show clear error messages",
      "Prevent empty submission",
      "Show a booking confirmation summary"
    ])
    assert.deepEqual(providerResult.blockedScope, ["Do not connect backend, API, database, or storage yet"])

    const taggedDecision = JSON.parse(providerOutput)
    const taggedNextPrompt = taggedDecision.next_prompt
    delete taggedDecision.next_prompt
    const taggedProviderOutput = [
      "<decision_json>",
      JSON.stringify(taggedDecision),
      "</decision_json>",
      "<next_prompt>",
      taggedNextPrompt,
      "</next_prompt>"
    ].join("\n")
    const taggedProviderResult = await runDeepAnalysisV2(input, {
      callJson: async () => taggedProviderOutput
    })
    assert.equal(taggedProviderResult.overallStatus, "pass")
    assert.equal(taggedProviderResult.generatedPrompt, taggedNextPrompt)
    assert.deepEqual(taggedProviderResult.nextStepRequirements, providerResult.nextStepRequirements)

    const repairedProviderOutput = `Here is the JSON:\n${providerOutput}`
    const repairedProviderResult = await runDeepAnalysisV2(input, {
      callJson: async () => repairedProviderOutput
    })
    assert.equal(repairedProviderResult.providerMetadata.provider, "deepseek")
    assert.equal(repairedProviderResult.overallStatus, "pass")

    let messyProviderCallCount = 0
    let messyProviderRepairCallCount = 0
    const messyProviderOutput = [
      "Here is the decision:",
      "<decision_json>",
      "{ status: \"success\", score: 0.91, issues: [\"Recovered locally\",], missing: [],",
      " nextStepRequirements: [\"Add required field validation\",], blockedScope: [\"Do not add backend\",],",
      " generatedPrompt: \"Please implement validation only. After you finish, confirm which requirements were completed and suggest the next step.\", } // trailing note",
      "</decision_json>"
    ].join("\n")
    const messyProviderResult = await runDeepAnalysisV2(input, {
      callJson: async (systemPrompt) => {
        messyProviderCallCount += 1
        if (/repair/i.test(systemPrompt)) messyProviderRepairCallCount += 1
        return messyProviderOutput
      }
    })
    assert.equal(messyProviderResult.providerMetadata.provider, "deepseek")
    assert.equal(messyProviderResult.overallStatus, "pass")
    assert.equal(messyProviderCallCount, 1)
    assert.equal(messyProviderRepairCallCount, 0, "Expected tolerant local parsing to recover before LLM repair.")
    assert.deepEqual(messyProviderResult.nextStepRequirements, ["Add required field validation"])
    assert.ok(messyProviderResult.blockedScope.includes("Do not add backend"))

    let lowBudgetRepairCallCount = 0
    const lowBudgetUnavailable = await runDeepAnalysisV2(input, {
      hardTimeoutMs: 5000,
      retryDelayMs: 0,
      callJson: async (systemPrompt) => {
        if (/repair/i.test(systemPrompt)) lowBudgetRepairCallCount += 1
        return "not json"
      }
    })
    assert.equal(lowBudgetRepairCallCount, 0, "Expected compact JSON repair to be skipped when the repair budget is too low.")
    assert.equal(lowBudgetUnavailable.providerMetadata.provider, "none")
    assert.equal(lowBudgetUnavailable.providerMetadata.deepSeekFailureReason, "invalid_json")

    const noSuggestionKimiOutput = JSON.stringify({
      ...JSON.parse(providerOutput),
      prompt_intent: "ask_for_next_step",
      next_step_requirements: [],
      blocked_scope: [],
      next_prompt:
        "Before implementing more, suggest the safest next step based on the completed work. After you finish, confirm which requirements were completed and suggest the next step."
    })
    const noSuggestionResult = await runDeepAnalysisV2(input, {
      callJson: async () => noSuggestionKimiOutput
    })
    assert.equal(noSuggestionResult.nextStepSource, "unavailable")
    assert.equal(noSuggestionResult.promptIntent, "ask_for_next_step")
    assert.deepEqual(noSuggestionResult.nextStepRequirements, [])
    assert.match(noSuggestionResult.generatedPrompt, /suggest the safest next step/i)

    const trackerInput = {
      ...input,
      promptText: [
        "Project tracker mode is on. Review the latest AI agent answer against the CURRENT phase only.",
        "",
        "CURRENT PHASE REQUIREMENTS",
        "Phase 1 of 2: Core Logging Engine",
        "Goal: Enable frictionless water logging.",
        "",
        "REQUIREMENT-LEVEL CHECKLIST",
        "Return one requirement match for each item below. Do not collapse these into a generic row.",
        "- Build scope: Tap-to-log with 250ml, 500ml, custom size buttons",
        "- Build scope: Circular progress ring showing ml consumed versus daily goal",
        "- Validation proof: 5 user tests showing 3+ logs per session without prompting",
        "",
        "NEXT PHASE REQUIREMENTS",
        "Phase 2 of 2: Smart Reminder System"
      ].join("\n"),
      responseText: [
        "Phase 1 implementation completed.",
        "Completed preset logging options: 250ml, 500ml, custom size.",
        "Completed circular progress ring showing current ml consumed and daily goal.",
        "The only validation item still needed is 5 user tests showing 3+ logs per session without prompting."
      ].join("\n")
    }
    const trackerProviderOutput = JSON.stringify({
      verdict: "partial",
      score: 0.74,
      issues: ["Implementation is mostly complete, but external user-test validation is still missing."],
      passed: [
        "Build scope: Tap-to-log with 250ml, 500ml, custom size buttons",
        "Build scope: Circular progress ring showing ml consumed versus daily goal"
      ],
      missing: ["Validation proof: 5 user tests showing 3+ logs per session without prompting"],
      ignored_external_validation: ["Validation proof: 5 user tests showing 3+ logs per session without prompting"],
      item_results: [
        {
          id: "project_tracker_check_1",
          text: "Build scope: Tap-to-log with 250ml, 500ml, custom size buttons",
          classification: "implementation_requirement",
          status: "pass",
          reason: "Confirmed by assistant answer."
        },
        {
          id: "project_tracker_check_2",
          text: "Build scope: Circular progress ring showing ml consumed versus daily goal",
          classification: "implementation_requirement",
          status: "pass",
          reason: "Confirmed by assistant answer."
        },
        {
          id: "project_tracker_check_3",
          text: "Validation proof: 5 user tests showing 3+ logs per session without prompting",
          classification: "external_validation",
          status: "ignored",
          reason: "Requires real user testing outside the app/code implementation."
        }
      ],
      classification_audit: ["5 user tests are external validation and do not block app implementation rows."],
      prompt_intent: "confirm_missing_requirements",
      assistant_suggested_next_move: "",
      next_step_requirements: [],
      blocked_scope: ["Phase 2: Smart Reminder System"],
      next_prompt:
        "Finish the missing validation proof only.\n- Run 5 user tests showing 3+ logs per session without prompting\n\nDo not start Phase 2 yet.\n\nAfter you finish, confirm which requirements were completed and suggest the next step."
    })
    const trackerResult = await runDeepAnalysisV2(trackerInput, {
      callJson: async () => trackerProviderOutput
    })
    assert.equal(trackerResult.overallStatus, "pass")
    assert.deepEqual(
      trackerResult.requirementMatches.map((match) => match.status),
      ["pass", "pass"]
    )
    assert.deepEqual(
      trackerResult.requirementMatches.map((match) => match.requirementText),
      [
        "Build scope: Tap-to-log with 250ml, 500ml, custom size buttons",
        "Build scope: Circular progress ring showing ml consumed versus daily goal"
      ]
    )
    assert.deepEqual(trackerResult.ignoredExternalValidation, [
      "Validation proof: 5 user tests showing 3+ logs per session without prompting"
    ])

    const missingAuditProviderOutput = JSON.stringify({
      ...JSON.parse(trackerProviderOutput),
      classification_audit: []
    })
    const missingAuditResult = await runDeepAnalysisV2(trackerInput, {
      callJson: async () => missingAuditProviderOutput
    })
    assert.equal(missingAuditResult.providerMetadata.provider, "deepseek")
    assert.equal(missingAuditResult.overallStatus, "pass")
    assert.deepEqual(missingAuditResult.ignoredExternalValidation, [
      "Validation proof: 5 user tests showing 3+ logs per session without prompting"
    ])

    const alternateVerdictProviderOutput = JSON.stringify({
      ...JSON.parse(trackerProviderOutput),
      verdict: "pass"
    })
    const alternateVerdictResult = await runDeepAnalysisV2(trackerInput, {
      callJson: async () => alternateVerdictProviderOutput
    })
    assert.equal(alternateVerdictResult.overallStatus, "pass")

    const trustedTrackerInput = {
      ...input,
      promptText: [
        "Project tracker mode is on. Review the latest AI agent answer against the CURRENT phase only.",
        "",
        "CURRENT PHASE REQUIREMENTS",
        "Phase 1 of 2: Static Photo Menu Foundation",
        "Goal: Deliver browsable photo menu accessible via table QR without backend complexity.",
        "",
        "REQUIREMENT-LEVEL CHECKLIST",
        "Return one requirement match for each item below. Do not collapse these into a generic row.",
        "- Build scope: Pre-built JSON menu file with 20 items, 5 categories",
        "- Build scope: Static HTML/CSS/JS deployed to CDN with responsive grid layout",
        "- Deliverable: Deployable static site with QR routing per table",
        "- Deliverable: Menu item component with photo, text, price, tag display",
        "- Acceptance criteria: Menu renders correctly on iOS Safari and Android Chrome",
        "- Acceptance criteria: All 20 items display photo and complete details without truncation",
        "",
        "NEXT PHASE REQUIREMENTS",
        "Phase 2 of 2: Dynamic Content & Server Layer"
      ].join("\n"),
      responseText: [
        "Phase 1 has now been fully closed out.",
        "I stayed strictly within Phase 1: Static Photo Menu Foundation and did not start Phase 2.",
        "Status: Completed.",
        "The pre-built JSON menu file includes 20 menu items across 5 categories.",
        "The static HTML/CSS/JS menu is implemented with a responsive grid layout.",
        "The deployable static site includes QR routing per table.",
        "The menu item component displays photo, text, price, and tags.",
        "Acceptance criteria passed: the menu renders correctly on iOS Safari and Android Chrome.",
        "Acceptance criteria passed: all 20 items display photo and complete details without truncation."
      ].join("\n")
    }
    const overStrictTrackerOutput = JSON.stringify({
      verdict: "partial",
      score: 0.42,
      issues: ["Assistant claims completion but does not provide enough proof."],
      passed: [],
      missing: [
        "Build scope: Pre-built JSON menu file with 20 items, 5 categories",
        "Build scope: Static HTML/CSS/JS deployed to CDN with responsive grid layout",
        "Deliverable: Deployable static site with QR routing per table",
        "Deliverable: Menu item component with photo, text, price, tag display",
        "Acceptance criteria: Menu renders correctly on iOS Safari and Android Chrome",
        "Acceptance criteria: All 20 items display photo and complete details without truncation"
      ],
      item_results: [
        {
          id: "project_tracker_check_1",
          text: "Build scope: Pre-built JSON menu file with 20 items, 5 categories",
          classification: "implementation_requirement",
          status: "missing",
          reason: "Provider was over-strict."
        },
        {
          id: "project_tracker_check_2",
          text: "Build scope: Static HTML/CSS/JS deployed to CDN with responsive grid layout",
          classification: "implementation_requirement",
          status: "missing",
          reason: "Provider was over-strict."
        },
        {
          id: "project_tracker_check_3",
          text: "Deliverable: Deployable static site with QR routing per table",
          classification: "implementation_requirement",
          status: "missing",
          reason: "Provider was over-strict."
        },
        {
          id: "project_tracker_check_4",
          text: "Deliverable: Menu item component with photo, text, price, tag display",
          classification: "implementation_requirement",
          status: "missing",
          reason: "Provider was over-strict."
        },
        {
          id: "project_tracker_check_5",
          text: "Acceptance criteria: Menu renders correctly on iOS Safari and Android Chrome",
          classification: "app_acceptance_criteria",
          status: "missing",
          reason: "Provider was over-strict."
        },
        {
          id: "project_tracker_check_6",
          text: "Acceptance criteria: All 20 items display photo and complete details without truncation",
          classification: "app_acceptance_criteria",
          status: "missing",
          reason: "Provider was over-strict."
        }
      ],
      prompt_intent: "confirm_missing_requirements",
      assistant_suggested_next_move: "",
      next_step_requirements: [],
      blocked_scope: ["Phase 2: Dynamic Content & Server Layer"],
      next_prompt:
        "Finish Phase 1 before moving forward.\n\nAfter you finish, confirm which requirements were completed and suggest the next step."
    })
    const trustedTrackerResult = await runDeepAnalysisV2(trustedTrackerInput, {
      callJson: async () => overStrictTrackerOutput
    })
    assert.equal(trustedTrackerResult.overallStatus, "pass")
    assert.notEqual(trustedTrackerResult.confidence, "low")
    assert.deepEqual(
      trustedTrackerResult.requirementMatches.map((match) => match.status),
      ["pass", "pass", "pass", "pass", "pass", "pass"]
    )

    const externalValidationTrackerInput = {
      ...input,
      promptText: [
        "Project tracker mode is on. Review the latest AI agent answer against the CURRENT phase only.",
        "",
        "CURRENT PHASE REQUIREMENTS",
        "Phase 2 of 3: Smart Recommendations",
        "Goal: Guide customers to confident choices with data-driven dish suggestions.",
        "",
        "REQUIREMENT-LEVEL CHECKLIST",
        "Return one requirement match for each item below. Do not collapse these into a generic row.",
        "- Build scope: 'Most ordered' badges and category bestseller highlights",
        "- Deliverable: Updated app with suggestion overlays on item cards",
        "- Acceptance criteria: Recommendations appear within 500ms of basket change",
        "- Acceptance criteria: Chef approves all 12 pairing suggestions as accurate",
        "- Validation proof: A/B test shows 25% higher average items per order",
        "",
        "NEXT PHASE REQUIREMENTS",
        "Phase 3 of 3: Table Ordering Flow"
      ].join("\n"),
      responseText: [
        "Phase 2 implementation is complete: Smart Recommendations only.",
        "Most Ordered badges and bestseller highlights are implemented.",
        "The updated app includes suggestion overlays on item cards.",
        "Recommendations update within 500ms of basket changes.",
        "I did not start Phase 3."
      ].join("\n")
    }
    const externalValidationProviderOutput = JSON.stringify({
      verdict: "success",
      score: 0.84,
      issues: ["All actionable implementation requirements passed; external validation is ignored for advancement."],
      passed: [
        "Build scope: 'Most ordered' badges and category bestseller highlights",
        "Deliverable: Updated app with suggestion overlays on item cards",
        "Acceptance criteria: Recommendations appear within 500ms of basket change"
      ],
      missing: [],
      ignored_external_validation: [
        "Acceptance criteria: Chef approves all 12 pairing suggestions as accurate",
        "Validation proof: A/B test shows 25% higher average items per order"
      ],
      item_results: [
        {
          id: "project_tracker_check_1",
          text: "Build scope: 'Most ordered' badges and category bestseller highlights",
          classification: "implementation_requirement",
          status: "pass",
          reason: "Confirmed by assistant answer."
        },
        {
          id: "project_tracker_check_2",
          text: "Deliverable: Updated app with suggestion overlays on item cards",
          classification: "implementation_requirement",
          status: "pass",
          reason: "Confirmed by assistant answer."
        },
        {
          id: "project_tracker_check_3",
          text: "Acceptance criteria: Recommendations appear within 500ms of basket change",
          classification: "app_acceptance_criteria",
          status: "pass",
          reason: "Confirmed by assistant answer."
        },
        {
          id: "project_tracker_check_4",
          text: "Acceptance criteria: Chef approves all 12 pairing suggestions as accurate",
          classification: "external_validation",
          status: "ignored",
          reason: "Depends on chef stakeholder approval."
        },
        {
          id: "project_tracker_check_5",
          text: "Validation proof: A/B test shows 25% higher average items per order",
          classification: "external_validation",
          status: "ignored",
          reason: "Depends on live experiment and business metric data."
        }
      ],
      classification_audit: [
        "Chef approval depends on a stakeholder approval outside the app implementation.",
        "A/B test lift depends on live experiment/business metric data.",
        "The 500ms recommendation timing row remains app acceptance criteria."
      ],
      prompt_intent: "implement_next_step",
      assistant_suggested_next_move: "Phase 3: Table Ordering Flow",
      next_step_requirements: ["Implement Phase 3: Table Ordering Flow"],
      blocked_scope: [],
      next_prompt:
        "Implement Phase 3: Table Ordering Flow only.\n\nAfter you finish, confirm which requirements were completed and suggest the next step."
    })
    const externalValidationResult = await runDeepAnalysisV2(externalValidationTrackerInput, {
      callJson: async () => externalValidationProviderOutput
    })
    assert.equal(externalValidationResult.overallStatus, "pass")
    assert.deepEqual(externalValidationResult.ignoredExternalValidation, [
      "Acceptance criteria: Chef approves all 12 pairing suggestions as accurate",
      "Validation proof: A/B test shows 25% higher average items per order"
    ])
    assert.deepEqual(
      externalValidationResult.requirementMatches.map((match) => match.requirementText),
      [
        "Build scope: 'Most ordered' badges and category bestseller highlights",
        "Deliverable: Updated app with suggestion overlays on item cards",
        "Acceptance criteria: Recommendations appear within 500ms of basket change"
      ]
    )
    assert.equal(externalValidationResult.phaseAdvanceBasis, "all_non_external_requirements_passed")

    let itemResultsRepairCalls = 0
    const missingItemResultsProviderOutput = JSON.stringify({
      verdict: "success",
      score: 0.84,
      issues: ["All actionable implementation requirements passed; external validation is ignored for advancement."],
      passed: [
        "Build scope: 'Most ordered' badges and category bestseller highlights",
        "Deliverable: Updated app with suggestion overlays on item cards",
        "Acceptance criteria: Recommendations appear within 500ms of basket change"
      ],
      missing: ["Validation proof: A/B test shows 25% higher average items per order"],
      ignored_external_validation: [],
      prompt_intent: "implement_next_step",
      assistant_suggested_next_move: "Phase 3: Table Ordering Flow",
      next_step_requirements: ["Implement Phase 3: Table Ordering Flow"],
      blocked_scope: [],
      next_prompt:
        "Implement Phase 3: Table Ordering Flow only.\n\nAfter you finish, confirm which requirements were completed and suggest the next step."
    })
    const repairedItemResultsResult = await runDeepAnalysisV2(externalValidationTrackerInput, {
      callJson: async (_systemPrompt, userPrompt) => {
        itemResultsRepairCalls += 1
        if (itemResultsRepairCalls === 1) return missingItemResultsProviderOutput
        assert.match(userPrompt, /Add item_results|checklist_items|external_validation_rule|classification_audit/i)
        return externalValidationProviderOutput
      }
    })
    assert.equal(itemResultsRepairCalls, 2)
    assert.equal(repairedItemResultsResult.overallStatus, "pass")
    assert.deepEqual(repairedItemResultsResult.ignoredExternalValidation, [
      "Acceptance criteria: Chef approves all 12 pairing suggestions as accurate",
      "Validation proof: A/B test shows 25% higher average items per order"
    ])

    let emptyItemResultsRepairCalls = 0
    const salvageableMissingItemResultsOutput = JSON.stringify({
      ...JSON.parse(missingItemResultsProviderOutput),
      ignored_external_validation: [
        "Acceptance criteria: Chef approves all 12 pairing suggestions as accurate",
        "Validation proof: A/B test shows 25% higher average items per order"
      ]
    })
    const salvagedItemResultsResult = await runDeepAnalysisV2(externalValidationTrackerInput, {
      callJson: async (_systemPrompt, userPrompt) => {
        emptyItemResultsRepairCalls += 1
        if (emptyItemResultsRepairCalls === 1) return salvageableMissingItemResultsOutput
        assert.match(userPrompt, /Add item_results|checklist_items|external_validation_rule|classification_audit/i)
        return ""
      }
    })
    assert.equal(emptyItemResultsRepairCalls, 2)
    assert.equal(salvagedItemResultsResult.providerMetadata.provider, "deepseek")
    assert.equal(salvagedItemResultsResult.overallStatus, "pass")
    assert.match(salvagedItemResultsResult.generatedPrompt, /Implement Phase 3: Table Ordering Flow/)

    let compactJsonRepairCalls = 0
    const malformedProviderOutput = externalValidationProviderOutput.replace(
      '"passed":',
      '"passed":'
    ).replace(
      ',"missing":',
      '"missing":'
    )
    const repairedCompactJsonResult = await runDeepAnalysisV2(externalValidationTrackerInput, {
      callJson: async (_systemPrompt, userPrompt) => {
        compactJsonRepairCalls += 1
        if (compactJsonRepairCalls === 1) return malformedProviderOutput
        assert.match(userPrompt, /Repair this Deep Analysis v2 provider output|required_schema|original_output|next_prompt/i)
        return externalValidationProviderOutput
      }
    })
    assert.equal(compactJsonRepairCalls, 2)
    assert.equal(repairedCompactJsonResult.overallStatus, "pass")

    const multiUserAcceptanceInput = {
      ...input,
      promptText: [
        "Project tracker mode is on. Review the latest AI agent answer against the CURRENT phase only.",
        "",
        "CURRENT PHASE REQUIREMENTS",
        "Phase 1 of 3: Shared List Foundation",
        "Goal: Single shared list with basic CRUD and live sync between two accounts.",
        "",
        "REQUIREMENT-LEVEL CHECKLIST",
        "Return one requirement match for each item below. Do not collapse these into a generic row.",
        "- Build scope: Shopper views live-updating list without refresh",
        "- Deliverable: Real-time list sync via WebSockets",
        "- Acceptance criteria: Two users see updates within 2 seconds",
        "- Acceptance criteria: List persists across sessions",
        "- Validation proof: Screen recording of simultaneous edit sync across two phones",
        "",
        "NEXT PHASE REQUIREMENTS",
        "Phase 2 of 3: Shopper Assignment & Tracking"
      ].join("\n"),
      responseText: [
        "Phase 1 implementation complete: Shared List Foundation.",
        "The shopper view receives live WebSocket updates without refresh.",
        "Two users see updates within 2 seconds.",
        "The list persists across sessions.",
        "I did not start Phase 2."
      ].join("\n")
    }
    const badMultiUserClassificationOutput = JSON.stringify({
      verdict: "success",
      score: 0.86,
      issues: ["All actionable work passed; external validation is ignored."],
      passed: [
        "Build scope: Shopper views live-updating list without refresh",
        "Deliverable: Real-time list sync via WebSockets",
        "Acceptance criteria: List persists across sessions"
      ],
      missing: [],
      ignored_external_validation: [
        "Acceptance criteria: Two users see updates within 2 seconds",
        "Validation proof: Screen recording of simultaneous edit sync across two phones"
      ],
      item_results: [
        {
          id: "project_tracker_check_1",
          text: "Build scope: Shopper views live-updating list without refresh",
          classification: "implementation_requirement",
          status: "pass",
          reason: "Confirmed."
        },
        {
          id: "project_tracker_check_2",
          text: "Deliverable: Real-time list sync via WebSockets",
          classification: "implementation_requirement",
          status: "pass",
          reason: "Confirmed."
        },
        {
          id: "project_tracker_check_3",
          text: "Acceptance criteria: Two users see updates within 2 seconds",
          classification: "external_validation",
          status: "ignored",
          reason: "Incorrectly treated as external."
        },
        {
          id: "project_tracker_check_4",
          text: "Acceptance criteria: List persists across sessions",
          classification: "app_acceptance_criteria",
          status: "pass",
          reason: "Confirmed."
        },
        {
          id: "project_tracker_check_5",
          text: "Validation proof: Screen recording of simultaneous edit sync across two phones",
          classification: "external_validation",
          status: "ignored",
          reason: "Requires external recording."
        }
      ],
      prompt_intent: "implement_next_step",
      assistant_suggested_next_move: "Phase 2: Shopper Assignment & Tracking",
      next_step_requirements: ["Implement Phase 2: Shopper Assignment & Tracking"],
      blocked_scope: [],
      next_prompt:
        "Implement Phase 2: Shopper Assignment & Tracking only.\n\nAfter you finish, confirm which requirements were completed and suggest the next step."
    })
    const repairedMultiUserClassificationOutput = JSON.stringify({
      ...JSON.parse(badMultiUserClassificationOutput),
      ignored_external_validation: ["Validation proof: Screen recording of simultaneous edit sync across two phones"],
      classification_audit: [
        "Screen recording across two phones is external validation proof.",
        "Two users see updates within 2 seconds is app behavior timing and remains app_acceptance_criteria."
      ],
      item_results: [
        {
          id: "project_tracker_check_1",
          text: "Build scope: Shopper views live-updating list without refresh",
          classification: "implementation_requirement",
          status: "pass",
          reason: "Confirmed."
        },
        {
          id: "project_tracker_check_2",
          text: "Deliverable: Real-time list sync via WebSockets",
          classification: "implementation_requirement",
          status: "pass",
          reason: "Confirmed."
        },
        {
          id: "project_tracker_check_3",
          text: "Acceptance criteria: Two users see updates within 2 seconds",
          classification: "app_acceptance_criteria",
          status: "pass",
          reason: "This is app behavior with timing, not external validation."
        },
        {
          id: "project_tracker_check_4",
          text: "Acceptance criteria: List persists across sessions",
          classification: "app_acceptance_criteria",
          status: "pass",
          reason: "Confirmed."
        },
        {
          id: "project_tracker_check_5",
          text: "Validation proof: Screen recording of simultaneous edit sync across two phones",
          classification: "external_validation",
          status: "ignored",
          reason: "Requires external recording."
        }
      ]
    })
    let multiUserRepairCalls = 0
    const multiUserAcceptanceResult = await runDeepAnalysisV2(multiUserAcceptanceInput, {
      callJson: async (_systemPrompt, userPrompt) => {
        multiUserRepairCalls += 1
        if (multiUserRepairCalls === 1) return badMultiUserClassificationOutput
        assert.match(userPrompt, /Two users see updates within 2 seconds/i)
        return repairedMultiUserClassificationOutput
      }
    })
    assert.equal(multiUserRepairCalls, 2)
    assert.equal(multiUserAcceptanceResult.overallStatus, "pass")
    assert.deepEqual(multiUserAcceptanceResult.ignoredExternalValidation, [
      "Validation proof: Screen recording of simultaneous edit sync across two phones"
    ])
    assert.ok(
      multiUserAcceptanceResult.requirementMatches.some(
        (match) =>
          match.requirementText === "Acceptance criteria: Two users see updates within 2 seconds" &&
          match.status === "pass"
      ),
      "multi-user timing acceptance criteria remains actionable"
    )

    const phaseCompletionCarryoverOutput = JSON.stringify({
      verdict: "partial",
      score: 0.74,
      issues: ["Assistant claimed the phase is complete, but one actionable item remains unclear."],
      passed: [
        "Deliverable: Real-time list sync via WebSockets",
        "Acceptance criteria: Two users see updates within 2 seconds",
        "Acceptance criteria: List persists across sessions"
      ],
      missing: ["Build scope: Shopper views live-updating list without refresh"],
      ignored_external_validation: ["Validation proof: Screen recording of simultaneous edit sync across two phones"],
      item_results: [
        {
          id: "project_tracker_check_1",
          text: "Build scope: Shopper views live-updating list without refresh",
          classification: "implementation_requirement",
          status: "unclear",
          reason: "The answer claims real-time sync but does not explicitly say shopper view updates without refresh."
        },
        {
          id: "project_tracker_check_2",
          text: "Deliverable: Real-time list sync via WebSockets",
          classification: "implementation_requirement",
          status: "pass",
          reason: "Confirmed."
        },
        {
          id: "project_tracker_check_3",
          text: "Acceptance criteria: Two users see updates within 2 seconds",
          classification: "app_acceptance_criteria",
          status: "pass",
          reason: "Confirmed."
        },
        {
          id: "project_tracker_check_4",
          text: "Acceptance criteria: List persists across sessions",
          classification: "app_acceptance_criteria",
          status: "pass",
          reason: "Confirmed."
        },
        {
          id: "project_tracker_check_5",
          text: "Validation proof: Screen recording of simultaneous edit sync across two phones",
          classification: "external_validation",
          status: "ignored",
          reason: "External recording proof."
        }
      ],
      phase_completion_claimed: true,
      classification_audit: [
        "Screen recording is external validation.",
        "Two-user timing is app behavior and remains acceptance criteria."
      ],
      prompt_intent: "implement_next_step",
      assistant_suggested_next_move: "Phase 2: Shopper Assignment & Tracking",
      next_step_requirements: ["Implement Phase 2: Shopper Assignment & Tracking"],
      blocked_scope: [],
      next_prompt:
        "Implement Phase 2: Shopper Assignment & Tracking only.\n\nAlso carry forward:\n- Build scope: Shopper views live-updating list without refresh\n\nAfter you finish, confirm which requirements were completed and suggest the next step."
    })
    const phaseCompletionCarryoverResult = await runDeepAnalysisV2({
      ...multiUserAcceptanceInput,
      responseText: [
        "Phase 1 implementation complete: Shared List Foundation.",
        "Real-time list sync via WebSockets is implemented.",
        "Two users see updates within 2 seconds.",
        "The list persists across sessions.",
        "I did not start Phase 2."
      ].join("\n")
    }, {
      callJson: async () => phaseCompletionCarryoverOutput
    })
    assert.equal(phaseCompletionCarryoverResult.overallStatus, "pass")
    assert.equal(phaseCompletionCarryoverResult.phaseCompletionClaimed, true)
    assert.equal(phaseCompletionCarryoverResult.phaseAdvanceBasis, "phase_completion_claimed_with_carryover")
    assert.ok(
      phaseCompletionCarryoverResult.requirementMatches.some(
        (match) =>
          match.requirementText === "Build scope: Shopper views live-updating list without refresh" &&
          match.status === "unclear"
      )
    )

    const providerForgotPhaseCompletionOutput = JSON.stringify({
      ...JSON.parse(phaseCompletionCarryoverOutput),
      phase_completion_claimed: false
    })
    const derivedPhaseCompletionCarryoverResult = await runDeepAnalysisV2({
      ...multiUserAcceptanceInput,
      responseText: [
        "Phase 1 implementation is complete: Shared List Foundation.",
        "Real-time list sync via WebSockets is implemented.",
        "Two users see updates within 2 seconds.",
        "The list persists across sessions.",
        "I did not start Phase 2."
      ].join("\n")
    }, {
      callJson: async () => providerForgotPhaseCompletionOutput
    })
    assert.equal(derivedPhaseCompletionCarryoverResult.overallStatus, "pass")
    assert.equal(derivedPhaseCompletionCarryoverResult.phaseCompletionClaimed, true)
    assert.equal(derivedPhaseCompletionCarryoverResult.phaseAdvanceBasis, "phase_completion_claimed_with_carryover")

    const ordinaryCompletionWithMissingResult = await runDeepAnalysisV2({
      ...multiUserAcceptanceInput,
      promptText: "Finish the invoice feature, include manual testing steps, and explain the remaining risks.",
      responseText: [
        "The invoice feature is complete.",
        "Receipt upload and monthly summaries were implemented.",
        "Email forwarding and receipt-history search still need to be finished."
      ].join("\n")
    }, {
      callJson: async () => phaseCompletionCarryoverOutput
    })
    assert.equal(ordinaryCompletionWithMissingResult.overallStatus, "needs_confirmation")
    assert.equal(ordinaryCompletionWithMissingResult.phaseAdvanceBasis, "")
    assert.equal(ordinaryCompletionWithMissingResult.promptIntent, "confirm_missing_requirements")
    assert.match(ordinaryCompletionWithMissingResult.generatedPrompt, /^Before we move forward, confirm these requirements/)
    assert.match(ordinaryCompletionWithMissingResult.generatedPrompt, /suggest (?:what )?the next step/i)
    assert.match(ordinaryCompletionWithMissingResult.generatedPrompt, /Do not add new scope yet/i)

    const staleMissingIdsOutput = JSON.stringify({
      verdict: "partial",
      score: 0.68,
      issues: ["Only external validation remains unresolved."],
      passed: [
        "Build scope: Schedule browser push notifications at custom intervals",
        "Build scope: Add priority levels affecting reminder frequency",
        "Deliverable: Push notification service with time-zone handling",
        "Deliverable: Priority-based reminder rules engine",
        "Acceptance criteria: Notification fires within 5 minutes of scheduled time",
        "Acceptance criteria: User can snooze or dismiss per assignment"
      ],
      missing: [
        "project_tracker_check_1",
        "project_tracker_check_2",
        "project_tracker_check_3",
        "project_tracker_check_4",
        "project_tracker_check_5",
        "project_tracker_check_6",
        "Validation proof: 30-day cohort retention rate meets 40% weekly active usage"
      ],
      ignored_external_validation: [
        "project_tracker_check_7",
        "Validation proof: 30-day cohort retention rate meets 40% weekly active usage"
      ],
      item_results: [
        {
          id: "project_tracker_check_1",
          text: "Build scope: Schedule browser push notifications at custom intervals",
          classification: "implementation_requirement",
          status: "pass",
          reason: "Confirmed."
        },
        {
          id: "project_tracker_check_2",
          text: "Build scope: Add priority levels affecting reminder frequency",
          classification: "implementation_requirement",
          status: "pass",
          reason: "Confirmed."
        },
        {
          id: "project_tracker_check_3",
          text: "Deliverable: Push notification service with time-zone handling",
          classification: "implementation_requirement",
          status: "pass",
          reason: "Confirmed."
        },
        {
          id: "project_tracker_check_4",
          text: "Deliverable: Priority-based reminder rules engine",
          classification: "implementation_requirement",
          status: "pass",
          reason: "Confirmed."
        },
        {
          id: "project_tracker_check_5",
          text: "Acceptance criteria: Notification fires within 5 minutes of scheduled time",
          classification: "app_acceptance_criteria",
          status: "pass",
          reason: "Confirmed."
        },
        {
          id: "project_tracker_check_6",
          text: "Acceptance criteria: User can snooze or dismiss per assignment",
          classification: "app_acceptance_criteria",
          status: "pass",
          reason: "Confirmed."
        },
        {
          id: "project_tracker_check_7",
          text: "Validation proof: 30-day cohort retention rate meets 40% weekly active usage",
          classification: "external_validation",
          status: "ignored",
          reason: "Requires 30-day cohort data."
        }
      ],
      phase_completion_claimed: true,
      classification_audit: ["30-day cohort retention is external validation; app behavior rows were not ignored."],
      prompt_intent: "confirm_missing_requirements",
      assistant_suggested_next_move: "Phase 3: Class Workflow Integration",
      next_step_requirements: ["Validation proof: 30-day cohort retention rate meets 40% weekly active usage"],
      blocked_scope: ["Phase 3: Class Workflow Integration"],
      next_prompt:
        "Finish Phase 2: Smart Reminders before moving forward.\n\nAfter you finish, confirm which requirements were completed and suggest the next step."
    })
    const staleMissingIdsInput = {
      ...input,
      promptText: [
        "Project tracker mode is on. Review the latest AI agent answer against the CURRENT phase only.",
        "",
        "CURRENT PHASE REQUIREMENTS",
        "Phase 2 of 3: Smart Reminders",
        "Goal: Drive retention through proactive deadline alerts.",
        "",
        "REQUIREMENT-LEVEL CHECKLIST",
        "- Build scope: Schedule browser push notifications at custom intervals",
        "- Build scope: Add priority levels affecting reminder frequency",
        "- Deliverable: Push notification service with time-zone handling",
        "- Deliverable: Priority-based reminder rules engine",
        "- Acceptance criteria: Notification fires within 5 minutes of scheduled time",
        "- Acceptance criteria: User can snooze or dismiss per assignment",
        "- Validation proof: 30-day cohort retention rate meets 40% weekly active usage",
        "",
        "NEXT PHASE REQUIREMENTS",
        "Phase 3 of 3: Class Workflow Integration"
      ].join("\n"),
      responseText: [
        "Phase 2 implementation is complete.",
        "Schedule browser push notifications at custom intervals is complete.",
        "Priority levels affecting reminder frequency are complete.",
        "Push notification service with time-zone handling is complete.",
        "Priority-based reminder rules engine is complete.",
        "Notification fires within 5 minutes of scheduled time is passed.",
        "User can snooze or dismiss per assignment is passed.",
        "I did not start Phase 3."
      ].join("\n")
    }
    const staleMissingIdsResult = await runDeepAnalysisV2(staleMissingIdsInput, {
      callJson: async () => staleMissingIdsOutput
    })
    assert.equal(staleMissingIdsResult.overallStatus, "pass")
    assert.deepEqual(staleMissingIdsResult.actionableMissingItems, [])
    assert.equal(staleMissingIdsResult.promptIntent, "implement_next_step")
    assert.equal(staleMissingIdsResult.phaseAdvanceBasis, "all_non_external_requirements_passed")

    const externallyValidatedByNormalizerOutput = JSON.stringify({
      ...JSON.parse(staleMissingIdsOutput),
      issues: ["No user prompt or assistant answer provided for comparison."],
      missing: ["Validation proof: 5 student testers complete 3-day logging trial without crashes"],
      ignored_external_validation: [],
      item_results: [
        ...JSON.parse(staleMissingIdsOutput).item_results.slice(0, 6),
        {
          id: "project_tracker_check_7",
          text: "Validation proof: 5 student testers complete 3-day logging trial without crashes",
          classification: "app_acceptance_criteria",
          status: "unclear",
          reason: "No user prompt or assistant answer provided for comparison."
        }
      ],
      next_step_requirements: ["Validation proof: 5 student testers complete 3-day logging trial without crashes"],
      next_prompt:
        "Implement Phase 3: Class Workflow Integration only.\n\nAfter you finish, confirm which requirements were completed and suggest the next step."
    })
    const externallyValidatedByNormalizerInput = {
      ...staleMissingIdsInput,
      promptText: staleMissingIdsInput.promptText.replace(
        "Validation proof: 30-day cohort retention rate meets 40% weekly active usage",
        "Validation proof: 5 student testers complete 3-day logging trial without crashes"
      )
    }
    const externallyValidatedByNormalizerResult = await runDeepAnalysisV2(externallyValidatedByNormalizerInput, {
      callJson: async () => externallyValidatedByNormalizerOutput
    })
    assert.equal(externallyValidatedByNormalizerResult.overallStatus, "pass")
    assert.deepEqual(externallyValidatedByNormalizerResult.actionableMissingItems, [])
    assert.deepEqual(externallyValidatedByNormalizerResult.ignoredExternalValidation, [
      "Validation proof: 5 student testers complete 3-day logging trial without crashes"
    ])
    assert.equal(externallyValidatedByNormalizerResult.phaseAdvanceBasis, "all_non_external_requirements_passed")
    assert.doesNotMatch(externallyValidatedByNormalizerResult.userExplanation, /No user prompt or assistant answer provided/i)

    const contradictoryPassOutput = JSON.stringify({
      ...JSON.parse(providerOutput),
      prompt_intent: "confirm_missing_requirements",
      next_step_requirements: ["Add note creation UI", "Add a New Note button"],
      blocked_scope: ["backend", "database", "storage"],
      next_prompt:
        "Phase 1 is confirmed complete. Before moving to Phase 2, confirm the current requirements were completed."
    })
    const contradictoryPassResult = await runDeepAnalysisV2(input, {
      callJson: async () => contradictoryPassOutput
    })
    assert.equal(contradictoryPassResult.overallStatus, "pass")
    assert.equal(contradictoryPassResult.promptIntent, "implement_next_step")
    assert.deepEqual(contradictoryPassResult.nextStepRequirements, ["Add note creation UI", "Add a New Note button"])
    assert.match(contradictoryPassResult.generatedPrompt, /Please implement the best next step now:/)
    assert.match(contradictoryPassResult.generatedPrompt, /Add note creation UI/)
    assert.doesNotMatch(contradictoryPassResult.generatedPrompt, /confirm the current requirements/i)

    const safeAssistantSuggestionOutput = JSON.stringify({
      ...JSON.parse(providerOutput),
      prompt_intent: "ask_for_next_step",
      next_step_requirements: [],
      blocked_scope: ["backend", "database", "authentication"],
      next_prompt:
        "Before implementing more, suggest the safest next step based on the completed work and current project state. After you finish, confirm which requirements were completed and suggest the next step."
    })
    const safeAssistantSuggestionResult = await runDeepAnalysisV2(
      {
        ...input,
        responseText:
          "Implemented the event list UI. Phase 1 is complete. Next phase: add event details view and basic navigation from each event card."
      },
      {
        callJson: async () => safeAssistantSuggestionOutput
      }
    )
    assert.equal(safeAssistantSuggestionResult.overallStatus, "pass")
    assert.equal(safeAssistantSuggestionResult.promptIntent, "implement_next_step")
    assert.deepEqual(safeAssistantSuggestionResult.nextStepRequirements, ["Add event details view and basic navigation from each event card"])
    assert.match(safeAssistantSuggestionResult.generatedPrompt, /Add event details view/)

    const phaseHandoffOutput = JSON.stringify({
      verdict: "success",
      score: 0.86,
      issues: ["Phase 1 is complete and validated against the requested acceptance criteria."],
      missing: [],
      prompt_intent: "implement_next_step",
      assistant_suggested_next_move: "Start Phase 2: Smart Reminders",
      next_step_requirements: [
        "Implement time-based reminder with snooze option",
        "Implement streak counter with visual flame indicator"
      ],
      blocked_scope: ["Do not implement adaptive reminder timing", "Do not implement badge system"],
      next_prompt:
        "Start Phase 2: Smart Reminders.\n\nImplement Phase 2 only:\n- Time-based reminder with snooze option\n- Streak counter with visual flame indicator\n\nDo not implement adaptive reminder timing.\nDo not implement badge system.\n\nAfter finishing, validate Phase 2 against its acceptance criteria and wait for confirmation."
    })
    const phaseHandoffResult = await runDeepAnalysisV2(
      {
        ...input,
        promptText:
          "Implement this PRD one phase at a time.\n\nImplementation phases\n\nCore Logging Loop\nGoal: Validate that users will manually log water when reminded.\nBuild scope:\n- Tap-based intake logger with 250ml/500ml presets\n- Daily progress ring with goal setter\nOut of scope for this phase:\n- Any notification system\nData/state needed:\n- Local SQLite with daily intake records and user goal\nAcceptance criteria:\n- User completes first log in under 10 seconds\n- Progress ring updates immediately after each log\nValidation proof expected:\n- 5/5 test users log 3+ times without prompting\n\nSmart Reminders\nGoal: Drive habit formation through contextual push notifications.\nBuild scope:\n- Time-based reminder with snooze option\n- Streak counter with visual flame indicator\nOut of scope for this phase:\n- Adaptive reminder timing based on behavior\n- Badge system\nData/state needed:\n- SQLite extended with streak history and reminder preferences\nAcceptance criteria:\n- Reminder fires within 15 min of scheduled time\n- Streak increments after midnight with goal met\nValidation proof expected:\n- 60% reminder tap-through rate in beta cohort\n\nImplementation handoff\n- Implement Phase 1 only in the first assistant response.\n- Do not start Phase 2 until Phase 1 is finished and validated against its acceptance criteria.\n- After finishing Phase 1, explain what changed and show concrete validation proof.\n- Wait for the user's confirmation before starting the next phase.",
        responseText:
          "Phase 1 — Core Logging Loop completed. I implemented Phase 1 only and did not start Smart Reminders or Gamification Layer. Acceptance criteria validation: first log averaged 6.88 seconds and progress ring updated immediately after each log. Validation proof: 5/5 test users logged water at least 3 times without prompting. Ready to start Phase 2: Smart Reminders after your confirmation."
      },
      {
        callJson: async () => phaseHandoffOutput
      }
    )
    assert.equal(phaseHandoffResult.overallStatus, "pass")
    assert.equal(phaseHandoffResult.nextStepSource, "assistant_suggestion")
    assert.equal(phaseHandoffResult.promptIntent, "implement_next_step")
    assert.match(phaseHandoffResult.assistantSuggestedNextMove, /Phase 2: Smart Reminders/)
    assert.deepEqual(phaseHandoffResult.nextStepRequirements, [
      "Implement time-based reminder with snooze option",
      "Implement streak counter with visual flame indicator"
    ])
    assert.doesNotMatch(phaseHandoffResult.blockedScope.join(" "), /\bstorage\b/i)
    assert.match(phaseHandoffResult.generatedPrompt, /Start Phase 2: Smart Reminders/)
    assert.match(phaseHandoffResult.generatedPrompt, /Time-based reminder with snooze option/)
    assert.match(phaseHandoffResult.generatedPrompt, /Do not implement badge system/)
    assert.doesNotMatch(phaseHandoffResult.generatedPrompt, /suggest the safest next step/i)

    const checkpointRepairOutput = JSON.stringify({
      verdict: "unclear",
      score: 0.42,
      issues: ["Evidence is speculative rather than confirmed concrete evidence."],
      missing: [
        "Concrete confirmed evidence for category filtering",
        "Explicit out-of-scope confirmation statement",
        "Complete validation proof assessment",
        "Next step details for Phase 3 requirements"
      ],
      prompt_intent: "review_before_advancing",
      assistant_suggested_next_move: "finish and validate Phase 2",
      next_step_requirements: [],
      blocked_scope: [],
      next_prompt:
        "Before moving forward, provide concrete proof that the current step works.\n\nInclude visible evidence, test results, a preview URL, screenshot, or the relevant code.\nIf anything is unverified, say what remains and do not start the next phase yet."
    })
    const checkpointRepairResult = await runDeepAnalysisV2(
      {
        ...input,
        promptText: [
          "Before we move to the next phase, confirm whether the current phase is fully complete.",
          "",
          "Known PRD phase context:",
          "- Current phase: Phase 2: Dynamic Availability & Search.",
          "- Next unstarted phase from the PRD: Phase 3: Ordering Prep & QR Handoff.",
          "",
          "Check the current phase against the original PRD and answer:",
          "",
          "1. Completed requirements",
          "- List each requirement completed",
          "- Include concrete evidence for each",
          "",
          "2. Missing or incomplete requirements",
          "- List anything not completed yet",
          "- Explain what remains",
          "",
          "3. Out-of-scope confirmation",
          "- Confirm you did not start later phases or forbidden scope",
          "",
          "4. Validation proof",
          "- Confirm whether acceptance criteria and validation proof were met",
          "- If not, state exactly what proof is still needed",
          "",
          "5. Next step details",
          "If the current phase is complete, share the full detailed requirements for the next step/phase:",
          "- phase name",
          "- goal",
          "- build scope",
          "- out of scope",
          "- data/state needed",
          "- deliverables",
          "- acceptance criteria",
          "- validation proof expected",
          "",
          "Do not implement the next phase yet.",
          "Wait for my confirmation."
        ].join("\n"),
        responseText:
          "If filter buttons are already visible, category filtering should be done. Next step is to finish and validate Phase 2."
      },
      {
        callJson: async () => checkpointRepairOutput
      }
    )
    assert.equal(checkpointRepairResult.overallStatus, "risky")
    assert.equal(checkpointRepairResult.promptIntent, "review_before_advancing")
    assert.match(checkpointRepairResult.generatedPrompt, /Complete the phase checkpoint without implementing anything new/)
    assert.match(checkpointRepairResult.generatedPrompt, /Current phase: Phase 2: Dynamic Availability & Search/)
    assert.match(checkpointRepairResult.generatedPrompt, /Next PRD phase: Phase 3: Ordering Prep & QR Handoff/)
    assert.match(checkpointRepairResult.generatedPrompt, /Concrete confirmed evidence for category filtering/)
    assert.match(checkpointRepairResult.generatedPrompt, /Next step details/)
    assert.match(checkpointRepairResult.generatedPrompt, /Do not implement the next phase yet/)
    assert.doesNotMatch(checkpointRepairResult.generatedPrompt, /^Before moving forward, provide concrete proof/m)

    const emptyRequirementImplementOutput = JSON.stringify({
      ...JSON.parse(providerOutput),
      prompt_intent: "implement_next_step",
      next_step_requirements: [],
      blocked_scope: ["backend"],
      next_prompt:
        "Please implement the best next step now:\n\nDo not add backend yet.\n\nAfter you finish, confirm which requirements were completed and suggest the next step."
    })
    const emptyRequirementImplementResult = await runDeepAnalysisV2(input, {
      callJson: async () => emptyRequirementImplementOutput
    })
    assert.equal(emptyRequirementImplementResult.overallStatus, "pass")
    assert.equal(emptyRequirementImplementResult.promptIntent, "ask_for_next_step")
    assert.deepEqual(emptyRequirementImplementResult.nextStepRequirements, [])
    assert.doesNotMatch(emptyRequirementImplementResult.generatedPrompt, /- Connect form to backend/)
    assert.match(emptyRequirementImplementResult.generatedPrompt, /suggest the safest next step/i)

    const conflictingNextStepOutput = JSON.stringify({
      ...JSON.parse(providerOutput),
      prompt_intent: "implement_next_step",
      next_step_requirements: ["Connect the waitlist form to a backend API endpoint", "Add frontend email validation"],
      blocked_scope: ["backend", "API endpoint", "database", "storage"],
      next_prompt:
        "Please implement the best next step now:\n- Connect the waitlist form to a backend API endpoint\n- Add frontend email validation\n\nDo not add backend, API endpoint, database, or storage yet.\n\nAfter you finish, confirm which requirements were completed and suggest the next step."
    })
    const conflictingNextStepResult = await runDeepAnalysisV2(input, {
      callJson: async () => conflictingNextStepOutput
    })
    assert.equal(conflictingNextStepResult.overallStatus, "pass")
    assert.equal(conflictingNextStepResult.promptIntent, "implement_next_step")
    assert.deepEqual(conflictingNextStepResult.nextStepRequirements, ["Add frontend email validation"])
    assert.doesNotMatch(conflictingNextStepResult.generatedPrompt, /Connect the waitlist form to a backend API endpoint/)
    assert.match(conflictingNextStepResult.generatedPrompt, /Add frontend email validation/)

    const uiOnlyRealDataOutput = JSON.stringify({
      ...JSON.parse(providerOutput),
      prompt_intent: "implement_next_step",
      next_step_requirements: ["Connect list to real invoice data source", "Implement status filtering functionality"],
      blocked_scope: [],
      next_prompt:
        "Please implement the best next step now:\n- Connect list to real invoice data source\n- Implement status filtering functionality\n\nAfter you finish, confirm which requirements were completed and suggest the next step."
    })
    const uiOnlyRealDataResult = await runDeepAnalysisV2(
      {
        ...input,
        promptText:
          "Act like Replit’s coding agent. I’m building a simple invoice list app. Phase 1 goal: create the invoice list UI only. Reply briefly, do not include code, say what changed, confirm Phase 1 is complete, and suggest the next phase.",
        responseText:
          "Implemented the invoice list UI. Phase 1 is complete. Next phase: connect the list to real invoice data and add status filtering."
      },
      {
        callJson: async () => uiOnlyRealDataOutput
      }
    )
    assert.equal(uiOnlyRealDataResult.overallStatus, "pass")
    assert.equal(uiOnlyRealDataResult.promptIntent, "implement_next_step")
    assert.deepEqual(uiOnlyRealDataResult.nextStepRequirements, ["Implement status filtering functionality"])
    assert.match(uiOnlyRealDataResult.blockedScope.join(" "), /real data source|storage|database|backend/)
    assert.doesNotMatch(uiOnlyRealDataResult.generatedPrompt, /Connect list to real invoice data source/)
    assert.match(uiOnlyRealDataResult.generatedPrompt, /Implement status filtering functionality/)

    const cannotVerifyOutput = JSON.stringify({
      ...JSON.parse(providerOutput),
      verdict: "success",
      score: 0.9,
      issues: ["The assistant says it cannot verify without screenshots or test results."],
      missing: [],
      prompt_intent: "implement_next_step",
      next_step_requirements: ["Next phase"],
      blocked_scope: ["next phase advancement"],
      next_prompt:
        "Please implement the best next step now:\n- Next phase\n\nDo not add next phase advancement yet.\n\nAfter you finish, confirm which requirements were completed and suggest the next step."
    })
    const cannotVerifyResult = await runDeepAnalysisV2(input, {
      callJson: async () => cannotVerifyOutput
    })
    assert.equal(cannotVerifyResult.overallStatus, "risky")
    assert.equal(cannotVerifyResult.promptIntent, "review_before_advancing")
    assert.deepEqual(cannotVerifyResult.nextStepRequirements, [])
    assert.match(cannotVerifyResult.generatedPrompt, /provide concrete proof|visible evidence|screenshot|test results/i)

    const contradictoryNoSuggestionOutput = JSON.stringify({
      ...JSON.parse(providerOutput),
      prompt_intent: "confirm_missing_requirements",
      next_step_requirements: [],
      blocked_scope: ["suggesting next phase"],
      next_prompt:
        "Phase 1 is confirmed complete with no next phase suggested, as requested. Before advancing, confirm whether you need any adjustments."
    })
    const contradictoryNoSuggestionResult = await runDeepAnalysisV2(
      {
        ...input,
        responseText:
          "Created the UI layout and empty state. Phase 1 is complete."
      },
      {
        callJson: async () => contradictoryNoSuggestionOutput
      }
    )
    assert.equal(contradictoryNoSuggestionResult.overallStatus, "pass")
    assert.equal(contradictoryNoSuggestionResult.promptIntent, "ask_for_next_step")
    assert.deepEqual(contradictoryNoSuggestionResult.nextStepRequirements, [])
    assert.match(contradictoryNoSuggestionResult.generatedPrompt, /suggest the safest next step/i)
    assert.doesNotMatch(contradictoryNoSuggestionResult.generatedPrompt, /Do not add (?:next phase suggestions|implementation code)/i)

    const safeRecipeSuggestionOutput = JSON.stringify({
      ...JSON.parse(providerOutput),
      prompt_intent: "ask_for_next_step",
      next_step_requirements: [],
      blocked_scope: ["backend API", "user authentication", "recipe creation/editing forms"],
      next_prompt:
        "Before implementing more, suggest the safest next step based on the completed work and current project state. After you finish, confirm which requirements were completed and suggest the next step."
    })
    const safeRecipeSuggestionResult = await runDeepAnalysisV2(
      {
        ...input,
        promptText:
          "Act like Replit’s coding agent. I’m building a simple recipe app. Phase 1 goal: create the recipe list UI only. Reply briefly, do not include code, say what changed, confirm Phase 1 is complete, and suggest the next phase.",
        responseText:
          "Updated the app with a simple recipe list UI. Kept it UI-only with no backend, storage, auth, or database. Phase 1 is complete. Next phase: add recipe detail pages when a user selects a recipe."
      },
      {
        callJson: async () => safeRecipeSuggestionOutput
      }
    )
    assert.equal(safeRecipeSuggestionResult.overallStatus, "pass")
    assert.equal(safeRecipeSuggestionResult.promptIntent, "implement_next_step")
    assert.deepEqual(safeRecipeSuggestionResult.nextStepRequirements, ["Add recipe detail pages when a user selects a recipe"])
    assert.match(safeRecipeSuggestionResult.generatedPrompt, /Add recipe detail pages/)

    const safeMockInvoiceSuggestionOutput = JSON.stringify({
      ...JSON.parse(providerOutput),
      prompt_intent: "ask_for_next_step",
      next_step_requirements: [],
      blocked_scope: ["invoice data handling", "filtering by status", "search"],
      next_prompt:
        "Before implementing more, suggest the safest next step based on the completed work and current project state. After you finish, confirm which requirements were completed and suggest the next step."
    })
    const safeMockInvoiceSuggestionResult = await runDeepAnalysisV2(
      {
        ...input,
        promptText:
          "Act like Replit’s coding agent. I’m building a simple invoice list app. Phase 1 goal: create the invoice list UI only. Reply briefly, do not include code, say what changed, confirm Phase 1 is complete, and suggest the next phase.",
        responseText:
          "Built the Phase 1 invoice list UI. Phase 1 is complete. Next phase: add invoice data handling, including mock invoice records, filtering by status, and search."
      },
      {
        callJson: async () => safeMockInvoiceSuggestionOutput
      }
    )
    assert.equal(safeMockInvoiceSuggestionResult.overallStatus, "pass")
    assert.equal(safeMockInvoiceSuggestionResult.promptIntent, "implement_next_step")
    assert.deepEqual(safeMockInvoiceSuggestionResult.nextStepRequirements, [
      "Add invoice data handling, including mock invoice records, filtering by status, and search"
    ])
    assert.deepEqual(safeMockInvoiceSuggestionResult.blockedScope, [])
    assert.match(safeMockInvoiceSuggestionResult.generatedPrompt, /mock invoice records, filtering by status, and search/)

    const rawCannotVerifyOutput = JSON.stringify({
      ...JSON.parse(providerOutput),
      verdict: "success",
      score: 0.95,
      issues: ["The current answer is aligned."],
      missing: [],
      prompt_intent: "implement_next_step",
      next_step_requirements: ["Next phase"],
      blocked_scope: [],
      next_prompt:
        "Please implement the best next step now:\n- Next phase\n\nAfter you finish, confirm which requirements were completed and suggest the next step."
    })
    const rawCannotVerifyResult = await runDeepAnalysisV2(
      {
        ...input,
        promptText:
          "Review my checkout form after implementing validation. Confirm whether required fields, invalid card input, empty-submit prevention, and success confirmation are all working. Give concrete visible evidence. If anything is unverified, do not move to the next phase.",
        responseText:
          "I can’t honestly confirm this yet because I don’t have visible access to the checkout form, screenshots, test output, or the running app. Validation review status: Unverified. Do not move to the next phase yet."
      },
      {
        callJson: async () => rawCannotVerifyOutput
      }
    )
    assert.equal(rawCannotVerifyResult.overallStatus, "risky")
    assert.equal(rawCannotVerifyResult.promptIntent, "review_before_advancing")
    assert.deepEqual(rawCannotVerifyResult.nextStepRequirements, [])
    assert.match(rawCannotVerifyResult.generatedPrompt, /provide concrete proof|visible evidence|screenshot|test results/i)

    const savedContactsOutput = JSON.stringify({
      ...JSON.parse(providerOutput),
      prompt_intent: "implement_next_step",
      next_step_requirements: [
        "Add client-side form validation for name, email, phone fields",
        "Create contact list preview showing saved contacts"
      ],
      blocked_scope: ["backend API", "database", "storage", "authentication"],
      next_prompt:
        "Please implement the best next step now:\n- Add client-side form validation for name, email, phone fields\n- Create contact list preview showing saved contacts\n\nDo not add backend API, database, storage, or authentication yet.\n\nAfter you finish, confirm which requirements were completed and suggest the next step."
    })
    const savedContactsResult = await runDeepAnalysisV2(
      {
        ...input,
        promptText:
          "Act like Replit’s coding agent. Build Phase 1 of a contact manager UI. It must include name, email, phone, company, tags, and notes fields. Reply briefly, do not include code, confirm Phase 1 is complete, and suggest the next phase.",
        responseText:
          "Implemented Phase 1 contact manager UI. Added contact form fields for name, email, phone, company, tags, and notes. Kept it UI-only with no backend, database, auth, or storage. Phase 1 is complete. Next phase: add form validation and contact list preview."
      },
      {
        callJson: async () => savedContactsOutput
      }
    )
    assert.equal(savedContactsResult.overallStatus, "pass")
    assert.equal(savedContactsResult.promptIntent, "implement_next_step")
    assert.deepEqual(savedContactsResult.nextStepRequirements, [
      "Add client-side form validation for name, email, phone fields",
      "Create contact list preview showing newly added contacts using in-memory state only"
    ])
    assert.doesNotMatch(savedContactsResult.generatedPrompt, /saved contacts/i)
    assert.match(savedContactsResult.generatedPrompt, /newly added contacts using in-memory state only/i)

    const broadContactCrudOutput = JSON.stringify({
      ...JSON.parse(providerOutput),
      prompt_intent: "implement_next_step",
      next_step_requirements: ["Add contact list display and basic add/edit/delete interactions"],
      blocked_scope: ["backend"],
      next_prompt:
        "Please implement the best next step now:\n- Add contact list display and basic add/edit/delete interactions\n\nDo not add backend yet.\n\nAfter you finish, confirm which requirements were completed and suggest the next step."
    })
    const broadContactCrudResult = await runDeepAnalysisV2(
      {
        ...input,
        promptText:
          "Act like Replit’s coding agent. Build Phase 1 of a contact manager UI. It must include name, email, phone, company, tags, and notes fields. Reply briefly, do not include code, confirm Phase 1 is complete, and suggest the next phase.",
        responseText:
          "Built Phase 1 of the contact manager UI. Added contact form fields for name, email, phone, company, tags, and notes. Kept it UI-only with no backend, database, or storage. Phase 1 is complete. Next phase: add contact list display and basic add/edit/delete interactions."
      },
      {
        callJson: async () => broadContactCrudOutput
      }
    )
    assert.equal(broadContactCrudResult.overallStatus, "pass")
    assert.equal(broadContactCrudResult.promptIntent, "implement_next_step")
    assert.deepEqual(broadContactCrudResult.nextStepRequirements, [
      "Add local/in-memory contact creation and display new contacts in the contact list"
    ])
    assert.doesNotMatch(broadContactCrudResult.generatedPrompt, /basic add\/edit\/delete interactions/i)
    assert.match(broadContactCrudResult.generatedPrompt, /local\/in-memory contact creation/i)

    const explicitForbiddenScopeOutput = JSON.stringify({
      ...JSON.parse(providerOutput),
      prompt_intent: "implement_next_step",
      next_step_requirements: [
        "Add client-side email validation (format check)",
        "Add success state UI (confirmation message)",
        "Add error state UI (invalid email feedback)"
      ],
      blocked_scope: ["backend API", "auth", "email sending service"],
      next_prompt:
        "Please implement the best next step now:\n- Add client-side email validation (format check)\n- Add success state UI (confirmation message)\n- Add error state UI (invalid email feedback)\n\nDo not add backend API, auth, or email sending service yet.\n\nAfter you finish, confirm which requirements were completed and suggest the next step."
    })
    const explicitForbiddenScopeResult = await runDeepAnalysisV2(
      {
        ...input,
        promptText:
          "Act like Replit’s coding agent. Phase 1 is a newsletter signup UI only. Do not add backend, database, storage, auth, email sending, or payments yet. Reply briefly with what changed, confirm completion, and suggest the next phase.",
        responseText:
          "Implemented Phase 1: newsletter signup UI only. No backend, database, storage, auth, email sending, or payments added. Phase 1 is complete. Next phase: add basic email validation and success/error states."
      },
      {
        callJson: async () => explicitForbiddenScopeOutput
      }
    )
    assert.equal(explicitForbiddenScopeResult.overallStatus, "pass")
    assert.equal(explicitForbiddenScopeResult.promptIntent, "implement_next_step")
    assert.match(explicitForbiddenScopeResult.blockedScope.join(" "), /backend/)
    assert.match(explicitForbiddenScopeResult.blockedScope.join(" "), /database/)
    assert.match(explicitForbiddenScopeResult.blockedScope.join(" "), /storage/)
    assert.match(explicitForbiddenScopeResult.blockedScope.join(" "), /auth/)
    assert.match(explicitForbiddenScopeResult.blockedScope.join(" "), /email sending/)
    assert.match(explicitForbiddenScopeResult.blockedScope.join(" "), /payments/)
    assert.match(explicitForbiddenScopeResult.generatedPrompt, /database/)
    assert.match(explicitForbiddenScopeResult.generatedPrompt, /payments/)
    assert.ok(explicitForbiddenScopeResult.blockedScope.length <= 8)

    const oversizedBlockedScopeOutput = JSON.stringify({
      ...JSON.parse(providerOutput),
      prompt_intent: "implement_next_step",
      next_step_requirements: ["Add form validation and local contact creation/editing behavior"],
      blocked_scope: [
        "backend",
        "database",
        "auth",
        "storage",
        "payments",
        "email sending",
        "file uploads",
        "analytics",
        "third-party integrations",
        "real-time sync"
      ],
      next_prompt:
        "Please implement the best next step now:\n- Add form validation and local contact creation/editing behavior\n\nDo not add backend, database, auth, storage, payments, email sending, file uploads, analytics, third-party integrations, or real-time sync yet.\n\nAfter you finish, confirm which requirements were completed and suggest the next step."
    })
    const oversizedBlockedScopeResult = await runDeepAnalysisV2(
      {
        ...input,
        promptText:
          "Act like Replit’s coding agent. Build Phase 1 of a simple contact manager UI. It must include name, email, phone, company, tags, and notes fields. Reply briefly, do not include code, confirm Phase 1 is complete, and suggest the next phase.",
        responseText:
          "Built the Phase 1 contact manager UI. Added contact form fields for name, email, phone, company, tags, and notes. Created a simple contact list layout. Kept everything UI-only with no backend, database, auth, or storage. Phase 1 is complete. Next phase: add form validation and local contact creation/editing behavior."
      },
      {
        callJson: async () => oversizedBlockedScopeOutput
      }
    )
    assert.equal(oversizedBlockedScopeResult.overallStatus, "pass")
    assert.ok(oversizedBlockedScopeResult.blockedScope.length <= 8)

    const falseCodeDoubtOutput = JSON.stringify({
      ...JSON.parse(providerOutput),
      verdict: "partial",
      score: 0.31,
      issues: ["Confirm whether you actually built code or if this was a summary of what WOULD be built."],
      missing: ["Confirm whether code was produced."],
      prompt_intent: "confirm_missing_requirements",
      next_step_requirements: [],
      blocked_scope: ["backend implementation", "database integration", "authentication", "persistent storage"],
      next_prompt:
        "Confirm whether you actually built code or if this was a summary of what WOULD be built. If no code was produced, state that clearly in one sentence. If code was produced, acknowledge the error. After you finish, confirm which requirements were completed and suggest the next step."
    })
    const falseCodeDoubtResult = await runDeepAnalysisV2(
      {
        ...input,
        promptText:
          "Act like Replit’s coding agent. Build Phase 1 of a contact manager UI. It must include name, email, phone, company, tags, and notes fields. Reply briefly, do not include code, confirm Phase 1 is complete, and suggest the next phase.",
        responseText:
          "Built Phase 1 of the contact manager UI. Changed: Added contact form fields for name, email, phone, company, tags, and notes. Created a clean UI layout for adding and viewing contact information. Kept it frontend-only with no backend, database, auth, or storage. Phase 1 is complete. Next phase: add basic form validation and a local contact preview/list after submission."
      },
      {
        callJson: async () => falseCodeDoubtOutput
      }
    )
    assert.equal(falseCodeDoubtResult.overallStatus, "pass")
    assert.equal(falseCodeDoubtResult.promptIntent, "implement_next_step")
    assert.deepEqual(falseCodeDoubtResult.nextStepRequirements, [
      "Add basic form validation and a local contact preview/list after submission"
    ])
    assert.doesNotMatch(falseCodeDoubtResult.generatedPrompt, /actually built code|would be built/i)

    const safeBeforeConnectingOutput = JSON.stringify({
      ...JSON.parse(providerOutput),
      prompt_intent: "ask_for_next_step",
      next_step_requirements: [],
      blocked_scope: ["checkout", "payments", "auth", "backend", "database", "storage"],
      next_prompt:
        "Before implementing more, suggest the safest next step based on the completed work and current project state.\n\nAfter you finish, confirm which requirements were completed and suggest the next step."
    })
    const safeBeforeConnectingResult = await runDeepAnalysisV2(
      {
        ...input,
        promptText:
          "Act like Replit’s coding agent. Phase 1 is a pricing table UI only. Do not add checkout, payments, auth, backend, database, or storage yet. Reply briefly with what changed, confirm Phase 1 is complete, and suggest the next phase.",
        responseText:
          "Built Phase 1: pricing table UI only. Phase 1 is complete. Next phase: add plan selection state and basic UI interactions before connecting checkout or payments."
      },
      {
        callJson: async () => safeBeforeConnectingOutput
      }
    )
    assert.equal(safeBeforeConnectingResult.overallStatus, "pass")
    assert.equal(safeBeforeConnectingResult.promptIntent, "implement_next_step")
    assert.deepEqual(safeBeforeConnectingResult.nextStepRequirements, [
      "Add plan selection state and basic UI interactions before connecting checkout or payments"
    ])
    assert.match(safeBeforeConnectingResult.generatedPrompt, /plan selection state/)
    assert.match(safeBeforeConnectingResult.blockedScope.join(" "), /checkout/)
    assert.match(safeBeforeConnectingResult.blockedScope.join(" "), /payments/)

    const taskCrudNounResult = await runDeepAnalysisV2(
      {
        ...input,
        promptText:
          "Act like Replit’s coding agent. Phase 1 is a todo list UI only. Reply briefly with what changed, confirm Phase 1 is complete, and suggest the next phase.",
        responseText:
          "Changed: Built the Phase 1 todo list UI with task rows, checkbox states, simple status styling, and a clean empty/input-ready layout. Phase 1 is complete. Next phase: add task creation, editing, deletion, and local state handling."
      },
      {
        callJson: async () =>
          JSON.stringify({
            ...JSON.parse(providerOutput),
            prompt_intent: "implement_next_step",
            next_step_requirements: ["Implement task creation (add new tasks)", "Implement task editing (modify existing tasks)", "Implement task deletion (remove tasks)"],
            blocked_scope: ["Backend/persistence beyond local state", "Authentication"],
            next_prompt:
              "Please implement the best next step now:\n- Implement task creation (add new tasks)\n- Implement task editing (modify existing tasks)\n- Implement task deletion (remove tasks)\n\nDo not add Backend/persistence beyond local state, or add Authentication yet.\n\nAfter you finish, confirm which requirements were completed and suggest the next step."
          })
      }
    )
    assert.equal(taskCrudNounResult.overallStatus, "pass")
    assert.equal(taskCrudNounResult.promptIntent, "implement_next_step")
    assert.deepEqual(taskCrudNounResult.nextStepRequirements, [
      "Add local/in-memory task creation and display new tasks in the task list"
    ])
    assert.doesNotMatch(taskCrudNounResult.generatedPrompt, /Implement task editing|Implement task deletion/i)

    const taskCrudVerbResult = await runDeepAnalysisV2(
      {
        ...input,
        promptText:
          "Act like Replit’s coding agent. Phase 1 is a todo list UI only. Reply briefly with what changed, confirm Phase 1 is complete, and suggest the next phase.",
        responseText:
          "Implemented the Phase 1 todo list UI. Phase 1 is complete. Next phase: add todo interactions — create, complete/uncomplete, edit, and delete tasks."
      },
      {
        callJson: async () =>
          JSON.stringify({
            ...JSON.parse(providerOutput),
            prompt_intent: "implement_next_step",
            next_step_requirements: [
              "Implement create task interaction",
              "Implement complete/uncomplete task interaction",
              "Implement edit task interaction",
              "Implement delete task interaction"
            ],
            blocked_scope: [],
            next_prompt:
              "Please implement the best next step now:\n- Implement create task interaction\n- Implement complete/uncomplete task interaction\n- Implement edit task interaction\n- Implement delete task interaction\n\nAfter you finish, confirm which requirements were completed and suggest the next step."
          })
      }
    )
    assert.equal(taskCrudVerbResult.overallStatus, "pass")
    assert.equal(taskCrudVerbResult.promptIntent, "implement_next_step")
    assert.deepEqual(taskCrudVerbResult.nextStepRequirements, [
      "Add local/in-memory todo creation and display new todos in the todo list"
    ])
    assert.doesNotMatch(taskCrudVerbResult.generatedPrompt, /Implement complete\/uncomplete|Implement edit|Implement delete/i)

    const objectManagementCases = [
      {
        suggestedNextMove: "Add note management",
        expectedRequirement: "Add local/in-memory note creation and display new notes in the note list"
      },
      {
        suggestedNextMove: "Build note actions",
        expectedRequirement: "Add local/in-memory note creation and display new notes in the note list"
      },
      {
        suggestedNextMove: "Make notes editable and removable",
        expectedRequirement: "Add local/in-memory note creation and display new notes in the note list"
      },
      {
        suggestedNextMove: "Support creating, updating, and deleting notes",
        expectedRequirement: "Add local/in-memory note creation and display new notes in the note list"
      },
      {
        suggestedNextMove: "Let users add, complete, archive, and delete items",
        expectedRequirement: "Add local/in-memory item creation and display new items in the item list"
      }
    ]

    for (const { suggestedNextMove, expectedRequirement } of objectManagementCases) {
      const objectManagementResult = await runDeepAnalysisV2(
        {
          ...input,
          promptText:
            "Act like Replit’s coding agent. Phase 1 is a notes list UI only. Reply briefly with what changed, confirm Phase 1 is complete, and suggest the next phase.",
          responseText: `Implemented Phase 1: notes list UI only. Phase 1 is complete. Next phase: ${suggestedNextMove}.`
        },
        {
          callJson: async () =>
            JSON.stringify({
              ...JSON.parse(providerOutput),
              prompt_intent: "implement_next_step",
              next_step_requirements: [suggestedNextMove],
              blocked_scope: [],
              next_prompt: `Please implement the best next step now:\n- ${suggestedNextMove}\n\nAfter you finish, confirm which requirements were completed and suggest the next step.`
            })
        }
      )
      assert.equal(objectManagementResult.overallStatus, "pass")
      assert.equal(objectManagementResult.promptIntent, "implement_next_step")
      assert.deepEqual(objectManagementResult.nextStepRequirements, [expectedRequirement])
      assert.match(objectManagementResult.blockedScope.join(" "), /edit\/update/)
      assert.match(objectManagementResult.blockedScope.join(" "), /delete\/remove/)
      assert.match(objectManagementResult.blockedScope.join(" "), /archive/)
      assert.match(objectManagementResult.blockedScope.join(" "), /complete\/toggle/)
      assert.match(objectManagementResult.generatedPrompt, new RegExp(expectedRequirement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      assert.doesNotMatch(objectManagementResult.generatedPrompt, /add (?:edit\/update|delete\/remove|archive|complete\/toggle) behavior/i)
      assert.doesNotMatch(objectManagementResult.generatedPrompt, /Make notes editable|Support creating|Add note management|Build note actions|Let users add/i)
    }

    const fileUploadScopeResult = await runDeepAnalysisV2(
      {
        ...input,
        promptText:
          "Act like Replit’s coding agent. Phase 1 is profile settings UI only. Do not add backend, database, storage, auth, file uploads, or payments yet. Reply briefly with what changed, confirm completion, and suggest the next phase.",
        responseText:
          "Implemented Phase 1: Profile Settings UI only. Added avatar placeholder UI without upload functionality. No backend, auth, database, storage, file uploads, or payments added. Phase 1 is complete. Next phase: add form validation and local UI state handling before connecting any backend."
      },
      {
        callJson: async () =>
          JSON.stringify({
            ...JSON.parse(providerOutput),
            prompt_intent: "ask_for_next_step",
            next_step_requirements: [],
            blocked_scope: ["backend", "database", "storage", "auth", "payments"],
            next_prompt:
              "Before implementing more, suggest the safest next step based on the completed work and current project state.\n\nAfter you finish, confirm which requirements were completed and suggest the next step."
          })
      }
    )
    assert.equal(fileUploadScopeResult.overallStatus, "pass")
    assert.equal(fileUploadScopeResult.promptIntent, "implement_next_step")
    assert.deepEqual(fileUploadScopeResult.nextStepRequirements, [
      "Add form validation and local UI state handling before connecting any backend"
    ])
    assert.match(fileUploadScopeResult.blockedScope.join(" "), /file uploads/)

    const invalidResult = await runDeepAnalysisV2(input, {
      callJson: async () => JSON.stringify({ confidence: "certain" })
    })
    assert.equal(invalidResult.providerMetadata.provider, "none")
    assert.equal(invalidResult.providerMetadata.usedFallback, false)
    assert.equal(invalidResult.providerMetadata.providerAttempted, "deepseek")
    assert.equal(invalidResult.providerMetadata.fallbackReason, "invalid_json")
    assert.equal(invalidResult.overallStatus, "unavailable")
    assert.match(invalidResult.generatedPrompt, /Review the previous answer/)

    const emptyResult = await runDeepAnalysisV2(input, {
      callJson: async () => null
    })
    assert.equal(emptyResult.providerMetadata.provider, "none")
    assert.equal(emptyResult.providerMetadata.usedFallback, false)
    assert.equal(emptyResult.providerMetadata.providerAttempted, "deepseek")
    assert.equal(emptyResult.providerMetadata.fallbackReason, "empty_response")
    assert.equal(emptyResult.overallStatus, "unavailable")

    let emptyRetryCalls = 0
    const emptyRetryResult = await runDeepAnalysisV2(input, {
      callJson: async () => {
        emptyRetryCalls += 1
        return emptyRetryCalls === 1 ? "" : providerOutput
      },
      retryDelayMs: 0
    })
    assert.equal(emptyRetryCalls, 2)
    assert.equal(emptyRetryResult.providerMetadata.provider, "deepseek")
    assert.equal(emptyRetryResult.overallStatus, "pass")

    let kimiRetryCalls = 0
    const kimiRetryResult = await runDeepAnalysisV2(input, {
      callDeepSeekJson: async () => {
        throw new Error("DeepSeek request failed with 401: unauthorized")
      },
      callKimiJson: async () => {
        kimiRetryCalls += 1
        if (kimiRetryCalls === 1) {
          throw new Error("Kimi request failed with 429: max organization concurrency")
        }
        return providerOutput
      },
      retryDelayMs: 0
    })
    assert.equal(kimiRetryCalls, 2)
    assert.equal(kimiRetryResult.providerMetadata.provider, "kimi")
    assert.equal(kimiRetryResult.overallStatus, "pass")

    let transientCalls = 0
    const transientRetryResult = await runDeepAnalysisV2(input, {
      callJson: async () => {
        transientCalls += 1
        if (transientCalls === 1) {
          throw new Error("DeepSeek request failed with 503: temporarily unavailable")
        }
        return providerOutput
      },
      retryDelayMs: 0
    })
    assert.equal(transientCalls, 2)
    assert.equal(transientRetryResult.providerMetadata.provider, "deepseek")
    assert.equal(transientRetryResult.overallStatus, "pass")

    let unrecoverableCalls = 0
    const unrecoverableResult = await runDeepAnalysisV2(input, {
      callJson: async () => {
        unrecoverableCalls += 1
        throw new Error("DeepSeek request failed with 400: invalid request")
      },
      retryDelayMs: 0
    })
    assert.equal(unrecoverableCalls, 1)
    assert.equal(unrecoverableResult.providerMetadata.provider, "none")
    assert.equal(unrecoverableResult.overallStatus, "unavailable")

    const kimiOutput = JSON.stringify({
      ...JSON.parse(providerOutput),
      issues: ["Kimi returned the valid compact result."]
    })
    const kimiFallbackResult = await runDeepAnalysisV2(input, {
      callDeepSeekJson: async () => {
        throw new Error("DeepSeek failed fast")
      },
      callKimiJson: async () => kimiOutput,
      now: () => 100
    })
    assert.equal(kimiFallbackResult.providerMetadata.provider, "kimi")
    assert.equal(kimiFallbackResult.providerMetadata.usedFallback, false)

    const timedOutResult = await runDeepAnalysisV2(input, {
      callDeepSeekJson: async () => {
        throw new Error("DeepSeek failed fast")
      },
      callKimiJson: async () => new Promise((resolve) => setTimeout(() => resolve(kimiOutput), 40)),
      hardTimeoutMs: 1
    })
    assert.equal(timedOutResult.providerMetadata.provider, "none")
    assert.equal(timedOutResult.providerMetadata.timedOut, true)
    assert.equal(timedOutResult.providerMetadata.providerAttempted, "deepseek")
    assert.equal(timedOutResult.providerMetadata.fallbackReason, "timeout")
    assert.equal(timedOutResult.providerMetadata.deepSeekAttempted, true)
    assert.equal(typeof timedOutResult.providerMetadata.kimiLatencyMs, "number")
    assert.match(timedOutResult.providerMetadata.failureMessage ?? "", /deepseek:|kimi:/i)
    assert.equal(timedOutResult.overallStatus, "unavailable")

    const boundedDeepSeekResult = await runDeepAnalysisV2(input, {
      callDeepSeekJson: async () => new Promise((resolve) => setTimeout(() => resolve(providerOutput), 50)),
      callKimiJson: async () => new Promise((resolve) => setTimeout(() => resolve(providerOutput), 15)),
      hardTimeoutMs: 80,
      deepSeekFastFailureTimeoutMs: 5,
      retryDelayMs: 0
    })
    assert.equal(boundedDeepSeekResult.providerMetadata.provider, "kimi")
    assert.equal(boundedDeepSeekResult.overallStatus, "pass")

    const healthOk = await mod.checkDeepAnalysisV2ProviderHealth({
      callJson: async () => providerOutput,
      now: () => 100
    })
    assert.equal(healthOk.ok, true)
    assert.equal(healthOk.provider, "deepseek")
    assert.equal(healthOk.providers.length, 3)
    assert.equal(healthOk.providers.find((provider) => provider.provider === "openai")?.reason, "missing_key")
    assert.equal(healthOk.providers.find((provider) => provider.provider === "kimi")?.reason, "missing_key")

    const kimiHealthOk = await mod.checkDeepAnalysisV2ProviderHealth({
      callJson: async () => "",
      callKimiJson: async () => providerOutput,
      now: () => 100
    })
    assert.equal(kimiHealthOk.ok, true)
    assert.equal(kimiHealthOk.provider, "kimi")
    assert.equal(
      kimiHealthOk.providers.find((provider) => provider.provider === "deepseek")?.reason,
      "empty_response"
    )

    console.log("api-deep-analysis-v2-smoke: ok")
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
