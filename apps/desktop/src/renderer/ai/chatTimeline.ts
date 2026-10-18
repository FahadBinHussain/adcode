/**
 * One assistant turn, drawn as a timeline: what it thought, what it did, and what it said
 * along the way, in the order it happened.
 *
 *     Working for 54s ⌄
 *     ✧ Thinking   The user wants a landing page with pricing…            ›
 *     I'll start with the hero, then the pricing table.
 *     ⌕ Search project · 3 calls   pricing                                ›
 *     ✎ Edit file   src/App.tsx   ▦                                       ›
 *
 * Presentation only, like `chatActivity.ts`: the chat widget turns the agent's events into
 * calls here, and this module owns the markup, the clock and the motion. The pieces that are
 * worth testing without a DOM - the heading, the thinking summary, tool labels and grouping -
 * are plain functions at the top.
 *
 * - **One timeline per turn.** Thinking rows, tool rows and the text written between them all
 *   live inside it, so collapsing it to "Worked for 2m 31s" folds the whole process away.
 * - **The answer stays out.** When the turn ends, whatever text came after the last step is
 *   moved out below the timeline, so the folded turn reads: heading, then the answer.
 * - **A run of one tool is one row.** Eleven searches in a row are "Search project · 11
 *   calls", with each call a click away. Anything in between - thinking, text - starts a
 *   new row, because the timeline reads in order.
 * - **One face at work.** The mascot sits in the heading while the turn runs and leaves
 *   when it ends; live rows carry the small pixel spinner instead of a face of their own.
 */

import { createIcon, ICON } from "../workbench/icons.ts";
import { renderChatMessageHtml } from "./chatMarkdown.ts";
import { createMascot, type MascotHandle } from "./mascot.ts";

export type TurnOutcome = "running" | "worked" | "thought" | "failed" | "stopped" | "declined";

/** "54s", "2m 31s", "3m", "1h 2m" - whole units, never less than a second. */
export function formatTurnDuration(seconds: number): string {
  const total = Math.max(1, Math.round(seconds));
  if (total < 60) return `${String(total)}s`;
  if (total < 3_600) {
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return rest === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(rest)}s`;
  }
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  return minutes === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(minutes)}m`;
}

/** The heading's two halves: the word that carries the state, and the time beside it. */
export function turnHeading(outcome: TurnOutcome, seconds: number): { readonly lead: string; readonly rest: string } {
  const time = formatTurnDuration(seconds);
  switch (outcome) {
    case "running": return { lead: "Working", rest: `for ${time}` };
    case "worked": return { lead: "Worked", rest: `for ${time}` };
    case "thought": return { lead: "Thought", rest: `for ${time}` };
    case "failed": return { lead: "Failed", rest: `after ${time}` };
    case "stopped": return { lead: "Stopped", rest: `after ${time}` };
    case "declined": return { lead: "Declined", rest: "" };
  }
}

const SUMMARY_LIMIT = 160;

/**
 * A thinking row's one line: the first line of the thought, with the markdown markers a
 * model wraps its own headings in taken off, so `**Planning**` reads as "Planning".
 */
