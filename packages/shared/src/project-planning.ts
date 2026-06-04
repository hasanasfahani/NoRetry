import * as z from "zod"

export const PROJECT_PLANNING_PROVIDER_TIMEOUT_MS = 12_000
export const PROJECT_PLANNING_CLIENT_TIMEOUT_MS = 18_000
export const PROJECT_PLANNING_DRAFT_PROVIDER_TIMEOUT_MS = 28_000
export const PROJECT_PLANNING_DRAFT_CLIENT_TIMEOUT_MS = 32_000

export const ProjectPlanningCriteriaKeySchema = z.enum([
  "problem",
  "target_user",
  "goal_outcome",
  "scope",
  "core_requirements",
  "non_goals",
  "constraints",
  "success_criteria",
  "assumptions_risks"
])

export const ProjectPlanningSectionKeySchema = ProjectPlanningCriteriaKeySchema
export const ProjectPlanningCriteriaStatusSchema = z.enum(["present", "partial", "missing", "conflicting"])
export const ProjectPlanningPrdSectionStatusSchema = z.enum(["filled", "partial", "missing"])
export const ProjectPlanningQuestionModeSchema = z.enum(["single", "multi", "freeform"])

function parseProjectPlanningSectionKey(value: unknown) {
  const parsed = ProjectPlanningSectionKeySchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

const PROJECT_PLANNING_SECTION_KEYS = ProjectPlanningSectionKeySchema.options

export const ProjectPlanningQuestionSchema = z.object({
  id: z.string(),
  criterion: z.string().optional(),
  fillsSections: z.array(z.string()).max(4).optional(),
  label: z.string(),
  helper: z.string(),
  mode: ProjectPlanningQuestionModeSchema,
  options: z.array(z.string()).max(7).optional(),
  placeholder: z.string().optional()
}).transform((question) => {
  const normalizedFillsSections = (question.fillsSections ?? [])
    .map(parseProjectPlanningSectionKey)
    .filter((value): value is ProjectPlanningSectionKey => Boolean(value))

  const legacyCriterion = parseProjectPlanningSectionKey(question.criterion)
  const fillsSections = normalizedFillsSections.length
    ? normalizedFillsSections
    : legacyCriterion
      ? [legacyCriterion]
      : ["core_requirements" as const]
  const criterion = fillsSections[0]

  return {
    ...question,
    criterion,
    fillsSections
  }
})

export const ProjectPlanningPrdSnapshotSectionSchema = z.object({
  status: ProjectPlanningPrdSectionStatusSchema,
  draft: z.preprocess((value) => (value == null ? "" : value), z.string()),
  missing: z.array(z.string()).max(6).default([])
})

const EmptyProjectPlanningPrdSnapshot = PROJECT_PLANNING_SECTION_KEYS.reduce(
  (snapshot, key) => ({
    ...snapshot,
    [key]: {
      status: "missing" as const,
      draft: "",
      missing: []
    }
  }),
  {} as Record<ProjectPlanningSectionKey, z.infer<typeof ProjectPlanningPrdSnapshotSectionSchema>>
)

export const ProjectPlanningPrdSnapshotSchema = z.object({
  problem: ProjectPlanningPrdSnapshotSectionSchema,
  target_user: ProjectPlanningPrdSnapshotSectionSchema,
  goal_outcome: ProjectPlanningPrdSnapshotSectionSchema,
  scope: ProjectPlanningPrdSnapshotSectionSchema,
  core_requirements: ProjectPlanningPrdSnapshotSectionSchema,
  non_goals: ProjectPlanningPrdSnapshotSectionSchema,
  constraints: ProjectPlanningPrdSnapshotSectionSchema,
  success_criteria: ProjectPlanningPrdSnapshotSectionSchema,
  assumptions_risks: ProjectPlanningPrdSnapshotSectionSchema
}).default(EmptyProjectPlanningPrdSnapshot)

export const ProjectPlanningCriteriaBucketSchema = z.object({
  key: ProjectPlanningCriteriaKeySchema,
  title: z.string(),
  status: ProjectPlanningCriteriaStatusSchema,
  confidence: z.number().min(0).max(1),
  evidenceSnippets: z.array(z.string()).max(3).default([]),
  resolvedValue: z.preprocess((value) => (value == null ? "" : value), z.string())
})

export const ProjectPlanningCoverageReportSchema = z.object({
  buckets: z.array(ProjectPlanningCriteriaBucketSchema),
  summary: z.object({
    present: z.number().int().min(0),
    partial: z.number().int().min(0),
    missing: z.number().int().min(0),
    conflicting: z.number().int().min(0)
  })
})

export const GeneratedPrdSectionSchema = z.object({
  id: z.string(),
  title: z.string().trim().min(1),
  body: z.string().trim().min(1)
})

export const GeneratedPrdPhaseSchema = z.object({
  id: z.string(),
  title: z.string().trim().min(1),
  goal: z.string().trim().min(1),
  buildScope: z.array(z.string()).max(8).default([]),
  outOfScope: z.array(z.string()).max(8).default([]),
  dataState: z.array(z.string()).max(8).default([]),
  deliverables: z.array(z.string()).max(8).default([]),
  acceptanceCriteria: z.array(z.string()).max(8).default([]),
  validationProof: z.array(z.string()).max(8).default([])
})

export const GeneratedPrdDraftSchema = z.object({
  title: z.string(),
  summary: z.string(),
  sections: z.array(GeneratedPrdSectionSchema).min(8).max(16),
  implementationPhases: z.array(GeneratedPrdPhaseSchema).min(2).max(6),
  submissionPrompt: z.string()
})

export const ProjectPlanningDiagnosticsSchema = z.object({
  aiAvailable: z.boolean(),
  fallbackUsed: z.boolean(),
  providerName: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
  descriptionPreview: z.string().optional(),
  descriptionHash: z.string().optional(),
  projectLabel: z.string().optional(),
  promptKind: z.enum(["requirements", "prd_draft"]).optional(),
  malformedJson: z.boolean().optional(),
  repairAttempted: z.boolean().optional(),
  repairSucceeded: z.boolean().optional(),
  errorReason: z.string().optional(),
  outputQualityStatus: z.enum(["passed", "failed", "not_checked"]),
  providerAttempts: z.array(z.object({
    providerName: z.string(),
    durationMs: z.number().int().nonnegative(),
    status: z.enum(["success", "failed", "timeout", "aborted"]),
    retryCount: z.number().int().nonnegative().optional(),
    malformedJson: z.boolean().optional(),
    repairAttempted: z.boolean().optional(),
    repairSucceeded: z.boolean().optional(),
    errorReason: z.string().optional(),
    outputQualityStatus: z.enum(["passed", "failed", "not_checked"]).default("not_checked")
  })).optional()
})

const EmptyProjectPlanningDiagnostics = {
  aiAvailable: false,
  fallbackUsed: false,
  providerName: null,
  durationMs: 0,
  outputQualityStatus: "not_checked" as const
}

export const AnalyzeProjectPlanningRequestSchema = z.object({
  projectLabel: z.string().trim().min(1).max(240),
  description: z.string().trim().min(10).max(12000)
})

export const AnalyzeProjectPlanningResponseSchema = z.object({
  coverageReport: ProjectPlanningCoverageReportSchema,
  prdSnapshot: ProjectPlanningPrdSnapshotSchema,
  questions: z.array(ProjectPlanningQuestionSchema).max(6).default([]),
  aiAvailable: z.boolean().default(false),
  diagnostics: ProjectPlanningDiagnosticsSchema.default(EmptyProjectPlanningDiagnostics)
})

export const ProjectPlanningIntakeFieldsSchema = z.object({
  appIdea: z.string().trim().max(12000).default(""),
  targetUsers: z.string().trim().max(4000).default(""),
  problem: z.string().trim().max(4000).default(""),
  firstVersion: z.string().trim().max(4000).default(""),
  skipForNow: z.string().trim().max(4000).default(""),
  anythingElse: z.string().trim().max(4000).default("")
})

export const GenerateProjectPlanningDraftRequestSchema = z.object({
  projectLabel: z.string().trim().min(1).max(240),
  description: z.string().trim().min(10).max(12000),
  intakeFields: ProjectPlanningIntakeFieldsSchema.optional(),
  coverageReport: ProjectPlanningCoverageReportSchema,
  prdSnapshot: ProjectPlanningPrdSnapshotSchema.optional(),
  questions: z.array(ProjectPlanningQuestionSchema).max(8).default([]),
  answerState: z.record(z.union([z.string(), z.array(z.string())])).default({}),
  otherAnswerState: z.record(z.string()).default({})
})

export const GenerateProjectPlanningDraftResponseSchema = z.object({
  draft: GeneratedPrdDraftSchema,
  aiAvailable: z.boolean().default(false),
  diagnostics: ProjectPlanningDiagnosticsSchema.default(EmptyProjectPlanningDiagnostics)
})

export type ProjectPlanningCriteriaKey = z.infer<typeof ProjectPlanningCriteriaKeySchema>
export type ProjectPlanningSectionKey = z.infer<typeof ProjectPlanningSectionKeySchema>
export type ProjectPlanningCriteriaStatus = z.infer<typeof ProjectPlanningCriteriaStatusSchema>
export type ProjectPlanningPrdSectionStatus = z.infer<typeof ProjectPlanningPrdSectionStatusSchema>
export type ProjectPlanningQuestionMode = z.infer<typeof ProjectPlanningQuestionModeSchema>
export type ProjectPlanningQuestionPayload = z.infer<typeof ProjectPlanningQuestionSchema>
export type ProjectPlanningPrdSnapshotSectionPayload = z.infer<typeof ProjectPlanningPrdSnapshotSectionSchema>
export type ProjectPlanningPrdSnapshotPayload = z.infer<typeof ProjectPlanningPrdSnapshotSchema>
export type ProjectPlanningCriteriaBucketPayload = z.infer<typeof ProjectPlanningCriteriaBucketSchema>
export type ProjectPlanningCoverageReportPayload = z.infer<typeof ProjectPlanningCoverageReportSchema>
export type GeneratedPrdSectionPayload = z.infer<typeof GeneratedPrdSectionSchema>
export type GeneratedPrdPhasePayload = z.infer<typeof GeneratedPrdPhaseSchema>
export type GeneratedPrdDraftPayload = z.infer<typeof GeneratedPrdDraftSchema>
export type ProjectPlanningDiagnosticsPayload = z.infer<typeof ProjectPlanningDiagnosticsSchema>
export type ProjectPlanningIntakeFieldsPayload = z.infer<typeof ProjectPlanningIntakeFieldsSchema>
export type AnalyzeProjectPlanningRequest = z.infer<typeof AnalyzeProjectPlanningRequestSchema>
export type AnalyzeProjectPlanningResponse = z.infer<typeof AnalyzeProjectPlanningResponseSchema>
export type GenerateProjectPlanningDraftRequest = z.infer<typeof GenerateProjectPlanningDraftRequestSchema>
export type GenerateProjectPlanningDraftResponse = z.infer<typeof GenerateProjectPlanningDraftResponseSchema>
