import type { DeepAnalysisV2EvalCase } from "./deep-analysis-v2-eval-types"

const COMPLETION_CTA = "After you finish, confirm which requirements were completed and suggest the next step."

const briefBookingPrompt = [
  "Act like Replit’s coding agent. I am building a simple booking app.",
  "",
  "Phase 1 goal: create the booking form UI only.",
  "",
  "Reply very briefly like a coding agent after completing the work. Do not include code. Say what you changed, confirm Phase 1 is done, and tell me the next phase."
].join("\n")

const longBookingPrompt =
  "Act like a Replit/Lovable coding agent. I am a non-technical founder building a simple booking app. Give me a phased implementation plan and write the code for Phase 1. Phase 1 should include the booking form UI only. After that, tell me what the next phase should be."

const bookingProjectContext = "A non-technical founder is building a simple booking app in phases."

export const DEEP_ANALYSIS_V2_EVAL_CASES: DeepAnalysisV2EvalCase[] = [
  {
    id: "generic-pass-with-next-move-implements-next-step",
    title: "Requirements pass with assistant next move implements safest next step",
    category: "prompt_intent",
    input: {
      promptText:
        "Build the signup UI for my SaaS app. Keep it frontend-only for now. Reply briefly with what changed and what the next step should be.",
      responseText:
        "Built the signup UI with name, email, password fields and a submit button. Kept it frontend-only with no backend or auth provider connected. Next step: add client-side validation and submit-state handling.",
      projectContext: "A non-technical founder is building a SaaS app in phases.",
      currentState: "Signup UI was requested.",
      taskType: "creation",
      surface: "chatgpt"
    },
    expected: {
      overallStatus: "pass",
      assistantSuggestedNextMoveIncludes: ["client-side validation"],
      generatedPromptIncludes: ["Please implement the best next step now:", "client-side validation"],
      generatedPromptEndsWith: COMPLETION_CTA,
      nextStepSource: "assistant_suggestion",
      promptIntent: "implement_next_step",
      nextStepRequirementsInclude: ["client-side validation"]
    },
    rubric: {
      must: [
        "Handle a non-booking pass case without relying on booking-specific phase rules.",
        "Use the assistant suggestion as the next-step source.",
        "Generate an implementation prompt rather than a confirmation prompt."
      ]
    }
  },
  {
    id: "pass-without-next-move-asks-for-next-step",
    title: "Requirements pass without assistant next move asks for next-step recommendation",
    category: "prompt_intent",
    input: {
      promptText:
        "Build the signup UI for my SaaS app. Keep it frontend-only for now. Reply briefly with what changed.",
      responseText:
        "Built the signup UI with name, email, password fields and a submit button. Kept it frontend-only with no backend or auth provider connected.",
      projectContext: "A non-technical founder is building a SaaS app in phases.",
      currentState: "Signup UI was requested.",
      taskType: "creation",
      surface: "chatgpt"
    },
    expected: {
      overallStatus: "pass",
      generatedPromptIncludes: ["Before implementing more, suggest the safest next step", "How we will know it is complete"],
      generatedPromptEndsWith: COMPLETION_CTA,
      nextStepSource: "unavailable",
      promptIntent: "ask_for_next_step"
    },
    rubric: {
      must: [
        "Do not fail the completed work just because no next move was requested or provided.",
        "Ask for the safest next step instead of inventing certainty when project memory does not provide one."
      ]
    }
  },
  {
    id: "missing-requirements-with-next-move-confirms-first",
    title: "Missing requirements with assistant next move confirms missing work before advancing",
    category: "prompt_intent",
    input: {
      promptText:
        "Build the booking form submission flow. It must validate required fields, prevent empty submissions, show errors, and display a confirmation summary.",
      responseText:
        "Added the submit handler and inline errors. Next phase: save bookings to local storage.",
      projectContext: bookingProjectContext,
      currentState: "Validation and confirmation were requested.",
      taskType: "creation",
      surface: "chatgpt"
    },
    expected: {
      overallStatus: "needs_confirmation",
      generatedPromptIncludes: ["Before we move forward", "Do not add new scope yet"],
      generatedPromptExcludes: ["Please implement the best next step now:"],
      nextStepSource: "assistant_suggestion",
      promptIntent: "confirm_missing_requirements"
    },
    rubric: {
      must: [
        "Do not advance just because the assistant suggested a next phase.",
        "Ask for confirmation/evidence on missing current-step requirements first."
      ]
    }
  },
  {
    id: "missing-requirements-without-next-move-confirms-first",
    title: "Missing requirements without assistant next move confirms missing work",
    category: "prompt_intent",
    input: {
      promptText:
        "Build the booking form submission flow. It must validate required fields, prevent empty submissions, show errors, and display a confirmation summary.",
      responseText: "Added the submit handler and inline errors.",
      projectContext: bookingProjectContext,
      currentState: "Validation and confirmation were requested.",
      taskType: "creation",
      surface: "chatgpt"
    },
    expected: {
      overallStatus: "needs_confirmation",
      generatedPromptIncludes: ["Before we move forward", "Do not add new scope yet"],
      generatedPromptExcludes: ["Please implement the best next step now:"],
      nextStepSource: "unavailable",
      promptIntent: "confirm_missing_requirements"
    },
    rubric: {
      must: [
        "Block advancement when current requirements are not clearly complete.",
        "Still ask the assistant to suggest the next step after confirmation."
      ]
    }
  },
  {
    id: "cannot-verify-review-before-advancing",
    title: "Cannot verify answer asks for proof before advancing",
    category: "prompt_intent",
    input: {
      promptText:
        "Review the booking app after implementing validation. Tell me whether required fields, error messages, empty-submit prevention, and confirmation summary are all working. Give concrete visible evidence. If anything is unverified, do not move to the next phase.",
      responseText:
        "I can’t verify it from here because I don’t have the app URL, repo, screenshot, or code. Status: Not verified — do not move to next phase yet.",
      projectContext: bookingProjectContext,
      currentState: "Validation was supposedly implemented and needs review.",
      taskType: "advice",
      surface: "chatgpt"
    },
    expected: {
      overallStatus: "risky",
      generatedPromptIncludes: ["Before moving forward", "provide concrete proof", "do not start the next phase yet"],
      generatedPromptExcludes: ["Please implement the best next step now:"],
      promptIntent: "review_before_advancing"
    },
    rubric: {
      must: [
        "Do not mark an unverified answer as ready for next phase.",
        "Ask for proof or confirmation before advancing."
      ]
    }
  },
  {
    id: "emoji-complete-no-backend-logic-pass",
    title: "Emoji completion and no-backend wording pass UI-only phase",
    category: "regression",
    input: {
      promptText: briefBookingPrompt,
      responseText: [
        "Changes made:",
        "Built booking form UI (name, contact, date/time picker, service selection, notes)",
        "Added basic validation states (required fields, error hints)",
        "Structured layout for mobile + desktop responsiveness",
        "Added submit button (no backend logic)",
        "Status: Phase 1 ✅ Complete (UI implemented, visible, testable)",
        "Next phase: Phase 2 → Connect form to backend (store bookings + basic API)."
      ].join("\n"),
      projectContext: bookingProjectContext,
      currentState: "Phase 1 UI-only work was requested.",
      taskType: "creation",
      surface: "chatgpt"
    },
    expected: {
      overallStatus: "pass",
      missingRequirementExcludes: [
        "Complete Phase 1: create the booking form UI only.",
        "Keep this step scoped to UI only.",
        "Confirm Phase 1 is complete."
      ],
      assistantSuggestedNextMoveIncludes: ["Connect form to backend"],
      generatedPromptIncludes: [
        "- Add required field validation",
        "- Show clear error messages",
        "- Prevent empty submission",
        "- Show a booking confirmation summary",
        "Do not connect a backend yet."
      ],
      generatedPromptExcludes: ["Before we move forward", "Connect form to backend"],
      generatedPromptEndsWith: COMPLETION_CTA,
      recommendedNextMoveIncludes: ["validation"],
      nextStepSource: "assistant_suggestion",
      promptIntent: "implement_next_step",
      nextStepRequirementsInclude: ["validation", "error", "empty", "summary"],
      blockedScopeIncludes: ["backend"]
    },
    rubric: {
      must: [
        "Treat Phase 1 ✅ Complete as completion evidence.",
        "Treat no backend logic as evidence that UI-only scope was respected.",
        "Correct a too-early backend next suggestion into validation and confirmation."
      ]
    }
  },
  {
    id: "brief-booking-phase-one-pass-generates-validation",
    title: "Brief Replit-style Phase 1 answer passes and generates validation prompt",
    category: "next_prompt",
    input: {
      promptText: briefBookingPrompt,
      responseText: [
        "Created booking form UI with fields (name, email, phone, date, time, service, notes), validation states, and submit button.",
        "Basic responsive layout added.",
        "Phase 1 complete.",
        "Next phase: connect form to backend (API endpoint + data handling)."
      ].join("\n"),
      projectContext: bookingProjectContext,
      currentState: "Phase 1 UI-only work was requested.",
      taskType: "creation",
      surface: "chatgpt"
    },
    expected: {
      overallStatus: "pass",
      missingRequirementExcludes: ["Keep this step scoped to UI only.", "Suggest the next step."],
      assistantSuggestedNextMoveIncludes: ["connect form to backend"],
      generatedPromptIncludes: [
        "Please implement the best next step now:",
        "- Add required field validation",
        "- Show clear error messages",
        "- Prevent empty submission",
        "- Show a booking confirmation summary",
        "Do not connect a backend yet."
      ],
      generatedPromptExcludes: ["Fix the unclear parts", "Finish missing requirements", "API endpoint"],
      generatedPromptEndsWith: COMPLETION_CTA,
      recommendedNextMoveIncludes: ["validation"],
      nextStepSource: "assistant_suggestion",
      promptIntent: "implement_next_step",
      nextStepRequirementsInclude: ["validation", "error", "empty", "summary"],
      blockedScopeIncludes: ["backend"]
    },
    rubric: {
      must: [
        "Accept a brief coding-agent completion answer as enough for Phase 1.",
        "Record the backend recommendation without following it directly.",
        "Generate the safer Phase 2 validation and confirmation prompt."
      ],
      rejectIf: ["The result asks the user to finish Phase 1 again."]
    }
  },
  {
    id: "long-chatgpt-code-answer-pass-generates-phase-two",
    title: "Long ChatGPT code answer passes original founder prompt",
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
      ].join("\n"),
      projectContext: bookingProjectContext,
      currentState: "The user asked for Phase 1 code and the next phase.",
      taskType: "creation",
      surface: "chatgpt"
    },
    expected: {
      overallStatus: "pass",
      assistantSuggestedNextMoveIncludes: ["Phase 2 should be form validation"],
      generatedPromptIncludes: [
        "- Add required field validation",
        "- Show clear error messages",
        "- Prevent empty submission",
        "- Show a booking confirmation summary",
        "Do not connect a backend yet."
      ],
      generatedPromptExcludes: ["Tighten only the unclear", "Finish the missing parts"],
      generatedPromptEndsWith: COMPLETION_CTA,
      nextStepSource: "assistant_suggestion",
      promptIntent: "implement_next_step",
      nextStepRequirementsInclude: ["validation", "error", "empty", "summary"],
      blockedScopeIncludes: ["backend"]
    },
    rubric: {
      must: [
        "Treat code as required because the submitted prompt asked for code.",
        "Do not punish the answer for including code in this case.",
        "Generate the Phase 2 validation prompt."
      ]
    }
  },
  {
    id: "missing-next-step-needs-confirmation",
    title: "Missing requested next step asks for confirmation",
    category: "needs_confirmation",
    input: {
      promptText: briefBookingPrompt,
      responseText:
        "Created booking form UI with fields: name, email, date, time, service, notes, validation states, and submit button. Phase 1 complete.",
      projectContext: bookingProjectContext,
      currentState: "Phase 1 UI-only answer should also name the next phase.",
      taskType: "creation",
      surface: "chatgpt"
    },
    expected: {
      overallStatus: "needs_confirmation",
      missingRequirementIncludes: ["Suggest the next step."],
      generatedPromptIncludes: [
        "Before we move forward, confirm these requirements from my last prompt:",
        "- Suggest the next step.",
        "Do not add new scope yet.",
        "After confirming, suggest what the next step should be."
      ],
      generatedPromptExcludes: ["Please implement the best next step now:"],
      generatedPromptEndsWith: "After confirming, suggest what the next step should be.",
      nextStepSource: "unavailable",
      promptIntent: "confirm_missing_requirements"
    },
    rubric: {
      must: [
        "Block the next implementation prompt until the assistant confirms the requested next step.",
        "Still require the assistant to suggest the next step in the confirmation prompt."
      ]
    }
  },
  {
    id: "no-code-format-violation-needs-confirmation",
    title: "No-code response format violation needs confirmation",
    category: "needs_confirmation",
    input: {
      promptText: briefBookingPrompt,
      responseText: [
        "Created booking form UI.",
        "```html",
        "<form><button>Continue</button></form>",
        "```",
        "Phase 1 complete.",
        "Next phase: validation and confirmation."
      ].join("\n"),
      projectContext: bookingProjectContext,
      currentState: "The user wanted a brief no-code completion summary.",
      taskType: "creation",
      surface: "chatgpt"
    },
    expected: {
      overallStatus: "needs_confirmation",
      missingRequirementIncludes: ["Do not include code."],
      generatedPromptIncludes: ["- Do not include code.", "After confirming, suggest what the next step should be."],
      generatedPromptExcludes: ["- Add required field validation"],
      promptIntent: "confirm_missing_requirements"
    },
    rubric: {
      must: ["Respect explicit answer-format requirements from the submitted prompt."]
    }
  },
  {
    id: "long-founder-prompt-without-code-needs-confirmation",
    title: "Long founder prompt without requested Phase 1 code needs confirmation",
    category: "needs_confirmation",
    input: {
      promptText: longBookingPrompt,
      responseText: [
        "Phase 1 should be a booking form UI with name, phone, service, date, and time fields.",
        "Next phase: form validation and confirmation state."
      ].join("\n"),
      projectContext: bookingProjectContext,
      currentState: "The user asked for code, not just a description.",
      taskType: "creation",
      surface: "chatgpt"
    },
    expected: {
      overallStatus: "needs_confirmation",
      missingRequirementIncludes: ["Provide code for Phase 1."],
      generatedPromptIncludes: ["- Provide code for Phase 1.", "Do not add new scope yet."],
      generatedPromptExcludes: ["Please implement the best next step now:"],
      promptIntent: "confirm_missing_requirements"
    },
    rubric: {
      must: ["Catch that the requested Phase 1 code is missing."]
    }
  },
  {
    id: "ui-only-current-work-drift-needs-confirmation",
    title: "UI-only phase drifts into backend implementation",
    category: "scope_guard",
    input: {
      promptText: briefBookingPrompt,
      responseText: [
        "Created the booking form UI and wired it to a backend API for saving bookings.",
        "Phase 1 complete.",
        "Next phase: deploy the app."
      ].join("\n"),
      projectContext: bookingProjectContext,
      currentState: "Phase 1 must stay UI-only.",
      taskType: "creation",
      surface: "replit"
    },
    expected: {
      overallStatus: "needs_confirmation",
      missingRequirementIncludes: ["Keep this step scoped to UI only."],
      generatedPromptIncludes: ["- Keep this step scoped to UI only.", "Do not add new scope yet."],
      generatedPromptExcludes: ["deploy the app"],
      promptIntent: "confirm_missing_requirements"
    },
    rubric: {
      must: ["Detect real scope drift when backend work is described as part of the current completed step."],
      rejectIf: ["The result treats backend implementation as acceptable Phase 1 UI-only work."]
    }
  }
]

export function getDeepAnalysisV2EvalCases() {
  return DEEP_ANALYSIS_V2_EVAL_CASES
}
