import type { NextApiRequest, NextApiResponse } from "next"
import { detectIntent } from "@prompt-optimizer/shared"

function buildRecipeAnswer(prompt: string) {
  const lower = prompt.toLowerCase()
  const servings = /3-4|3 to 4|serve 3|serve 4|servings?:\s*3-4/i.test(prompt) ? "3-4" : "2-3"
  const calories = /300-500/i.test(prompt) ? "420" : "390"
  const tangy = /\btangy\b|\bcitrus\b|\blem(?:on|ime)\b/i.test(prompt)
  const asian = /\basian\b/i.test(prompt)
  const chickpeas = /\bchickpeas?\b/i.test(prompt)
  const title = `${tangy ? "Tangy" : "Bright"} ${asian ? "Asian" : ""} ${chickpeas ? "Chickpea" : "Protein"} Lettuce Cup Lunch Bowl`
    .replace(/\s+/g, " ")
    .trim()

  return `${title}

Servings: ${servings}
Time: 25 minutes
Calories: ${calories} per serving

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
- Calories: ${calories}
- Protein: 23 g
- Carbohydrates: 30 g
- Net carbs: 18 g
- Fat: 16 g
- Fiber: 12 g

Why it fits:
- Vegetarian lunch built around chickpeas for plant protein
- Tangy Asian-inspired flavor from tamari, rice vinegar, lime, ginger, and chili
- Lower-carb structure by using lettuce cups and crunchy vegetables instead of rice or noodles`
}

function buildDemoAnswer(prompt: string) {
  const lowered = prompt.toLowerCase()
  const intent = detectIntent(prompt)

  if (/<html|full html file|inline css|resume|résumé|cv\b/i.test(prompt)) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Candidate Resume</title>
</head>
<body style="margin:0; font-family:Arial,sans-serif; background:#f4f7fb; color:#14213d;">
  <div style="max-width:960px; margin:24px auto; background:#ffffff; border:1px solid #d7deea; display:flex; overflow:hidden;">
    <aside style="width:30%; min-width:230px; background:#eef4ff; padding:28px;">
      <h1 style="margin:0 0 8px; font-size:28px;">Your Name</h1>
      <p style="margin:0 0 20px; color:#47607f;">Product Designer</p>
      <h2 style="font-size:16px; margin:0 0 12px;">Skills</h2>
      <ul style="margin:0; padding-left:18px; line-height:1.8;">
        <li>Design systems</li>
        <li>User research</li>
        <li>Prototyping</li>
        <li>HTML &amp; CSS</li>
      </ul>
    </aside>
    <main style="width:70%; padding:28px;">
      <section style="margin-bottom:22px;">
        <h2 style="margin:0 0 10px; font-size:18px;">Summary</h2>
        <p style="margin:0; line-height:1.7;">Adaptable professional with experience shipping polished digital products and collaborating across design, engineering, and go-to-market teams.</p>
      </section>
      <section style="margin-bottom:22px;">
        <h2 style="margin:0 0 10px; font-size:18px;">Experience</h2>
        <p style="margin:0 0 8px;"><strong>Senior Product Designer</strong> — Studio North</p>
        <p style="margin:0; line-height:1.7;">Led end-to-end product design for mobile and web experiences, improved onboarding conversion, and partnered closely with engineering on launch readiness.</p>
      </section>
      <section>
        <h2 style="margin:0 0 10px; font-size:18px;">Education</h2>
        <p style="margin:0 0 8px;"><strong>B.A. in Design</strong> — Example University</p>
        <p style="margin:0; line-height:1.7;">Focused on visual communication, user-centered research, and front-end implementation.</p>
      </section>
    </main>
  </div>
</body>
</html>`
  }

  if (/\brecommend|exact product|buy online|landmark|ticket|hours\b/i.test(prompt)) {
    return `Dubai Marina Walk
Exact entry fee: AED 0
Today's opening hours: Open 24 hours
Walking route: From the Downtown Dubai / Burj area hotel zone, take a quick taxi or metro hop to Dubai Marina Mall, then walk straight out toward the Marina Walk promenade. Stay on the waterfront path and continue south for the clearest skyline views and the easiest late-afternoon couple stroll.`
  }

  if (/\bdrink mix\b|\bstir into warm water\b|\bherbal drink\b/i.test(prompt)) {
    return `Golden Lemon Ginger Hydration Mix

Ingredients:
- 2 tbsp coconut milk powder
- 1 tbsp freeze-dried lemon powder
- 1 tsp ginger powder
- 2 tsp cane sugar
- 1/2 tsp monk fruit sweetener
- Pinch of sea salt

Directions:
1. Stir one serving into a mug of warm water until dissolved.
2. Taste and adjust sweetness if needed.

Why it fits:
- Vegan and blender-free
- Warm herbal-citrus profile
- Ready to use straight from the packet with very low caffeine`
  }

  if (/\brecipe\b|\bmeal\b|\blunch\b|\bdinner\b|\bbreakfast\b/i.test(prompt) || lowered.includes("nutritional information")) {
    return buildRecipeAnswer(prompt)
  }

  if (intent === "EXPLAIN") {
    return `Here’s the simple version:

The core idea is to reduce ambiguity before execution. A stronger prompt names the exact goal, the constraints that matter most, and the format the answer should follow. That makes the assistant more likely to deliver something directly usable on the first try.`
  }

  return `Here is a stronger first-pass answer based on your request:

- I kept the goal front and center.
- I preserved the key constraints.
- I returned something directly usable instead of a vague outline.

If you want, you can now run reeva AI analysis on this answer to see whether the result is specific enough to trust as-is.`
}

export default function handler(request: NextApiRequest, response: NextApiResponse) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST")
    return response.status(405).json({ error: "Method not allowed." })
  }

  const prompt = typeof request.body?.prompt === "string" ? request.body.prompt.trim() : ""

  if (!prompt) {
    return response.status(400).json({ error: "Prompt is required." })
  }

  return response.status(200).json({
    answer: buildDemoAnswer(prompt)
  })
}
