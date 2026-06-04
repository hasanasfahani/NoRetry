import {
  AnalyzeProjectPlanningRequestSchema,
  type AnalyzeProjectPlanningRequest
} from "@prompt-optimizer/shared"
import { ProjectPlanningAiError, runProjectPlanningAnalysis } from "../../../../lib/project-planning-ai"
import { badRequest, ok, options, parseJson } from "../../../../lib/http"

// Legacy/internal endpoint. The normal Project Planning flow now uses the
// static intake form and calls /api/project-planning/draft directly.
function logProjectPlanningDiagnostics(stage: string, diagnostics: unknown) {
  if (process.env.NODE_ENV === "production") return
  console.debug("[Project Planning]", stage, diagnostics)
}

export function OPTIONS() {
  return options()
}

export async function POST(request: Request) {
  try {
    const input = await parseJson<AnalyzeProjectPlanningRequest>(request, AnalyzeProjectPlanningRequestSchema)
    const result = await runProjectPlanningAnalysis(input)
    logProjectPlanningDiagnostics("requirements_generated", result.diagnostics)
    return ok(result)
  } catch (error) {
    if (error instanceof ProjectPlanningAiError) {
      logProjectPlanningDiagnostics("requirements_failed", error.diagnostics)
      return badRequest(error.message, 503, { diagnostics: error.diagnostics })
    }
    return badRequest(error instanceof Error ? error.message : "Invalid request")
  }
}
