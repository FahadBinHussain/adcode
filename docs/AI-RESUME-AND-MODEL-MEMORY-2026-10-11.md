# Included AI limit recovery and model switching

Included AI chats and agent runs now keep their pending provider request inside the
current turn when the server returns a recoverable daily, account-minute or provider
rate limit. The waiting message shows the reset/retry time and says the task resumes
automatically. The existing Stop button cancels the wait immediately. No extra user
message is required when the allowance resets, and completed tool operations are not
replayed. The daily allowance remains one million tokens with unlimited requests.

The client respects the server's absolute reset time and Retry-After header. The wait
checks wall time at least once per minute, including after a computer wakes from sleep.
Each resumed call refreshes authentication; switching the signed-in account stops the
old task before another request is sent. Waiting uses local timers rather than an open
server stream, so it holds no server token reservation. Repeated temporary limits keep
waiting until accepted or cancelled. Requests larger than the entire configured daily
allowance and accounts with zero request allowance are marked non-recoverable and
explain the action needed. Partial model output and unrelated errors are not replayed.

Automatic resumption requires ADCode to remain running. Closing the app ends the wait.
Changing folders cancels the pending task. Starting a new chat or reopening another
chat cancels any queued model-switch continuation; the old turn is saved to its original
conversation and workspace.
Completion suggestions, inline edit previews and connection checks do not wait overnight.

## Model memory

Switching models or providers now carries the live conversation, current compacted
summary, completed tool calls and results to the new model. Previously, another provider
received the saved text and summary but could lose the live tool history. Provider-specific
reasoning metadata is removed from the handoff. Changing or checking keys no longer drops
the remembered conversation. Starting a new conversation or opening a different saved chat
clears the previous live history as before.

Changing the selected model cancels the old provider's pending request or limit wait.
Choosing another model from the chat's model picker during a limit wait automatically
continues the waiting task with the transferred conversation. Stop also cancels queued
attempts to continue while the previous turn finishes.

## Validation

160 targeted tests passed, including:

- The actual desktop provider, agent and server relay crossed midnight: one completed
  file edit, a daily rejection, automatic continuation and one successful next-day reply.
  The edit ran once and the next day's exact reported usage settled with no held tokens.
- A full-day wait, repeated provider limits, exact reset timing, HTTP-date headers,
  computer sleep, immediate cancellation, no partial-output replay and non-recoverable
  errors were checked with controlled time.
- The new provider's actual request contains the original user task and completed tool
  results. Summaries survive handoff; the old provider's reasoning metadata does not.
- Chromium checked the waiting message, model-picker continuation, Stop cancellation,
  existing composer controls and narrow layouts. The usage dialog's 26 checks also pass.
- Existing request scheduling, conversations, agent behaviour, account-limit accounting
  and error recovery passed. Type checks and dependency boundaries pass.

## Deployment verification

- The final desktop build succeeded on 11 October 2026. `adcode open` resolves to this
  checkout through the existing npm junction. Fully quit and reopen ADCode to load the
  rebuilt app. This does not publish a new public installer.
- The website/API deployment succeeded: Cloudflare Worker version
  `8b290ebb-9174-43a0-94eb-3f617a128c7c` on `adcode.bluethenics.com`.
- A live, authenticated request whose estimated input fit the model's context but
  exceeded the remaining daily balance returned `429 daily-limit`, `retryable: true`,
  the account's exact reset timestamp and a valid Retry-After header. No request, input,
  output, cost or held-token balance changed. Verification request ID:
  `48d52195-ca79-4d47-9d0f-71a40798a900`.
- All 160 targeted tests and all three TypeScript checks passed against the final
  desktop changes. Chromium now also checks cancellation when changing folders.
