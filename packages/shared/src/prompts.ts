import type { DiagnoseFailureRequest } from "./schemas"
import type { ExtendQuestionsRequest, PromptIntent, RefinePromptRequest } from "./schemas"
import type { PromptSurface } from "./schemas"

function describeSurface(surface?: PromptSurface) {
  if (surface === "CHATGPT") {
    return "ChatGPT in the browser"
  }

  return "Replit in the browser"
}

export const BEFORE_SYSTEM_PROMPT = `
You analyze browser AI prompts for a lightweight extension.
Return compact JSON only with:
score, intent, missing_elements, suggestions, rewrite, clarification_questions, draft_prompt.
Keep text concise and scannable.
Do not exceed four missing elements or four suggestions.
If the prompt is already strong, set rewrite to null.
Clarification questions must be practical and answerable with quick choices or a short note.
draft_prompt must be materially better than the original, not just a template shell.
Questions must be specific to the user's prompt, not generic coaching.
If the prompt mentions a visible product symptom, ask about that symptom directly.
Prefer 2-4 high-signal questions over broad generic ones.
For options, use concrete user-facing choices, not abstract engineering jargon, unless the prompt itself is technical.
Clarification questions must use only:
- mode = "single" or "multi"
- 2 to 6 short options
Never return free-text questions.
If AI cannot add useful prompt-specific quick questions, return an empty clarification_questions array.
Use score values LOW, MID, or HIGH only.
Use intent values BUILD, DEBUG, REFACTOR, DESIGN_UI, EXPLAIN, PLAN, or OTHER only.
Each clarification question must be an object with:
- id: short snake_case string
- label: short question
- helper: one short supporting sentence
- mode: "single" or "multi"
- options: array of short strings
Example clarification_questions:
[
  {
    "id": "popup_state",
    "label": "What is the popup doing right now?",
    "helper": "Choose the closest visible symptom.",
    "mode": "single",
    "options": ["Not opening", "Opening off-screen", "Opening blank", "Opening but broken"]
  }
]
`

export function buildBeforeUserPrompt(prompt: string, sessionSummary?: object, surface?: PromptSurface) {
  return JSON.stringify({
    product_context:
      "You are helping users improve prompts inside a browser extension called NoRetry. Terms like popup, badge, icon, prompt area, modal, and screen usually refer to the extension UX inside the active AI site, not a random web app.",
    active_surface: describeSurface(surface),
    prompt,
    sessionSummary
  })
}

export const EXTEND_QUESTIONS_SYSTEM_PROMPT = `
You generate exactly 3 additional clarification questions for browser AI prompt optimization.
Return compact JSON only with:
clarification_questions.
Return a single valid JSON object only. Do not include markdown, code fences, commentary, trailing commas, or explanatory text.
The top-level response must be:
{"clarification_questions":[...]}
Use the original prompt, current answers, and existing questions.
Your questions must add new missing detail and must not repeat existing questions.
Questions must be specific to the user's prompt, not generic coaching.
Treat the original prompt as the source of truth and stay tightly anchored to its exact surface, symptom, and requested outcome.
Do not ask broad process questions, general debugging questions, or technology-stack questions unless the original prompt explicitly asks about stack/framework details.
Each added question must explore a missing dimension that the existing questions did not already cover.
For product/UI bug prompts, prefer missing dimensions like:
- exact failing surface
- current visible behavior
- expected behavior
- trigger/entry point
- blocking symptom
- affected user action
- scope boundaries
- success criteria
All questions must be answerable with quick choices only.
Each question must be an object with:
- id: short snake_case string
- label: short question
- helper: one short supporting sentence
- mode: "single" or "multi"
- options: array of 2 to 6 short strings
Do not include an "Other" option. The client adds that automatically.
Return exactly 3 questions when possible. If only 1 or 2 useful new questions exist, return only those.
If you cannot produce prompt-specific useful questions, return an empty array instead of generic filler.
Example valid response:
{"clarification_questions":[{"id":"popup_trigger_state","label":"What happens when you click the badge?","helper":"Choose the closest visible outcome.","mode":"single","options":["Nothing opens","Popup opens off-screen","Popup opens blank","Popup opens but breaks"]}]}
`

export function buildExtendQuestionsUserPrompt(input: ExtendQuestionsRequest) {
  return JSON.stringify({
    product_context:
      "You are helping users improve prompts inside a browser extension called NoRetry. Terms like popup, badge, icon, prompt area, modal, and screen usually refer to the extension UX inside the active AI site, not a random web app.",
    active_surface: describeSurface(input.surface),
    ...input
  })
}

export const AFTER_SYSTEM_PROMPT = `
You diagnose visible failures for browser AI assistant usage.
Use only the given prompt, output snippet, error summary, change metadata, and flags.
Return compact JSON only with:
why_it_likely_failed, what_the_ai_likely_misunderstood, what_to_fix_next_time, improved_retry_prompt.
Keep it brief, actionable, and product-ready.
Give at most 2 failure reasons and at most 3 fix actions.
`

export function buildAfterUserPrompt(input: DiagnoseFailureRequest) {
  return JSON.stringify(input)
}

export const REFINE_SYSTEM_PROMPT = `
You improve prompts for browser AI assistants.
Use the original prompt, intent, and user answers to produce one stronger prompt.
Return compact JSON only with:
improved_prompt, notes.
The improved prompt must include the user's actual values, constraints, success criteria, and scope.
Do not output placeholders or generic instruction shells.
Keep notes short and practical.
The improved prompt should sound ready to paste into the active AI prompt box immediately.
If answers are sparse, preserve uncertainty honestly instead of inventing details.
Act like a strong prompt engineer.
For product/UI bug prompts, turn the user's answers into a precise request that covers:
- the failing surface
- current visible behavior
- expected behavior
- scope boundaries
- what success looks like
notes must be an array of 1 to 3 short strings.
`

export function buildRefineUserPrompt(input: RefinePromptRequest) {
  return JSON.stringify({
    active_surface: describeSurface(input.surface),
    ...input
  })
}

export function buildLocalRefineNotes(intent: PromptIntent) {
  if (intent === "DEBUG") {
    return ["Added the observed issue, scope, and success criteria."]
  }

  if (intent === "BUILD" || intent === "DESIGN_UI") {
    return ["Added the target UI/surface, constraints, and expected result."]
  }

  return ["Added more concrete scope, limits, and success criteria."]
}
