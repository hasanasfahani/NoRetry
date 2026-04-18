import type { ReviewAnalysisEvidenceSpan } from "./contracts"

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function tokenize(value: string) {
  return Array.from(
    new Set(
      normalize(value)
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3)
    )
  )
}

function uniqueSpans(spans: ReviewAnalysisEvidenceSpan[]) {
  const seen = new Set<string>()
  const kept: ReviewAnalysisEvidenceSpan[] = []
  for (const span of spans) {
    const key = `${span.source}:${span.lineStart}:${span.lineEnd}:${span.snippet.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(span)
  }
  return kept
}

export function extractEvidenceSpans(params: {
  text: string
  source: ReviewAnalysisEvidenceSpan["source"]
  queries: string[]
  limit?: number
}): ReviewAnalysisEvidenceSpan[] {
  const lines = params.text.split("\n")
  const queryTokens = Array.from(new Set(params.queries.flatMap((query) => tokenize(query))))
  if (!queryTokens.length) return []

  const scored = lines
    .map((line, index) => {
      const normalized = normalize(line).toLowerCase()
      if (!normalized) return null
      const score = queryTokens.reduce((total, token) => (normalized.includes(token) ? total + 1 : total), 0)
      if (score === 0) return null
      return {
        score,
        span: {
          source: params.source,
          snippet: normalize(line),
          lineStart: index + 1,
          lineEnd: index + 1
        } satisfies ReviewAnalysisEvidenceSpan
      }
    })
    .filter((item): item is { score: number; span: ReviewAnalysisEvidenceSpan } => item !== null)
    .sort((left, right) => right.score - left.score || left.span.lineStart - right.span.lineStart)

  return uniqueSpans(scored.map((item) => item.span)).slice(0, params.limit ?? 3)
}
