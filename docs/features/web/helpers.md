---
slug: helpers
title: "Helpers: one task, several agents"
description: The assistant can split a large job across up to four helpers that work at once, then bring their reports back into one turn with one Undo and one Stop.
section: The assistant
published: 2026-10-20
order: 6
related: chats-that-keep-working, team-agents-and-the-live-room, teach-the-assistant-your-project
---

# Helpers: one task, several agents

Helpers let the assistant turn one request into several pieces of work that happen at the same time. You ask once. The assistant decides the job has independent parts, writes a short brief for each, and starts up to four helper agents. Each works in a fresh context, then reports back. You get one answer, one set of changed files, one Undo.

## What happens when you ask

The assistant makes a single delegation call, `delegate_task`, naming one to four tasks. Each task has a title, instructions and a mode.

- Explore helpers can read and search, but cannot change anything. They are for finding code, tracing how something works, or gathering facts from several areas.
- Build helpers can edit files and run commands. They receive every tool the main assistant has except delegation and the tool for asking you a question, so they cannot pass work on or stop to ask.

Every helper gets a fresh context. It does not see your conversation, your earlier messages or what the other helpers are doing. Its instructions have to carry the goal, the files or area to work in, the constraints, and what to report. The same model as the main assistant is used for every helper; you do not choose a different one per helper.

The helpers start together and the assistant waits for them. Each finishes with a short closing report: what it found or changed, how it checked, and what is left uncertain. All those reports come back in a single tool result, so the main conversation receives four summaries rather than four transcripts. Reports are capped at 6,000 characters each.

As they work, the line under the assistant's answer shows what each one is doing, such as Helper 2 of 3 - Tests: running npm test. A Helpers row appears in the timeline. Open it to read each helper's status and report. A helper that fails, stops or is cancelled is listed too, with the reason if there is one.

## Edits, Stop and Undo

Helpers do not have a separate turn. Their tool calls go through the parent's tool runner, so their edits belong to the same turn as the assistant's own edits. The Changed files card lists everything, and Undo puts all of it back together.

Stop belongs to the parent. Press Stop on the assistant's turn and every helper is cancelled with it. A helper cannot keep working after the turn that started it has ended.

Build helpers can also get in each other's way. Two helpers given the same file can overwrite each other's work. Each build helper is told to stay inside the files and area it was given, but that is guidance, not a lock. Give each one a separate file or folder.

## When to use Helpers

Use Helpers when the parts are genuinely independent:

- Write tests for three areas that do not share fixtures.
- Find every caller of an API across a large codebase and summarise what each one sends.
- Build two separate pages or components that do not touch the same files.
- Research one part of the project while another part is being changed.
- Keep a long search out of the main conversation, so its context stays focused.

The last one is often the best reason. A helper can read far and wide and return one page of findings. The main chat never fills with file listings.

Do not use Helpers for work that is small or tightly connected. If step two depends on what step one finds, or the change is one coherent edit across a few files, the main assistant should do it itself. Splitting such work adds briefs, duplicates context and creates merge problems. A helper also cannot ask you anything, so a task that needs a decision midway is a poor fit.

## Ask for helpers

1. Describe the job in ordinary words and name the independent parts. For example: "Add tests for the cart, checkout and account pages." Or start the message with /helpers to ask for the split outright, then describe the work.
2. Watch the working line. Each helper reports its current step there, and the Helpers row appears in the timeline.
3. Let the assistant finish. It reads the reports, checks the work, fixes what a helper missed or got wrong, and gives you one answer.
4. Open the Helpers row to read each helper's own report, including any that failed.
5. Review the changed files. If the turn went the wrong way, use Undo once to revert the assistant's edits and every helper's edits. Stop, while it is running, ends all of them.

## Limits

- Four tasks per delegation call. More work needs another call, or should stay in the main chat.
- One model for the whole call: the same model the main assistant is using.
- No recursion. A helper cannot start helpers, so a task cannot fan out without a bound.
- No questions. Helpers cannot ask you to choose; the main assistant can still ask after reading their reports.
- No messages between helpers. They do not share a plan, a mailbox or a live view of each other's work.
- Reports are cut at 6,000 characters. Instructions are cut at 20,000 characters and titles at 80, so a very long brief loses its end.
- Helpers are not available when the assistant is running on a local model, on your own computer.
- Every helper request counts like any other request for usage and provider limits, and for what you pay when you use your own key.

## What it is not

Helpers are not Team agents. A Team is a set of named, saved agents you choose on the Agents page. They have their own instructions, models, tool access and looks, they share the project's memory, they message each other, and their work comes back as one Team box for review. Helpers are temporary, unnamed, chosen by the assistant, and exist only inside the turn that created them. There is no Team to set up, no members to choose and no shared memory.

Helpers are not recursion. Because a helper cannot delegate, the tree is one level deep: the main assistant and its helpers. That is deliberate. It keeps cost and scope predictable.

Helpers are not a separate model per helper. All helpers use the main assistant's model. If you want one agent on a fast model and another on a stronger one, that is a Team.
