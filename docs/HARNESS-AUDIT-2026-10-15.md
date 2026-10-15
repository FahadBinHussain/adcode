# ADCode against the AI harness checklist (2026-10-15)

Each of the 54 items from `ai-harness-checklist.md`, scored against the code as of today, with the
file that shows it. **Yes** means a person can use it now; **Partial** means part of it exists;
**No** means nothing exists yet. The items marked *new* landed in this change.

## Tier 1: basics

| # | Item | Status | Evidence / what is missing |
|---|---|---|---|
| 1 | Agent loop | Yes | `packages/ai/src/agent.ts`: tool loop, `MAX_TURNS`, three identical failures stop a retry loop, Keep going until done carries on past the step limit |
| 2 | Core tools | Partial | read/edit/propose/glob/search/run/fetch/outline in `packages/ai/src/tools.ts`. **No web search tool** (only `fetch_url`) |
| 3 | Context management | Yes | Auto-compaction (`compaction.ts`), lean requests, large output truncated with paging. Large tool results are cut, not offloaded to files |
| 4 | Project instruction files | Yes *new* | `apps/desktop/src/main/projectInstructions.ts`: AGENTS.md + CLAUDE.md / GEMINI.md / copilot aliases, `~/.adcode/AGENTS.md`, `@imports`, `/init` writes one |
| 5 | Permissions and approvals | Partial | Edit policy (apply directly / review), MCP tools ask first. No per-tool or per-path allow/ask/deny rules |
| 6 | Sandboxing | Partial | Web version: per-person container. Review mode and Teams: an isolated copy of the project (`aiSandbox.ts`). **No OS-level sandbox for commands on the desktop** |
| 7 | Session persistence | Partial | Conversations are saved and reopen with their summary; per-turn Undo. No fork or rewind of a conversation |
| 8 | Git integration | Yes | `packages/git`, Commit & Push, per-turn checkpoints |
| 9 | MCP client | Partial | MCP servers and catalogue. **No OAuth for remote MCP servers** |
| 10 | Configuration levels | Partial | User settings only. No project-level or managed (enterprise) settings |
| 11 | Headless mode | No | No CLI or JSON-output mode for CI |
| 12 | Streaming UI | Yes | Chat timeline, interrupt, queued follow-ups, live code drafts, background chats |
| 13 | Slash commands | Partial | 21 built-in `/` commands (`shared/slashCommands.ts`). No user-defined commands |
| 14 | Cost and token visibility | Yes *new* | Free AI credits: session + weekly meters, usage dialog, per-model rates; own-key usage and cost per model |

## Tier 2: table stakes

| # | Item | Status | Evidence / what is missing |
|---|---|---|---|
| 15 | Subagents | Yes *new* | `packages/ai/src/subagents.ts`: `delegate_task`, up to 4 in parallel, fresh context, explore/build tool sets, no recursion, Stop and Undo cover them |
| 16 | Skills (SKILL.md) | Yes | `load_skill`, built-in skills loaded on demand (`builtinSkills.ts`, `assistantSkills.ts`) |
| 17 | Hooks | No | No lifecycle hooks |
| 18 | Plugins and marketplace | Partial | MCP catalogue and assistant extensions; no bundle format or registry |
| 19 | Plan mode / auto-accept | Partial | `/plan` and review mode; auto-apply is the default. No enforced read-only plan mode |
| 20 | Multi-model, BYOK, local | Yes | Catalogue of providers, custom base URLs, Ollama, per-role routes for Teams |
| 21 | Parallel sessions with worktrees | Partial | Several chats at once; Team roles in isolated copies. Not git worktrees |
| 22 | Cloud / background agents | Partial | web.bluethenics.com runs the agent in the cloud; background chats; scheduled messages. No phone handoff of a running desktop session |
| 23 | IDE integration / ACP | No | ADCode is the IDE; it does not speak ACP or ship extensions for others |
| 24 | Memory | Yes | `packages/memory`: project memory, memory tools, an editor for it |
| 25 | Images, browser control | Yes | Image attachments, `view_page` (real browser, clicks, screenshots), `audit_page` |
| 26 | LSP | Yes | `packages/lsp`: definitions, diagnostics, rename in the editor |
| 27 | Harness as API / MCP server | Partial | ADCode's memory as an MCP server (`adcode.ai.mcpServer`). No SDK for the agent itself |
| 28 | Code review and security scan | Partial | `/review`, `/security`. No automatic scan |

