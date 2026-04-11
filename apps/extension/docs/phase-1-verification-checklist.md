# Phase 1 Verification Checklist

This checklist validates the Phase 1 architecture goal:

- shared AFTER + empty-chat optimization core
- thin surface adapters for ChatGPT and Replit
- extension shell acting mainly as UI wiring

## ChatGPT

1. Real answer analysis opens
   - Open a ChatGPT thread with a visible assistant answer.
   - Click `⚡`.
   - Expect AFTER to open, show staged loading, and produce a verdict for the latest answer.

2. Reopen without re-analysis
   - Close AFTER.
   - Click `⚡` again without a new answer.
   - Expect the saved result to reopen immediately.

3. New answer replaces old analysis
   - Send a new prompt and wait for a new assistant answer.
   - Click `⚡`.
   - Expect the new answer to be analyzed, not the previous one.

4. No stale leak across chats
   - Open AFTER in Chat A.
   - Navigate to Chat B.
   - Click `⚡`.
   - Expect no old verdict or old next-step questions from Chat A.

5. Empty chat, no typed prompt
   - Open a new chat with no answer and no draft text.
   - Click `⚡`.
   - Expect `No answer yet` and `Let's Optimize Your Prompt`.

6. Empty chat, typed-but-unsent prompt
   - Type a prompt without sending it.
   - Click `⚡`.
   - Expect planner mode with no fake answer analysis.
   - Expect the draft prompt to seed the next-step flow.

7. Prompt write-back
   - Generate a next prompt in AFTER.
   - Click `Submit Prompt`.
   - Expect the drafted prompt to be inserted into the host prompt input with line breaks preserved.

## Replit

1. Real answer analysis opens
   - Open a Replit agent/chat page with a visible assistant answer.
   - Click `⚡`.
   - Expect AFTER to open, show staged loading, and produce a verdict for the latest answer.

2. Reopen without re-analysis
   - Close AFTER.
   - Click `⚡` again without a new answer.
   - Expect the saved result to reopen immediately.

3. New answer replaces old analysis
   - Send a new prompt and wait for a new assistant answer.
   - Click `⚡`.
   - Expect the new answer to be analyzed, not the previous one.

4. No stale leak across projects/threads
   - Open AFTER in one Replit thread/project.
   - Navigate to another Replit thread/project.
   - Click `⚡`.
   - Expect no old verdict or old next-step questions from the previous page.

5. Empty chat, no typed prompt
   - Open a page with no answer and no draft text.
   - Click `⚡`.
   - Expect `No answer yet` and `Let's Optimize Your Prompt`.

6. Empty chat, typed-but-unsent prompt
   - Type a prompt without sending it.
   - Click `⚡`.
   - Expect planner mode with no fake answer analysis.
   - Expect the draft prompt to seed the next-step flow.

7. Prompt write-back
   - Generate a next prompt in AFTER.
   - Click `Submit Prompt`.
   - Expect the drafted prompt to be inserted into the host prompt input with line breaks preserved.

## Planner Flow (both surfaces)

1. Suggested chips
   - Start next-step planning on a verdict with unmet criteria.
   - Click a suggestion chip.
   - Expect the chip to rewrite into the direction box, show a toast, and disappear.

2. Question branching
   - Answer several decision-tree questions.
   - Change an earlier answer.
   - Expect downstream questions to be pruned and regenerated from the new branch.

3. Other answer path
   - Choose `Other`, type a custom answer, click `Submit`.
   - Expect loading near the question index row and automatic movement to the next generated question.

4. Generate next prompt
   - Answer at least one planning question.
   - Click `Generate Next Prompt`.
   - Expect a structured next prompt and auto-scroll to that section.

## Completion rule

Phase 1 is verified only when:

- all ChatGPT checks pass
- all Replit checks pass
- all shared planner-flow checks pass
