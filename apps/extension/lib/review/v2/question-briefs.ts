import type { GoalConstraint, GoalContract } from "../../goal/types"
import type { ReviewPromptModeV2RequestType } from "./request-types"
import { resolvePromptModeV2TemplateKind } from "./request-types"
import type { ReviewPromptModeV2QuestionMode, ReviewPromptModeV2SectionState } from "./section-schemas"

export type PromptModeV2QuestionBrief = {
  focusId: string
  label: string
  helper: string
  mode: ReviewPromptModeV2QuestionMode
  options: string[]
}

type BuildPromptModeV2QuestionBriefInput = {
  taskType: ReviewPromptModeV2RequestType
  promptText: string
  goalContract: GoalContract | null
  section: ReviewPromptModeV2SectionState
  additionalNotes: string[]
  depth: "primary" | "secondary" | "tertiary"
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
  | "marketing"
  | "sales"
  | "education"
  | "fitness"
  | "finance"
  | "hiring"
  | "general"

type PromptModeV2TopicContext = {
  topic: string
  domain: PromptModeV2Domain
  artifactLabel: string
  artifactKind: string
  artifactCertain: boolean
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeLower(value: string) {
  return normalize(value).toLowerCase()
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))]
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
  const firstSentence = cleaned
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .find(Boolean)
  return normalize(firstSentence ?? cleaned)
}

function shortenTopic(topic: string, maxWords = 9) {
  const words = normalize(topic).split(/\s+/).filter(Boolean)
  if (words.length <= maxWords) return words.join(" ")
  return `${words.slice(0, maxWords).join(" ")}...`
}

function inferArtifactContext(goalContract: GoalContract | null, taskType: ReviewPromptModeV2RequestType, promptText: string) {
  const normalizedPrompt = normalizeLower(promptText)
  switch (goalContract?.deliverableType) {
    case "recipe":
      return { artifactLabel: "recipe", artifactKind: "recipe", artifactCertain: true }
    case "prompt":
      return { artifactLabel: "prompt", artifactKind: "prompt", artifactCertain: true }
    case "html_file":
      return { artifactLabel: "page", artifactKind: "page", artifactCertain: true }
    case "rewrite":
      return { artifactLabel: "rewrite", artifactKind: "rewrite", artifactCertain: true }
    case "recommendation":
      return { artifactLabel: "recommendation", artifactKind: "recommendation", artifactCertain: true }
    case "research":
      return { artifactLabel: "research output", artifactKind: "research", artifactCertain: true }
    default:
      break
  }

  if (/\bmarketing plan\b|\bcampaign plan\b/.test(normalizedPrompt)) {
    return { artifactLabel: "marketing plan", artifactKind: "plan", artifactCertain: true }
  }
  if (/\bplan\b/.test(normalizedPrompt)) {
    return { artifactLabel: "plan", artifactKind: "plan", artifactCertain: true }
  }
  if (/\bstrategy\b/.test(normalizedPrompt)) {
    return { artifactLabel: "strategy", artifactKind: "strategy", artifactCertain: true }
  }
  if (/\broadmap\b/.test(normalizedPrompt)) {
    return { artifactLabel: "roadmap", artifactKind: "roadmap", artifactCertain: true }
  }
  if (/\bchecklist\b/.test(normalizedPrompt)) {
    return { artifactLabel: "checklist", artifactKind: "checklist", artifactCertain: true }
  }
  if (/\bproposal\b/.test(normalizedPrompt)) {
    return { artifactLabel: "proposal", artifactKind: "proposal", artifactCertain: true }
  }
  if (/\bbrief\b/.test(normalizedPrompt)) {
    return { artifactLabel: "brief", artifactKind: "brief", artifactCertain: true }
  }
  if (/\bemail\b/.test(normalizedPrompt)) {
    return { artifactLabel: "email", artifactKind: "email", artifactCertain: true }
  }
  if (/\bresume\b|\bcv\b/.test(normalizedPrompt)) {
    return { artifactLabel: "resume", artifactKind: "resume", artifactCertain: true }
  }
  if (/\bblog\b|\barticle\b|\bpost\b/.test(normalizedPrompt)) {
    return { artifactLabel: "article", artifactKind: "article", artifactCertain: true }
  }

  const templateKind = resolvePromptModeV2TemplateKind(taskType)
  switch (templateKind) {
    case "modification":
      return { artifactLabel: "change", artifactKind: "change", artifactCertain: false }
    case "problem_solving":
      return { artifactLabel: "fix", artifactKind: "fix", artifactCertain: false }
    default:
      return { artifactLabel: "result", artifactKind: "result", artifactCertain: false }
  }
}

function inferDomain(promptText: string, goalContract: GoalContract | null, taskType: ReviewPromptModeV2RequestType): PromptModeV2Domain {
  const text = normalizeLower(promptText)
  if (goalContract?.deliverableType === "recipe" || /\bmeal\b|\brecipe\b|\bbreakfast\b|\blunch\b|\bdinner\b|\bsalad\b/.test(text)) {
    return /\bmeal\b|\bbreakfast\b|\blunch\b|\bdinner\b|\bsnack\b/.test(text) ? "meal" : "recipe"
  }
  if (taskType === "problem_solving" || /\bbug\b|\berror\b|\bissue\b|\bbroken\b|\bdebug\b|\bblank\b|\bfail\b/.test(text)) return "bug"
  if (taskType === "modification" || /\bupdate\b|\bmodify\b|\bchange\b|\bedit\b|\brefactor\b/.test(text)) return "code"
  if (/\bmarketing\b|\bcampaign\b|\blead gen\b|\blead generation\b|\bbrand awareness\b|\bcontent marketing\b|\bgo-to-market\b|\bgtm\b/.test(text)) return "marketing"
  if (/\bsales\b|\boutreach\b|\bpipeline\b|\bprospect\b|\bconversion\b/.test(text)) return "sales"
  if (/\bstudy\b|\blearn\b|\bexam\b|\bcourse\b|\blesson\b|\bteaching\b/.test(text)) return "education"
  if (/\bworkout\b|\bfitness\b|\bweight loss\b|\bmuscle gain\b|\btraining\b|\bnutrition\b/.test(text)) return "fitness"
  if (/\bbudget\b|\bsavings?\b|\bdebt\b|\binvest(?:ing|ment)?\b|\bfinance\b|\bfinancial\b/.test(text)) return "finance"
  if (/\bhire\b|\bhiring\b|\brecruit\b|\binterview\b|\bcandidate\b|\bjob description\b/.test(text)) return "hiring"
  if (/\broadmap\b|\bproduct\b|\bstrategy\b|\bpriorit/i.test(text)) return "product"
  if (/\bship\b|\brelease\b|\blaunch\b|\bdeploy\b|\brollout\b/.test(text)) return "shipping"
  if (goalContract?.deliverableType === "prompt" || /\bprompt\b/.test(text)) return "prompt"
  if (goalContract?.deliverableType === "rewrite" || /\brewrite\b|\bpolish\b/.test(text)) return "rewrite"
  if (goalContract?.deliverableType === "html_file" || /\bhtml\b|\bcss\b|\bui\b|\bcomponent\b/.test(text)) return "code"
  return "general"
}

