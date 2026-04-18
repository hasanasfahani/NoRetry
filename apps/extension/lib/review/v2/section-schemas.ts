import type { GoalContract } from "../../goal/types"
import type { ReviewPromptModeV2RequestType } from "./request-types"
import { resolvePromptModeV2TemplateKind } from "./request-types"

export type ReviewPromptModeV2SectionStatus = "resolved" | "partially_resolved" | "unresolved"

export type ReviewPromptModeV2QuestionMode = "single" | "multi"

export type ReviewPromptModeV2QuestionTemplate = {
  id: string
  label: string
  helper: string
  mode: ReviewPromptModeV2QuestionMode
  options?: string[]
}

export type ReviewPromptModeV2SectionSchema = {
  id: string
  label: string
  targetQuestionRange: {
    min: number
    max: number
  }
  questionTemplates: ReviewPromptModeV2QuestionTemplate[]
}

export type ReviewPromptModeV2SectionState = {
  id: string
  label: string
  targetQuestionRange: {
    min: number
    max: number
  }
  status: ReviewPromptModeV2SectionStatus
  askedCount: number
  resolvedSignals: string[]
  resolvedContent: string[]
  partialContent: string[]
  unresolvedGaps: string[]
  contradictions: string[]
}

function withOther(options: string[] | undefined) {
  if (!options?.length) return undefined
  return [...new Set(options.map((item) => item.trim()).filter(Boolean).filter((item) => item !== "Other"))]
}

function schema(id: string, label: string, min: number, max: number, questionTemplates: ReviewPromptModeV2QuestionTemplate[]): ReviewPromptModeV2SectionSchema {
  return {
    id,
    label,
    targetQuestionRange: { min, max },
    questionTemplates: questionTemplates.map((question) => ({
      ...question,
      options: withOther(question.options)
    }))
  }
}