export function thinkingSummary(text: string): string {
  const line = text.split("\n").map((part) => part.trim()).find((part) => part.length > 0) ?? "";
  const plain = line
    .replace(/^#{1,6}\s+/, "")
    .replace(/\*\*|__/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > SUMMARY_LIMIT ? `${plain.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…` : plain;
}

const STEP_LABELS: Readonly<Record<string, string>> = {
  read_file: "Read file",
  list_files: "List files",
  glob_files: "Find files",
  search: "Search project",
  get_outline: "Outline file",
  edit_file: "Edit file",
  propose_edit: "Edit file",
  delete_file: "Delete file",
  move_file: "Move file",
  run_command: "Run command",
  command_output: "Check command",
  stop_command: "Stop command",
  fetch_url: "Read URL",
  view_page: "View page",
  audit_page: "Check page",
  open_preview: "Open preview",
  update_plan: "Update plan",
  ask_user: "Ask the user",
  delegate_task: "Helpers",
  project_context: "Read project notes",
  inspect_project: "Inspect project",
  run_project_checks: "Check project",
  discover_capabilities: "Find tools",
  load_skill: "Read skill",
  load_builtin_skill: "Read skill",
  call_mcp: "Use MCP tool",
  message_teammate: "Message teammate",
  read_messages: "Read messages",
};

/** What a row calls a tool: "Read file", "Search project". An unknown tool still reads as words. */
export function toolStepLabel(name: string): string {
  const clean = name.trim();
  if (clean.length === 0) return "Use a tool";
  const known = STEP_LABELS[clean];
  if (known !== undefined) return known;
  if (/^memory/i.test(clean)) return "Project memory";
  const words = clean.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type ToolStepIcon = "search" | "globe" | "file" | "edit" | "terminal" | "eye" | "checklist" | "plug" | "tool";

/** The row's icon, by what the tool does rather than by its exact name. */
export function toolStepIcon(name: string): ToolStepIcon {
  const clean = name.trim();
  if (clean === "update_plan" || clean === "delegate_task") return "checklist";
  if (clean === "call_mcp" || clean === "discover_capabilities") return "plug";
  if (clean === "view_page" || clean === "audit_page" || clean === "open_preview") return "eye";
  if (/fetch|url|web/i.test(clean)) return "globe";
  if (/search|grep|glob|find/i.test(clean)) return "search";
  if (/edit|write|patch|apply|delete|move/i.test(clean)) return "edit";
  if (/run|exec|command|terminal|check/i.test(clean)) return "terminal";
  if (/read|list|outline|context|memory|skill|inspect|messages/i.test(clean)) return "file";
  return "tool";
}

/** "11 calls" beside a grouped row; nothing for a single call, whose detail says enough. */
export function toolGroupCount(calls: number): string {
  return calls > 1 ? `${String(calls)} calls` : "";
}

/** A tool call joins the row above only if that row is a run of the same tool. */
export function joinsToolGroup(last: { readonly kind: string; readonly name?: string } | null, name: string): boolean {
  return last !== null && last.kind === "tools" && last.name === name;
}

const ICON_PATHS: Readonly<Record<ToolStepIcon | "sparkle", string>> = {
  sparkle: ICON.sparkle,
  search: ICON.search,
  globe: ICON.globe,
  file: ICON.file,
  edit: ICON.edit,
  terminal: ICON.terminal,
  eye: ICON.eye,
  checklist: ICON.checklist,
  plug: ICON.plug,
  tool: ICON.tool,
};

/**
 * The pixel mosaic that means "working": a 3×3 grid whose cells light in a scattered order.
 * Decorative - the row beside it carries the words.
 */
export function createPixelSpinner(size: "row" | "turn" = "row"): HTMLElement {
  const spinner = document.createElement("span");
  spinner.className = `chat-pixel-spinner is-${size}`;
  spinner.setAttribute("aria-hidden", "true");
  for (let cell = 0; cell < 9; cell += 1) spinner.append(document.createElement("i"));
  return spinner;
}

export interface ToolCallInput {
  readonly id: string;
  readonly name: string;
  /** The call's input in one line: a path, a query, a command. */
  readonly detail: string;
}

export interface TurnTimeline {
  readonly element: HTMLElement;
  readonly startedAt: number;
  /** Host progress beside the heading - "Waiting 21s for the rate limit". Null clears it. */
  setStatus(text: string | null): void;
  /** A thinking delta: extends the live thinking row, or starts one. */
  thinking(text: string): void;
  toolCall(call: ToolCallInput): void;
  /** A tool finished. Without an id, the newest running call is the one that finished. */
  toolResult(id: string | null, ok: boolean): void;
  /** Text written between steps. It stays in the timeline unless it turns out to be the answer. */
  appendText(node: HTMLElement): void;
  hasSteps(): boolean;
  /** End the turn: settle live rows, release the answer below, fold the rest away. */
  finish(outcome: Exclude<TurnOutcome, "running"> | "auto"): void;
  /** Drop it without finishing (the conversation is being replaced). */
  destroy(): void;
}

interface CallRow {
  readonly element: HTMLElement;
  readonly group: GroupStep;
  status: "running" | "done" | "error";
}

interface GroupStep {
  readonly kind: "tools";
  readonly name: string;
  readonly element: HTMLElement;
  readonly count: HTMLElement;
  readonly detail: HTMLElement;
  readonly list: HTMLElement;
  calls: number;
  running: number;
}

interface ThinkingStep {
  readonly kind: "thinking";
  readonly element: HTMLElement;
  readonly summary: HTMLElement;
  readonly detail: HTMLElement;
  text: string;
}

type Last = GroupStep | ThinkingStep | { readonly kind: "text" } | null;

function icon(name: ToolStepIcon | "sparkle"): HTMLElement {
  const holder = document.createElement("span");
  holder.className = "chat-step-icon";
  holder.append(createIcon(ICON_PATHS[name]));
  return holder;
}

/** A step: a row that opens to show its detail, with the grid-rows collapse the turn uses. */
function stepShell(kind: "thinking" | "tools", iconName: ToolStepIcon | "sparkle", label: string): {
  readonly element: HTMLElement;
  readonly row: HTMLButtonElement;
  readonly label: HTMLElement;
  readonly body: HTMLElement;
} {
  const element = document.createElement("div");
  element.className = `chat-step is-${kind}`;
  element.dataset["step"] = kind;
  element.dataset["state"] = "running";
  element.dataset["open"] = "false";

  const row = document.createElement("button");
  row.type = "button";
  row.className = "chat-step-row";
  row.setAttribute("aria-expanded", "false");
  const name = document.createElement("span");
  name.className = "chat-step-label";
  name.textContent = label;
  row.append(icon(iconName), name);

  const collapse = document.createElement("div");
  collapse.className = "chat-step-collapse";
  const body = document.createElement("div");
  body.className = "chat-step-detail";
  collapse.append(body);

  row.addEventListener("click", () => {
    const open = element.dataset["open"] !== "true";
    element.dataset["open"] = String(open);
    row.setAttribute("aria-expanded", String(open));
  });
  element.append(row, collapse);
  return { element, row, label: name, body };
}

function chevron(): HTMLElement {
  const holder = document.createElement("span");
  holder.className = "chat-step-chevron";
  holder.append(createIcon(ICON.chevronRight));
  return holder;
}

export function createTurnTimeline(options?: { readonly startedAt?: number }): TurnTimeline {
  const startedAt = options?.startedAt ?? Date.now();

  const element = document.createElement("section");
  element.className = "chat-turn";
  element.dataset["state"] = "running";
  element.dataset["collapsed"] = "false";
  element.setAttribute("aria-label", "The assistant's work on this turn");

  const header = document.createElement("div");
  header.className = "chat-turn-header";
  const mascot: MascotHandle = createMascot({ mood: "thinking" });
  // Poking the mascot must not fold the turn.
  mascot.element.addEventListener("click", (event) => event.stopPropagation());
  const face = document.createElement("span");
  face.className = "chat-turn-face";
  face.append(mascot.element);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "chat-turn-toggle";
  toggle.setAttribute("aria-expanded", "true");
  const lead = document.createElement("strong");
  lead.className = "chat-turn-lead";
  const rest = document.createElement("span");
  rest.className = "chat-turn-rest";
  // The clock ticks every second; a screen reader should not read it out each time.
  rest.setAttribute("aria-hidden", "true");
  const status = document.createElement("span");
  status.className = "chat-turn-status";
  status.hidden = true;
  const turnChevron = document.createElement("span");
  turnChevron.className = "chat-turn-chevron";
  turnChevron.append(createIcon(ICON.chevronDown));
  toggle.append(lead, rest, status, turnChevron);
  header.append(face, toggle);

  const collapse = document.createElement("div");
  collapse.className = "chat-turn-collapse";
  const body = document.createElement("div");
  body.className = "chat-turn-body";
  collapse.append(body);
  element.append(header, collapse);

  const paintHeading = (outcome: TurnOutcome, seconds: number): void => {
    const heading = turnHeading(outcome, seconds);
    lead.textContent = heading.lead;
    rest.textContent = heading.rest;
  };
  const tick = (): void => paintHeading("running", (Date.now() - startedAt) / 1000);
  tick();
  let clock: number | null = window.setInterval(tick, 1_000);

  const setCollapsed = (collapsed: boolean): void => {
    element.dataset["collapsed"] = String(collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
  };
  toggle.addEventListener("click", () => setCollapsed(element.dataset["collapsed"] !== "true"));

  let last: Last = null;
  let toolsSeen = 0;
  let stepsSeen = 0;
  const calls = new Map<string, CallRow>();
  const running: CallRow[] = [];

  const settleThinking = (): void => {
    if (last?.kind !== "thinking") return;
    last.element.dataset["state"] = "done";
    last.element.querySelector(".chat-pixel-spinner")?.remove();
    const label = last.element.querySelector(".chat-step-label");
    if (label !== null) label.textContent = "Thinking";
    // Streamed as plain text; once whole, a thought reads like the reply does - bold, lists,
    // code - through the same escaping renderer.
    last.detail.innerHTML = renderChatMessageHtml(last.text);
    last.detail.classList.add("is-rendered");
  };

  const paintGroup = (group: GroupStep): void => {
    const counted = toolGroupCount(group.calls);
    group.count.textContent = counted.length === 0 ? "" : `· ${counted}`;
    group.count.hidden = counted.length === 0;
    group.element.dataset["state"] = group.running > 0 ? "running" : group.element.dataset["state"] === "error" ? "error" : "done";
    const spinner = group.element.querySelector(".chat-step-row > .chat-pixel-spinner");
    if (group.running > 0 && spinner === null) group.element.querySelector(".chat-step-chevron")?.before(createPixelSpinner());
    if (group.running === 0) spinner?.remove();
  };

  const settleCall = (row: CallRow, ok: boolean): void => {
    if (row.status !== "running") return;
    row.status = ok ? "done" : "error";
    row.element.dataset["state"] = row.status;
    const mark = row.element.querySelector(".chat-step-call-mark");
    mark?.replaceChildren(createIcon(ok ? ICON.check : ICON.severityError));
    row.group.running = Math.max(0, row.group.running - 1);
    if (!ok) row.group.element.dataset["state"] = "error";
    const index = running.indexOf(row);
    if (index >= 0) running.splice(index, 1);
    paintGroup(row.group);
  };

  const append = (node: HTMLElement): void => {
    body.append(node);
  };

  /**
   * The answer is what came after the last step. Moving it out below the timeline is what
   * lets the folded turn read "Worked for 2m 31s", then the answer - not a closed box with
   * the answer inside it.
   */
  const releaseAnswer = (): void => {
    const children = [...body.children] as HTMLElement[];
    let lastStep = -1;
    children.forEach((child, index) => {
      if (child.dataset["step"] !== undefined) lastStep = index;
    });
    let anchor: Element = element;
    for (const child of children.slice(lastStep + 1)) {
      anchor.after(child);
      anchor = child;
    }
  };

  const setStatus = (text: string | null): void => {
    const clean = text?.trim() ?? "";
    status.textContent = clean;
    status.hidden = clean.length === 0;
  };

  return {
    element,
    startedAt,
    setStatus,
    thinking(text: string): void {
      if (text.length === 0) return;
      setStatus(null);
      if (element.dataset["state"] === "running") mascot.setMood("thinking");
      if (last?.kind === "thinking" && last.element.dataset["state"] === "running") {
        last.text += text;
        last.detail.append(document.createTextNode(text));
        // The summary is the first line; once that line is complete it stops changing.
        if (last.text.length < SUMMARY_LIMIT * 2) last.summary.textContent = thinkingSummary(last.text);
        return;
      }
      const shell = stepShell("thinking", "sparkle", "Thinking…");
      const summary = document.createElement("span");
      summary.className = "chat-step-summary";
      summary.textContent = thinkingSummary(text);
      shell.row.append(summary, createPixelSpinner(), chevron());
      shell.body.classList.add("is-thought");
      shell.body.append(document.createTextNode(text));
      append(shell.element);
      stepsSeen += 1;
      last = { kind: "thinking", element: shell.element, summary, detail: shell.body, text };
    },
    toolCall(call: ToolCallInput): void {
      settleThinking();
      setStatus(null);
      mascot.setMood("working");
      let group: GroupStep;
      if (last !== null && last.kind === "tools" && joinsToolGroup(last, call.name)) {
        group = last;
      } else {
        const shell = stepShell("tools", toolStepIcon(call.name), toolStepLabel(call.name));
        const count = document.createElement("span");
        count.className = "chat-step-count";
        count.hidden = true;
        const detail = document.createElement("span");
        detail.className = "chat-step-summary";
        shell.row.append(count, detail, chevron());
        const list = document.createElement("ol");
        list.className = "chat-step-calls";
        shell.body.append(list);
        append(shell.element);
        stepsSeen += 1;
        group = { kind: "tools", name: call.name, element: shell.element, count, detail, list, calls: 0, running: 0 };
        last = group;
      }
      group.calls += 1;
      group.running += 1;
      toolsSeen += 1;
      group.detail.textContent = call.detail;
      group.detail.title = call.detail;

      const item = document.createElement("li");
      item.className = "chat-step-call";
      item.dataset["state"] = "running";
      const mark = document.createElement("span");
      mark.className = "chat-step-call-mark";
      mark.append(createPixelSpinner());
      const text = document.createElement("span");
      text.className = "chat-step-call-text";
      text.textContent = call.detail.length > 0 ? call.detail : toolStepLabel(call.name);
      item.append(mark, text);
      group.list.append(item);

      const row: CallRow = { element: item, group, status: "running" };
      calls.set(call.id, row);
      running.push(row);
      paintGroup(group);
    },
    toolResult(id: string | null, ok: boolean): void {
      const row = (id === null ? undefined : calls.get(id)) ?? running[running.length - 1];
      if (row !== undefined) settleCall(row, ok);
      if (!ok && element.dataset["state"] === "running") mascot.setMood("error");
    },
    appendText(node: HTMLElement): void {
      settleThinking();
      setStatus(null);
      if (element.dataset["state"] === "running") mascot.setMood("streaming");
      append(node);
      last = { kind: "text" };
    },
    hasSteps(): boolean {
      return stepsSeen > 0;
    },
    finish(outcome: Exclude<TurnOutcome, "running"> | "auto"): void {
      if (element.dataset["state"] !== "running") return;
      if (clock !== null) window.clearInterval(clock);
      clock = null;
      settleThinking();
      // Every live row settles: a finished turn with a spinner still spinning reads as hung.
      for (const row of [...running]) settleCall(row, outcome !== "failed");
      setStatus(null);
      mascot.destroy();
      releaseAnswer();
      const resolved: Exclude<TurnOutcome, "running"> = outcome === "auto" ? (toolsSeen > 0 ? "worked" : "thought") : outcome;
      element.dataset["state"] = "done";
      element.dataset["outcome"] = resolved;
      paintHeading(resolved, (Date.now() - startedAt) / 1000);
      // Nothing happened but text: it has all been released, and there is no work to fold.
      if (stepsSeen === 0) {
        element.remove();
        return;
      }
      setCollapsed(true);
    },
    destroy(): void {
      if (clock !== null) window.clearInterval(clock);
      clock = null;
      mascot.destroy();
      element.remove();
      calls.clear();
      running.length = 0;
    },
  };
}
