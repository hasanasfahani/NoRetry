import type { NextMoveEvalCase } from "./next-move-eval-types"

const promptVersion = "assistant-next-move-interpreter.v1"

export const NEXT_MOVE_EVAL_CASES = [
  {
    id: "gate-blocks-phase-advance-when-current-work-is-partial",
    title: "Hard gate blocks moving to Phase 2 while Phase 1 is partial",
    category: "requirement_gate",
    input: {
      promptText: "Implement Phase 1 only and stop for approval before Phase 2.",
      responseText:
        "Phase 1 is mostly wired up, but the settings save path still needs one more pass. I am ready for Phase 2 when you are.",
      taskFamily: "creation",
      review: {
        analysisStatus: "PARTIAL",
        confidence: "medium",
        workflowState: "implementation_underway",
        noRetryRecommended: false,
        decisionText: "The current phase still has missing implementation work.",
        recommendationText: "Finish the missing requirements before moving to Phase 2.",
        promptText: "Finish the missing requirements before moving to Phase 2."
      }
    },
    aiFixture: {
      promptVersion,
      currentStepClaim: "partial",
      nextMoveType: "approval_request",
      nextMoveSummary: "Assistant asks to move to Phase 2 even though it says Phase 1 is not complete.",
      targetLabel: "Phase 2",
      targetPhaseNumber: 2,
      requiresApproval: true,
      suggestsImplementation: true,
      suggestsClarification: false,
      suggestsValidation: false,
      suggestsCompletion: false,
      confidenceLevel: "high"
    },
    expected: {
      interpreter: {
        currentStepClaim: "partial",
        nextMoveType: "approval_request",
        targetPhaseNumber: 2
      },
      selectedSignalSource: "ai",
      decision: {
        status: "incomplete",
        recommendationKind: "finish_missing_requirements"
      },
      hardGate: {
        requirementSatisfied: false,
        mustBlockAdvancement: true,
        rationale: "The current requirement is not satisfied, so the final decision must not advance."
      }
    },
    rubric: {
      must: [
        "Recognize that the assistant is asking to advance while the current step is partial.",
        "Keep the final next-move decision on the current step.",
        "Prefer finishing missing requirements over starting Phase 2."
      ],
      rejectIf: ["The final decision allows starting Phase 2."]
    }
  },
  {
    id: "gate-allows-approved-phase-advance-when-current-work-is-complete",
    title: "Complete current phase can advance to the approved next phase",
    category: "clear_continue",
    input: {
      promptText: "Implement Phase 1 only and stop for approval.",
      responseText:
        "Phase 1 code is ready. It covers the requested MVP and stops here. I am ready for Phase 2 when you are.",
      taskFamily: "creation",
      review: {
        analysisStatus: "SUCCESS",
        confidence: "high",
        workflowState: "safe_to_proceed",
        noRetryRecommended: true,
        decisionText: "Nothing critical is missing.",
        recommendationText: "Continue only with the next approved step.",
        promptText: "Continue only with the next approved step."
      }
    },
    aiFixture: {
      promptVersion,
      currentStepClaim: "complete",
      nextMoveType: "approval_request",
      nextMoveSummary: "Assistant says the current phase is complete and asks for approval to continue.",
      targetLabel: "Phase 2",
      targetPhaseNumber: 2,
      requiresApproval: true,
      suggestsImplementation: true,
      suggestsClarification: false,
      suggestsValidation: false,
      suggestsCompletion: false,
      confidenceLevel: "high"
    },
    expected: {
      interpreter: {
        currentStepClaim: "complete",
        nextMoveType: "approval_request",
        kind: "approval_to_continue",
        confidenceLevel: "high",
        targetPhaseNumber: 2
      },
      selectedSignalSource: "ai",
      signalAgreement: "agree",
      decision: {
        status: "ready_for_next_phase",
        recommendationKind: "start_next_phase"
      },
      hardGate: {
        requirementSatisfied: true,
        mustBlockAdvancement: false,
        rationale: "The current requirement is satisfied and the assistant is asking for approval to continue."
      }
    },
    rubric: {
      must: [
        "Treat the current step as complete.",
        "Recognize that user approval is needed before moving on.",
        "Allow the next phase because the requirement gate is satisfied."
      ]
    }
  },
  {
    id: "chatgpt-phase-one-ui-only-advances-to-phase-two",
    title: "ChatGPT Phase 1 UI-only answer advances to Phase 2",
    category: "clear_continue",
    input: {
      promptText:
        "Act like a Replit/Lovable coding agent. I am a non-technical founder building a simple booking app. Give me a phased implementation plan and write the code for Phase 1. Phase 1 should include the booking form UI only. After that, tell me what the next phase should be.",
      responseText:
        [
          "## Phased implementation plan",
          "",
          "**Phase 1 — Booking Form UI only**",
          "Build the visual form users will fill in to book a service. No backend, no saving, no payment.",
          "",
          "**Phase 2 — Form validation + confirmation state**",
          "Validate required fields, show errors, and display a booking summary after submission.",
          "",
          "**Phase 3 — Local storage**",
          "Save bookings in the browser so you can view recent booking requests.",
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
          "That means:",
          "- Required fields",
          "- Error messages",
          "- Prevent empty submission",
          "- Show a clean booking summary after clicking Continue"
        ].join("\n"),
      taskFamily: "creation",
      review: {
        analysisStatus: "SUCCESS",
        confidence: "high",
        workflowState: "safe_to_proceed",
        noRetryRecommended: true,
        decisionText: "Phase 1 UI-only scope is satisfied.",
        recommendationText: "Continue only with Phase 2.",
        promptText: "Continue only with Phase 2."
      }
    },
    aiFixture: {
      promptVersion,
      currentStepClaim: "complete",
      nextMoveType: "continuation_offer",
      nextMoveSummary: "Assistant identifies Phase 2 as the next implementation phase after completing Phase 1 UI-only scope.",
      targetLabel: "Phase 2",
      targetPhaseNumber: 2,
      requiresApproval: false,
      suggestsImplementation: true,
      suggestsClarification: false,
      suggestsValidation: false,
      suggestsCompletion: false,
      confidenceLevel: "high"
    },
    expected: {
      interpreter: {
        currentStepClaim: "complete",
        nextMoveType: "continuation_offer",
        kind: "start_next_phase",
        targetPhaseNumber: 2
      },
      selectedSignalSource: "ai",
      signalAgreement: "agree",
      decision: {
        status: "ready_for_next_phase",
        recommendationKind: "start_next_phase"
      },
      hardGate: {
        requirementSatisfied: true,
        mustBlockAdvancement: false,
        rationale: "The request explicitly scoped Phase 1 to UI only and asked for the next phase."
      }
    },
    rubric: {
      must: [
        "Respect the user's explicit Phase 1 UI-only scope.",
        "Do not treat future storage/backend phases as missing Phase 1 requirements.",
        "Generate a Phase 2-specific next prompt instead of a generic quality-fix prompt."
      ],
      rejectIf: [
        "The final decision asks to fix unclear parts of Phase 1.",
        "The next move blocks Phase 2 because storage or backend is not implemented."
      ]
    }
  },
  {
    id: "chatgpt-brief-replit-style-phase-one-uses-validation-before-backend",
    title: "Brief Replit-style Phase 1 completion uses validation before backend",
    category: "clear_continue",
    input: {
      promptText:
        "Act like Replit’s coding agent. I am building a simple booking app.\n\nPhase 1 goal: create the booking form UI only.\n\nReply very briefly like a coding agent after completing the work. Do not include code. Say what you changed, confirm Phase 1 is done, and tell me the next phase.",
      responseText:
        "Created booking form UI with fields (name, email, phone, date, time, service, notes), validation states, and submit button. Basic responsive layout added.\n\nPhase 1 complete.\n\nNext phase: connect form to backend (API endpoint + data handling).",
      taskFamily: "creation",
      review: {
        analysisStatus: "SUCCESS",
        confidence: "high",
        workflowState: "safe_to_proceed",
        noRetryRecommended: true,
        decisionText: "Phase 1 booking form UI is complete enough to continue.",
        recommendationText: "Continue with the correct next phase before backend work.",
        promptText: "Continue with the correct next phase before backend work."
      }
    },
    aiFixture: {
      promptVersion,
      currentStepClaim: "complete",
      nextMoveType: "continuation_offer",
      nextMoveSummary: "Assistant says Phase 1 is complete and suggests backend connection as the next phase.",
      targetLabel: "connect form to backend",
      targetPhaseNumber: null,
      requiresApproval: false,
      suggestsImplementation: true,
      suggestsClarification: false,
      suggestsValidation: false,
      suggestsCompletion: false,
      confidenceLevel: "high"
    },
    expected: {
      interpreter: {
        currentStepClaim: "complete",
        nextMoveType: "continuation_offer",
        kind: "continue_current_work",
        targetPhaseNumber: null
      },
      selectedSignalSource: "ai",
      signalAgreement: "agree",
      decision: {
        status: "ready_for_next_phase",
        recommendationKind: "start_next_phase"
      },
      hardGate: {
        requirementSatisfied: true,
        mustBlockAdvancement: false,
        rationale: "The current Phase 1 UI-only request is complete, but the next prompt should use the product-safe Phase 2 before backend."
      }
    },
    rubric: {
      must: [
        "Treat the brief Replit-style completion as enough for Phase 1.",
        "Use Phase 2 validation and confirmation before backend/database work.",
        "Avoid generic proof or quality prompts when the next phase can be inferred."
      ],
      rejectIf: [
        "The final prompt asks for backend/API/database work immediately.",
        "The final decision asks only for generic validation proof."
      ]
    }
  },
  {
    id: "validation-needed-overrides-ai-approval-request",
    title: "Validation need blocks an otherwise valid approval request",
    category: "requirement_gate",
    input: {
      promptText: "Implement Phase 1 only and stop for approval.",
      responseText: "Phase 1 is complete. I am ready for Phase 2 whenever you approve it.",
      taskFamily: "creation",
      review: {
        analysisStatus: "SUCCESS",
        confidence: "high",
        workflowState: "validation_needed",
        noRetryRecommended: true,
        decisionText: "The current step still needs visible proof.",
        recommendationText: "Validate the current step before continuing.",
        promptText: "Validate the current step before continuing."
      }
    },
    aiFixture: {
      promptVersion,
      currentStepClaim: "complete",
      nextMoveType: "approval_request",
      nextMoveSummary: "Assistant asks for approval to continue to Phase 2.",
      targetLabel: "Phase 2",
      targetPhaseNumber: 2,
      requiresApproval: true,
      suggestsImplementation: true,
      suggestsClarification: false,
      suggestsValidation: false,
      suggestsCompletion: false,
      confidenceLevel: "high"
    },
    expected: {
      interpreter: {
        currentStepClaim: "complete",
        nextMoveType: "approval_request",
        targetPhaseNumber: 2
      },
      selectedSignalSource: "ai",
      decision: {
        status: "risky",
        recommendationKind: "review_before_advancing"
      },
      hardGate: {
        requirementSatisfied: false,
        mustBlockAdvancement: true,
        rationale: "A validation-needed workflow is not satisfied enough to advance."
      }
    },
    rubric: {
      must: [
        "Respect validation_needed as a blocking review state.",
        "Ask for review or proof before advancing.",
        "Do not let a confident AI approval request bypass validation."
      ],
      rejectIf: ["The final decision starts the next phase."]
    }
  },
  {
    id: "optional-enhancement-after-complete-task",
    title: "Optional enhancement is allowed only after the current task is complete",
    category: "clear_continue",
    input: {
      promptText: "Finish the current dashboard first.",
      responseText: "The current dashboard is done. If you want, I can add Stripe checkout next.",
      taskFamily: "creation",
      review: {
        analysisStatus: "SUCCESS",
        confidence: "high",
        workflowState: "safe_to_proceed",
        noRetryRecommended: true,
        decisionText: "The current dashboard is complete.",
        recommendationText: "Continue only if you want the optional next step.",
        promptText: "Continue only if you want the optional next step."
      }
    },
    aiFixture: {
      promptVersion,
      currentStepClaim: "complete",
      nextMoveType: "optional_enhancement",
      nextMoveSummary: "Assistant offers Stripe checkout as an optional next step.",
      targetLabel: "Stripe checkout",
      targetPhaseNumber: null,
      requiresApproval: false,
      suggestsImplementation: true,
      suggestsClarification: false,
      suggestsValidation: false,
      suggestsCompletion: false,
      confidenceLevel: "high"
    },
    expected: {
      interpreter: {
        currentStepClaim: "complete",
        nextMoveType: "optional_enhancement",
        kind: "offer_optional_enhancement",
        targetLabel: "Stripe checkout"
      },
      selectedSignalSource: "ai",
      signalAgreement: "agree",
      decision: {
        status: "complete",
        recommendationKind: "continue_optional_enhancement"
      },
      hardGate: {
        requirementSatisfied: true,
        mustBlockAdvancement: false,
        rationale: "The current task is complete, so an optional follow-up is acceptable."
      }
    },
    rubric: {
      must: [
        "Classify the next action as optional, not required.",
        "Keep the final decision scoped to the optional enhancement.",
        "Avoid implying that Stripe checkout was part of the original requirement."
      ]
    }
  },
  {
    id: "optional-enhancement-blocked-when-current-task-is-partial",
    title: "Optional enhancement is blocked when the current task has missing work",
    category: "requirement_gate",
    input: {
      promptText: "Finish the dashboard export step first.",
      responseText:
        "The current dashboard works, but I still need to fix the export formatting before we move on. After that, I can add CSV download if you want.",
      taskFamily: "creation",
      review: {
        analysisStatus: "PARTIAL",
        confidence: "medium",
        workflowState: "implementation_underway",
        noRetryRecommended: false,
        decisionText: "The current export step still needs work.",
        recommendationText: "Finish the current export step before adding more.",
        promptText: "Finish the current export step before adding more."
      }
    },
    aiFixture: {
      promptVersion,
      currentStepClaim: "partial",
      nextMoveType: "optional_enhancement",
      nextMoveSummary: "Assistant offers CSV export as an optional follow-up after the current work.",
      targetLabel: "CSV export",
      targetPhaseNumber: null,
      requiresApproval: false,
      suggestsImplementation: true,
      suggestsClarification: false,
      suggestsValidation: false,
      suggestsCompletion: false,
      confidenceLevel: "high"
    },
    expected: {
      interpreter: {
        currentStepClaim: "partial",
        nextMoveType: "optional_enhancement",
        kind: "offer_optional_enhancement"
      },
      selectedSignalSource: "ai",
      decision: {
        status: "risky",
        recommendationKind: "review_before_advancing"
      },
      hardGate: {
        requirementSatisfied: false,
        mustBlockAdvancement: true,
        rationale: "The current task is partial, so optional work must not be treated as the next safe move."
      }
    },
    rubric: {
      must: [
        "Preserve the fact that the assistant offered an optional future action.",
        "Still block action on the optional future work.",
        "Point the final decision back to the current unfinished export step."
      ],
      rejectIf: ["The final decision recommends adding CSV download now."]
    }
  },
  {
    id: "low-confidence-ai-falls-back-to-local-signal",
    title: "Low-confidence AI output falls back to the local heuristic",
    category: "regression",
    input: {
      promptText: "Provide code for Phase 1 only and stop until my confirmation to start Phase 2.",
      responseText: "Phase 1 code is ready. I am ready for Phase 2.",
      taskFamily: "creation",
      review: {
        analysisStatus: "SUCCESS",
        confidence: "high",
        workflowState: "safe_to_proceed",
        noRetryRecommended: true,
        decisionText: "Nothing critical is missing.",
        recommendationText: "Continue only with the next approved step.",
        promptText: "Continue only with the next approved step."
      }
    },
    aiFixture: {
      promptVersion,
      currentStepClaim: "complete",
      nextMoveType: "unknown",
      nextMoveSummary: "The signal is too weak to interpret confidently.",
      targetLabel: null,
      targetPhaseNumber: null,
      requiresApproval: false,
      suggestsImplementation: false,
      suggestsClarification: false,
      suggestsValidation: false,
      suggestsCompletion: false,
      confidenceLevel: "low"
    },
    expected: {
      interpreter: {
        currentStepClaim: "complete",
        nextMoveType: "unknown",
        confidenceLevel: "low"
      },
      selectedSignalSource: "local_heuristic",
      signalAgreement: "disagree",
      decision: {
        status: "ready_for_next_phase",
        recommendationKind: "start_next_phase"
      },
      hardGate: {
        requirementSatisfied: true,
        mustBlockAdvancement: false,
        rationale: "The AI signal is too weak, but the current requirement is satisfied and fallback catches the phase request."
      }
    },
    rubric: {
      must: [
        "Record the low-confidence AI interpretation.",
        "Select the local heuristic instead of the low-confidence AI signal.",
        "Keep the final decision aligned to the local phase-advance signal."
      ],
      rejectIf: ["The selected signal source is AI despite low confidence."]
    }
  },
  {
    id: "direct-task-complete-with-no-follow-up",
    title: "Task complete with no assistant follow-up moves to the next user task",
    category: "clear_stop",
    input: {
      promptText: "Write the release note and stop.",
      responseText: "This is done.",
      taskFamily: "creation",
      review: {
        analysisStatus: "SUCCESS",
        confidence: "high",
        workflowState: "safe_to_proceed",
        noRetryRecommended: true,
        decisionText: "The requested release note is complete.",
        recommendationText: "No retry needed.",
        promptText: "No retry needed."
      }
    },
    aiFixture: {
      promptVersion,
      currentStepClaim: "complete",
      nextMoveType: "task_complete",
      nextMoveSummary: "Assistant indicates the current task is complete.",
      targetLabel: null,
      targetPhaseNumber: null,
      requiresApproval: false,
      suggestsImplementation: false,
      suggestsClarification: false,
      suggestsValidation: false,
      suggestsCompletion: true,
      confidenceLevel: "high"
    },
    expected: {
      interpreter: {
        currentStepClaim: "complete",
        nextMoveType: "task_complete",
        kind: "task_complete",
        suggestsCompletion: true
      },
      selectedSignalSource: "ai",
      decision: {
        status: "complete",
        recommendationKind: "move_to_next_task"
      },
      hardGate: {
        requirementSatisfied: true,
        mustBlockAdvancement: false,
        rationale: "The requested task is satisfied and there is no next implementation step to run."
      }
    },
    rubric: {
      must: [
        "Treat the assistant answer as terminal for the current task.",
        "Move the user back to choosing their next task.",
        "Avoid inventing a follow-up action."
      ]
    }
  },
  {
    id: "format-miss-requires-revision",
    title: "Missing requested format requires a revision",
    category: "revise_retry",
    input: {
      promptText: "Give me exactly three bullets and no intro.",
      responseText: "Here is a quick summary:\n- First point\n- Second point",
      taskFamily: "analysis",
      review: {
        analysisStatus: "FAILED",
        confidence: "high",
        workflowState: "implementation_underway",
        noRetryRecommended: false,
        decisionText: "The answer misses the exact three-bullet output requirement.",
        recommendationText: "Finish the missing requirements first.",
        promptText: "Finish the missing requirements first."
      }
    },
    aiFixture: {
      promptVersion,
      currentStepClaim: "unclear",
      nextMoveType: "task_complete",
      nextMoveSummary: "Assistant presents the answer as complete.",
      targetLabel: null,
      targetPhaseNumber: null,
      requiresApproval: false,
      suggestsImplementation: false,
      suggestsClarification: false,
      suggestsValidation: false,
      suggestsCompletion: true,
      confidenceLevel: "medium"
    },
    expected: {
      interpreter: {
        currentStepClaim: "unclear",
        nextMoveType: "task_complete"
      },
      selectedSignalSource: "ai",
      decision: {
        status: "incomplete",
        recommendationKind: "finish_missing_requirements"
      },
      hardGate: {
        requirementSatisfied: false,
        mustBlockAdvancement: true,
        rationale: "The requested output format is not satisfied, so completion language must not end the task."
      }
    },
    rubric: {
      must: [
        "Separate the assistant's completion claim from actual requirement satisfaction.",
        "Require revision for the missing bullet and disallowed intro.",
        "Do not mark the task complete based only on assistant confidence."
      ],
      rejectIf: ["The final decision is move_to_next_task."]
    }
  },
  {
    id: "clarification-request-when-product-decision-is-blocked",
    title: "Blocked product decision asks the user to clarify",
    category: "ambiguous_low_confidence",
    input: {
      promptText: "Build the onboarding flow, but choose the safest auth provider.",
      responseText:
        "I can implement this with Clerk or Supabase Auth. Which provider do you want me to use before I wire the flow?",
      taskFamily: "creation",
      review: {
        analysisStatus: "WRONG_DIRECTION",
        confidence: "medium",
        workflowState: "blocked",
        noRetryRecommended: false,
        decisionText: "The next implementation step depends on an unresolved product decision.",
        recommendationText: "Clarify the auth provider before building more.",
        promptText: "Clarify the auth provider before building more."
      }
    },
    aiFixture: {
      promptVersion,
      currentStepClaim: "partial",
      nextMoveType: "clarification_request",
      nextMoveSummary: "Assistant asks the user to choose an auth provider.",
      targetLabel: "auth provider",
      targetPhaseNumber: null,
      requiresApproval: false,
      suggestsImplementation: false,
      suggestsClarification: true,
      suggestsValidation: false,
      suggestsCompletion: false,
      confidenceLevel: "high"
    },
    expected: {
      interpreter: {
        currentStepClaim: "partial",
        nextMoveType: "clarification_request",
        kind: "clarify_decision",
        suggestsClarification: true
      },
      selectedSignalSource: "ai",
      decision: {
        status: "blocked",
        recommendationKind: "clarify_product_decision"
      },
      hardGate: {
        requirementSatisfied: false,
        mustBlockAdvancement: true,
        rationale: "The user decision is unresolved, so implementation must pause."
      }
    },
    rubric: {
      must: [
        "Classify the assistant's question as clarification.",
        "Keep the final decision blocked.",
        "Ask for the product decision before additional implementation."
      ]
    }
  },
  {
    id: "validation-request-before-moving-on",
    title: "Assistant validation request leads to review before advancing",
    category: "clear_continue",
    input: {
      promptText: "Ship this fix and tell me what to validate next.",
      responseText: "The fix is in. Before moving on, please verify it in the browser.",
      taskFamily: "coding",
      review: {
        analysisStatus: "SUCCESS",
        confidence: "high",
        workflowState: "validation_needed",
        noRetryRecommended: true,
        decisionText: "The fix exists but needs visible validation.",
        recommendationText: "Validate the current step with concrete proof first.",
        promptText: "Validate the current step with concrete proof first."
      }
    },
    aiFixture: {
      promptVersion,
      currentStepClaim: "complete",
      nextMoveType: "validation_request",
      nextMoveSummary: "Assistant wants browser verification before continuing.",
      targetLabel: null,
      targetPhaseNumber: null,
      requiresApproval: false,
      suggestsImplementation: false,
      suggestsClarification: false,
      suggestsValidation: true,
      suggestsCompletion: false,
      confidenceLevel: "medium"
    },
    expected: {
      interpreter: {
        currentStepClaim: "complete",
        nextMoveType: "validation_request",
        kind: "validate_or_test",
        suggestsValidation: true
      },
      selectedSignalSource: "ai",
      decision: {
        status: "risky",
        recommendationKind: "review_before_advancing"
      },
      hardGate: {
        requirementSatisfied: false,
        mustBlockAdvancement: true,
        rationale: "Validation is still required, so the final decision must stay in review mode."
      }
    },
    rubric: {
      must: [
        "Recognize validation language.",
        "Avoid starting another implementation step before verification.",
        "Preserve the requested proof/checking action."
      ]
    }
  },
  {
    id: "replit-crm-cannot-move-to-analytics-before-saving-data",
    title: "Replit CRM blocks analytics when customer saving is not implemented",
    category: "requirement_gate",
    input: {
      promptText: "In Replit, build a simple CRM where I can add customers and save them.",
      responseText:
        "The CRM screen is ready with the customer form and list. Saving to the database still needs wiring, but if you want I can add analytics next.",
      taskFamily: "coding",
      review: {
        analysisStatus: "PARTIAL",
        confidence: "high",
        workflowState: "implementation_underway",
        noRetryRecommended: false,
        decisionText: "The CRM UI exists, but customers are not actually saved.",
        recommendationText: "Finish the missing data-saving requirement before adding analytics.",
        promptText: "Finish the missing data-saving requirement before adding analytics."
      }
    },
    aiFixture: {
      promptVersion,
      currentStepClaim: "partial",
      nextMoveType: "optional_enhancement",
      nextMoveSummary: "Assistant offers analytics as an optional follow-up while database saving is unfinished.",
      targetLabel: "analytics",
      targetPhaseNumber: null,
      requiresApproval: false,
      suggestsImplementation: true,
      suggestsClarification: false,
      suggestsValidation: false,
      suggestsCompletion: false,
      confidenceLevel: "high"
    },
    expected: {
      interpreter: {
        currentStepClaim: "partial",
        nextMoveType: "optional_enhancement",
        kind: "offer_optional_enhancement",
        targetLabel: "analytics"
      },
      selectedSignalSource: "ai",
      decision: {
        status: "risky",
        recommendationKind: "review_before_advancing"
      },
      hardGate: {
        requirementSatisfied: false,
        mustBlockAdvancement: true,
        rationale: "A CRM that cannot save customers is not complete enough for optional analytics."
      }
    },
    rubric: {
      must: [
        "Protect the non-technical user's original save-data requirement.",
        "Treat analytics as optional future work, not the next safe step.",
        "Block progress until customer persistence is implemented or validated."
      ],
      rejectIf: ["The final decision recommends adding analytics now."]
    }
  },
  {
    id: "lovable-booking-page-submit-button-must-work-before-polish",
    title: "Lovable booking page blocks polish when booking submission is broken",
    category: "requirement_gate",
    input: {
      promptText: "In Lovable, create a booking page where customers can choose a time and submit a booking.",
      responseText:
        "The booking page design is complete. The submit action is still a placeholder, and I can add animations next if you want.",
      taskFamily: "creation",
      review: {
        analysisStatus: "PARTIAL",
        confidence: "high",
        workflowState: "implementation_underway",
        noRetryRecommended: false,
        decisionText: "The page looks designed, but the booking submission does not actually work.",
        recommendationText: "Finish the missing submit-booking requirement before visual polish.",
        promptText: "Finish the missing submit-booking requirement before visual polish."
      }
    },
    aiFixture: {
      promptVersion,
      currentStepClaim: "partial",
      nextMoveType: "optional_enhancement",
      nextMoveSummary: "Assistant offers animations even though the submit action is unfinished.",
      targetLabel: "animations",
      targetPhaseNumber: null,
      requiresApproval: false,
      suggestsImplementation: true,
      suggestsClarification: false,
      suggestsValidation: false,
      suggestsCompletion: false,
      confidenceLevel: "high"
    },
    expected: {
      interpreter: {
        currentStepClaim: "partial",
        nextMoveType: "optional_enhancement",
        kind: "offer_optional_enhancement",
        targetLabel: "animations"
      },
      selectedSignalSource: "ai",
      decision: {
        status: "risky",
        recommendationKind: "review_before_advancing"
      },
      hardGate: {
        requirementSatisfied: false,
        mustBlockAdvancement: true,
        rationale: "The core booking flow is not satisfied if the submit action is a placeholder."
      }
    },
    rubric: {
      must: [
        "Prioritize working booking submission over visual polish.",
        "Warn that the page being visually complete is not enough.",
        "Keep the user on the broken core action."
      ],
      rejectIf: ["The final decision recommends animations before submit works."]
    }
  },
  {
    id: "replit-deploy-blocked-until-browser-validation",
    title: "Replit deployment is blocked until the app is validated in browser",
    category: "requirement_gate",
    input: {
      promptText: "Build and test the waitlist app in Replit before we deploy it.",
      responseText: "The waitlist app is done. I am ready to deploy it whenever you approve.",
      taskFamily: "coding",
      review: {
        analysisStatus: "SUCCESS",
        confidence: "high",
        workflowState: "validation_needed",
        noRetryRecommended: true,
        decisionText: "The app has not shown browser validation or test proof yet.",
        recommendationText: "Validate the waitlist signup flow in the browser before deployment.",
        promptText: "Validate the waitlist signup flow in the browser before deployment."
      }
    },
    aiFixture: {
      promptVersion,
      currentStepClaim: "complete",
      nextMoveType: "approval_request",
      nextMoveSummary: "Assistant says the app is done and asks for approval to deploy.",
      targetLabel: "deployment",
      targetPhaseNumber: null,
      requiresApproval: true,
      suggestsImplementation: true,
      suggestsClarification: false,
      suggestsValidation: false,
      suggestsCompletion: false,
      confidenceLevel: "high"
    },
    expected: {
      interpreter: {
        currentStepClaim: "complete",
        nextMoveType: "approval_request",
        requiresApproval: true,
        targetLabel: "deployment"
      },
      selectedSignalSource: "ai",
      decision: {
        status: "risky",
        recommendationKind: "review_before_advancing"
      },
      hardGate: {
        requirementSatisfied: false,
        mustBlockAdvancement: true,
        rationale: "The user explicitly asked to test before deploy, and validation proof is missing."
      }
    },
    rubric: {
      must: [
        "Recognize deploy as an advancement step.",
        "Block deployment until validation proof exists.",
        "Protect non-technical users from launching untested work."
      ],
      rejectIf: ["The final decision allows deployment."]
    }
  },
  {
    id: "lovable-supabase-table-choice-requires-clarification",
    title: "Lovable Supabase form pauses for a table choice",
    category: "ambiguous_low_confidence",
    input: {
      promptText: "Connect this Lovable contact form to Supabase so every submission is saved.",
      responseText:
        "I can connect the form, but I need to know whether submissions should go into the leads table or the contacts table first.",
      taskFamily: "creation",
      review: {
        analysisStatus: "WRONG_DIRECTION",
        confidence: "medium",
        workflowState: "blocked",
        noRetryRecommended: false,
        decisionText: "The Supabase destination table is an unresolved product/data decision.",
        recommendationText: "Clarify which Supabase table should store form submissions before building more.",
        promptText: "Clarify which Supabase table should store form submissions before building more."
      }
    },
    aiFixture: {
      promptVersion,
      currentStepClaim: "partial",
      nextMoveType: "clarification_request",
      nextMoveSummary: "Assistant asks the user to choose the Supabase table for saved submissions.",
      targetLabel: "Supabase table",
      targetPhaseNumber: null,
      requiresApproval: false,
      suggestsImplementation: false,
      suggestsClarification: true,
      suggestsValidation: false,
      suggestsCompletion: false,
      confidenceLevel: "high"
    },
    expected: {
      interpreter: {
        currentStepClaim: "partial",
        nextMoveType: "clarification_request",
        kind: "clarify_decision",
        suggestsClarification: true
      },
      selectedSignalSource: "ai",
      decision: {
        status: "blocked",
        recommendationKind: "clarify_product_decision"
      },
      hardGate: {
        requirementSatisfied: false,
        mustBlockAdvancement: true,
        rationale: "The app cannot safely save submissions until the destination table is chosen."
      }
    },
    rubric: {
      must: [
        "Treat the table choice as a required user decision.",
        "Avoid guessing data storage behavior for a non-technical user.",
        "Keep implementation paused until the destination is clear."
      ]
    }
  },
  {
    id: "launch-readiness-claim-needs-proof-for-auth-payments-and-saving",
    title: "Launch readiness claim requires proof for critical user flows",
    category: "requirement_gate",
    input: {
      promptText: "Can I launch this app? Please make sure login, payments, and saved user data work first.",
      responseText: "Everything looks good. You can launch now.",
      taskFamily: "coding",
      review: {
        analysisStatus: "SUCCESS",
        confidence: "medium",
        workflowState: "validation_needed",
        noRetryRecommended: true,
        decisionText: "Launch-critical flows need proof before the user can trust the launch recommendation.",
        recommendationText: "Validate login, payments, and saved user data before launch.",
        promptText: "Validate login, payments, and saved user data before launch."
      }
    },
    aiFixture: {
      promptVersion,
      currentStepClaim: "complete",
      nextMoveType: "task_complete",
      nextMoveSummary: "Assistant claims the app is ready to launch.",
      targetLabel: null,
      targetPhaseNumber: null,
      requiresApproval: false,
      suggestsImplementation: false,
      suggestsClarification: false,
      suggestsValidation: false,
      suggestsCompletion: true,
      confidenceLevel: "medium"
    },
    expected: {
      interpreter: {
        currentStepClaim: "complete",
        nextMoveType: "task_complete",
        suggestsCompletion: true
      },
      selectedSignalSource: "ai",
      decision: {
        status: "risky",
        recommendationKind: "review_before_advancing"
      },
      hardGate: {
        requirementSatisfied: false,
        mustBlockAdvancement: true,
        rationale: "Launch readiness requires validation proof for critical flows, not just a completion claim."
      }
    },
    rubric: {
      must: [
        "Do not let launch readiness depend only on the assistant's claim.",
        "Require proof for login, payments, and saved data.",
        "Keep the recommendation in validation mode before launch."
      ],
      rejectIf: ["The final decision tells the user the app is safe to launch."]
    }
  },
  {
    id: "stripe-checkout-ui-is-not-payment-readiness",
    title: "Stripe checkout UI is not enough when payment processing is missing",
    category: "requirement_gate",
    input: {
      promptText: "Add Stripe checkout to my Replit app so customers can pay for the subscription.",
      responseText:
        "The checkout page UI is built. Payment processing still needs the Stripe session endpoint, and I can add coupon codes next.",
      taskFamily: "coding",
      review: {
        analysisStatus: "PARTIAL",
        confidence: "high",
        workflowState: "implementation_underway",
        noRetryRecommended: false,
        decisionText: "The payment UI exists, but Stripe session creation and payment processing are missing.",
        recommendationText: "Finish the missing Stripe payment processing requirement before coupon codes.",
        promptText: "Finish the missing Stripe payment processing requirement before coupon codes."
      }
    },
    aiFixture: {
      promptVersion,
      currentStepClaim: "partial",
      nextMoveType: "optional_enhancement",
      nextMoveSummary: "Assistant offers coupon codes while the Stripe payment flow is incomplete.",
      targetLabel: "coupon codes",
      targetPhaseNumber: null,
      requiresApproval: false,
      suggestsImplementation: true,
      suggestsClarification: false,
      suggestsValidation: false,
      suggestsCompletion: false,
      confidenceLevel: "high"
    },
    expected: {
      interpreter: {
        currentStepClaim: "partial",
        nextMoveType: "optional_enhancement",
        kind: "offer_optional_enhancement",
        targetLabel: "coupon codes"
      },
      selectedSignalSource: "ai",
      decision: {
        status: "risky",
        recommendationKind: "review_before_advancing"
      },
      hardGate: {
        requirementSatisfied: false,
        mustBlockAdvancement: true,
        rationale: "A checkout page is not payment readiness if Stripe session processing is missing."
      }
    },
    rubric: {
      must: [
        "Distinguish payment UI from real payment processing.",
        "Block coupon-code work until subscription payment works.",
        "Protect users from thinking payments are ready because a page exists."
      ],
      rejectIf: ["The final decision recommends coupon codes now."]
    }
  },
  {
    id: "lovable-mobile-layout-miss-requires-fix-before-completion",
    title: "Lovable mobile layout miss requires a fix before calling the page done",
    category: "revise_retry",
    input: {
      promptText: "Make the landing page match my screenshot and work well on mobile.",
      responseText: "The landing page is done and matches the screenshot.",
      taskFamily: "creation",
      review: {
        analysisStatus: "FAILED",
        confidence: "high",
        workflowState: "implementation_underway",
        noRetryRecommended: false,
        decisionText: "The desktop layout is close, but the mobile layout overlaps and does not satisfy the requirement.",
        recommendationText: "Finish the missing mobile responsiveness requirement first.",
        promptText: "Finish the missing mobile responsiveness requirement first."
      }
    },
    aiFixture: {
      promptVersion,
      currentStepClaim: "complete",
      nextMoveType: "task_complete",
      nextMoveSummary: "Assistant claims the landing page is done.",
      targetLabel: null,
      targetPhaseNumber: null,
      requiresApproval: false,
      suggestsImplementation: false,
      suggestsClarification: false,
      suggestsValidation: false,
      suggestsCompletion: true,
      confidenceLevel: "high"
    },
    expected: {
      interpreter: {
        currentStepClaim: "complete",
        nextMoveType: "task_complete",
        suggestsCompletion: true
      },
      selectedSignalSource: "ai",
      decision: {
        status: "incomplete",
        recommendationKind: "finish_missing_requirements"
      },
      hardGate: {
        requirementSatisfied: false,
        mustBlockAdvancement: true,
        rationale: "The mobile requirement is not satisfied even if the assistant says the page is done."
      }
    },
    rubric: {
      must: [
        "Catch that screenshot matching on desktop is not enough.",
        "Require the mobile layout issue to be fixed.",
        "Override the assistant's completion claim with the review result."
      ],
      rejectIf: ["The final decision moves to the next task."]
    }
  },
  {
    id: "replit-broken-primary-button-keeps-user-on-current-step",
    title: "Broken primary button keeps Replit user on the current step",
    category: "clear_continue",
    input: {
      promptText: "Fix the dashboard so the Add Project button opens the create-project form.",
      responseText:
        "I found the Add Project button handler is still disconnected. Next, I need to wire it to open the create-project form.",
      taskFamily: "coding",
      review: {
        analysisStatus: "PARTIAL",
        confidence: "high",
        workflowState: "implementation_underway",
        noRetryRecommended: false,
        decisionText: "The broken primary button is still not fixed.",
        recommendationText: "Finish wiring the Add Project button before moving on.",
        promptText: "Finish wiring the Add Project button before moving on."
      }
    },
    aiFixture: {
      promptVersion,
      currentStepClaim: "partial",
      nextMoveType: "continuation_offer",
      nextMoveSummary: "Assistant says it needs to continue wiring the current button behavior.",
      targetLabel: "create-project form",
      targetPhaseNumber: null,
      requiresApproval: false,
      suggestsImplementation: true,
      suggestsClarification: false,
      suggestsValidation: false,
      suggestsCompletion: false,
      confidenceLevel: "high"
    },
    expected: {
      interpreter: {
        currentStepClaim: "partial",
        nextMoveType: "continuation_offer",
        kind: "continue_current_work",
        targetLabel: "create-project form"
      },
      selectedSignalSource: "ai",
      decision: {
        status: "incomplete",
        recommendationKind: "finish_missing_requirements"
      },
      hardGate: {
        requirementSatisfied: false,
        mustBlockAdvancement: true,
        rationale: "The user's requested button behavior is still broken, so current work must continue."
      }
    },
    rubric: {
      must: [
        "Recognize that the assistant is continuing the current fix, not starting optional work.",
        "Keep the next move focused on the broken primary button.",
        "Avoid telling the user the dashboard is complete."
      ]
    }
  }
] as const satisfies readonly NextMoveEvalCase[]

export function getNextMoveEvalCases() {
  return NEXT_MOVE_EVAL_CASES
}
