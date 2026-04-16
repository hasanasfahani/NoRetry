import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "esbuild"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(scriptDir, "..")

async function bundleModules(outdir) {
  await build({
    entryPoints: [
      path.resolve(extensionRoot, "lib/review/services/review-task-type.ts"),
      path.resolve(extensionRoot, "lib/review/services/review-analysis.ts"),
      path.resolve(extensionRoot, "lib/review/mappers/review-view-model.ts")
    ],
    outdir,
    bundle: true,
    format: "esm",
    platform: "node"
  })
}

function makeAttempt(prompt, taskType = "other") {
  return {
    attempt_id: `attempt-${Math.random().toString(36).slice(2, 8)}`,
    platform: "replit",
    raw_prompt: prompt,
    optimized_prompt: prompt,
    intent: {
      task_type: taskType,
      goal: prompt,
      constraints: [],
      acceptance_criteria: []
    },
    status: "submitted",
    created_at: new Date().toISOString(),
    submitted_at: new Date().toISOString(),
    response_text: null,
    response_message_id: null,
    analysis_result: null,
    token_usage_total: 0,
    stage_cache: {}
  }
}

function preprocessResponse(responseText) {
  const paragraphs = responseText.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean)
  const mentionedFiles = Array.from(new Set(responseText.match(/\b[\w./-]+\.(?:html|css|js|ts|tsx)\b/gi) ?? []))
  return {
    response_text: responseText,
    response_length: responseText.length,
    first_excerpt: responseText.slice(0, 120),
    last_excerpt: responseText.slice(-120),
    key_paragraphs: paragraphs.slice(0, 2),
    has_code_blocks: responseText.includes("```"),
    mentioned_files: mentionedFiles,
    change_claims: [],
    validation_signals: [],
    certainty_signals: [],
    uncertainty_signals: [],
    success_signals: [],
    failure_signals: []
  }
}

function makeProofResult() {
  return {
    status: "PARTIAL",
    confidence: "medium",
    confidence_reason: "Proof is still incomplete.",
    inspection_depth: "targeted_text",
    findings: ["A concrete fix was proposed."],
    issues: ["Runtime verification is still missing."],
    next_prompt: "Verify the missing proof.",
    prompt_strategy: "fix_missing",
    stage_1: {
      assistant_action_summary: "Proposed a fix.",
      claimed_evidence: ["Updated the relevant logic."],
      response_mode: "implemented",
      scope_assessment: "narrow"
    },
    stage_2: {
      addressed_criteria: ["The answer names the concrete fix"],
      missing_criteria: ["The answer shows evidence the result works"],
      constraint_risks: [],
      problem_fit: "partial",
      analysis_notes: ["Proof is still incomplete."]
    },
    verdict: {
      status: "PARTIAL",
      confidence: "medium",
      confidence_reason: "Proof is still incomplete.",
      findings: ["A concrete fix was proposed."],
      issues: ["The result is not proven."]
    },
    next_prompt_output: {
      next_prompt: "Verify the missing proof.",
      prompt_strategy: "fix_missing"
    },
    acceptance_checklist: [
      { label: "The answer names the concrete fix", status: "met" },
      { label: "The answer shows evidence the result works", status: "not_sure" }
    ],
    response_summary: preprocessResponse("Updated the logic."),
    used_fallback_intent: false,
    token_usage_total: 0
  }
}

function makeBrokenPromptChecklistResult(promptLabel) {
  return {
    ...makeProofResult(),
    confidence_reason: "Only 0 of 1 checklist items are confirmed.",
    findings: ["The generated prompt still needs stronger proof."],
    issues: ["The output is not proven yet."],
    next_prompt: "Show the exact change and prove it works.",
    prompt_strategy: "fix_missing",
    acceptance_checklist: [{ label: promptLabel, status: "not_sure" }]
  }
}

function assertPromptQualityChecklistOnly(result) {
  assert.deepEqual(
    result.acceptance_checklist.map((item) => item.label),
    [
      "The generated prompt preserves the user’s core goal",
      "The generated prompt preserves important constraints",
      "The generated prompt is structured and clear",
      "The generated prompt is usable as a send-ready prompt"
    ]
  )

  const combinedText = [
    ...result.acceptance_checklist.map((item) => item.label),
    ...result.findings,
    ...result.issues,
    result.next_prompt,
    result.stage_1.assistant_action_summary,
    ...result.stage_1.claimed_evidence,
    ...result.stage_2.analysis_notes,
    ...result.stage_2.missing_criteria
  ]
    .join("\n")
    .toLowerCase()

  assert.doesNotMatch(combinedText, /concrete change or fix|exact change|proof the result works|shows evidence the result works/)
}

function checklistStatusFor(result, label) {
  return result.acceptance_checklist.find((item) => item.label === label)?.status
}

async function runPromptArtifactReview({ runner, attempt, taskType, responseText, responseIdentity }) {
  return runner({
    target: {
      attempt,
      taskType,
      responseText,
      responseIdentity,
      threadIdentity: `${responseIdentity}-thread`,
      normalizedResponseText: responseText.toLowerCase()
    },
    mode: "deep",
    quickBaseline: null
  })
}

