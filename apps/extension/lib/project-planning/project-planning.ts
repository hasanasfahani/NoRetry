import type {
  GeneratedPrdDraftPayload,
  GeneratedPrdPhasePayload,
  GeneratedPrdSectionPayload,
  ProjectPlanningCoverageReportPayload,
  ProjectPlanningCriteriaBucketPayload,
  ProjectPlanningCriteriaKey,
  ProjectPlanningCriteriaStatus,
  ProjectPlanningDiagnosticsPayload,
  ProjectPlanningIntakeFieldsPayload,
  ProjectPlanningPrdSnapshotPayload,
  ProjectPlanningQuestionPayload,
  ProjectPlanningQuestionMode
} from "@prompt-optimizer/shared"
import type { ProjectTrackerDebugMetadata } from "../project-tracker/project-tracker"

export type ProjectPlanningPhase = "intake" | "questions" | "review" | "saving"
export type ProjectPlanningQuestion = ProjectPlanningQuestionPayload
export type ProjectPlanningIntakeFields = ProjectPlanningIntakeFieldsPayload
export type ProjectPlanningCriteriaBucket = ProjectPlanningCriteriaBucketPayload
export type ProjectPlanningCoverageReport = ProjectPlanningCoverageReportPayload
export type ProjectPlanningPrdSnapshot = ProjectPlanningPrdSnapshotPayload
export type GeneratedPrdSection = GeneratedPrdSectionPayload
export type GeneratedPrdPhase = GeneratedPrdPhasePayload
export type GeneratedPrdDraft = GeneratedPrdDraftPayload

export type ProjectPlanningDebugStage = "requirements" | "prd_draft"

export type ProjectPlanningDebugPayload = {
  stage: ProjectPlanningDebugStage
  status: "success" | "failed"
  diagnostics: ProjectPlanningDiagnosticsPayload | null
  tracker?: ProjectTrackerDebugMetadata | null
  intakeFields?: ProjectPlanningIntakeFields | null
  questionLabels?: string[]
  phaseTitles?: string[]
  errorMessage?: string | null
}

export type ProjectPlanningContextPayload = {
  rawMarkdown: string
  projectContext: string
  currentState: string
  structuredMemory: {
    stableConstraints: string[]
    protectedAreas: string[]
    acceptedAssumptions: string[]
    currentFeatureArea: string
  }
}

function normalizeListItem(value: string) {
  return normalizeSentence(value) || "Needs clarification."
}

export type ProjectPlanningState = {
  phase: ProjectPlanningPhase
  description: string
  coverageReport: ProjectPlanningCoverageReport | null
  prdSnapshot: ProjectPlanningPrdSnapshot | null
  questions: ProjectPlanningQuestion[]
  activeQuestionIndex: number
  answerState: Record<string, string | string[]>
  otherAnswerState: Record<string, string>
  generatedPrd: GeneratedPrdDraft | null
  completed: boolean
}

export function buildProjectPlanningDebugText(payload: ProjectPlanningDebugPayload | null) {
  if (!payload) return ""

  const diagnostics = payload.diagnostics
  const intakeFieldStatus = buildProjectPlanningIntakeDebugStatus(payload.intakeFields ?? null)
  const debugPayload = {
    stage: payload.stage,
    status: payload.status,
    providerName: diagnostics?.providerName ?? null,
    durationMs: diagnostics?.durationMs ?? null,
    descriptionPreview: diagnostics?.descriptionPreview ?? null,
    descriptionHash: diagnostics?.descriptionHash ?? null,
    projectLabel: diagnostics?.projectLabel ?? null,
    promptKind: diagnostics?.promptKind ?? null,
    aiAvailable: diagnostics?.aiAvailable ?? null,
    fallbackUsed: diagnostics?.fallbackUsed ?? null,
    outputQualityStatus: diagnostics?.outputQualityStatus ?? null,
    malformedJson: diagnostics?.malformedJson ?? false,
    repairAttempted: diagnostics?.repairAttempted ?? false,
    repairSucceeded: diagnostics?.repairSucceeded ?? false,
    errorReason: diagnostics?.errorReason ?? null,
    providerAttempts:
      diagnostics?.providerAttempts?.map((attempt) => ({
        providerName: attempt.providerName,
        durationMs: attempt.durationMs,
        status: attempt.status,
        retryCount: attempt.retryCount ?? 0,
        malformedJson: attempt.malformedJson ?? false,
        repairAttempted: attempt.repairAttempted ?? false,
        repairSucceeded: attempt.repairSucceeded ?? false,
        errorReason: attempt.errorReason ?? null,
        outputQualityStatus: attempt.outputQualityStatus
      })) ?? [],
    filledIntakeFields: intakeFieldStatus
      .filter((field) => field.filled)
      .map((field) => field.name),
    intakeFields: intakeFieldStatus,
    questionLabels: payload.questionLabels ?? [],
    phaseTitles: payload.phaseTitles ?? [],
    trackerEnabled: payload.tracker?.trackerEnabled ?? null,
    currentPhaseIndex: payload.tracker?.currentPhaseIndex ?? null,
    currentPhaseTitle: payload.tracker?.currentPhaseTitle ?? null,
    nextPhaseTitle: payload.tracker?.nextPhaseTitle ?? null,
    phaseStatus: payload.tracker?.phaseStatus ?? null,
    advanceRecommended: payload.tracker?.advanceRecommended ?? null,
    trackerCompleted: payload.tracker?.trackerCompleted ?? null,
    prdHash: payload.tracker?.prdHash ?? null,
    promptHash: payload.tracker?.promptHash ?? null,
    errorMessage: payload.errorMessage ?? null
  }

  return JSON.stringify(debugPayload, null, 2)
}

export const PROJECT_PLANNING_OTHER_OPTION = "Other"