export const REVIEW_PROMPT_MODE_V2_SECTION_SCHEMAS: Record<ReviewPromptModeV2RequestType, ReviewPromptModeV2SectionSchema[]> = {
  creation: [
    schema("goal", "Goal", 1, 2, [
      { id: "creation-goal-outcome", label: "What should the AI create first?", helper: "Lock down the main creation outcome.", mode: "single", options: ["A usable first draft", "A polished ready-to-use result", "A minimal starter", "A few strong options"] }
    ]),
    schema("context", "Context", 0, 2, [
      { id: "creation-context-use", label: "What context matters most for this creation request?", helper: "Add the context that should shape the output.", mode: "multi", options: ["Who it is for", "Where it will be used", "Project/domain context", "Current draft or source material"] }
    ]),
    schema("requirements", "Requirements", 1, 3, [
      { id: "creation-requirements-core", label: "Which required parts must definitely be included?", helper: "Pick the must-have parts of the output.", mode: "multi", options: ["Core sections", "Specific ingredients or parts", "Named features", "Examples or evidence"] }
    ]),
    schema("constraints", "Constraints", 1, 3, [
      { id: "creation-constraints-hard", label: "Which hard constraints matter most?", helper: "Capture the non-negotiables the AI must preserve.", mode: "multi", options: ["Time limit", "Budget or cost", "Tool or method", "Do-not-use exclusions", "Numeric targets"] }
    ]),
    schema("output_format", "Output format", 1, 2, [
      { id: "creation-output-format", label: "How should the final output be shaped?", helper: "Pick the output structure the AI should return.", mode: "multi", options: ["Structured sections", "Bullets or checklist", "Table or matrix", "Code or file output", "Copy-ready answer"] }
    ]),
    schema("definition_of_complete", "Definition of complete", 0, 2, [
      { id: "creation-definition-complete", label: "What will make this feel complete enough?", helper: "Decide the quality bar for the first useful result.", mode: "single", options: ["All hard constraints satisfied", "Immediately usable", "Good enough to edit from", "Ready to ship"] }
    ]),
    schema("note_box", "Note box", 0, 1, [
      { id: "creation-note-box", label: "Anything else should shape the result?", helper: "Pick any final preference that matters enough to guide the answer.", mode: "multi", options: ["Keep it simple", "Optimize for health or performance", "Use easy-to-find ingredients", "Avoid leftovers or extra cleanup"] }
    ])
  ],
  modification: [
    schema("current_state", "Current state", 1, 2, [
      { id: "modification-current-state", label: "What should the AI understand about the current state first?", helper: "Add the baseline the change should start from.", mode: "multi", options: ["Current output/artifact", "Existing behavior", "Current code or file", "Known limitation"] }
    ]),
    schema("requested_change", "Requested change", 1, 2, [
      { id: "modification-requested-change", label: "What kind of change is this mainly asking for?", helper: "Choose the main kind of modification.", mode: "single", options: ["Refine something existing", "Replace part of it", "Add something new", "Remove something"] }
    ]),
    schema("scope_boundaries", "Scope boundaries", 0, 2, [
      { id: "modification-scope", label: "What should stay out of scope?", helper: "Keep the change focused.", mode: "multi", options: ["Do not widen the scope", "Touch only one area", "No structural rewrite", "No visual redesign"] }
    ]),
    schema("preserve_rules", "Preserve rules", 1, 2, [
      { id: "modification-preserve", label: "What must stay preserved?", helper: "Protect the nearby behavior or structure.", mode: "multi", options: ["Existing behavior", "Current tone/style", "Layout/format", "Compatibility constraints"] }
    ]),
    schema("output_format", "Output format", 0, 2, [
      { id: "modification-output-format", label: "How should the changed result be returned?", helper: "Pick the most useful return shape.", mode: "single", options: ["Edited final version", "Patch-style change", "Updated code block", "Short diff-style summary"] }
    ]),
    schema("definition_of_complete", "Definition of complete", 0, 2, [
      { id: "modification-definition-complete", label: "What proves the requested change is complete enough?", helper: "Set the finish line for the change.", mode: "single", options: ["Requested change is visible", "Nothing important regressed", "Output is ready to apply", "Safe first pass only"] }
    ]),
    schema("note_box", "Note box", 0, 1, [
      { id: "modification-note-box", label: "Anything else should guide the change?", helper: "Pick any final guardrail that should shape the modification.", mode: "multi", options: ["Keep the scope narrow", "Protect existing behavior", "Keep the style consistent", "Call out regression risk"] }
    ])
  ],
  problem_solving: [
    schema("expected_behavior", "Expected behavior", 1, 2, [
      { id: "problem-expected", label: "What should happen when things are working?", helper: "Pick the closest expected outcome before we go deeper.", mode: "single", options: ["The feature should render correctly", "The action should complete without error", "The output should match the request", "The system should stay stable and responsive"] }
    ]),
    schema("actual_behavior", "Actual behavior", 1, 2, [
      { id: "problem-actual", label: "What is actually happening instead?", helper: "Pick the closest failure pattern before we narrow the cause.", mode: "multi", options: ["It errors or crashes", "The UI is blank or broken", "The wrong output appears", "The behavior is inconsistent or flaky"] }
    ]),
    schema("evidence", "Evidence", 0, 2, [
      { id: "problem-evidence", label: "What evidence is already available?", helper: "Capture the strongest clues before the AI suggests a fix.", mode: "multi", options: ["Error text", "Logs/output", "Screens or UI state", "Steps to reproduce"] }
    ]),
    schema("environment_context", "Environment/context", 0, 2, [
      { id: "problem-environment", label: "Which environment details matter?", helper: "Add only the context that can change the diagnosis.", mode: "multi", options: ["Browser or runtime", "Framework or stack", "Platform/environment", "Recent changes"] }
    ]),
    schema("desired_ai_help", "What you want from the AI", 1, 2, [
      { id: "problem-help", label: "What kind of help do you want first?", helper: "Choose the most useful first move from the AI.", mode: "single", options: ["Diagnosis first", "Most likely fix", "Step-by-step debugging plan", "Verification plan"] }
    ]),
    schema("fix_proof", "Fix proof", 0, 2, [
      { id: "problem-fix-proof", label: "What would count as proof this is actually fixed?", helper: "Set the proof bar before the AI answers.", mode: "multi", options: ["Repro steps pass", "Runtime output changes", "UI visibly works", "Tests/checks pass"] }
    ]),
    schema("note_box", "Note box", 0, 1, [
      { id: "problem-note-box", label: "Anything else should shape the debugging answer?", helper: "Pick any final debugging preference that matters enough to guide the response.", mode: "multi", options: ["Prioritize the fastest likely fix", "Keep the fix minimal", "Be careful about regressions", "Include verification steps"] }
    ])
  ],
  product_thinking: [
    schema("objective", "Objective", 1, 2, [
      { id: "product-objective", label: "What is the main objective?", helper: "Pick the closest objective before we deepen the trade-offs.", mode: "single", options: ["Make a decision", "Clarify trade-offs", "Prioritize the next step", "Define a direction"] }
    ]),
    schema("product_context", "Product context", 0, 2, [
      { id: "product-context", label: "What product context matters most?", helper: "Choose the context the AI should reason from.", mode: "multi", options: ["Current product state", "Feature area", "Roadmap context", "Competitive context"] }
    ]),
    schema("user_business_context", "User/business context", 0, 2, [
      { id: "product-user-business", label: "Which user or business context matters here?", helper: "Pick the context that will shape the decision.", mode: "multi", options: ["User need", "Revenue/business goal", "Adoption risk", "Stakeholder concern"] }
    ]),
    schema("decision_problem", "Decision/problem to solve", 1, 2, [
      { id: "product-decision-problem", label: "What kind of product decision is this?", helper: "Clarify the product question before exploring trade-offs.", mode: "single", options: ["Prioritization", "Scope decision", "Positioning", "Feature direction"] }
    ]),
    schema("requirements_considerations", "Requirements / considerations", 0, 3, [
      { id: "product-requirements", label: "Which considerations must shape the answer?", helper: "Choose the must-consider lenses.", mode: "multi", options: ["User value", "Engineering effort", "Business impact", "Risk/compliance", "Go-to-market"] }
    ]),
    schema("tradeoffs_constraints", "Trade-offs / constraints", 0, 2, [
      { id: "product-tradeoffs", label: "What trade-offs should the AI weigh explicitly?", helper: "Add the constraints or tensions that matter.", mode: "multi", options: ["Speed vs quality", "Scope vs focus", "Growth vs retention", "Cost vs complexity"] }
    ]),
    schema("desired_output", "Desired output", 1, 2, [
      { id: "product-output", label: "What kind of product-thinking output do you want?", helper: "Choose the shape of the answer.", mode: "single", options: ["Recommendation", "Options with trade-offs", "Decision memo", "Prioritized framework"] }
    ]),
    schema("definition_of_complete", "Definition of complete", 0, 2, [
      { id: "product-definition-complete", label: "What would make this complete enough?", helper: "Set the bar for the product-thinking answer.", mode: "single", options: ["Clear recommendation", "Explicit trade-offs", "Decision-ready summary", "Good first pass only"] }
    ]),
    schema("note_box", "Note box", 0, 1, [
      { id: "product-note-box", label: "Anything else should shape the recommendation?", helper: "Pick any final lens that should influence the answer.", mode: "multi", options: ["Be explicit about trade-offs", "Keep it practical", "Call out open risks", "Recommend a next step"] }
    ])
  ],
  shipping: [
    schema("current_status", "Current status", 1, 2, [
      { id: "shipping-current-status", label: "What is the current shipping status?", helper: "Set the baseline before planning the ship path.", mode: "single", options: ["Almost ready", "Blocked by a few issues", "Needs final QA", "Still rough"] }
    ]),
    schema("target_environment", "Target environment/platform", 0, 2, [
      { id: "shipping-target-environment", label: "Where does this need to ship?", helper: "Choose the target environment or platform.", mode: "multi", options: ["Production web app", "Browser extension", "Mobile app", "Internal tool", "API/service"] }
    ]),
    schema("release_requirements", "Release requirements", 1, 3, [
      { id: "shipping-release-requirements", label: "Which release requirements are non-negotiable?", helper: "Pick the ship gates the AI should respect.", mode: "multi", options: ["Bug fixes only", "QA sign-off", "Docs/changelog", "Launch checklist", "Stakeholder approval"] }
    ]),
    schema("known_risks", "Known risks/blockers", 0, 2, [
      { id: "shipping-risks", label: "Which risks or blockers matter most right now?", helper: "Add the shipping risks the AI should address.", mode: "multi", options: ["Open bugs", "Unknown regression risk", "Deployment risk", "Missing verification", "Dependency risk"] }
    ]),
    schema("needed_output", "Needed output", 1, 2, [
      { id: "shipping-needed-output", label: "What shipping output do you want from the AI?", helper: "Pick the most useful ship-focused deliverable.", mode: "single", options: ["Release plan", "Go/no-go checklist", "Risk review", "Ship-ready prompt"] }
    ]),
    schema("readiness_check", "Readiness check", 0, 2, [
      { id: "shipping-readiness-check", label: "What should the readiness check focus on?", helper: "Choose the readiness lens.", mode: "multi", options: ["Core functionality", "Known blockers", "Cross-platform behavior", "Operational readiness"] }
    ]),
    schema("post_ship_verification", "Post-ship verification", 0, 2, [
      { id: "shipping-post-ship", label: "What should be verified right after shipping?", helper: "Set the first post-ship checks.", mode: "multi", options: ["Smoke test", "Metrics/monitoring", "User-visible behavior", "Rollback readiness"] }
    ]),
    schema("definition_of_complete", "Definition of complete", 0, 2, [
      { id: "shipping-definition-complete", label: "What would make this ship-ready enough?", helper: "Set the completion bar for this shipping request.", mode: "single", options: ["Ready to launch", "Ready for final QA", "Ready for approval", "Ready for handoff"] }
    ]),
    schema("note_box", "Note box", 0, 1, [
      { id: "shipping-note-box", label: "Anything else should shape the release plan?", helper: "Pick any final release concern that should influence the answer.", mode: "multi", options: ["Focus on blockers first", "Call out regression risk", "Include smoke tests", "Keep the plan concise"] }
    ])
  ],
  prompt_optimization: [
    schema("purpose", "What it is for", 1, 2, [
      { id: "prompt-purpose", label: "What is this prompt meant to help the AI do?", helper: "Clarify the job of the prompt before improving it.", mode: "single", options: ["Generate something new", "Fix or debug", "Rewrite or summarize", "Analyze or recommend"] }
    ]),
    schema("current_failure", "Failure/problem in current form", 1, 2, [
      { id: "prompt-current-failure", label: "What is wrong with the prompt today?", helper: "Pick the biggest failure to correct first.", mode: "multi", options: ["Too vague", "Misses constraints", "Wrong output shape", "Not reliable enough", "Too broad"] }
    ]),
    schema("desired_improvement", "Desired improvement", 1, 2, [
      { id: "prompt-desired-improvement", label: "What improvement matters most?", helper: "Choose the strongest improvement goal.", mode: "multi", options: ["Clearer constraints", "Better output structure", "More reliability", "Shorter and cleaner", "Better task direction"] }
    ]),
    schema("execution_context", "Execution context", 0, 2, [
      { id: "prompt-execution-context", label: "What execution context matters?", helper: "Add only the context that changes how the prompt should be optimized.", mode: "multi", options: ["Chat model", "Coding assistant", "Research assistant", "High-stakes usage"] }
    ]),
    schema("output_format", "Output format", 0, 2, [
      { id: "prompt-output-format", label: "How should the optimized prompt be returned?", helper: "Pick the most useful return shape.", mode: "single", options: ["Final prompt only", "Prompt plus rationale", "Prompt variants", "Prompt with checklist"] }
    ]),
    schema("note_box", "Note box", 0, 1, [
      { id: "prompt-note-box", label: "Anything else should shape the optimized prompt?", helper: "Pick any final rewrite goal that should guide the result.", mode: "multi", options: ["Preserve the original meaning", "Tighten constraints", "Improve output structure", "Reduce ambiguity"] }
    ])
  ]
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function includesAny(source: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(source))
}

