import type { GoalContract } from "../goal/types"
import type { ArchitectureDecisionConflict } from "../session/project-settings"

export type PreflightSignalSeverity = "info" | "warning" | "critical"

export type PreflightSignalType =
  | "engineer_escalation"
  | "ambiguity_risk"
  | "missing_success_criteria"
  | "missing_proof_requirement"
  | "scope_too_broad"
  | "likely_wrong_file_targeting"
  | "conflicting_instructions"
  | "architecture_conflict"

export type PreflightSignal = {
  id: string
  type: PreflightSignalType
  severity: PreflightSignalSeverity
  label: string
  detail: string
  engineerWarning?: EngineerEscalationWarning
  architectureWarning?: ArchitectureConflictWarning
}

export type ArchitectureConflictWarning = {
  storedDecision: string
  conflictingRequest: string
  practicalConsequence: string
  choices: ArchitectureDecisionConflict["choices"]
}

export type EngineerEscalationWarning = {
  whyRisky: string
  whatCouldGoWrong: string
  reevaCannotCheck: string
  actionLabel: "Continue anyway"
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function createSignal(
  type: PreflightSignalType,
  severity: PreflightSignalSeverity,
  label: string,
  detail: string,
  engineerWarning?: EngineerEscalationWarning,
  architectureWarning?: ArchitectureConflictWarning
): PreflightSignal {
  return {
    id: `${type}:${normalizeText(label).replace(/[^a-z0-9]+/g, "-")}`,
    type,
    severity,
    label,
    detail,
    ...(engineerWarning ? { engineerWarning } : {}),
    ...(architectureWarning ? { architectureWarning } : {})
  }
}

export function buildArchitectureConflictWarning(
  conflict: ArchitectureDecisionConflict
): ArchitectureConflictWarning | null {
  try {
    if (
      !conflict.storedDecision.trim() ||
      !conflict.conflictingRequest.trim() ||
      !conflict.practicalConsequence.trim() ||
      conflict.choices.length !== 3
    ) {
      return null
    }
    return {
      storedDecision: conflict.storedDecision,
      conflictingRequest: conflict.conflictingRequest,
      practicalConsequence: conflict.practicalConsequence,
      choices: conflict.choices.map((choice) => ({ ...choice }))
    }
  } catch {
    return null
  }
}

function buildEngineerEscalationWarning(promptText: string): EngineerEscalationWarning | null {
  const normalized = normalizeText(promptText)
  const risks: string[] = []
  const possibleFailures: string[] = []

  const productionAuthentication =
    /\b(production|live)\b.{0,80}\b(auth|authentication|login|sessions?)\b/.test(normalized) ||
    /\b(auth|authentication|login|sessions?)\b.{0,80}\b(production|live)\b/.test(normalized) ||
    /\b(permissions?|access control|authorization|rbac|role[- ]based access|session handling|session management|session rotation|user permissions?|account permissions?)\b/.test(
      normalized
    )
  if (productionAuthentication) {
    risks.push("production authentication, permissions, or session handling")
    possibleFailures.push("people could gain the wrong access or lose secure sessions")
  }

  if (
    /\b(payments?|billing|checkout|subscriptions?|refunds?|invoices?|financial correctness|money movement|charge cards?|stripe webhooks?)\b/.test(
      normalized
    )
  ) {
    risks.push("payments, billing, or financial correctness")
    possibleFailures.push("customers could be charged incorrectly or financial records could diverge")
  }

  if (
    /\b(database|schema|migrations?|tables?|columns?|fields?)\b/.test(normalized) &&
    /\b(delete(?:s|d|ing)?|drop(?:s|ped|ping)?|rename(?:s|d|ing)?|type changes?|change(?:s|d|ing)? (?:the )?type|alter(?:s|ed|ing)? (?:a |the )?column|backfill(?:s|ed|ing)?)\b/.test(
      normalized
    )
  ) {
    risks.push("a destructive database migration")
    possibleFailures.push("data could be lost, corrupted, or left in an unrecoverable mixed state")
  }

  if (
    /\b(exposed|leaked|committed|public|client[- ]side|hardcoded|compromised)\b.{0,80}\b(api keys?|credentials?|secrets?|tokens?|passwords?)\b/.test(
      normalized
    ) ||
    /\b(api keys?|credentials?|secrets?|tokens?|passwords?)\b.{0,80}\b(exposed|leaked|committed|public|client[- ]side|hardcoded|compromised)\b/.test(
      normalized
    )
  ) {
    risks.push("exposed credentials or API keys")
    possibleFailures.push("an attacker could reuse the credential even after the code is changed")
  }

  if (/\b(security incident|suspected breach|data breach|account takeover|unauthorized access|credential leak|system compromised)\b/.test(normalized)) {
    risks.push("a suspected security incident")
    possibleFailures.push("continuing normal development could destroy evidence or leave an active compromise in place")
  }

  if (
    /\b(sensitive (?:personal )?data|personally identifiable information|personal data|pii|phi|medical data|health data|patient data|regulated data|hipaa|pci[- ]dss|social security numbers?|passport data)\b/.test(
      normalized
    )
  ) {
    risks.push("sensitive personal, health, or regulated data")
    possibleFailures.push("private data could be exposed, retained incorrectly, or handled outside legal obligations")
  }

  if (
    /\b(rewrite|refactor|replace|rebuild|overhaul)\b/.test(normalized) &&
    /\b(entire|whole|all|across (?:the )?(?:core|main) modules?|core modules?|core architecture|multiple core modules?)\b/.test(normalized)
  ) {
    risks.push("a broad rewrite across core modules")
    possibleFailures.push("unrelated behavior could change and recovery could require a large rollback")
  }

  if (!risks.length) return null

  return {
    whyRisky: `This request touches ${risks.join(", ")}.`,
    whatCouldGoWrong: possibleFailures.map((failure) => `${failure.charAt(0).toUpperCase()}${failure.slice(1)}.`).join(" "),
    reevaCannotCheck:
      "reeva cannot inspect the implementation, confirm security controls, validate production data, or prove that a rollback is safe.",
    actionLabel: "Continue anyway"
  }
}

function hasExplicitSuccessCriteria(goalContract: GoalContract, promptText: string) {
  const normalizedPrompt = normalizeText(promptText)
  return (
    goalContract.outputRequirements.length > 0 ||
    goalContract.verificationExpectations.length > 0 ||
    goalContract.hardConstraints.some((constraint) =>
      ["output", "technology", "method", "time", "count", "servings", "calories", "protein"].includes(constraint.type)
    ) ||
    /\b(success|done|verify|validated?|proof|test|assert|should include|must include|return only)\b/.test(normalizedPrompt)
  )
}

function hasProofRequirement(goalContract: GoalContract, promptText: string) {
  const normalizedPrompt = normalizeText(promptText)
  return (
    goalContract.verificationExpectations.length > 0 ||
    /\bprove|proof|verify|validated?|show evidence|test|runtime|working\b/.test(normalizedPrompt)
  )
}

function hasBroadScope(promptText: string, goalContract: GoalContract) {
  const normalizedPrompt = normalizeText(promptText)
  const requirementCount =
    goalContract.hardConstraints.length + goalContract.outputRequirements.length + goalContract.softPreferences.length
  return (
    requirementCount >= 8 ||
    normalizedPrompt.length > 320 ||
    /\band\b.*\band\b.*\band\b/.test(normalizedPrompt) ||
    /\b(build|create|generate|implement|fix|rewrite)\b.*\b(and|plus)\b/i.test(promptText)
  )
}

function hasLikelyWrongFileTargeting(promptText: string, goalContract: GoalContract) {
  const normalizedPrompt = normalizeText(promptText)
  const mentionsCodeTarget = /\bfile|component|module|function|class|route|endpoint|tsx?|jsx?|py|html|css\b/.test(normalizedPrompt)
  const vagueAction = /\bfix this|update it|change it|make it work|handle this\b/.test(normalizedPrompt)
  const technicalGoal = goalContract.taskFamily === "creation" || /\breact|next\.?js|typescript|html|css|python|api\b/.test(normalizedPrompt)
  return technicalGoal && vagueAction && !mentionsCodeTarget
}

function hasConflictingInstructions(promptText: string, goalContract: GoalContract) {
  const normalizedPrompt = normalizeText(promptText)
  const hasMicrowave = /\bmicrowave\b/.test(normalizedPrompt)
  const hasOven = /\boven\b/.test(normalizedPrompt)
  const hasConcise = /\bconcise|brief|short\b/.test(normalizedPrompt)
  const hasDetailed = /\bdetailed|thorough|comprehensive\b/.test(normalizedPrompt)
  const duplicateConflicts = goalContract.hardConstraints.some((constraint, _, all) => {
    if (constraint.type !== "method") return false
    return all.some((other) => other.id !== constraint.id && other.type === "method" && normalizeText(other.label) !== normalizeText(constraint.label))
  })
  return duplicateConflicts || (hasMicrowave && hasOven) || (hasConcise && hasDetailed)
}

function hasAmbiguityRisk(promptText: string, goalContract: GoalContract) {
  const normalizedPrompt = normalizeText(promptText)
  const hardSignalCount = goalContract.hardConstraints.length + goalContract.outputRequirements.length
  return (
    /\bthis\b|\bit\b|\bsomething\b|\bstuff\b/.test(normalizedPrompt) &&
    hardSignalCount < 2
  ) || (
    goalContract.userGoal.length < 24 && hardSignalCount < 2
  )
}

export function buildPreflightSignals(input: {
  goalContract: GoalContract
  promptText: string
  architectureConflicts?: ArchitectureDecisionConflict[]
}) {
  const { goalContract, promptText } = input
  const signals: PreflightSignal[] = []

  try {
    for (const conflict of input.architectureConflicts ?? []) {
      const warning = buildArchitectureConflictWarning(conflict)
      if (!warning) continue
      signals.push(
        createSignal(
          "architecture_conflict",
          "critical",
          "This request conflicts with a saved architecture decision.",
          `Stored decision: ${warning.storedDecision}. Conflicting request: ${warning.conflictingRequest}. Practical consequence: ${warning.practicalConsequence}`,
          undefined,
          warning
        )
      )
    }
  } catch {
    // Architecture conflict warnings are advisory. Keep the existing preflight behavior on failure.
  }

  const engineerWarning = buildEngineerEscalationWarning(promptText)
  if (engineerWarning) {
    signals.push(
      createSignal(
        "engineer_escalation",
        "critical",
        "Involve an experienced engineer before proceeding.",
        engineerWarning.whyRisky,
        engineerWarning
      )
    )
  }

  if (hasAmbiguityRisk(promptText, goalContract)) {
    signals.push(
      createSignal(
        "ambiguity_risk",
        "warning",
        "This prompt is still ambiguous.",
        "The goal is short or uses vague references without enough concrete requirements."
      )
    )
  }

  if (!hasExplicitSuccessCriteria(goalContract, promptText)) {
    signals.push(
      createSignal(
        "missing_success_criteria",
        "critical",
        "This prompt lacks a success condition.",
        "Add the exact output or acceptance criteria you want the assistant to satisfy."
      )
    )
  }

  if ((goalContract.taskFamily === "debug" || /\bfix|debug|validate|verify|test\b/i.test(promptText)) && !hasProofRequirement(goalContract, promptText)) {
    signals.push(
      createSignal(
        "missing_proof_requirement",
        "warning",
        "You asked for validation but not for proof.",
        "Ask for a visible proof step such as a test, runtime check, or exact verification point."
      )
    )
  }

  if (hasBroadScope(promptText, goalContract)) {
    signals.push(
      createSignal(
        "scope_too_broad",
        "critical",
        "This is too broad for one AI attempt.",
        "Narrow the task to the first concrete deliverable or the highest-risk requirement."
      )
    )
  }

  if (hasLikelyWrongFileTargeting(promptText, goalContract)) {
    signals.push(
      createSignal(
        "likely_wrong_file_targeting",
        "warning",
        "This may target the wrong file or code area.",
        "Name the file, component, route, or function you want changed."
      )
    )
  }

  if (hasConflictingInstructions(promptText, goalContract)) {
    signals.push(
      createSignal(
        "conflicting_instructions",
        "critical",
        "This prompt contains conflicting instructions.",
        "Resolve method, scope, or style conflicts before sending."
      )
    )
  }

  return signals
}
