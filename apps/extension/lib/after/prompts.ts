import type {
  AfterStage1Request,
  AfterStage2Request,
  AfterStage3Request,
  AfterStage4Request,
  IntentExtractionOutput,
  ResponsePreprocessorOutput
} from "@prompt-optimizer/shared/src/schemas"

function compactSummary(summary: ResponsePreprocessorOutput) {
  return {
    response_length: summary.response_length,
    has_code_blocks: summary.has_code_blocks,
    mentioned_files: summary.mentioned_files,
    certainty_signals: summary.certainty_signals,
    uncertainty_signals: summary.uncertainty_signals,
    success_signals: summary.success_signals,
    failure_signals: summary.failure_signals,
    first_excerpt: summary.first_excerpt,
    last_excerpt: summary.last_excerpt,
    key_paragraphs: summary.key_paragraphs
  }
}

export function buildIntentExtractionPrompts(rawPrompt: string) {
  return {
    system:
      "Extract intent for an AI debugging loop. Return JSON only with keys: task_type, goal, constraints, acceptance_criteria. Keep it minimal and do not invent detailed constraints.",
    user: JSON.stringify({
      raw_prompt: rawPrompt
    })
  }
}

export function buildStage1Prompts(input: AfterStage1Request) {
  return {
    system:
      "Summarize what the assistant appears to have done. Return JSON only with keys: assistant_action_summary, claimed_evidence, response_mode, scope_assessment.",
    user: JSON.stringify({
      intent_goal: input.intent_goal,
      task_type: input.task_type,
      response_summary: compactSummary(input.response_summary)
    })
  }
}

export function buildStage2Prompts(input: AfterStage2Request) {
  return {
    system:
      "Compare the assistant response to the intended goal. Return JSON only with keys: addressed_criteria, missing_criteria, constraint_risks, problem_fit, analysis_notes.",
    user: JSON.stringify({
      intent: input.intent,
      stage_1: input.stage_1,
      response_excerpts: input.response_excerpts
    })
  }
}

export function buildStage3Prompts(input: AfterStage3Request) {
  return {
    system:
      "Generate a trustworthy verdict for the AI response. Prefer UNVERIFIED over success when evidence is weak. Return JSON only with keys: status, confidence, findings, issues.",
    user: JSON.stringify({
      intent: input.intent,
      stage_1: input.stage_1,
      stage_2: input.stage_2,
      response_summary: {
        response_length: input.response_summary.response_length,
        has_code_blocks: input.response_summary.has_code_blocks,
        mentioned_files: input.response_summary.mentioned_files,
        certainty_signals: input.response_summary.certainty_signals,
        uncertainty_signals: input.response_summary.uncertainty_signals,
        success_signals: input.response_summary.success_signals,
        failure_signals: input.response_summary.failure_signals
      }
    })
  }
}

export function buildStage4Prompts(input: AfterStage4Request) {
  return {
    system:
      "Write the next best prompt for the user. Keep scope tight and focus only on what is still unresolved, unproven, or contradictory. Return JSON only with keys: next_prompt and prompt_strategy. prompt_strategy must be one of: validate, fix_missing, narrow_scope, resolve_contradiction.",
    user: JSON.stringify({
      optimized_prompt: input.optimized_prompt,
      intent: input.intent,
      verdict: input.verdict,
      missing_criteria: input.missing_criteria,
      constraint_risks: input.constraint_risks
    })
  }
}
