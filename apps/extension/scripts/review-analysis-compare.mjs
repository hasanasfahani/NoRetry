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
      path.resolve(extensionRoot, "lib/review/services/review-analysis.ts")
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

async function main() {
  const outdir = await mkdtemp(path.join(os.tmpdir(), "review-analysis-compare-"))
  try {
    await bundleModules(outdir)
    const taskTypeMod = await import(pathToFileURL(path.join(outdir, "review-task-type.js")).href)
    const analysisMod = await import(pathToFileURL(path.join(outdir, "review-analysis.js")).href)
    const { classifyReviewTaskType } = taskTypeMod
    const { createReviewAnalysisRunner, getReviewAnalysisContext } = analysisMod

    const runner = createReviewAnalysisRunner({
      analyzeAfterAttempt: async () => {
        throw new Error("comparison harness should stay on the structured smart-analysis path")
      },
      attachAnalysisResult: async () => null,
      preprocessResponse,
      getProjectMemoryContext: () => ({ projectContext: "", currentState: "" }),
      collectChangedFilesSummary: () => [],
      collectVisibleErrorSummary: () => ""
    })

    const cases = [
      {
        name: "postponement-email",
        prompt: `Task / goal:
Write a formal postponement email to my internal team. Move today’s 1 h meeting to tomorrow early afternoon UTC. Give 3 exact start-time options (e.g., 13:00, 13:30, 14:00). Reason: awaiting a key attendee. Add “[URGENT]” to the subject. Include a brief apology, ask for confirmation by end of day UTC, and state that I will update the calendar invite. Keep it under 150 words, no small-talk.

Constraints:
- Do not use small-talk.

write it freely here without the email box`,
        response: `**Subject:** [URGENT] Meeting Postponement – Reschedule Required

Dear Team,

Today’s 1-hour meeting will be postponed to tomorrow early afternoon UTC due to awaiting a key attendee. Please confirm your availability for one of the following start times:

* 13:00 UTC
* 13:30 UTC
* 14:00 UTC

Kindly confirm your preferred option by end of day UTC. I will update the calendar invite accordingly.

Apologies for the inconvenience.`
      },
      {
        name: "daily-budget-recipe",
        prompt: `Task / goal:
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
- step-by-step instructions.`,
        response: `## Microwave Chicken & Egg Protein Bowl (Single Serving)

### Ingredients

* 120g cooked chicken breast
* 2 large eggs
* 1 cup fresh spinach
* 1 tbsp olive oil
* 1/2 avocado

### Step-by-Step Instructions

1. Add spinach and chicken to a microwave-safe bowl.
2. Microwave for 1 minute.
3. Crack in the eggs and mix.
4. Microwave for 60–90 seconds until set.
5. Add olive oil and avocado, then serve.

### Macros per Serving

* Calories: ~520 kcal
* Protein: ~45g
* Fat: ~34g
* Net Carbs: ~5g`
      },
      {
        name: "mexican-microwave-recipe",
        prompt: `Task / goal:
Generate a gluten-free, high-protein Mexican lunch recipe for two that cooks in 10–20 min using only a microwave, tastes creamy, has zero heat, and is eaten fresh (no leftovers). Provide exact ingredients, macros per serving, and step-by-step instructions.

Key requirements:
- Creamy texture: creamy.
- mexican.
- Eat fresh only.
- gluten-free.
- no leftovers.

Constraints:
- 10–20 min.
- High-protein.
- Do not use heat.
- Do not use leftovers.
- Keep it gluten-free.

Output format:
- ingredients.
- macros per serving.
- step-by-step instructions.`,
        response: `## Creamy Mexican Chicken & Avocado Bowl (Microwave, 2 Servings)

### Ingredients

* 300g cooked chicken breast
* 1 cup canned black beans
* 1 cup frozen corn
* 1 large ripe avocado

### Macros per Serving

* Calories: ~520 kcal
* Protein: ~45g

### Step-by-Step Instructions

1. Add chicken, black beans, and corn to a microwave-safe bowl.
2. Microwave for 3–4 minutes.
3. Mash avocado with olive oil and lime juice.
4. Fold the warm mixture into the avocado and serve immediately.`
      },
      {
        name: "faster-than-window-recipe",
        prompt: `Task / goal:
Suggest a healthy vegan lunch recipe that can be prepared in 30-60 minutes. Include ingredients, step-by-step instructions, and nutritional highlights.

Key requirements:
- Lunch.
- Vegan.

Constraints:
- 30-60 minutes.
- High-protein.

Output format:
- calories per serving.
- macros per serving.
- ingredients.
- step-by-step instructions.`,
        response: `Bright Protein Lettuce Cup Lunch Bowl

Servings: 2-3
Time: 25 minutes
Calories: 390 per serving

Ingredients:
- 2 cans chickpeas, drained and rinsed
- 1 cup shelled edamame
- 1 small cucumber, diced

Instructions:
1. Combine the chickpeas, edamame, and chopped vegetables in a bowl.
2. Toss with the dressing and serve.

Nutritional information (per serving):
- Calories: 390
- Protein: 23 g
- Carbohydrates: 30 g
- Fat: 16 g`
      },
      {
        name: "quantitative-range-recipe",
        prompt: `Task / goal:
Generate a healthy dinner recipe for weight loss that is gluten-free, dairy-free, Mediterranean cuisine, balanced in flavor, takes 30-60 minutes to prepare, and contains 300-500 calories. Provide the recipe with ingredients, step-by-step instructions, and nutritional information.

Key requirements:
- Weight loss.
- Dinner.
- Balanced.
- Mediterranean.

Constraints:
- Gluten-free, Dairy-free.
- 30-60 minutes.
- 300-500 calories.

Output format:
- calories per serving.
- macros per serving.
- ingredients.
- step-by-step instructions.`,
        response: `Bright Protein Lettuce Cup Lunch Bowl

Servings: 2-3
Time: 25 minutes
Calories: 420 per serving

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
- Calories: 420
- Protein: 23 g
- Carbohydrates: 30 g
- Net carbs: 18 g
- Fat: 16 g
- Fiber: 12 g`
      },
      {
        name: "budget-and-serving-range",
        prompt: `Task / goal:
Generate a practical lunch recipe for 2-4 people that stays within a $5-8 budget per serving, takes under 30 minutes, and includes calories per serving plus ingredients and instructions.

Constraints:
- 2-4 people.
- $5-8 per serving.
- under 30 minutes.

Output format:
- calories per serving.
- ingredients.
- step-by-step instructions.`,
        response: `Simple Bean and Rice Lunch Bowl

Servings: 2-3
Time: 22 minutes
Estimated cost: $6 per serving
Calories: 430 per serving

Ingredients:
- 1 can black beans
- 2 cups cooked rice
- 1 avocado

Instructions:
1. Warm the beans and rice.
2. Top with avocado and serve.`
      },
      {
        name: "coding-prompt-scope",
        prompt: `Task / goal:
Write a send-ready coding prompt for Cursor to update the React settings page so it adds a timezone dropdown and stores the selected timezone in the existing profile settings API response.

Key requirements:
- Ask for the exact files changed.
- Include test steps.
- Include regression risks.

Constraints:
- Only change the settings page and the existing profile settings client call.
- Do not change auth, routing, or unrelated styling.

Output format:
- send-ready coding prompt.`,
        response: `Update the app to support timezones.

Make the settings UI better and wire timezone persistence everywhere it is needed.

Also clean up any related styling issues and improve the auth flow if needed.

Return the final code and explain what you changed.`
      },
      {
        name: "bug-fix-proof",
        prompt: `Task / goal:
Write a debugging prompt for a coding tool to fix why the browser extension popup is blank on first open.

Key requirements:
- Ask for the likely root cause.
- Ask for the exact fix.
- Ask for verification steps proving the popup renders correctly.

Constraints:
- Preserve the existing popup layout.
- Do not change unrelated review logic.

Output format:
- send-ready coding prompt.`,
        response: `Fix the blank popup issue.

Look at the initialization order and make the popup mount later.

Return the code changes once it works.`
      },
      {
        name: "broad-change-summary",
        prompt: `clarify what had you changed`,
        response: `Across this session, three changes were made to the extension:

1. fetchAuthState() — timeout added (src/content/index.ts)
The function that asks the background service worker for the login state had no timeout. If Chrome had killed the service worker, the callback never fired and boot() hung permanently.

2. FAB auth gate removed (src/content/index.ts)
initPage() previously had an early return when the user was not logged in, so createFloatingButton() was never called for unauthenticated users.

3. AUTH_STATE_CHANGED field mismatch fixed (src/background/service-worker.ts)
The service worker was broadcasting { type: "AUTH_STATE_CHANGED", authState: ... } but the content script was reading msg.data.`
      }
    ]

    const summaries = []
    for (const [index, testCase] of cases.entries()) {
      const attempt = makeAttempt(testCase.prompt)
      const taskType = classifyReviewTaskType(attempt)
      const result = await runner({
        target: {
          attempt,
          taskType,
          responseText: testCase.response,
          responseIdentity: `compare-${index + 1}`,
          threadIdentity: `compare-thread-${index + 1}`,
          normalizedResponseText: testCase.response.toLowerCase()
        },
        mode: "deep",
        quickBaseline: null
      })
      const context = getReviewAnalysisContext(result)
      const debug = context?.reviewContract?.analysisDebug
      assert.ok(debug, `missing analysis debug for ${testCase.name}`)
      assert.ok(debug.baseline.nextMove.length > 0)
      assert.ok(debug.smart.nextMove.length > 0)
      assert.ok(debug.baseline.judgments.length > 0)
      assert.ok(debug.smart.judgments.length > 0)
      if (testCase.name === "broad-change-summary") {
        assert.match(debug.smart.nextMove, /No retry needed/i)
      }
      if (testCase.name === "faster-than-window-recipe") {
        assert.doesNotMatch(debug.smart.nextMove, /time limit|time target|minutes/i)
      }
      if (testCase.name === "quantitative-range-recipe") {
        assert.doesNotMatch(debug.smart.nextMove, /macros? and calories|calorie target|time limit/i)
      }
      if (testCase.name === "budget-and-serving-range") {
        assert.doesNotMatch(debug.smart.nextMove, /budget|cost|serving count|time limit/i)
      }
      summaries.push({
        name: testCase.name,
        selectedPath: debug.selectedPath,
        promptVersion: debug.promptVersion,
        baselineNextMove: debug.baseline.nextMove,
        smartNextMove: debug.smart.nextMove,
        comparisonSummary: debug.comparisonSummary
      })
    }

    console.log(JSON.stringify({ cases: summaries }, null, 2))
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
