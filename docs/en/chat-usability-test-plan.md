# Chat panel product usability test plan

## Purpose and method

Test whether a user can complete work in the Chat panel. Use actual browser buttons, typing, pasting, menus and keyboard actions, and inspect visible results. Do not replace user actions with store mutations or equate passing automated checks with a usable product.

The test page runs the application frontend with isolated conversations. Since a browser lacks the desktop IPC bridge, the page simulates database, file and model responses. Real provider networking, system file dialogs, SSH execution and desktop database integration require separate validation.

For each case record steps, actual outcome, pass/fail/limited status, screenshots or visible evidence, findings and the result after a fix. Add necessary regression coverage after identifying a problem.

## Sequence and acceptance criteria

| ID | User workflow | Boundary | Acceptance |
| --- | --- | --- | --- |
| C01 | Open the panel, type a question, click Send and read the reply | New discussion without a terminal | One readable exchange; cleared input; terminal untouched |
| C02 | Send three successive messages | Mix Send and Enter | Correct ordering; further sends work; no duplicates or lost history |
| C03 | Attempt to send empty text, spaces and newlines | No attachments or references | No empty message; send state reflects available content |
| C04 | Compose multiple lines using Shift+Enter, Enter and Esc | Chinese/English input and multiline drafts | Newline and submission remain distinct; composition confirmation does not send |
| C05 | Inspect hints for title, history, new, attachment, mode, model, send and message actions | Pointer and keyboard focus near panel edges | Accurate complete hints, sufficient focus padding and reachable controls |
| C06 | Regenerate the latest reply | Completed or failed reply | Only the answer changes; no duplicate question; busy state ends |
| C07 | Regenerate the first reply, switch conversations and reload | Two later exchanges | Replacement remains paired with its question; later exchanges stay intact |
| C08 | Edit the latest question: cancel, then confirm, modify and send | Existing unsent draft | Cancel retains data; replacement warning is explicit; confirmed editing focuses input |
| C09 | Edit the first question | Later questions, replies and attachments | Clear removal scope; original question and context restore correctly |
| C10 | Navigate message menus and confirmations with the keyboard | Esc, Tab, arrows and Enter | Can dismiss; appropriate focus restoration; cancellation does not mutate data |
| C11 | Copy a reply and a code block | Markdown, code and tool output | Clipboard matches the selected content without omissions |
| C12 | Cancel and confirm deletion of a test exchange | First, last or only exchange | Cancel leaves data; confirm affects only the selected exchange; reload agrees |
| C13 | Paste long text, preview, dismiss, remove and send | Attachment-only or text plus attachment | Correct placement and preview; persisted context; cleared sent attachments |
| C14 | Add images and files | Multiple files, duplicate names and cancellation | Correct previews, counts and removal; cancellation retains existing attachments |
| C15 | Edit and resend a question with attachments | Images, pasted text and terminal references | Context restores without crossing conversations and remains readable |
| C16 | Wait for a slow response, compose the next draft and stop | Before output and after partial output | Stop remains reachable; busy state ends; next draft survives; sending resumes |
| C17 | Simulate a connection failure and retry | Empty or partial failed answer | Understandable error; recovery path; no perpetual busy state or duplicate question |
| C18 | Read earlier portions of a long streaming answer and return to latest | More than one screen, code and lists | Reading position stays stable; latest action is available and restores follow |
| C19 | Search, select and cancel model changes | Long names, narrow panel and mid-conversation change | Selection is clear; cancel preserves it; drafts/history survive; no overflow |
| C20 | Inspect four chat/approval choices and explanations | Keyboard, narrow layout and per-model overrides | Selection and explanation agree; compact menu; safe semantics unchanged |
| C21 | Create two conversations, search history and switch between them | Separate drafts and attachments | Independent messages/drafts; direct history entry; no cross-conversation overwrite |
| C22 | Rename a conversation, find it in history and reload | Empty/long title and cancel | Clear naming behavior; navigation remains visible; restored name agrees |
| C23 | Close/reopen the panel and reload | Unsent draft, messages and attachments | Panel toggling retains content; reload behavior matches product promises |
| C24 | Select a terminal, change workspace and close the selected terminal | Discussion, disconnection and another live terminal | No silent retargeting; clear disconnection; discussion remains usable |
| C25 | Inspect tool execution and approval results | Running, pending approval, failed and stopped | Readable state/results without extra words: a success stays quiet (no state word and no exit code), a failure shows its red error box, and running, awaiting approval and denied stay labelled; a failure opens expanded and can be collapsed again from its row; reachable actions; plain assistant content |
| C26 | Resize the panel/window and increase UI font size | 180/320/480px panel, 720px window, 150% font | No offscreen controls; sensible truncation; usable dialogs and menus |
| C27 | Switch conversations during send, regenerate or editing | Other draft and background request | Clear working-conversation indicator; actions target the correct conversation |
| C28 | Inspect persistence errors and retry saving | Question, answer or deletion save failure | Retained in-memory content; clear error; reload agrees after successful retry |

## Findings so far

1. Regenerating an earlier answer moved it after subsequent messages on reload: reproduced in the browser; the repaired regenerate/reload workflow has been exercised again.
2. Editing did not explicitly warn that an unsent draft would be replaced: warning added; cancellation retaining the draft has been exercised.
3. Input focus after confirmed editing and trigger focus after cancellation remain under verification.

## Completion

Record case results and evidence, fix confirmed problems and repeat complete affected workflows. Run necessary unit and E2E regressions. Distinguish verified, fixed and environment-limited items in the report; do not describe untested functionality as working.