function deriveTopicContext(promptText: string, goalContract: GoalContract | null, taskType: ReviewPromptModeV2RequestType): PromptModeV2TopicContext {
  const artifact = inferArtifactContext(goalContract, taskType, promptText)
  return {
    topic: shortenTopic(firstMeaningfulSentence(promptText)),
    domain: inferDomain(promptText, goalContract, taskType),
    artifactLabel: artifact.artifactLabel,
    artifactKind: artifact.artifactKind,
    artifactCertain: artifact.artifactCertain
  }
}

function topicPhrase(context: PromptModeV2TopicContext) {
  return context.topic || context.artifactLabel
}

function artifactTitle(context: PromptModeV2TopicContext) {
  return context.artifactLabel || context.artifactKind || "result"
}

function buildPlanGoalBrief(context: PromptModeV2TopicContext): PromptModeV2QuestionBrief {
  const artifact = /\bplan\b|\bstrategy\b|\broadmap\b|\bchecklist\b|\bproposal\b|\bbrief\b/i.test(context.topic)
    ? context.topic
    : artifactTitle(context)
  switch (context.domain) {
    case "marketing":
      return {
        focusId: "marketing-plan-goal",
        label: `What is this ${artifact} mainly for?`,
        helper: "Start with the real marketing goal so the rest of the questions stay useful.",
        mode: "single",
        options: ["Product launch", "Lead generation", "Brand awareness", "Retention or re-engagement"]
      }
    case "sales":
      return {
        focusId: "sales-plan-goal",
        label: `What is this ${artifact} mainly for?`,
        helper: "Start with the sales objective that matters most.",
        mode: "single",
        options: ["Prospecting outreach", "Pipeline growth", "Conversion improvement", "Account expansion"]
      }
    case "education":
      return {
        focusId: "education-plan-goal",
        label: `What is this ${artifact} mainly for?`,
        helper: "Pick the learning goal first so the plan stays focused.",
        mode: "single",
        options: ["Exam preparation", "Learning a new skill", "Teaching or lesson planning", "Long-term study routine"]
      }
    case "fitness":
      return {
        focusId: "fitness-plan-goal",
        label: `What is this ${artifact} mainly for?`,
        helper: "Pick the main fitness goal first so the plan stays on target.",
        mode: "single",
        options: ["Weight loss", "Muscle gain", "General health", "Consistency and routine"]
      }
    case "finance":
      return {
        focusId: "finance-plan-goal",
        label: `What is this ${artifact} mainly for?`,
        helper: "Choose the main financial goal before we collect other details.",
        mode: "single",
        options: ["Budgeting", "Saving more", "Debt reduction", "Investing or planning ahead"]
      }
    case "hiring":
      return {
        focusId: "hiring-plan-goal",
        label: `What is this ${artifact} mainly for?`,
        helper: "Start with the hiring outcome so the plan stays practical.",
        mode: "single",
        options: ["Define the role", "Attract candidates", "Evaluate candidates", "Run the hiring process"]
      }
    default:
      return {
        focusId: "plan-goal",
        label: `What is this ${artifact} mainly for?`,
        helper: "Start with the main outcome so the plan stays focused.",
        mode: "single",
        options: ["Launch or execution", "Prioritization", "Growth or improvement", "A clearer plan of action"]
      }
  }
}

function buildDomainGoalFallback(context: PromptModeV2TopicContext): PromptModeV2QuestionBrief | null {
  switch (context.domain) {
    case "marketing":
      return {
        focusId: "marketing-goal-fallback",
        label: `What is this ${artifactTitle(context)} mainly for?`,
        helper: "Start with the real marketing objective so the rest of the questions stay useful.",
        mode: "single",
        options: ["Product launch", "Lead generation", "Brand awareness", "Retention or re-engagement"]
      }
    case "sales":
      return {
        focusId: "sales-goal-fallback",
        label: `What is this ${artifactTitle(context)} mainly for?`,
        helper: "Start with the main sales objective before we narrow the rest.",
        mode: "single",
        options: ["Prospecting outreach", "Pipeline growth", "Conversion improvement", "Account expansion"]
      }
    case "education":
      return {
        focusId: "education-goal-fallback",
        label: `What is this ${artifactTitle(context)} mainly for?`,
        helper: "Start with the learning outcome so the follow-up questions stay focused.",
        mode: "single",
        options: ["Exam preparation", "Learning a new skill", "Teaching or lesson planning", "Long-term study routine"]
      }
    case "fitness":
      return {
        focusId: "fitness-goal-fallback",
        label: `What is this ${artifactTitle(context)} mainly for?`,
        helper: "Start with the main health or fitness goal first.",
        mode: "single",
        options: ["Weight loss", "Muscle gain", "General health", "Consistency and routine"]
      }
    case "finance":
      return {
        focusId: "finance-goal-fallback",
        label: `What is this ${artifactTitle(context)} mainly for?`,
        helper: "Pick the main financial goal before we collect the rest of the details.",
        mode: "single",
        options: ["Budgeting", "Saving more", "Debt reduction", "Investing or planning ahead"]
      }
    case "hiring":
      return {
        focusId: "hiring-goal-fallback",
        label: `What is this ${artifactTitle(context)} mainly for?`,
        helper: "Start with the hiring outcome so the rest of the questions stay practical.",
        mode: "single",
        options: ["Define the role", "Attract candidates", "Evaluate candidates", "Run the hiring process"]
      }
    case "product":
      return {
        focusId: "product-goal-fallback",
        label: `What decision should this ${artifactTitle(context)} help with first?`,
        helper: "Start with the product decision that matters most.",
        mode: "single",
        options: ["Choose a direction", "Compare options", "Prioritize what comes first", "Recommend a clearer plan"]
      }
    case "shipping":
      return {
        focusId: "shipping-goal-fallback",
        label: `What do you need first for "${topicPhrase(context)}"?`,
        helper: "Start with the release help that would unblock you fastest.",
        mode: "single",
        options: ["Release plan", "Go/no-go checklist", "Risk review", "Smoke-test plan"]
      }
    case "prompt":
      return {
        focusId: "prompt-goal-fallback",
        label: `What should the improved prompt for "${topicPhrase(context)}" do better first?`,
        helper: "Start with the main prompt failure you want to fix.",
        mode: "single",
        options: ["Preserve constraints better", "Give clearer direction", "Return the right format", "Be more reliable overall"]
      }
    case "rewrite":
      return {
        focusId: "rewrite-goal-fallback",
        label: `What kind of rewrite do you need for "${topicPhrase(context)}"?`,
        helper: "Start with the rewrite goal so the next questions stay relevant.",
        mode: "single",
        options: ["Clearer and shorter", "More polished", "Different tone", "Better structure"]
      }
    case "code":
      return {
        focusId: "code-goal-fallback",
        label: `What do you need first for "${topicPhrase(context)}"?`,
        helper: "Start with the coding outcome so the next questions stay practical.",
        mode: "single",
        options: ["Implement something new", "Fix a problem", "Modify an existing part", "Review or explain the approach"]
      }
    default:
      return null
  }
}