export const PROJECT_PLANNING_INTAKE_QUESTIONS: ProjectPlanningQuestion[] = [
  {
    id: "intake_target_user",
    criterion: "target_user",
    fillsSections: ["target_user"],
    label: "Who will use this?",
    helper: "Describe the people this app is mainly for.",
    mode: "freeform",
    placeholder: "Example: Busy people who forget to drink enough water during the day."
  },
  {
    id: "intake_problem",
    criterion: "problem",
    fillsSections: ["problem"],
    label: "What problem should it help with?",
    helper: "What is frustrating, slow, confusing, or missing today?",
    mode: "freeform",
    placeholder: "Example: They forget to drink water and do not know if they reached their daily goal."
  },
  {
    id: "intake_first_version",
    criterion: "core_requirements",
    fillsSections: ["goal_outcome", "scope", "core_requirements"],
    label: "What should the first version be able to do?",
    helper: "List only the most important things the first version should do.",
    mode: "freeform",
    placeholder: "Example: Set a daily goal, log drinks, show progress, and send reminders."
  },
  {
    id: "intake_skip_now",
    criterion: "non_goals",
    fillsSections: ["non_goals"],
    label: "What should we skip for now?",
    helper: "Mention anything you do not want in the first version.",
    mode: "freeform",
    placeholder: "Example: No social sharing, no subscriptions, no smartwatch support yet."
  },
  {
    id: "intake_anything_else",
    criterion: "constraints",
    fillsSections: ["constraints", "success_criteria", "assumptions_risks"],
    label: "Anything else we should know?",
    helper: "Add any preferences, examples, limits, or details that might help.",
    mode: "freeform",
    placeholder: "Example: Make it simple, mobile-friendly, and use cups or liters."
  },
  {
    id: "intake_nfr_access_and_roles",
    criterion: "constraints",
    fillsSections: ["constraints", "assumptions_risks"],
    label: "Will people sign in, and should different people see or change different things?",
    helper: "Describe this in everyday terms; reeva AI will turn it into access rules.",
    mode: "freeform",
    placeholder: "Example: Customers sign in and see only their bookings; staff can update booking status."
  },
  {
    id: "intake_nfr_data_and_sensitivity",
    criterion: "constraints",
    fillsSections: ["constraints", "assumptions_risks"],
    label: "What information must the app remember, and what would be serious if it were lost or shown to the wrong person?",
    helper: "Name the information and what needs the most care.",
    mode: "freeform",
    placeholder: "Example: Save names, contact details, and bookings; private booking notes must never reach another customer."
  },
  {
    id: "intake_nfr_deployment_and_services",
    criterion: "constraints",
    fillsSections: ["constraints", "assumptions_risks"],
    label: "Where will this run, and which outside services will it connect to?",
    helper: "Mention the hosting platform and services such as email, payments, maps, or analytics.",
    mode: "freeform",
    placeholder: "Example: Run on Replit and connect to Stripe for payments and Resend for email."
  },
  {
    id: "intake_nfr_quality_priorities",
    criterion: "constraints",
    fillsSections: ["constraints", "success_criteria"],
    label: "Which matter most: speed, accessibility, low cost, easy maintenance?",
    helper: "Choose the qualities that should win when there is a tradeoff.",
    mode: "freeform",
    placeholder: "Example: Accessibility and easy maintenance matter most; moderate hosting cost is acceptable."
  }
]

function answerTextValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.join("; ").trim()
  return typeof value === "string" ? value.trim() : ""
}

function normalizeNfrText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim()
}

