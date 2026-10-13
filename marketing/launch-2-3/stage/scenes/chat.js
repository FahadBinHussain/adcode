/**
 * 3.6 – 26 s. One continuous take of the 2.3 chat.
 *
 * A slash command is typed and sent as typed. The Team's three agents work inside the
 * conversation, each in a live window: code types in, one hands its work on, the
 * reviewer's note sends the builder back to fix a date bug, and every window ends with
 * the checks it really ran. The Edited files card follows with per-file counts, a recorded
 * diff, and Undo. (A full-frame interlude covers 15.8 – 20.6.) Back in the composer, the
 * three ring meters; the daily allowance runs out, the chat waits for the reset, and
 * picking a local model carries the turn on at once.
 */
import { CUE, PROMPT } from "../cues.js";
import { aim, camera, ease, h, lerp, put, seg, spring, tf, typed } from "/shared/engine.js";
import { assistantFace, codeLine, icon, markInline, mascot, meter, pointer } from "../kit.js";

const VIEW = { w: 1920, h: 1080 };
const REDO = "Redo it with local dates";
const LOCAL = "Ollama · qwen2.5-coder";

const SHOTS = [
  { at: 0, cx: 800, cy: 500, s: 1.0 },
  { at: CUE.typeStart - 0.3, cx: 875, cy: 845, s: 1.3, move: 1.0 },
  { at: CUE.send + 0.1, cx: 875, cy: 450, s: 1.18, move: 0.9 },
  { at: CUE.agentsStart + 0.6, cx: 720, cy: 470, s: 1.5, move: 1.1 },
  { at: CUE.note - 0.35, cx: 1040, cy: 470, s: 1.5, move: 1.0 },
  { at: CUE.note + 0.65, cx: 720, cy: 470, s: 1.5, move: 0.9 },
  { at: CUE.checks[0] - 0.3, cx: 875, cy: 456, s: 1.22, move: 1.0 },
  { at: CUE.edits - 0.05, cx: 875, cy: 560, s: 1.25, move: 0.6 },
  { at: CUE.review + 0.05, cx: 875, cy: 500, s: 1.3, move: 0.9 },
  { at: 13.3, cx: 900, cy: 430, s: 1.45, move: 0.9 },
  { at: CUE.back, cx: 1150, cy: 868, s: 2.0, move: 0.01 },
  { at: CUE.meters + 0.6, cx: 1080, cy: 860, s: 1.8, move: 1.2 },
  { at: CUE.limit - 0.3, cx: 875, cy: 640, s: 1.3, move: 0.8 },
  { at: CUE.chip - 0.25, cx: 950, cy: 720, s: 1.4, move: 0.6 },
  { at: CUE.resumed + 0.1, cx: 875, cy: 620, s: 1.3, move: 0.8 },
];

/** Thread scroll, as [time, value]: content slides up as new items arrive. */
const SCROLL = [[CUE.edits, 190], [CUE.review, 410], [CUE.limit - 0.45, 620], [CUE.resumed, 640]];
function scrollAt(t) {
  let value = 0;
  for (const [at, to] of SCROLL) value = lerp(value, to, ease.inOutCubic(seg(t, at, at + 0.5)));
  return value;
}

const Y = { bubble: 18, team: 96, edits: 590, bubble2: 1024, notice: 1100, resumed: 1212 };
const AGENT_X = [0, 370.5, 741];