function buildDomainPlanBrief(
  context: PromptModeV2TopicContext,
  sectionId: string
): PromptModeV2QuestionBrief | null {
  const artifact = /\bplan\b|\bstrategy\b|\broadmap\b|\bchecklist\b|\bproposal\b|\bbrief\b/i.test(context.topic)
    ? context.topic
    : `${context.domain} plan`

  switch (context.domain) {
    case "marketing":
      switch (sectionId) {
        case "goal":
          return {
            focusId: "marketing-goal",
            label: `What is this ${artifact} mainly for?`,
            helper: "Start with the real marketing goal so the rest of the questions stay useful.",
            mode: "single",
            options: ["Product launch", "Lead generation", "Brand awareness", "Retention or re-engagement"]
          }
        case "context":
          return {
            focusId: "marketing-context",
            label: `What context should shape this ${artifact}?`,
            helper: "Choose the marketing context that will change the plan the most.",
            mode: "multi",
            options: ["Target audience", "Channel focus", "Business or brand context", "Campaign or launch timing"]
          }
        case "requirements":
          return {
            focusId: "marketing-requirements",
            label: `What should this ${artifact} definitely cover?`,
            helper: "Pick the parts a useful marketing plan cannot skip.",
            mode: "multi",
            options: ["Audience and positioning", "Channels or tactics", "Timeline or phases", "Metrics or success criteria"]
          }
        case "constraints":
          return {
            focusId: "marketing-constraints",
            label: `What limits should this ${artifact} respect?`,
            helper: "Choose the constraints the plan needs to work within.",
            mode: "multi",
            options: ["Budget limit", "Short timeline", "Channel constraints", "Brand or messaging rules"]
          }
        case "output_format":
          return {
            focusId: "marketing-output",
            label: `How should the final ${artifact} be structured?`,
            helper: "Pick the format that would be easiest to use right away.",
            mode: "single",
            options: ["Structured sections", "Bullets or checklist", "Table or matrix", "Phased plan"]
          }
        case "definition_of_complete":
          return {
            focusId: "marketing-complete",
            label: `What would make this ${artifact} feel complete enough?`,
            helper: "Set the quality bar before we assemble the final prompt.",
            mode: "single",
            options: ["Clear audience and goal", "Tactics are practical", "Metrics are defined", "Ready to act on"]
          }
        default:
          return null
      }
    case "sales":
      switch (sectionId) {
        case "goal":
          return {
            focusId: "sales-goal",
            label: `What is this ${artifact} mainly for?`,
            helper: "Start with the sales objective that matters most.",
            mode: "single",
            options: ["Prospecting outreach", "Pipeline growth", "Conversion improvement", "Account expansion"]
          }
        case "context":
          return {
            focusId: "sales-context",
            label: `What context should shape this ${artifact}?`,
            helper: "Choose the sales context that should influence the plan.",
            mode: "multi",
            options: ["Ideal customer or segment", "Sales motion or channel", "Current pipeline context", "Timing or quota pressure"]
          }
        case "requirements":
          return {
            focusId: "sales-requirements",
            label: `What should this ${artifact} definitely cover?`,
            helper: "Pick the parts a useful sales plan cannot skip.",
            mode: "multi",
            options: ["Target segment", "Outreach approach", "Follow-up sequence", "Success metrics"]
          }
        case "constraints":
          return {
            focusId: "sales-constraints",
            label: `What limits should this ${artifact} respect?`,
            helper: "Choose the constraints the sales plan has to work within.",
            mode: "multi",
            options: ["Small team or bandwidth", "Budget limit", "Limited channel options", "Short time horizon"]
          }
        case "output_format":
          return {
            focusId: "sales-output",
            label: `How should the final ${artifact} be structured?`,
            helper: "Pick the structure that will be easiest to use in practice.",
            mode: "single",
            options: ["Step-by-step plan", "Checklist", "Phased plan", "Table or matrix"]
          }
        case "definition_of_complete":
          return {
            focusId: "sales-complete",
            label: `What would make this ${artifact} feel complete enough?`,
            helper: "Set the finish line for a usable sales plan.",
            mode: "single",
            options: ["Actionable right away", "Clear sequence and goals", "Metrics are defined", "Ready to share with the team"]
          }
        default:
          return null
      }
    case "education":
      switch (sectionId) {
        case "goal":
          return {
            focusId: "education-goal",
            label: `What is this ${artifact} mainly for?`,
            helper: "Pick the learning goal first so the plan stays focused.",
            mode: "single",
            options: ["Exam preparation", "Learning a new skill", "Teaching or lesson planning", "Long-term study routine"]
          }
        case "context":
          return {
            focusId: "education-context",
            label: `What context should shape this ${artifact}?`,
            helper: "Choose the learning context that should change the plan.",
            mode: "multi",
            options: ["Current level", "Time available", "Exam or subject context", "Learning style"]
          }
        case "requirements":
          return {
            focusId: "education-requirements",
            label: `What should this ${artifact} definitely cover?`,
            helper: "Pick the parts a useful study plan cannot skip.",
            mode: "multi",
            options: ["Topics or modules", "Timeline", "Practice or review", "Progress checks"]
          }
        case "constraints":
          return {
            focusId: "education-constraints",
            label: `What limits should this ${artifact} respect?`,
            helper: "Choose the constraints the study plan must work within.",
            mode: "multi",
            options: ["Limited study time", "Specific exam date", "Only certain resources", "Need a simple routine"]
          }
        case "output_format":
          return {
            focusId: "education-output",
            label: `How should the final ${artifact} be structured?`,
            helper: "Pick the format that will be easiest to follow.",
            mode: "single",
            options: ["Week-by-week plan", "Checklist", "Daily routine", "Table or schedule"]
          }
        case "definition_of_complete":
          return {
            focusId: "education-complete",
            label: `What would make this ${artifact} feel complete enough?`,
            helper: "Set the quality bar for a useful study plan.",
            mode: "single",
            options: ["Easy to follow", "Covers the right topics", "Fits the available time", "Feels realistic to stick with"]
          }
        default:
          return null
      }
    case "fitness":
      switch (sectionId) {
        case "goal":
          return {
            focusId: "fitness-goal",
            label: `What is this ${artifact} mainly for?`,
            helper: "Pick the main fitness goal first so the plan stays on target.",
            mode: "single",
            options: ["Weight loss", "Muscle gain", "General health", "Consistency and routine"]
          }
        case "context":
          return {
            focusId: "fitness-context",
            label: `What context should shape this ${artifact}?`,
            helper: "Choose the real-world context that should influence the plan.",
            mode: "multi",
            options: ["Current routine", "Available equipment", "Time available", "Diet or recovery context"]
          }
        case "requirements":
          return {
            focusId: "fitness-requirements",
            label: `What should this ${artifact} definitely cover?`,
            helper: "Pick the parts a useful workout or fitness plan cannot skip.",
            mode: "multi",
            options: ["Workout structure", "Nutrition focus", "Schedule or cadence", "Progress tracking"]
          }
        case "constraints":
          return {
            focusId: "fitness-constraints",
            label: `What limits should this ${artifact} respect?`,
            helper: "Choose the constraints the plan needs to work within.",
            mode: "multi",
            options: ["Time limit", "Equipment limits", "Injury or recovery limits", "Diet or calorie constraints"]
          }
        case "output_format":
          return {
            focusId: "fitness-output",
            label: `How should the final ${artifact} be structured?`,
            helper: "Pick the format that will be easiest to follow consistently.",
            mode: "single",
            options: ["Step-by-step routine", "Weekly plan", "Checklist", "Table or schedule"]
          }
        case "definition_of_complete":
          return {
            focusId: "fitness-complete",
            label: `What would make this ${artifact} feel complete enough?`,
            helper: "Set the quality bar for a useful fitness plan.",
            mode: "single",
            options: ["Easy to follow", "Fits real constraints", "Feels realistic and safe", "Has a clear progression"]
          }
        default:
          return null
      }
    case "finance":
      switch (sectionId) {
        case "goal":
          return {
            focusId: "finance-goal",
            label: `What is this ${artifact} mainly for?`,
            helper: "Choose the main financial goal before we collect other details.",
            mode: "single",
            options: ["Budgeting", "Saving more", "Debt reduction", "Investing or planning ahead"]
          }
        case "context":
          return {
            focusId: "finance-context",
            label: `What context should shape this ${artifact}?`,
            helper: "Choose the context that should influence the financial plan.",
            mode: "multi",
            options: ["Current situation", "Income or cash-flow context", "Time horizon", "Risk tolerance"]
          }
        case "requirements":
          return {
            focusId: "finance-requirements",
            label: `What should this ${artifact} definitely cover?`,
            helper: "Pick the parts a useful financial plan cannot skip.",
            mode: "multi",
            options: ["Targets and numbers", "Timeline", "Trade-offs or priorities", "Action steps"]
          }
        case "constraints":
          return {
            focusId: "finance-constraints",
            label: `What limits should this ${artifact} respect?`,
            helper: "Choose the constraints the plan needs to work within.",
            mode: "multi",
            options: ["Limited budget", "Short time horizon", "Low risk tolerance", "Need a simple plan"]
          }
        case "output_format":
          return {
            focusId: "finance-output",
            label: `How should the final ${artifact} be structured?`,
            helper: "Pick the format that will be easiest to use and review.",
            mode: "single",
            options: ["Step-by-step plan", "Checklist", "Table or budget view", "Phased plan"]
          }
        case "definition_of_complete":
          return {
            focusId: "finance-complete",
            label: `What would make this ${artifact} feel complete enough?`,
            helper: "Set the finish line for a useful financial plan.",
            mode: "single",
            options: ["Clear next steps", "Realistic numbers and targets", "Fits the constraints", "Easy to review and follow"]
          }
        default:
          return null
      }
    case "hiring":
      switch (sectionId) {
        case "goal":
          return {
            focusId: "hiring-goal",
            label: `What is this ${artifact} mainly for?`,
            helper: "Start with the hiring outcome so the plan stays practical.",
            mode: "single",
            options: ["Define the role", "Attract candidates", "Evaluate candidates", "Run the hiring process"]
          }
        case "context":
          return {
            focusId: "hiring-context",
            label: `What context should shape this ${artifact}?`,
            helper: "Choose the hiring context that should change the plan.",
            mode: "multi",
            options: ["Role or team context", "Timeline or urgency", "Hiring stage", "Stakeholder or interview context"]
          }
        case "requirements":
          return {
            focusId: "hiring-requirements",
            label: `What should this ${artifact} definitely cover?`,
            helper: "Pick the parts a useful hiring plan cannot skip.",
            mode: "multi",
            options: ["Role or process stages", "Evaluation criteria", "Timeline", "Risks or blockers"]
          }
        case "constraints":
          return {
            focusId: "hiring-constraints",
            label: `What limits should this ${artifact} respect?`,
            helper: "Choose the constraints the hiring plan needs to work within.",
            mode: "multi",
            options: ["Small team or bandwidth", "Short timeline", "Strict requirements", "Limited interview capacity"]
          }
        case "output_format":
          return {
            focusId: "hiring-output",
            label: `How should the final ${artifact} be structured?`,
            helper: "Pick the format that will be easiest to use in the hiring process.",
            mode: "single",
            options: ["Step-by-step plan", "Checklist", "Interview matrix", "Phased process plan"]
          }
        case "definition_of_complete":
          return {
            focusId: "hiring-complete",
            label: `What would make this ${artifact} feel complete enough?`,
            helper: "Set the quality bar for a useful hiring plan.",
            mode: "single",
            options: ["Easy to follow", "Covers the whole process", "Fits the constraints", "Ready to use with the team"]
          }
        default:
          return null
      }
    default:
      return null
  }
}

