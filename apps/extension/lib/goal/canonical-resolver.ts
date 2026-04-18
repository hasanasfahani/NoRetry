import type { GoalCandidate } from "./candidate-types"
import { compareCandidateStrength } from "./conflict-resolution"
import type { GoalNormalizationTrace, NormalizationTraceItem } from "./normalization-trace"

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function normalizeExclusion(value: string) {
  const normalized = normalizeText(value)
  if (normalized.endsWith("s")) return normalized.slice(0, -1)
  return normalized
}

function numericValueKey(candidate: GoalCandidate) {
  if (!candidate.value || typeof candidate.value !== "object") return null
  const value = candidate.value as { min?: number; max?: number; exact?: number; unit?: string }
  const unit = value.unit ? `unit:${value.unit}` : ""
  const anchor = value.max ?? value.exact ?? value.min
  if (anchor == null) return null
  return [`anchor:${anchor}`, unit].filter(Boolean).join("|")
}

function canonicalKey(candidate: GoalCandidate) {
  if (candidate.slot === "exclusion") return `${candidate.slot}:${normalizeExclusion(candidate.matchedText)}`
  if (["calories", "time", "protein", "servings", "count"].includes(candidate.slot)) {
    const key = numericValueKey(candidate)
    if (key) return `${candidate.slot}:${key}`
  }
  return `${candidate.slot}:${normalizeText(candidate.matchedText)}`
}

function genericShadowKey(candidate: GoalCandidate) {
  const normalized = normalizeText(candidate.matchedText)
  return [`generic:${normalized}`, `exclusion:${normalized}`, `diet:${normalized}`, `scope:${normalized}`]
}

export function resolveCanonicalCandidates(candidates: GoalCandidate[]) {
  const groups = new Map<string, GoalCandidate[]>()
  for (const candidate of candidates) {
    const key = canonicalKey(candidate)
    const group = groups.get(key) ?? []
    group.push(candidate)
    groups.set(key, group)
  }

  const canonical: GoalCandidate[] = []
  const trace: NormalizationTraceItem[] = []

  for (const group of groups.values()) {
    const sorted = [...group].sort(compareCandidateStrength)
    const winner = sorted[0]
    canonical.push(winner)
    trace.push({
      sourceField: winner.sourceField,
      sourceText: winner.sourceText,
      matchedSourceSpan: winner.matchedText,
      slot: winner.slot,
      extractor: winner.extractor,
      decision: "kept",
      reason: "highest_priority_semantic_match"
    })

    for (const loser of sorted.slice(1)) {
      trace.push({
        sourceField: loser.sourceField,
        sourceText: loser.sourceText,
        matchedSourceSpan: loser.matchedText,
        slot: loser.slot,
        extractor: loser.extractor,
        decision: "merged",
        reason: "weaker_duplicate_of_canonical_match"
      })
    }
  }

  const filteredCanonical: GoalCandidate[] = []
  for (const candidate of canonical) {
    if (candidate.slot === "scope" && /\b(?:lunch|dinner|breakfast|snack)\b/i.test(candidate.matchedText)) {
      trace.push({
        sourceField: candidate.sourceField,
        sourceText: candidate.sourceText,
        matchedSourceSpan: candidate.matchedText,
        slot: candidate.slot,
        extractor: candidate.extractor,
        decision: "dropped",
        reason: "meal_scope_suppressed_as_low_value_context"
      })
      continue
    }
    if (candidate.slot !== "generic") {
      filteredCanonical.push(candidate)
      continue
    }
    const shadows = genericShadowKey(candidate)
    const hasSpecific = canonical.some((other) => other !== candidate && shadows.includes(`${other.slot}:${normalizeText(other.matchedText)}`))
    if (hasSpecific) {
      trace.push({
        sourceField: candidate.sourceField,
        sourceText: candidate.sourceText,
        matchedSourceSpan: candidate.matchedText,
        slot: candidate.slot,
        extractor: candidate.extractor,
        decision: "dropped",
        reason: "generic_duplicate_suppressed_by_specific_match"
      })
      continue
    }
    filteredCanonical.push(candidate)
  }

  return {
    canonical: filteredCanonical,
    trace
  }
}