const BUILDER = [
  "export function streak(days) {",
  "  const done = new Set(days);",
  "  const day = new Date();",
  "  let count = 0;",
  "  while (done.has(key(day))) {",
  "    count += 1;",
  "    day.setDate(day.getDate() - 1);",
  "  }",
  "  return count;",
  "}",
];
const KEY_UTC = ["const key = (d) => d.toISOString()", "  .slice(0, 10);"];
const KEY_LOCAL = ["const key = (d) =>", "  d.toLocaleDateString(\"sv\");"];
const TESTER = [
  "import { streak } from \"./streaks\";",
  "",
  "test(\"counts back from today\", () => {",
  "  const days = [ago(1), ago(0)];",
  "  expect(streak(days)).toBe(2);",
  "});",
  "",
  "test(\"a gap resets it\", () => {",
  "  expect(streak([ago(2)])).toBe(0);",
  "});",
  "",
  "test(\"crosses a month end\", () => {",
];
const NOTES = [
  { at: 6.9, text: "Reading streaks.js and habits.js" },
  { at: 7.7, text: "1  key() uses UTC, so a streak breaks at midnight east of Greenwich." },
  { at: 8.3, text: "2  streak([]) returns 0. Good." },
  { at: 8.9, text: "3  Add a test that crosses a month end." },
  { at: 9.8, text: "Approved after the date fix." },
];
const DIFF = [
  ["", "@@ habits.js · render()"],
  [" ", "const row = h(\"li\", habit.name);"],
  ["-", "row.append(count(habit));"],
  ["+", "const n = streak(habit.days);"],
  ["+", "row.append(badge(`${n} day streak`));"],
  ["+", "if (n >= 7) row.classList.add(\"hot\");"],
  [" ", "list.append(row);"],
  ["", "@@ streaks.js"],
  ["+", "export function streak(days) {"],
];

/** Sum offsets up to `ancestor`: layout positions, unaffected by transforms. */
function offsetIn(element, ancestor) {
  let x = 0, y = 0, node = element;
  while (node && node !== ancestor) { x += node.offsetLeft; y += node.offsetTop; node = node.offsetParent; }
  return { x: x + element.offsetWidth / 2, y: y + element.offsetHeight / 2 };
}

function codeRows(lines, className = "") {
  return lines.map((line, i) => h("div", { class: `row ${className}` }, h("span", { class: "ln", text: String(i + 1) }), h("span", { class: "src" })));
}