function sectionFacts(section: ReviewPromptModeV2SectionState) {
  return normalizeLower(
    [...section.resolvedContent, ...section.partialContent, ...section.resolvedSignals]
      .filter((value) => !/\bdetected\b/i.test(value))
      .join(" ; ")
  )
}

function notesText(additionalNotes: string[]) {
  return normalizeLower(additionalNotes.join(" ; ").replace(/\s*\(not yet merged\)\s*/gi, " "))
}

function promptAndSectionText(promptText: string, section: ReviewPromptModeV2SectionState, additionalNotes: string[]) {
  return normalizeLower([promptText, sectionFacts(section), notesText(additionalNotes)].join(" ; "))
}

function hasConstraintType(goalContract: GoalContract | null, types: GoalConstraint["type"][]) {
  if (!goalContract) return false
  return goalContract.hardConstraints.some((item) => types.includes(item.type))
}

function hasOutputRequirement(goalContract: GoalContract | null, pattern: RegExp) {
  if (!goalContract) return false
  return goalContract.outputRequirements.some((item) => pattern.test(item))
}

function mentionsAny(source: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(source))
}

function mealTypeOptions(topic: string) {
  if (/\bbreakfast\b/.test(topic)) return ["Breakfast", "Quick breakfast", "High-protein breakfast", "Meal-prep breakfast"]
  if (/\blunch\b/.test(topic)) return ["Lunch", "Quick lunch", "High-protein lunch", "Meal-prep lunch"]
  if (/\bdinner\b/.test(topic)) return ["Dinner", "Weeknight dinner", "Light dinner", "Family dinner"]
  return ["Breakfast", "Lunch", "Dinner", "Snack"]
}

