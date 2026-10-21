---
slug: team-agents-and-the-live-room
title: "Team agents and the live room"
description: Set up a Team of two to four named agents that divide one task, message each other, share the project's memory, and watch them work side by side in the live room.
section: The assistant
published: 2026-10-20
order: 7
related: helpers, whats-new-october-2026, workbench-agents-board
---

# Team agents and the live room

A Team lets you divide one goal among several named AI agents that work at the same time. Each agent has its own instructions, model, tools and look. While they work they message each other, share the project's memory, keep a plan and run the project's checks before reporting done. Their work comes back as one combined review, with one Stop. The live room shows them side by side while it happens.

## Setting up a Team

Open Agents from the rail in the Vibe window, or from the command palette. On the first visit five starter specialists appear and use your currently connected model.

1. Under Your agents, use a starter or choose New agent. Give it a name, a look, instructions, a connection and model, and the tools it may use.
2. In the agent editor, keep "Use the currently connected model" on to follow changes in Connect a model, or turn it off to pin a fixed connection and model to that agent.
3. Enable "Run after teammates" for an agent that should receive others' handoffs first, such as a reviewer.
4. Choose Select for a Team, tick two to four agents, press Set up Team and describe the shared task.
5. The Team appears as one box under Needs you, with its members' mascots. Press Start to begin.
6. Select the box at any time to see each step it took. Press Stop if the task should end.
7. Review the combined changes before applying them. Agents sharing a connection also share its requests-per-minute limit.

The assistant can suggest a Team for a big request typed in the chat. You can also type /team followed by a task in the composer.

## How a Team works

Team roles are not isolated chats. They cooperate while they work:

- They message each other mid-run. A role can send a message to a teammate, and unread messages arrive with its next tool result.
- They share the project's memory, so what one learns, the others can read.
- They keep a plan, updated as the work moves.
- They run the project's checks before reporting done.
- An overlap tracker notices when two roles edit the same file and warns before the merge.

The work comes back as one combined review. Nothing is applied until you review it, or Stop ends the whole Team at once.

## The live room

When the assistant writes a file, a live window opens in the conversation with the file's name, and the code types in as the model writes it. When it runs a command, the same window switches to the command and its output as it prints. You see the real work instead of a spinner followed by a finished file.

Start a Team, a race, or a solo agent from the Agents page, or a Team in the terminal from a terminal's menu, and a live room appears above the chat. Each agent gets a mascot on a strip and a window of its own, showing what it is doing right now: the file, the command, the plan, the files touched, and the proof from any checks it ran.

Watch the strip. When one agent messages another, hands its work on, or edits a file a teammate already changed, the sender turns to the receiver, a speech bubble crosses between them, and the line stays underneath. Click a mascot or a window's title bar to fill the room with that agent; click again to see them all. Hide windows keeps just the mascots.

Stop an agent from its window's title bar: Stop for one agent, Stop team for a Team, or Stop all in the room's header for every run at once. The menu beside a window opens that agent on the Agents board or edits the saved agent.

In the main chat, the line at the bottom shows what the assistant is doing and for how long, with its own Stop button. Pressing Escape stops it too.

Read the bottom of each window before you trust the result. It says Checks passed, Check failed or Unverified, and that comes from the commands the agent actually ran, never from what it says.

Prefer a quieter chat? Turn the live view off in Settings, under AI, Live agent view.

## How it differs

Helpers are temporary and chosen by the assistant. They use the same model, have no names, no saved instructions, no shared memory and no messages between them. They exist inside one turn, and their edits land in the same Undo and Stop. Use them when the parts are independent and you just want the job done faster.

A Team is a set of named, saved agents you choose. They keep their own instructions, models, tools and looks, they share the project's memory, they message each other, and their work comes back as one Team box for review. Use a Team when the roles matter, such as a builder and a reviewer, or when you want agents on different models.

Race mode runs two or three agents on the same task in separate copies of the project, then lets you compare their results and keep one. A Team divides one task among agents who work on different parts of it.

## Limits

- Teams count toward Agents working at once. The limit is one to six, set in Settings under AI. Extra runs wait as Queued and start oldest first.
- Requests share each connection's rate limit.
- The live view can be turned off.
- In a terminal Team, not every agent command-line tool can be messaged mid-task. Some do not support it.

## What to watch

- The bottom of each window: Checks passed, Check failed or Unverified.
- Speech bubbles and overlap warnings on the strip.
- Queued status on a box that is waiting its turn.
- Cost on a box when the price is known.
- The combined review before anything is applied.