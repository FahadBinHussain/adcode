---
slug: whats-new-october-2026
title: "What's new in ADCode: October 2026"
description: "What shipped in ADCode 2.2, 2.3 and 2.4, from open source and included AI to background chats, Helpers and the new Vibe window."
section: Start here
published: 2026-10-20
order: 1
related: adcode-in-your-browser, helpers, connectors
---

# What's new in ADCode: October 2026

October brought three releases: 2.2 on 9 October, 2.3 on 12 October with two fixes close behind, and 2.4 on 20 October. Some changes add capability; others change how Vibe feels.

If you have not updated, install the current build from [Versions](/versions). On Windows the signed installer comes from the Microsoft Store, which avoids the SmartScreen warning and keeps ADCode updated. Linux uses a .deb or AppImage. macOS desktop builds are not published.

## Open source, under Apache-2.0

The source is public at [github.com/bluethenics/adcode](https://github.com/bluethenics/adcode) under the Apache License 2.0. You can read, build, change and share it. The licence does not cover the name or logo, so a modified copy needs its own name.

Help > Open Source Licences shows ADCode's licence, its notice and the licence of every package in the installer; the same files ship in `resources/licenses`. See [Open source licences](/docs/workbench-open-source).

## Included AI without a personal usage limit

In 2.3, included AI had a daily allowance of one million tokens per account. 2.4 removes the personal usage limit: with a verified account, choose an included model and work without a daily refill or request count. The model menu lists every included model, not the first three.

Capacity is not infinite: administrators choose which models are offered, providers can rate-limit or fail, context limits remain, and included AI takes text and tool calls but not images. See [Free AI credits](/docs/ai-credits).

## Chats keep working, and answers show their work

Leave a chat working and start another: up to four run at once, or one at a time in Review mode. A spinner marks a working chat, a green dot one finished while you were away, and an amber dot one stopped early. Minimising ADCode does not stop the work, and a notification says when a chat finishes. See [Chats that keep working](/docs/ai-background-chats).

Each answer is now a timeline of thoughts, tool calls and text in the order they happened; repeated calls are grouped into one row. When the turn ends it folds to "Worked for Ns" with the answer below. Scroll back and a Jump to latest pill counts missed messages. See [AI chat workspace](/docs/ai-chat-widget).

## Helpers: the assistant can split a job

For a job with independent parts, the assistant can use up to four helper agents, each with a fresh context and the same model. Explore helpers only read and search; build helpers can edit files and run commands, and are told to stay in their own files.

Helpers belong to the same turn, so one Undo covers their edits and Stop stops them all. They cannot start their own helpers, and local models are not offered them. Type `/helpers`, or let the assistant decide when to split the work. See [Helpers](/docs/helpers).

## Project instructions, rules and hooks

ADCode reads your project's `AGENTS.md`, plus `CLAUDE.md`, `GEMINI.md`, GitHub Copilot instructions and your own `~/.adcode/AGENTS.md`. `/init` asks the assistant to read the project and write an `AGENTS.md` with the real install, build, run and test commands. The file describes the project; it cannot grant permissions, and what you say in chat still wins. See [Project instructions](/docs/ai-project-instructions).

Rules are separate. In `.adcode/settings.json` you can allow, ask or deny a tool, with an optional command or path pattern. Deny wins, and a chained command is checked part by part. Hooks can run before or after a tool call, at session start, or when the assistant tries to stop; exit code 2 blocks a call or sends it back to work. A project's hooks run only after you approve them once, and you are asked again when they change. See [Agent rules and hooks](/docs/ai-agent-rules).

## Prompt caching

Long runs re-send the same instructions, tool list and earlier messages at every step. ADCode now asks providers to cache that repeated beginning. With Claude it marks the cache explicitly; other compatible providers cache a repeated beginning themselves, and ADCode keeps history in the same order and bytes so the cache can match.

Cached tokens appear in AI usage, with the saving per model. A cache lasts a few minutes, so a chat you return to much later starts fresh. Included AI usage still counts every input token, cached or not. See [Prompt caching](/docs/ai-prompt-caching).

## Connectors for the tools you already use

Tools → Connectors accepts MCP servers, Claude Desktop extensions, Claude Code plugins and OpenAI-style actions. Add one from the catalogue, import what Claude Desktop, Claude Code, Cursor, Windsurf or VS Code already have, read a config file, OpenAPI description, `.mcpb` extension or plugin folder, or set one up by hand.

What it finds waits as a dashed card until you press Add, so nothing installs by accident. Extension and plugin files are copied into ADCode's folder; hooks are copied but never run. Secrets go to the operating system's encrypted store, or the private cloud workspace on the web. See [Connectors](/docs/connectors).

## Team agents and the live room

2.2 made Team agents talk. Give two to four named agents a shared task and they message each other mid-run, share project memory and hand work on. The live room above the chat gives each agent a window with its mascot, current file or command, and the messages between teammates. Each window ends with Checks passed, Check failed or Unverified, based on commands the agent actually ran. You can stop one agent, a team, or every run.

Teams count towards the agents working at once, and share a connection's request limit. The live view can be turned off in Settings. See [AI Team](/docs/ai-team) and [Live agent view](/docs/ai-live-agents).

## The new Vibe window

2.4 gives Vibe an icon rail, a sidebar card for the project and chats, a tab per open chat, new type, quieter borders and the app menus behind one button. The IDE window keeps its own chrome. [The new Vibe window, explained](/docs/the-new-vibe-window) is a full tour, including what did not change.

## Invites, reports and the status page

Invite & earn gives every account a link and shows who joined and what it earned. For 365 days you receive 10% of what ADCode earns from ads an invited person sees, and 5% of what an advertiser you bring spends. Both come from ADCode's share, not theirs. On Windows the Store installer drops a link's query string, so the code travels by clipboard or the paste box.

Administrators get per-model health and provider reports: demand, usage, reliability, response speed and optional feedback. Model-level data starts on 11 October; older totals are not shown as model history. The public [status page](/status) shows measured health for included models over 90 days, with an incident log and RSS feed. Only included models appear; a model on your own key is not ADCode's service.

The browser workspace is in preview: the repository contains browser chat, saved conversations and GitHub review, but production is paused. Read [ADCode in your browser](/docs/adcode-in-your-browser) for what is planned, not as something available today.

## Smaller fixes worth knowing

2.3.1 made slash commands typed with words work like chosen commands, kept attachments visible after sending, and gave local Ollama models a smaller toolset. 2.3.2 retried a free AI task after a dropped connection for about two minutes without repeating completed steps, and stopped a sign-in refresh from asking you to sign in again.

## What to try first

1. Update to 2.4, hide the sidebar with Ctrl+B, and start a second chat with Ctrl+Shift+N.
2. Ask for a job with independent parts and begin the message with `/helpers`.
3. Run `/init`, read the `AGENTS.md`, and correct what it got wrong.
4. Add one deny rule for a command you never want run unattended.
5. Open Tools → Connectors and import one MCP server you already use.
6. Check AI usage for cached tokens after a long chat.
