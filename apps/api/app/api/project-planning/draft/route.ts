import {
  GenerateProjectPlanningDraftRequestSchema,
  type GenerateProjectPlanningDraftRequest
} from "@prompt-optimizer/shared"
import { ProjectPlanningAiError, runProjectPlanningDraft } from "../../../../lib/project-planning-ai"
import { badRequest, ok, options, parseJson } from "../../../../lib/http"

function logProjectPlanningDiagnostics(stage: string, diagnostics: unknown) {
  if (process.env.NODE_ENV === "production") return
  console.debug("[Project Planning]", stage, diagnostics)
}

export function OPTIONS() {
  return options()
}

export async function POST(request: Request) {
  try {
    const input = await parseJson<GenerateProjectPlanningDraftRequest>(request, GenerateProjectPlanningDraftRequestSchema)
    const result = await runProjectPlanningDraft(input)
    logProjectPlanningDiagnostics("prd_generated", result.diagnostics)
    return ok(result)
  } catch (error) {
    if (error instanceof ProjectPlanningAiError) {
      logProjectPlanningDiagnostics("prd_failed", error.diagnostics)
      return badRequest(error.message, 503, { diagnostics: error.diagnostics })
    }
    return badRequest(error instanceof Error ? error.message : "Invalid request")
  }
}