export const chat = {
  id: "chat",
  from: CUE.chatIn,
  to: 26.6,
  mount(root) {
    const titlebar = h("div", { class: "titlebar" }, markInline(18), h("span", { class: "brand", text: "ADCode" }),
      ["File", "Edit", "Selection", "View", "Go", "Run", "Git", "Terminal", "Help"].map((m) => h("span", { class: "menu", text: m })),
      h("span", { class: "dots" }, h("i"), h("i"), h("i")));
    const nav = (name, label, selected = false) => h("div", { class: `side-item${selected ? " selected" : ""}` }, icon(name, 17), h("span", { text: label }));
    const side = h("div", { class: "side" },
      h("div", { class: "side-new" }, icon("plus", 16), h("span", { text: "New conversation" })),
      h("div", { class: "side-project" }, icon("folder", 17), h("div", {}, h("b", { text: "habits" }), h("small", { text: "~/code/habits" }))),
      nav("chat", "Chat", true), nav("agents", "Agents"), nav("tools", "Tools"),
      h("div", { class: "side-label", text: "History" }),
      ["Habit tracker", "Fix the login redirect", "Landing page copy", "Dark mode toggle"].map((label, i) => h("div", { class: `side-history${i === 0 ? " selected" : ""}`, text: label })));
    const header = h("div", { class: "header" }, h("b", { text: "Habit tracker" }), h("small", { text: "Team · 3 agents" }));

    // Thread items.
    this.bubble = h("div", { class: "bubble", style: { top: `${Y.bubble}px` } }, h("span", { class: "slash", text: "/team" }), h("span", { text: PROMPT.slice(6) }));
    this.teamStatus = h("span", { class: "team-status" });
    this.stop = h("div", { class: "team-stop" }, h("i"), h("span", { text: "Stop" }));
    const LOOKS = [
      { name: "Builder", shape: "squircle", color: "blue", file: "streaks.js" },
      { name: "Tester", shape: "capsule", color: "green", file: "streaks.test.js" },
      { name: "Reviewer", shape: "hexagon", color: "violet", file: "Review · read-only" },
    ];
    this.agents = LOOKS.map((look, i) => {
      const face = mascot(look.shape, look.color, 38);
      const step = h("div", { class: "agent-step" });
      const spin = h("span", { class: "agent-spin" });
      const plus = h("span", { class: "plus" });
      const code = h("div", { class: `agent-code${i === 2 ? " notes" : ""}` });
      const cmd = h("span", { class: "agent-cmd" });
      const chip = h("span", { class: "chip-pass" }, icon("check", 14), h("span", { text: i === 2 ? "Review done" : "Checks passed" }));
      const element = h("div", { class: "agent", style: { left: `${AGENT_X[i]}px` } },
        h("div", { class: "agent-head" }, face.element, h("div", {}, h("div", { class: "agent-name", text: look.name }), step), spin, h("span", { class: "agent-done" }, icon("check", 20))),
        h("div", { class: "agent-tab" }, icon(i === 2 ? "eye" : "file", 13), h("span", { text: look.file }), plus),
        code,
        h("div", { class: "agent-foot" }, cmd, chip));
      return { look, face, step, spin, plus, code, cmd, chip, element };
    });
    this.builderRows = codeRows([...BUILDER, ...KEY_UTC]);
    this.agents[0].code.append(...this.builderRows);
    this.testerRows = codeRows(TESTER);
    this.agents[1].code.append(...this.testerRows);
    this.noteRows = NOTES.map(() => h("div", { class: "row" }));
    this.agents[2].code.append(...this.noteRows);
    this.caret = h("span", { class: "caret" });
    this.speeches = [
      { from: 0, to: 1, at: CUE.handoff, element: h("div", { class: "speech", text: "streak() is ready to test" }), line: h("div", { class: "speech-line" }) },
      { from: 2, to: 0, at: CUE.note, element: h("div", { class: "speech", text: "Use local dates, not UTC" }), line: h("div", { class: "speech-line" }) },
    ];
    this.team = h("div", { class: "team", style: { top: `${Y.team}px` } },
      h("div", { class: "team-head" }, assistantFace(28), h("b", { text: "Team" }), this.teamStatus, this.stop),
      h("div", { class: "agents-row" }, this.speeches.map((s) => s.line), this.agents.map((a) => a.element), this.speeches.map((s) => s.element)));

    const counts = (added, removed) => h("span", { class: "counts" }, h("span", { class: "added", text: `+${added}` }), removed ? h("span", { class: "removed", text: `−${removed}` }) : null);
    this.editsTitle = h("span", { class: "edits-title", text: "Edited 3 files" });
    this.undo = h("span", { class: "btn", text: "Undo" });
    this.review = h("span", { class: "btn", text: "Review" });
    this.diff = h("div", { class: "diff" }, h("div", { style: { padding: "8px 0" } },
      DIFF.map(([sign, text]) => h("div", { class: `row${sign === "+" ? " add" : sign === "-" ? " del" : ""}`, style: sign === "" ? { color: "#8f8c85" } : {} },
        h("span", { class: "sign", text: sign }), h("span", {}, sign === "" ? text : codeLine(text))))));
    this.edits = h("div", { class: "edits", style: { top: `${Y.edits}px` } },
      h("div", { class: "edits-head" }, h("span", { class: "edits-icon" }, icon("file", 17)), h("div", {}, this.editsTitle, h("div", {}, counts(38, 3))),
        h("div", { class: "edits-actions" }, this.undo, this.review)),
      [["habits.js", 18, 3], ["streaks.js", 12, 0], ["streaks.test.js", 8, 0]].map(([name, a, r]) => h("div", { class: "edits-row" }, h("span", { text: name }), counts(a, r))),
      this.diff);

    this.bubble2 = h("div", { class: "bubble", style: { top: `${Y.bubble2}px` }, text: REDO });
    const RING = 2 * Math.PI * 20;
    this.noticeArc = h("circle", { cx: 23, cy: 23, r: 20, class: "arc", "stroke-dasharray": `${RING} ${RING}` });
    this.noticeRing = RING;
    this.noticeTitle = h("b");
    this.noticeBody = h("small");
    this.noticeWait = h("span", { class: "notice-wait" });
    this.notice = h("div", { class: "notice", style: { top: `${Y.notice}px` } },
      h("svg", { viewBox: "0 0 46 46", class: "notice-ring" }, h("circle", { cx: 23, cy: 23, r: 20, class: "track" }), this.noticeArc),
      h("div", {}, this.noticeTitle, this.noticeBody), this.noticeWait);
    this.resumedFace = mascot("squircle", "blue", 30);
    this.resumedBar = h("i");
    this.resumed = h("div", { class: "resumed", style: { top: `${Y.resumed}px` } },
      this.resumedFace.element, h("b", { text: "Builder" }), h("span", { text: "Rewriting key() with local dates" }), h("span", { class: "bar" }, this.resumedBar));

    this.scroll = h("div", { class: "thread-scroll" }, this.bubble, this.team, this.edits, this.bubble2, this.notice, this.resumed);
    const thread = h("div", { class: "thread" }, this.scroll);

    // Composer.
    this.input = h("span");
    this.placeholder = h("span", { class: "placeholder", text: "Ask, build, / for commands, @ for context…" });
    this.composerCaret = h("span", { class: "composer-caret" });
    this.modelName = h("span");
    this.modelTag = h("small");
    this.modelDot = h("span", { class: "model-dot" });
    this.chip = h("div", { class: "model-chip" }, this.modelDot, this.modelName, this.modelTag);
    this.meters = [meter("Context"), meter("Tokens used"), meter("Requests")];
    this.send = h("div", { class: "send" }, icon("arrowUp", 20));
    const composer = h("div", { class: "composer" },
      h("div", { class: "composer-input" }, this.placeholder, this.input, this.composerCaret),
      h("div", { class: "composer-foot" }, h("span", { text: "+ Attach" }), h("span", { text: "@ Files" }), h("span", { class: "gap" }),
        this.chip, this.meters.map((m) => m.element), this.send));

    // The model menu.
    const row = (logo, name, detail, tag, tagClass = "") => h("div", { class: "menu-row" }, h("span", { class: "menu-icon", text: logo }),
      h("div", {}, h("b", { text: name }), h("small", { text: detail })), h("span", { class: `tag ${tagClass}`, text: tag }));
    this.menuRows = [
      row("T", "Tagflow Code 27B", "Included AI · 256k context", "Allowance used", "used"),
      row("O", LOCAL, "On this computer", "Local"),
      row("R", "OpenRouter", "Your key", "Your key"),
    ];
    this.menu = h("div", { class: "menu-pop" },
      h("div", { class: "menu-group", text: "Free · no API key" }), this.menuRows[0],
      h("div", { class: "menu-group", text: "Local" }), this.menuRows[1],
      h("div", { class: "menu-group", text: "Bring your own key" }), this.menuRows[2]);

    this.cursor = h("div", { class: "cursor" }, pointer());
    this.app = h("div", { class: "app" }, titlebar, side, header, thread, composer, this.menu, this.cursor);
    this.camera = h("div", { class: "camera" }, this.app);
    this.layer = h("div", { class: "layer" }, h("div", { class: "glow" }), h("div", { class: "viewport" }, this.camera));
    root.append(this.layer);
  },

  /** Where things are inside the window, measured once the fonts have laid them out. */
  measure() {
    if (this.spots) return;
    const scrolled = (element) => {
      const at = offsetIn(element, this.scroll);
      return { x: at.x + 270 + 60, y: at.y + 100 };
    };
    this.spots = {
      undo: scrolled(this.undo),
      review: scrolled(this.review),
      chip: offsetIn(this.chip, this.app),
      chipBox: { left: this.chip.offsetLeft, width: this.chip.offsetWidth },
      menuHeight: this.menu.offsetHeight,
      menuRow: this.menuRows[1].offsetTop + this.menuRows[1].offsetHeight / 2,
    };
  },

  draw(t) {
    this.measure();
    put(this.camera, { transform: aim(camera(t, SHOTS), VIEW.w, VIEW.h) });
    const scroll = scrollAt(t);
    put(this.scroll, { transform: `translateY(${(-scroll).toFixed(2)}px)` });

    this.drawComposer(t);
    this.drawTeam(t);
    this.drawEdits(t);
    this.drawLimit(t);
    this.drawCursor(t, scroll);
  },

  drawComposer(t) {
    let text = "";
    if (t >= CUE.typeStart && t < CUE.send) text = typed(PROMPT, t, CUE.typeStart, CUE.typeRate);
    if (t >= CUE.meters + 0.2 && t < CUE.redo) text = typed(REDO, t, CUE.meters + 0.2, 34);
    this.input.replaceChildren(...(text.startsWith("/") ? [h("span", { class: "slash", text: text.slice(0, 5) }), text.slice(5)] : [text]));
    this.placeholder.style.display = text ? "none" : "inline";
    put(this.composerCaret, { opacity: Math.floor(t * 2.6) % 2 === 0 || text ? 1 : 0 });
    const pressed = (at) => 1 - 0.12 * Math.sin(Math.PI * seg(t, at - 0.06, at + 0.1));
    put(this.send, { transform: tf({ s: pressed(CUE.send) * pressed(CUE.redo) }) });

    const local = t >= CUE.pick;
    this.modelName.textContent = local ? LOCAL : "Tagflow Code 27B";
    this.modelTag.textContent = local ? "Local" : "Included";
    this.modelDot.style.display = local ? "none" : "block";
    const chipPress = 1 - 0.08 * Math.sin(Math.PI * seg(t, CUE.menu - 0.08, CUE.menu + 0.08));
    put(this.chip, { transform: tf({ s: chipPress }) });

    // Context grows with the conversation; the allowance runs out after the redo.
    const context = t < CUE.send ? 0.03 : t < CUE.redo ? lerp(0.03, 0.18, seg(t, CUE.send, CUE.teamDone)) : lerp(0.18, 0.24, seg(t, CUE.redo, CUE.redo + 0.4));
    this.meters[0].update(context, `${Math.round(context * 100)}%`, `${Math.round(context * 256)}k of 256k`);
    if (local) {
      this.meters[0].update(0.24, "24%", "8k of 32k");
      this.meters[1].update(0, "3k", "recorded · no account limit", true);
      this.meters[1].element.dataset.tone = "ok";
    } else {
      const used = t < CUE.meters
        ? lerp(0.41, 0.6, seg(t, CUE.team, CUE.teamDone))
        : t < CUE.redo ? lerp(0.6, 0.86, ease.outCubic(seg(t, CUE.meters, CUE.meters + 0.8)))
          : lerp(0.86, 1, ease.inOutCubic(seg(t, CUE.redo + 0.1, CUE.limit - 0.05)));
      this.meters[1].update(used, `${Math.round(used * 100)}%`, used >= 1 ? "1M of 1M today" : `${Math.round(used * 1000)}k of 1M today`);
      this.meters[1].element.dataset.tone = used >= 1 ? "full" : "ok";
    }
    const requests = 180 + Math.floor(seg(t, CUE.team, CUE.teamDone) * 28) + (t > CUE.redo ? 1 : 0);
    this.meters[2].update(0, String(requests), "no request limit", true);

    // The menu above the chip.
    const open = t >= CUE.menu && t < CUE.pick + 0.15;
    const pop = open ? spring(t - CUE.menu, 320, 22) : 0;
    const { chip, chipBox } = this.spots;
    put(this.menu, { left: `${(chip.x - chipBox.width / 2 - 40).toFixed(1)}px`, top: `${786 - 10 - this.spots.menuHeight}px`, opacity: open ? Math.min(1, (t - CUE.menu) * 8) : 0, transform: tf({ s: lerp(0.92, 1, pop), y: lerp(14, 0, pop) }) });
    this.menuRows[1].dataset.hot = String(t > 23.85);
    const pickPress = 1 - 0.04 * Math.sin(Math.PI * seg(t, CUE.pick - 0.06, CUE.pick + 0.1));
    put(this.menuRows[1], { transform: tf({ s: pickPress }) });
  },

  drawTeam(t) {
    const sent = t >= CUE.send;
    put(this.bubble, { opacity: sent ? ease.outCubic(seg(t, CUE.send, CUE.send + 0.25)) : 0, transform: tf({ y: lerp(16, 0, ease.outCubic(seg(t, CUE.send, CUE.send + 0.3))) }) });
    const team = ease.outCubic(seg(t, CUE.team, CUE.team + 0.4));
    put(this.team, { opacity: team, transform: tf({ y: lerp(20, 0, team) }) });
    const done = t >= CUE.teamDone;
    this.teamStatus.textContent = done ? "All 3 done · checks passed" : t > CUE.note ? "3 agents working · 2 messages" : t > CUE.handoff ? "3 agents working · 1 message" : "3 agents working";
    this.stop.style.display = done ? "none" : "flex";

    this.agents.forEach((agent, i) => {
      const enter = ease.outCubic(seg(t, CUE.agentsStart + i * 0.1, CUE.agentsStart + i * 0.1 + 0.45));
      put(agent.element, { opacity: enter, transform: tf({ y: lerp(30, 0, enter), s: lerp(0.96, 1, enter) }) });
      const checked = t >= CUE.checks[i];
      agent.element.dataset.done = String(checked);
      put(agent.spin, { transform: `rotate(${(t * 400) % 360}deg)` });
      const chipIn = checked ? spring(t - CUE.checks[i], 300, 16) : 0;
      put(agent.chip, { opacity: checked ? 1 : 0, transform: tf({ s: lerp(0.6, 1, chipIn) }) });
    });

    // Builder: the function, a note arrives, the key() fix.
    const [builder, tester, reviewer] = this.agents;
    const fixed = t >= CUE.note + 0.3;
    const builderLines = [...BUILDER, ...(fixed ? KEY_LOCAL : KEY_UTC)];
    const fullText = BUILDER.join("\n");
    const firstShown = typed(fullText + "\n" + KEY_UTC.join("\n"), t, 6.45, 190).split("\n");
    const fixShown = typed(KEY_LOCAL.join("\n"), t, CUE.note + 0.35, 70).split("\n");
    let caretRow = -1;
    this.builderRows.forEach((row, i) => {
      const src = row.lastChild;
      let text = "";
      if (i < BUILDER.length) text = firstShown[i] ?? "";
      else text = fixed ? (fixShown[i - BUILDER.length] ?? "") : (firstShown[i] ?? "");
      src.replaceChildren(...codeLine(text));
      if (text.length > 0 && text.length < builderLines[i].length) caretRow = i;
      row.style.background = fixed && i >= BUILDER.length && t < CUE.checks[0] ? "rgba(111,185,143,.1)" : "transparent";
    });
    if (caretRow < 0 && t < CUE.checks[0] && t > 6.45) caretRow = fixed ? builderLines.length - 1 : 11;
    if (caretRow >= 0 && Math.floor(t * 4) % 2 === 0) this.builderRows[caretRow].lastChild.append(this.caret);
    builder.step.textContent = t < 6.45 ? "Reading habits.js" : t < 7.55 ? "Writing streaks.js" : t < CUE.note ? "Waiting for review" : t < 9.3 ? "Fixing key() · from Reviewer" : t < CUE.checks[0] ? "Running typecheck" : "Done";
    builder.plus.textContent = `+${t < 7.55 ? Math.round(12 * seg(t, 6.45, 7.55)) : 12}`;
    builder.cmd.textContent = t >= 9.3 ? "$ npm run typecheck" : "";

    // Tester: waits for streak(), then writes and runs the tests.
    const testText = typed(TESTER.join("\n"), t, CUE.handoff + 0.45, 120).split("\n");
    this.testerRows.forEach((row, i) => row.lastChild.replaceChildren(...codeLine(testText[i] ?? "")));
    const testerTyping = t > CUE.handoff + 0.45 && t < CUE.checks[1];
    if (testerTyping && Math.floor(t * 4) % 2 === 0) this.testerRows[Math.min(testText.length, TESTER.length) - 1].lastChild.append(this.caret.cloneNode());
    tester.step.textContent = t < CUE.handoff + 0.4 ? "Waiting for streak()" : t < 9.7 ? "Writing streaks.test.js" : t < CUE.checks[1] ? "Running the tests" : "Done · 6 passed";
    tester.plus.textContent = t < CUE.handoff + 0.45 ? "" : `+${Math.min(8, Math.round(8 * seg(t, CUE.handoff + 0.45, 9.6)))}`;
    tester.cmd.textContent = t >= 9.7 ? "$ npm test · 6 passed" : "";

    // Reviewer: read-only notes.
    NOTES.forEach((note, i) => {
      this.noteRows[i].textContent = typed(note.text, t, note.at, 80);
      this.noteRows[i].style.color = i === 0 || i === 4 ? "#8f8c85" : "#cfccc4";
      this.noteRows[i].style.marginBottom = "8px";
    });
    reviewer.step.textContent = t < 7.7 ? "Reading 2 files" : t < CUE.checks[2] ? "Reviewing streaks.js" : "Done · 3 notes";
    reviewer.cmd.textContent = "Read-only";

    // Moods.
    const mood = (i) => {
      if (t >= CUE.checks[i] + 0.5) return "happy";
      if (t >= CUE.checks[i]) return "proud";
      for (const speech of this.speeches) if (speech.to === i && t > speech.at + 0.45 && t < speech.at + 1.0) return "alert";
      return i === 1 && t < CUE.handoff + 0.45 ? "sleepy" : "thinking";
    };
    this.agents.forEach((agent, i) => {
      agent.face.setMood(mood(i));
      let bounce = 0;
      for (const speech of this.speeches) if (speech.to === i) bounce = Math.max(bounce, Math.sin(Math.PI * seg(t, speech.at + 0.45, speech.at + 0.75)));
      const pop = t >= CUE.checks[i] ? Math.sin(Math.PI * seg(t, CUE.checks[i], CUE.checks[i] + 0.35)) : 0;
      put(agent.face.body, { transform: tf({ y: -4 * bounce - 3 * pop, s: 1 + 0.12 * pop, sy: (1 + 0.12 * pop) * (1 - 0.05 * bounce) }) });
    });

    // Speech bubbles cross from one mascot to another; the line stays underneath.
    for (const speech of this.speeches) {
      const travel = ease.inOutCubic(seg(t, speech.at, speech.at + 0.45));
      const fromX = AGENT_X[speech.from] + 30;
      const toX = AGENT_X[speech.to] + 30;
      const x = lerp(fromX, toX, travel);
      const alive = t >= speech.at && t < speech.at + 1.5;
      const fade = 1 - seg(t, speech.at + 1.2, speech.at + 1.5);
      put(speech.element, {
        transform: tf({ x: x + (speech.to < speech.from ? 0 : 0), y: -26 - 10 * Math.sin(Math.PI * travel), s: lerp(0.7, 1, Math.min(1, (t - speech.at) * 6)) }),
        opacity: alive ? fade : 0,
      });
      const left = Math.min(fromX, toX) + 19;
      const width = Math.abs(toX - fromX);
      put(speech.line, {
        transform: `translate(${left}px, 31px) scaleX(${(t >= speech.at ? seg(t, speech.at, speech.at + 0.45) : 0).toFixed(3)})`,
        transformOrigin: speech.to > speech.from ? "0 50%" : "100% 50%",
        width: `${width}px`,
        opacity: t >= speech.at && !done ? 0.9 : 0,
        zIndex: 0,
      });
    }
  },

  drawEdits(t) {
    const enter = ease.outCubic(seg(t, CUE.edits, CUE.edits + 0.45));
    put(this.edits, { opacity: enter, transform: tf({ y: lerp(24, 0, enter) }) });
    const open = ease.inOutCubic(seg(t, CUE.review, CUE.review + 0.45));
    put(this.diff, { height: `${(212 * open).toFixed(1)}px` });
    const undone = t >= CUE.undoPress + 0.05;
    this.edits.dataset.undone = String(undone);
    this.editsTitle.textContent = undone ? "Undid edits to 3 files" : "Edited 3 files";
    this.undo.style.display = undone ? "none" : "grid";
    const press = (at) => 1 - 0.1 * Math.sin(Math.PI * seg(t, at - 0.06, at + 0.1));
    put(this.undo, { transform: tf({ s: press(CUE.undoPress) }), background: t > 13.6 && !undone ? "rgba(236,233,226,.12)" : "transparent" });
    put(this.review, { transform: tf({ s: press(CUE.review) }), background: t > CUE.review ? "rgba(236,233,226,.12)" : "transparent" });
  },

  drawLimit(t) {
    const bubble = ease.outCubic(seg(t, CUE.redo, CUE.redo + 0.3));
    put(this.bubble2, { opacity: bubble, transform: tf({ y: lerp(16, 0, bubble) }) });
    const notice = ease.outCubic(seg(t, CUE.limit, CUE.limit + 0.4));
    put(this.notice, { opacity: notice, transform: tf({ y: lerp(20, 0, notice) }) });
    const resumed = t >= CUE.pick;
    this.notice.dataset.state = resumed ? "resumed" : "waiting";
    this.noticeTitle.textContent = resumed ? `Continued on ${LOCAL}` : "Included AI's daily allowance is used up";
    this.noticeBody.textContent = resumed
      ? "The conversation, its summary and finished tool results came along."
      : "This chat resumes by itself at 00:00 while ADCode stays open. Or pick another model now.";
    const left = 5 * 3600 + 42 * 60 + 18 - Math.floor(Math.max(0, t - CUE.limit) * 3);
    const clock = [Math.floor(left / 3600), Math.floor(left / 60) % 60, left % 60].map((n) => String(n).padStart(2, "0")).join(":");
    this.noticeWait.textContent = resumed ? "Resumed" : `Resumes in ${clock}`;
    const arc = resumed ? 1 : 0.24 - 0.01 * seg(t, CUE.limit, CUE.pick);
    this.noticeArc.setAttribute("stroke-dashoffset", String(this.noticeRing * (1 - arc)));
    this.noticeArc.style.stroke = resumed ? "var(--success)" : "";

    const card = ease.outCubic(seg(t, CUE.resumed, CUE.resumed + 0.4));
    put(this.resumed, { opacity: card, transform: tf({ y: lerp(18, 0, card) }) });
    this.resumedFace.setMood("thinking");
    put(this.resumedBar, { transform: `scaleX(${(0.12 + 0.7 * seg(t, CUE.resumed, 26)).toFixed(4)})` });
  },

  drawCursor(t, scroll) {
    const { undo, review, chip } = this.spots;
    const at = (spot) => ({ x: spot.x - 6, y: spot.y - scroll - 4 });
    const menuRow = { x: chip.x - this.spots.chipBox.width / 2 + 170, y: 786 - 10 - this.spots.menuHeight + this.spots.menuRow };
    const paths = [
      { from: 12.0, to: 14.7, points: [
        { t: 12.0, x: at(review).x + 260, y: at(review).y + 260 },
        { t: 12.33, ...at(review) },
        { t: 13.45, ...at(review) },
        { t: 13.85, ...at(undo) },
        { t: 14.15, ...at(undo) },
        { t: 14.7, x: at(undo).x + 300, y: at(undo).y + 260 },
      ] },
      { from: 23.0, to: 24.75, points: [
        { t: 23.0, x: chip.x + 260, y: chip.y - 220 },
        { t: 23.42, x: chip.x - 6, y: chip.y - 4 },
        { t: 23.6, x: chip.x - 6, y: chip.y - 4 },
        { t: 23.92, x: menuRow.x, y: menuRow.y },
        { t: 24.15, x: menuRow.x, y: menuRow.y },
        { t: 24.75, x: menuRow.x + 320, y: menuRow.y + 260 },
      ] },
    ];
    const path = paths.find((p) => t >= p.from && t < p.to);
    if (!path) return put(this.cursor, { opacity: 0 });
    let point = path.points[0];
    for (let i = 1; i < path.points.length; i += 1) {
      const a = path.points[i - 1], b = path.points[i];
      if (t >= a.t) {
        const p = ease.inOutCubic(seg(t, a.t, b.t));
        point = { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p) };
      }
    }
    const clicks = [CUE.review, CUE.undoPress, CUE.menu, CUE.pick];
    const press = Math.max(...clicks.map((c) => Math.sin(Math.PI * seg(t, c - 0.06, c + 0.1))));
    const fade = Math.min(seg(t, path.from, path.from + 0.15), 1 - seg(t, path.to - 0.25, path.to));
    put(this.cursor, { transform: tf({ x: point.x, y: point.y, s: 1 - 0.14 * press }), opacity: fade });
  },
};
