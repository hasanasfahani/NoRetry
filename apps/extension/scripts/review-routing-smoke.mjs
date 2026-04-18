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
  const exact = result.acceptance_checklist.find((item) => item.label === label)
  if (exact) return exact.status

  const normalizedLabel = label.toLowerCase()
  const substringMatch = result.acceptance_checklist.find((item) => item.label.toLowerCase().includes(normalizedLabel))
  if (substringMatch) return substringMatch.status

  const labelTokens = normalizedLabel.split(/\W+/).filter((token) => token.length > 2)
  return result.acceptance_checklist.find((item) => {
    const itemLabel = item.label.toLowerCase()
    return labelTokens.every((token) => itemLabel.includes(token))
  })?.status
}

function assertNoMonolithicGoalChecklist(result) {
  const labels = result.acceptance_checklist.map((item) => item.label)
  for (const label of labels) {
    assert.doesNotMatch(label, /^task\s*\/\s*goal:/i)
    assert.ok(label.length < 120, `Checklist label should stay decomposed: ${label}`)
  }
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
    const { createReviewAnalysisRunner, getReviewAnalysisContext } = analysisMod
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
    assert.equal(
      creationResult.acceptance_checklist.some((item) => item.label === "Requested deliverable type is present"),
      true
    )
    assert.equal(
      creationResult.acceptance_checklist.some((item) => item.label === "HTML requirement is present"),
      true
    )
    assert.equal(
      creationResult.acceptance_checklist.some((item) => item.label === "CSS requirement is present"),
      true
    )
    assert.equal(
      creationResult.acceptance_checklist.every((item) => item.status === "met"),
      true
    )
    assertNoMonolithicGoalChecklist(creationResult)
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
    assertNoMonolithicGoalChecklist(syrianLunchResult)
    assert.equal(checklistStatusFor(syrianLunchResult, "Serving count matches (1 person)"), "missed")
    assert.equal(checklistStatusFor(syrianLunchResult, "Time constraint matches (Under 30 minutes)"), "met")
    assert.equal(checklistStatusFor(syrianLunchResult, "Cuisine or style requirement is preserved (syrian)"), "missed")
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
    assertNoMonolithicGoalChecklist(microwaveLunchResult)
    assert.equal(checklistStatusFor(microwaveLunchResult, "Tool or method constraint matches (Microwave only)"), "missed")
    assert.equal(checklistStatusFor(microwaveLunchResult, "Serving count matches (1 serving)"), "missed")
    assert.equal(checklistStatusFor(microwaveLunchResult, "Time constraint matches (5 min)"), "missed")
    assert.equal(checklistStatusFor(microwaveLunchResult, "Calorie target matches (under 300 calories)"), "missed")
    assert.equal(checklistStatusFor(microwaveLunchResult, "Requested grain or base ingredient is present (rice)"), "missed")
    assert.equal(checklistStatusFor(microwaveLunchResult, "Exact rice quantity is confirmed"), "missed")
    const microwaveCombinedText = [...microwaveLunchResult.issues, ...microwaveLunchResult.stage_2.missing_criteria].join("\n").toLowerCase()
    assert.match(microwaveCombinedText, /microwave/)
    assert.match(microwaveCombinedText, /5 min/)
    assert.match(microwaveCombinedText, /1 serving/)
    assert.match(microwaveCombinedText, /300 calories/)
    assert.match(microwaveCombinedText, /rice/)
    assert.match(microwaveCombinedText, /exact rice quantity/)
    assert.doesNotMatch(microwaveCombinedText, /strong first draft/)

    const saladPrompt = `Task / goal:
Write a single-serving, dairy-free, high-protein lunch salad recipe that stays under 300 kcal. Use 3 cups chopped Romaine, 3 oz grilled chicken, 1 tbsp mixed toasted seeds, and a lemon-only vinaigrette (no oil, no heat). List ingredients with gram/oz amounts, provide 5-min stovetop prep steps, and finish with total calories per serving.

Key requirements:
- dairy-free.

Constraints:
- Lunch.
- 300 kcal.
- Keep it dairy-free.
- High-protein.
- Do not use heat.
- Do not use oil.
- under 300 kcal.

Output format:
- calories per serving.
- ingredients.
- step-by-step instructions.`
    const saladAttempt = makeAttempt(saladPrompt, "other")
    const saladTaskType = classifyReviewTaskType(saladAttempt)
    assert.equal(saladTaskType, "creation")
    analyzeCalls = 0
    const saladResult = await runner({
      target: {
        attempt: saladAttempt,
        taskType: saladTaskType,
        responseText: `Here’s a **single-serving, dairy-free, high-protein salad** that stays **under 300 kcal**, uses **no oil, no heat**, and is built to actually keep you full.

---

## 🥗 High-Protein Lemon Chicken Romaine Salad (≤300 kcal)

### 🛒 Ingredients (exact amounts)

* 3 cups chopped **Romaine lettuce** (≈135g)
* 3 oz (85g) grilled chicken breast, sliced
* 1 tbsp mixed toasted seeds (≈10g; sesame/sunflower/pumpkin mix)
* ½ cup cucumber, sliced (≈50g)
* ½ cup cherry tomatoes, halved (≈75g)

**Lemon-only vinaigrette (no oil):**

* 1½ tbsp fresh lemon juice (≈22 ml)
* 1 tbsp water (15 ml)
* Pinch salt
* Pinch black pepper
* ¼ tsp dried oregano (or mixed herbs)

---

## ⚡ Step-by-step (5 minutes, no heat)

1. **Prep base**
   Add chopped romaine to a large bowl.

2. **Add protein**
   Slice the grilled chicken and place on top.

3. **Add volume veggies**
   Toss in cucumber and cherry tomatoes.

4. **Mix dressing (30 sec)**
   In a small cup, combine lemon juice, water, salt, pepper, and herbs.

5. **Assemble**
   Pour dressing over the salad and toss well to coat everything.

6. **Finish with crunch**
   Sprinkle toasted seeds on top just before eating.

---

## 🔢 Calories per serving

* **Total calories:** ~285 kcal

*(High protein ~27–30g, low fat, high volume → strong satiety under 300 kcal)*`,
        responseIdentity: "resp-salad-1",
        threadIdentity: "thread-salad-1",
        normalizedResponseText: "single serving dairy free high protein ingredients step by step total calories 285 no oil no heat"
      },
      mode: "deep",
      quickBaseline: null
    })
    assert.equal(analyzeCalls, 0)
    assertNoMonolithicGoalChecklist(saladResult)
    assert.equal(checklistStatusFor(saladResult, "Requested deliverable type is present"), "met")
    assert.equal(checklistStatusFor(saladResult, "Ingredients section is present"), "met")
    assert.equal(checklistStatusFor(saladResult, "Calorie target matches (under 300 kcal)"), "met")
    assert.equal(checklistStatusFor(saladResult, "Step-by-step instructions are present"), "met")
    const saladCombinedText = [...saladResult.issues, ...saladResult.stage_2.missing_criteria].join("\n").toLowerCase()
    const saladRetryText = [saladResult.next_prompt, saladResult.next_prompt_output?.next_prompt ?? ""].join("\n").toLowerCase()
    assert.doesNotMatch(saladCombinedText, /\blunch\b/)
    assert.doesNotMatch(saladCombinedText, /requested deliverable type is present/)
    assert.doesNotMatch(saladCombinedText, /ingredients section is present/)
    assert.doesNotMatch(saladCombinedText, /calorie target matches \(300 kcal\)/)
    assert.doesNotMatch(saladRetryText, /missing sections/)
    assert.doesNotMatch(saladRetryText, /requested deliverable type is present/)
    assert.doesNotMatch(saladRetryText, /ingredients section is present/)
    const saladContext = getReviewAnalysisContext(saladResult)
    assert.ok((saladContext?.reviewContract?.promptText ?? "").length > 0)
    assert.doesNotMatch(saladContext?.reviewContract?.promptText ?? "", /What is working|Gaps|Next move/)
    assert.doesNotMatch(saladContext?.reviewContract?.copyPromptText ?? "", /missing sections/i)

    const gymPrompt = `Task / goal:
Build a 3-day-per-week, 30-minute gym program for an intermediate lifter (6-24 months experience) using only free weights. Program must: avoid knee-heavy moves, include 2 short cardio bursts per week, emphasize glute development, progress by adding reps before load, and schedule deloads only if progress stalls. Deliver one concise table: Day (Mon/Wed/Fri), exercise list with sets × reps, and total time per session ≤ 30 min.

Constraints:
- 30 min.
- Do not use knee-heavy moves.

Output format:
- table output.`
    const gymAttempt = makeAttempt(gymPrompt, "other")
    const gymTaskType = classifyReviewTaskType(gymAttempt)
    assert.equal(gymTaskType, "creation")
    const gymResult = await runner({
      target: {
        attempt: gymAttempt,
        taskType: gymTaskType,
        responseText: `Here’s a **3-day (Mon/Wed/Fri), ≤30-min, free-weights-only program** built for an intermediate lifter, **glute-focused**, **knee-friendly**, with **rep-first progression** and **2 short cardio bursts/week**.

| Day     | Exercise (order = superset pairs A/B) — sets × reps | Time |
| ------- | ---------------------------------------------------- | ---- |
| **Mon** | **A1. Dumbbell Romanian Deadlift** — 3×8–12 • **A2. Side-Lying Dumbbell Hip Abduction** — 3×12–15/side <br> **B1. Dumbbell Hip Thrust (bench-supported)** — 3×10–15 • **B2. Single-Leg Calf Raise (DB)** — 3×10–15/side <br> **Cardio burst:** DB Farmer’s Carry — 3×30–40s | ≤30 min |
| **Wed** | **A1. DB Romanian Deadlift (slow tempo 3–1–1)** — 3×8–10 • **A2. DB Rear Delt Raise** — 3×12–15 <br> **B1. Single-Leg DB Hip Thrust** — 3×8–12/side • **B2. DB Floor Press** — 3×8–12 | ≤30 min |
| **Fri** | **A1. DB Romanian Deadlift** — 3×10–12 • **A2. Standing DB Hip Hinge Pull-Through (hip hinge + row)** — 3×10–12 <br> **B1. DB Glute Bridge (pause 2s top)** — 3×12–15 • **B2. DB Overhead Press** — 3×8–10 <br> **Cardio burst:** DB Swing (hip hinge) — 3×20–30s | ≤30 min |

### Progression (rep-first, then load)
* Each session, **add reps** until you hit the **top of the range on all sets**.
* Then increase weight slightly and restart at the low end.

### Deload rule (only if needed)
* If you **fail to add reps or load for 2 consecutive weeks**, deload next week.`,
        responseIdentity: "resp-gym-1",
        threadIdentity: "thread-gym-1",
        normalizedResponseText: "mon wed fri table glute dumbbell rep-first progression cardio burst deload knee-friendly"
      },
      mode: "deep",
      quickBaseline: null
    })
    const gymContext = getReviewAnalysisContext(gymResult)
    assert.ok((gymContext?.reviewContract?.promptText ?? "").length > 0)
    assert.doesNotMatch(gymContext?.reviewContract?.promptText ?? "", /What is working|Gaps|Next move/)
    assert.doesNotMatch(gymContext?.reviewContract?.copyPromptText ?? "", /\bfinish\b.*\bfriday\b/i)
    assert.doesNotMatch(gymContext?.reviewContract?.copyPromptText ?? "", /\breturn\b.*\btable\b/i)
    assert.doesNotMatch(gymContext?.reviewContract?.copyPromptText ?? "", /\bcut off|truncated|extra text\b/i)

    const dailyBudgetLunchPrompt = `Task / goal:
Give me a single-serving, dairy-free microwave lunch recipe that is ready in ≤5 min, keeps net carbs low, has 0 spice, and fits inside a 1500–1800 kcal day. List exact ingredients, microwave steps, and final macros + calories per serving.

Key requirements:
- dairy-free.

Constraints:
- Do not use spice.
- Keep it dairy-free.
- single-serving.
- 5 min.
- 1500–1800 kcal.

Output format:
- macros per serving.
- calories per serving.
- ingredients.
- step-by-step instructions.`
    const dailyBudgetLunchAttempt = makeAttempt(dailyBudgetLunchPrompt, "other")
    const dailyBudgetLunchTaskType = classifyReviewTaskType(dailyBudgetLunchAttempt)
    assert.equal(dailyBudgetLunchTaskType, "creation")
    const dailyBudgetLunchResult = await runner({
      target: {
        attempt: dailyBudgetLunchAttempt,
        taskType: dailyBudgetLunchTaskType,
        responseText: `Here’s a **fast, clean, no-spice, dairy-free, low-carb microwave lunch** that fits your constraints:

## 🥗 Microwave Chicken & Egg Protein Bowl (Single Serving)

### 🧾 Ingredients

* 120g cooked chicken breast (pre-cooked, chopped or shredded)
* 2 large eggs
* 1 cup fresh spinach (or frozen, drained)
* 1 tbsp olive oil
* ½ avocado (sliced)
* Pinch of salt

### ⚡ Step-by-Step Instructions (≤5 min)

1. **Add spinach + chicken** to a microwave-safe bowl.
2. Microwave for **1 minute** to warm them.
3. Crack the **2 eggs** directly into the bowl and gently mix.
4. Microwave for **60–90 seconds** until eggs are fully set.
5. Drizzle **olive oil** on top.
6. Add **avocado slices** and a pinch of salt.

### 🔢 Macros per Serving (Approx.)

* **Calories:** ~520 kcal
* **Protein:** ~45g
* **Fat:** ~34g
* **Net Carbs:** ~5g`,
        responseIdentity: "resp-daily-budget-lunch-1",
        threadIdentity: "thread-daily-budget-lunch-1",
        normalizedResponseText: "single serving dairy free no spice microwave 5 min calories 520 macros per serving"
      },
      mode: "deep",
      quickBaseline: null
    })
    const dailyBudgetLunchContext = getReviewAnalysisContext(dailyBudgetLunchResult)
    assert.ok((dailyBudgetLunchContext?.reviewContract?.copyPromptText ?? "").length > 0)
    assert.ok(dailyBudgetLunchContext?.reviewContract?.analysisDebug)
    assert.equal((dailyBudgetLunchContext?.reviewContract?.analysisDebug?.smart.judgments.length ?? 0) > 0, true)
    assert.doesNotMatch(dailyBudgetLunchContext?.reviewContract?.copyPromptText ?? "", /\b1500\b.*\b1800\b.*\bper serving\b/i)
    assert.doesNotMatch(dailyBudgetLunchContext?.reviewContract?.copyPromptText ?? "", /\badd\b.*\bstep-by-step instructions\b/i)
    assert.doesNotMatch(dailyBudgetLunchContext?.reviewContract?.copyPromptText ?? "", /\bmake the serving count match\b/i)
    assert.doesNotMatch(dailyBudgetLunchContext?.reviewContract?.copyPromptText ?? "", /\breturn the requested deliverable type more clearly\b/i)
    assert.doesNotMatch(dailyBudgetLunchContext?.reviewContract?.copyPromptText ?? "", /\bkeep these parts as they are\b/i)

    const postponementEmailPrompt = `Task / goal:
Write a formal postponement email to my internal team. Move today’s 1 h meeting to tomorrow early afternoon UTC. Give 3 exact start-time options (e.g., 13:00, 13:30, 14:00). Reason: awaiting a key attendee. Add “[URGENT]” to the subject. Include a brief apology, ask for confirmation by end of day UTC, and state that I will update the calendar invite. Keep it under 150 words, no small-talk.

Constraints:
- Do not use small-talk.

write it freely here without the email box`
    const postponementEmailAttempt = makeAttempt(postponementEmailPrompt, "other")
    const postponementEmailTaskType = classifyReviewTaskType(postponementEmailAttempt)
    assert.equal(postponementEmailTaskType, "writing")
    const postponementEmailResult = await runner({
      target: {
        attempt: postponementEmailAttempt,
        taskType: postponementEmailTaskType,
        responseText: `**Subject:** [URGENT] Meeting Postponement – Reschedule Required

Dear Team,

Today’s 1-hour meeting will be postponed to tomorrow early afternoon UTC due to awaiting a key attendee. Please confirm your availability for one of the following start times:

* 13:00 UTC
* 13:30 UTC
* 14:00 UTC

Kindly confirm your preferred option by end of day UTC. I will update the calendar invite accordingly.

Apologies for the inconvenience.`,
        responseIdentity: "resp-postponement-email-1",
        threadIdentity: "thread-postponement-email-1",
        normalizedResponseText: "subject urgent dear team 13:00 utc 13:30 utc 14:00 utc confirm end of day utc update calendar invite apologies"
      },
      mode: "deep",
      quickBaseline: null
    })
    const postponementEmailContext = getReviewAnalysisContext(postponementEmailResult)
    assert.ok((postponementEmailContext?.reviewContract?.copyPromptText ?? "").length > 0)
    assert.ok(postponementEmailContext?.reviewContract?.analysisDebug)
    assert.equal((postponementEmailContext?.reviewContract?.analysisDebug?.baseline.judgments.length ?? 0) > 0, true)
    assert.doesNotMatch(postponementEmailContext?.reviewContract?.copyPromptText ?? "", /\bemail box\b/i)
    assert.doesNotMatch(postponementEmailContext?.reviewContract?.copyPromptText ?? "", /\bsmall[-\s]?talk\b/i)
    assert.doesNotMatch(postponementEmailContext?.reviewContract?.copyPromptText ?? "", /\brequested deliverable type\b/i)
    assert.doesNotMatch(postponementEmailContext?.reviewContract?.copyPromptText ?? "", /\bkeep these parts as they are\b/i)

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
    assertNoMonolithicGoalChecklist(structuredCvResult)
    assert.equal(checklistStatusFor(structuredCvResult, "Requested deliverable type is present"), "met")
    assert.equal(checklistStatusFor(structuredCvResult, "Full HTML file output is present"), "met")
    assert.equal(checklistStatusFor(structuredCvResult, "Tool or method constraint matches (Inline CSS only)"), "met")
    assert.equal(checklistStatusFor(structuredCvResult, "HTML requirement is present"), "met")

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
    assertNoMonolithicGoalChecklist(forcedStructuredCvOverride)
    assert.equal(checklistStatusFor(forcedStructuredCvOverride, "Requested deliverable type is present"), "met")
    assert.equal(checklistStatusFor(forcedStructuredCvOverride, "HTML requirement is present"), "met")

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
    assertNoMonolithicGoalChecklist(writingResult)
    assert.ok(writingResult.acceptance_checklist.length >= 3)

    const structuredRewritePrompt = `Task / goal:
Rewrite this product update for executives in a professional, concise tone.

Key requirements:
- Audience: executives
- Tone: professional
- Length: concise

Output format:
- Return the rewritten text only.`
    const structuredRewriteAttempt = makeAttempt(structuredRewritePrompt, "other")
    const structuredRewriteTaskType = classifyReviewTaskType(structuredRewriteAttempt)
    assert.equal(structuredRewriteTaskType, "writing")
    const structuredRewriteResult = await runner({
      target: {
        attempt: structuredRewriteAttempt,
        taskType: structuredRewriteTaskType,
        responseText: "We delivered the release on schedule, improved reliability, and reduced support load. The update is ready for executive review.",
        responseIdentity: "resp-rewrite-structured-1",
        threadIdentity: "thread-rewrite-structured-1",
        normalizedResponseText: "delivered release on schedule improved reliability reduced support load"
      },
      mode: "deep",
      quickBaseline: null
    })
    assertNoMonolithicGoalChecklist(structuredRewriteResult)
    assert.equal(checklistStatusFor(structuredRewriteResult, "Requested rewrite output is present"), "met")
    assert.equal(checklistStatusFor(structuredRewriteResult, "Tone requirement is preserved"), "met")
    assert.equal(checklistStatusFor(structuredRewriteResult, "Concise tone or style requirement is preserved"), "met")
    assert.equal(checklistStatusFor(structuredRewriteResult, "Audience requirement is preserved"), "met")

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
    assertNoMonolithicGoalChecklist(structuredAdviceResult)
    assert.equal(checklistStatusFor(structuredAdviceResult, "Requested answer type is present"), "met")
    assert.equal(checklistStatusFor(structuredAdviceResult, "Requested count or exactness matches"), "met")
    assert.equal(checklistStatusFor(structuredAdviceResult, "Exclusion is preserved (artificial sweeteners)"), "met")
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
    assertNoMonolithicGoalChecklist(forcedAdviceOverrideResult)
    assert.equal(checklistStatusFor(forcedAdviceOverrideResult, "Requested answer type is present"), "met")
    assert.equal(checklistStatusFor(forcedAdviceOverrideResult, "Requested count or exactness matches"), "met")

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
    assertNoMonolithicGoalChecklist(missingPartsCreationResult)
    assert.equal(checklistStatusFor(missingPartsCreationResult, "Requested deliverable type is present"), "met")
    assert.equal(checklistStatusFor(missingPartsCreationResult, "HTML requirement is present"), "met")
    assert.notEqual(checklistStatusFor(missingPartsCreationResult, "CSS requirement is present"), "met")

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