async function main() {
  const outdir = await mkdtemp(path.join(os.tmpdir(), "review-routing-smoke-"))
  try {
    await bundleModules(outdir)

    const taskTypeMod = await import(pathToFileURL(path.join(outdir, "services/review-task-type.js")).href)
    const analysisMod = await import(pathToFileURL(path.join(outdir, "services/review-analysis.js")).href)
    const viewModelMod = await import(pathToFileURL(path.join(outdir, "mappers/review-view-model.js")).href)

    const { classifyReviewTaskType } = taskTypeMod
    const { createReviewAnalysisRunner } = analysisMod
    const { mapAfterAnalysisToReviewViewModel } = viewModelMod

    let analyzeCalls = 0
    const runner = createReviewAnalysisRunner({
      analyzeAfterAttempt: async () => {
        analyzeCalls += 1
        return makeProofResult()
      },
      attachAnalysisResult: async () => null,
      preprocessResponse,
      getProjectMemoryContext: () => ({ projectContext: "", currentState: "" }),
      collectChangedFilesSummary: () => [],
      collectVisibleErrorSummary: () => ""
    })

    const creationAttempt = makeAttempt("website code for a basic CV. css and html", "build")
    const creationTaskType = classifyReviewTaskType(creationAttempt)
    assert.equal(creationTaskType, "creation")
    analyzeCalls = 0
    const creationResult = await runner({
      target: {
        attempt: creationAttempt,
        taskType: creationTaskType,
        responseText: "```html\n<!doctype html>\n<html>\n  <head>\n    <title>Basic CV</title>\n    <style>\n      body { font-family: Arial, sans-serif; margin: 0; }\n      .cv { max-width: 720px; margin: 0 auto; padding: 32px; }\n    </style>\n  </head>\n  <body>\n    <main class=\"cv\">\n      <section>\n        <h1>Jane Doe</h1>\n        <p>Frontend Developer</p>\n      </section>\n      <section>\n        <h2>Experience</h2>\n        <p>Example role summary</p>\n      </section>\n      <section>\n        <h2>Education</h2>\n        <p>Example education summary</p>\n      </section>\n      <section>\n        <h2>Skills</h2>\n        <p>HTML, CSS, JavaScript</p>\n      </section>\n      <section>\n        <h2>Contact</h2>\n        <p>jane@example.com</p>\n      </section>\n    </main>\n  </body>\n</html>\n```",
        responseIdentity: "resp-1",
        threadIdentity: "thread-1",
        normalizedResponseText: "section cv max width"
      },
      mode: "deep",
      quickBaseline: null
    })
    assert.equal(analyzeCalls, 0)
    assert.deepEqual(
      creationResult.acceptance_checklist.map((item) => item.label),
      [
        "The answer provides the requested deliverable",
        "The output matches the requested format and scope",
        "The deliverable is complete enough to use as a starting point"
      ]
    )
    assert.deepEqual(
      creationResult.acceptance_checklist.map((item) => item.status),
      ["met", "met", "met"]
    )
    const creationViewModel = mapAfterAnalysisToReviewViewModel({
      result: creationResult,
      mode: "deep",
      taskType: creationTaskType,
      quickBaseline: null,
      onCopyPrompt: () => {}
    })
    assert.equal(creationViewModel.confidenceLabel, "Confidence: Usable")

    const syrianLunchPrompt = `Task / goal:
Suggest a healthy Syrian lunch for 1 person that can be prepared in under 30 minutes, focusing on staying fit. Include ingredients, step-by-step instructions, and nutritional highlights.

Key requirements:
- What is your main dietary goal?: stay fit.
- What type of meal is this?: Lunch.
- What cuisine style do you prefer?: syrian.
- Any allergies or dietary restrictions?: non.
- How many people is this meal for?: 1 person.

Constraints:
- stay fit.
- Lunch.
- Under 30 minutes.
- syrian.
- non.
- 1 person.
- Any cooking limits?: Under 30 minutes.

Required inputs or ingredients:
- Assume a normal home kitchen unless the prompt says otherwise.

Quality bar / style guardrails:
- Keep it practical for real weekday use.`
    const syrianLunchAttempt = makeAttempt(syrianLunchPrompt, "other")
    const syrianLunchTaskType = classifyReviewTaskType(syrianLunchAttempt)
    assert.equal(syrianLunchTaskType, "creation")
    analyzeCalls = 0
    const syrianLunchResult = await runner({
      target: {
        attempt: syrianLunchAttempt,
        taskType: syrianLunchTaskType,
        responseText: `Bright Protein Lettuce Cup Lunch Bowl

Servings: 2-3
Time: 25 minutes
Calories: 390 per serving

Ingredients:
- 2 cans chickpeas, drained and rinsed
- 2 tbsp tamari
- 1 tbsp rice vinegar
- 1 tbsp lime juice
- 1 tsp toasted sesame oil
- 1 tsp grated ginger
- 2 cloves garlic, minced
- 1 tbsp chili crisp or sambal
- 1 small cucumber, diced
- 1 cup shredded red cabbage
- 3 scallions, sliced
- 1 cup shelled edamame
- 1 large romaine heart or butter lettuce leaves
- 1 tbsp sesame seeds

Instructions:
1. Pat the chickpeas dry, then sauté them in a skillet for 6-8 minutes until lightly golden.
2. Stir in the tamari, rice vinegar, lime juice, sesame oil, ginger, garlic, and chili crisp, then cook for 2 more minutes so the chickpeas turn glossy and tangy.
3. Fold in the cucumber, cabbage, scallions, and edamame just long enough to warm through while keeping the lunch fresh and crisp.
4. Spoon the chickpea mixture into lettuce cups or bowls, then finish with sesame seeds and extra lime.

Nutritional information (per serving):
- Calories: 390
- Protein: 23 g
- Carbohydrates: 30 g
- Net carbs: 18 g
- Fat: 16 g
- Fiber: 12 g

Why it fits:
- Vegetarian lunch built around chickpeas for plant protein
- Tangy Asian-inspired flavor from tamari, rice vinegar, lime, ginger, and chili
- Lower-carb structure by using lettuce cups and crunchy vegetables instead of rice or noodles`,
        responseIdentity: "resp-syrian-lunch-1",
        threadIdentity: "thread-syrian-lunch-1",
        normalizedResponseText: "bright protein lettuce cup lunch bowl servings 2-3 time 25 minutes asian-inspired"
      },
      mode: "deep",
      quickBaseline: null
    })
    assert.equal(analyzeCalls, 0)
    assert.equal(checklistStatusFor(syrianLunchResult, "The output matches the requested format and scope"), "missed")
    const syrianCombinedText = [...syrianLunchResult.issues, ...syrianLunchResult.stage_2.missing_criteria].join("\n").toLowerCase()
    assert.match(syrianCombinedText, /syrian/)
    assert.match(syrianCombinedText, /1 person/)
    assert.doesNotMatch(syrianCombinedText, /under 30 minutes/)

    const microwaveLunchPrompt = `Task / goal:
Build a single vegan microwave lunch recipe that is high-protein, creamy, comfort-food style, under 300 cal, ready in ≤5 min, uses only a microwave, and contains no avocado. Base it on chickpeas and rice; confirm the exact rice quantity that keeps calories under 500. Must be 1 serving, leftovers allowed. Provide ingredients, microwave steps, macro breakdown, and final texture tips to guarantee creaminess.

Key requirements:
- Which meal?: Lunch.
- Any diet rules?: Vegan.
- Max cooking time?: 5 min.
- Nutrition priority?: High protein.
- Flavor vibe?: Comfort.
- Eat it cold later?: Yes.
- Preferred vegan protein?: Chickpeas.
- Texture preference?: Creamy.

Constraints:
- Lunch.
- Vegan.
- 1.
- 5 min.
- Avocado.
- High protein.
- Microwave only.
- Comfort.
- Yes.
- Chickpeas.
- rice and under 300 calories.
- Creamy.
- How many servings?: 1.
- Microwave or stove only?: Microwave only.
- Include a grain?: rice and under 500 calories.

Required inputs or ingredients:
- Assume a normal home kitchen unless the prompt says otherwise.

Output format:
- Skip any ingredients?: Avocado.
- Include a grain?: rice and under 300 calories.
- Return something directly usable as a strong first draft.`
    const microwaveLunchAttempt = makeAttempt(microwaveLunchPrompt, "other")
    const microwaveLunchTaskType = classifyReviewTaskType(microwaveLunchAttempt)
    assert.equal(microwaveLunchTaskType, "creation")
    analyzeCalls = 0
    const microwaveLunchResult = await runner({
      target: {
        attempt: microwaveLunchAttempt,
        taskType: microwaveLunchTaskType,
        responseText: `Bright Chickpea Lettuce Cup Lunch Bowl

Servings: 2-3
Time: 25 minutes
Calories: 390 per serving

Ingredients:
- 2 cans chickpeas, drained and rinsed
- 2 tbsp tamari
- 1 tbsp rice vinegar
- 1 tbsp lime juice
- 1 tsp toasted sesame oil
- 1 tsp grated ginger
- 2 cloves garlic, minced
- 1 tbsp chili crisp or sambal
- 1 small cucumber, diced
- 1 cup shredded red cabbage
- 3 scallions, sliced
- 1 cup shelled edamame
- 1 large romaine heart or butter lettuce leaves
- 1 tbsp sesame seeds

Instructions:
1. Pat the chickpeas dry, then sauté them in a skillet for 6-8 minutes until lightly golden.
2. Stir in the tamari, rice vinegar, lime juice, sesame oil, ginger, garlic, and chili crisp, then cook for 2 more minutes so the chickpeas turn glossy and tangy.
3. Fold in the cucumber, cabbage, scallions, and edamame just long enough to warm through while keeping the lunch fresh and crisp.
4. Spoon the chickpea mixture into lettuce cups or bowls, then finish with sesame seeds and extra lime.

Nutritional information (per serving):
- Calories: 390
- Protein: 23 g
- Carbohydrates: 30 g
- Net carbs: 18 g
- Fat: 16 g
- Fiber: 12 g`,
        responseIdentity: "resp-microwave-lunch-1",
        threadIdentity: "thread-microwave-lunch-1",
        normalizedResponseText: "lettuce cup bowl servings 2-3 time 25 minutes skillet calories 390"
      },
      mode: "deep",
      quickBaseline: null
    })
    assert.equal(analyzeCalls, 0)
    const microwaveCombinedText = [...microwaveLunchResult.issues, ...microwaveLunchResult.stage_2.missing_criteria].join("\n").toLowerCase()
    assert.match(microwaveCombinedText, /microwave/)
    assert.match(microwaveCombinedText, /25 minutes|5 minutes/)
    assert.match(microwaveCombinedText, /serves 2-3|requested 1 person/)
    assert.match(microwaveCombinedText, /390 calories|300 calories/)
    assert.match(microwaveCombinedText, /rice/)
    assert.match(microwaveCombinedText, /texture tips|creamy/)
    assert.doesNotMatch(microwaveCombinedText, /strong first draft/)

    const structuredCvPrompt = `Task / goal:
Generate a complete, ready-to-save HTML file for a two-column résumé/CV that uses only inline CSS. The left sidebar must contain a bulleted skills list; the right column holds standard sections (summary, experience, education). Return the full file, no explanations.

Key requirements:
- Which CV layout do you need?: Two-column with sidebar.
- What goes in the sidebar column?: Skills list.
- Use HTML.
- Keep the output focused on a basic CV website starter.

Constraints:
- How much CSS styling do you want?: Inline CSS only.

Output format:
- How much CSS styling do you want?: Inline CSS only.
- How should the final code be delivered?: Full HTML file.

Quality bar / style guardrails:
- Keep the result simple and easy to use.
- Keep the request clear, specific, and easy for the AI assistant to follow.`
    const structuredCvAttempt = makeAttempt(structuredCvPrompt, "other")
    const structuredCvTaskType = classifyReviewTaskType(structuredCvAttempt)
    assert.equal(structuredCvTaskType, "creation")
    analyzeCalls = 0
    const structuredCvResult = await runner({
      target: {
        attempt: structuredCvAttempt,
        taskType: structuredCvTaskType,
        responseText: "```html\n<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\" />\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n  <title>Resume / CV</title>\n</head>\n<body style=\"margin:0; font-family: Arial, sans-serif; background-color:#f4f4f4; color:#222;\">\n  <div style=\"max-width:1000px; margin:30px auto; background-color:#ffffff; border:1px solid #ddd; overflow:hidden;\">\n    <div style=\"display:flex; flex-wrap:wrap;\">\n      <div style=\"width:28%; min-width:240px; background-color:#ecf0f1; padding:25px; box-sizing:border-box;\">\n        <h2 style=\"margin-top:0; font-size:20px;\">Skills</h2>\n        <ul style=\"padding-left:20px; margin:15px 0; line-height:1.8;\">\n          <li>Project Management</li>\n          <li>Communication</li>\n        </ul>\n      </div>\n      <div style=\"width:72%; min-width:300px; padding:25px; box-sizing:border-box;\">\n        <h2 style=\"margin-top:0; font-size:22px;\">Summary</h2>\n        <p style=\"font-size:15px; line-height:1.7;\">Motivated professional.</p>\n        <h2 style=\"margin-top:30px; font-size:22px;\">Experience</h2>\n        <p style=\"font-size:15px; line-height:1.7;\">Example role summary.</p>\n        <h2 style=\"margin-top:30px; font-size:22px;\">Education</h2>\n        <p style=\"font-size:15px; line-height:1.7;\">Example education summary.</p>\n      </div>\n    </div>\n  </div>\n</body>\n</html>\n```",
        responseIdentity: "resp-structured-cv-1",
        threadIdentity: "thread-structured-cv-1",
        normalizedResponseText: "html resume cv inline css two column"
      },
      mode: "deep",
      quickBaseline: null
    })
    assert.equal(analyzeCalls, 0)
    assert.deepEqual(
      structuredCvResult.acceptance_checklist.map((item) => item.label),
      [
        "The answer provides the requested deliverable",
        "The output matches the requested format and scope",
        "The deliverable is complete enough to use as a starting point"
      ]
    )

    const forcedStructuredCvOverride = await runner({
      target: {
        attempt: structuredCvAttempt,
        taskType: "writing",
        responseText: "```html\n<!DOCTYPE html><html><body style=\"margin:0;\"><div style=\"display:flex;\"><aside style=\"width:28%;\"><ul><li>HTML</li></ul></aside><main style=\"width:72%;\"><section><h2>Summary</h2></section><section><h2>Experience</h2></section><section><h2>Education</h2></section></main></div></body></html>\n```",
        responseIdentity: "resp-structured-cv-override-1",
        threadIdentity: "thread-structured-cv-override-1",
        normalizedResponseText: "html resume cv inline css"
      },
      mode: "deep",
      quickBaseline: null
    })
    assert.deepEqual(
      forcedStructuredCvOverride.acceptance_checklist.map((item) => item.label),
      [
        "The answer provides the requested deliverable",
        "The output matches the requested format and scope",
        "The deliverable is complete enough to use as a starting point"
      ]
    )

    const debugAttempt = makeAttempt("find and fix why the button is not visible", "debug")
    const debugTaskType = classifyReviewTaskType(debugAttempt)
    assert.equal(debugTaskType, "debug")
    analyzeCalls = 0
    await runner({
      target: {
        attempt: debugAttempt,
        taskType: debugTaskType,
        responseText: "I updated the selector and the button mounting logic in app.tsx, but runtime verification is still missing.",
        responseIdentity: "resp-2",
        threadIdentity: "thread-2",
        normalizedResponseText: "updated selector button mounting logic"
      },
      mode: "deep",
      quickBaseline: null
    })
    assert.equal(analyzeCalls, 1)

    const writingAttempt = makeAttempt("rewrite this message to sound more professional", "other")
    const writingTaskType = classifyReviewTaskType(writingAttempt)
    assert.equal(writingTaskType, "writing")
    analyzeCalls = 0
    const writingResult = await runner({
      target: {
        attempt: writingAttempt,
        taskType: writingTaskType,
        responseText: "I appreciate your time and would be glad to discuss this further at your convenience.",
        responseIdentity: "resp-3",
        threadIdentity: "thread-3",
        normalizedResponseText: "i appreciate your time"
      },
      mode: "deep",
      quickBaseline: null
    })
    assert.equal(analyzeCalls, 0)
    assert.deepEqual(
      writingResult.acceptance_checklist.map((item) => item.label),
      [
        "The answer provides the requested rewrite",
        "The rewrite matches the requested tone and clarity",
        "The rewritten text is polished enough to use"
      ]
    )

    const verificationAttempt = makeAttempt("verify whether this solution is actually working", "other")
    const verificationTaskType = classifyReviewTaskType(verificationAttempt)
    assert.equal(verificationTaskType, "verification")
    analyzeCalls = 0
    await runner({
      target: {
        attempt: verificationAttempt,
        taskType: verificationTaskType,
        responseText: "The solution updates the timeout logic, but there is still no runtime proof.",
        responseIdentity: "resp-4",
        threadIdentity: "thread-4",
        normalizedResponseText: "updates timeout logic"
      },
      mode: "deep",
      quickBaseline: null
    })
    assert.equal(analyzeCalls, 1)

    const structuredAdvicePrompt = `Task / goal:
Suggest a vegan, no-blender herbal drink mix I can stir into warm water for daily hydration. It must be very sweet without artificial sweeteners, contain ≤30 mg caffeine, and be ready to use straight from the packet. List one exact product I can buy online today.

Key requirements:
- What’s the main reason you want this drink?: Daily hydration.
- How do you want to prepare or consume it?: No-blend ready mix.
- Preferred flavor profile?: Herbal.
- How cold should it be served?: Warm.
- Need any caffeine in the drink?: Low (≤30 mg).
- How sweet should it taste?: Very sweet.

Constraints:
- Any dietary limits to respect?: Vegan.
- Any ingredients to avoid?: Artificial sweeteners.

Output format:
- Any ingredients to avoid?: Artificial sweeteners.

Quality bar / style guardrails:
- Keep the request clear, specific, and easy for the AI assistant to follow.`
    const structuredAdviceAttempt = makeAttempt(structuredAdvicePrompt, "other")
    const structuredAdviceTaskType = classifyReviewTaskType(structuredAdviceAttempt)
    assert.equal(structuredAdviceTaskType, "advice")
    analyzeCalls = 0
    const structuredAdviceResult = await runner({
      target: {
        attempt: structuredAdviceAttempt,
        taskType: structuredAdviceTaskType,
        responseText: `For your use case, the closest fit is a ready-to-stir herbal instant blend that stays vegan, caffeine-light, and free from artificial sweeteners.

Best match:
- Dandelion-based herbal instant drink mix

Why it fits:
- Stir into warm water directly from the packet
- Herbal-style flavor
- Vegan
- Naturally caffeine-free or near-zero caffeine
- No artificial sweeteners`,
        responseIdentity: "resp-advice-1",
        threadIdentity: "thread-advice-1",
        normalizedResponseText: "dandelion based herbal instant drink mix"
      },
      mode: "deep",
      quickBaseline: null
    })
    assert.equal(analyzeCalls, 0)
    assert.deepEqual(
      structuredAdviceResult.acceptance_checklist.map((item) => item.label),
      [
        "The answer directly gives relevant ideas for the request",
        "The ideas are clear and easy to use",
        "The answer offers enough practical variety to use"
      ]
    )
    const structuredAdviceViewModel = mapAfterAnalysisToReviewViewModel({
      result: structuredAdviceResult,
      mode: "deep",
      taskType: structuredAdviceTaskType,
      quickBaseline: null,
      onCopyPrompt: () => {}
    })
    const combinedAdviceText = [
      ...structuredAdviceResult.acceptance_checklist.map((item) => item.label),
      ...structuredAdviceResult.findings,
      ...structuredAdviceResult.issues,
      structuredAdviceResult.next_prompt,
      structuredAdviceViewModel.decision,
      structuredAdviceViewModel.recommendedAction,
      structuredAdviceViewModel.confidenceBody
    ]
      .join("\n")
      .toLowerCase()
    assert.doesNotMatch(combinedAdviceText, /concrete change or fix|exact change|proof the result works|shows evidence the result works|not proven/)

    analyzeCalls = 0
    const forcedAdviceOverrideResult = await runner({
      target: {
        attempt: structuredAdviceAttempt,
        taskType: "implementation",
        responseText: `For your use case, the closest fit is a ready-to-stir herbal instant blend that stays vegan, caffeine-light, and free from artificial sweeteners.

Best match:
- Dandelion-based herbal instant drink mix

Why it fits:
- Stir into warm water directly from the packet
- Herbal-style flavor
- Vegan
- Naturally caffeine-free or near-zero caffeine
- No artificial sweeteners`,
        responseIdentity: "resp-advice-override-1",
        threadIdentity: "thread-advice-override-1",
        normalizedResponseText: "dandelion based herbal instant drink mix"
      },
      mode: "deep",
      quickBaseline: null
    })
    assert.equal(analyzeCalls, 0)
    assert.deepEqual(
      forcedAdviceOverrideResult.acceptance_checklist.map((item) => item.label),
      [
        "The answer directly gives relevant ideas for the request",
        "The ideas are clear and easy to use",
        "The answer offers enough practical variety to use"
      ]
    )

    const promptArtifactRunner = createReviewAnalysisRunner({
      analyzeAfterAttempt: async ({ attempt }) => {
        analyzeCalls += 1
        return makeBrokenPromptChecklistResult(`Task / goal: ${attempt.raw_prompt}`)
      },
      attachAnalysisResult: async () => null,
      preprocessResponse,
      getProjectMemoryContext: () => ({ projectContext: "", currentState: "" }),
      collectChangedFilesSummary: () => [],
      collectVisibleErrorSummary: () => ""
    })

    const recipePromptAttempt = makeAttempt("Give me an oven-baked, nut-free preschool lunch for 3-4 kids.", "other")
    const recipePromptTaskType = classifyReviewTaskType(recipePromptAttempt)
    assert.equal(recipePromptTaskType, "creation")
    analyzeCalls = 0
    const recipePromptResult = await promptArtifactRunner({
      target: {
        attempt: recipePromptAttempt,
        taskType: recipePromptTaskType,
        responseText: [
          "Task / goal:",
          "Create an oven-baked, nut-free preschool lunch for 3-4 kids.",
          "",
          "Key requirements:",
          "- Keep it practical for young kids.",
          "",
          "Constraints:",
          "- Oven-baked only.",
          "- Nut-free.",
          "- Make enough for 3-4 kids.",
          "",
          "Output format:",
          "- Include ingredients with quantities.",
          "- Include simple steps.",
          "",
          "Quality bar / style guardrails:",
          "- Keep it realistic and easy to make."
        ].join("\n"),
        responseIdentity: "resp-5",
        threadIdentity: "thread-5",
        normalizedResponseText: "task goal oven baked nut free preschool lunch"
      },
      mode: "deep",
      quickBaseline: null
    })
    assert.equal(analyzeCalls, 0)
    assertPromptQualityChecklistOnly(recipePromptResult)
    const recipePromptViewModel = mapAfterAnalysisToReviewViewModel({
      result: recipePromptResult,
      mode: "deep",
      taskType: recipePromptTaskType,
      quickBaseline: null,
      onCopyPrompt: () => {}
    })
    assert.doesNotMatch(recipePromptViewModel.recommendedAction, /exact change|result works|real proof/i)
    assert.equal(recipePromptViewModel.confidenceLabel, "Confidence: Usable")
    assert.equal(checklistStatusFor(recipePromptResult, "The generated prompt preserves important constraints"), "met")
    assert.equal(checklistStatusFor(recipePromptResult, "The generated prompt is structured and clear"), "met")

    const codePromptAttempt = makeAttempt("Give me a prompt to build a basic CV website with HTML and CSS.", "other")
    const codePromptTaskType = classifyReviewTaskType(codePromptAttempt)
    assert.equal(codePromptTaskType, "creation")
    const codePromptResult = await promptArtifactRunner({
      target: {
        attempt: codePromptAttempt,
        taskType: codePromptTaskType,
        responseText: [
          "Task / goal:",
          "Create a basic CV website using HTML with embedded CSS.",
          "",
          "Key requirements:",
          "- Keep it directly usable as a starter.",
          "",
          "Constraints:",
          "- Use HTML.",
          "- Include CSS.",
          "",
          "Output format:",
          "- Return a send-ready prompt."
        ].join("\n"),
        responseIdentity: "resp-6",
        threadIdentity: "thread-6",
        normalizedResponseText: "task goal cv website html css"
      },
      mode: "deep",
      quickBaseline: null
    })
    assertPromptQualityChecklistOnly(codePromptResult)

    const rewritePromptAttempt = makeAttempt("Rewrite this message to sound more professional.", "other")
    const rewritePromptTaskType = classifyReviewTaskType(rewritePromptAttempt)
    assert.equal(rewritePromptTaskType, "writing")
    const rewritePromptResult = await promptArtifactRunner({
      target: {
        attempt: rewritePromptAttempt,
        taskType: rewritePromptTaskType,
        responseText: [
          "Task / goal:",
          "Rewrite the message in a more professional tone.",
          "",
          "Constraints:",
          "- Preserve the original meaning.",
          "- Keep the tone polished and concise.",
          "",
          "Output format:",
          "- Return the rewritten message only."
        ].join("\n"),
        responseIdentity: "resp-7",
        threadIdentity: "thread-7",
        normalizedResponseText: "task goal rewrite message professional tone"
      },
      mode: "deep",
      quickBaseline: null
    })
    assertPromptQualityChecklistOnly(rewritePromptResult)

    const rewriteOutputResult = await runner({
      target: {
        attempt: rewritePromptAttempt,
        taskType: writingTaskType,
        responseText: "Thank you for your time. I would appreciate the opportunity to discuss this further at your convenience.",
        responseIdentity: "resp-7b",
        threadIdentity: "thread-7b",
        normalizedResponseText: "thank you for your time"
      },
      mode: "deep",
      quickBaseline: null
    })
    assert.equal(checklistStatusFor(rewriteOutputResult, "The answer provides the requested rewrite"), "met")
    assert.equal(checklistStatusFor(rewriteOutputResult, "The rewrite matches the requested tone and clarity"), "met")
    assert.equal(checklistStatusFor(rewriteOutputResult, "The rewritten text is polished enough to use"), "met")

    const researchPromptAttempt = makeAttempt("Write me a research prompt about global battery recycling trends.", "other")
    const researchPromptTaskType = classifyReviewTaskType(researchPromptAttempt)
    assert.equal(researchPromptTaskType, "creation")
    const researchPromptResult = await promptArtifactRunner({
      target: {
        attempt: researchPromptAttempt,
        taskType: researchPromptTaskType,
        responseText: [
          "Task / goal:",
          "Research global battery recycling trends and surface the most decision-useful findings.",
          "",
          "Key requirements:",
          "- Cover the latest large-scale patterns.",
          "- Focus on commercial and policy implications.",
          "",
          "Constraints:",
          "- Keep the scope global.",
          "- Prioritize credible sources.",
          "",
          "Output format:",
          "- Summarize the most important findings, risks, and open questions."
        ].join("\n"),
        responseIdentity: "resp-8",
        threadIdentity: "thread-8",
        normalizedResponseText: "task goal research global battery recycling trends"
      },
      mode: "deep",
      quickBaseline: null
    })
    assertPromptQualityChecklistOnly(researchPromptResult)

    const semiStructuredPromptAttempt = makeAttempt("Suggest a better prompt for a dairy-free desk breakfast idea.", "other")
    const semiStructuredPromptTaskType = classifyReviewTaskType(semiStructuredPromptAttempt)
    assert.equal(semiStructuredPromptTaskType, "creation")
    const semiStructuredPromptResult = await promptArtifactRunner({
      target: {
        attempt: semiStructuredPromptAttempt,
        taskType: semiStructuredPromptTaskType,
        responseText: [
          "Suggest one dairy-free breakfast with healthy fats that I can prep in 5-10 minutes and eat at my desk.",
          "",
          "- Sweet or savory is fine.",
          "- Use only simple ingredients.",
          "- Keep it weekday-practical.",
          "",
          "Style notes:",
          "- Make the request specific and easy to follow."
        ].join("\n"),
        responseIdentity: "resp-9",
        threadIdentity: "thread-9",
        normalizedResponseText: "dairy free breakfast healthy fats 5 10 minutes desk"
      },
      mode: "deep",
      quickBaseline: null
    })
    assertPromptQualityChecklistOnly(semiStructuredPromptResult)

    const shortPromptAttempt = makeAttempt("Write a send-ready code-generation prompt for a minimal React pricing page.", "other")
    const shortPromptTaskType = classifyReviewTaskType(shortPromptAttempt)
    assert.equal(shortPromptTaskType, "creation")
    const shortPromptResult = await promptArtifactRunner({
      target: {
        attempt: shortPromptAttempt,
        taskType: shortPromptTaskType,
        responseText:
          "Create a minimal React pricing page with three tiers, clear CTA buttons, responsive layout, and clean modern styling. Return the code only.",
        responseIdentity: "resp-10",
        threadIdentity: "thread-10",
        normalizedResponseText: "create minimal react pricing page"
      },
      mode: "deep",
      quickBaseline: null
    })
    assertPromptQualityChecklistOnly(shortPromptResult)

    const oatsPromptAttempt = makeAttempt("Suggest a healthy breakfast without oats that I can prep quickly.", "other")
    const oatsPromptTaskType = classifyReviewTaskType(oatsPromptAttempt)
    assert.equal(oatsPromptTaskType, "advice")

    const oatsLiteralResult = await runPromptArtifactReview({
      runner: promptArtifactRunner,
      attempt: oatsPromptAttempt,
      taskType: oatsPromptTaskType,
      responseIdentity: "resp-oats-1",
      responseText: [
        "Task / goal:",
        "Suggest one healthy breakfast I can prep quickly without oats.",
        "",
        "Constraints:",
        "- Without oats.",
        "- Keep it quick to prepare.",
        "",
        "Output format:",
        "- Return one send-ready breakfast prompt."
      ].join("\n")
    })
    assertPromptQualityChecklistOnly(oatsLiteralResult)
    assert.equal(checklistStatusFor(oatsLiteralResult, "The generated prompt preserves important constraints"), "met")

    const oatsNoResult = await runPromptArtifactReview({
      runner: promptArtifactRunner,
      attempt: oatsPromptAttempt,
      taskType: oatsPromptTaskType,
      responseIdentity: "resp-oats-2",
      responseText: [
        "Task / goal:",
        "Suggest one healthy breakfast I can prep quickly.",
        "",
        "Constraints:",
        "- No oats.",
        "- Keep it quick to prepare.",
        "",
        "Output format:",
        "- Return one send-ready breakfast prompt."
      ].join("\n")
    })
    assertPromptQualityChecklistOnly(oatsNoResult)
    assert.equal(checklistStatusFor(oatsNoResult, "The generated prompt preserves important constraints"), "met")

    const oatsFreeResult = await runPromptArtifactReview({
      runner: promptArtifactRunner,
      attempt: oatsPromptAttempt,
      taskType: oatsPromptTaskType,
      responseIdentity: "resp-oats-3",
      responseText: [
        "Task / goal:",
        "Suggest one healthy breakfast I can prep quickly.",
        "",
        "Constraints:",
        "- Keep it oat-free.",
        "- Keep it quick to prepare.",
        "",
        "Output format:",
        "- Return one send-ready breakfast prompt."
      ].join("\n")
    })
    assertPromptQualityChecklistOnly(oatsFreeResult)
    assert.equal(checklistStatusFor(oatsFreeResult, "The generated prompt preserves important constraints"), "met")

    const oatsExcludeResult = await runPromptArtifactReview({
      runner: promptArtifactRunner,
      attempt: oatsPromptAttempt,
      taskType: oatsPromptTaskType,
      responseIdentity: "resp-oats-4",
      responseText: [
        "Task / goal:",
        "Suggest one healthy breakfast I can prep quickly.",
        "",
        "Constraints:",
        "- Exclude oats.",
        "- Keep it quick to prepare.",
        "",
        "Output format:",
        "- Return one send-ready breakfast prompt."
      ].join("\n")
    })
    assertPromptQualityChecklistOnly(oatsExcludeResult)
    assert.equal(checklistStatusFor(oatsExcludeResult, "The generated prompt preserves important constraints"), "met")

    const dairyPromptAttempt = makeAttempt("Suggest a dairy-free desk breakfast idea.", "other")
    const dairyPromptTaskType = classifyReviewTaskType(dairyPromptAttempt)
    const dairyPromptResult = await runPromptArtifactReview({
      runner: promptArtifactRunner,
      attempt: dairyPromptAttempt,
      taskType: dairyPromptTaskType,
      responseIdentity: "resp-dairy-1",
      responseText: [
        "Task / goal:",
        "Suggest one desk breakfast idea.",
        "",
        "Constraints:",
        "- No dairy.",
        "- Keep it desk-friendly.",
        "",
        "Output format:",
        "- Return one send-ready breakfast prompt."
      ].join("\n")
    })
    assertPromptQualityChecklistOnly(dairyPromptResult)
    assert.equal(checklistStatusFor(dairyPromptResult, "The generated prompt preserves important constraints"), "met")

    const droppedOatsResult = await runPromptArtifactReview({
      runner: promptArtifactRunner,
      attempt: oatsPromptAttempt,
      taskType: oatsPromptTaskType,
      responseIdentity: "resp-oats-5",
      responseText: [
        "Task / goal:",
        "Suggest one healthy breakfast I can prep quickly.",
        "",
        "Constraints:",
        "- Keep it quick to prepare.",
        "",
        "Output format:",
        "- Return one send-ready breakfast prompt."
      ].join("\n")
    })
    assertPromptQualityChecklistOnly(droppedOatsResult)
    assert.notEqual(checklistStatusFor(droppedOatsResult, "The generated prompt preserves important constraints"), "met")

    const berriesPromptAttempt = makeAttempt(
      "Suggest a breakfast idea. Any ingredients you dislike?: Berries. Keep it berry-free.",
      "other"
    )
    const berriesPromptTaskType = classifyReviewTaskType(berriesPromptAttempt)
    const berriesNoResult = await runPromptArtifactReview({
      runner: promptArtifactRunner,
      attempt: berriesPromptAttempt,
      taskType: berriesPromptTaskType,
      responseIdentity: "resp-berries-1",
      responseText: [
        "Task / goal:",
        "Suggest one healthy desk breakfast idea.",
        "",
        "Constraints:",
        "- No berries.",
        "- Keep it quick and practical.",
        "",
        "Output format:",
        "- Return one send-ready breakfast prompt."
      ].join("\n")
    })
    assertPromptQualityChecklistOnly(berriesNoResult)
    assert.equal(checklistStatusFor(berriesNoResult, "The generated prompt preserves important constraints"), "met")

    const berriesWithoutResult = await runPromptArtifactReview({
      runner: promptArtifactRunner,
      attempt: makeAttempt("Suggest a berry-free breakfast idea.", "other"),
      taskType: "creation",
      responseIdentity: "resp-berries-2",
      responseText: [
        "Task / goal:",
        "Suggest one healthy breakfast idea.",
        "",
        "Constraints:",
        "- Without berries.",
        "- Keep it simple.",
        "",
        "Output format:",
        "- Return one send-ready breakfast prompt."
      ].join("\n")
    })
    assertPromptQualityChecklistOnly(berriesWithoutResult)
    assert.equal(checklistStatusFor(berriesWithoutResult, "The generated prompt preserves important constraints"), "met")

    const eggPromptAttempt = makeAttempt("Suggest an egg-free breakfast I can eat at my desk.", "other")
    const eggPromptTaskType = classifyReviewTaskType(eggPromptAttempt)
    const eggPromptResult = await runPromptArtifactReview({
      runner: promptArtifactRunner,
      attempt: eggPromptAttempt,
      taskType: eggPromptTaskType,
      responseIdentity: "resp-eggs-1",
      responseText: [
        "Task / goal:",
        "Suggest one desk breakfast idea.",
        "",
        "Constraints:",
        "- No eggs.",
        "- Keep it desk-friendly.",
        "",
        "Output format:",
        "- Return one send-ready breakfast prompt."
      ].join("\n")
    })
    assertPromptQualityChecklistOnly(eggPromptResult)
    assert.equal(checklistStatusFor(eggPromptResult, "The generated prompt preserves important constraints"), "met")

    const violatedBerriesResult = await runPromptArtifactReview({
      runner: promptArtifactRunner,
      attempt: berriesPromptAttempt,
      taskType: berriesPromptTaskType,
      responseIdentity: "resp-berries-3",
      responseText: [
        "Task / goal:",
        "Suggest one healthy desk breakfast idea.",
        "",
        "Constraints:",
        "- No berries.",
        "",
        "Output format:",
        "- Ingredients: berries, yogurt, granola.",
        "- Return one send-ready breakfast prompt."
      ].join("\n")
    })
    assertPromptQualityChecklistOnly(violatedBerriesResult)
    assert.notEqual(checklistStatusFor(violatedBerriesResult, "The generated prompt preserves important constraints"), "met")

    const missingPartsCreationResult = await runner({
      target: {
        attempt: creationAttempt,
        taskType: creationTaskType,
        responseText: "```html\n<!doctype html><html><body><main><h1>Jane Doe</h1></main></body></html>\n```",
        responseIdentity: "resp-10b",
        threadIdentity: "thread-10b",
        normalizedResponseText: "basic html only"
      },
      mode: "deep",
      quickBaseline: null
    })
    assert.equal(checklistStatusFor(missingPartsCreationResult, "The answer provides the requested deliverable"), "met")
    assert.notEqual(checklistStatusFor(missingPartsCreationResult, "The output matches the requested format and scope"), "met")

    const forcedOverrideRunner = createReviewAnalysisRunner({
      analyzeAfterAttempt: async () => {
        analyzeCalls += 1
        return makeProofResult()
      },
      attachAnalysisResult: async () => null,
      preprocessResponse,
      getProjectMemoryContext: () => ({ projectContext: "", currentState: "" }),
      collectChangedFilesSummary: () => [],
      collectVisibleErrorSummary: () => ""
    })
    const forcedOverrideResult = await forcedOverrideRunner({
      target: {
        attempt: shortPromptAttempt,
        taskType: "implementation",
        responseText:
          "Create a minimal React pricing page with three tiers, clear CTA buttons, responsive layout, and clean modern styling. Return the code only.",
        responseIdentity: "resp-11",
        threadIdentity: "thread-11",
        normalizedResponseText: "create minimal react pricing page"
      },
      mode: "deep",
      quickBaseline: null
    })
    assertPromptQualityChecklistOnly(forcedOverrideResult)

    console.log("review-routing-smoke: ok")
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}

await main()