function buildMealBrief(input: BuildPromptModeV2QuestionBriefInput, context: PromptModeV2TopicContext): PromptModeV2QuestionBrief | null {
  const combined = promptAndSectionText(input.promptText, input.section, input.additionalNotes)
  const topic = topicPhrase(context)

  switch (input.section.id) {
    case "goal":
      if (!mentionsAny(combined, [/\bbreakfast\b/, /\blunch\b/, /\bdinner\b/, /\bsnack\b/])) {
        return {
          focusId: "meal-type",
          label: `What kind of ${topic} do you want?`,
          helper: "Start by narrowing the kind of meal so the next questions stay useful.",
          mode: "single",
          options: mealTypeOptions(combined)
        }
      }
      return {
        focusId: input.depth === "primary" ? "meal-outcome" : "meal-fit",
        label:
          input.depth === "primary"
            ? `What matters most for this ${topic}?`
            : `What would make this ${topic} feel like the right fit?`,
        helper:
          input.depth === "primary"
            ? "Choose the main health or usability goal before we collect the rest."
            : "Pick the detail that would make the answer feel more tailored.",
        mode: "single",
        options:
          input.depth === "primary"
            ? ["High protein", "Low calorie", "Quick and easy", "Budget-friendly"]
            : ["Simple enough to make today", "Filling enough to satisfy", "Uses familiar ingredients", "Easy to customize"]
      }
    case "context":
      return {
        focusId: input.depth === "primary" ? "meal-context-user" : "meal-context-routine",
        label:
          input.depth === "primary"
            ? `Who is this ${topic} mainly for?`
            : `How will you actually use this ${topic}?`,
        helper:
          input.depth === "primary"
            ? "A little context will make the meal suggestions more practical."
            : "Pick the real-life context that should shape the answer.",
        mode: "single",
        options:
          input.depth === "primary"
            ? ["Just me", "Kids or family", "Meal prep", "Guests"]
            : ["For a weekday routine", "For meal prep", "For a quick work break", "For a lighter option"]
      }
    case "requirements":
      if (!mentionsAny(combined, [/\bprotein\b/, /\bcalorie\b/, /\bhealthy\b/, /\bweight loss\b/, /\blow[- ]carb\b/])) {
        return {
          focusId: "meal-health-goal",
          label: `What should this ${topic} optimize for most?`,
          helper: "Choose the main outcome so the meal advice stays on target.",
          mode: "multi",
          options: ["High protein", "Low calorie", "Balanced and healthy", "More filling or satisfying"]
        }
      }
      return {
        focusId: input.depth === "primary" ? "meal-must-haves" : "meal-ingredients",
        label:
          input.depth === "primary"
            ? `What should definitely be included in this ${topic}?`
            : `Which ingredient or flavor direction fits this ${topic} best?`,
        helper:
          input.depth === "primary"
            ? "Pick the parts the answer must include."
            : "Pick the ingredient direction that should guide the meal.",
        mode: "multi",
        options:
          input.depth === "primary"
            ? ["Specific ingredients", "Exact amounts", "Nutrition details", "Step-by-step instructions"]
            : ["Chicken or fish", "Plant-based protein", "Fresh vegetables", "Simple pantry ingredients"]
      }
    case "constraints":
      if (!hasConstraintType(input.goalContract, ["time"])) {
        return {
          focusId: "meal-time-limit",
          label: `How much time should this ${topic} take?`,
          helper: "Time is one of the biggest filters for meal suggestions.",
          mode: "single",
          options: ["5 minutes or less", "15 minutes or less", "30 minutes or less", "Time does not matter much"]
        }
      }
      if (!hasConstraintType(input.goalContract, ["diet", "exclusion"])) {
        return {
          focusId: "meal-food-rules",
          label: `Any food rules or exclusions for this ${topic}?`,
          helper: "Choose the food rules the answer must respect.",
          mode: "multi",
          options: ["Vegetarian or vegan", "Low-carb or high-protein", "No dairy / no nuts / no gluten", "Keep ingredients very simple"]
        }
      }
      return {
        focusId: input.depth === "primary" ? "meal-cooking-limits" : "meal-budget-limits",
        label:
          input.depth === "primary"
            ? `Any cooking or method limits for this ${topic}?`
            : `Any budget or ingredient limits for this ${topic}?`,
        helper:
          input.depth === "primary"
            ? "Pick the limits that should keep the meal realistic."
            : "Pick one more practical limit only if it matters.",
        mode: "multi",
        options:
          input.depth === "primary"
            ? ["No oven or stove", "One pan / minimal cleanup", "No leftovers", "Specific cooking method"]
            : ["Budget-friendly", "Use easy-to-find ingredients", "Avoid expensive protein", "No specialty items"]
      }
    case "output_format":
      return {
        focusId: input.depth === "primary" ? "meal-output-shape" : "meal-output-detail",
        label:
          input.depth === "primary"
            ? `How should I return the ${topic} answer?`
            : `What should the final ${topic} answer include?`,
        helper:
          input.depth === "primary"
            ? "Pick the answer shape that would be most useful right away."
            : "Pick the detail that would make the answer easier to use.",
        mode: "single",
        options:
          input.depth === "primary"
            ? ["One recipe", "A few meal ideas", "A simple meal plan", "Recipe plus shopping list"]
            : ["Ingredients plus steps", "Ingredients plus steps plus calories", "Ingredients plus steps plus macros", "Very concise recipe card"]
      }
    case "definition_of_complete":
      return {
        focusId: input.depth === "primary" ? "meal-definition" : "meal-confidence-bar",
        label:
          input.depth === "primary"
            ? `What would make this ${topic} answer feel complete?`
            : `What would make you trust the final ${topic} answer?`,
        helper:
          input.depth === "primary"
            ? "Set the finish line before we assemble the prompt."
            : "Pick the final quality bar that matters most.",
        mode: "single",
        options:
          input.depth === "primary"
            ? ["Easy enough to make today", "Hits the nutrition goal", "Uses simple ingredients", "Includes exact amounts"]
            : ["Clearly follows the constraints", "Feels practical and realistic", "Would not need much editing", "Feels tailored to me"]
      }
    default:
      return null
  }
}

