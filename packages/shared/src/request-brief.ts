import type { AnalyzePromptResponse } from "./schemas"

export type RequestBriefRiskLevel = "low" | "medium" | "high"

export type RequestBrief = {
  rawRequest: string
  goal: string
  deliverable: string | null
  userValue: string
  scope: string[]
  nonGoals: string[]
  constraints: string[]
  successCriteria: string[]
  assumptions: string[]
  riskLevel: RequestBriefRiskLevel
  riskReason: string
}

export type RequestBriefInput = {
  promptText: string
  intent: AnalyzePromptResponse["intent"]
  deliverableType?: string | null
  hardConstraints?: string[]
  outputRequirements?: string[]
  softPreferences?: string[]
  answeredPath?: string[]
  missingElements?: string[]
  suggestions?: string[]
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function toSentence(value: string) {
  const trimmed = normalize(value)
  if (!trimmed) return ""
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

function sentenceCase(value: string) {
  const trimmed = normalize(value)
  if (!trimmed) return ""
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`
}

function dedupe(items: string[], limit = items.length) {
  const seen = new Set<string>()
  const output: string[] = []
  for (const item of items.map((entry) => normalize(entry)).filter(Boolean)) {
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(item)
    if (output.length >= limit) break
  }
  return output
}

function looksTechnical(promptText: string, deliverableType: string | null | undefined, intent: AnalyzePromptResponse["intent"]) {
  const normalized = promptText.toLowerCase()
  return (
    intent === "DEBUG" ||
    /\b(replit|agent|code|app|repo|repository|route|component|screen|page|database|schema|api|auth|frontend|backend|ui|ux|bug|fix|feature|refactor|deploy|registration|form|flow|field|dropdown|radio button|submit)\b/.test(
      normalized
    ) ||
    /html|css|javascript|typescript|react|next\.?js|node/.test(normalized) ||
    Boolean(deliverableType && /html|code|prompt|spec|plan|scoped_change/i.test(deliverableType))
  )
}

function extractGoal(promptText: string, deliverableType: string | null | undefined) {
  const normalized = normalize(promptText)
  if (!normalized) return "Clarify the exact outcome before sending the next request."
  const firstLine = normalized.split(/\n+/)[0] ?? normalized
  const firstSentence = firstLine.split(/(?<=[.!?])\s+/)[0] ?? firstLine
  if (firstSentence.length <= 170) return firstSentence
  if (deliverableType) return `Request a clear ${deliverableType} that stays faithful to the typed direction.`
  return `${firstSentence.slice(0, 167).trim()}...`
}

function buildUserValue(intent: AnalyzePromptResponse["intent"], technical: boolean, deliverableType: string | null) {
  if (technical) {
    switch (intent) {
      case "DEBUG":
        return "Help the coding assistant stay narrowly focused, validate the right thing, and avoid risky drift."
      case "BUILD":
        return "Turn the request into a safe implementation brief that preserves architecture and avoids expensive rewrites."
      case "EXPLAIN":
        return "Get a direct, implementation-aware answer without vague guidance or avoidable extra work."
      default:
        return "Give the coding assistant a clear, scoped brief it can act on without widening the change."
    }
  }

  if (deliverableType) return `Get a usable ${deliverableType} quickly without the AI guessing the wrong shape.`

  switch (intent) {
    case "BUILD":
      return "Get a strong first draft without spending extra turns clarifying the basics."
    case "EXPLAIN":
      return "Get a direct, easy-to-use answer without extra back-and-forth."
    default:
      return "Reduce AI miscommunication by turning the rough request into a clearer brief."
  }
}

function buildScope(input: RequestBriefInput, technical: boolean) {
  const answeredScope = dedupe(
    (input.answeredPath ?? []).filter(
      (item) => !/\b(under|less|more|only|without|avoid|keep|must|do not|calories|minutes|servings|output|format)\b/i.test(item)
    ),
    3
  ).map((item) => toSentence(sentenceCase(item)))

  const fallbackScope = technical
    ? [
        "Focus only on the requested change or fix.",
        "Reuse the current product patterns unless the user clearly asks for a broader redesign."
      ]
    : [
        "Stay close to the typed request instead of expanding it into extras.",
        "Keep the result directly usable as the next answer or draft."
      ]

  return dedupe([...answeredScope, ...fallbackScope], 3)
}

function buildNonGoals(technical: boolean) {
  if (technical) {
    return [
      "Do not rewrite unrelated parts of the product.",
      "Do not widen the scope into architecture, schema, or platform changes unless explicitly requested."
    ]
  }

  return [
    "Do not add unrelated extras that the user did not ask for.",
    "Do not ignore the explicit format or constraint requirements."
  ]
}

function toAcceptanceCriterion(value: string, promptText = "") {
  const normalized = normalize(value)
  if (!normalized) return ""

  if (/^(field type|allowed options|form placement|submit behavior|scope boundary)$/i.test(normalized)) return ""

  if (/^(dropdown|select)$/i.test(normalized)) {
    return toSentence("The field uses a dropdown (select)")
  }

  if (/^radio buttons?$/i.test(normalized)) {
    return toSentence("The field uses radio buttons")
  }

  const enumOptionsMatch = normalized.match(/^enum\s*\((.+)\)$/i)
  if (enumOptionsMatch) {
    const options = enumOptionsMatch[1]
      .split(/\s*\/\s*|\s*,\s*/)
      .map((item) => item.trim())
      .filter(Boolean)

    if (options.length === 1) {
      return toSentence(`The available option is ${options[0]}`)
    }

    if (options.length === 2) {
      return toSentence(`The available options are ${options[0]} and ${options[1]}`)
    }

    if (options.length >= 3) {
      const last = options[options.length - 1]
      const rest = options.slice(0, -1)
      return toSentence(`The available options are ${rest.join(", ")}, and ${last}`)
    }
  }

  const afterPlacementMatch = normalized.match(/^after\s+(.+)$/i)
  if (afterPlacementMatch) {
    const target = afterPlacementMatch[1].toLowerCase().trim()
    if (/\bfields\b$/.test(target)) {
      return toSentence(`The field appears immediately after the ${target}`)
    }
    if (/\bfield\b$/.test(target)) {
      return toSentence(`The field appears immediately after the ${target}`)
    }
    return toSentence(`The field appears immediately after the ${target} field`)
  }

  const dropdownMatch = normalized.match(/^(dropdown|radio buttons?)\s+with\s+(.+)$/i)
  if (dropdownMatch) {
    return toSentence(`The field uses a ${dropdownMatch[1].toLowerCase()} with ${dropdownMatch[2]}`)
  }

  const scopeOnlyMatch = normalized.match(/^(.+?)\s+only$/i)
  if (scopeOnlyMatch) {
    return toSentence(`Only ${scopeOnlyMatch[1].toLowerCase()} is changed`)
  }

  const submitMatch = normalized.match(/^submit\s+(.+?)\s+correctly$/i)
  if (submitMatch) {
    if (/\bregistration\b|\bform\b/i.test(promptText)) {
      return toSentence(`The ${submitMatch[1].toLowerCase()} is submitted with the registration form`)
    }
    return toSentence(`The ${submitMatch[1].toLowerCase()} is submitted correctly`)
  }

  return toSentence(sentenceCase(normalized))
}

function buildSuccessCriteria(input: RequestBriefInput, technical: boolean, deliverableType: string | null | undefined) {
  const answeredSuccess = dedupe(input.answeredPath ?? [], 4)
    .map((item) => toAcceptanceCriterion(item, input.promptText))
    .filter(Boolean)
  const outputDriven = dedupe(input.outputRequirements ?? [], 3).map((item) => toSentence(sentenceCase(item)))
  if (technical && answeredSuccess.length) return answeredSuccess
  if (outputDriven.length) return outputDriven

  if (technical) {
    return [
      "The assistant returns a scoped response aligned with the requested change.",
      "The answer makes it clear what should be changed and how success will be checked."
    ]
  }

  if (deliverableType) {
    return [`The response returns a usable ${deliverableType} in the requested shape.`]
  }

  switch (input.intent) {
    case "BUILD":
      return ["The result is directly usable as a strong first draft."]
    case "EXPLAIN":
      return ["The answer is direct, clear, and easy to follow."]
    default:
      return ["The next answer should satisfy the visible request without needing a broad retry."]
  }
}

function buildAssumptions(input: RequestBriefInput, technical: boolean) {
  const assumptions: string[] = []

  if (technical) {
    assumptions.push("Assume the safest incremental path unless the user clearly asks for a broader rewrite.")
    assumptions.push("Preserve existing architecture and patterns unless a change to them is explicitly requested.")
  } else {
    assumptions.push("Use sensible defaults where the request is silent instead of blocking on minor missing details.")
  }

  if ((input.missingElements ?? []).some((item) => /file|component|area|surface/i.test(item))) {
    assumptions.push("The exact implementation surface is not fully locked down yet, so keep the brief narrow.")
  }

  if ((input.missingElements ?? []).some((item) => /expected outcome|success/i.test(item))) {
    assumptions.push("Success still needs to be made more explicit, so the generated prompt should define a clear done condition.")
  }

  if (!assumptions.length) {
    assumptions.push("Use reasonable defaults only where they do not change the core request.")
  }

  return dedupe(assumptions, 3)
}

function buildRiskAssessment(input: RequestBriefInput, technical: boolean): { riskLevel: RequestBriefRiskLevel; riskReason: string } {
  const normalized = input.promptText.toLowerCase()
  const constraintCount = (input.hardConstraints ?? []).length + (input.outputRequirements ?? []).length
  const highRiskPattern =
    /\b(auth|authentication|billing|payment|database|schema|migration|security|permissions|deployment|infra|infrastructure|refactor|rewrite|delete|remove)\b/.test(
      normalized
    )
  const mediumRiskPattern =
    technical ||
    /\b(api|backend|frontend|state|integration|checkout|admin|dashboard|production|live)\b/.test(normalized) ||
    constraintCount >= 4

  if (highRiskPattern) {
    return {
      riskLevel: "high",
      riskReason: "This request may touch sensitive product or architecture areas, so the brief should stay extra scoped."
    }
  }

  if (mediumRiskPattern) {
    return {
      riskLevel: "medium",
      riskReason: "This request likely affects real implementation details, so the prompt should preserve boundaries clearly."
    }
  }

  return {
    riskLevel: "low",
    riskReason: "This looks like a lower-risk request, so the main job is keeping the output clear and usable."
  }
}

export function buildRequestBrief(input: RequestBriefInput): RequestBrief {
  const deliverable = normalize(input.deliverableType ?? "") || null
  const technical = looksTechnical(input.promptText, deliverable, input.intent)
  const constraints = dedupe([...(input.hardConstraints ?? []), ...(input.outputRequirements ?? [])], 5).map((item) =>
    toSentence(sentenceCase(item))
  )
  const risk = buildRiskAssessment(input, technical)

  return {
    rawRequest: input.promptText,
    goal: toSentence(extractGoal(input.promptText, deliverable)),
    deliverable,
    userValue: buildUserValue(input.intent, technical, deliverable),
    scope: buildScope(input, technical),
    nonGoals: buildNonGoals(technical),
    constraints,
    successCriteria: buildSuccessCriteria(input, technical, deliverable),
    assumptions: buildAssumptions(input, technical),
    riskLevel: risk.riskLevel,
    riskReason: risk.riskReason
  }
}

export function formatRequestBriefSummary(brief: RequestBrief) {
  const sections = [
    `Goal\n${brief.goal}`,
    brief.scope.length ? `Scope\n${brief.scope.map((item) => `- ${item}`).join("\n")}` : "",
    brief.constraints.length ? `Constraints\n${brief.constraints.map((item) => `- ${item}`).join("\n")}` : "",
    brief.successCriteria.length ? `Success criteria\n${brief.successCriteria.map((item) => `- ${item}`).join("\n")}` : "",
    brief.assumptions.length ? `Assumptions for now\n${brief.assumptions.map((item) => `- ${item}`).join("\n")}` : "",
    `Risk\n- ${sentenceCase(brief.riskLevel)}: ${brief.riskReason}`
  ].filter(Boolean)

  return sections.join("\n\n")
}
