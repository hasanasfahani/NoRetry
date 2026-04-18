import type { GoalContract } from "../../goal/types"
import type { ReviewPromptModeV2Question } from "../types"
import type { ReviewPromptModeV2RequestType } from "./request-types"
import { resolvePromptModeV2TemplateKind } from "./request-types"
import type { ReviewPromptModeV2QuestionTemplate, ReviewPromptModeV2SectionState } from "./section-schemas"

type BuildGroundedPromptModeV2QuestionInput = {
  taskType: ReviewPromptModeV2RequestType
  promptText: string
  goalContract: GoalContract | null
  section: ReviewPromptModeV2SectionState
  template: ReviewPromptModeV2QuestionTemplate
  additionalNotes: string[]
  id: string
}

type BuildPromptModeV2FollowupQuestionInput = {
  taskType: ReviewPromptModeV2RequestType
  promptText: string
  goalContract: GoalContract | null
  section: ReviewPromptModeV2SectionState
  additionalNotes: string[]
  id: string
  depth: "secondary" | "tertiary"
}

type PromptModeV2GroundedQuestionShape = {
  label: string
  helper: string
  options?: string[]
  mode?: "single" | "multi" | "text"
}

type PromptModeV2Domain =
  | "meal"
  | "recipe"
  | "bug"
  | "product"
  | "shipping"
  | "prompt"
  | "code"
  | "rewrite"
  | "general"

