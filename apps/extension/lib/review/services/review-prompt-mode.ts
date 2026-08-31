import { analyzePromptLocally } from "@prompt-optimizer/shared/src/analyzePrompt"
import {
  buildRequestBrief,
  formatRequestBriefSummary,
  type RequestBrief
} from "@prompt-optimizer/shared/src/request-brief"
import type {
  AfterAnalysisResult,
  AnalyzePromptResponse,
  Attempt,
  ClarificationQuestion,
  ExtendQuestionsRequest,
  PromptSurface,
  SessionSummary
} from "@prompt-optimizer/shared/src/schemas"
import {
  buildAfterPlaceholder,
  buildPlanningAttemptFromDraft,
  buildInitialPlannerState
} from "../../core/after-orchestration"
import {
  buildProjectContextPack,
  formatProjectContextPackSummary,
  type ProjectContextPack
} from "../../core/project-context-pack"
import type { ImportedProjectContextRecord } from "../../core/project-context"
import { buildPlanningAttemptIntentFromPrompt } from "../../core/attempt-orchestration"
import { createGoalContract } from "../../goal/goal-contract"
import { normalizeGoalContract } from "../../goal/goal-normalizer"
import type { GoalContract, GoalConstraint } from "../../goal/types"
import { type PromptContract } from "../../prompt/contracts"
import { buildPromptContractFromGoalContract } from "../../prompt/prompt-renderer"
import {
  type StructuredProjectMemory
} from "../../session/project-memory"
import {
  formatProjectPreferenceSummary,
  type ProjectPreferenceSettings,
  type ProjectSettingsRecord
} from "../../session/project-settings"
import type { ReviewWorkflowState } from "../workflow-state"

function buildFallbackChecklist(intent: AnalyzePromptResponse["intent"]) {
  switch (intent) {
    case "DEBUG":
      return [
        "Identify the first runtime checkpoint to inspect",
        "Clarify what counts as proof the bug is fixed",
        "Keep the next step narrow and testable"
      ]
    case "BUILD":
      return [
        "Clarify the exact output the first draft must include",
        "Call out the required format or technology",
        "State what makes the draft usable right away"
      ]
    case "EXPLAIN":
      return [
        "Clarify what should be explained first",
        "State the level of detail the answer should use",
        "Keep the explanation tied to the user's actual goal"
      ]
    default:
      return [
        "Clarify the exact outcome the next prompt should request",
        "Capture the most important constraints",
        "Keep the next step focused enough to act on"
      ]
  }
}

function buildFallbackQuestionOptions(intent: AnalyzePromptResponse["intent"]) {
  switch (intent) {
    case "DEBUG":
      return {
        label: "What should the next step confirm first?",
        helper: "Pick the first runtime checkpoint the next prompt should verify before changing more code.",
        options: [
          "The extension loads",
          "The content script attaches",
          "The target element is detected",
          "The UI renders visibly",
          "Other"
        ]
      }
    case "BUILD":
      return {
        label: "What matters most in the first draft?",
        helper: "Pick the first quality bar the next prompt should optimize for.",
        options: [
          "Correct structure first",
          "Requested format first",
          "Usable starter content",
          "Minimal starter only",
          "Other"
        ]
      }
    case "EXPLAIN":
      return {
        label: "What should the next answer optimize first?",
        helper: "Pick the most important quality bar for the next explanation.",
        options: [
          "Direct answer first",
          "Clear steps",
          "Stronger examples",
          "Tighter scope",
          "Other"
        ]
      }
    default:
      return {
        label: "What should the next prompt lock down first?",
        helper: "Pick the first thing the next prompt should make explicit.",
        options: [
          "Exact output",
          "Key constraint",
          "Success criteria",
          "Scope limit",
          "Other"
        ]
      }
  }
}

function goalHasConstraintType(goalContract: GoalContract | null | undefined, types: GoalConstraint["type"][]) {
  if (!goalContract) return false
  return goalContract.hardConstraints.some((item) => types.includes(item.type))
}

function outputRequirementPresent(goalContract: GoalContract | null | undefined, pattern: RegExp) {
  if (!goalContract) return false
  return goalContract.outputRequirements.some((item) => pattern.test(item))
}

function isPriorityStylePreference(goalContract: GoalContract | null | undefined) {
  if (!goalContract) return false
  return goalContract.softPreferences.some((item) => /professional|concise|friendly|clean|practical|tone|audience/i.test(`${item.label} ${item.value ?? ""}`))
}

function topConstraintOptions(goalContract: GoalContract | null | undefined, limit = 4) {
  if (!goalContract) return []
  return uniqueItems(
    goalContract.hardConstraints
      .filter((item) => !["generic", "scope"].includes(item.type))
      .map((item) => toSentenceCase(item.label))
  ).slice(0, limit)
}