function detectSectionSignals(params: {
  taskType: ReviewPromptModeV2RequestType
  sectionId: string
  promptText: string
  goalContract: GoalContract | null
}) {
  const { taskType, sectionId, promptText, goalContract } = params
  const normalizedPrompt = normalize(promptText)
  const hardConstraintCount = goalContract?.hardConstraints.length ?? 0
  const outputRequirementCount = goalContract?.outputRequirements.length ?? 0
  const signals: string[] = []

  const signal = (label: string, matched: boolean) => {
    if (matched) signals.push(label)
  }

  switch (taskType) {
    case "creation":
      switch (sectionId) {
        case "goal":
          signal("goal detected", Boolean(goalContract?.deliverableType) || /\bcreate\b|\bwrite\b|\bgenerate\b|\bcompose\b|\bbuild\b/.test(normalizedPrompt))
          break
        case "context":
          signal("context detected", includesAny(normalizedPrompt, [/\bfor\b.+\b(?:team|customer|user|executive|manager|kids|students?)\b/, /\bcontext\b/, /\buse case\b/]))
          break
        case "requirements":
          signal("requirements detected", hardConstraintCount >= 2)
          break
        case "constraints":
          signal("constraints detected", hardConstraintCount >= 1)
          break
        case "output_format":
          signal("output format detected", outputRequirementCount >= 1)
          break
        case "definition_of_complete":
          signal("definition of complete detected", includesAny(normalizedPrompt, [/\bready to use\b/, /\bdefinition of complete\b/, /\bdone when\b/, /\bcomplete when\b/]))
          break
        case "note_box":
          signal("note detected", includesAny(normalizedPrompt, [/\bnote\b/, /\bimportant\b/, /\bwatch out\b/]))
          break
      }
      break
    case "modification":
      switch (sectionId) {
        case "current_state":
          signal("current state detected", includesAny(normalizedPrompt, [/\bcurrent\b/, /\bexisting\b/, /\balready\b/, /\bright now\b/]))
          break
        case "requested_change":
          signal("requested change detected", includesAny(normalizedPrompt, [/\bchange\b/, /\bupdate\b/, /\bmodify\b/, /\brefactor\b/, /\bimprove\b/]))
          break
        case "scope_boundaries":
          signal("scope boundary detected", includesAny(normalizedPrompt, [/\bonly\b/, /\bout of scope\b/, /\bdo not\b/, /\bjust\b/]))
          break
        case "preserve_rules":
          signal("preserve rules detected", includesAny(normalizedPrompt, [/\bpreserve\b/, /\bkeep\b/, /\bwithout breaking\b/, /\bdo not change\b/]))
          break
        case "output_format":
          signal("output format detected", outputRequirementCount >= 1)
          break
        case "definition_of_complete":
          signal("definition of complete detected", includesAny(normalizedPrompt, [/\bdone when\b/, /\bcomplete when\b/, /\bready when\b/]))
          break
        case "note_box":
          signal("note detected", includesAny(normalizedPrompt, [/\bnote\b/, /\bimportant\b/]))
          break
      }
      break
    case "problem_solving":
      switch (sectionId) {
        case "expected_behavior":
          signal("expected behavior detected", includesAny(normalizedPrompt, [/\bshould\b/, /\bexpected\b/, /\bsupposed to\b/]))
          break
        case "actual_behavior":
          signal("actual behavior detected", includesAny(normalizedPrompt, [/\bbut\b/, /\binstead\b/, /\bactually\b/, /\bfails?\b/, /\berror\b/]))
          break
        case "evidence":
          signal("evidence detected", includesAny(normalizedPrompt, [/\berror\b/, /\blog\b/, /\btrace\b/, /\brepro\b/, /\bscreenshot\b/]))
          break
        case "environment_context":
          signal("environment detected", includesAny(normalizedPrompt, [/\bbrowser\b/, /\bruntime\b/, /\bframework\b/, /\bplatform\b/, /\benvironment\b/]))
          break
        case "desired_ai_help":
          signal("desired help detected", includesAny(normalizedPrompt, [/\bdebug\b/, /\bfix\b/, /\bdiagnose\b/, /\bhelp\b/]))
          break
        case "fix_proof":
          signal("fix proof detected", includesAny(normalizedPrompt, [/\bprove\b/, /\bverify\b/, /\bcheck\b/, /\btest\b/]))
          break
        case "note_box":
          signal("note detected", includesAny(normalizedPrompt, [/\bnote\b/, /\bimportant\b/]))
          break
      }
      break
    case "product_thinking":
      switch (sectionId) {
        case "objective":
          signal("objective detected", includesAny(normalizedPrompt, [/\bobjective\b/, /\bgoal\b/, /\btrying to achieve\b/]))
          break
        case "product_context":
          signal("product context detected", includesAny(normalizedPrompt, [/\bproduct\b/, /\bfeature\b/, /\broadmap\b/, /\blaunch\b/]))
          break
        case "user_business_context":
          signal("user/business context detected", includesAny(normalizedPrompt, [/\buser\b/, /\bcustomer\b/, /\bbusiness\b/, /\brevenue\b/, /\bmarket\b/]))
          break
        case "decision_problem":
          signal("decision/problem detected", includesAny(normalizedPrompt, [/\bdecide\b/, /\bdecision\b/, /\bshould we\b/, /\btrade-off\b/]))
          break
        case "requirements_considerations":
          signal("requirements detected", hardConstraintCount >= 1 || includesAny(normalizedPrompt, [/\brequirement\b/, /\bconsider\b/]))
          break
        case "tradeoffs_constraints":
          signal("trade-offs detected", includesAny(normalizedPrompt, [/\btrade-off\b/, /\bconstraint\b/, /\blimit\b/, /\brisk\b/]))
          break
        case "desired_output":
          signal("desired output detected", outputRequirementCount >= 1 || includesAny(normalizedPrompt, [/\brecommendation\b/, /\boptions\b/, /\bmemo\b/]))
          break
        case "definition_of_complete":
          signal("definition of complete detected", includesAny(normalizedPrompt, [/\bdecision-ready\b/, /\bcomplete when\b/, /\bdone when\b/]))
          break
        case "note_box":
          signal("note detected", includesAny(normalizedPrompt, [/\bnote\b/, /\bimportant\b/]))
          break
      }
      break
    case "shipping":
      switch (sectionId) {
        case "current_status":
          signal("current status detected", includesAny(normalizedPrompt, [/\bcurrent status\b/, /\bready\b/, /\bblocked\b/, /\bstatus\b/]))
          break
        case "target_environment":
          signal("target environment detected", includesAny(normalizedPrompt, [/\bproduction\b/, /\bstaging\b/, /\bextension\b/, /\bmobile\b/, /\bplatform\b/]))
          break
        case "release_requirements":
          signal("release requirements detected", includesAny(normalizedPrompt, [/\brelease\b/, /\bship\b/, /\blaunch\b/, /\brequirement\b/, /\bchecklist\b/]))
          break
        case "known_risks":
          signal("risks detected", includesAny(normalizedPrompt, [/\brisk\b/, /\bblocker\b/, /\bknown issue\b/, /\bregression\b/]))
          break
        case "needed_output":
          signal("needed output detected", outputRequirementCount >= 1 || includesAny(normalizedPrompt, [/\bplan\b/, /\bchecklist\b/, /\bgo\/no-go\b/]))
          break
        case "readiness_check":
          signal("readiness check detected", includesAny(normalizedPrompt, [/\breadiness\b/, /\bqa\b/, /\bsmoke test\b/]))
          break
        case "post_ship_verification":
          signal("post-ship verification detected", includesAny(normalizedPrompt, [/\bpost-ship\b/, /\bafter launch\b/, /\bverify\b/, /\bmonitor\b/]))
          break
        case "definition_of_complete":
          signal("definition of complete detected", includesAny(normalizedPrompt, [/\bship-ready\b/, /\bdone when\b/, /\bcomplete when\b/]))
          break
        case "note_box":
          signal("note detected", includesAny(normalizedPrompt, [/\bnote\b/, /\bimportant\b/]))
          break
      }
      break
    case "prompt_optimization":
      switch (sectionId) {
        case "purpose":
          signal("purpose detected", Boolean(goalContract?.deliverableType) || includesAny(normalizedPrompt, [/\bfor\b/, /\bused to\b/, /\bmeant to\b/]))
          break
        case "current_failure":
          signal("current failure detected", includesAny(normalizedPrompt, [/\btoo vague\b/, /\bnot working\b/, /\bproblem\b/, /\bfailure\b/, /\bmisses\b/]))
          break
        case "desired_improvement":
          signal("desired improvement detected", includesAny(normalizedPrompt, [/\bimprove\b/, /\bbetter\b/, /\bclearer\b/, /\boptimi[sz]e\b/]))
          break
        case "execution_context":
          signal("execution context detected", includesAny(normalizedPrompt, [/\bchatgpt\b/, /\bclaude\b/, /\bmodel\b/, /\bcoding assistant\b/, /\bcontext\b/]))
          break
        case "output_format":
          signal("output format detected", outputRequirementCount >= 1 || includesAny(normalizedPrompt, [/\bfinal prompt only\b/, /\bvariants\b/, /\bformat\b/]))
          break
        case "note_box":
          signal("note detected", includesAny(normalizedPrompt, [/\bnote\b/, /\bimportant\b/]))
          break
      }
      break
  }

  return signals
}

