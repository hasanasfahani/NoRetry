import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  buildAttemptIntentFromSubmittedPrompt,
  preprocessResponse,
  type AfterPipelineRequest,
  type AfterAnalysisResult
} from "@prompt-optimizer/shared"
import { analyzeAfterAttempt } from "../lib/after-analysis.ts"

type RegressionFixture = {
  id: string
  submittedPrompt: string
  projectContext: string
  currentState: string
  responseText: string
  deepArtifactPreset?:
    | "replit_success"
    | "replit_partial"
    | "replit_blocked_ui"
    | "replit_dom_contradiction"
  expectedCriteria: string[]
  expectedQuickStatus: AfterAnalysisResult["status"]
  expectedDeepStatus: AfterAnalysisResult["status"]
  expectedQuickConfidence: AfterAnalysisResult["confidence"]
  expectedDeepConfidence: AfterAnalysisResult["confidence"]
  expectedSources: Array<NonNullable<ChecklistItem["source"]>>
  expectedLayers: Array<NonNullable<ChecklistItem["layer"]>>
  expectedCheckedArtifactTypes?: Array<AfterAnalysisResult["checked_artifact_types"][number]>
  expectedBlockedCriteria?: string[]
  minDeepContradictions?: number
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

type ChecklistItem = AfterAnalysisResult["acceptance_checklist"][number]

function checklistSignature(checklist: ChecklistItem[]) {
  return checklist.map((item) => `${item.label}:${item.status}`).join(" | ")
}

function labels(checklist: ChecklistItem[]) {
  return checklist.map((item) => item.label)
}

function sources(result: AfterAnalysisResult) {
  return result.review_contract.criteria.map((item) => item.source)
}

function layers(result: AfterAnalysisResult) {
  return result.review_contract.criteria.map((item) => item.layer)
}

function priorities(result: AfterAnalysisResult) {
  return result.review_contract.criteria.map((item) => item.priority)
}

const CONFIDENCE_RANK: Record<AfterAnalysisResult["confidence"], number> = {
  low: 1,
  medium: 2,
  high: 3
}

async function loadFixtures() {
  const fixturePath = path.resolve(__dirname, "../fixtures/after-review-regression.json")
  const raw = await readFile(fixturePath, "utf8")
  return JSON.parse(raw) as RegressionFixture[]
}

function buildReplitArtifactContext(
  preset: RegressionFixture["deepArtifactPreset"],
  responseText: string
): AfterPipelineRequest["artifact_context"] | undefined {
  if (!preset) return undefined

  const capturedAt = new Date("2026-04-12T00:00:10.000Z").toISOString()
  const domObservation = (
    probeId: string,
    target: string,
    observed: boolean,
    details: string,
    confidence = observed ? 0.85 : 0.35
  ) => ({
    type: "dom_observations" as const,
    source: "regression_dom_probe",
    captured_at: capturedAt,
    surface_scope: "replit_dom",
    content: `${probeId}: ${observed ? "observed" : "not_observed"} - ${details}`,
    metadata: {
      probe_id: probeId,
      target,
      observed,
      confidence,
      details
    }
  })

  const runtimeSignal = (content: string) => ({
    type: "visible_runtime_signals" as const,
    source: "regression_runtime",
    captured_at: capturedAt,
    surface_scope: "replit_runtime",
    content,
    metadata: {}
  })

  const responseArtifact = {
    type: "response_text" as const,
    source: "regression_response",
    captured_at: capturedAt,
    surface_scope: "assistant_response",
    content: responseText,
    metadata: {}
  }

  const successDom = [
    domObservation("prompt_textarea_found", "prompt_textarea", true, "Found the Replit prompt textarea."),
    domObservation("launcher_near_textarea", "inline_launcher", true, "Found the launcher anchored inside the prompt area."),
    domObservation("optimize_panel_visible", "optimize_panel", true, "Found the optimize panel open."),
    domObservation("strength_badge_visible", "strength_badge", true, "Found the correct strength badge."),
    domObservation("question_ui_visible", "question_flow", true, "Found visible follow-up questions."),
    domObservation("replace_button_visible", "replace_button", true, "Found the Replace button."),
    domObservation("improved_prompt_visible_in_textarea", "prompt_textarea_content", true, "Found improved prompt text in the textarea."),
    domObservation("popup_visible", "extension_popup", true, "Found the popup open."),
    domObservation("auth_state_visible", "auth_state", true, "Found visible auth state."),
    domObservation("usage_visible", "usage", true, "Found visible usage text."),
    domObservation("strengthen_flow_visible", "strengthen_flow", true, "Found the Strengthen flow visible.")
  ]

  const partialDom = [
    domObservation("prompt_textarea_found", "prompt_textarea", true, "Found the Replit prompt textarea."),
    domObservation("launcher_near_textarea", "inline_launcher", true, "Found the launcher anchored inside the prompt area."),
    domObservation("optimize_panel_visible", "optimize_panel", true, "Found the optimize panel open."),
    domObservation("strength_badge_visible", "strength_badge", true, "Found the correct strength badge."),
    domObservation("question_ui_visible", "question_flow", false, "No follow-up question UI was visible."),
    domObservation("replace_button_visible", "replace_button", false, "No Replace button was visible."),
    domObservation("improved_prompt_visible_in_textarea", "prompt_textarea_content", false, "The textarea did not show an improved prompt."),
    domObservation("popup_visible", "extension_popup", false, "The popup was not visibly open."),
    domObservation("auth_state_visible", "auth_state", false, "No auth state was visible."),
    domObservation("usage_visible", "usage", false, "No usage text was visible."),
    domObservation("strengthen_flow_visible", "strengthen_flow", false, "No Strengthen flow was visible.")
  ]

  const contradictionDom = [
    domObservation("prompt_textarea_found", "prompt_textarea", true, "Found the Replit prompt textarea."),
    domObservation("launcher_near_textarea", "inline_launcher", true, "Found the launcher anchored inside the prompt area."),
    domObservation("optimize_panel_visible", "optimize_panel", true, "Found the optimize panel open."),
    domObservation("strength_badge_visible", "strength_badge", true, "Found the correct strength badge."),
    domObservation("question_ui_visible", "question_flow", false, "No follow-up question UI was visible."),
    domObservation("replace_button_visible", "replace_button", false, "No Replace button was visible."),
    domObservation("improved_prompt_visible_in_textarea", "prompt_textarea_content", false, "The textarea did not show an improved prompt."),
    domObservation("popup_visible", "extension_popup", false, "The popup was not visibly open."),
    domObservation("auth_state_visible", "auth_state", false, "No auth state was visible."),
    domObservation("usage_visible", "usage", false, "No usage text was visible."),
    domObservation("strengthen_flow_visible", "strengthen_flow", false, "No Strengthen flow was visible.")
  ]

  const artifacts =
    preset === "replit_success"
      ? [responseArtifact, ...successDom, runtimeSignal("No extension-related console errors were visible during load or typing.")]
      : preset === "replit_partial"
        ? [responseArtifact, ...partialDom, runtimeSignal("No extension-related console errors were visible during load or typing.")]
      : preset === "replit_blocked_ui"
        ? [responseArtifact, runtimeSignal("No extension-related console errors were visible during load or typing.")]
      : [responseArtifact, ...contradictionDom, runtimeSignal("TypeError: content.js crashed while typing in the Replit chat area.")]

  return {
    mode: "passive",
    surface: "replit",
    artifacts
  }
}

function buildRequest(fixture: RegressionFixture, deep: boolean, baseline?: ReturnType<typeof analyzeAfterAttempt> extends Promise<infer T> ? T : never): AfterPipelineRequest {
  const intent = buildAttemptIntentFromSubmittedPrompt(fixture.submittedPrompt, "DEBUG")
  const attempt = {
    attempt_id: `fixture-${fixture.id}`,
    platform: "replit" as const,
    raw_prompt: fixture.submittedPrompt,
    optimized_prompt: fixture.submittedPrompt,
    intent,
    status: "submitted" as const,
    created_at: new Date("2026-04-12T00:00:00.000Z").toISOString(),
    submitted_at: new Date("2026-04-12T00:00:05.000Z").toISOString(),
    response_text: null,
    response_message_id: null,
    analysis_result: null,
    token_usage_total: 0,
    stage_cache: {}
  }

  return {
    attempt,
    response_summary: preprocessResponse(fixture.responseText),
    response_text_fallback: fixture.responseText,
    deep_analysis: deep,
    baseline_acceptance_criteria: baseline?.review_contract.criteria.map((item) => item.label) ?? [],
    baseline_acceptance_checklist: baseline?.acceptance_checklist ?? [],
    baseline_review_contract: baseline?.review_contract ?? null,
    project_context: fixture.projectContext,
    current_state: fixture.currentState,
    error_summary: null,
    changed_file_paths_summary: [],
    artifact_context: deep ? buildReplitArtifactContext(fixture.deepArtifactPreset, fixture.responseText) : undefined
  }
}

async function main() {
  const fixtures = await loadFixtures()
  const failures: string[] = []

  for (const fixture of fixtures) {
    const quick = await analyzeAfterAttempt(buildRequest(fixture, false))
    const quickRepeat = await analyzeAfterAttempt(buildRequest(fixture, false))
    const deep = await analyzeAfterAttempt(buildRequest(fixture, true, quick))
    const deepRepeat = await analyzeAfterAttempt(buildRequest(fixture, true, quick))

    try {
      assert(quick.review_contract.criteria.length > 0, `[${fixture.id}] quick review contract is empty`)
      assert(
        JSON.stringify(quick.review_contract.criteria.map((item) => item.label)) === JSON.stringify(fixture.expectedCriteria),
        `[${fixture.id}] quick contract labels do not match the frozen fixture contract`
      )
      assert(
        JSON.stringify(sources(quick)) === JSON.stringify(fixture.expectedSources),
        `[${fixture.id}] quick contract sources drifted from expected provenance`
      )
      assert(
        JSON.stringify(layers(quick)) === JSON.stringify(fixture.expectedLayers),
        `[${fixture.id}] quick contract layers drifted from expected classification`
      )
      assert(
        JSON.stringify(priorities(quick)) === JSON.stringify([1, 2, 3, 4, 5, 6].slice(0, quick.review_contract.criteria.length)),
        `[${fixture.id}] quick contract priorities are not stable`
      )
      assert(
        JSON.stringify(quick.review_contract.criteria.map((item) => item.label)) ===
          JSON.stringify(quickRepeat.review_contract.criteria.map((item) => item.label)),
        `[${fixture.id}] quick contract drifted across repeated runs`
      )
      assert(
        checklistSignature(quick.acceptance_checklist) === checklistSignature(quickRepeat.acceptance_checklist),
        `[${fixture.id}] quick checklist drifted across repeated runs`
      )
      assert(
        JSON.stringify(quick.review_contract.criteria.map((item) => item.label)) ===
          JSON.stringify(deep.review_contract.criteria.map((item) => item.label)),
        `[${fixture.id}] deep contract labels drifted from quick`
      )
      assert(
        JSON.stringify(sources(deep)) === JSON.stringify(fixture.expectedSources),
        `[${fixture.id}] deep contract sources drifted from expected provenance`
      )
      assert(
        JSON.stringify(layers(deep)) === JSON.stringify(fixture.expectedLayers),
        `[${fixture.id}] deep contract layers drifted from expected classification`
      )
      assert(
        JSON.stringify(labels(quick.acceptance_checklist)) === JSON.stringify(labels(deep.acceptance_checklist)),
        `[${fixture.id}] deep checklist labels drifted from quick`
      )
      assert(
        !deep.acceptance_checklist.some((item) => item.status === "not_sure"),
        `[${fixture.id}] deep checklist still contains not_sure`
      )
      if (fixture.expectedCheckedArtifactTypes) {
        assert(
          JSON.stringify(deep.checked_artifact_types) === JSON.stringify(fixture.expectedCheckedArtifactTypes),
          `[${fixture.id}] deep checked artifact types drifted: expected ${JSON.stringify(fixture.expectedCheckedArtifactTypes)}, got ${JSON.stringify(deep.checked_artifact_types)}`
        )
      }
      if (fixture.expectedBlockedCriteria) {
        const blockedLabels = deep.acceptance_checklist
          .filter((item) => item.status === "blocked")
          .map((item) => item.label)
        assert(
          JSON.stringify(blockedLabels) === JSON.stringify(fixture.expectedBlockedCriteria),
          `[${fixture.id}] blocked criteria drifted: expected ${JSON.stringify(fixture.expectedBlockedCriteria)}, got ${JSON.stringify(blockedLabels)}`
        )
      }
      if (typeof fixture.minDeepContradictions === "number") {
        assert(
          deep.contradiction_count >= fixture.minDeepContradictions,
          `[${fixture.id}] deep contradiction count drifted: expected at least ${fixture.minDeepContradictions}, got ${deep.contradiction_count}`
        )
      }
      assert(
        JSON.stringify(deep.review_contract.criteria.map((item) => item.label)) ===
          JSON.stringify(deepRepeat.review_contract.criteria.map((item) => item.label)),
        `[${fixture.id}] deep contract drifted across repeated runs`
      )
      assert(
        checklistSignature(deep.acceptance_checklist) === checklistSignature(deepRepeat.acceptance_checklist),
        `[${fixture.id}] deep checklist drifted across repeated runs`
      )
      assert(
        quick.acceptance_checklist.every((item) => item.label && !/user'?s latest request/i.test(item.label)),
        `[${fixture.id}] quick checklist fell back to generic labels: ${checklistSignature(quick.acceptance_checklist)}`
      )
      assert(
        deep.acceptance_checklist.every((item) => item.label && !/user'?s latest request/i.test(item.label)),
        `[${fixture.id}] deep checklist fell back to generic labels: ${checklistSignature(deep.acceptance_checklist)}`
      )
      assert(quick.status === fixture.expectedQuickStatus, `[${fixture.id}] quick status drifted: expected ${fixture.expectedQuickStatus}, got ${quick.status}`)
      assert(deep.status === fixture.expectedDeepStatus, `[${fixture.id}] deep status drifted: expected ${fixture.expectedDeepStatus}, got ${deep.status}`)
      assert(
        quick.confidence === fixture.expectedQuickConfidence,
        `[${fixture.id}] quick confidence drifted: expected ${fixture.expectedQuickConfidence}, got ${quick.confidence}`
      )
      assert(
        deep.confidence === fixture.expectedDeepConfidence,
        `[${fixture.id}] deep confidence drifted: expected ${fixture.expectedDeepConfidence}, got ${deep.confidence}`
      )
      assert(
        CONFIDENCE_RANK[deep.confidence] >= CONFIDENCE_RANK[quick.confidence],
        `[${fixture.id}] deep confidence regressed below quick`
      )
      assert(
        !(
          deep.findings.some((item) => /every acceptance criterion/i.test(item)) &&
          deep.findings.some((item) => /could not|does not clearly show|remain unverified/i.test(item))
        ),
        `[${fixture.id}] deep findings contradict the final checklist/verdict: ${JSON.stringify(deep.findings)}`
      )
      if (deep.status === "SUCCESS") {
        assert(
          deep.stage_2.missing_criteria.length === 0,
          `[${fixture.id}] deep success still reports missing criteria: ${JSON.stringify(deep.stage_2.missing_criteria)}`
        )
        assert(
          deep.stage_2.problem_fit === "correct",
          `[${fixture.id}] deep success should have correct problem_fit, got ${deep.stage_2.problem_fit}`
        )
        assert(
          deep.next_prompt_output.prompt_strategy === "validate",
          `[${fixture.id}] deep success should produce a validate next prompt, got ${deep.next_prompt_output.prompt_strategy}`
        )
        assert(
          deep.findings.every((item) => !/could not|does not clearly show|remain unverified/i.test(item)),
          `[${fixture.id}] deep success still contains unresolved-language findings: ${JSON.stringify(deep.findings)}`
        )
        assert(
          deep.stage_2.analysis_notes.every((item) => !/could not|does not clearly show|remain unverified/i.test(item)),
          `[${fixture.id}] deep success still contains unresolved-language stage_2 notes: ${JSON.stringify(deep.stage_2.analysis_notes)}`
        )
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : `[${fixture.id}] unknown failure`)
    }
  }

  if (failures.length) {
    console.error("AFTER regression failures:\n" + failures.map((item) => `- ${item}`).join("\n"))
    process.exitCode = 1
    return
  }

  console.log(`AFTER regression passed for ${fixtures.length} fixture(s).`)
}

void main()
