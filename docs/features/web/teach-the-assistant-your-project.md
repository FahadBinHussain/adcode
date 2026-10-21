---
slug: teach-the-assistant-your-project
title: Teach the assistant how your project works
description: ADCode reads your AGENTS.md, enforces allow, ask and deny rules in .adcode/settings.json, and runs hooks around each step. Learn how the three layers differ and when to use each.
section: The assistant
published: 2026-10-20
order: 8
related: helpers, team-agents-and-the-live-room, connectors
---

ADCode has three layers of guidance. Project instructions describe the project. Permission rules decide what the assistant may do. Hooks run your commands around its steps. Of the three, only rules and hooks can stop a tool call.

| Layer | Where it lives | Question it answers | Can it block? |
| --- | --- | --- | --- |
| Project instructions | `AGENTS.md` and similar | How does this project work? | No |
| Permission rules | `.adcode/settings.json` → `permissions` | May the assistant do this? | Yes |
| Hooks | `.adcode/settings.json` → `hooks` | Does my check run here? | Yes, on exit 2 |

## Project instructions: the project's own words

ADCode sends the project's instruction files with every request, in this order:

- `~/.adcode/AGENTS.md` for every project
- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`
- `.github/copilot-instructions.md`

If several exist, all are sent; identical text is shown once. A line that is only `@other.md` inlines that file, one level deep; the imported file must stay inside the project (or `~/.adcode` for your home file).

The budget is 12,000 characters across all files, or 3,000 in lean mode (local Ollama models). A file that does not fit is cut with a marker and the assistant is told to read the rest; with almost no room left it is not shown at all, though the assistant can still read it.

ADCode does not load every folder's `AGENTS.md` up front. It tells the assistant to read a folder's own file before changing files there, which depends on the assistant following that instruction.

Instructions are data. They cannot grant permissions, reveal secrets or overrule you; if they conflict with what you say in chat, your message wins. Do not put keys or passwords in them: the text goes to the provider.

Run `/init` (or AI: Write Project Instructions) to create one. The model reads the README, package files, build and test setup, layout and a few source files, then writes `AGENTS.md` at the root in under 80 lines, improving an existing file.

Project memory is separate: Tools > Memory stores notes in `.adcode/memory`; `AGENTS.md` is what you decided.

## Permission rules: allow, ask, deny

Run AI: Open Agent Rules and Hooks. It creates the file with a commented starter or opens it.

A rule is a tool name with an optional pattern: `run_command(git push*)`, `edit_file(src/**)`, `delete_file(*)`, `fetch_url(domain:example.com)`. Path patterns match relative paths, command patterns match commands, and `domain:` matches a host and its subdomains.

Deny always wins. Between ask and allow, the more specific rule decides (more literal characters wins; a tie asks): `ask: ["run_command"]` with `allow: ["run_command(npm test*)"]` asks before every command except tests.

No slash matches a name at any depth (`*.env`, `dist`); a slash anchors at the project root (`src/**`). A folder rule covers its contents, so `edit_file(dist)` protects `dist/app.js`. `*` stays in one folder and `**` crosses them.

Commands split at `&&`, `||`, `|`, `&`, `;` and newlines, respecting quotes. The whole line and each part are checked, and the strictest answer wins, so `npm test && git push` is still blocked.

A denied call fails with the rule's name and file; the assistant is told not to retry. An ask opens a dialog with Allow once and Don't allow. If no window can show it, or the turn is stopped, the answer is no; otherwise the run waits.

Your rules in `~/.adcode/settings.json` apply everywhere (AI: Open My Agent Rules for Every Project). Both files combine; a project's allow cannot lift an ask from your own file, and deny wins in either.

The assistant's edit, delete and move tools treat `.adcode/settings.json` as ask-first. A shell command that rewrites the file is not covered.

The chat, helpers and Team or solo agents all pass every tool call through the same rules.

## Hooks: your commands around a step

Four events: `preToolUse` before a call, `postToolUse` after it, `sessionStart` once per conversation, and `stop` when the assistant thinks it is done. Each is a list of entries:

```json
{ "matcher": "run_command", "command": "node check.mjs" }
```

The matcher takes the same `tool(pattern)` form; omit it or use `*` for every tool. `sessionStart` and `stop` ignore matchers.

The command runs from the project root with JSON on stdin, using Claude Code's names: `hook_event_name`, `session_id`, `cwd`, `tool_name`, `tool_input`; `postToolUse` adds `tool_response`, and `stop` adds `stop_hook_active` and `last_assistant_message`.

Only exit code 2 counts. `preToolUse` blocks the call with stderr as the reason; `postToolUse` appends stderr to the step result; `stop` sends the assistant back to work up to three times for one message. `sessionStart` output on success is added to context. Other exits, crashes and timeouts go to the debug log; a linter that exits 1 will not block, so use `|| exit 2`.

Project hooks need approval: ADCode lists the commands and asks Run them or Don't run, then asks again whenever they change. Your own hooks in `~/.adcode/settings.json` need no approval.

## A working example

```json
{
  "permissions": {
    "allow": [
      "run_command(npm test*)",
      "run_command(npm run lint*)"
    ],
    "ask": [
      "run_command",
      "delete_file(*)"
    ],
    "deny": [
      "run_command(git push*)",
      "edit_file(.env*)"
    ]
  },
  "hooks": {
    "postToolUse": [
      { "matcher": "edit_file", "command": "npx eslint --quiet . || exit 2" }
    ],
    "stop": [
      { "command": "npm test --silent || exit 2" }
    ]
  }
}
```

## Set it up step by step

1. Run `/init`, correct the result, and commit `AGENTS.md`; add a folder-level file where needed.
2. Run AI: Open Agent Rules and Hooks. Keep the starter comments.
3. Deny irreversible actions and secrets, ask for broad tools, allow only trusted commands. Save.
4. Add a `postToolUse` linter and a `stop` test command, each with `|| exit 2`.
5. Make a small change. When the hooks prompt appears, read every command first.
6. Test the fence: `git push` should be refused by name, `npm test` should not ask, another command should ask.
7. Add a baseline deny or ask in `~/.adcode/settings.json`; a project cannot lift your asks.
8. Commit `.adcode/settings.json` and check AI usage after a long run.

## Prompt caching

Prompt caching is not a fourth layer and has no switch. Each chat and agent step asks the provider to reuse the repeated beginning: instructions, tools and earlier messages. Claude gets ADCode's cache markers; OpenAI, DeepSeek and other compatible providers cache a repeated prefix themselves, and ADCode keeps the history byte-stable.

Cached input appears under Tokens in AI usage. Caches expire after a few minutes, so a chat resumed much later, or a new chat, starts fresh. Inline completion and summaries are not marked for caching.

Cached tokens are part of the input count and shown separately. For your own key, your provider's cache rate prices that part; for included AI, credits are charged on the full token count, cached or not. Caching lowers the cost, it does not remove it.

## What this cannot do

- Instructions are advice, not enforcement: the model can ignore them, long files are cut, nested files are not loaded automatically, only listed names and one-level imports are read, and the text goes to the provider.
- Rules match tool-call text; they are not a sandbox. A permitted command runs with your account, and a script, `bash -c`, or an unmatched command can do more. `git push*` misses `git -C ../repo push`; use `git *push*`. Denying `read_file(.env*)` does not stop `run_command(cat .env)`.
- The rules-file protection covers the edit, delete and move tools on the project file, not `run_command` and not `~/.adcode/settings.json`.
- An ask never becomes an allow, but with a window open it waits; with no window or a stopped turn, it is refused.
- Hooks support four events and command-type entries only. Exit 1 does not block, and a hook runs with your permissions.
- Rules apply to ADCode's tools, not your terminal, another editor or a git client.

## Safety notes

Treat a cloned project's `.adcode/settings.json` as code and read it before approving hooks. Keep a baseline in your user file. Deny push, publish, deploy and secrets; ask for broad commands and deletes; allow narrow test commands. Test in a throwaway folder with one denied, one asked and one allowed call. Keep `AGENTS.md` and the project's settings file in version control, and keep no secrets in `AGENTS.md`. For untrusted code, use an OS account or container; this is not a sandbox.