export function buildPromptModeV2SectionStates(params: {
  taskType: ReviewPromptModeV2RequestType
  promptText: string
  goalContract: GoalContract | null
}) {
  const effectiveTaskType = resolvePromptModeV2TemplateKind(params.taskType)
  const schemas = REVIEW_PROMPT_MODE_V2_SECTION_SCHEMAS[effectiveTaskType]
  return schemas.map((section) => {
    const signals = detectSectionSignals({
      taskType: effectiveTaskType,
      sectionId: section.id,
      promptText: params.promptText,
      goalContract: params.goalContract
    })
    const status: ReviewPromptModeV2SectionStatus =
      signals.length >= 2 ? "resolved" : signals.length === 1 ? "partially_resolved" : "unresolved"

    return {
      id: section.id,
      label: section.label,
      targetQuestionRange: section.targetQuestionRange,
      status,
      askedCount: 0,
      resolvedSignals: signals,
      resolvedContent: status === "resolved" ? signals : [],
      partialContent: status === "partially_resolved" ? signals : [],
      unresolvedGaps:
        status === "resolved"
          ? []
          : status === "partially_resolved"
            ? [`One or more details for ${section.label.toLowerCase()} still need tightening.`]
            : [`Need at least ${section.targetQuestionRange.min} concrete detail${section.targetQuestionRange.min === 1 ? "" : "s"} for ${section.label.toLowerCase()}.`],
      contradictions: []
    } satisfies ReviewPromptModeV2SectionState
  })
}
