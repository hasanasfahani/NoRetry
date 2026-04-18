type RangeLike = {
  min?: number
  max?: number
  exact?: number
  unit?: string
}

export function isRangeLike(value: unknown): value is RangeLike {
  return Boolean(
    value &&
      typeof value === "object" &&
      ("min" in (value as Record<string, unknown>) ||
        "max" in (value as Record<string, unknown>) ||
        "exact" in (value as Record<string, unknown>))
  )
}

export function isExactCountValue(value: unknown) {
  return isRangeLike(value) && typeof value.exact === "number"
}

export function isCountRangeValue(value: unknown) {
  return isRangeLike(value) && typeof value.min === "number" && typeof value.max === "number"
}

export function isDurationValue(value: unknown) {
  return isRangeLike(value) && (!value.unit || value.unit === "minutes" || value.unit === "hours")
}

export function isCalorieValue(value: unknown) {
  return isRangeLike(value) && value.unit === "calories"
}
