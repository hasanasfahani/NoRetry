# Next Move v2 Manual QA

Use this checklist on a supported AI assistant page with the extension loaded.

## Flow A: Small Feature

1. Type `add a wishlist so couples can save gift ideas` in the assistant prompt box.
2. Click the reeva AI extension icon.
3. Confirm the popup opens in Next Move mode and shows the four options.
4. Select `New small feature`.
5. Confirm the path opens as a decision-tree page with one active question, numbered question tabs, and multiple-choice options.
6. Confirm the typed draft appears only as context, not as a prefilled answer.
7. Answer each question by selecting an option. Use `Other` only when custom detail is needed.
8. Confirm `Generate New Prompt` remains disabled until all questions are answered.
9. Click `Generate New Prompt`.
10. Confirm a generated prompt appears before copying.
11. Click `Copy Prompt`.
12. Paste it into the assistant composer and send it manually.

Expected result: the prompt is scoped to one small feature and protects the existing MVP.

## Flow B: Bug Fix

1. Type `the register button does nothing after I fill the form`.
2. Click the extension icon.
3. Select `Fix bug`.
4. Confirm the bug page uses the same one-question-at-a-time multiple-choice flow.
5. Select options for bug type, reproducibility, expected behavior, actual behavior, location, and evidence.
6. Click `Generate New Prompt`.
7. Confirm the generated prompt asks for a bug fix only and requests root cause, files changed, verification, and risks.
8. Copy the prompt, paste it into the assistant composer, and send it manually.

Expected result: the prompt does not request unrelated redesign, backend, auth, payments, or architecture changes.

## Flow C: Stale State

1. Start `New small feature`, fill answers, and click `Generate New Prompt`.
2. Before or after the prompt appears, edit any answer.
3. Confirm the generated prompt clears.
4. Click back, choose another path, and confirm old answers are not carried into the new path.
5. Close the popup, type a different draft, reopen the extension, and confirm no previous path/answers remain selected.

Expected result: stale generated prompts, selected paths, and answers do not leak across edits or sessions.

## Flow D: Deep Analysis Return

1. Copy a generated Next Move prompt, paste it into the assistant composer, and send it manually.
2. Wait for the assistant answer.
3. Click the extension icon again.
4. Confirm it opens the normal Deep Analysis review UI, not the previous Next Move form.

Expected result: after an assistant answer exists, the extension reviews the answer instead of staying inside the previous prompt form.

## QA Result Log

Record each live run here before opening a fix pass.

| Flow | Status | Notes | Fix needed |
| --- | --- | --- | --- |
| Small Feature | Not run |  |  |
| Bug Fix | Not run |  |  |
| Stale State | Not run |  |  |
| Deep Analysis Return | Not run |  |  |

Use `Pass`, `Fail`, or `Blocked` for status. If a flow fails, capture the exact option selected, the typed draft, what appeared in the popup, and whether the generated prompt was stale, missing, or incorrectly scoped.
