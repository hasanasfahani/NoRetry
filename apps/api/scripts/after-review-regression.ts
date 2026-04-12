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
  expectedCriteria: string[]
  expectedQuickStatus: AfterAnalysisResult["status"]
  expectedDeepStatus: AfterAnalysisResult["status"]
  expectedQuickConfidence: AfterAnalysisResult["confidence"]
  expectedDeepConfidence: AfterAnalysisResult["confidence"]
  expectedSources: Array<NonNullable<ChecklistItem["source"]>>
  expectedLayers: Array<NonNullable<ChecklistItem["layer"]>>
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
    changed_file_paths_summary: []
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