function deriveGoalAwareFallbackQuestion(params: {
  promptText: string
  localAnalysis: AnalyzePromptResponse
  goalContract?: GoalContract | null
  existingQuestions?: ClarificationQuestion[]
  likelyMidProject?: boolean
}) {
  const { promptText, localAnalysis, goalContract } = params
  const normalizedPrompt = promptText.trim().toLowerCase()
  const promptSnippet = promptText.trim().slice(0, 72)
  const deliverableType = goalContract?.deliverableType ?? ""
  const askedCategories = new Set<string>(
    (params.existingQuestions ?? []).map((question) => questionCategory(question))
  )

  const chooseUnusedFallback = (
    category: string,
    template: {
      label: string
      helper: string
      options: string[]
    }
  ) => {
    if (askedCategories.has(category)) return null
    return template
  }

  if (
    /\bsummar(?:ize|y)\b|\boverview\b|\bbrief\b|\brecap\b|\bkey points?\b|\bshort summary\b/.test(normalizedPrompt) ||
    localAnalysis.intent === "EXPLAIN"
  ) {
    return (
      chooseUnusedFallback("output_shape", {
        label: "What kind of summary should the next prompt ask for?",
        helper: `Lock down the summary format before sending the next prompt. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
        options: ["One short paragraph", "Bullet summary", "Executive summary", "Key points only", "Other"]
      }) ??
      chooseUnusedFallback("success_criteria", {
        label: "What should make the next summary feel right?",
        helper: `Pick the quality bar so the next answer lands the summary the way you need. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
        options: ["Very short and direct", "Clear and easy to skim", "More complete", "Written for decision-making", "Other"]
      }) ??
      chooseUnusedFallback("scope_boundary", {
        label: "How tight should the next summary stay?",
        helper: `Set the scope boundary before sending the next prompt. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
        options: ["Only the essentials", "Only product basics", "Include architecture too", "Include current progress too", "Other"]
      }) ?? {
        label: "What kind of summary should the next prompt ask for?",
        helper: `Lock down the summary format before sending the next prompt. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
        options: ["One short paragraph", "Bullet summary", "Executive summary", "Key points only", "Other"]
      }
    )
  }

  if (!deliverableType) {
    return (
      chooseUnusedFallback("output_shape", {
        label: "What kind of result should the next prompt ask for?",
        helper: `Lock down the exact deliverable before sending the next prompt. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
        options: ["Recipe", "Rewrite", "HTML/CSS output", "Recommendation", "Other"]
      }) ??
      chooseUnusedFallback("scope_boundary", {
        label: "How narrow should the next prompt keep this request?",
        helper: `Set the scope boundary before sending the next prompt. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
        options: ["One small change only", "One clean first draft", "A complete end-to-end result", "Keep it flexible", "Other"]
      }) ??
      chooseUnusedFallback("success_criteria", {
        label: "What would make the next answer immediately usable?",
        helper: `Pick the finish line so the next answer is useful right away. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
        options: ["Correct structure", "Ready to use", "Easy to edit", "Short and fast", "Other"]
      }) ??
      chooseUnusedFallback("validation_expectation", {
        label: "How should the assistant show the result is right?",
        helper: `Choose how much proof or checking you want in the next answer. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
        options: ["Explain the reasoning briefly", "Include a quick checklist", "Show examples", "No extra proof needed", "Other"]
      }) ??
      (params.likelyMidProject
        ? chooseUnusedFallback("protected_surface", {
            label: "What must stay untouched while making this change?",
            helper: `Protect the rest of the project before going further. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
            options: ["Keep existing behavior untouched", "Do not change the design", "Do not change architecture", "Only touch the current area", "Other"]
          })
        : null) ?? {
        label: "What kind of result should the next prompt ask for?",
        helper: `Lock down the exact deliverable before sending the next prompt. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
        options: ["Recipe", "Rewrite", "HTML/CSS output", "Recommendation", "Other"]
      }
    )
  }

  if (deliverableType === "scoped_change") {
    return (
      chooseUnusedFallback("change_detail", {
        label: "What exact part of the change should the next prompt lock down first?",
        helper: `Clarify the most important implementation detail before sending the next prompt. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
        options: ["Field type", "Allowed options", "Form placement", "Submit behavior", "Scope boundary"]
      }) ??
      chooseUnusedFallback("scope_boundary", {
        label: "How narrow should the next prompt keep this request?",
        helper: `Assume this should stay a narrow change and avoid unrelated areas. Set the scope boundary before sending the next prompt. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
        options: ["One small change only", "Registration flow only", "Registration plus submit flow", "End-to-end broader change", "Other"]
      }) ??
      chooseUnusedFallback("success_criteria", {
        label: "What should count as done for this change?",
        helper: `Define the finish line so the next prompt asks for the right level of completion. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
        options: ["Field appears in the form", "Field submits correctly", "Field saves through the full flow", "UI and behavior both matter", "Other"]
      }) ??
      chooseUnusedFallback("protected_surface", {
        label: "What must stay untouched while making this change?",
        helper: `Protect the rest of the product before going further. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
        options: ["Other forms stay untouched", "Existing styling stays intact", "Backend stays untouched", "Only the registration flow changes", "Other"]
      }) ?? {
        label: "What exact part of the change should the next prompt lock down first?",
        helper: `Clarify the most important implementation detail before sending the next prompt. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
        options: ["Field type", "Allowed options", "Form placement", "Submit behavior", "Scope boundary"]
      }
    )
  }

  if (deliverableType === "multi_change") {
    return (
      chooseUnusedFallback("change_priority", {
        label: "How should the next prompt handle these requested changes?",
        helper: `This request includes several edits. Decide whether the next prompt should prioritize one first or bundle them together. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
        options: [
          "Prioritize one change first",
          "Handle all changes in one pass",
          "Split into small sequential steps",
          "Do the safest changes first",
          "Other"
        ]
      }) ??
      chooseUnusedFallback("scope_boundary", {
        label: "Which change should the next prompt focus on first?",
        helper: `Pick the first area to lock down before the prompt tries to do too much at once. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
        options: [
          "Registration field",
          "Background color",
          "Password criteria",
          "Wording fixes",
          "Other"
        ]
      }) ??
      chooseUnusedFallback("success_criteria", {
        label: "What should count as success for the first pass?",
        helper: `Define the finish line for the next prompt before it tackles multiple edits. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
        options: [
          "One clean scoped change",
          "Several small safe fixes",
          "Everything updated end-to-end",
          "Only visible UI changes first",
          "Other"
        ]
      }) ?? {
        label: "How should the next prompt handle these requested changes?",
        helper: `This request includes several edits. Decide whether the next prompt should prioritize one first or bundle them together. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
        options: [
          "Prioritize one change first",
          "Handle all changes in one pass",
          "Split into small sequential steps",
          "Do the safest changes first",
          "Other"
        ]
      }
    )
  }

  if (!goalHasConstraintType(goalContract, ["servings", "count"])) {
    return {
      label: "What serving or count should the next prompt lock down?",
      helper: `Make the requested amount explicit before sending the next prompt. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
      options: ["Single serving", "2 servings", "4 servings", "Exact count matters", "Other"]
    }
  }

  if (!goalHasConstraintType(goalContract, ["time"])) {
    return {
      label: "What time limit should the next prompt enforce?",
      helper: `Clarify the time budget so the next answer stays within it. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
      options: ["5 minutes or less", "15 minutes or less", "30 minutes or less", "Time does not matter", "Other"]
    }
  }

  if (deliverableType === "recipe" && !goalHasConstraintType(goalContract, ["calories", "protein", "diet", "exclusion", "method"])) {
    return {
      label: "Which hard recipe constraint matters most to lock down next?",
      helper: `Pick the next non-negotiable recipe requirement. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
      options: ["Calorie target", "Protein target", "Diet restriction", "Cooking method", "Other"]
    }
  }

  if (deliverableType === "recipe" && (!outputRequirementPresent(goalContract, /\bingredients?\b/i) || !outputRequirementPresent(goalContract, /\bstep[-\s]?by[-\s]?step\b|\binstructions?\b/i))) {
    return {
      label: "Which recipe output sections must the next answer include?",
      helper: `Lock down the recipe output format before sending the next prompt. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
      options: ["Ingredients + steps", "Ingredients + steps + calories", "Ingredients + steps + macros", "Full recipe card", "Other"]
    }
  }

  if ((deliverableType === "html_file" || goalHasConstraintType(goalContract, ["technology", "method"])) && !outputRequirementPresent(goalContract, /\bhtml\b|\bcss\b/i)) {
    return {
      label: "What code artifact should the next prompt make explicit?",
      helper: `Clarify the output artifact so the next answer returns the right code shape. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
      options: ["Full HTML file", "HTML + CSS", "One component only", "JSON/data output", "Other"]
    }
  }

  if (deliverableType === "rewrite" && !isPriorityStylePreference(goalContract)) {
    return {
      label: "Which rewrite quality should the next prompt pin down?",
      helper: `Clarify the rewrite bar before sending the next prompt. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
      options: ["Tone", "Audience", "Length", "Keep meaning exactly", "Other"]
    }
  }

  const prioritizedConstraints = topConstraintOptions(goalContract)
  if (prioritizedConstraints.length >= 2) {
    return {
      label: "Which current requirement is least negotiable?",
      helper: `The goal is already detailed. Pick the highest-value requirement to protect first. Current direction: ${promptSnippet}${promptSnippet.length >= 72 ? "..." : ""}`,
      options: [...prioritizedConstraints, "Other"].slice(0, 5)
    }
  }

  return buildFallbackQuestionOptions(localAnalysis.intent)
}

function questionMentionsResolvedDimension(question: ClarificationQuestion, goalContract: GoalContract | null | undefined) {
  const text = `${question.label} ${question.helper ?? ""} ${(question.options ?? []).join(" ")}`.toLowerCase()
  if (/\bwhich ai\b|\bchatgpt\b|\bclaude\b|\bgemini\b|\bcopilot\b|\bmodel\b/.test(text)) return true
  if (goalHasConstraintType(goalContract, ["servings", "count"]) && /\bservings?\b|\bhow many people\b|\bhow many meals\b|\bportion\b/.test(text)) return true
  if (goalHasConstraintType(goalContract, ["time"]) && /\bminutes?\b|\btime limit\b|\bhow long\b/.test(text)) return true
  if (goalHasConstraintType(goalContract, ["calories"]) && /\bcalories?\b|\bkcal\b/.test(text)) return true
  if (goalHasConstraintType(goalContract, ["protein"]) && /\bprotein\b/.test(text)) return true
  if (goalHasConstraintType(goalContract, ["diet", "exclusion"]) && /\bdiet\b|\bdairy\b|\bvegan\b|\bvegetarian\b|\bavoid\b|\bexclude\b/.test(text)) return true
  if (goalHasConstraintType(goalContract, ["method", "technology"]) && /\bmicrowave\b|\boven\b|\bstovetop\b|\bgrill\b|\bhtml\b|\bcss\b|\bjavascript\b|\btypescript\b|\breact\b/.test(text)) return true
  if (goalContract?.deliverableType && /\bwhat kind of result\b|\bwhat output\b|\bdeliverable\b/.test(text)) return true
  if (goalContract && goalContract.outputRequirements.length > 0 && /\bingredients?\b|\binstructions?\b|\bsteps?\b|\bmacros?\b|\bformat\b|\bsection\b/.test(text)) return true
  return false
}

function filterGoalAwareQuestions(params: {
  goalContract?: GoalContract | null
  questions: ClarificationQuestion[]
}) {
  const { goalContract, questions } = params
  return questions.filter((question) => !questionMentionsResolvedDimension(question, goalContract))
}

type PromptModeQuestionContextPack = {
  promptText: string
  localAnalysis: AnalyzePromptResponse
  goalContract: GoalContract | null
  requestBrief: RequestBrief | null
  structuredMemory: StructuredProjectMemory | null
  projectContextPack: ProjectContextPack
  existingQuestions: ClarificationQuestion[]
  normalizedAnswers: Record<string, string>
  currentFeatureArea: string
  currentWorkflowState: ReviewWorkflowState | null
  preferences: ProjectPreferenceSettings | null
  likelyMidProject: boolean
  contextConfidence: "low" | "medium" | "high"
  knownFacts: string[]
  requestedChangeBuckets: Array<{
    id: "registration_field" | "background" | "password_criteria" | "wording"
    label: string
  }>
  tensions: Array<
    | "scope_boundary"
    | "protected_surface"
    | "output_shape"
    | "validation_expectation"
    | "feature_context"
    | "success_criteria"
    | "context_refresh"
  >
}

type RequestedChangeBucket = PromptModeQuestionContextPack["requestedChangeBuckets"][number]
type PromptModeQuestionCategory = PromptModeQuestionContextPack["tensions"][number] | "generic"

function extractRequestedChangeBuckets(promptText: string) {
  const normalized = promptText.toLowerCase()
  const buckets: PromptModeQuestionContextPack["requestedChangeBuckets"] = []

  if (/\b(gender|registration flow|registration form|field|dropdown|radio buttons?)\b/.test(normalized)) {
    buckets.push({ id: "registration_field", label: "Registration field" })
  }
  if (/\bbackground color\b|\bbackground\b/.test(normalized)) {
    buckets.push({ id: "background", label: "Background color" })
  }
  if (/\bpassword\b.*\b(criteria|rules|requirements?)\b|\bcriteria\b.*\bpassword\b/.test(normalized)) {
    buckets.push({ id: "password_criteria", label: "Password criteria" })
  }
  if (/\bwording issues?\b|\bcopy issues?\b|\btext issues?\b|\bfix the wording\b|\bcopy\b/.test(normalized)) {
    buckets.push({ id: "wording", label: "Wording issues" })
  }

  return buckets
}

function questionTouchesBucket(
  question: ClarificationQuestion,
  bucket: RequestedChangeBucket
) {
  const text = `${question.label} ${question.helper} ${question.options.join(" ")}`.toLowerCase()
  switch (bucket.id) {
    case "registration_field":
      return /\bgender\b|\bregistration\b|\bfield\b|\binput\b|\bdropdown\b|\bradio\b|\bform placement\b/.test(text)
    case "background":
      return /\bbackground\b|\bcolor\b|\bpage body\b|\bform background\b|\bbutton background\b|\bheader background\b/.test(text)
    case "password_criteria":
      return /\bpassword\b|\bcriteria\b|\brequirements?\b|\bmin(?:imum)? length\b|\bspecial character\b|\buppercase\b|\bnumber\b/.test(text)
    case "wording":
      return /\bwording\b|\bcopy\b|\blabel\b|\bmicrocopy\b|\bphrasing\b|\bhelper text\b|\berror text\b|\bbutton text\b|\btext issues?\b/.test(
        text
      )
  }
}

function answerTouchesBucket(
  answer: string,
  bucket: RequestedChangeBucket
) {
  const text = answer.toLowerCase()
  switch (bucket.id) {
    case "registration_field":
      return /\bgender\b|\bregistration\b|\bdropdown\b|\bradio\b|\bfield\b|\bafter name\b/.test(text)
    case "background":
      return /\bbackground\b|\bform background\b|\bpage body\b|\bbutton background\b|\bheader background\b/.test(text)
    case "password_criteria":
      return /\bpassword\b|\bcriteria\b|\bminimum\b|\blength\b|\buppercase\b|\blowercase\b|\bnumber\b|\bspecial\b/.test(text)
    case "wording":
      return /\bwording\b|\bcopy\b|\blabel\b|\bphrasing\b|\bhelper text\b|\berror text\b|\bbutton text\b|\btext issues?\b/.test(
        text
      )
  }
}

function hasAnsweredMultiChangeStrategy(pack: PromptModeQuestionContextPack) {
  return Object.values(pack.normalizedAnswers).some((value) =>
    /\bprioritize one change first\b|\bhandle all changes in one pass\b|\bsplit into small sequential steps\b|\bdo the safest changes first\b/i.test(
      value
    )
  )
}

function selectedHandleAllChanges(pack: PromptModeQuestionContextPack) {
  return Object.values(pack.normalizedAnswers).some((value) => /\bhandle all changes in one pass\b/i.test(value))
}

function selectedSingleFocusStrategy(pack: PromptModeQuestionContextPack) {
  return Object.values(pack.normalizedAnswers).some((value) =>
    /\bprioritize one change first\b|\bsplit into small sequential steps\b|\bdo the safest changes first\b/i.test(value)
  )
}

function selectedFocusedBucket(pack: PromptModeQuestionContextPack) {
  const answers = Object.values(pack.normalizedAnswers)
  return (
    pack.requestedChangeBuckets.find((bucket) => answers.some((answer) => answerTouchesBucket(answer, bucket))) ?? null
  )
}

function buildMultiChangeFocusQuestion(pack: PromptModeQuestionContextPack) {
  return makeQuestionMorePlainLanguage({
    id: `prompt-${crypto.randomUUID()}`,
    label: "Which change should the next prompt focus on first?",
    helper: "Pick the first requested change to lock down before the prompt tries to do too much at once.",
    mode: "single",
    options: [...pack.requestedChangeBuckets.map((bucket) => bucket.label), "Other"].slice(0, 5)
  })
}

function buildBucketQuestion(bucket: RequestedChangeBucket) {
  switch (bucket.id) {
    case "registration_field":
      return makeQuestionMorePlainLanguage({
        id: `prompt-${crypto.randomUUID()}`,
        label: "What type of input should the gender field be?",
        helper: "Choose the visible result element for collecting gender in the registration form.",
        mode: "single",
        options: ["Dropdown select", "Radio buttons", "Text input", "Toggle switch", "Other"]
      })
    case "background":
      return makeQuestionMorePlainLanguage({
        id: `prompt-${crypto.randomUUID()}`,
        label: "Which element's background color should change?",
        helper: "Specify the exact visible result element whose background color you want to change.",
        mode: "single",
        options: ["Registration form background", "Page body background", "Submit button background", "Header background", "Other"]
      })
    case "password_criteria":
      return makeQuestionMorePlainLanguage({
        id: `prompt-${crypto.randomUUID()}`,
        label: "What password criteria should the next prompt add?",
        helper: "Clarify the exact password rules so the next prompt does not guess them.",
        mode: "single",
        options: ["Minimum length only", "Minimum length + number", "Minimum length + uppercase + number", "Full strong-password rules", "Other"]
      })
    case "wording":
      return makeQuestionMorePlainLanguage({
        id: `prompt-${crypto.randomUUID()}`,
        label: "Which wording issues should the next prompt fix?",
        helper: "Clarify what kind of copy change you want before the prompt touches wording.",
        mode: "single",
        options: ["Typos only", "Button/label wording", "Helper/error text", "All visible wording issues in this flow", "Other"]
      })
  }
}

function buildMissingBucketQuestions(
  pack: PromptModeQuestionContextPack,
  visibleQuestions: ClarificationQuestion[] = []
) {
  if ((pack.goalContract?.deliverableType ?? "") !== "multi_change") return []
  if (!hasAnsweredMultiChangeStrategy(pack)) return []

  const alreadyVisibleQuestions = [...pack.existingQuestions, ...visibleQuestions]

  if (selectedSingleFocusStrategy(pack)) {
    const focusedBucket = selectedFocusedBucket(pack)
    if (!focusedBucket) {
      return [buildMultiChangeFocusQuestion(pack)]
    }

    const bucketAlreadyCovered =
      alreadyVisibleQuestions.some((question) => questionTouchesBucket(question, focusedBucket)) ||
      Object.values(pack.normalizedAnswers).some((answer) => answerTouchesBucket(answer, focusedBucket))

    return bucketAlreadyCovered ? [] : [buildBucketQuestion(focusedBucket)]
  }

  if (!selectedHandleAllChanges(pack)) return []

  const uncoveredBuckets = pack.requestedChangeBuckets.filter((bucket) => {
    const touchedByQuestions = alreadyVisibleQuestions.some((question) => questionTouchesBucket(question, bucket))
    const touchedByAnswers = Object.values(pack.normalizedAnswers).some((answer) => answerTouchesBucket(answer, bucket))
    return !touchedByQuestions && !touchedByAnswers
  })

  return uncoveredBuckets.map((bucket) => buildBucketQuestion(bucket))
}

const TECHNICAL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bwhich runtime checkpoint should we verify first\??/gi, "What should the assistant confirm first?"],
  [/\bpick the first diagnostic step before changing the frontend component\./gi, "Pick the first thing to confirm before making more changes."],
  [/\bruntime checkpoint\b/gi, "thing to confirm"],
  [/\bcontent script\b/gi, "assistant connection"],
  [/\btarget element\b/gi, "right area on the page"],
  [/\bui\b/gi, "visible result"],
  [/\bdom\b/gi, "page structure"],
  [/\bapi\b/gi, "integration"],
  [/\bdatabase schema\b/gi, "stored data structure"],
  [/\bschema\b/gi, "data structure"],
  [/\bbackend\b/gi, "behind-the-scenes logic"],
  [/\bfrontend\b/gi, "visible product"],
  [/\brefactor\b/gi, "rework"],
  [/\bcomponent\b/gi, "part"],
  [/\broute\b/gi, "page or path"],
  [/\bauth\b/gi, "sign-in flow"],
  [/\bdeploy(?:ment)?\b/gi, "release"],
  [/\bregression\b/gi, "new breakage"],
  [/\bartifact\b/gi, "result"],
  [/\bjson\/data output\b/gi, "structured data output"],
  [/\bhtml\/css output\b/gi, "website or page output"],
  [/\bfull html file\b/gi, "full page output"],
  [/\bhtml structure\b/gi, "page structure"],
  [/\bembedded css\b/gi, "built-in styling"],
  [/\bhtml\b/gi, "page"],
  [/\bcss\b/gi, "styling"],
  [/\bjavascript\b/gi, "interactive behavior"],
  [/\btypescript\b/gi, "typed code"],
  [/\breact\b/gi, "app framework"],
  [/\brepo(?:sitory)?\b/gi, "project"],
  [/\bimplementation\b/gi, "change"],
  [/\bdiagnostic\b/gi, "check"],
  [/\bverify\b/gi, "confirm"],
  [/\bexact count matters\b/gi, "the exact amount matters"]
]

const TECHNICAL_LANGUAGE_PATTERN =
  /\b(content script|dom|schema|backend|frontend|refactor|component|route|auth|typescript|javascript|react|repo(?:sitory)?|runtime checkpoint|regression|implementation|diagnostic)\b/i

function softenPromptModeText(value: string) {
  return TECHNICAL_REPLACEMENTS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), value)
    .replace(/\s+/g, " ")
    .trim()
}

function makeQuestionMorePlainLanguage(question: ClarificationQuestion): ClarificationQuestion {
  const normalizedOptions = question.options.map((option) => softenPromptModeText(option))
  return {
    ...question,
    label: softenPromptModeText(question.label),
    helper: softenPromptModeText(question.helper),
    options: uniqueItems(normalizedOptions)
  }
}

function isStillTooTechnical(question: ClarificationQuestion) {
  const text = `${question.label} ${question.helper} ${question.options.join(" ")}`
  return TECHNICAL_LANGUAGE_PATTERN.test(text)
}

function sanitizePromptModeQuestions(questions: ClarificationQuestion[]) {
  return questions
    .map((question) => makeQuestionMorePlainLanguage(question))
    .filter((question) => question.options.length >= 2)
    .filter((question) => !isStillTooTechnical(question))
}

function detectMidProjectPrompt(promptText: string) {
  const normalized = promptText.toLowerCase()
  return /\b(continue|current|existing|already|keep|preserve|don'?t break|update|fix this|this screen|this page|this component|this popup|this flow|same project|same app)\b/.test(
    normalized
  )
}

function collectKnownFacts(pack: Omit<PromptModeQuestionContextPack, "knownFacts" | "tensions" | "contextConfidence">) {
  return uniqueItems([
    pack.goalContract?.deliverableType ?? "",
    pack.currentFeatureArea,
    ...(pack.goalContract?.outputRequirements ?? []),
    ...(pack.goalContract?.hardConstraints.map((item) => item.label) ?? []),
    ...(pack.requestBrief?.constraints ?? []),
    ...(pack.requestBrief?.nonGoals ?? []),
    ...(pack.requestBrief?.successCriteria ?? []),
    ...(pack.requestBrief?.assumptions ?? []),
    ...pack.projectContextPack.protectedAreas,
    ...pack.projectContextPack.stableConstraints,
    ...pack.projectContextPack.definitionOfDone,
    ...pack.projectContextPack.userIntent,
    ...pack.projectContextPack.relevantFiles,
    ...pack.projectContextPack.aiDriftPatterns,
    ...(pack.structuredMemory?.acceptedAssumptions ?? [])
  ])
}

function inferQuestionContextConfidence(input: {
  promptText: string
  requestBrief: RequestBrief | null
  structuredMemory: StructuredProjectMemory | null
  contextStatus: ProjectContextPack["contextStatus"]
  preferences: ProjectPreferenceSettings | null
  existingQuestions: ClarificationQuestion[]
  normalizedAnswers: Record<string, string>
  likelyMidProject: boolean
}) {
  let score = 0
  if (input.promptText.trim().length >= 60) score += 1
  if ((input.requestBrief?.constraints.length ?? 0) >= 2) score += 1
  if ((input.requestBrief?.successCriteria.length ?? 0) >= 1) score += 1
  if ((input.requestBrief?.nonGoals.length ?? 0) >= 1) score += 1
  if ((input.structuredMemory?.protectedAreas.length ?? 0) >= 1) score += 2
  if ((input.structuredMemory?.stableConstraints.length ?? 0) >= 2) score += 2
  if (input.structuredMemory?.currentFeatureArea) score += 1
  if (input.structuredMemory?.currentPhase) score += 1
  if (input.structuredMemory?.currentWorkflowState) score += 1
  if (input.contextStatus === "active") score += 1
  if (input.contextStatus === "stale") score -= 1
  if (input.contextStatus === "conflicted") score -= 2
  if (Object.keys(input.normalizedAnswers).length >= 1) score += 1
  if (input.existingQuestions.length >= 2) score += 1
  if (input.preferences?.collaborationMode === "fast") score += 1
  if (input.preferences?.collaborationMode === "plan_first") score -= 1
  if (input.likelyMidProject && score < 4) return "low"
  if (score >= 6) return "high"
  if (score >= 3) return "medium"
  return "low"
}

function inferPromptModeTensions(input: {
  requestBrief: RequestBrief | null
  goalContract: GoalContract | null
  structuredMemory: StructuredProjectMemory | null
  likelyMidProject: boolean
  currentWorkflowState: ReviewWorkflowState | null
  contextStatus: ProjectContextPack["contextStatus"]
}) {
  const tensions: PromptModeQuestionContextPack["tensions"] = []
  const protectedAreaCount = input.structuredMemory?.protectedAreas.length ?? 0
  const stableConstraintCount = input.structuredMemory?.stableConstraints.length ?? 0
  const nonGoalCount = input.requestBrief?.nonGoals.length ?? 0
  if (input.contextStatus === "stale" || input.contextStatus === "conflicted") tensions.push("context_refresh")
  if (input.likelyMidProject && !input.structuredMemory?.currentFeatureArea) tensions.push("feature_context")
  if ((input.requestBrief?.riskLevel === "medium" || input.requestBrief?.riskLevel === "high") && !protectedAreaCount) {
    tensions.push("protected_surface")
  }
  if (
    protectedAreaCount > 1 ||
    (protectedAreaCount >= 1 && (stableConstraintCount >= 1 || nonGoalCount >= 1))
  ) {
    tensions.push("protected_surface")
  }
  if (!(input.goalContract?.deliverableType ?? "") || !(input.goalContract?.outputRequirements.length ?? 0)) {
    tensions.push("output_shape")
  }
  if (!(input.requestBrief?.nonGoals.length ?? 0) && input.requestBrief?.riskLevel !== "low") {
    tensions.push("scope_boundary")
  }
  if (!(input.requestBrief?.successCriteria.length ?? 0)) tensions.push("success_criteria")
  if (
    input.currentWorkflowState === "validation_needed" ||
    input.currentWorkflowState === "safe_to_proceed" ||
    input.requestBrief?.riskLevel === "high"
  ) {
    tensions.push("validation_expectation")
  }
  return uniqueItems(tensions) as PromptModeQuestionContextPack["tensions"]
}

function buildPromptModeQuestionContextPack(params: {
  promptText: string
  localAnalysis: AnalyzePromptResponse
  goalContract?: GoalContract | null
  requestBrief?: RequestBrief | null
  structuredMemory?: StructuredProjectMemory | null
  importedContext?: ImportedProjectContextRecord | null
  settings?: ProjectSettingsRecord | null
  projectContext?: string
  currentState?: string
  existingQuestions?: ClarificationQuestion[]
  answerState?: Record<string, string | string[]>
  otherAnswerState?: Record<string, string>
}): PromptModeQuestionContextPack {
  const likelyMidProject = detectMidProjectPrompt(params.promptText)
  const normalizedAnswers = normalizePromptModeAnswers({
    answerState: params.answerState ?? {},
    otherAnswerState: params.otherAnswerState ?? {}
  })
  const projectContextPack = buildProjectContextPack({
    projectContext: params.projectContext ?? "",
    currentState: params.currentState ?? "",
    importedContext: params.importedContext ?? null,
    structuredMemory: params.structuredMemory ?? null,
    settings: params.settings ?? null,
    currentRequestText: params.promptText
  })
  const currentFeatureArea = projectContextPack.featureArea
  const currentWorkflowState = projectContextPack.currentWorkflowState ?? null
  const requestedChangeBuckets = extractRequestedChangeBuckets(params.promptText)
  const base = {
    promptText: params.promptText,
    localAnalysis: params.localAnalysis,
    goalContract: params.goalContract ?? null,
    requestBrief: params.requestBrief ?? null,
    structuredMemory: params.structuredMemory ?? null,
    projectContextPack,
    preferences: params.settings?.preferences ?? null,
    existingQuestions: params.existingQuestions ?? [],
    normalizedAnswers,
    currentFeatureArea,
    currentWorkflowState,
    likelyMidProject,
    requestedChangeBuckets
  }
  const knownFacts = collectKnownFacts(base)
  const contextConfidence = inferQuestionContextConfidence({
    promptText: params.promptText,
    requestBrief: params.requestBrief ?? null,
    structuredMemory: params.structuredMemory ?? null,
    contextStatus: projectContextPack.contextStatus,
    preferences: params.settings?.preferences ?? null,
    existingQuestions: params.existingQuestions ?? [],
    normalizedAnswers,
    likelyMidProject
  })
  const tensions = inferPromptModeTensions({
    requestBrief: params.requestBrief ?? null,
    goalContract: params.goalContract ?? null,
    structuredMemory: params.structuredMemory ?? null,
    likelyMidProject,
    currentWorkflowState,
    contextStatus: projectContextPack.contextStatus
  })

  return {
    ...base,
    knownFacts,
    contextConfidence,
    tensions
  }
}

function questionCategory(question: ClarificationQuestion): PromptModeQuestionCategory {
  const text = `${question.label} ${question.helper} ${question.options.join(" ")}`.toLowerCase()
  if (/\bprotect\b|\bpreserve\b|\bkeep\b/.test(text)) return "protected_surface"
  if (/\bpreserve\b|\buntouched\b|\bdo not change\b|\bprotect\b|\bscope\b|\bboundar/.test(text)) return "scope_boundary"
  if (/\bfeature\b|\barea\b|\bpart of the product\b|\bcurrent area\b/.test(text)) return "feature_context"
  if (/\bproof\b|\bconfirm\b|\bvalidate\b|\bcheck\b|\bworking\b/.test(text)) return "validation_expectation"
  if (/\boutput\b|\bresult\b|\bformat\b|\bdeliverable\b|\bsection\b/.test(text)) return "output_shape"
  if (/\bsuccess\b|\busable\b|\bquality\b|\bfinish line\b/.test(text)) return "success_criteria"
  return "generic"
}

const QUESTION_SIGNATURE_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "for",
  "of",
  "in",
  "on",
  "with",
  "this",
  "that",
  "next",
  "prompt",
  "answer",
  "should",
  "what",
  "which",
  "pick",
  "lock",
  "down",
  "before",
  "sending",
  "send",
  "current",
  "direction",
  "reeva",
  "assistant",
  "keep",
  "going",
  "first",
  "most",
  "kind",
  "type",
  "result",
  "request",
  "goal",
  "make",
  "more",
  "real",
  "safe",
  "path",
  "stay"
])

function buildQuestionSignatureTokens(question: ClarificationQuestion) {
  const normalized = softenPromptModeText(`${question.label} ${question.helper} ${question.options.join(" ")}`)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !QUESTION_SIGNATURE_STOPWORDS.has(token))

  return uniqueItems(normalized)
}

function buildQuestionSemanticSignature(question: ClarificationQuestion) {
  const tokens = buildQuestionSignatureTokens(question).sort()
  const normalizedLabel = softenPromptModeText(question.label).toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim()
  const tokenSignature = tokens.slice(0, 8).join("|")
  return `${questionCategory(question)}::${tokenSignature || normalizedLabel}`
}

function questionJaccardSimilarity(left: ClarificationQuestion, right: ClarificationQuestion) {
  const leftTokens = buildQuestionSignatureTokens(left)
  const rightTokens = buildQuestionSignatureTokens(right)
  if (!leftTokens.length || !rightTokens.length) return 0

  const rightSet = new Set(rightTokens)
  const intersection = leftTokens.filter((token) => rightSet.has(token)).length
  const union = new Set([...leftTokens, ...rightTokens]).size
  return union > 0 ? intersection / union : 0
}

function questionsAreSemanticallyDuplicate(left: ClarificationQuestion, right: ClarificationQuestion) {
  if (left.id === right.id) return true

  const leftLabel = softenPromptModeText(left.label).toLowerCase()
  const rightLabel = softenPromptModeText(right.label).toLowerCase()
  if (leftLabel && leftLabel === rightLabel) return true

  const leftSignature = buildQuestionSemanticSignature(left)
  const rightSignature = buildQuestionSemanticSignature(right)
  if (leftSignature === rightSignature) return true

  if (questionCategory(left) !== questionCategory(right)) return false

  const leftOptionSignature = uniqueItems(left.options.map((option) => softenPromptModeText(option).toLowerCase())).join("|")
  const rightOptionSignature = uniqueItems(right.options.map((option) => softenPromptModeText(option).toLowerCase())).join("|")
  if (leftOptionSignature && leftOptionSignature === rightOptionSignature) {
    return true
  }

  return questionJaccardSimilarity(left, right) >= 0.62
}

function dedupePromptModeQuestions(questions: ClarificationQuestion[], existingQuestions: ClarificationQuestion[] = []) {
  const kept: ClarificationQuestion[] = []

  for (const question of questions) {
    if (existingQuestions.some((existing) => questionsAreSemanticallyDuplicate(existing, question))) continue
    if (kept.some((existing) => questionsAreSemanticallyDuplicate(existing, question))) continue
    kept.push(question)
  }

  return kept
}

function isQuestionObvious(question: ClarificationQuestion, pack: PromptModeQuestionContextPack) {
  const text = `${question.label} ${question.helper} ${question.options.join(" ")}`.toLowerCase()
  const category = questionCategory(question)
  if (/\bwhich ai\b|\bchatgpt\b|\bclaude\b|\bgemini\b|\bmodel\b/.test(text)) return true
  if (pack.currentFeatureArea && /\bfeature\b|\barea\b|\bpart of the product\b/.test(text)) return true
  if (pack.projectContextPack.relevantFiles.length > 0 && /\bfiles?\b|\bmodules?\b|\bsurfaces?\b/.test(text)) return true
  if (
    (pack.currentFeatureArea || (pack.requestBrief?.scope.length ?? 0) > 0) &&
    /\bwhat kind of result\b|\bdeliverable\b|\boutput\b/.test(text)
  ) {
    return true
  }
  if (pack.goalContract?.deliverableType && /\bwhat kind of result\b|\bdeliverable\b|\boutput\b/.test(text)) return true
  if (
    category === "protected_surface" &&
    (pack.structuredMemory?.protectedAreas.length ?? 0) === 1 &&
    (pack.structuredMemory?.stableConstraints.length ?? 0) === 0 &&
    (pack.requestBrief?.nonGoals.length ?? 0) === 0 &&
    /\bprotect\b|\buntouched\b|\bdo not change\b|\bpreserve\b/.test(text)
  ) {
    return true
  }
  if ((pack.requestBrief?.successCriteria.length ?? 0) > 0 && /\bwhat makes\b|\bsuccess\b|\bquality bar\b|\bfinish line\b/.test(text)) return true
  if ((pack.requestBrief?.constraints.length ?? 0) > 0 && /\btime limit\b|\bservings?\b|\bcalories?\b|\bprotein\b|\bdiet\b/.test(text)) return true
  return false
}

function questionWorthAsking(question: ClarificationQuestion, pack: PromptModeQuestionContextPack) {
  if (isQuestionObvious(question, pack)) return false
  const category = questionCategory(question)
  if (pack.contextConfidence === "high" && category === "generic") return false
  if (category !== "generic" && !pack.tensions.includes(category as PromptModeQuestionContextPack["tensions"][number])) {
    if (pack.contextConfidence !== "low") return false
  }
  return true
}

function buildContextRecoveryQuestion(pack: PromptModeQuestionContextPack): ClarificationQuestion {
  return makeQuestionMorePlainLanguage({
    id: `prompt-${crypto.randomUUID()}`,
    label:
      pack.projectContextPack.contextStatus === "stale"
        ? "Should reeva keep going with the saved project context, or refresh it first?"
        : pack.projectContextPack.contextStatus === "conflicted"
          ? "Should reeva protect the saved project context, or should this request expand beyond it?"
          : "What should reeva assume about the current project?",
    helper:
      pack.projectContextPack.contextStatus === "stale"
        ? "The saved context is getting thin or outdated, so choose the safest path before deeper questions."
        : pack.projectContextPack.contextStatus === "conflicted"
          ? "The current request seems to push against saved protected scope or intent, so confirm the safest path first."
          : pack.likelyMidProject
        ? "There is not enough project context yet, so pick the safest assumption before we go deeper."
        : "Pick the safest assumption so the next prompt stays practical and low-risk.",
    mode: "single",
    options: [
      pack.projectContextPack.contextStatus === "stale"
        ? "Refresh the project markdown brief first"
        : "Keep this a narrow change in the current feature",
      "Protect existing behavior and architecture",
      pack.projectContextPack.contextStatus === "conflicted"
        ? "Let this request expand beyond the saved protected scope"
        : "Ask the assistant to explain the current area first",
      "Other"
    ]
  })
}

function applyAssumptionFirstStyle(question: ClarificationQuestion, pack: PromptModeQuestionContextPack): ClarificationQuestion {
  const category = questionCategory(question)
  const assumptionPrefix =
    category === "scope_boundary" || category === "protected_surface"
      ? "Assume this should stay a narrow change and avoid unrelated areas."
      : category === "validation_expectation"
        ? "Assume the assistant should prove the work, not just describe it."
        : category === "feature_context"
          ? "Assume this should stay within the current feature area."
          : category === "output_shape"
            ? "Assume we want one clear, usable result."
            : category === "success_criteria"
              ? "Assume the result should be ready to use, not just directionally correct."
              : ""

  if (!assumptionPrefix) return question
  if (question.helper.toLowerCase().startsWith("assume ")) return question

  return {
    ...question,
    helper: `${assumptionPrefix} ${question.helper}`.trim()
  }
}

function finalizePromptModeQuestions(questions: ClarificationQuestion[], pack: PromptModeQuestionContextPack) {
  const softened = sanitizePromptModeQuestions(questions).map((question) => applyAssumptionFirstStyle(question, pack))
  const filtered = dedupePromptModeQuestions(
    softened.filter((question) => questionWorthAsking(question, pack)),
    pack.existingQuestions
  )

  if (filtered.length) {
    if (
      (pack.projectContextPack.contextStatus === "stale" || pack.projectContextPack.contextStatus === "conflicted") &&
      pack.contextConfidence === "low"
    ) {
      return dedupePromptModeQuestions(
        [buildContextRecoveryQuestion(pack), ...filtered],
        pack.existingQuestions
      ).slice(0, pack.preferences?.collaborationMode === "fast" ? 1 : 2)
    }
    if (pack.preferences?.collaborationMode === "fast") return filtered.slice(0, 1)
    if (pack.preferences?.collaborationMode === "plan_first") return filtered.slice(0, 2)
    return filtered
  }
  if (
    pack.contextConfidence === "low" &&
    (pack.likelyMidProject ||
      pack.requestBrief?.riskLevel !== "low" ||
      pack.projectContextPack.contextStatus === "stale" ||
      pack.projectContextPack.contextStatus === "conflicted")
  ) {
    return dedupePromptModeQuestions([buildContextRecoveryQuestion(pack)], pack.existingQuestions)
  }

  return []
}

export function buildPromptModeSessionKey(promptText: string) {
  return promptText.replace(/\s+/g, " ").trim().toLowerCase()
}

function mapIntentToPromptIntent(intent: AnalyzePromptResponse["intent"]) {
  return intent ?? "OTHER"
}

function normalizePromptModeAnswers(params: {
  answerState: Record<string, string | string[]>
  otherAnswerState: Record<string, string>
}) {
  const { answerState, otherAnswerState } = params
  return Object.fromEntries(
    Object.entries(answerState)
      .map(([questionId, rawValue]) => [
        questionId,
        Array.isArray(rawValue)
          ? rawValue
              .flatMap((value) => {
                if (value === "Other") {
                  const typedOther = otherAnswerState[questionId]?.trim() ?? ""
                  return typedOther ? [typedOther] : []
                }
                const trimmed = value.trim()
                return trimmed ? [trimmed] : []
              })
              .join(", ")
          : rawValue === "Other"
            ? otherAnswerState[questionId]?.trim() ?? ""
            : rawValue.trim()
      ])
      .filter(([, value]) => value)
  ) as Record<string, string>
}

function toSentenceCase(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ""
  return trimmed[0].toUpperCase() + trimmed.slice(1)
}

function uniqueItems(values: string[]) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))]
}

const PROJECT_CONTEXT_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "your",
  "their",
  "user",
  "users",
  "flow",
  "page",
  "pages",
  "screen",
  "should",
  "must",
  "keep",
  "only",
  "avoid",
  "unchanged",
  "change",
  "changes",
  "result",
  "using",
  "used",
  "request",
  "requests",
  "explicitly",
  "scope"
])

function extractProjectContextTerms(values: string[]) {
  return uniqueItems(
    values
      .flatMap((value) => value.toLowerCase().match(/[a-z0-9][a-z0-9._/-]*/g) ?? [])
      .filter((token) => token.length >= 4)
      .filter((token) => !PROJECT_CONTEXT_STOPWORDS.has(token))
  )
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function looksLikeGenericScopeGuardrail(value: string) {
  return /\bpreserve existing architecture\b|\bavoid unrelated\b|\bsmallest safe change\b|\bkeep .* untouched\b|\bnarrowly scoped\b|\bscope tight\b|\bvalidation proof\b|\bdo not add unrelated extras\b/i.test(
    value
  )
}

function explicitProjectContextMismatch(value: string, requestTerms: string[]) {
  if (!requestTerms.length) return false

  const normalized = value.toLowerCase()
  const obviousForeignTopics = [
    "fab",
    "bottom-right",
    "replit.com",
    "3 seconds",
    "page load",
    "loading any replit.com page",
    "chrome",
    "reload",
    "dist/",
    "analysis modal",
    "logged out",
    "logged in",
    "sign-in prompt",
    "clicking the fab"
  ]
  if (!obviousForeignTopics.some((topic) => normalized.includes(topic))) return false

  return !requestTerms.some((term) => normalized.includes(term))
}

function projectContextRelevanceScore(value: string, requestTerms: string[]) {
  const normalized = value.toLowerCase()
  let score = 0

  for (const term of requestTerms) {
    if (term.length < 4) continue
    if (new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(normalized)) {
      score += term.length >= 8 ? 2 : 1
    }
  }

  if (/\bregistration flow\b|\bsign[- ]?up\b|\bonboarding\b/.test(normalized) && requestTerms.some((term) => /registration|gender|signup|onboarding/.test(term))) {
    score += 2
  }

  return score
}

function filterProjectContextItemsForRequest(items: string[], requestTerms: string[], limit: number) {
  return uniqueItems(items)
    .filter((item) => {
      if (!item.trim()) return false
      if (/^#+\s*/.test(item) || /^(user intent to preserve|definition of done|project overview|current state|constraints|relevant files|architecture)$/i.test(item.trim())) {
        return false
      }
      if (looksLikeGenericScopeGuardrail(item)) return true
      if (explicitProjectContextMismatch(item, requestTerms)) return false
      return projectContextRelevanceScore(item, requestTerms) >= 2
    })
    .slice(0, limit)
}

export function buildPromptModeRequestTerms(params: {
  sourcePrompt: string
  planningGoal?: string
  goalContract: GoalContract
  answeredPath?: string[]
  requestBrief?: RequestBrief | null
}) {
  return extractProjectContextTerms([
    params.sourcePrompt,
    params.planningGoal ?? "",
    params.requestBrief?.goal ?? "",
    ...(params.requestBrief?.scope ?? []),
    ...(params.requestBrief?.constraints ?? []),
    ...(params.requestBrief?.successCriteria ?? []),
    ...(params.answeredPath ?? []),
    ...(params.goalContract.hardConstraints.map((item) => item.label) ?? []),
    ...(params.goalContract.outputRequirements ?? [])
  ])
}

export function filterProjectContextPackByTerms(pack: ProjectContextPack, requestTerms: string[]) {
  let mandatoryCore: ProjectContextPack
  try {
    const activeRequiredDecisions = (pack.architecture?.decisions ?? []).filter(
      (decision) => decision.status === "active" && decision.strength === "required"
    )
    const mandatoryDataModel = (pack.architecture?.dataModel ?? []).filter((item) =>
      /\b(must not|data loss|delete|deletion|backup|restore|retain|retention|owner|belongs|private|sensitive)\b/i.test(item)
    )
    const mandatoryUserIntent = filterProjectContextItemsForRequest(
      pack.userIntent.filter((item) => /\b(must not|do not|never|preserve|keep|untouched)\b/i.test(item)),
      requestTerms,
      6
    )

    mandatoryCore = {
      projectContext: pack.projectContext,
      currentState: pack.currentState,
      importedContext: pack.importedContext,
      structuredMemory: pack.structuredMemory,
      architecture: pack.architecture
        ? {
            ...(pack.architecture.stack?.length ? { stack: [...pack.architecture.stack] } : {}),
            ...(mandatoryDataModel.length ? { dataModel: mandatoryDataModel } : {}),
            ...(pack.architecture.accessRules?.length ? { accessRules: [...pack.architecture.accessRules] } : {}),
            ...(activeRequiredDecisions.length ? { decisions: activeRequiredDecisions } : {})
          }
        : undefined,
      settings: pack.settings,
      contextStatus: pack.contextStatus,
      staleReasons: [...pack.staleReasons],
      conflictReasons: [...pack.conflictReasons],
      warnings: [...pack.warnings],
      featureArea: pack.featureArea,
      currentPhase: pack.currentPhase,
      currentWorkflowState: pack.currentWorkflowState,
      protectedAreas: filterProjectContextItemsForRequest(pack.protectedAreas, requestTerms, 6),
      stableConstraints: filterProjectContextItemsForRequest(pack.stableConstraints, requestTerms, 6),
      acceptedAssumptions: [],
      preferredPatterns: [],
      knownBadDirections: [],
      relevantFiles: [],
      blockers: [],
      definitionOfDone: [],
      userIntent: mandatoryUserIntent,
      aiDriftPatterns: [],
      preferenceSummary: pack.preferenceSummary,
      hints: []
    }
  } catch {
    return pack
  }

  try {
    const definitionOfDone = filterProjectContextItemsForRequest(pack.definitionOfDone, requestTerms, 4).filter(
      (item) => projectContextRelevanceScore(item, requestTerms) >= 3 && !explicitProjectContextMismatch(item, requestTerms)
    )
    const selectedUserIntent = filterProjectContextItemsForRequest(pack.userIntent, requestTerms, 4)
    const userIntent = uniqueItems([...mandatoryCore.userIntent, ...selectedUserIntent]).slice(0, 6)
    const aiDriftPatterns = filterProjectContextItemsForRequest(pack.aiDriftPatterns, requestTerms, 4)
    const knownBadDirections = filterProjectContextItemsForRequest(pack.knownBadDirections, requestTerms, 4)
    const relevantFiles = filterProjectContextItemsForRequest(pack.relevantFiles, requestTerms, 6)
    const blockers = filterProjectContextItemsForRequest(pack.blockers, requestTerms, 4)
    const acceptedAssumptions = filterProjectContextItemsForRequest(pack.acceptedAssumptions, requestTerms, 4)
    const preferredPatterns = filterProjectContextItemsForRequest(pack.preferredPatterns, requestTerms, 6)
    const selectedDataModel = filterProjectContextItemsForRequest(pack.architecture?.dataModel ?? [], requestTerms, 6)
    const selectedConventions = filterProjectContextItemsForRequest(pack.architecture?.conventions ?? [], requestTerms, 6)
    const selectedPreferredDecisions = (pack.architecture?.decisions ?? []).filter(
      (decision) =>
        decision.status === "active" &&
        decision.strength === "preferred" &&
        filterProjectContextItemsForRequest([decision.statement], requestTerms, 1).length > 0
    )
    const architectureDecisions = [
      ...(mandatoryCore.architecture?.decisions ?? []),
      ...selectedPreferredDecisions
    ]

    return {
      ...mandatoryCore,
      architecture: pack.architecture
        ? {
            ...(mandatoryCore.architecture ?? {}),
            ...((mandatoryCore.architecture?.dataModel?.length ?? 0) || selectedDataModel.length
              ? { dataModel: uniqueItems([...(mandatoryCore.architecture?.dataModel ?? []), ...selectedDataModel]) }
              : {}),
            ...(selectedConventions.length ? { conventions: selectedConventions } : {}),
            ...(architectureDecisions.length ? { decisions: architectureDecisions } : {})
          }
        : undefined,
      acceptedAssumptions,
      preferredPatterns,
      knownBadDirections,
      relevantFiles,
      blockers,
      definitionOfDone,
      userIntent,
      aiDriftPatterns
    } satisfies ProjectContextPack
  } catch {
    return mandatoryCore
  }
}

function filterProjectContextPackForPrompt(params: {
  pack: ProjectContextPack
  sourcePrompt: string
  planningGoal: string
  requestBrief: RequestBrief
  goalContract: GoalContract
}) {
  const requestTerms = buildPromptModeRequestTerms({
    sourcePrompt: params.sourcePrompt,
    planningGoal: params.planningGoal,
    goalContract: params.goalContract,
    requestBrief: params.requestBrief
  })

  return filterProjectContextPackByTerms(params.pack, requestTerms)
}

function stripTrailingPunctuation(value: string) {
  return value.trim().replace(/[.:;\s]+$/, "")
}

function singularizeConstraintTarget(value: string) {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return ""
  if (trimmed.endsWith("ies") && trimmed.length > 4) return `${trimmed.slice(0, -3)}y`
  if (trimmed.endsWith("oes") && trimmed.length > 4) return trimmed.slice(0, -2)
  if (trimmed.endsWith("s") && !trimmed.endsWith("ss") && trimmed.length > 3) return trimmed.slice(0, -1)
  return trimmed
}

function pluralizeConstraintTarget(value: string) {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return ""
  if (trimmed.endsWith("ies") || trimmed.endsWith("oes")) return trimmed
  if (trimmed.endsWith("y") && !/[aeiou]y$/.test(trimmed)) return `${trimmed.slice(0, -1)}ies`
  if (trimmed.endsWith("o")) return `${trimmed}es`
  if (trimmed.endsWith("s")) return trimmed
  return `${trimmed}s`
}

function normalizeExclusionTarget(value: string) {
  const trimmed = value
    .toLowerCase()
    .replace(/\b(?:and|or|but|while|that|which|keep|with|for|to|so|because)\b.*$/i, "")
    .replace(/\b(?:ingredient|ingredients|item|items)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()

  if (!trimmed) return ""

  return trimmed
}

function preferredExclusionTarget(value: string) {
  const normalizedTarget = normalizeExclusionTarget(value)
  if (!normalizedTarget) return ""
  if (/\b(?:dairy|gluten|soy)\b/.test(normalizedTarget) && !normalizedTarget.includes(" ")) return normalizedTarget
  if (!normalizedTarget.includes(" ")) return pluralizeConstraintTarget(normalizedTarget)
  return normalizedTarget
}

function splitIngredientList(value: string) {
  return value
    .split(/,|\/|\band\b/gi)
    .map((item) => normalizeExclusionTarget(item))
    .filter(Boolean)
}

function extractExclusionTargets(text: string) {
  const extracted = new Set<string>()
  const source = text.replace(/[()\n]/g, " ")
  const patterns = [
    /\b(?:without|no|exclude|excluding|avoid)\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,3})/gi,
    /\bdo not use\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,3})/gi,
    /\b([a-z][a-z-]*)-free\b/gi
  ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const target = normalizeExclusionTarget(match[1] ?? "")
      if (!target) continue
      extracted.add(target)
    }
  }

  const dislikePatterns = [
    /\b(?:any\s+ingredients\s+you\s+dislike\??|ingredients\s+you\s+dislike\??|disliked\s+ingredients?\??|ingredients\s+to\s+avoid\??|avoid(?:ing)?\s+ingredients?\??)\s*[:\-]\s*([^\n.]+)/gi
  ]

  for (const pattern of dislikePatterns) {
    for (const match of source.matchAll(pattern)) {
      for (const item of splitIngredientList(match[1] ?? "")) {
        extracted.add(item)
      }
    }
  }

  return [...extracted]
}

function formatExplicitExclusionConstraint(target: string) {
  const normalizedTarget = preferredExclusionTarget(target)
  if (!normalizedTarget) return ""

  if (/\b(?:dairy|nut|egg|gluten|soy)\b/.test(normalizedTarget) && !normalizedTarget.includes(" ")) {
    return `Keep it ${normalizedTarget}-free.`
  }

  return `Do not use ${normalizedTarget}.`
}

function looksLikeOutputFormatHint(value: string) {
  const normalized = value.toLowerCase()
  return /step-by-step|steps|ingredients|quantities|html|css|javascript|json|table|bullets|outline|calories|per serving|format|output|list only/.test(
    normalized
  )
}

function looksLikeStyleHint(value: string) {
  const normalized = value.toLowerCase()
  return /clean|polished|professional|readable|realistic|natural|home kitchen|weekday|usable|starter|clear|concise/.test(normalized)
}

function isGenericStyleGuardrail(value: string) {
  const normalized = value.toLowerCase().replace(/\s+/g, " ").trim()
  return (
    normalized === "keep the request clear, specific, and easy for the ai assistant to follow." ||
    normalized === "keep the request clear, specific, and easy for the ai assistant to follow"
  )
}

function looksLikeConstraint(value: string) {
  const normalized = value.toLowerCase()
  return /no |without |exclude|only|under |less|stovetop|minutes?|servings?|for \d+|limit|keep|must|do not|avoid|[a-z-]+-free/.test(
    normalized
  )
}

function dedupeCaseInsensitive(items: string[]) {
  const seen = new Set<string>()
  const output: string[] = []
  for (const item of items.map((entry) => entry.trim()).filter(Boolean)) {
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(item)
  }
  return output
}

function buildPromptModeOutputGuidance(intent: AnalyzePromptResponse["intent"]) {
  switch (intent) {
    case "DEBUG":
      return [
        "State the current issue clearly before proposing changes.",
        "Ask for one focused diagnostic or fix path, not several competing rewrites.",
        "Request concrete confirmation of what changed and how to verify it."
      ]
    case "BUILD":
      return [
        "Turn the draft into a polished build request with a clear deliverable.",
        "Preserve all explicit format, scope, and constraint details.",
        "Ask for a response that is directly usable as a strong first draft."
      ]
    case "EXPLAIN":
      return [
        "Frame the request as a clear explanation goal.",
        "Preserve the chosen depth, examples, and clarity constraints.",
        "Keep the wording natural and direct instead of robotic."
      ]
    default:
      return [
        "Rewrite the draft into a polished, send-ready prompt.",
        "Preserve the real constraints and remove stitched phrasing.",
        "Keep the request focused on one clear next step."
      ]
  }
}

function looksLikeCodingAssistantRequest(params: {
  sourcePrompt: string
  localAnalysis: AnalyzePromptResponse
  goalContract: GoalContract
  requestBrief: RequestBrief
}) {
  const normalized = params.sourcePrompt.toLowerCase()
  return (
    params.localAnalysis.intent === "DEBUG" ||
    /\b(replit|agent|code|coding|repo|repository|app|feature|bug|fix|component|route|screen|api|database|schema|auth|frontend|backend|ui|ux|refactor|deploy)\b/.test(
      normalized
    ) ||
    /\bhtml\b|\bcss\b|\bjavascript\b|\btypescript\b|\breact\b|\bnext\b|\bnode\b/.test(normalized) ||
    params.requestBrief.riskLevel !== "low" ||
    Boolean(params.goalContract.deliverableType && /html|code|prompt|plan|spec/i.test(params.goalContract.deliverableType))
  )
}

function buildPromptModeCollaborationContract(params: {
  sourcePrompt: string
  localAnalysis: AnalyzePromptResponse
  goalContract: GoalContract
  requestBrief: RequestBrief
  preferences?: ProjectPreferenceSettings | null
  projectContextPack?: ProjectContextPack | null
}) {
  if (!looksLikeCodingAssistantRequest(params)) {
    return {
      enabled: false,
      responseRequirements: [] as string[],
      contractInstructions: [] as string[]
    }
  }

  const requiresPlanFirst =
    params.preferences?.collaborationMode === "plan_first" || params.requestBrief.riskLevel === "high"

  const responseRequirements = requiresPlanFirst
    ? [
        "Start by confirming what you understood from the request.",
        "State the exact scope you will change.",
        "State what you will leave untouched.",
        "Call out any important risks, unknowns, or assumptions.",
        "State how you will validate the work or what proof you will provide."
      ]
    : [
        "Briefly confirm the scoped change you will make.",
        "Keep the implementation narrowly scoped and leave unrelated areas untouched.",
        "Report what changed and how you validated it."
      ]

  const contractInstructions = [
    "This prompt is for a coding assistant. Keep the scope tight and preserve the existing product architecture unless the user explicitly asks for a broader change."
  ]

  if (params.preferences?.scopePreference === "narrow") {
    contractInstructions.push(
      "Default to the smallest safe change that solves the request. Avoid unrelated edits unless the user explicitly expands the scope."
    )
  }

  if (requiresPlanFirst) {
    contractInstructions.push(
      "Before you make broad edits, return a short collaboration block with these headings: What I understood, What I will change, What I will not change, Risks or unknowns, Validation plan."
    )
    contractInstructions.push(
      "If the request touches multiple areas, architecture, data flow, auth, billing, or anything risky, do not jump straight into broad implementation. Return the plan first and wait for confirmation if needed."
    )
  } else {
    contractInstructions.push(
      "If the change is clearly small and safe, you may implement directly. Keep any confirmation brief and focused on scope plus validation."
    )
  }

  if (params.localAnalysis.intent === "DEBUG") {
    responseRequirements.push("Name the first diagnostic checkpoint and the proof that would confirm the bug is fixed.")
  }

  if (params.preferences?.proofPreference === "proof_required") {
    responseRequirements.push("Do not claim success without concrete validation proof.")
  }

  if (params.preferences?.proofPreference === "files_first") {
    responseRequirements.push("Name the files or surfaces you changed before you claim success.")
    responseRequirements.push("After listing the changed files, provide the validation proof that shows the result works.")
  }

  if (params.preferences?.explanationStyle === "plain_language") {
    contractInstructions.push(
      "Keep the collaboration block understandable for a non-technical product user. Use plain language wherever possible."
    )
  }

  if ((params.projectContextPack?.protectedAreas.length ?? 0) > 0) {
    contractInstructions.push(
      `Unless the user explicitly expands scope, keep these protected areas untouched: ${params.projectContextPack!.protectedAreas.join(", ")}.`
    )
  }

  if ((params.projectContextPack?.definitionOfDone.length ?? 0) > 0) {
    responseRequirements.push(
      `Validate the result against this project definition of done: ${params.projectContextPack!.definitionOfDone.slice(0, 2).join("; ")}`
    )
  }

  if ((params.projectContextPack?.aiDriftPatterns.length ?? 0) > 0) {
    contractInstructions.push(
      `Avoid these repeated AI drift patterns: ${params.projectContextPack!.aiDriftPatterns.slice(0, 2).join("; ")}.`
    )
  }

  return {
    enabled: true,
    responseRequirements: uniqueItems(responseRequirements),
    contractInstructions
  }
}

export function buildPromptModePromptPlan(params: {
  sourcePrompt: string
  planningGoal: string
  requestBrief?: RequestBrief | null
  localAnalysis: AnalyzePromptResponse
  answeredPath: string[]
  constraints: string[]
  importedContext?: ImportedProjectContextRecord | null
  settings?: ProjectSettingsRecord | null
  projectContext?: string
  currentState?: string
  structuredMemory?: StructuredProjectMemory | null
}) {
  const {
    sourcePrompt,
    planningGoal,
    requestBrief: providedRequestBrief,
    localAnalysis,
    answeredPath,
    constraints,
    projectContext = "",
    currentState = "",
    structuredMemory = null
  } = params
  const projectContextPack = buildProjectContextPack({
    projectContext,
    currentState,
    importedContext: params.importedContext ?? null,
    structuredMemory,
    settings: params.settings ?? null,
    currentRequestText: sourcePrompt
  })
  const preferences = params.settings?.preferences ?? null

  const goalContract = normalizeGoalContract({
    promptText: sourcePrompt,
    taskFamily: mapIntentToPromptIntent(localAnalysis.intent).toLowerCase(),
    answeredPath,
    constraints
  })
  const requestBrief =
    providedRequestBrief ??
    buildPromptModeRequestBrief({
      sourcePrompt,
      localAnalysis,
      goalContract,
      importedContext: params.importedContext ?? null,
      settings: params.settings ?? null,
      structuredMemory,
      projectContext,
      currentState,
      answeredPath,
      constraints
    })
  const filteredProjectContextPack = filterProjectContextPackForPrompt({
    pack: projectContextPack,
    sourcePrompt,
    planningGoal,
    requestBrief,
    goalContract
  })
  const collaborationContract = buildPromptModeCollaborationContract({
    sourcePrompt,
    localAnalysis,
    goalContract,
    requestBrief,
    preferences,
    projectContextPack: filteredProjectContextPack
  })
  const preferenceSummary = preferences ? formatProjectPreferenceSummary(preferences) : ""
  const contextPackSummary = formatProjectContextPackSummary(filteredProjectContextPack)
  const clarifiedChoices = uniqueItems(answeredPath)
  const retainedConstraints = uniqueItems(goalContract.hardConstraints.map((item) => item.label))
    .concat(uniqueItems(localAnalysis.missing_elements.slice(0, 2).map((item) => `Resolve this clearly: ${item}`)))
    .slice(0, 6)
  const outputGuidance = buildPromptModeOutputGuidance(localAnalysis.intent)
  const outputRequirements = uniqueItems(goalContract.outputRequirements)
  const softPreferences = uniqueItems(goalContract.softPreferences.map((item) => item.value || item.label))

  const basePrompt = [
    "Rewrite the user's typed draft into a strong, polished prompt they can send next.",
    "Keep the original intent, but make the final prompt feel clear, deliberate, and high quality.",
    `Original Draft\n${sourcePrompt.trim()}`,
    `Planning Goal\n${planningGoal.trim()}`,
    `Inferred PM Brief\n${formatRequestBriefSummary(requestBrief)}`,
    goalContract.deliverableType ? `Requested Deliverable\n${goalContract.deliverableType}` : "",
    clarifiedChoices.length
      ? `Clarified Choices\n${clarifiedChoices.map((item, index) => `${index + 1}. ${toSentenceCase(item)}`).join("\n")}`
      : "",
    retainedConstraints.length
      ? `Constraints To Preserve\n${retainedConstraints.map((item, index) => `${index + 1}. ${toSentenceCase(item)}`).join("\n")}`
      : "",
    outputRequirements.length
      ? `Output Requirements\n${outputRequirements.map((item, index) => `${index + 1}. ${toSentenceCase(item)}`).join("\n")}`
      : "",
    softPreferences.length
      ? `Quality Targets\n${softPreferences.map((item, index) => `${index + 1}. ${toSentenceCase(item)}`).join("\n")}`
      : "",
    preferenceSummary ? `Project Preferences\n${preferenceSummary}` : "",
    contextPackSummary ? `Project Context Pack\n${contextPackSummary}` : "",
    collaborationContract.enabled
      ? `AI Collaboration Contract\n${collaborationContract.contractInstructions.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
      : "",
    `Output Guidance\n${outputGuidance.map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
    "Return only the final prompt text. Do not explain your edits."
  ]
    .filter(Boolean)
    .join("\n\n")

  const localFallbackSections = [
    planningGoal.trim(),
    `Inferred PM Brief:\n${formatRequestBriefSummary(requestBrief)}`,
    clarifiedChoices.length ? `Requirements:\n${clarifiedChoices.map((item) => `- ${toSentenceCase(item)}`).join("\n")}` : "",
    retainedConstraints.length
      ? `Keep these constraints:\n${retainedConstraints.map((item) => `- ${toSentenceCase(item)}`).join("\n")}`
      : "",
    outputRequirements.length
      ? `Output requirements:\n${outputRequirements.map((item) => `- ${toSentenceCase(item)}`).join("\n")}`
      : "",
    preferenceSummary ? `Project preferences:\n${preferenceSummary}` : "",
    collaborationContract.enabled
      ? `AI collaboration contract:\n${collaborationContract.contractInstructions.map((item) => `- ${item}`).join("\n")}`
      : "",
    contextPackSummary ? `Project context pack:\n${contextPackSummary}` : ""
  ].filter(Boolean)

  const localFallback = `${localFallbackSections.join("\n\n")}\n\nReturn only the finished result in a polished, ready-to-use form.`

  return {
    basePrompt,
    localFallback
  }
}

export function formatPromptModeStructuredDraft(params: {
  sourcePrompt: string
  planningGoal: string
  refinedPrompt: string
  requestBrief?: RequestBrief | null
  localAnalysis: AnalyzePromptResponse
  answeredPath: string[]
  constraints: string[]
  importedContext?: ImportedProjectContextRecord | null
  settings?: ProjectSettingsRecord | null
  structuredMemory?: StructuredProjectMemory | null
  projectContext?: string
  currentState?: string
}) {
  return buildPromptModePromptContract(params).renderedPrompt
}

export function buildPromptModePromptContract(params: {
  sourcePrompt: string
  planningGoal: string
  refinedPrompt: string
  requestBrief?: RequestBrief | null
  localAnalysis: AnalyzePromptResponse
  answeredPath: string[]
  constraints: string[]
  importedContext?: ImportedProjectContextRecord | null
  settings?: ProjectSettingsRecord | null
  structuredMemory?: StructuredProjectMemory | null
  projectContext?: string
  currentState?: string
}): PromptContract {
  const { sourcePrompt, planningGoal, refinedPrompt, localAnalysis, answeredPath, constraints, requestBrief: providedRequestBrief } = params
  const renderedPrompt = refinedPrompt || planningGoal || sourcePrompt
  const sourceGoalContract = normalizeGoalContract({
    promptText: sourcePrompt,
    taskFamily: mapIntentToPromptIntent(localAnalysis.intent).toLowerCase(),
    answeredPath,
    constraints
  })
  const projectContextPack = buildProjectContextPack({
    projectContext: params.projectContext ?? "",
    currentState: params.currentState ?? "",
    importedContext: params.importedContext ?? null,
    structuredMemory: params.structuredMemory ?? null,
    settings: params.settings ?? null,
    currentRequestText: sourcePrompt
  })
  const requestBrief =
    providedRequestBrief ??
    buildPromptModeRequestBrief({
      sourcePrompt,
      localAnalysis,
      goalContract: sourceGoalContract,
      importedContext: params.importedContext ?? null,
      settings: params.settings ?? null,
      structuredMemory: params.structuredMemory ?? null,
      projectContext: params.projectContext ?? "",
      currentState: params.currentState ?? "",
      answeredPath,
      constraints
    })
  const filteredProjectContextPack = filterProjectContextPackForPrompt({
    pack: projectContextPack,
    sourcePrompt,
    planningGoal,
    requestBrief,
    goalContract: sourceGoalContract
  })
  const preferences = params.settings?.preferences ?? null
  const renderedGoalContract = normalizeGoalContract({
    promptText: renderedPrompt,
    taskFamily: mapIntentToPromptIntent(localAnalysis.intent).toLowerCase(),
    answeredPath,
    constraints
  })
  const collaborationContract = buildPromptModeCollaborationContract({
    sourcePrompt,
    localAnalysis,
    goalContract: sourceGoalContract,
    requestBrief,
    preferences,
    projectContextPack: filteredProjectContextPack
  })
  const protectedAreaBoundaries = filteredProjectContextPack.protectedAreas.filter(
    (item) => !looksLikeGenericScopeGuardrail(item)
  )
  const goalContract = createGoalContract({
    ...sourceGoalContract,
    userGoal: renderedGoalContract.userGoal,
    deliverableType: renderedGoalContract.deliverableType || sourceGoalContract.deliverableType,
    hardConstraints: [...sourceGoalContract.hardConstraints, ...renderedGoalContract.hardConstraints],
    softPreferences: [...sourceGoalContract.softPreferences, ...renderedGoalContract.softPreferences],
    outputRequirements: [
      ...sourceGoalContract.outputRequirements,
      ...renderedGoalContract.outputRequirements,
      ...collaborationContract.responseRequirements
    ],
    assumptions: [
      ...sourceGoalContract.assumptions,
      ...renderedGoalContract.assumptions,
      ...(preferences?.scopePreference === "narrow"
        ? ["Keep the implementation narrowly scoped unless the user explicitly expands it."]
        : []),
      ...(preferences?.explanationStyle === "plain_language"
        ? ["Explain the plan and validation in plain language for a non-technical user."]
        : []),
      ...(collaborationContract.enabled
        ? ["Preserve existing architecture and avoid unrelated changes unless the user explicitly asks for them."]
        : []),
      ...(protectedAreaBoundaries.length
        ? [`Keep these protected areas untouched unless the user explicitly expands the scope: ${protectedAreaBoundaries.join(", ")}.`]
        : []),
      ...filteredProjectContextPack.userIntent.slice(0, 2)
    ],
    riskFlags: [...sourceGoalContract.riskFlags, ...renderedGoalContract.riskFlags]
  })

  return buildPromptContractFromGoalContract(goalContract, {
    acceptanceCriteria: requestBrief.successCriteria
  })
}

export function buildPromptModeRequestBrief(params: {
  sourcePrompt: string
  localAnalysis: AnalyzePromptResponse
  goalContract?: GoalContract | null
  importedContext?: ImportedProjectContextRecord | null
  settings?: ProjectSettingsRecord | null
  structuredMemory?: StructuredProjectMemory | null
  projectContext?: string
  currentState?: string
  answeredPath?: string[]
  constraints?: string[]
}) {
  const goalContract = params.goalContract ?? null
  const rawProjectContextPack = buildProjectContextPack({
    projectContext: params.projectContext ?? "",
    currentState: params.currentState ?? "",
    importedContext: params.importedContext ?? null,
    structuredMemory: params.structuredMemory ?? null,
    settings: params.settings ?? null,
    currentRequestText: params.sourcePrompt
  })
  const projectContextPack = goalContract
    ? filterProjectContextPackByTerms(
        rawProjectContextPack,
        buildPromptModeRequestTerms({
          sourcePrompt: params.sourcePrompt,
          goalContract,
          answeredPath: params.answeredPath ?? []
        })
      )
    : rawProjectContextPack
  const preferences = params.settings?.preferences ?? null
  return buildRequestBrief({
    promptText: params.sourcePrompt,
    intent: params.localAnalysis.intent,
    deliverableType: goalContract?.deliverableType ?? null,
    hardConstraints: dedupeCaseInsensitive([
      ...(goalContract?.hardConstraints.map((item) => item.label) ?? []),
      ...(params.constraints ?? []),
      ...(preferences?.scopePreference === "narrow"
        ? ["Keep the change narrowly scoped and avoid unrelated areas."]
        : []),
      ...projectContextPack.protectedAreas.map((item) => `Keep ${item} untouched unless explicitly requested.`),
      ...projectContextPack.stableConstraints.slice(0, 4)
    ]),
    outputRequirements: dedupeCaseInsensitive(goalContract?.outputRequirements ?? []),
    softPreferences: dedupeCaseInsensitive([
      ...(goalContract?.softPreferences ?? []).map((item) => item.value || item.label),
      ...(preferences?.explanationStyle === "plain_language" ? ["Use plain language in explanations."] : []),
      ...(preferences?.collaborationMode === "plan_first" ? ["Return a plan before broad implementation."] : []),
      ...projectContextPack.userIntent.slice(0, 3),
      ...projectContextPack.aiDriftPatterns.slice(0, 2).map((item) => `Avoid this prior AI drift: ${item}`)
    ]),
    answeredPath: params.answeredPath ?? [],
    missingElements: params.localAnalysis.missing_elements,
    suggestions: params.localAnalysis.suggestions
  })
}

export function buildPromptModeSeedAnalysis(params: {
  promptText: string
  platform: Attempt["platform"]
  beforeIntent: AnalyzePromptResponse["intent"] | null | undefined
  sessionSummary?: Partial<SessionSummary> | null
}) {
  const { promptText, platform, beforeIntent, sessionSummary } = params
  const localAnalysis = analyzePromptLocally(promptText, sessionSummary ?? undefined)
  const checklistLabels = (localAnalysis.missing_elements.length
    ? localAnalysis.missing_elements
    : buildFallbackChecklist(localAnalysis.intent)
  )
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3)

  const base = buildAfterPlaceholder(
    `Planning the next prompt around this goal: ${promptText.trim()}`,
    checklistLabels.length
      ? [`Clarify the strongest missing part first: ${checklistLabels[0]}`]
      : ["Clarify the next step before sending the prompt."],
    ""
  )

  const planningAttempt = buildPlanningAttemptFromDraft(
    promptText,
    platform,
    buildPlanningAttemptIntentFromPrompt({
      prompt: promptText,
      beforeIntent
    })
  )

  const seed: AfterAnalysisResult = {
    ...base,
    status: "PARTIAL",
    confidence: checklistLabels.length > 1 ? "medium" : "high",
    confidence_reason: checklistLabels.length
      ? `The next prompt still needs sharper guidance around: ${checklistLabels[0]}.`
      : "The next prompt can still be sharpened before sending.",
    findings: [`Use the typed draft as the direction for the next-step tree.`],
    issues: checklistLabels.map((item) => `Clarify: ${item}`),
    prompt_strategy: "narrow_scope",
    stage_1: {
      assistant_action_summary: "reeva AI is shaping the next prompt before it is sent.",
      claimed_evidence: checklistLabels,
      response_mode: "suggested",
      scope_assessment: "moderate"
    },
    stage_2: {
      addressed_criteria: [],
      missing_criteria: checklistLabels,
      constraint_risks: [],
      problem_fit: "correct",
      analysis_notes: localAnalysis.suggestions.slice(0, 3)
    },
    verdict: {
      status: "PARTIAL",
      confidence: checklistLabels.length > 1 ? "medium" : "high",
      confidence_reason: checklistLabels.length
        ? `The draft direction still leaves ${checklistLabels[0].toLowerCase()} unclear.`
        : "The draft direction can still be sharpened.",
      findings: [`Use the typed draft as the planning goal.`],
      issues: checklistLabels.map((item) => `Clarify: ${item}`)
    },
    next_prompt_output: {
      next_prompt: "",
      prompt_strategy: "narrow_scope",
      next_prompt_explanation: "",
      expected_outcome: ""
    },
    acceptance_checklist: checklistLabels.map((label) => ({
      label,
      status: "not_sure" as const
    })),
    used_fallback_intent: true
  }

  return {
    localAnalysis,
    planningAttempt,
    seedAnalysis: seed
  }
}

export function buildPromptModeFallbackQuestions(params: {
  promptText: string
  localAnalysis: AnalyzePromptResponse
  goalContract?: GoalContract | null
  requestBrief?: RequestBrief | null
  importedContext?: ImportedProjectContextRecord | null
  settings?: ProjectSettingsRecord | null
  structuredMemory?: StructuredProjectMemory | null
  projectContext?: string
  currentState?: string
  existingQuestions?: ClarificationQuestion[]
}) {
  const { promptText, localAnalysis, goalContract } = params
  const pack = buildPromptModeQuestionContextPack({
    promptText,
    localAnalysis,
    goalContract: goalContract ?? null,
    requestBrief: params.requestBrief ?? null,
    structuredMemory: params.structuredMemory ?? null,
    importedContext: params.importedContext ?? null,
    settings: params.settings ?? null,
    projectContext: params.projectContext ?? "",
    currentState: params.currentState ?? "",
    existingQuestions: params.existingQuestions ?? []
  })
  const requiredCoverageQuestions = dedupePromptModeQuestions(
    buildMissingBucketQuestions(pack),
    params.existingQuestions ?? []
  )
  if (requiredCoverageQuestions.length) {
    return buildInitialPlannerState(requiredCoverageQuestions, 1)
  }
  const template = deriveGoalAwareFallbackQuestion({
    promptText,
    localAnalysis,
    goalContract,
    existingQuestions: params.existingQuestions ?? [],
    likelyMidProject: pack.likelyMidProject
  })
  const question: ClarificationQuestion = {
    id: `prompt-${crypto.randomUUID()}`,
    label: template.label,
    helper: template.helper,
    mode: "single",
    options: template.options
  }

  const finalized = finalizePromptModeQuestions([question], pack)
  if (finalized.length) {
    return buildInitialPlannerState(finalized, 1)
  }

  const distinctFallback = dedupePromptModeQuestions([makeQuestionMorePlainLanguage(question)], params.existingQuestions ?? [])
  return buildInitialPlannerState(distinctFallback, 1)
}

export function buildPromptModeQuestionRequest(params: {
  promptText: string
  localAnalysis: AnalyzePromptResponse
  requestBrief?: RequestBrief | null
  goalContract?: GoalContract | null
  importedContext?: ImportedProjectContextRecord | null
  settings?: ProjectSettingsRecord | null
  structuredMemory?: StructuredProjectMemory | null
  projectContext?: string
  currentState?: string
  existingQuestions: ClarificationQuestion[]
  answerState: Record<string, string | string[]>
  otherAnswerState: Record<string, string>
  surface: PromptSurface
  sessionSummary?: Partial<SessionSummary> | null
}): ExtendQuestionsRequest {
  const { promptText, localAnalysis, existingQuestions, answerState, otherAnswerState, surface, sessionSummary } = params
  const normalizedAnswers = normalizePromptModeAnswers({
    answerState,
    otherAnswerState
  })
  const pack = buildPromptModeQuestionContextPack({
    promptText,
    localAnalysis,
    goalContract: params.goalContract ?? null,
    requestBrief: params.requestBrief ?? null,
    structuredMemory: params.structuredMemory ?? null,
    importedContext: params.importedContext ?? null,
    settings: params.settings ?? null,
    projectContext: params.projectContext ?? "",
    currentState: params.currentState ?? "",
    existingQuestions,
    answerState,
    otherAnswerState
  })

  return {
    prompt: promptText,
    surface,
    intent: mapIntentToPromptIntent(localAnalysis.intent),
    existing_questions: existingQuestions,
    answers: {
      planning_goal: promptText,
      _request_brief: params.requestBrief ? formatRequestBriefSummary(params.requestBrief) : "",
      _project_context: params.projectContext?.trim() ?? "",
      _current_state: params.currentState?.trim() ?? "",
      _structured_memory: "",
      _project_preferences: params.settings ? formatProjectPreferenceSummary(params.settings.preferences) : "",
      _project_context_pack: formatProjectContextPackSummary(pack.projectContextPack),
      _workflow_state: pack.currentWorkflowState ?? "",
      _current_feature_area: pack.currentFeatureArea,
      _question_context_confidence: pack.contextConfidence,
      _question_tensions: pack.tensions.join(", "),
      ...normalizedAnswers
    },
    sessionSummary: sessionSummary ?? undefined
  }
}

export function selectPromptModeQuestions(params: {
  goalContract?: GoalContract | null
  requestBrief?: RequestBrief | null
  localAnalysis: AnalyzePromptResponse
  questions: ClarificationQuestion[]
  promptText: string
  importedContext?: ImportedProjectContextRecord | null
  settings?: ProjectSettingsRecord | null
  structuredMemory?: StructuredProjectMemory | null
  projectContext?: string
  currentState?: string
  existingQuestions?: ClarificationQuestion[]
  answerState?: Record<string, string | string[]>
  otherAnswerState?: Record<string, string>
}) {
  const pack = buildPromptModeQuestionContextPack({
    promptText: params.promptText,
    localAnalysis: params.localAnalysis,
    goalContract: params.goalContract ?? null,
    requestBrief: params.requestBrief ?? null,
    structuredMemory: params.structuredMemory ?? null,
    importedContext: params.importedContext ?? null,
    settings: params.settings ?? null,
    projectContext: params.projectContext ?? "",
    currentState: params.currentState ?? "",
    existingQuestions: params.existingQuestions ?? [],
    answerState: params.answerState ?? {},
    otherAnswerState: params.otherAnswerState ?? {}
  })
  const goalAwareQuestions = filterGoalAwareQuestions({
    goalContract: params.goalContract,
    questions: params.questions
  })
  const filtered = finalizePromptModeQuestions(goalAwareQuestions, pack)
  const preservedMultiChangeQuestions =
    (pack.goalContract?.deliverableType ?? "") === "multi_change"
      ? dedupePromptModeQuestions(
          goalAwareQuestions.filter((question) =>
            pack.requestedChangeBuckets.some((bucket) => questionTouchesBucket(question, bucket))
          ),
          [...(params.existingQuestions ?? []), ...filtered]
        )
      : []

  const requiredCoverageQuestions = dedupePromptModeQuestions(
    buildMissingBucketQuestions(pack, [...filtered, ...preservedMultiChangeQuestions]),
    [...(params.existingQuestions ?? []), ...filtered, ...preservedMultiChangeQuestions]
  )
  const combined = dedupePromptModeQuestions(
    [...filtered, ...preservedMultiChangeQuestions, ...requiredCoverageQuestions],
    params.existingQuestions ?? []
  )

  if (combined.length) return combined
  return dedupePromptModeQuestions(
    buildPromptModeFallbackQuestions({
      promptText: params.promptText,
      localAnalysis: params.localAnalysis,
      goalContract: params.goalContract,
      requestBrief: params.requestBrief ?? null,
      importedContext: params.importedContext ?? null,
      settings: params.settings ?? null,
      structuredMemory: params.structuredMemory ?? null,
      projectContext: params.projectContext ?? "",
      currentState: params.currentState ?? "",
      existingQuestions: params.existingQuestions ?? []
    }).questionHistory,
    params.existingQuestions ?? []
  )
}