export function deriveProjectPlanningNfrProfile(intakeFields: ProjectPlanningIntakeFields) {
  try {
  const accessText = normalizeNfrText(intakeFields.accessAndRoles)
  const dataText = normalizeNfrText(intakeFields.dataAndSensitivity)
  const servicesText = normalizeNfrText(intakeFields.deploymentAndServices)
  const prioritiesText = normalizeNfrText(intakeFields.qualityPriorities)
  const combinedText = [intakeFields.appIdea, accessText, dataText, servicesText].join(" ").toLowerCase()
  const noAccounts = /\b(no|without) (accounts?|logins?|sign[ -]?in)\b|\bpeople (?:do not|don't|won't) sign in\b/i.test(accessText)
  const nothingSaved = /\b(nothing|no (?:user )?data|does not remember|doesn't remember|not saved)\b/i.test(dataText)
  const hasAccounts = !noAccounts && /\b(accounts?|logins?|sign[ -]?in|users? sign|authentication)\b/i.test(accessText)
  const remembersData = Boolean(dataText) && !nothingSaved
  const hasPersonalData = /\b(personal|private|email|phone|address|name|profile|customer data|user data)\b/i.test(combinedText)
  const hasMoney = /\b(payment|payments|billing|subscription|checkout|card|bank|money|financial transaction)\b/i.test(combinedText)
  const hasMultipleUserTypes = /\b(admin|administrator|manager|staff|operator|roles?|permissions?|different user|user types?)\b/i.test(accessText)
  const hasRegulatedData = /\b(regulated|medical|health|patient|banking|financial data|insurance|hipaa|pci|gdpr)\b/i.test(combinedText)
  const riskLevel = hasMoney || hasMultipleUserTypes || hasRegulatedData
    ? "high" as const
    : hasAccounts || remembersData || hasPersonalData
      ? "standard" as const
      : "low" as const
  const assumptions: string[] = []

  if (hasAccounts) {
    assumptions.push("People must sign in before accessing private parts of the app.")
    assumptions.push("Sign-in details are checked before they are accepted.")
  }
  if (hasMultipleUserTypes) {
    assumptions.push("Each user type can only see or change the information allowed for that role.")
  } else if (hasAccounts || hasPersonalData) {
    assumptions.push("Each person can only see or change the information they are allowed to access.")
  }
  if (remembersData || hasPersonalData) assumptions.push("Information is checked before it is saved.")
  if (hasAccounts || remembersData || hasPersonalData) {
    assumptions.push("Sign-in and saving failures show a clear message without losing what the person entered.")
  }
  if (servicesText && !/\b(no|without) (outside|external|third-party) services?\b/i.test(servicesText)) {
    assumptions.push("Outside-service credentials are kept out of user-visible code.")
  }
  if (/\baccessib/i.test(prioritiesText)) {
    assumptions.push("Important screens and actions remain usable with a keyboard and clear labels.")
  }
  if (riskLevel === "high") {
    assumptions.push("An experienced engineer must review the high-risk areas before implementation.")
  }

  return { riskLevel, assumptions: Array.from(new Set(assumptions)) }
  } catch {
    return { riskLevel: "low" as const, assumptions: [] }
  }
}

function buildProjectPlanningNfrSectionBody(intakeFields: ProjectPlanningIntakeFields) {
  try {
  const accessText = normalizeNfrText(intakeFields.accessAndRoles)
  const dataText = normalizeNfrText(intakeFields.dataAndSensitivity)
  const servicesText = normalizeNfrText(intakeFields.deploymentAndServices)
  const prioritiesText = normalizeNfrText(intakeFields.qualityPriorities)
  if (!accessText && !dataText && !servicesText && !prioritiesText) return "Not yet specified"

  const profile = deriveProjectPlanningNfrProfile(intakeFields)
  const sections: string[] = []
  const addSection = (title: string, value: string) => {
    const normalized = normalizeNfrText(value)
    if (normalized) sections.push(`${title}\n- ${normalized}`)
  }

  if (accessText) addSection("Access and permissions", accessText)
  if (dataText) addSection("Data handling and privacy", dataText)
  if (profile.riskLevel !== "low") {
    addSection(
      "Validation and error handling",
      "Check sign-in and saved information before accepting it, and show clear errors without losing entered information."
    )
  }
  if (servicesText) addSection("Deployment and outside services", servicesText)
  if (prioritiesText) addSection("Quality priorities", prioritiesText)
  if (profile.assumptions.length) {
    sections.push(`Confirmed assumptions\n${profile.assumptions.map((item) => `- ${item}`).join("\n")}`)
  }
  if (profile.riskLevel === "high") {
    sections.push("Project risk\n- High-risk — Phase 4 must require experienced-engineer review before implementation.")
  }

  return sections.join("\n\n") || "Not yet specified"
  } catch {
    return "Not yet specified"
  }
}

export function buildProjectPlanningIntakeFields(input: {
  description: string
  answerState: Record<string, string | string[]>
}): ProjectPlanningIntakeFields {
  return {
    appIdea: input.description.trim(),
    targetUsers: answerTextValue(input.answerState.intake_target_user),
    problem: answerTextValue(input.answerState.intake_problem),
    firstVersion: answerTextValue(input.answerState.intake_first_version),
    skipForNow: answerTextValue(input.answerState.intake_skip_now),
    anythingElse: answerTextValue(input.answerState.intake_anything_else),
    accessAndRoles: answerTextValue(input.answerState.intake_nfr_access_and_roles),
    dataAndSensitivity: answerTextValue(input.answerState.intake_nfr_data_and_sensitivity),
    deploymentAndServices: answerTextValue(input.answerState.intake_nfr_deployment_and_services),
    qualityPriorities: answerTextValue(input.answerState.intake_nfr_quality_priorities)
  }
}

export function buildProjectPlanningIntakeDebugStatus(intakeFields: ProjectPlanningIntakeFields | null) {
  const fields = intakeFields ?? {
    appIdea: "",
    targetUsers: "",
    problem: "",
    firstVersion: "",
    skipForNow: "",
    anythingElse: "",
    accessAndRoles: "",
    dataAndSensitivity: "",
    deploymentAndServices: "",
    qualityPriorities: ""
  }

  return [
    ["appIdea", fields.appIdea],
    ["targetUsers", fields.targetUsers],
    ["problem", fields.problem],
    ["firstVersion", fields.firstVersion],
    ["skipForNow", fields.skipForNow],
    ["anythingElse", fields.anythingElse],
    ["accessAndRoles", fields.accessAndRoles ?? ""],
    ["dataAndSensitivity", fields.dataAndSensitivity ?? ""],
    ["deploymentAndServices", fields.deploymentAndServices ?? ""],
    ["qualityPriorities", fields.qualityPriorities ?? ""]
  ].map(([name, value]) => {
    const normalized = String(value).trim()
    return {
      name,
      filled: Boolean(normalized),
      length: normalized.length
    }
  })
}

const CRITERIA_TITLES: Record<ProjectPlanningCriteriaKey, string> = {
  problem: "Problem",
  target_user: "Target user",
  goal_outcome: "Goal / outcome",
  scope: "Scope",
  core_requirements: "Core requirements",
  non_goals: "Non-goals",
  constraints: "Constraints",
  success_criteria: "Success criteria",
  assumptions_risks: "Assumptions / risks"
}

const CRITERIA_ORDER: ProjectPlanningCriteriaKey[] = [
  "problem",
  "target_user",
  "goal_outcome",
  "scope",
  "core_requirements",
  "non_goals",
  "constraints",
  "success_criteria",
  "assumptions_risks"
]

export function createEmptyProjectPlanningState(description = ""): ProjectPlanningState {
  return {
    phase: "intake",
    description,
    coverageReport: null,
    prdSnapshot: null,
    questions: [],
    activeQuestionIndex: 0,
    answerState: {},
    otherAnswerState: {},
    generatedPrd: null,
    completed: false
  }
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeSentence(value: string) {
  const trimmed = normalizeWhitespace(value)
  if (!trimmed) return ""
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

function splitSentences(description: string) {
  return description
    .split(/[\n\r]+|(?<=[.!?])\s+/)
    .map((sentence) => normalizeWhitespace(sentence))
    .filter(Boolean)
}

function sentenceMatches(sentence: string, patterns: RegExp[]) {
  const normalized = sentence.toLowerCase()
  return patterns.some((pattern) => pattern.test(normalized))
}

function collectEvidence(sentences: string[], patterns: RegExp[], limit = 2) {
  return sentences.filter((sentence) => sentenceMatches(sentence, patterns)).slice(0, limit)
}

function inferStatus(evidenceCount: number) {
  if (evidenceCount >= 2) return "present" as const
  if (evidenceCount === 1) return "partial" as const
  return "missing" as const
}

function joinEvidence(evidence: string[]) {
  return evidence.map((sentence) => normalizeSentence(sentence)).join(" ")
}

function buildBucket(
  key: ProjectPlanningCriteriaKey,
  evidence: string[],
  fallback: string,
  conflict = false
): ProjectPlanningCriteriaBucket {
  const status = conflict ? "conflicting" : inferStatus(evidence.length)
  const confidence =
    status === "present" ? 0.9 : status === "partial" ? 0.62 : status === "conflicting" ? 0.38 : 0.1

  return {
    key,
    title: CRITERIA_TITLES[key],
    status,
    confidence,
    evidenceSnippets: evidence,
    resolvedValue: evidence.length ? joinEvidence(evidence) : fallback
  }
}

function detectScopeConflict(description: string) {
  const normalized = description.toLowerCase()
  const narrow = /\bmvp\b|\bfirst version\b|\bnarrow\b|\bsmall\b|\bcore flow\b|\bphase 1\b|\bstart with\b|\bonly\b/.test(normalized)
  const broad = /\bcomplete platform\b|\bfull platform\b|\beverything\b|\bfull suite\b|\ball-in-one\b|\bmultiple major workflows\b|\badmin dashboard\b/.test(normalized)
  return narrow && broad
}

function detectTargetConflict(description: string) {
  const normalized = description.toLowerCase()
  const internal = /\binternal\b|\bops\b|\boperator\b|\bteam\b|\bstaff\b/.test(normalized)
  const external = /\bcustomer\b|\bclient\b|\buser\b|\bconsumer\b|\bbuyer\b/.test(normalized)
  return internal && external
}

export function analyzeProjectDescription(description: string): ProjectPlanningCoverageReport {
  const sentences = splitSentences(description)
  const normalized = description.toLowerCase()

  const bucketMap: Record<ProjectPlanningCriteriaKey, ProjectPlanningCriteriaBucket> = {
    problem: buildBucket(
      "problem",
      collectEvidence(sentences, [
        /\bproblem\b/,
        /\bneed(s)?\b/,
        /\bpain\b/,
        /\bfriction\b/,
        /\bstruggle\b/,
        /\bwithout\b/,
        /\bsolves?\b/
      ]),
      "The product problem still needs to be clarified."
    ),
    target_user: buildBucket(
      "target_user",
      collectEvidence(sentences, [
        /\bfor\b.+\b(user|customer|team|admin|operator|student|seller|buyer|client)s?\b/,
        /\btarget user\b/,
        /\baudience\b/,
        /\bcustomer(s)?\b/,
        /\bteam\b/,
        /\badmin(s)?\b/
      ]),
      "The primary user for the first version still needs to be clarified.",
      detectTargetConflict(description)
    ),
    goal_outcome: buildBucket(
      "goal_outcome",
      collectEvidence(sentences, [
        /\bshould\b/,
        /\bgoal\b/,
        /\ballow\b/,
        /\benable\b/,
        /\blet users\b/,
        /\bimprove\b/,
        /\breduce\b/,
        /\bmake sure\b/
      ]),
      "The primary outcome still needs to be clarified."
    ),
    scope: buildBucket(
      "scope",
      collectEvidence(sentences, [
        /\bfirst version\b/,
        /\bmvp\b/,
        /\bphase 1\b/,
        /\bstart with\b/,
        /\bonly\b/,
        /\bjust\b/,
        /\bfor now\b/,
        /\binitial release\b/
      ]),
      "The first-release scope still needs to be clarified.",
      detectScopeConflict(description)
    ),
    core_requirements: buildBucket(
      "core_requirements",
      collectEvidence(sentences, [
        /\binclude\b/,
        /\bcapture\b/,
        /\bsupport\b/,
        /\ballow users to\b/,
        /\bmust\b/,
        /\bworkflow\b/,
        /\bregistration\b/,
        /\bpayment\b/,
        /\bdashboard\b/
      ], 3),
      "The must-have requirements still need to be clarified."
    ),
    non_goals: buildBucket(
      "non_goals",
      collectEvidence(sentences, [
        /\bnon-goal\b/,
        /\bout of scope\b/,
        /\bnot for now\b/,
        /\bdo not\b/,
        /\bavoid\b/,
        /\bwon't\b/,
        /\bshould not\b/
      ]),
      "The first-version non-goals still need to be clarified."
    ),
    constraints: buildBucket(
      "constraints",
      collectEvidence(sentences, [
        /\bconstraint\b/,
        /\bexisting architecture\b/,
        /\bmust use\b/,
        /\bpreserve\b/,
        /\bdeadline\b/,
        /\bbudget\b/,
        /\bplatform\b/,
        /\bonly\b.+\b(web|mobile|extension|chrome)\b/
      ]),
      "The important delivery constraints still need to be clarified."
    ),
    success_criteria: buildBucket(
      "success_criteria",
      collectEvidence(sentences, [
        /\bsuccess\b/,
        /\bdone when\b/,
        /\bshould be able to\b/,
        /\bworks when\b/,
        /\bconfirmed by\b/,
        /\bcomplete the task\b/,
        /\bvalidated\b/
      ]),
      "The success criteria still need to be clarified."
    ),
    assumptions_risks: buildBucket(
      "assumptions_risks",
      collectEvidence(sentences, [
        /\bassumption\b/,
        /\brisk\b/,
        /\bunknown\b/,
        /\bdepends on\b/,
        /\bopen question\b/,
        /\bmaybe\b/,
        /\bmight\b/
      ]),
      "No explicit assumptions or risks were captured yet."
    )
  }

  if (normalized.length < 120) {
    for (const key of ["problem", "goal_outcome", "core_requirements"] as ProjectPlanningCriteriaKey[]) {
      const bucket = bucketMap[key]
      if (bucket.status === "present") {
        bucket.status = "partial"
        bucket.confidence = Math.min(bucket.confidence, 0.58)
      }
    }
  }

  const buckets = CRITERIA_ORDER.map((key) => bucketMap[key])
  return {
    buckets,
    summary: {
      present: buckets.filter((bucket) => bucket.status === "present").length,
      partial: buckets.filter((bucket) => bucket.status === "partial").length,
      missing: buckets.filter((bucket) => bucket.status === "missing").length,
      conflicting: buckets.filter((bucket) => bucket.status === "conflicting").length
    }
  }
}

function buildQuestionForBucket(bucket: ProjectPlanningCriteriaBucket): ProjectPlanningQuestion {
  const conflictPrefix =
    bucket.status === "conflicting"
      ? "The description currently points in two directions. Resolve the conflict before we draft the PRD."
      : "This area is still weak or missing. Tighten it before we draft the PRD."

  switch (bucket.key) {
    case "problem":
      return {
        id: `planning-${bucket.key}`,
        criterion: bucket.key,
        fillsSections: [bucket.key],
        label: "What problem is this first version solving most directly?",
        helper: conflictPrefix,
        mode: "single",
        options: [
          "Users cannot complete the main task clearly",
          "The current flow feels incomplete or confusing",
          "Important information is missing in the experience",
          "The current process is too manual or easy to forget",
          PROJECT_PLANNING_OTHER_OPTION
        ]
      }
    case "target_user":
      return {
        id: `planning-${bucket.key}`,
        criterion: bucket.key,
        fillsSections: [bucket.key],
        label: "Who is the first version mainly for?",
        helper: conflictPrefix,
        mode: "single",
        options: ["New customers", "Existing customers", "Internal team", "Admins / operators", PROJECT_PLANNING_OTHER_OPTION]
      }
    case "goal_outcome":
      return {
        id: `planning-${bucket.key}`,
        criterion: bucket.key,
        fillsSections: [bucket.key],
        label: "What should the first release help users accomplish?",
        helper: conflictPrefix,
        mode: "single",
        options: [
          "Complete the main task end to end",
          "Feel clear and confident using the flow",
          "Get timely reminders or feedback",
          "Save time compared with the current way",
          PROJECT_PLANNING_OTHER_OPTION
        ]
      }
    case "scope":
      return {
        id: `planning-${bucket.key}`,
        criterion: bucket.key,
        fillsSections: [bucket.key],
        label: "How wide should the first release scope be?",
        helper: conflictPrefix,
        mode: "single",
        options: ["One narrow core flow", "One polished first release", "A broader end-to-end MVP", PROJECT_PLANNING_OTHER_OPTION]
      }
    case "core_requirements":
      return {
        id: `planning-${bucket.key}`,
        criterion: bucket.key,
        fillsSections: [bucket.key],
        label: "What must the first version include?",
        helper: conflictPrefix,
        mode: "multi",
        options: [
          "Core user flow",
          "Clear input form or controls",
          "Saved data or persistence",
          "Validation or error states",
          "Simple reminders or notifications",
          PROJECT_PLANNING_OTHER_OPTION
        ]
      }
    case "non_goals":
      return {
        id: `planning-${bucket.key}`,
        criterion: bucket.key,
        fillsSections: [bucket.key],
        label: "What should stay out of scope for now?",
        helper: conflictPrefix,
        mode: "multi",
        options: [
          "No advanced analytics",
          "No team or collaboration features",
          "No admin dashboard",
          "No mobile app",
          "No extra polish beyond the core flow",
          PROJECT_PLANNING_OTHER_OPTION
        ]
      }
    case "constraints":
      return {
        id: `planning-${bucket.key}`,
        criterion: bucket.key,
        fillsSections: [bucket.key],
        label: "What build constraints should this first version respect?",
        helper: conflictPrefix,
        mode: "multi",
        options: [
          "Keep the stack simple and easy for an AI builder to work with",
          "Avoid paid services or keep costs very low",
          "Prefer web first before mobile or desktop",
          "Avoid complex custom backend work unless truly needed",
          "Use built-in or low-setup tools where possible",
          "Ship the fastest credible prototype first",
          PROJECT_PLANNING_OTHER_OPTION
        ]
      }
    case "success_criteria":
      return {
        id: `planning-${bucket.key}`,
        criterion: bucket.key,
        fillsSections: [bucket.key],
        label: "What must be true for this first release to feel successful?",
        helper: conflictPrefix,
        mode: "multi",
        options: [
          "Core flow feels clear",
          "Users can complete the task end to end",
          "Validation and error handling feel solid",
          "The UI feels polished and trustworthy",
          PROJECT_PLANNING_OTHER_OPTION
        ]
      }
    case "assumptions_risks":
      return {
        id: `planning-${bucket.key}`,
        criterion: bucket.key,
        fillsSections: [bucket.key],
        label: "What assumptions or risks should the PRD call out?",
        helper: conflictPrefix,
        mode: "multi",
        options: [
          "The current backend may need changes",
          "Validation rules are still unclear",
          "Users may expect more scope than we want in v1",
          "The reminder or notification flow may need testing",
          PROJECT_PLANNING_OTHER_OPTION
        ]
      }
  }
}

export function buildPlanningQuestionsFromCoverage(report: ProjectPlanningCoverageReport) {
  const prioritized = [...report.buckets].sort((left, right) => {
    const rank = (status: ProjectPlanningCriteriaStatus) =>
      status === "conflicting" ? 0 : status === "missing" ? 1 : status === "partial" ? 2 : 3

    return rank(left.status) - rank(right.status)
  })

  const conflicting = prioritized.filter((bucket) => bucket.status === "conflicting")
  const missing = prioritized.filter((bucket) => bucket.status === "missing")
  const partial = prioritized.filter((bucket) => bucket.status === "partial")

  const selected: ProjectPlanningCriteriaBucket[] = [...conflicting, ...missing]
  const targetQuestionCount =
    report.summary.present >= 4 ? 3 : report.summary.present >= 2 ? 4 : 5

  for (const bucket of partial) {
    if (selected.length >= targetQuestionCount) break
    selected.push(bucket)
  }

  return selected.slice(0, 5).map((bucket) => buildQuestionForBucket(bucket))
}

export function buildVisiblePlanningOptions(options: string[] | undefined) {
  const normalized = (options ?? []).map((option) => option.trim()).filter(Boolean)
  return [...normalized.filter((option) => option !== PROJECT_PLANNING_OTHER_OPTION), PROJECT_PLANNING_OTHER_OPTION]
}

export function includesPlanningOption(value: string | string[], option: string) {
  return Array.isArray(value) ? value.includes(option) : value === option
}

export function hasAnsweredPlanningQuestion(
  question: ProjectPlanningQuestion,
  answerState: Record<string, string | string[]>,
  otherAnswerState: Record<string, string>
) {
  const value = answerState[question.id]
  const otherValue = otherAnswerState[question.id]?.trim() ?? ""

  if (question.mode === "freeform") {
    return typeof value === "string" && value.trim().length > 0
  }

  if (Array.isArray(value)) {
    return value.length > 0 && (!value.includes(PROJECT_PLANNING_OTHER_OPTION) || Boolean(otherValue))
  }

  if (typeof value !== "string" || !value.trim()) return false
  return value !== PROJECT_PLANNING_OTHER_OPTION || Boolean(otherValue)
}

export function resolvePlanningAnswer(
  question: ProjectPlanningQuestion,
  answerState: Record<string, string | string[]>,
  otherAnswerState: Record<string, string>
) {
  const raw = answerState[question.id]
  const otherValue = otherAnswerState[question.id]?.trim() ?? ""

  if (question.mode === "freeform") {
    return typeof raw === "string" ? normalizeSentence(raw) : ""
  }

  if (Array.isArray(raw)) {
    return raw
      .map((value) => (value === PROJECT_PLANNING_OTHER_OPTION ? normalizeSentence(otherValue) : value))
      .filter(Boolean)
  }

  if (typeof raw !== "string") return ""
  return raw === PROJECT_PLANNING_OTHER_OPTION ? normalizeSentence(otherValue) : raw
}

function formatBulletList(items: string[]) {
  return items.length
    ? items.map((item) => `- ${normalizeSentence(item)}`).join("\n")
    : "- Needs clarification."
}

function formatSectionValue(value: string | string[]) {
  if (Array.isArray(value)) return formatBulletList(value)
  return normalizeSentence(value) || "Needs clarification."
}

function normalizeSuccessCriteriaValue(value: string | string[]) {
  if (Array.isArray(value)) {
    return formatBulletList(
      value.map((item) =>
        /^(the|users|core flow|validation|the ui)/i.test(item) ? item : `The first version should ensure ${item.toLowerCase()}`
      )
    )
  }
  return formatSectionValue(value)
}

function buildAnswerMap(
  questions: ProjectPlanningQuestion[],
  answerState: Record<string, string | string[]>,
  otherAnswerState: Record<string, string>
) {
  const answerMap = new Map<ProjectPlanningCriteriaKey, string | string[]>()

  for (const question of questions) {
    const answer = resolvePlanningAnswer(question, answerState, otherAnswerState)
    if (Array.isArray(answer) ? !answer.length : !answer.trim()) continue

    const sections = question.fillsSections?.length ? question.fillsSections : [question.criterion]
    for (const section of sections) {
      if (!answerMap.has(section)) {
        answerMap.set(section, answer)
      }
    }
  }

  return answerMap
}

function getBucketValue(
  bucket: ProjectPlanningCriteriaBucket,
  answerMap: Map<ProjectPlanningCriteriaKey, string | string[]>
) {
  const answeredValue = answerMap.get(bucket.key)
  if (Array.isArray(answeredValue)) return answeredValue
  if (typeof answeredValue === "string" && answeredValue.trim()) return answeredValue
  return bucket.resolvedValue
}

export function buildGeneratedPrdDraft(input: {
  projectLabel: string
  description: string
  coverageReport: ProjectPlanningCoverageReport
  prdSnapshot?: ProjectPlanningPrdSnapshot | null
  questions: ProjectPlanningQuestion[]
  answerState: Record<string, string | string[]>
  otherAnswerState: Record<string, string>
}): GeneratedPrdDraft {
  const intakeFields = buildProjectPlanningIntakeFields({
    description: input.description,
    answerState: input.answerState
  })
  const nonFunctionalRequirements = buildProjectPlanningNfrSectionBody(intakeFields)
  const answerMap = buildAnswerMap(input.questions, input.answerState, input.otherAnswerState)
  const bucketMap = new Map(input.coverageReport.buckets.map((bucket) => [bucket.key, bucket]))

  const problem = formatSectionValue(getBucketValue(bucketMap.get("problem")!, answerMap))
  const targetUser = formatSectionValue(getBucketValue(bucketMap.get("target_user")!, answerMap))
  const goal = formatSectionValue(getBucketValue(bucketMap.get("goal_outcome")!, answerMap))
  const scope = formatSectionValue(getBucketValue(bucketMap.get("scope")!, answerMap))
  const requirements = formatSectionValue(getBucketValue(bucketMap.get("core_requirements")!, answerMap))
  const nonGoals = formatSectionValue(getBucketValue(bucketMap.get("non_goals")!, answerMap))
  const constraints = formatSectionValue(getBucketValue(bucketMap.get("constraints")!, answerMap))
  const successCriteria = normalizeSuccessCriteriaValue(getBucketValue(bucketMap.get("success_criteria")!, answerMap))
  const assumptionsAndRisks = formatSectionValue(getBucketValue(bucketMap.get("assumptions_risks")!, answerMap))
  const implementationPhases: GeneratedPrdPhase[] = [
    {
      id: "phase_1",
      title: "Phase 1 — Core foundation",
      goal: "Set up the smallest complete foundation for the first-release workflow.",
      buildScope: ["Create the core state/data shape for the first-release workflow", "Wire the minimum start-to-finish happy path"],
      outOfScope: ["Avoid later-phase polish, analytics, and optional integrations"],
      dataState: ["First-release entities, statuses, and persisted values needed by the core flow"],
      deliverables: [
        "Core data or state needed for the first-release flow",
        "Basic workflow structure for the main experience",
        "No unrelated scope beyond the first-release requirements"
      ],
      acceptanceCriteria: [
        "The project has the core foundation required for the main workflow",
        "The work stays inside the agreed first-release scope",
        "No later-phase polish or extras are started yet"
      ],
      validationProof: ["Show the core workflow can be started and the saved state updates correctly"]
    },
    {
      id: "phase_2",
      title: "Phase 2 — Main user flow",
      goal: "Build the primary user-facing flow described in the PRD.",
      buildScope: ["Implement the main screens and actions required by the MVP", "Connect user actions to the core state from Phase 1"],
      outOfScope: ["Avoid history, reporting, or advanced settings unless listed in Phase 2"],
      dataState: ["User-facing state transitions for the primary flow"],
      deliverables: [
        "Main user interaction flow",
        "Core happy-path behavior",
        "User-facing content or controls required for the first release"
      ],
      acceptanceCriteria: [
        "A user can complete the main flow end to end",
        "The behavior matches the PRD requirements",
        "The phase is validated before any later-phase work begins"
      ],
      validationProof: ["Show the happy path working end to end against the PRD requirements"]
    },
    {
      id: "phase_3",
      title: "Phase 3 — Validation and finish",
      goal: "Tighten quality, edge cases, and proof against the PRD criteria.",
      buildScope: ["Add validation, edge-case handling, and readiness checks", "Verify the MVP against the saved success criteria"],
      outOfScope: ["Avoid new product scope beyond the approved PRD"],
      dataState: ["Validation states, empty states, and edge-case state handling"],
      deliverables: [
        "Validation or error handling",
        "Important edge-case coverage",
        "Concrete verification against the success criteria"
      ],
      acceptanceCriteria: [
        "The saved success criteria are explicitly checked",
        "The implementation is validated with concrete proof",
        "The product feels ready for the first-release use case"
      ],
      validationProof: ["List tests, screenshots, or manual checks proving each success criterion"]
    }
  ]
  const implementationPhasesSection = implementationPhases
    .map((phase) => `- ${phase.title}: ${normalizeSentence(phase.goal)}`)
    .join("\n")

  const draftBase: Omit<GeneratedPrdDraft, "submissionPrompt"> = {
    title: `${input.projectLabel || "Project"} PRD draft`,
    summary:
      input.coverageReport.summary.conflicting > 0
        ? "This PRD draft still contains areas that needed conflict resolution and should be reviewed carefully before saving."
        : "This PRD draft is built from the product description plus the missing or weak planning areas that were clarified.",
    sections: [
      {
        id: "overview",
        title: "Product Overview",
        body: normalizeSentence(input.description) || "Needs clarification."
      },
      {
        id: "problem",
        title: "Problem",
        body: problem
      },
      {
        id: "target-user",
        title: "Target User",
        body: targetUser
      },
      {
        id: "goal",
        title: "Primary Goal",
        body: goal
      },
      {
        id: "scope",
        title: "Scope",
        body: scope
      },
      {
        id: "requirements",
        title: "Core Requirements",
        body: requirements
      },
      {
        id: "non-goals",
        title: "Non-Goals",
        body: nonGoals
      },
      {
        id: "constraints",
        title: "Constraints",
        body: constraints
      },
      {
        id: "success",
        title: "Success Criteria",
        body: successCriteria
      },
      {
        id: "non-functional-requirements",
        title: "Non-Functional Requirements",
        body: nonFunctionalRequirements
      },
      {
        id: "implementation-phases",
        title: "Implementation Phases",
        body: implementationPhasesSection
      },
      {
        id: "assumptions-risks",
        title: "Assumptions / Risks",
        body: assumptionsAndRisks
      },
      {
        id: "implementation-handoff",
        title: "Implementation Handoff",
        body: buildProjectPlanningImplementationHandoffBody()
      }
    ],
    implementationPhases
  }

  return {
    ...draftBase,
    submissionPrompt: buildProjectPlanningSubmissionPrompt(draftBase)
  }
}

export function buildProjectPlanningImplementationHandoffBody() {
  return [
    "- Implement Phase 1 only in the first assistant response.",
    "- Do not start Phase 2 until Phase 1 is finished and validated against its acceptance criteria.",
    "- After finishing Phase 1, explain what changed and show concrete implementation validation proof.",
    "- Treat real-user studies, cohort metrics, public beta/app-store release, business reports, and stakeholder approvals as external validation or release work, not as coding deliverables.",
    "- Wait for the user's confirmation before starting the next phase."
  ].join("\n")
}

export function buildProjectPlanningSubmissionPrompt(
  draft: Pick<GeneratedPrdDraft, "title" | "summary" | "sections" | "implementationPhases">
) {
  const renderList = (label: string, items: string[]) =>
    items.length ? `${label}:\n${items.map((item) => `- ${normalizeListItem(item)}`).join("\n")}` : ""
  const prdSections = draft.sections.filter((section) => section.id !== "implementation-handoff")
  const handoffBody =
    draft.sections.find((section) => section.id === "implementation-handoff")?.body.trim() ||
    buildProjectPlanningImplementationHandoffBody()
  const renderedPrdSections = prdSections
    .map((section) => `${section.title}\n${section.body.trim()}`)
    .join("\n\n")

  const renderedPhases = draft.implementationPhases
    .map(
      (phase) =>
        [
          phase.title,
          `Goal: ${normalizeSentence(phase.goal)}`,
          renderList("Build scope", phase.buildScope),
          renderList("Out of scope for this phase", phase.outOfScope),
          renderList("Data/state needed", phase.dataState),
          renderList("Implementation deliverables", phase.deliverables),
          renderList("Implementation acceptance criteria", phase.acceptanceCriteria),
          renderList("Implementation validation proof expected", phase.validationProof)
        ].filter(Boolean).join("\n")
    )
    .join("\n\n")

  return [
    "Implement this PRD one phase at a time.",
    "",
    draft.title.trim(),
    normalizeSentence(draft.summary),
    "",
    "PRD",
    renderedPrdSections,
    "",
    "Implementation phases",
    renderedPhases,
    "",
    "Implementation handoff",
    handoffBody
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim()
}

function getSectionBody(draft: GeneratedPrdDraft, id: string) {
  return draft.sections.find((section) => section.id === id)?.body.trim() ?? ""
}

function extractBulletItems(text: string) {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean)
}

function extractExplicitBulletItems(text: string) {
  return text
    .split(/\n+/)
    .filter((line) => /^\s*-\s+/.test(line))
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean)
}

function uniqueItems(values: Array<string | null | undefined>, limit = Number.POSITIVE_INFINITY) {
  const seen = new Set<string>()
  const items: string[] = []

  for (const raw of values) {
    const value = normalizeWhitespace(raw ?? "")
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    items.push(value)
    if (items.length >= limit) break
  }

  return items
}

function bulletSection(items: string[]) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "-"
}

function ensureBulletSection(body: string) {
  const items = extractBulletItems(body)
  return bulletSection(items.length ? items : [normalizeSentence(body) || "Needs clarification."])
}

function renderImplementationPhases(phases: GeneratedPrdPhase[]) {
  if (!phases.length) return "-"
  const renderList = (label: string, items: string[]) =>
    items.length ? `${label}:\n${items.map((item) => `- ${normalizeListItem(item)}`).join("\n")}` : ""

  return phases
    .map(
      (phase) =>
        [
          phase.title.trim(),
          phase.goal.trim() ? `Goal: ${normalizeSentence(phase.goal)}` : "",
          renderList("Build scope", phase.buildScope),
          renderList("Out of scope for this phase", phase.outOfScope),
          renderList("Data/state needed", phase.dataState),
          renderList("Implementation deliverables", phase.deliverables),
          renderList("Implementation Acceptance Criteria", phase.acceptanceCriteria),
          renderList("Implementation validation proof expected", phase.validationProof)
        ]
          .filter(Boolean)
          .join("\n")
    )
    .join("\n\n")
}

export function buildProjectPlanningContextPayload(draft: GeneratedPrdDraft): ProjectPlanningContextPayload {
  const overview = getSectionBody(draft, "overview")
  const problem = getSectionBody(draft, "problem")
  const targetUser = getSectionBody(draft, "target-user")
  const goal = getSectionBody(draft, "goal")
  const scope = getSectionBody(draft, "scope")
  const requirements = getSectionBody(draft, "requirements")
  const nonGoals = getSectionBody(draft, "non-goals")
  const constraints = getSectionBody(draft, "constraints")
  const nonFunctionalRequirements = getSectionBody(draft, "non-functional-requirements")
  const successCriteria = getSectionBody(draft, "success")
  const implementationPhases = getSectionBody(draft, "implementation-phases")
  const assumptionsAndRisks = getSectionBody(draft, "assumptions-risks")
  const renderedImplementationPhases = renderImplementationPhases(draft.implementationPhases)

  const stableConstraints = uniqueItems([
    ...extractBulletItems(constraints),
    ...extractExplicitBulletItems(nonFunctionalRequirements).filter((item) => item !== "Not yet specified"),
    ...extractBulletItems(successCriteria)
  ], 10)

  const protectedAreas = uniqueItems([
    ...extractBulletItems(nonGoals),
    ...extractBulletItems(constraints).filter((item) => /\bpreserve\b|\bavoid\b|\bdo not\b|\bmust not\b/i.test(item))
  ], 10)

  const acceptedAssumptions = uniqueItems(extractBulletItems(assumptionsAndRisks), 8)

  const projectContext = [
    "## Product Overview",
    bulletSection([
      normalizeSentence(overview),
      normalizeSentence(problem),
      normalizeSentence(targetUser),
      normalizeSentence(goal),
      normalizeSentence(scope)
    ].filter(Boolean)),
    "",
    "## Core Requirements",
    ensureBulletSection(requirements),
    "",
    "## Constraints",
    ensureBulletSection(constraints),
    "",
    "## Non-Functional Requirements",
    nonFunctionalRequirements.trim() || "Not yet specified",
    "",
    "## User Intent To Preserve",
    ensureBulletSection(nonGoals),
    "",
    "## Definition Of Done",
    ensureBulletSection(successCriteria),
    "",
    "## Implementation Phases",
    implementationPhases.trim() || "-",
    "",
    renderedImplementationPhases
  ].join("\n").trim()

  const currentState = [
    "## Current State",
    bulletSection([
      "This project context was created from the Project Planning flow.",
      "The project is currently in the planning phase with a reviewed PRD draft.",
      normalizeSentence(goal) ? `Current focus: ${normalizeSentence(goal)}` : "",
      "Best next step: implement the first version within the saved scope and constraints."
    ].filter(Boolean)),
    "",
    "## Assumptions / Risks",
    ensureBulletSection(assumptionsAndRisks)
  ].join("\n").trim()

  const rawMarkdown = [
    "# Project Overview",
    bulletSection([
      normalizeSentence(overview),
      normalizeSentence(problem),
      normalizeSentence(targetUser),
      normalizeSentence(goal),
      normalizeSentence(scope)
    ].filter(Boolean)),
    "",
    "# Constraints",
    ensureBulletSection(constraints),
    "",
    "# Non-Functional Requirements",
    nonFunctionalRequirements.trim() || "Not yet specified",
    "",
    "# User Intent To Preserve",
    ensureBulletSection(nonGoals),
    "",
    "# Definition Of Done",
    ensureBulletSection(successCriteria),
    "",
    "# Implementation Phases",
    implementationPhases.trim() || "-",
    "",
    renderedImplementationPhases,
    "",
    "# Current State",
    bulletSection([
      "This project context was created from the Project Planning flow.",
      "The project is currently in the planning phase with a reviewed PRD draft.",
      normalizeSentence(goal) ? `Current focus: ${normalizeSentence(goal)}` : "",
      "Best next step: implement the first version within the saved scope and constraints."
    ].filter(Boolean)),
    "",
    "# Assumptions / Risks",
    ensureBulletSection(assumptionsAndRisks)
  ].join("\n").trim()

  return {
    rawMarkdown,
    projectContext,
    currentState,
    structuredMemory: {
      stableConstraints,
      protectedAreas,
      acceptedAssumptions,
      currentFeatureArea: normalizeSentence(goal) || normalizeSentence(overview)
    }
  }
}
