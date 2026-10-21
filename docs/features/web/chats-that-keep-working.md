---
slug: chats-that-keep-working
title: Chats that keep working
description: Run several chats at once, leave them working in the background, and read each answer as a timeline of thoughts, tool calls and the work that produced it.
section: The assistant
published: 2026-10-20
order: 5
related: helpers, whats-new-october-2026, workbench-vibe-sidebar
---

# Chats that keep working

A chat is a piece of work, not a window you have to keep in front. Start a long job, open another conversation, and the first one carries on. Up to four chats can work at once, each with its own answer, history and record of changes.

## Work in more than one chat

Send a message, then open another conversation or press + New and send there too. ADCode runs up to four chats at once. With Review every change turned on, it runs one at a time, because each chat stages edits in its own copy of the project.

Each chat keeps its own conversation, queued messages and Undo card. A follow-up typed in one waits for that chat, not for whichever conversation is on screen.

The chat list shows what is happening, and a working chat's tab also carries a spinner: a spinner means working, a green dot means it finished while you were elsewhere, and an amber dot means it stopped before it was done. Each mark stays until you open the chat.

## Open a working chat

Open a working chat and you see the timeline so far, then watch it continue live. Stop stops only the chat on screen; other chats keep working.

A message typed into a working chat queues above the composer and sends when that chat's turn ends, even if you leave. Send now stops the current turn and sends at once, for when the new instruction replaces the old one.

## Leave the app

Minimise ADCode or switch to another program and the work continues. While any chat works, ADCode asks the operating system not to suspend it. The screen may turn off, but the turn carries on.

When a chat finishes while every ADCode window is in the background, a system notification says Chat finished, Chat needs you or Chat stopped, with the chat's title; selecting it brings ADCode back. If a window is focused, the chat list shows the result instead. Notifications depend on operating-system permission.

Closing ADCode ends the work. Minimising is safe; quitting is not.

In the web preview, the optional cloud workspace keeps running while a chat works, even with the tab in the background or closed. The tab title gets a dot when a chat finishes. This is preview behaviour, not a promise of general availability; if your build shows the paused notice, it is not open to you.

## Let a long job finish

Keep going until done is on by default. When a turn reaches its step limit in the middle of a job, ADCode carries on by itself, up to twenty times in a row, which is roughly a thousand steps. The timeline notes each continuation.

The app carries on, not the chat window. It keeps going while ADCode is minimised, while you work in another chat, and on the web with the tab in the background. Stop ends the run. With the option off, the assistant stops at its step limit and shows a Continue button.

To see everything at work, run AI: Show Working Chats from the command palette. It opens the chat list with every working chat marked.

## Read the timeline behind an answer

Each answer is built in the order things happened.

While the turn runs, the heading reads Working for 54s. Under it you may see:

- A Thinking row with a one-line summary of the model's reasoning. Open it to read the whole thought.
- Tool calls. A run of the same tool is grouped into one row, such as Search project · 11 calls. Open the row to see each call with a tick beside the ones that completed.
- The text written between steps, so the explanation stays next to the work it describes.
- Helper rows when the assistant splits a task, each with its own report a click away.

When the turn ends, the process folds into Worked for 2m 31s, with the answer below. Select the heading to unfold it. Leave it folded for the result; open it to see why a file changed or a command ran.

## Follow a long answer

Scroll up while an answer is still arriving and the transcript stays where you put it. A Jump to latest pill appears with a count of new messages. Select it to return to the bottom.

## When a turn stops or fails

If you stop a turn, an interrupted banner appears with two actions. Edit prompt puts your last message back in the composer so you can change it. Try again sends the request again. Anything already applied to your files stays.

If a turn fails, a card explains why in plain words: a rate limit, a request too large for the model, a rejected key, a broken tool call or a network problem. The buttons depend on the cause and can include Try again, Switch model, Start fresh with this request, View AI usage and Report problem. Open Details to read the provider's exact message.

When the card offers Switch model, choosing a model that can answer resumes the request by itself, with the conversation and completed tool results carried over. You do not retype the prompt.

## A practical workflow

1. Start the biggest job in one chat.
2. Open another chat for work that does not touch the same files. Add a third or fourth only if you can review the results.
3. Watch the chat list: open a finished chat when its green dot appears.
4. Queue a follow-up in a working chat, then leave it; the message goes when that chat is ready.
5. Minimise ADCode. The notification brings you back when a chat finishes or needs you.
6. Read the folded answer, open the timeline only where you need to check a step, then review the changed files and use Undo if the turn went the wrong way.

## Limits and caveats

Four chats at once is the app's cap, not four per project. Review every change reduces it to one. Each chat runs one turn at a time; a second message queues.

Provider rate limits and context windows still apply. Four chats can reach the same provider at once, so running four does not give you four times the capacity, and a busy provider can slow all of them. Each chat has its own context limit.

Background work needs ADCode to stay open. Quitting ADCode ends the run, and a long network outage can still stop a request. Notifications need operating-system permission and are not shown while a window is focused.

The timeline is a record of what the assistant did, not proof that the result is correct. A green tick means a tool call completed, not that your tests pass.
