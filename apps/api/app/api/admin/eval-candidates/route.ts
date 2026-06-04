import { badRequest, ok, options, parseJson } from "../../../../lib/http"
import {
  EvalCandidateUpsertRequestSchema,
  listAdminEvalCandidates,
  upsertAdminEvalCandidates,
  type EvalCandidateRecord
} from "../../../../lib/admin-eval-candidates"

export const dynamic = "force-dynamic"

export function OPTIONS() {
  return options()
}

export async function GET() {
  try {
    const candidates = await listAdminEvalCandidates()
    return ok({ candidates, total: candidates.length })
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Could not read eval candidates", 500)
  }
}

export async function POST(request: Request) {
  try {
    const input = await parseJson<{
      source: "admin" | "extension"
      replace: boolean
      candidates: EvalCandidateRecord[]
    }>(
      request,
      EvalCandidateUpsertRequestSchema
    )
    const candidates = await upsertAdminEvalCandidates(input)
    return ok({
      success: true,
      candidates,
      total: candidates.length,
      updatedAt: new Date().toISOString()
    })
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Could not save eval candidates")
  }
}