type PromptModeV2TopicContext = {
  topic: string
  artifactLabel: string
  domain: PromptModeV2Domain
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeLower(value: string) {
  return normalize(value).toLowerCase()
}

function stripStructuredPrefix(promptText: string) {
  return promptText
    .replace(/^task\s*\/\s*goal:\s*/i, "")
    .replace(/^goal:\s*/i, "")
    .replace(/^task:\s*/i, "")
    .trim()
}

function firstMeaningfulSentence(promptText: string) {
  const cleaned = stripStructuredPrefix(promptText)
  const firstSentence = cleaned.split(/\n+|(?<=[.!?])\s+/).map((part) => part.trim()).find(Boolean)
  return normalize(firstSentence ?? cleaned)
}

function shortenTopic(topic: string, maxWords = 10) {
  const words = normalize(topic).split(/\s+/).filter(Boolean)
  if (words.length <= maxWords) return words.join(" ")
  return `${words.slice(0, maxWords).join(" ")}...`
}

function inferArtifactLabel(goalContract: GoalContract | null, taskType: ReviewPromptModeV2RequestType) {
  const templateKind = resolvePromptModeV2TemplateKind(taskType)
  switch (goalContract?.deliverableType) {
    case "recipe":
      return "recipe"
    case "prompt":
      return "prompt"
    case "html_file":
      return "page"
    case "recommendation":
      return "recommendation"
    case "research":
      return "research output"
    case "rewrite":
      return "rewrite"
    default:
      break
  }

  switch (taskType) {
    case "creation":
      return "result"
    case "modification":
      return "change"
    case "problem_solving":
      return "fix"
    case "product_thinking":
      return templateKind === "creation" ? "recommendation" : "decision"
    case "shipping":
      return templateKind === "creation" ? "shipping plan" : "shipping plan"
    case "prompt_optimization":
      return templateKind === "creation" ? "optimized prompt" : "prompt"
  }
}

function inferDomain(promptText: string, goalContract: GoalContract | null, taskType: ReviewPromptModeV2RequestType): PromptModeV2Domain {
  const text = normalizeLower(promptText)
  if (goalContract?.deliverableType === "recipe" || /\bmeal\b|\brecipe\b|\bbreakfast\b|\blunch\b|\bdinner\b|\bsalad\b/.test(text)) {
    return /\bmeal\b|\bbreakfast\b|\blunch\b|\bdinner\b|\bsnack\b/.test(text) ? "meal" : "recipe"
  }
  if (goalContract?.deliverableType === "prompt" || /\bprompt\b/.test(text)) return "prompt"
  if (goalContract?.deliverableType === "html_file" || /\bhtml\b|\bcss\b|\bcomponent\b|\bpage\b|\bui\b/.test(text)) return "code"
  if (goalContract?.deliverableType === "rewrite" || /\brewrite\b|\bpolish\b|\bedit copy\b/.test(text)) return "rewrite"
  if (taskType === "problem_solving" || /\bbug\b|\berror\b|\bblank\b|\bfail\b|\bbroken\b|\bissue\b|\bdebug\b/.test(text)) return "bug"
  if (taskType === "product_thinking" || /\bprioritize\b|\bdecision\b|\bstrategy\b|\broadmap\b|\bproduct\b/.test(text)) return "product"
  if (taskType === "shipping" || /\bship\b|\brelease\b|\blaunch\b|\bdeploy\b/.test(text)) return "shipping"
  return "general"
}

function deriveTopicContext(promptText: string, goalContract: GoalContract | null, taskType: ReviewPromptModeV2RequestType): PromptModeV2TopicContext {
  return {
    topic: shortenTopic(firstMeaningfulSentence(promptText)),
    artifactLabel: inferArtifactLabel(goalContract, taskType),
    domain: inferDomain(promptText, goalContract, taskType)
  }
}

function firstGap(section: ReviewPromptModeV2SectionState) {
  return section.unresolvedGaps.find((gap) => gap.trim().length > 0) ?? null
}

function firstKnownSignal(section: ReviewPromptModeV2SectionState) {
  const candidate =
    section.resolvedContent[0] ??
    section.partialContent[0] ??
    section.resolvedSignals.find((value) => !/\bdetected\b/i.test(value)) ??
    null
  return candidate
}

function firstNote(additionalNotes: string[]) {
  return additionalNotes[0]?.replace(/\s*\(not yet merged\)\s*$/i, "") ?? null
}

function topicPhrase(context: PromptModeV2TopicContext) {
  return context.topic || context.artifactLabel
}

function mealQuestion(sectionId: string, context: PromptModeV2TopicContext): PromptModeV2GroundedQuestionShape | null {
  const topic = topicPhrase(context)
  switch (sectionId) {
    case "goal":
      return {
        label: `What kind of ${topic} do you want help with?`,
        helper: "Start by narrowing the meal itself so the next questions stay practical.",
        options: ["Breakfast", "Lunch", "Dinner", "Snack"]
      }
    case "context":
      return {
        label: `Who is this ${topic} mainly for?`,
        helper: "A little context helps shape the recipe without overcomplicating it.",
        options: ["Just me", "Kids or family", "Meal prep", "Guests"]
      }
    case "requirements":
      return {
        label: `What matters most for this ${topic}?`,
        helper: "Pick the highest-value goal first so the recipe stays on track.",
        options: ["High protein", "Low calorie", "Quick to make", "Budget-friendly"]
      }
    case "constraints":
      return {
        label: `Any food rules or cooking limits for this ${topic}?`,
        helper: "Choose the guardrails the answer must respect.",
        options: ["Vegetarian or vegan", "Low-carb or high-protein", "Under 15 minutes", "No dairy / no nuts / no gluten"]
      }
    case "output_format":
      return {
        label: `How should I return the ${topic} idea?`,
        helper: "Pick the answer shape that would be most useful right away.",
        options: ["One recipe", "A few meal ideas", "A simple meal plan", "Recipe plus shopping list"]
      }
    case "definition_of_complete":
      return {
        label: `What would make the ${topic} answer feel done?`,
        helper: "Set the bar for what makes the result actually useful.",
        options: ["Easy enough to make today", "Hits the nutrition goal", "Uses simple ingredients", "Includes exact amounts"]
      }
    case "note_box":
      return {
        label: `Anything else you want this ${topic} to optimize for?`,
        helper: "Add one extra preference only if it really matters.",
        options: undefined
      }
    default:
      return null
  }
}

function bugQuestion(sectionId: string, context: PromptModeV2TopicContext): PromptModeV2GroundedQuestionShape | null {
  const topic = topicPhrase(context)
  switch (sectionId) {
    case "expected_behavior":
      return {
        label: `When "${topic}" is working, what should happen?`,
        helper: "Start with the success case so the diagnosis has a clear target.",
        options: ["It should render normally", "The action should complete", "The output should be correct", "It should stay stable"]
      }
    case "actual_behavior":
      return {
        label: `What is "${topic}" doing instead?`,
        helper: "Describe the failure in plain language before we narrow the fix.",
        options: ["It errors or crashes", "The UI is blank or broken", "The wrong output appears", "It behaves inconsistently"]
      }
    case "evidence":
      return {
        label: `What evidence do you already have for "${topic}"?`,
        helper: "Pick the strongest clue we can use next.",
        options: ["Error message", "Console or logs", "Steps to reproduce", "UI state or screenshot"]
      }
    case "environment_context":
      return {
        label: `What environment detail matters most for "${topic}"?`,
        helper: "Choose the detail that is most likely to change the diagnosis.",
        options: ["Browser or runtime", "Framework or stack", "Recent change", "Only happens in one environment"]
      }
    case "desired_ai_help":
      return {
        label: `What do you want first for "${topic}"?`,
        helper: "Pick the most useful next move from the AI.",
        options: ["Most likely root cause", "Exact fix", "Debugging plan", "Verification plan"]
      }
    case "fix_proof":
      return {
        label: `What would prove "${topic}" is actually fixed?`,
        helper: "Set the proof bar now so the answer does not stop at a plausible guess.",
        options: ["The bug no longer reproduces", "UI visibly works", "Tests/checks pass", "The error disappears from logs"]
      }
    case "note_box":
      return {
        label: `Any final clue about "${topic}"?`,
        helper: "Add one last detail only if it changes the diagnosis.",
        options: ["Keep the fix minimal", "Prioritize the most likely cause", "Be careful about regressions", "Include proof steps"],
        mode: "multi"
      }
    default:
      return null
  }
}

function productQuestion(sectionId: string, context: PromptModeV2TopicContext): PromptModeV2GroundedQuestionShape | null {
  const topic = topicPhrase(context)
  switch (sectionId) {
    case "objective":
      return {
        label: `What are you really trying to achieve with "${topic}"?`,
        helper: "Start with the outcome you want, not the structure of the answer.",
        options: ["Make a decision", "Clarify trade-offs", "Choose a direction", "Prioritize next steps"]
      }
    case "product_context":
      return {
        label: `What product context matters most for "${topic}"?`,
        helper: "Pick the lens the AI should reason from first.",
        options: ["Current product state", "Roadmap priority", "Specific feature area", "Competitive context"]
      }
    case "user_business_context":
      return {
        label: `Who is most affected by the decision in "${topic}"?`,
        helper: "Choose the user or business lens that matters most.",
        options: ["End users", "Power users", "Internal team", "Business or growth goal"]
      }
    case "decision_problem":
      return {
        label: `What decision are you trying to make in "${topic}"?`,
        helper: "Name the real choice so the AI can frame the trade-offs well.",
        options: ["What to prioritize first", "How much scope to include", "Which direction is better", "Whether to ship now or later"]
      }
    case "requirements_considerations":
      return {
        label: `What should the AI weigh most heavily for "${topic}"?`,
        helper: "Choose the factors that should drive the recommendation.",
        options: ["User value", "Engineering effort", "Business impact", "Risk"]
      }
    case "tradeoffs_constraints":
      return {
        label: `Which trade-off matters most in "${topic}"?`,
        helper: "Pick the tension the answer should make explicit.",
        options: ["Speed vs quality", "Scope vs focus", "Growth vs trust", "Cost vs complexity"]
      }
    case "desired_output":
      return {
        label: `What kind of answer would help most for "${topic}"?`,
        helper: "Pick the format that gets you closest to a real decision.",
        options: ["Recommendation", "Options with trade-offs", "Decision memo", "Prioritized framework"]
      }
    case "definition_of_complete":
      return {
        label: `What would make the answer for "${topic}" decision-ready?`,
        helper: "Set the bar for when the response becomes useful enough to act on.",
        options: ["Clear recommendation", "Trade-offs are explicit", "Risks are called out", "Next step is obvious"]
      }
    case "note_box":
      return {
        label: `Any final nuance the AI should keep in mind for "${topic}"?`,
        helper: "Add one last constraint or concern only if it matters.",
        options: ["Be explicit about trade-offs", "Call out open risks", "Keep it practical", "Recommend a clear next step"],
        mode: "multi"
      }
    default:
      return null
  }
}

function productCreationQuestion(sectionId: string, context: PromptModeV2TopicContext): PromptModeV2GroundedQuestionShape | null {
  const topic = topicPhrase(context)
  switch (sectionId) {
    case "goal":
      return {
        label: `What do you want the AI to help decide for "${topic}"?`,
        helper: "Start with the real product decision or recommendation you need.",
        options: ["Make a recommendation", "Compare options", "Prioritize what comes first", "Define a clearer direction"]
      }
    case "context":
      return {
        label: `What context matters most for "${topic}"?`,
        helper: "Choose the product context that should shape the answer.",
        options: ["Current product state", "Specific feature area", "User need or pain point", "Business or roadmap context"]
      }
    case "requirements":
      return {
        label: `What should the answer definitely cover for "${topic}"?`,
        helper: "Pick the decision inputs the AI must weigh explicitly.",
        options: ["User value", "Engineering effort", "Business impact", "Risks and trade-offs"]
      }
    case "constraints":
      return {
        label: `What constraint or trade-off matters most for "${topic}"?`,
        helper: "Pick the main tension the recommendation should respect.",
        options: ["Speed vs quality", "Scope vs focus", "Growth vs trust", "Cost vs complexity"]
      }
    case "output_format":
      return {
        label: `What kind of product answer would help most for "${topic}"?`,
        helper: "Choose the answer shape that will be easiest to use.",
        options: ["Clear recommendation", "Options with trade-offs", "Decision memo", "Prioritized framework"]
      }
    case "definition_of_complete":
      return {
        label: `What would make the answer for "${topic}" decision-ready?`,
        helper: "Set the bar for when the recommendation becomes useful enough to act on.",
        options: ["Clear recommendation", "Trade-offs are explicit", "Risks are called out", "Next step is obvious"]
      }
    default:
      return null
  }
}

function shippingCreationQuestion(sectionId: string, context: PromptModeV2TopicContext): PromptModeV2GroundedQuestionShape | null {
  const topic = topicPhrase(context)
  switch (sectionId) {
    case "goal":
      return {
        label: `What do you want the AI to produce for "${topic}" first?`,
        helper: "Start with the release help you actually need.",
        options: ["Release plan", "Go/no-go checklist", "Risk review", "Smoke-test plan"]
      }
    case "context":
      return {
        label: `What shipping context matters most for "${topic}"?`,
        helper: "Choose the release context that should shape the answer.",
        options: ["Target environment", "Current release status", "Known blocker", "Recent change or rollout risk"]
      }
    case "requirements":
      return {
        label: `What must be true before "${topic}" can ship?`,
        helper: "Pick the non-negotiable release requirements first.",
        options: ["QA sign-off", "Launch checklist", "Docs/changelog", "Approval or handoff"]
      }
    case "constraints":
      return {
        label: `What risk or limit should the plan for "${topic}" respect?`,
        helper: "Pick the concern that should shape the release plan most.",
        options: ["Regression risk", "Deployment risk", "Missing verification", "Dependency or rollout risk"]
      }
    case "output_format":
      return {
        label: `How should the shipping answer for "${topic}" be returned?`,
        helper: "Choose the release output shape that will be easiest to use.",
        options: ["Checklist", "Step-by-step plan", "Risk matrix", "Short go/no-go recommendation"]
      }
    case "definition_of_complete":
      return {
        label: `What would make "${topic}" feel ready enough to ship?`,
        helper: "Set the finish line for the release answer.",
        options: ["Ready to launch", "Ready for final QA", "Ready for approval", "Ready for handoff"]
      }
    default:
      return null
  }
}

function promptCreationQuestion(sectionId: string, context: PromptModeV2TopicContext): PromptModeV2GroundedQuestionShape | null {
  const topic = topicPhrase(context)
  switch (sectionId) {
    case "goal":
      return {
        label: `What should the improved prompt for "${topic}" help the AI do better?`,
        helper: "Start with the job the new prompt needs to do well.",
        options: ["Generate a better first draft", "Preserve constraints better", "Return the right format", "Be more reliable"]
      }
    case "context":
      return {
        label: `What context matters most for the prompt about "${topic}"?`,
        helper: "Choose the usage context that should shape the rewrite.",
        options: ["Chat model use", "Coding assistant use", "Research or analysis use", "High-stakes use"]
      }
    case "requirements":
      return {
        label: `What should the improved prompt for "${topic}" definitely include?`,
        helper: "Pick the must-have improvements first.",
        options: ["Clearer constraints", "Stronger task direction", "Better output structure", "A clearer quality bar"]
      }
    case "constraints":
      return {
        label: `What should the improved prompt for "${topic}" avoid?`,
        helper: "Choose the failure pattern the rewrite should prevent first.",
        options: ["Too much ambiguity", "Missing constraints", "Wrong output shape", "Overly broad scope"]
      }
    case "output_format":
      return {
        label: `How should I return the improved prompt for "${topic}"?`,
        helper: "Choose the format that will be easiest to use next.",
        options: ["Final prompt only", "Prompt plus rationale", "A few prompt options", "Prompt with checklist"]
      }
    case "definition_of_complete":
      return {
        label: `What would make the improved prompt for "${topic}" good enough?`,
        helper: "Set the bar for when the rewrite is actually useful.",
        options: ["Meaning is preserved", "Constraints are much clearer", "Output shape is explicit", "It feels reliable to reuse"]
      }
    default:
      return null
  }
}

function shippingQuestion(sectionId: string, context: PromptModeV2TopicContext): PromptModeV2GroundedQuestionShape | null {
  const topic = topicPhrase(context)
  switch (sectionId) {
    case "current_status":
      return {
        label: `Where does "${topic}" stand right now?`,
        helper: "Start with the real shipping status before planning the release path.",
        options: ["Almost ready", "Blocked by a few issues", "Needs QA", "Still rough"]
      }
    case "target_environment":
      return {
        label: `Where does "${topic}" need to ship?`,
        helper: "Choose the environment so the release plan is grounded in the real target.",
        options: ["Production web app", "Browser extension", "API/service", "Internal tool"]
      }
    case "release_requirements":
      return {
        label: `What has to be true before "${topic}" ships?`,
        helper: "Pick the gates that are truly non-negotiable.",
        options: ["QA sign-off", "Launch checklist", "Docs/changelog", "Stakeholder approval"]
      }
    case "known_risks":
      return {
        label: `What is the biggest risk before shipping "${topic}"?`,
        helper: "Choose the risk the answer should address first.",
        options: ["Open bugs", "Regression risk", "Deployment risk", "Missing verification"]
      }
    case "needed_output":
      return {
        label: `What do you want the AI to produce for "${topic}"?`,
        helper: "Pick the most useful shipping deliverable.",
        options: ["Release plan", "Go/no-go checklist", "Risk review", "Smoke-test plan"]
      }
    case "readiness_check":
      return {
        label: `What should the readiness check focus on for "${topic}"?`,
        helper: "Pick the readiness lens that matters most right now.",
        options: ["Core functionality", "Known blockers", "Cross-platform behavior", "Operational readiness"]
      }
    case "post_ship_verification":
      return {
        label: `What should be checked right after "${topic}" ships?`,
        helper: "Choose the first post-ship checks that matter most.",
        options: ["Smoke test", "User-visible behavior", "Metrics/monitoring", "Rollback readiness"]
      }
    case "definition_of_complete":
      return {
        label: `What would make "${topic}" ready to ship?`,
        helper: "Set the finish line for the release plan.",
        options: ["Ready to launch", "Ready for final QA", "Ready for approval", "Ready for handoff"]
      }
    case "note_box":
      return {
        label: `Any last shipping note for "${topic}"?`,
        helper: "Add one final caveat only if it matters to the release.",
        options: ["Focus on blockers first", "Include smoke tests", "Call out regression risk", "Keep the plan concise"],
        mode: "multi"
      }
    default:
      return null
  }
}

function promptQuestion(sectionId: string, context: PromptModeV2TopicContext): PromptModeV2GroundedQuestionShape | null {
  const topic = topicPhrase(context)
  switch (sectionId) {
    case "purpose":
      return {
        label: `What do you need this prompt to help with for "${topic}"?`,
        helper: "Start with the job the prompt must do well.",
        options: ["Generate something new", "Fix or debug", "Rewrite or summarize", "Analyze or recommend"]
      }
    case "current_failure":
      return {
        label: `What is going wrong with the current prompt for "${topic}"?`,
        helper: "Pick the biggest failure so the rewrite solves the right thing first.",
        options: ["Too vague", "Misses constraints", "Wrong output shape", "Not reliable enough"]
      }
    case "desired_improvement":
      return {
        label: `What improvement matters most for the prompt about "${topic}"?`,
        helper: "Choose the strongest improvement target first.",
        options: ["Clearer constraints", "Better output structure", "More reliability", "Shorter and cleaner"]
      }
    case "execution_context":
      return {
        label: `Where will this prompt mainly be used?`,
        helper: "Choose the context that should shape the rewrite.",
        options: ["Chat model", "Coding assistant", "Research assistant", "High-stakes use"]
      }
    case "output_format":
      return {
        label: `How should I return the improved prompt for "${topic}"?`,
        helper: "Pick the return shape that will be easiest to use next.",
        options: ["Final prompt only", "Prompt plus rationale", "Prompt variants", "Prompt with checklist"]
      }
    case "note_box":
      return {
        label: `Any last thing the improved prompt should preserve for "${topic}"?`,
        helper: "Add one final caveat only if it really matters.",
        options: ["Preserve the original meaning", "Tighten constraints", "Improve output structure", "Reduce ambiguity"],
        mode: "multi"
      }
    default:
      return null
  }
}

function modificationQuestion(sectionId: string, context: PromptModeV2TopicContext): PromptModeV2GroundedQuestionShape | null {
  const topic = topicPhrase(context)
  switch (sectionId) {
    case "current_state":
      return {
        label: `What should the AI understand first about the current version of "${topic}"?`,
        helper: "Start with the baseline before changing anything.",
        options: ["Current output", "Existing behavior", "Current code/file", "Known limitation"]
      }
    case "requested_change":
      return {
        label: `What kind of change do you want for "${topic}"?`,
        helper: "Choose the main kind of change before narrowing the details.",
        options: ["Refine it", "Replace part of it", "Add something new", "Remove something"]
      }
    case "scope_boundaries":
      return {
        label: `What should stay out of scope while changing "${topic}"?`,
        helper: "Keep the request focused so the answer does not wander.",
        options: ["Do not widen the scope", "Touch only one area", "No structural rewrite", "No visual redesign"]
      }
    case "preserve_rules":
      return {
        label: `What absolutely needs to stay the same in "${topic}"?`,
        helper: "Pick what the AI should protect while making the change.",
        options: ["Existing behavior", "Tone/style", "Layout/format", "Compatibility"]
      }
    case "output_format":
      return {
        label: `How should the updated version of "${topic}" be returned?`,
        helper: "Choose the output shape that will be easiest to use.",
        options: ["Edited final version", "Patch-style change", "Updated code block", "Short diff summary"]
      }
    case "definition_of_complete":
      return {
        label: `What would prove the change to "${topic}" is complete enough?`,
        helper: "Set the finish line so the answer does not stop too early.",
        options: ["The change is clearly visible", "Nothing important regressed", "Ready to apply", "Safe first pass only"]
      }
    case "note_box":
      return {
        label: `Any final thing the AI should preserve while changing "${topic}"?`,
        helper: "Add one last nuance only if it matters.",
        options: ["Protect existing behavior", "Keep the style aligned", "Keep the scope narrow", "Call out regressions"],
        mode: "multi"
      }
    default:
      return null
  }
}

function generalCreationQuestion(sectionId: string, context: PromptModeV2TopicContext): PromptModeV2GroundedQuestionShape | null {
  const topic = topicPhrase(context)
  switch (sectionId) {
    case "goal":
      return {
        label: `What do you want the AI to make for "${topic}"?`,
        helper: "Start with the kind of result you actually want back.",
        options: ["A usable first draft", "A polished ready-to-use result", "A minimal starter", "A few strong options"]
      }
    case "context":
      return {
        label: `What context would help shape the answer for "${topic}"?`,
        helper: "Only add context that will actually change the output.",
        options: ["Who it is for", "Where it will be used", "Project/domain context", "Source material"]
      }
    case "requirements":
      return {
        label: `What absolutely needs to be included for "${topic}"?`,
        helper: "Pick the must-have parts before we worry about polish.",
        options: ["Core sections", "Specific parts", "Named features", "Examples or evidence"]
      }
    case "constraints":
      return {
        label: `What limits should the answer for "${topic}" respect?`,
        helper: "Pick the guardrails the AI should not break.",
        options: ["Time limit", "Budget or cost", "Tool or method", "Do-not-use exclusions", "Numeric targets"]
      }
    case "output_format":
      return {
        label: `How do you want the answer for "${topic}" returned?`,
        helper: "Pick the output shape that will be easiest to use.",
        options: ["Structured sections", "Bullets or checklist", "Table or matrix", "Code or file output", "Copy-ready answer"]
      }
    case "definition_of_complete":
      return {
        label: `What would make the answer for "${topic}" good enough to use?`,
        helper: "Set the quality bar before the AI fills in the rest.",
        options: ["All hard constraints satisfied", "Immediately usable", "Good enough to edit from", "Ready to ship"]
      }
    case "note_box":
      return {
        label: `Anything else the AI should keep in mind for "${topic}"?`,
        helper: "Add one last preference only if it matters.",
        options: ["Keep it simple", "Be concise", "Make it immediately usable", "Stay flexible for follow-up edits"],
        mode: "multi"
      }
    default:
      return null
  }
}

function buildDecisionTreeQuestion(sectionId: string, context: PromptModeV2TopicContext, taskType: ReviewPromptModeV2RequestType) {
  const templateKind = resolvePromptModeV2TemplateKind(taskType)
  if (templateKind === "problem_solving" || context.domain === "bug") return bugQuestion(sectionId, context)
  if (templateKind === "modification") return modificationQuestion(sectionId, context)
  if (context.domain === "meal" || context.domain === "recipe") return mealQuestion(sectionId, context)
  if (context.domain === "product" || taskType === "product_thinking") return productCreationQuestion(sectionId, context)
  if (context.domain === "shipping" || taskType === "shipping") return shippingCreationQuestion(sectionId, context)
  if (context.domain === "prompt" || taskType === "prompt_optimization") return promptCreationQuestion(sectionId, context)
  return generalCreationQuestion(sectionId, context)
}

function defaultFollowupMode(sectionId: string): "single" | "multi" {
  return [
    "context",
    "requirements",
    "constraints",
    "evidence",
    "environment_context",
    "requirements_considerations",
    "tradeoffs_constraints",
    "release_requirements",
    "known_risks",
    "readiness_check",
    "post_ship_verification",
    "current_failure",
    "desired_improvement",
    "execution_context",
    "note_box"
  ].includes(sectionId)
    ? "multi"
    : "single"
}

function defaultFollowupOptions(sectionId: string, context: PromptModeV2TopicContext, depth: "secondary" | "tertiary"): string[] {
  const deeper = depth === "tertiary"
  switch (sectionId) {
    case "goal":
      return deeper ? ["Keep it practical", "Make it more tailored", "Keep it simple", "Strengthen the outcome"] : ["Health-focused", "Quick and practical", "Budget-friendly", "More filling or satisfying"]
    case "context":
      return deeper ? ["Weekday routine", "Meal prep context", "Family or shared context", "No extra context needed"] : ["Just for me", "For family or kids", "For meal prep", "For guests"]
    case "requirements":
      return deeper ? ["More nutrition detail", "More ingredient specificity", "More variety", "No extra requirements"] : ["High protein", "Low calorie", "Simple ingredients", "Specific ingredients included"]
    case "constraints":
      return deeper ? ["Tighter nutrition target", "Cooking/tool limit", "Ingredient exclusions", "Budget or time cap"] : ["Under a time limit", "Avoid certain ingredients", "Use a specific method", "Stay under a numeric target"]
    case "output_format":
      return deeper ? ["More detailed steps", "More concise answer", "Add shopping/helpful extras", "Keep it very simple"] : ["One clear answer", "A few options", "Structured sections", "Checklist-style output"]
    case "definition_of_complete":
      return deeper ? ["Ready to use immediately", "Easy to customize", "Covers the key constraints", "Feels trustworthy"] : ["Immediately usable", "Meets the key goal", "Easy to follow", "Feels complete enough"]
    case "expected_behavior":
      return deeper ? ["It should stay stable", "It should update correctly", "It should handle edge cases", "It should be consistent"] : ["It should render normally", "It should complete the action", "It should return the right output", "It should not error"]
    case "actual_behavior":
      return deeper ? ["Only fails sometimes", "Fails in one path", "Fails after recent changes", "Hard to reproduce"] : ["It errors", "It shows the wrong output", "The UI is broken", "It does nothing"]
    case "evidence":
      return deeper ? ["More repro detail", "More logs or errors", "More UI evidence", "No more evidence yet"] : ["Error message", "Logs or console output", "Repro steps", "Screenshot or UI state"]
    case "environment_context":
      return deeper ? ["Specific browser/runtime", "Recent code change", "Only one environment affected", "Not environment-specific"] : ["Browser/runtime", "Framework/stack", "Platform/environment", "Recent change"]
    case "desired_ai_help":
      return deeper ? ["Root cause plus fix", "Fix plus proof", "Step-by-step plan", "Minimal first pass"] : ["Diagnosis first", "Exact fix", "Debugging plan", "Verification plan"]
    case "fix_proof":
      return deeper ? ["Regression checks", "Edge-case checks", "Runtime proof", "Visual proof"] : ["Repro no longer fails", "UI visibly works", "Tests pass", "Error/logs disappear"]
    case "objective":
      return deeper ? ["More confidence in the decision", "Clear next step", "Clear trade-offs", "Better prioritization"] : ["Make a decision", "Clarify trade-offs", "Prioritize the next step", "Set a direction"]
    case "product_context":
      return deeper ? ["Current product state", "Roadmap context", "Feature-area context", "Competitive context"] : ["Current product state", "Feature area", "Roadmap context", "Competitive context"]
    case "user_business_context":
      return deeper ? ["User impact", "Business impact", "Stakeholder concern", "Adoption risk"] : ["User need", "Business goal", "Adoption risk", "Stakeholder concern"]
    case "decision_problem":
      return deeper ? ["Prioritize first", "Set scope", "Choose direction", "Decide timing"] : ["Prioritization", "Scope decision", "Direction choice", "Timing decision"]
    case "requirements_considerations":
      return deeper ? ["User value", "Engineering effort", "Business impact", "Risk or compliance"] : ["User value", "Engineering effort", "Business impact", "Risk or compliance"]
    case "tradeoffs_constraints":
      return deeper ? ["Speed vs quality", "Scope vs focus", "Growth vs trust", "Cost vs complexity"] : ["Speed vs quality", "Scope vs focus", "Growth vs retention", "Cost vs complexity"]
    case "desired_output":
      return deeper ? ["More decisive recommendation", "More options and trade-offs", "Memo format", "Framework format"] : ["Recommendation", "Options with trade-offs", "Decision memo", "Prioritized framework"]
    case "current_status":
      return deeper ? ["Mostly ready", "Blocked by issues", "Needs QA", "Still rough"] : ["Almost ready", "Blocked by issues", "Needs QA", "Still rough"]
    case "target_environment":
      return deeper ? ["Production web app", "Browser extension", "API/service", "Internal tool"] : ["Production web app", "Browser extension", "Mobile app", "API/service"]
    case "release_requirements":
      return deeper ? ["QA sign-off", "Launch checklist", "Approval needed", "Docs/changelog"] : ["Bug fixes only", "QA sign-off", "Launch checklist", "Stakeholder approval"]
    case "known_risks":
      return deeper ? ["Regression risk", "Deployment risk", "Missing verification", "Dependency risk"] : ["Open bugs", "Regression risk", "Deployment risk", "Dependency risk"]
    case "needed_output":
      return deeper ? ["Release plan", "Checklist", "Risk review", "Smoke-test plan"] : ["Release plan", "Go/no-go checklist", "Risk review", "Ship-ready prompt"]
    case "readiness_check":
      return deeper ? ["Core functionality", "Known blockers", "Cross-platform behavior", "Operational readiness"] : ["Core functionality", "Known blockers", "Cross-platform behavior", "Operational readiness"]
    case "post_ship_verification":
      return deeper ? ["Smoke test", "User-visible behavior", "Metrics or monitoring", "Rollback readiness"] : ["Smoke test", "Metrics/monitoring", "User-visible behavior", "Rollback readiness"]
    case "purpose":
      return deeper ? ["Generate something new", "Fix or debug", "Rewrite or summarize", "Analyze or recommend"] : ["Generate something new", "Fix or debug", "Rewrite or summarize", "Analyze or recommend"]
    case "current_failure":
      return deeper ? ["Too vague", "Misses constraints", "Wrong output shape", "Not reliable enough"] : ["Too vague", "Misses constraints", "Wrong output shape", "Not reliable enough"]
    case "desired_improvement":
      return deeper ? ["Clearer constraints", "Better output structure", "More reliability", "Shorter and cleaner"] : ["Clearer constraints", "Better output structure", "More reliability", "Shorter and cleaner"]
    case "execution_context":
      return deeper ? ["Chat model", "Coding assistant", "Research assistant", "High-stakes usage"] : ["Chat model", "Coding assistant", "Research assistant", "High-stakes usage"]
    case "note_box":
      return context.domain === "bug"
        ? ["Keep the fix minimal", "Be careful about regressions", "Include verification steps", "Prioritize the likeliest cause"]
        : context.domain === "product"
          ? ["Be explicit about trade-offs", "Keep it practical", "Call out open risks", "Recommend a next step"]
          : ["Keep it simple", "Stay practical", "Call out risks", "Keep the answer concise"]
    default:
      return ["Keep it practical", "Make it more specific", "Keep it concise", "Make it easier to use"]
  }
}

function buildMealFollowup(sectionId: string, context: PromptModeV2TopicContext, depth: "secondary" | "tertiary") {
  const topic = topicPhrase(context)
  switch (sectionId) {
    case "goal":
      return {
        label: depth === "secondary" ? `What should this ${topic} help you optimize for?` : `What would make this ${topic} feel like the right fit for you?`,
        helper: depth === "secondary" ? "Add the main outcome you care about most." : "Add one more detail that would make the answer feel more tailored.",
        mode: "text" as const
      }
    case "context":
      return {
        label: depth === "secondary" ? `How will you actually use this ${topic}?` : `Anything about your routine that should shape this ${topic}?`,
        helper: depth === "secondary" ? "A little real-world context helps the result feel practical." : "Add one more context detail only if it changes the answer.",
        mode: "text" as const
      }
    case "requirements":
      return {
        label: depth === "secondary" ? `What ingredients or nutrition priorities should this ${topic} include?` : `Any other must-have detail for this ${topic}?`,
        helper: depth === "secondary" ? "Name the most important specifics the answer should include." : "Add one more must-have only if it really matters.",
        mode: "text" as const
      }
    case "constraints":
      return {
        label: depth === "secondary" ? `Any time, budget, or food limits for this ${topic}?` : `Any ingredient, cooking, or nutrition rule this ${topic} must not break?`,
        helper: depth === "secondary" ? "Capture the main guardrails before we go deeper." : "Add one more non-negotiable only if it matters.",
        mode: "text" as const
      }
    case "output_format":
      return {
        label: depth === "secondary" ? `What should the answer include for this ${topic}?` : `How detailed should the final ${topic} answer be?`,
        helper: depth === "secondary" ? "Say what would make the output immediately useful." : "Add one more detail about the output shape if needed.",
        mode: "text" as const
      }
    case "definition_of_complete":
      return {
        label: depth === "secondary" ? `What would make this ${topic} answer good enough to use right away?` : `What would make you trust the final ${topic} answer?`,
        helper: depth === "secondary" ? "Set the finish line before we assemble the prompt." : "Add one more quality bar only if it changes the result.",
        mode: "text" as const
      }
    default:
      return null
  }
}

function buildBugFollowup(sectionId: string, context: PromptModeV2TopicContext, depth: "secondary" | "tertiary") {
  const topic = topicPhrase(context)
  switch (sectionId) {
    case "expected_behavior":
      return {
        label: depth === "secondary" ? `What exact behavior are you expecting from "${topic}"?` : `Is there any edge case where "${topic}" should behave differently?`,
        helper: depth === "secondary" ? "Be concrete about the success case." : "Add one more detail if the expected behavior changes by condition.",
        mode: "text" as const
      }
    case "actual_behavior":
      return {
        label: depth === "secondary" ? `What exactly happens when "${topic}" fails?` : `When does "${topic}" fail most often?`,
        helper: depth === "secondary" ? "Describe the failure as precisely as you can." : "Add any triggering condition that changes the diagnosis.",
        mode: "text" as const
      }
    case "evidence":
      return {
        label: depth === "secondary" ? `What exact error, log, or repro detail do you already have for "${topic}"?` : `Any other clue that would help explain "${topic}"?`,
        helper: depth === "secondary" ? "The strongest evidence should come before the fix." : "Add one more clue only if it changes what the AI should check.",
        mode: "text" as const
      }
    case "environment_context":
      return {
        label: depth === "secondary" ? `What environment detail is most likely affecting "${topic}"?` : `Does "${topic}" depend on a specific browser, runtime, or recent change?`,
        helper: depth === "secondary" ? "Include the context that changes the diagnosis." : "Add one more environment condition if it matters.",
        mode: "text" as const
      }
    case "desired_ai_help":
      return {
        label: depth === "secondary" ? `After the first fix idea, what would be most helpful next for "${topic}"?` : `What should the AI be especially careful not to miss for "${topic}"?`,
        helper: depth === "secondary" ? "Clarify the exact kind of help you want after the first pass." : "Add one more expectation only if it changes the response.",
        mode: "text" as const
      }
    case "fix_proof":
      return {
        label: depth === "secondary" ? `How should we verify "${topic}" is actually fixed?` : `Any regression or edge-case checks we should include for "${topic}"?`,
        helper: depth === "secondary" ? "Turn proof into something concrete and testable." : "Add one more proof condition if it matters.",
        mode: "text" as const
      }
    default:
      return null
  }
}

function buildProductFollowup(sectionId: string, context: PromptModeV2TopicContext, depth: "secondary" | "tertiary") {
  const topic = topicPhrase(context)
  switch (sectionId) {
    case "objective":
      return {
        label: depth === "secondary" ? `What outcome matters most in "${topic}"?` : `How will you know "${topic}" led to the right decision?`,
        helper: depth === "secondary" ? "Make the objective concrete before we explore trade-offs." : "Add one more success signal if it matters.",
        mode: "text" as const
      }
    case "product_context":
      return {
        label: depth === "secondary" ? `What product context should shape the answer for "${topic}"?` : `What current product reality makes "${topic}" harder?`,
        helper: depth === "secondary" ? "Include only the context that changes the recommendation." : "Add one more product detail if it affects the trade-offs.",
        mode: "text" as const
      }
    case "user_business_context":
      return {
        label: depth === "secondary" ? `Which user or business pressure matters most in "${topic}"?` : `What downside matters most if "${topic}" goes the wrong way?`,
        helper: depth === "secondary" ? "Clarify who or what is most at stake." : "Add one more stakeholder or business consequence if needed.",
        mode: "text" as const
      }
    case "decision_problem":
      return {
        label: depth === "secondary" ? `What is the real choice inside "${topic}"?` : `What open decision inside "${topic}" is still hardest?`,
        helper: depth === "secondary" ? "Narrow the decision before asking for a recommendation." : "Add one more decision edge only if it matters.",
        mode: "text" as const
      }
    case "requirements_considerations":
      return {
        label: depth === "secondary" ? `What factors must the answer weigh for "${topic}"?` : `Any other consideration the recommendation must not ignore for "${topic}"?`,
        helper: depth === "secondary" ? "List the most important decision factors." : "Add one more factor only if it truly changes the answer.",
        mode: "text" as const
      }
    case "tradeoffs_constraints":
      return {
        label: depth === "secondary" ? `Which trade-off matters most in "${topic}" and why?` : `Any constraint or risk that should limit the recommendation for "${topic}"?`,
        helper: depth === "secondary" ? "Surface the core tension before we finalize the prompt." : "Add one more limit only if it changes the trade-off.",
        mode: "text" as const
      }
    case "desired_output":
      return {
        label: depth === "secondary" ? `What kind of recommendation would be most useful for "${topic}"?` : `How decisive versus exploratory should the answer be for "${topic}"?`,
        helper: depth === "secondary" ? "Choose the shape of the answer that would help you act." : "Add one more output preference only if it changes the response.",
        mode: "text" as const
      }
    case "definition_of_complete":
      return {
        label: depth === "secondary" ? `What would make the answer for "${topic}" decision-ready?` : `What final uncertainty should the answer for "${topic}" clear up?`,
        helper: depth === "secondary" ? "Define what good enough looks like here." : "Add one more completion criterion if needed.",
        mode: "text" as const
      }
    default:
      return null
  }
}

function buildShippingFollowup(sectionId: string, context: PromptModeV2TopicContext, depth: "secondary" | "tertiary") {
  const topic = topicPhrase(context)
  switch (sectionId) {
    case "current_status":
      return {
        label: depth === "secondary" ? `What still feels unfinished about "${topic}" right now?` : `What is the biggest unknown before "${topic}" ships?`,
        helper: depth === "secondary" ? "Name the real state, not the ideal one." : "Add one more blocker only if it changes the plan.",
        mode: "text" as const
      }
    case "target_environment":
      return {
        label: depth === "secondary" ? `What environment details matter most for shipping "${topic}"?` : `Any platform-specific concern for "${topic}" we should account for?`,
        helper: depth === "secondary" ? "Include the environment details that change the release plan." : "Add one more platform nuance only if it matters.",
        mode: "text" as const
      }
    case "release_requirements":
      return {
        label: depth === "secondary" ? `What absolutely has to happen before "${topic}" ships?` : `Any final release gate or approval needed for "${topic}"?`,
        helper: depth === "secondary" ? "Capture the real go/no-go requirements." : "Add one more gate only if it changes readiness.",
        mode: "text" as const
      }
    case "known_risks":
      return {
        label: depth === "secondary" ? `What risk worries you most before shipping "${topic}"?` : `Any regression or rollout concern we should call out for "${topic}"?`,
        helper: depth === "secondary" ? "Surface the biggest risk first." : "Add one more risk only if it changes the ship plan.",
        mode: "text" as const
      }
    case "needed_output":
      return {
        label: depth === "secondary" ? `What deliverable would help most for shipping "${topic}"?` : `What extra detail would make the ship plan for "${topic}" more usable?`,
        helper: depth === "secondary" ? "Choose the most useful shipping output." : "Add one more output need if it matters.",
        mode: "text" as const
      }
    case "readiness_check":
      return {
        label: depth === "secondary" ? `What should the readiness check focus on for "${topic}"?` : `What would make you hesitate to ship "${topic}"?`,
        helper: depth === "secondary" ? "Name the checks that matter most before release." : "Add one more readiness concern if needed.",
        mode: "text" as const
      }
    case "post_ship_verification":
      return {
        label: depth === "secondary" ? `What should be verified right after "${topic}" goes out?` : `Any post-ship signal or fallback plan we should include for "${topic}"?`,
        helper: depth === "secondary" ? "Define the first checks after release." : "Add one more post-ship check if it matters.",
        mode: "text" as const
      }
    case "definition_of_complete":
      return {
        label: depth === "secondary" ? `What would make "${topic}" truly ready to ship?` : `What last uncertainty should the release plan for "${topic}" remove?`,
        helper: depth === "secondary" ? "Set the finish line for shipping." : "Add one more ship-readiness condition if needed.",
        mode: "text" as const
      }
    default:
      return null
  }
}

function buildPromptFollowup(sectionId: string, context: PromptModeV2TopicContext, depth: "secondary" | "tertiary") {
  const topic = topicPhrase(context)
  switch (sectionId) {
    case "purpose":
      return {
        label: depth === "secondary" ? `What should the prompt about "${topic}" help the AI do better?` : `What result from "${topic}" matters most to preserve in the rewrite?`,
        helper: depth === "secondary" ? "Clarify the job of the improved prompt." : "Add one more preserved meaning only if it matters.",
        mode: "text" as const
      }
    case "current_failure":
      return {
        label: depth === "secondary" ? `What is the most painful failure in the current prompt for "${topic}"?` : `Any repeated misunderstanding the prompt about "${topic}" still causes?`,
        helper: depth === "secondary" ? "Describe the failure we need to fix first." : "Add one more failure mode only if it matters.",
        mode: "text" as const
      }
    case "desired_improvement":
      return {
        label: depth === "secondary" ? `What improvement would make the prompt for "${topic}" noticeably better?` : `What would make the improved prompt for "${topic}" feel reliable enough?`,
        helper: depth === "secondary" ? "Name the improvement that matters most." : "Add one more improvement only if it changes the rewrite.",
        mode: "text" as const
      }
    case "execution_context":
      return {
        label: depth === "secondary" ? `Where will the improved prompt for "${topic}" be used?` : `Any context limit or high-stakes condition for "${topic}" we should account for?`,
        helper: depth === "secondary" ? "Include the execution context that changes the rewrite." : "Add one more usage context only if it matters.",
        mode: "text" as const
      }
    case "output_format":
      return {
        label: depth === "secondary" ? `How should the optimized prompt for "${topic}" be returned?` : `Any extra structure you want in the improved prompt for "${topic}"?`,
        helper: depth === "secondary" ? "Choose the return shape that will be easiest to use." : "Add one more output preference only if it matters.",
        mode: "text" as const
      }
    default:
      return null
  }
}

function buildGeneralFollowup(sectionId: string, context: PromptModeV2TopicContext, depth: "secondary" | "tertiary") {
  const topic = topicPhrase(context)
  const stageWord = depth === "secondary" ? "next" : "last"
  switch (sectionId) {
    case "goal":
      return {
        label: `What ${stageWord} detail matters most about what you want for "${topic}"?`,
        helper: "Add the next most important goal detail.",
        mode: "text" as const
      }
    case "context":
      return {
        label: `What context would help the AI handle "${topic}" better?`,
        helper: "Add only context that would change the answer.",
        mode: "text" as const
      }
    case "requirements":
      return {
        label: `What else absolutely needs to be included for "${topic}"?`,
        helper: "Add the next must-have requirement.",
        mode: "text" as const
      }
    case "constraints":
      return {
        label: `What other limit should the answer for "${topic}" respect?`,
        helper: "Add the next non-negotiable constraint.",
        mode: "text" as const
      }
    case "output_format":
      return {
        label: `What would make the output for "${topic}" easier to use?`,
        helper: "Add the next output detail that matters.",
        mode: "text" as const
      }
    case "definition_of_complete":
      return {
        label: `What would make the answer for "${topic}" feel complete enough?`,
        helper: "Add the next quality bar that matters.",
        mode: "text" as const
      }
    default:
      return null
  }
}

function buildFollowupQuestionForContext(
  sectionId: string,
  context: PromptModeV2TopicContext,
  taskType: ReviewPromptModeV2RequestType,
  depth: "secondary" | "tertiary"
) {
  const templateKind = resolvePromptModeV2TemplateKind(taskType)
  if (context.domain === "meal" || context.domain === "recipe") return buildMealFollowup(sectionId, context, depth)
  if (templateKind === "problem_solving" || context.domain === "bug") return buildBugFollowup(sectionId, context, depth)
  if (templateKind === "modification") return buildGeneralFollowup(sectionId, context, depth)
  if (context.domain === "product") return buildGeneralFollowup(sectionId, context, depth)
  if (context.domain === "shipping") return buildGeneralFollowup(sectionId, context, depth)
  if (context.domain === "prompt") return buildGeneralFollowup(sectionId, context, depth)
  return buildGeneralFollowup(sectionId, context, depth)
}

function helperForQuestion(
  section: ReviewPromptModeV2SectionState,
  context: PromptModeV2TopicContext,
  additionalNotes: string[],
  baseHelper: string
) {
  const gap = firstGap(section)
  const known = firstKnownSignal(section)
  const note = firstNote(additionalNotes)

  if (known && gap) {
    return `So far I know: ${known}. Next, I need the one detail that matters most here.`
  }
  if (gap) {
    return baseHelper
  }
  if (known) {
    return `I already have some signal here: ${known}. Add the next detail only if it sharpens the answer.`
  }
  if (note) {
    return `Keep this tied to "${context.topic}". If helpful, you can also use this note: ${note}`
  }
  return baseHelper
}

export function buildGroundedPromptModeV2Question(input: BuildGroundedPromptModeV2QuestionInput): ReviewPromptModeV2Question {
  const context = deriveTopicContext(input.promptText, input.goalContract, input.taskType)
  const grounded = buildDecisionTreeQuestion(input.section.id, context, input.taskType)
  const mode = grounded?.mode === "single" || grounded?.mode === "multi" ? grounded.mode : input.template.mode
  const options = grounded?.options?.length ? grounded.options : input.template.options?.length ? input.template.options : defaultFollowupOptions(input.section.id, context, "secondary")

  return {
    id: input.id,
    sectionId: input.section.id,
    sectionLabel: input.section.label,
    label: grounded?.label ?? input.template.label,
    helper: helperForQuestion(
      input.section,
      context,
      input.additionalNotes,
      grounded?.helper ?? `Keep this question grounded in the real request about "${context.topic}".`
    ),
    mode,
    options,
    depth: "primary"
  }
}

export function buildPromptModeV2FollowupQuestion(input: BuildPromptModeV2FollowupQuestionInput): ReviewPromptModeV2Question | null {
  const context = deriveTopicContext(input.promptText, input.goalContract, input.taskType)
  const followup = buildFollowupQuestionForContext(input.section.id, context, input.taskType, input.depth)
  if (!followup) return null
  const mode = followup.mode === "single" || followup.mode === "multi" ? followup.mode : defaultFollowupMode(input.section.id)
  const options = followup.options?.length ? followup.options : defaultFollowupOptions(input.section.id, context, input.depth)

  return {
    id: input.id,
    sectionId: input.section.id,
    sectionLabel: input.section.label,
    label: followup.label,
    helper: helperForQuestion(
      input.section,
      context,
      input.additionalNotes,
      followup.helper
    ),
    mode,
    options,
    depth: input.depth
  }
}
