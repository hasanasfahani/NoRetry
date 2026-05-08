import { DeepAnalysisV2RequestSchema, type DeepAnalysisV2Request } from "@prompt-optimizer/shared/src/deep-analysis-v2"
import { runDeepAnalysisV2 } from "../../../../lib/deep-analysis-v2"
import { badRequest, ok, options, parseJson } from "../../../../lib/http"

export function OPTIONS() {
  return options()
}

export async function POST(request: Request) {
  try {
    const input = await parseJson<DeepAnalysisV2Request>(request, DeepAnalysisV2RequestSchema)
    const result = await runDeepAnalysisV2(input)
    return ok(result)
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid request")
  }
}
