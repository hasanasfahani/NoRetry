import { checkDeepAnalysisV2ProviderHealth } from "../../../../lib/deep-analysis-v2"
import { badRequest, ok, options } from "../../../../lib/http"

export function OPTIONS() {
  return options()
}

export async function GET() {
  try {
    return ok(await checkDeepAnalysisV2ProviderHealth())
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Health check failed", 500)
  }
}
