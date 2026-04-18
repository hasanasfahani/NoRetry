import type { ClarificationQuestion } from "@prompt-optimizer/shared/src/schemas"
import type { GoalContract } from "../../goal/types"
import type { ReviewPromptModeV2Question } from "../types"
import type { ReviewPromptModeV2TemplateKind } from "./request-types"
import type { ReviewPromptModeV2SectionState } from "./section-schemas"

type MapLegacyQuestionToPromptModeV2Input = {
  question: ClarificationQuestion
  templateKind: ReviewPromptModeV2TemplateKind
  sections: ReviewPromptModeV2SectionState[]
  goalContract: GoalContract | null
  promptText: string
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function sectionLabel(sections: ReviewPromptModeV2SectionState[], sectionId: string) {
  return sections.find((section) => section.id === sectionId)?.label ?? sectionId.replace(/_/g, " ")
}

function bestAvailableSection(sections: ReviewPromptModeV2SectionState[], preferred: string[]) {
  for (const id of preferred) {
    if (sections.some((section) => section.id === id)) return id
  }
  return sections[0]?.id ?? "goal"
}

function mapProblemSolvingSection(text: string, sections: ReviewPromptModeV2SectionState[]) {
  if (/\bexpected\b|\bshould happen\b|\bworking\b|\bwhen things are working\b/.test(text)) {
    return bestAvailableSection(sections, ["expected_behavior"])
  }
  if (/\bactual\b|\bactually happening\b|\bfailure pattern\b|\bwrong output\b|\bblank\b|\bbroken\b|\berror\b|\bcrash\b/.test(text)) {
    return bestAvailableSection(sections, ["actual_behavior"])
  }
  if (/\bevidence\b|\blogs?\b|\brepro\b|\breproduce\b|\bscreens?\b|\bclues?\b|\bproof\b/.test(text)) {
    return bestAvailableSection(sections, ["evidence", "fix_proof"])
  }
  if (/\benvironment\b|\bbrowser\b|\bruntime\b|\bframework\b|\bstack\b|\bplatform\b|\brecent changes?\b/.test(text)) {
    return bestAvailableSection(sections, ["environment_context"])
  }
  if (/\bwhat kind of help\b|\bwhat do you want\b|\bdiagnos(?:is|e)\b|\bdebugging plan\b|\bverification plan\b|\bfix\b/.test(text)) {
    return bestAvailableSection(sections, ["desired_ai_help"])
  }
  if (/\bverify\b|\bvalidation\b|\bproof\b|\bcount as proof\b|\bactually fixed\b|\btests?\b/.test(text)) {
    return bestAvailableSection(sections, ["fix_proof"])
  }
  return bestAvailableSection(sections, ["actual_behavior", "evidence", "desired_ai_help"])
}

function mapModificationSection(text: string, sections: ReviewPromptModeV2SectionState[]) {
  if (/\bcurrent state\b|\bexisting\b|\bbaseline\b|\bcurrent output\b|\bcurrent code\b|\bcurrent file\b/.test(text)) {
    return bestAvailableSection(sections, ["current_state"])
  }
  if (/\bkind of change\b|\brequested change\b|\bmainly asking for\b|\bwhat should change\b|\bmodify\b|\bupdate\b|\bedit\b/.test(text)) {
    return bestAvailableSection(sections, ["requested_change"])
  }
  if (/\bout of scope\b|\bscope\b|\bonly change\b|\bdo not\b|\btouch only\b/.test(text)) {
    return bestAvailableSection(sections, ["scope_boundaries"])
  }
  if (/\bpreserve\b|\bstay the same\b|\bprotect\b|\bregression\b|\bkeep\b/.test(text)) {
    return bestAvailableSection(sections, ["preserve_rules", "scope_boundaries"])
  }
  if (/\breturned\b|\boutput\b|\bdiff\b|\bpatch\b|\bfinal version\b|\bcode block\b/.test(text)) {
    return bestAvailableSection(sections, ["output_format"])
  }
  if (/\bcomplete enough\b|\bfinish line\b|\bcomplete\b|\bready to apply\b/.test(text)) {
    return bestAvailableSection(sections, ["definition_of_complete"])
  }
  return bestAvailableSection(sections, ["requested_change", "preserve_rules", "scope_boundaries"])
}

function mapCreationSection(text: string, sections: ReviewPromptModeV2SectionState[], goalContract: GoalContract | null, promptText: string) {
  const normalizedPrompt = normalize(promptText)
  const deliverableType = goalContract?.deliverableType ?? ""

  if (/\bwhat kind of result\b|\bwhat should .*?(create|make|produce)\b|\bmain outcome\b|\bmainly for\b|\bwhat do you need first\b/.test(text)) {
    return bestAvailableSection(sections, ["goal"])
  }
  if (/\bcontext\b|\bwho it is for\b|\bwhere it will be used\b|\baudience\b|\buse case\b/.test(text)) {
    return bestAvailableSection(sections, ["context"])
  }
  if (/\bmust\b|\binclude\b|\bcover\b|\brequired\b|\bparts\b|\bfeatures\b|\bsections\b|\bingredients?\b|\btactics\b|\bmetrics?\b/.test(text)) {
    return bestAvailableSection(sections, ["requirements", "output_format"])
  }
  if (/\bconstraint\b|\blimit\b|\brespect\b|\bnon-negotiable\b|\btime\b|\bbudget\b|\btool\b|\bmethod\b|\bavoid\b|\bunder\b|\btarget\b/.test(text)) {
    return bestAvailableSection(sections, ["constraints"])
  }
  if (/\boutput\b|\breturned\b|\bstructured\b|\bformat\b|\btable\b|\bchecklist\b|\bmatrix\b|\bcode artifact\b/.test(text)) {
    return bestAvailableSection(sections, ["output_format"])
  }
  if (/\bcomplete enough\b|\bquality bar\b|\busable\b|\bready\b|\bdefinition\b/.test(text)) {
    return bestAvailableSection(sections, ["definition_of_complete"])
  }

  if (deliverableType === "recipe" || /\brecipe\b|\bmeal\b|\bsalad\b|\bbreakfast\b|\blunch\b|\bdinner\b/.test(normalizedPrompt)) {
    return bestAvailableSection(sections, ["goal", "constraints", "requirements", "output_format"])
  }

  return bestAvailableSection(sections, ["goal", "requirements", "constraints", "output_format"])
}

function mapQuestionToSection(input: MapLegacyQuestionToPromptModeV2Input) {
  const text = normalize(`${input.question.label} ${input.question.helper} ${input.question.options.join(" ")}`)
  switch (input.templateKind) {
    case "problem_solving":
      return mapProblemSolvingSection(text, input.sections)
    case "modification":
      return mapModificationSection(text, input.sections)
    default:
      return mapCreationSection(text, input.sections, input.goalContract, input.promptText)
  }
}

function visibleOptions(question: ClarificationQuestion) {
  const withoutOther = question.options.map((option) => option.trim()).filter(Boolean).filter((option) => option !== "Other")
  return withoutOther.length >= 2 ? withoutOther : question.options.map((option) => option.trim()).filter(Boolean)
}

export function mapLegacyQuestionToPromptModeV2(input: MapLegacyQuestionToPromptModeV2Input): ReviewPromptModeV2Question {
  const sectionId = mapQuestionToSection(input)
  return {
    id: input.question.id,
    sectionId,
    sectionLabel: sectionLabel(input.sections, sectionId),
    label: input.question.label,
    helper: input.question.helper,
    mode: input.question.mode,
    options: visibleOptions(input.question),
    depth: undefined
  }
}
