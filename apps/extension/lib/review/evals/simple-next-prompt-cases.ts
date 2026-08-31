import type { SimpleNextPromptEvalCase } from "./simple-next-prompt-eval-types"

const briefBookingPrompt = [
  "Act like Replit’s coding agent. I am building a simple booking app.",
  "",
  "Phase 1 goal: create the booking form UI only.",
  "",
  "Reply very briefly like a coding agent after completing the work. Do not include code. Say what you changed, confirm Phase 1 is done, and tell me the next phase."
].join("\n")

const longBookingPrompt =
  "Act like a Replit/Lovable coding agent. I am a non-technical founder building a simple booking app. Give me a phased implementation plan and write the code for Phase 1. Phase 1 should include the booking form UI only. After that, tell me what the next phase should be."

export const SIMPLE_NEXT_PROMPT_EVAL_CASES = [
  {
    id: "brief-booking-phase-one-passes-and-generates-validation-prompt",
    title: "Brief booking Phase 1 completion advances to validation prompt",
    category: "next_prompt",
    input: {
      promptText: briefBookingPrompt,
      responseText: [
        "Created booking form UI with fields: name, email, date, time, and submit button.",
        "Added basic layout and input validation states.",
        "Phase 1 complete.",
        "Next phase: implement form state handling and submission logic."
      ].join("\n")
    },
    expected: {
      status: "ready_for_next_prompt",
      requirementStatus: "pass",
      promptIncludes: [
        "Please implement the best next step now:",
        "- Add required field validation",
        "- Show clear error messages",
        "- Prevent empty submission",
        "- Show a booking confirmation summary",
        "Do not connect a backend yet.",
        "After you finish, confirm which requirements were completed and suggest the next step."
      ],
      promptExcludes: ["Tighten only the unclear", "Finish the missing parts before moving on"]
    },
    rubric: {
      must: [
        "Treat the brief coding-agent answer as enough for Phase 1.",
        "Generate a specific Phase 2 validation and confirmation prompt.",
        "Avoid generic repair-template wording."
      ],
      rejectIf: ["The prompt asks for a backend immediately."]
    }
  },
  {
    id: "backend-suggestion-is-corrected-before-data-storage",
    title: "Backend suggestion is corrected to validation before storage",
    category: "scope_guard",
    input: {
      promptText: briefBookingPrompt,
      responseText: [
        "Created booking form UI with fields: name, email, phone, date, time, service, notes, validation states, and submit button.",
        "Basic responsive layout added.",
        "Phase 1 complete.",
        "Next phase: connect form to backend (API endpoint + data handling)."
      ].join("\n")
    },
    expected: {
      status: "ready_for_next_prompt",
      requirementStatus: "pass",
      suggestedNextMoveIncludes: ["connect form to backend"],
      promptIncludes: [
        "- Add required field validation",
        "- Show a booking confirmation summary",
        "Do not connect a backend yet."
      ],
      promptExcludes: ["API endpoint", "data handling", "Connect form to backend"]
    },
    rubric: {
      must: [
        "Accept that Phase 1 is complete.",
        "Read the assistant's backend recommendation.",
        "Use project-safe ordering and ask for validation before backend work."
      ],
      rejectIf: ["The generated prompt follows the backend recommendation directly."]
    }
  },
  {
    id: "missing-next-step-asks-for-confirmation",
    title: "Missing requested next step asks for confirmation",
    category: "needs_confirmation",
    input: {
      promptText: briefBookingPrompt,
      responseText: "Created the booking form UI with name, email, date, time, and submit button. Phase 1 complete."
    },
    expected: {
      status: "needs_confirmation",
      requirementStatus: "needs_confirmation",
      missingIncludes: ["Suggest the next step."],
      promptIncludes: [
        "Before we move forward, confirm these requirements from my last prompt:",
        "- Suggest the next step.",
        "Do not add new scope yet.",
        "After confirming, suggest what the next step should be."
      ],
      promptExcludes: ["Please implement the best next step now:"]
    },
    rubric: {
      must: [
        "Identify that the assistant did not answer the requested next-step part.",
        "Ask for confirmation instead of generating the next implementation prompt.",
        "Still ask the assistant to suggest the next step."
      ]
    }
  },
  {
    id: "no-code-format-violation-needs-confirmation",
    title: "No-code format violation is not treated as pass",
    category: "needs_confirmation",
    input: {
      promptText: briefBookingPrompt,
      responseText: ["Created the booking form UI.", "```html", "<form></form>", "```", "Phase 1 complete. Next phase: validation."].join("\n")
    },
    expected: {
      status: "needs_confirmation",
      requirementStatus: "needs_confirmation",
      missingIncludes: ["Do not include code."],
      promptIncludes: ["- Do not include code.", "After confirming, suggest what the next step should be."],
      promptExcludes: ["- Add required field validation"]
    },
    rubric: {
      must: [
        "Respect the user's no-code response format.",
        "Ask the assistant to confirm or correct the violated format before moving forward."
      ]
    }
  },
  {
    id: "missing-phase-complete-confirmation-needs-confirmation",
    title: "Missing Phase 1 completion confirmation blocks next prompt",
    category: "needs_confirmation",
    input: {
      promptText: briefBookingPrompt,
      responseText: "Created booking form UI with name, email, date, time, and submit button. Next phase: validation."
    },
    expected: {
      status: "needs_confirmation",
      requirementStatus: "needs_confirmation",
      missingIncludes: ["Confirm Phase 1 is complete."],
      promptIncludes: ["- Confirm Phase 1 is complete.", "Do not add new scope yet."],
      promptExcludes: ["Please implement the best next step now:"]
    },
    rubric: {
      must: ["Require the explicit completion confirmation the user asked for."]
    }
  },
  {
    id: "long-chatgpt-code-answer-passes-original-founder-prompt",
    title: "Long ChatGPT code answer passes the original founder prompt",
    category: "regression",
    input: {
      promptText: longBookingPrompt,
      responseText: [
        "## Phased implementation plan",
        "",
        "**Phase 1 — Booking Form UI only**",
        "Build the visual form users will fill in to book a service. No backend, no saving, no payment.",
        "",
        "**Phase 2 — Form validation + confirmation state**",
        "Validate required fields, show errors, and display a booking summary after submission.",
        "",
        "# Phase 1 Code — Booking Form UI Only",
        "```html",
        "<form>",
        "  <input id=\"fullName\" type=\"text\" />",
        "  <button type=\"button\">Continue</button>",
        "  <p>Phase 1 only: this form does not save bookings yet.</p>",
        "</form>",
        "```",
        "",
        "## Next phase",
        "",
        "**Phase 2 should be form validation + booking confirmation.**",
        "",
        "- Required fields",
        "- Error messages",
        "- Prevent empty submission",
        "- Show a clean booking summary after clicking Continue"
      ].join("\n")
    },
    expected: {
      status: "ready_for_next_prompt",
      requirementStatus: "pass",
      suggestedNextMoveIncludes: ["Phase 2 should be form validation"],
      promptIncludes: [
        "- Add required field validation",
        "- Show clear error messages",
        "- Prevent empty submission",
        "- Show a booking confirmation summary",
        "Do not connect a backend yet."
      ],
      promptExcludes: ["Fix the unclear parts", "Tighten only the unclear"]
    },
    rubric: {
      must: [
        "Extract requirements from the real long-form founder prompt.",
        "Treat provided Phase 1 code as satisfying the code request.",
        "Generate the validation and confirmation next prompt."
      ],
      rejectIf: ["The answer is marked incomplete because it includes code."]
    }
  },
  {
    id: "long-founder-prompt-without-code-needs-confirmation",
    title: "Long founder prompt without Phase 1 code needs confirmation",
    category: "needs_confirmation",
    input: {
      promptText: longBookingPrompt,
      responseText: [
        "Phase 1 should be a booking form UI with name, phone, service, date, and time fields.",
        "Next phase: form validation and confirmation state."
      ].join("\n")
    },
    expected: {
      status: "needs_confirmation",
      requirementStatus: "needs_confirmation",
      missingIncludes: ["Provide code for Phase 1."],
      promptIncludes: ["- Provide code for Phase 1.", "After confirming, suggest what the next step should be."],
      promptExcludes: ["Please implement the best next step now:"]
    },
    rubric: {
      must: ["Detect that the long prompt asked for Phase 1 code, not only a plan."]
    }
  },
  {
    id: "generic-next-step-remains-action-only",
    title: "Generic non-booking next step remains action-only",
    category: "next_prompt",
    input: {
      promptText: "Build my app in phases. Reply briefly, say what changed, and tell me the next step.",
      responseText: "Added the dashboard shell and navigation. Next step: add a dashboard."
    },
    expected: {
      status: "ready_for_next_prompt",
      requirementStatus: "pass",
      promptIncludes: [
        "Please implement the best next step now:",
        "- Add a dashboard",
        "After you finish, confirm which requirements were completed and suggest the next step."
      ],
      promptExcludes: ["Current completed step:", "Project context:", "Assistant suggested:"]
    },
    rubric: {
      must: [
        "Keep generated prompts short and action-only.",
        "Avoid showing hidden reasoning or project-memory explanation."
      ]
    }
  }
] as const satisfies readonly SimpleNextPromptEvalCase[]

export function getSimpleNextPromptEvalCases() {
  return [...SIMPLE_NEXT_PROMPT_EVAL_CASES]
}