## Tier 3: differentiators

| # | Item | Status | Evidence / what is missing |
|---|---|---|---|
| 29 | Long-horizon state | Partial | `update_plan` checklist, compaction keeps the task, Keep going until done. No crash auto-resume |
| 30 | Built-in verification | Partial | `run_project_checks`, `view_page`, a prompt that forbids unverified claims. No separate verifier agent |
| 31 | Self-correcting loops | Partial | Repeated identical failures stop; path errors prompt a re-list. No strategy change beyond that |
| 32 | Deterministic replay | No | |
| 33 | Checkpoint and time travel | Partial | Files per turn; not conversation or environment |
| 34 | Smart retrieval | Partial | `packages/search`, `packages/structure`, outlines. No semantic index or repo map |
| 35 | Context budget visibility | Yes | Context meter, Compact now, warnings |
| 36 | Prompt caching | No | **No `cache_control` on Anthropic requests** - long sessions re-pay the whole prefix |
| 37 | Code mode | No | |
| 38 | Layered security | Partial | Untrusted-content rules in the system prompt, MCP approvals. No risky-command classifier |
| 39 | Secrets handling | Partial | Keys in the OS store, never in logs or prompts. No redaction of tool output |
| 40 | Audit trail and policy | Partial | Server admin actions are audited; nothing local |
| 41 | Subagent isolation | Yes *new* | Helpers get a subset of the parent's tools, cannot delegate, share its runner and checkpoint |
| 42 | Explainable approvals | Partial | MCP approval says what the tool does; no risk explanation |
| 43 | Built-in tracing | Partial | `aiEventTrace.ts`, run evidence, debug log. No per-step cost/latency view |
| 44 | Eval harness | No | Smoke scripts only (`scripts/smoke*.mjs`) |
| 45 | Per-model profiles | Partial | Lean profile for local models, effort setting |
| 46 | Multi-agent workflows | Yes | Teams: plan graph, mailbox, merge, race mode, live agent room |
| 47 | Scheduling and triggers | Partial | Scheduled messages and automations. No webhooks, PR or CI triggers |
| 48 | Environment as code | Partial | The web version's container image |
| 49 | Cross-device continuity | Partial | One account, credits and earnings everywhere; conversations do not move between devices |
| 50 | Fast startup, Windows | Yes | Microsoft Store build |
| 51 | Transparent pricing | Partial *new* | Credits shown live and on the landing page. No estimate before a run |
| 52 | Docs and onboarding | Yes *new* | `/docs` with a guide per feature, `/init` |
| 53 | Open specs | Partial *new* | AGENTS.md, SKILL.md, MCP. No ACP |
| 54 | Community extensibility | Partial | Apache-2.0, public changelog. No plugin registry |

## Gaps nobody fills well

| Gap | Status |
|---|---|
| Honest uncertainty | Partial: the system prompt forbids unverified claims; Audit marks unrun checks as unverified |
| Cost-aware routing | No |
| True portability | Partial: AGENTS.md and SKILL.md now read as other tools write them |
| Per-task cost reporting | Partial: usage per model, credits per window; not per task |
| Safe unattended operation | Partial: Keep going and credit waits resume by themselves; no guardrail report |
| Learning from the team | Partial: memory capture writes decisions; no approval flow to turn corrections into rules |

## What to build next, in order

1. **Prompt caching (36)** - the cheapest large win: Anthropic `cache_control` on the system prompt, tools and older history. Long agent runs cost a fraction.
2. **Hooks (17) and per-tool permission rules (5)** - one settings file with allow/ask/deny per tool and path, and pre/post tool hooks that can block. Needed before unattended runs are safe.
3. **Web search tool (2)** - a `web_search` tool beside `fetch_url`, through the relay so it needs no key.
4. **Headless mode (11)** - `adcode run "task" --json` reusing adcode-host, for CI and scripts.
5. **Command sandbox on the desktop (6)** - run `run_command` in a restricted child on Windows (job object + restricted token) with network off by default for helpers.