function buildProblemSolvingBrief(input: BuildPromptModeV2QuestionBriefInput, context: PromptModeV2TopicContext): PromptModeV2QuestionBrief | null {
  const topic = topicPhrase(context)
  switch (input.section.id) {
    case "expected_behavior":
      return {
        focusId: input.depth === "primary" ? "debug-expected" : "debug-expected-edge",
        label:
          input.depth === "primary"
            ? `When "${topic}" is working, what should happen first?`
            : `What kind of successful behavior matters most for "${topic}"?`,
        helper:
          input.depth === "primary"
            ? "Start with the success case so the diagnosis has a clear target."
            : "Pick the behavior the eventual fix must protect.",
        mode: "single",
        options:
          input.depth === "primary"
            ? ["The UI should render normally", "The action should complete", "The output should be correct", "It should stay stable"]
            : ["No visible errors", "Correct output every time", "Predictable UI behavior", "Safe handling of edge cases"]
      }
    case "actual_behavior":
      return {
        focusId: input.depth === "primary" ? "debug-actual" : "debug-pattern",
        label:
          input.depth === "primary"
            ? `What is "${topic}" doing instead?`
            : `What failure pattern best matches "${topic}"?`,
        helper:
          input.depth === "primary"
            ? "Describe the failure in plain language before we narrow the fix."
            : "Choose the pattern that best describes how it breaks.",
        mode: "multi",
        options:
          input.depth === "primary"
            ? ["It errors or crashes", "The UI is blank or broken", "The wrong output appears", "It behaves inconsistently"]
            : ["Only fails sometimes", "Fails after a recent change", "Fails in one environment only", "Does nothing visible"]
      }
    case "evidence":
      return {
        focusId: input.depth === "primary" ? "debug-evidence" : "debug-proof-clue",
        label:
          input.depth === "primary"
            ? `What evidence do you already have for "${topic}"?`
            : `Which clue would help explain "${topic}" fastest?`,
        helper:
          input.depth === "primary"
            ? "Pick the strongest clue we can use next."
            : "Choose the most useful signal before the AI suggests a fix.",
        mode: "multi",
        options:
          input.depth === "primary"
            ? ["Error message", "Console or logs", "Steps to reproduce", "UI state or screenshot"]
            : ["Recent code change", "Network/request issue", "Timing or race issue", "State/render mismatch"]
      }
    case "environment_context":
      return {
        focusId: input.depth === "primary" ? "debug-environment" : "debug-trigger",
        label:
          input.depth === "primary"
            ? `What environment detail matters most for "${topic}"?`
            : `What condition seems to trigger "${topic}" most often?`,
        helper:
          input.depth === "primary"
            ? "Choose the detail that is most likely to change the diagnosis."
            : "Pick the condition the AI should account for while debugging.",
        mode: "multi",
        options:
          input.depth === "primary"
            ? ["Browser or runtime", "Framework or stack", "Recent change", "Only happens in one environment"]
            : ["Only after navigation", "Only after refresh", "Only in production", "Only after one recent change"]
      }
    case "desired_ai_help":
      return {
        focusId: input.depth === "primary" ? "debug-help" : "debug-next-move",
        label:
          input.depth === "primary"
            ? `What do you want first for "${topic}"?`
            : `What should the AI prioritize after the first diagnosis?`,
        helper:
          input.depth === "primary"
            ? "Pick the most useful next move from the AI."
            : "Choose the most helpful follow-up after the first pass.",
        mode: "single",
        options:
          input.depth === "primary"
            ? ["Most likely root cause", "Exact fix", "Debugging plan", "Verification plan"]
            : ["Fix with minimal scope", "Safer diagnosis before changes", "Regression-aware fix plan", "Proof steps after the fix"]
      }
    case "fix_proof":
      return {
        focusId: input.depth === "primary" ? "debug-proof" : "debug-regression-proof",
        label:
          input.depth === "primary"
            ? `What would prove "${topic}" is actually fixed?`
            : `What else should be checked before calling "${topic}" fixed?`,
        helper:
          input.depth === "primary"
            ? "Set the proof bar now so the answer does not stop at a plausible guess."
            : "Choose the final checks that would make the fix trustworthy.",
        mode: "multi",
        options:
          input.depth === "primary"
            ? ["The bug no longer reproduces", "UI visibly works", "Tests/checks pass", "The error disappears from logs"]
            : ["Regression checks pass", "Edge cases are covered", "The runtime stays stable", "Monitoring or logs stay clean"]
      }
    default:
      return null
  }
}

function buildModificationBrief(input: BuildPromptModeV2QuestionBriefInput, context: PromptModeV2TopicContext): PromptModeV2QuestionBrief | null {
  const topic = topicPhrase(context)
  switch (input.section.id) {
    case "current_state":
      return {
        focusId: input.depth === "primary" ? "modify-current-state" : "modify-baseline-risk",
        label:
          input.depth === "primary"
            ? `What should the AI understand first about the current version of "${topic}"?`
            : `What existing behavior matters most before changing "${topic}"?`,
        helper:
          input.depth === "primary"
            ? "Start with the baseline before changing anything."
            : "Choose the baseline detail that should stay anchored while making the change.",
        mode: "multi",
        options:
          input.depth === "primary"
            ? ["Current output or copy", "Existing behavior", "Current file or code", "Known limitation"]
            : ["Core behavior must stay intact", "Current layout/format matters", "Compatibility matters", "There is a known fragile area"]
      }
    case "requested_change":
      return {
        focusId: input.depth === "primary" ? "modify-change-type" : "modify-change-intensity",
        label:
          input.depth === "primary"
            ? `What kind of change do you want for "${topic}"?`
            : `How big should the change to "${topic}" be?`,
        helper:
          input.depth === "primary"
            ? "Choose the main kind of change before narrowing the details."
            : "Pick the intensity so the answer does not overshoot.",
        mode: "single",
        options:
          input.depth === "primary"
            ? ["Refine something existing", "Replace part of it", "Add something new", "Remove something"]
            : ["Very small edit", "Targeted change", "Meaningful improvement", "First safe pass only"]
      }
    case "scope_boundaries":
      return {
        focusId: input.depth === "primary" ? "modify-scope" : "modify-out-of-scope",
        label:
          input.depth === "primary"
            ? `What should stay out of scope while changing "${topic}"?`
            : `What should the AI be especially careful not to touch in "${topic}"?`,
        helper:
          input.depth === "primary"
            ? "Keep the request focused so the answer does not wander."
            : "Choose the area the AI should leave alone.",
        mode: "multi",
        options:
          input.depth === "primary"
            ? ["Do not widen the scope", "Touch only one area", "No structural rewrite", "No visual redesign"]
            : ["Do not change nearby behavior", "Do not change layout or formatting", "Do not rename or restructure broadly", "Do not expand the task"]
      }
    case "preserve_rules":
      return {
        focusId: input.depth === "primary" ? "modify-preserve" : "modify-regression-guard",
        label:
          input.depth === "primary"
            ? `What absolutely needs to stay the same in "${topic}"?`
            : `What regression risk matters most while changing "${topic}"?`,
        helper:
          input.depth === "primary"
            ? "Pick what the AI should protect while making the change."
            : "Choose the thing the AI should be most careful not to break.",
        mode: "multi",
        options:
          input.depth === "primary"
            ? ["Existing behavior", "Tone/style", "Layout/format", "Compatibility"]
            : ["User-visible behavior", "Current styling or voice", "Compatibility with nearby code", "Overall structure"]
      }
    case "output_format":
      return {
        focusId: input.depth === "primary" ? "modify-output" : "modify-explanation",
        label:
          input.depth === "primary"
            ? `How should the updated version of "${topic}" be returned?`
            : `What extra change detail would be most useful for "${topic}"?`,
        helper:
          input.depth === "primary"
            ? "Choose the output shape that will be easiest to use."
            : "Pick the extra context that would make the result easier to apply.",
        mode: "single",
        options:
          input.depth === "primary"
            ? ["Edited final version", "Patch-style change", "Updated code block", "Short diff summary"]
            : ["Just the updated result", "Result plus change summary", "Result plus regression note", "Result plus what stayed the same"]
      }
    default:
      return null
  }
}

function buildCreationBrief(input: BuildPromptModeV2QuestionBriefInput, context: PromptModeV2TopicContext): PromptModeV2QuestionBrief | null {
  if (context.domain === "meal" || context.domain === "recipe") {
    return buildMealBrief(input, context)
  }

  const domainPlanBrief = buildDomainPlanBrief(context, input.section.id)
  if (domainPlanBrief) {
    return domainPlanBrief
  }

  if (
    input.section.id === "goal" &&
    context.artifactCertain &&
    ["plan", "strategy", "roadmap", "checklist", "proposal", "brief"].includes(context.artifactKind)
  ) {
    return buildPlanGoalBrief(context)
  }

  const topic = topicPhrase(context)
  switch (context.domain) {
    case "product":
      switch (input.section.id) {
        case "goal":
          return {
            focusId: "product-goal",
            label: `What do you want the AI to help decide for "${topic}"?`,
            helper: "Start with the real product decision or recommendation you need.",
            mode: "single",
            options: ["Make a recommendation", "Compare options", "Prioritize what comes first", "Define a clearer direction"]
          }
        case "context":
          return {
            focusId: "product-context",
            label: `What context matters most for "${topic}"?`,
            helper: "Pick the context that should shape the recommendation first.",
            mode: "multi",
            options: ["Current product state", "Specific feature area", "User/business context", "Roadmap or timing context"]
          }
        case "requirements":
          return {
            focusId: "product-factors",
            label: `What should the AI weigh most heavily for "${topic}"?`,
            helper: "Choose the decision factors that matter most.",
            mode: "multi",
            options: ["User value", "Engineering effort", "Business impact", "Risks and trade-offs"]
          }
        case "constraints":
          return {
            focusId: "product-constraints",
            label: `What trade-off or constraint matters most in "${topic}"?`,
            helper: "Pick the tension that should shape the answer.",
            mode: "multi",
            options: ["Speed vs quality", "Scope vs focus", "Growth vs trust", "Cost vs complexity"]
          }
        case "output_format":
          return {
            focusId: "product-output",
            label: `What kind of answer would help most for "${topic}"?`,
            helper: "Choose the answer shape that gets you closest to a decision.",
            mode: "single",
            options: ["Clear recommendation", "Options with trade-offs", "Decision memo", "Prioritized framework"]
          }
        case "definition_of_complete":
          return {
            focusId: "product-complete",
            label: `What would make the answer for "${topic}" decision-ready?`,
            helper: "Set the bar for when the recommendation becomes useful enough to act on.",
            mode: "single",
            options: ["Clear recommendation", "Trade-offs are explicit", "Risks are called out", "Next step is obvious"]
          }
        default:
          return null
      }
    case "shipping":
      switch (input.section.id) {
        case "goal":
          return {
            focusId: "shipping-goal",
            label: `What do you want the AI to produce for "${topic}" first?`,
            helper: "Start with the release help you actually need.",
            mode: "single",
            options: ["Release plan", "Go/no-go checklist", "Risk review", "Smoke-test plan"]
          }
        case "context":
          return {
            focusId: "shipping-context",
            label: `What shipping context matters most for "${topic}"?`,
            helper: "Choose the release context that should shape the answer.",
            mode: "multi",
            options: ["Current release status", "Target environment", "Known blocker or risk", "Recent change or rollout context"]
          }
        case "requirements":
          return {
            focusId: "shipping-requirements",
            label: `What has to be true before "${topic}" can ship?`,
            helper: "Pick the non-negotiable release requirements first.",
            mode: "multi",
            options: ["QA sign-off", "Launch checklist", "Docs/changelog", "Approval or handoff"]
          }
        case "constraints":
          return {
            focusId: "shipping-constraints",
            label: `What risk or limit should the plan for "${topic}" respect?`,
            helper: "Pick the concern that should shape the plan most.",
            mode: "multi",
            options: ["Regression risk", "Deployment risk", "Missing verification", "Dependency or rollout risk"]
          }
        case "output_format":
          return {
            focusId: "shipping-output",
            label: `How should the shipping answer for "${topic}" be returned?`,
            helper: "Choose the release output shape that will be easiest to use.",
            mode: "single",
            options: ["Checklist", "Step-by-step plan", "Risk matrix", "Short go/no-go recommendation"]
          }
        case "definition_of_complete":
          return {
            focusId: "shipping-complete",
            label: `What would make "${topic}" feel ready enough to ship?`,
            helper: "Set the finish line for the release answer.",
            mode: "single",
            options: ["Ready to launch", "Ready for final QA", "Ready for approval", "Ready for handoff"]
          }
        default:
          return null
      }
    case "prompt":
      switch (input.section.id) {
        case "goal":
          return {
            focusId: "prompt-goal",
            label: `What should the improved prompt for "${topic}" help the AI do better?`,
            helper: "Start with the job the new prompt needs to do well.",
            mode: "single",
            options: ["Generate a better first draft", "Preserve constraints better", "Return the right format", "Be more reliable"]
          }
        case "context":
          return {
            focusId: "prompt-context",
            label: `What context matters most for the prompt about "${topic}"?`,
            helper: "Choose the usage context that should shape the rewrite.",
            mode: "multi",
            options: ["Chat model use", "Coding assistant use", "Research or analysis use", "High-stakes use"]
          }
        case "requirements":
          return {
            focusId: "prompt-requirements",
            label: `What should the improved prompt for "${topic}" definitely include?`,
            helper: "Pick the must-have improvements first.",
            mode: "multi",
            options: ["Clearer constraints", "Stronger task direction", "Better output structure", "A clearer quality bar"]
          }
        case "constraints":
          return {
            focusId: "prompt-constraints",
            label: `What should the improved prompt for "${topic}" avoid?`,
            helper: "Choose the failure pattern the rewrite should prevent first.",
            mode: "multi",
            options: ["Too much ambiguity", "Missing constraints", "Wrong output shape", "Overly broad scope"]
          }
        case "output_format":
          return {
            focusId: "prompt-output",
            label: `How should I return the improved prompt for "${topic}"?`,
            helper: "Choose the format that will be easiest to use next.",
            mode: "single",
            options: ["Final prompt only", "Prompt plus rationale", "A few prompt options", "Prompt with checklist"]
          }
        case "definition_of_complete":
          return {
            focusId: "prompt-complete",
            label: `What would make the improved prompt for "${topic}" good enough?`,
            helper: "Set the bar for when the rewrite is actually useful.",
            mode: "single",
            options: ["Meaning is preserved", "Constraints are much clearer", "Output shape is explicit", "It feels reliable to reuse"]
          }
        default:
          return null
      }
    default:
      switch (input.section.id) {
        case "goal":
          if (!input.goalContract?.deliverableType && !context.artifactCertain) {
            const domainGoalFallback = buildDomainGoalFallback(context)
            if (domainGoalFallback) {
              return domainGoalFallback
            }
            return {
              focusId: "creation-deliverable",
              label: `What kind of result do you want for "${topic}"?`,
              helper: "Lock down the deliverable before we go deeper.",
              mode: "single",
              options: ["A recipe or meal idea", "A rewrite or edited version", "Code or page output", "A recommendation or plan"]
            }
          }
          return {
            focusId: context.artifactCertain ? `creation-goal:${context.artifactKind}` : "creation-goal",
            label: context.artifactCertain
              ? `What should this ${artifactTitle(context)} mainly help you achieve?`
              : `What should the AI make first for "${topic}"?`,
            helper: context.artifactCertain
              ? "The artifact is already clear, so pick the main goal it should optimize for."
              : "Pick the main outcome before we collect extra detail.",
            mode: "single",
            options: context.artifactCertain
              ? ["Clear direction first", "Ready-to-use version", "Practical first draft", "A few strong options"]
              : ["A usable first draft", "A polished ready-to-use result", "A minimal starter", "A few strong options"]
          }
        case "context":
          return {
            focusId: "creation-context",
            label: context.artifactCertain
              ? `What context should shape this ${artifactTitle(context)}?`
              : `What context would help shape the answer for "${topic}"?`,
            helper: "Only add context that will actually change the output.",
            mode: "multi",
            options:
              context.domain === "marketing"
                ? ["Target audience", "Channel focus", "Business or brand context", "Campaign or launch timing"]
                : context.domain === "education"
                  ? ["Current level", "Time available", "Exam or subject context", "Learning style"]
                  : context.domain === "fitness"
                    ? ["Current routine", "Available equipment", "Time available", "Diet or recovery context"]
                    : ["Who it is for", "Where it will be used", "Project/domain context", "Current draft or source material"]
          }
        case "requirements":
          return {
            focusId: "creation-requirements",
            label: context.artifactCertain
              ? `What should this ${artifactTitle(context)} definitely cover?`
              : `What absolutely needs to be included for "${topic}"?`,
            helper: "Pick the must-have parts before we worry about polish.",
            mode: "multi",
            options:
              context.domain === "marketing"
                ? ["Audience and positioning", "Channels or tactics", "Timeline or phases", "Metrics or success criteria"]
                : context.domain === "finance"
                  ? ["Targets and numbers", "Timeline", "Risks or trade-offs", "Action steps"]
                  : context.domain === "hiring"
                    ? ["Role or process stages", "Evaluation criteria", "Timeline", "Risks or blockers"]
                    : ["Core sections", "Specific parts", "Named features", "Examples or evidence"]
          }
        case "constraints":
          return {
            focusId: "creation-constraints",
            label: context.artifactCertain
              ? `What limits should this ${artifactTitle(context)} respect?`
              : `What limits should the answer for "${topic}" respect?`,
            helper: "Pick the guardrails the AI should not break.",
            mode: "multi",
            options:
              context.domain === "marketing"
                ? ["Budget limit", "Short timeline", "Channel constraints", "Brand or messaging rules"]
                : context.domain === "education"
                  ? ["Limited study time", "Specific exam date", "Only certain resources", "Need a simple routine"]
                  : context.domain === "fitness"
                    ? ["Time limit", "Equipment limits", "Injury or recovery limits", "Diet or calorie constraints"]
                    : ["Time limit", "Budget or cost", "Tool or method", "Do-not-use exclusions", "Numeric targets"]
          }
        case "output_format":
          return {
            focusId: "creation-output",
            label: context.artifactCertain
              ? `How should the final ${artifactTitle(context)} be structured?`
              : `How do you want the answer for "${topic}" returned?`,
            helper: "Pick the output shape that will be easiest to use.",
            mode: "single",
            options:
              ["plan", "strategy", "roadmap", "checklist", "proposal", "brief"].includes(context.artifactKind)
                ? ["Structured sections", "Bullets or checklist", "Table or matrix", "Phased plan"]
                : ["Structured sections", "Bullets or checklist", "Table or matrix", "Code or file output"]
          }
        case "definition_of_complete":
          return {
            focusId: "creation-complete",
            label: context.artifactCertain
              ? `What would make this ${artifactTitle(context)} feel complete enough?`
              : `What would make the answer for "${topic}" feel complete enough?`,
            helper: "Set the quality bar before the AI fills in the rest.",
            mode: "single",
            options: ["All hard constraints satisfied", "Immediately usable", "Good enough to edit from", "Ready to ship"]
          }
        default:
          return null
      }
  }
}

export function buildPromptModeV2QuestionBrief(input: BuildPromptModeV2QuestionBriefInput): PromptModeV2QuestionBrief | null {
  const context = deriveTopicContext(input.promptText, input.goalContract, input.taskType)
  const templateKind = resolvePromptModeV2TemplateKind(input.taskType)

  if (templateKind === "problem_solving") {
    return buildProblemSolvingBrief(input, context)
  }

  if (templateKind === "modification") {
    return buildModificationBrief(input, context)
  }

  return buildCreationBrief(input, context)
}
