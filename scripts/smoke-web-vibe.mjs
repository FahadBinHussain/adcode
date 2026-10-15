/*
 * The web version, end to end, on this computer.
 *
 *   npm run smoke:web-vibe            (builds adcode-host first)
 *   npm run smoke:web-vibe -- --no-build
 *
 * Starts adcode-host and the web page (`scripts/web-vibe.mjs`), a fake OpenAI-compatible model,
 * and a headless Edge, then does what a first visitor does: signs in (dev mode), describes a
 * page, watches the agent write it, previews it, sees it under Changes, commits it, loses the
 * connection and gets it back, and checks the page on a phone.
 *
 * Read the printed values, not just the exit code.
 *
 * Env: ADCODE_SMOKE_PORT (9473, DevTools), ADCODE_HOST_PORT (7320), ADCODE_WEB_PORT (5181),
 *      ADCODE_SHOTS (folder for screenshots).
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { launchBrowser } from "./lib/headlessEdge.mjs";

const REPO = process.cwd();
const require = createRequire(join(REPO, "package.json"));
const vite = join(dirname(require.resolve("vite/package.json")), "bin", "vite.js");
const HOST_PORT = process.env["ADCODE_HOST_PORT"] ?? "7320";
const WEB_PORT = process.env["ADCODE_WEB_PORT"] ?? "5181";
const SHOTS = process.env["ADCODE_SHOTS"] ?? null;
const PROMPT = "web-smoke: a landing page for a bakery";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ── A fake model that builds one page ─────────────────────────────────── */

const PAGE = "<!doctype html><html><head><title>Bakery smoke</title></head><body><h1>Fresh bread daily</h1></body></html>";
const SLOW_PROMPT = "parallel-slow";
const FAST_PROMPT = "parallel-fast";
const LONG_PROMPT = "keep-going-smoke";
const FAIL_PROMPT = "parallel-fail";
/** When the fake model was sent the main process's own "Continue" - the page was frozen then. */
let keptGoingAt = 0;
const requests = [];
let viewPageReport = "";
const fake = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body || "{}");
  requests.push(request);
  const messages = request.messages ?? [];
  const userTexts = messages.filter((message) => message.role === "user").map((message) => String(message.content));
  const said = (words) => userTexts.some((text) => text.includes(words));
  const answer = (deltas) => {
    const last = deltas.at(-1);
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`${deltas.map((delta) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta === last ? (last.tool_calls ? "tool_calls" : "stop") : null }] })}\n\n`).join("")}data: [DONE]\n\n`);
  };
  // Two chats at once: one slow enough to still be working when the other has finished.
  if (said(SLOW_PROMPT)) {
    await sleep(6_000);
    return answer([{ content: "Slow chat done." }]);
  }
  if (said(FAST_PROMPT)) return answer([{ content: "Fast chat done." }]);
  // A chat that fails while another is on screen: refused outright, not worth a retry.
  if (said(FAIL_PROMPT)) {
    await sleep(1_500);
    res.writeHead(400, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: { message: "smoke: refused on purpose" } }));
  }
  // A long job: list files until the step limit, then - only once the main process has said
  // "Continue" by itself - finish. Each list is its own call, so none is a repeated failure.
  if (said(LONG_PROMPT)) {
    if (userTexts.at(-1)?.includes("Continue from where you stopped")) {
      keptGoingAt = Date.now();
      return answer([{ content: "Kept going and finished." }]);
    }
    const step = messages.filter((message) => message.role === "tool").length;
    return answer([{ tool_calls: [{ index: 0, id: `list-${String(step)}`, function: { name: "list_files", arguments: JSON.stringify({ path: "." }) } }] }]);
  }
  const start = messages.findLastIndex((message) => message.role === "user" && String(message.content).includes(PROMPT));
  const answered = start === -1 ? 0 : messages.slice(start + 1).filter((message) => message.role === "tool").length;
  // Write the page, then look at it with the agent's own browser, then answer.
  const lastTool = start === -1 ? "" : String(messages.filter((message) => message.role === "tool").at(-1)?.content ?? "");
  if (start !== -1 && answered === 2) viewPageReport = lastTool;
  // The first step thinks and says what it will do before writing, as a real model does, so
  // the turn's timeline has a thought, text between steps, and tool rows to show.
  const deltas = start !== -1 && answered === 0
    ? [
      { reasoning_content: "**Planning the bakery page**\nOne index.html with a headline, then check it on a phone." },
      { content: "I will write the page, then check it on a phone." },
      { tool_calls: [{ index: 0, id: "write-1", function: { name: "propose_edit", arguments: JSON.stringify({ path: "index.html", contents: PAGE, summary: "Add the bakery page" }) } }] },
    ]
    : start !== -1 && answered === 1
      ? [{ tool_calls: [{ index: 0, id: "look-1", function: { name: "view_page", arguments: JSON.stringify({ path: "index.html", width: 390, height: 844, screenshot: true }) } }] }]
      : [{ content: "Done - your bakery page is ready." }];
  // A beat before looking at the page, so the smoke can see the turn while it is still working.
  if (start !== -1 && answered === 1) await sleep(2_500);
  const last = deltas.at(-1);
  const finish = last.tool_calls ? "tool_calls" : "stop";
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(`${deltas.map((delta) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta === last ? finish : null }] })}\n\n`).join("")}data: [DONE]\n\n`);
});
await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${fake.address().port}/v1`;

/* ── The stack ─────────────────────────────────────────────────────────── */

if (!process.argv.includes("--no-build")) {
  const built = spawnSync(process.execPath, [vite, "build", "-c", "apps/desktop/vite.host.config.ts", "--logLevel", "warn"], { stdio: "inherit" });
  if (built.status !== 0) process.exit(built.status ?? 1);
}

const home = await mkdtemp(join(tmpdir(), "adcode-web-smoke-"));
let stackLog = "";
const stack = spawn(process.execPath, ["scripts/web-vibe.mjs", "--no-build"], {
  env: { ...process.env, ADCODE_HOME: home, ADCODE_HOST_PORT: HOST_PORT, ADCODE_WEB_PORT: WEB_PORT, ADCODE_AD_SERVER: "http://127.0.0.1:9" },
  stdio: ["ignore", "pipe", "pipe"],
});
stack.stdout.on("data", (chunk) => { stackLog += chunk; });
stack.stderr.on("data", (chunk) => { stackLog += chunk; });

for (let attempt = 0; attempt < 120; attempt += 1) {
  try {
    if ((await fetch(`http://127.0.0.1:${WEB_PORT}/`)).ok && (await fetch(`http://127.0.0.1:${HOST_PORT}/__adcode/health`)).ok) break;
  } catch {
    // starting
  }
  await sleep(500);
}

const checks = {};
const browser = await launchBrowser({ port: Number(process.env["ADCODE_SMOKE_PORT"] ?? 9473) });
const shot = async (name) => {
  if (SHOTS !== null) await browser.screenshot(join(SHOTS, `web-${name}.png`));
};

try {
  await browser.viewport(1280, 820);
  await browser.goto(`http://localhost:${WEB_PORT}/`);
  checks.gateShown = await browser.waitFor("document.querySelector('.web-gate-card')", { timeoutMs: 60_000 });
  await shot("gate");
  checks.gateDevMode = await browser.evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('dev mode')); button?.click(); return Boolean(button); })()`);
  checks.vibeVisible = await browser.waitFor("document.querySelector('.vibe-pages') && document.body.dataset.sessionReady === 'true'", { timeoutMs: 90_000 });
  checks.onboardingAsks = await browser.waitFor("document.querySelector('dialog.onboarding')?.open", { timeoutMs: 15_000 });
  checks.desktopButtonInsteadOfIde = await browser.evaluate("[...document.querySelectorAll('.vibe-ide-button')].map((b) => b.textContent.trim()).join('|')");

  // Connected first, so "Build it" goes straight to building rather than asking for a model.
  await browser.evaluate(`(async () => {
    await window.adcode.settings.write('adcode.ai.customBaseUrl', ${JSON.stringify(endpoint)});
    await window.adcode.settings.write('adcode.ai.provider', 'custom');
    await window.adcode.settings.write('adcode.ai.model', 'smoke-model');
    await window.adcode.settings.write('adcode.ai.editPolicy', 'trusted');
    await window.adcode.ai.setKey('custom', 'local-smoke-key');
    return true;
  })()`);
  checks.modelReady = await browser.waitFor("window.adcode.ai.status().then((status) => status.ready)", { timeoutMs: 20_000 });

  // What a first visitor does: describe it in the onboarding sheet and press Build it.
  await browser.evaluate(`(() => {
    const box = document.querySelector('dialog.onboarding .onboarding-idea');
    box.value = ${JSON.stringify(PROMPT)};
    box.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('dialog.onboarding .onboarding-next').click();
    return true;
  })()`);
  // While it works: one timeline with its heading live, the pixel spinner at the foot.
  checks.timelineWhileWorking = await browser.waitFor(`document.querySelector('.chat-turn[data-state="running"] .chat-step.is-tools') !== null`, { timeoutMs: 90_000 });
  checks.liveHeading = await browser.evaluate(`document.querySelector('.chat-turn[data-state="running"] .chat-turn-lead')?.textContent ?? null`);
  checks.spinnerAtFoot = await browser.evaluate(`(() => {
    const spinner = document.querySelector('.chat-working:not([hidden]) .chat-pixel-spinner');
    return spinner !== null && spinner.getBoundingClientRect().width > 0;
  })()`);
  checks.mascotsWhileWorking = await browser.evaluate("document.querySelectorAll('.chat-transcript .chat-mascot').length");
  await shot("chat-working");
  checks.chatReply = await browser.waitFor("[...document.querySelectorAll('.chat-bubble-assistant')].some((bubble) => bubble.textContent.includes('bakery page is ready'))", { timeoutMs: 90_000 });
  // Once it is done: folded to "Worked for", the answer below the fold, the steps inside it.
  await browser.waitFor(`document.querySelector('.chat-turn[data-state="done"]') !== null`, { timeoutMs: 20_000 });
  checks.timeline = await browser.evaluate(`(() => {
    const turn = document.querySelector('.chat-turn[data-state="done"]');
    if (turn === null) return null;
    const bubbles = [...document.querySelectorAll('.chat-bubble-assistant')];
    const answer = bubbles.find((bubble) => bubble.textContent.includes('bakery page is ready'));
    const between = bubbles.find((bubble) => bubble.textContent.includes('then check it on a phone'));
    return ({
      heading: turn.querySelector('.chat-turn-lead').textContent,
      folded: turn.dataset.collapsed === 'true',
      answerOutsideFold: answer !== undefined && !turn.contains(answer),
      textBetweenStepsInFold: between !== undefined && turn.contains(between),
      thought: turn.querySelector('.chat-step.is-thinking .chat-step-summary')?.textContent ?? null,
      toolRows: [...turn.querySelectorAll('.chat-step.is-tools .chat-step-label')].map((label) => label.textContent),
      mascotsLeft: document.querySelectorAll('.chat-transcript .chat-mascot').length,
    });
  })()`);
  // Unfolding shows the steps again; opening a step shows its calls.
  checks.unfolds = await browser.evaluate(`(async () => {
    const turn = document.querySelector('.chat-turn[data-state="done"]');
    turn.querySelector('.chat-turn-toggle').click();
    turn.querySelector('.chat-step.is-tools .chat-step-row').click();
    turn.querySelector('.chat-step.is-thinking .chat-step-row').click();
    await new Promise((resolve) => setTimeout(resolve, 600));
    const call = turn.querySelector('.chat-step.is-tools .chat-step-call');
    return turn.dataset.collapsed === 'false' && call !== null && call.getBoundingClientRect().height > 0 && call.dataset.state === 'done';
  })()`);
  await shot("chat-timeline");
  const project = await browser.evaluate("window.adcode.workspace.current()");
  checks.projectCreated = project?.name ?? null;
  checks.sidebarShowsProject = await browser.evaluate(`document.querySelector('.vibe-sidebar')?.textContent.includes(${JSON.stringify(project?.name ?? "?")}) ?? false`);
  await sleep(800);
  await shot("chat");

  const sep = project.root.includes("\\") ? "\\" : "/";
  const file = await browser.evaluate(`window.adcode.files.read(${JSON.stringify(`${project.root}${sep}index.html`)}).then((content) => content.text ?? content.content ?? JSON.stringify(content))`);
  checks.fileWritten = typeof file === "string" && file.includes("Fresh bread daily");

  const preview = await browser.evaluate("window.adcode.preview.start().then((status) => status)");
  let previewUrl = preview?.url ?? null;
  for (let attempt = 0; previewUrl === null && attempt < 40; attempt += 1) {
    await sleep(500);
    previewUrl = (await browser.evaluate("window.adcode.preview.status()"))?.url ?? null;
  }
  checks.previewUrl = previewUrl;
  checks.previewServes = previewUrl === null ? false : (await (await fetch(previewUrl)).text()).includes("Fresh bread daily");

  const status = await browser.evaluate("window.adcode.git.status()");
  checks.changesShowsFile = JSON.stringify(status ?? null).includes("index.html");
  await browser.evaluate("window.adcode.git.stage(['index.html'])").catch(() => null);
  const committed = await browser.evaluate("window.adcode.git.commit('Bakery page from the web smoke').then(() => window.adcode.git.log(1))").catch((error) => String(error));
  checks.commitWorks = JSON.stringify(committed).includes("Bakery page from the web smoke");

  checks.uploadWorks = await browser.evaluate(`(async () => {
    const root = await window.__adcodeTestOp("createProjectFolder", ["Uploaded site"]);
    await window.__adcodeTestOp("writeFile", [root, "css/site.css", new TextEncoder().encode("h1 { color: red }")]);
    const escaped = await window.__adcodeTestOp("writeFile", [root, "../outside.txt", new Uint8Array([1])]).then(() => true, () => false);
    const projects = await window.__adcodeTestOp("projects", []);
    return projects.some((project) => project.name === "uploaded-site") && !escaped;
  })()`);
  const download = await browser.evaluate("fetch('/__adcode/download?project=uploaded-site').then(async (response) => ({ status: response.status, bytes: (await response.arrayBuffer()).byteLength }))");
  checks.downloadWorks = download.status === 200 && download.bytes > 50;

  const before = await browser.evaluate("window.adcode.chat.sessions().then((sessions) => sessions.length)");
  await browser.evaluate("window.__adcodeTestDrop(); true");
  await sleep(300);
  const after = await browser.evaluate("window.adcode.chat.sessions().then((sessions) => sessions.length)", { timeoutMs: 30_000 });
  checks.reconnectRestores = before > 0 && after === before;

  /* ── Chats that keep working ──────────────────────────────────────────── */

  /** Where the run is, as it goes: a smoke that hangs says where. */
  const phase = async (name) => console.log(`[smoke ${new Date().toISOString().slice(11, 19)}] ${name} - runs: ${JSON.stringify(await browser.evaluate("window.adcode.ai.runs().then((runs) => runs.map((run) => run.title + (run.shown ? ' (shown)' : '')))").catch(() => "?"))}`);

  const newChat = () => browser.evaluate(`(() => { document.querySelector('[aria-label="Start a new conversation"]').click(); return true; })()`);
  const sendInChat = (text) => browser.evaluate(`(() => {
    const input = document.querySelector('.chat-card .chat-input');
    input.value = ${JSON.stringify(text)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.chat-toolbar .chat-send').click();
    return true;
  })()`);
  const bubbleSays = (words) => `[...document.querySelectorAll('.chat-bubble-assistant')].some((bubble) => bubble.textContent.includes(${JSON.stringify(words)}))`;
  // A chat's mark in the list, as drawn: the right kind, a real size, and a colour that shows.
  // (A spinner once passed every check while drawn in a colour that did not exist there.)
  const markDrawn = (id, status) => `(() => {
    const icon = document.querySelector('.chat-history-row[data-session-id=${JSON.stringify(id)}] .chat-history-status');
    if (icon === null || icon.dataset.status !== ${JSON.stringify(status)}) return false;
    const mark = getComputedStyle(icon, '::before');
    const ink = ${JSON.stringify(status)} === 'working' ? mark.borderTopColor : mark.backgroundColor;
    const box = icon.getBoundingClientRect();
    return box.width > 0 && getComputedStyle(icon).display !== 'none' && parseFloat(mark.width) >= 6 && ink !== 'rgba(0, 0, 0, 0)' && ink !== 'transparent';
  })()`;
  /** The conversation list, at twice its size, to see the marks themselves. */
  const listShot = async (name) => {
    if (SHOTS === null) return;
    const box = await browser.evaluate("(() => { const list = document.querySelector('.vibe-history-host') ?? document.querySelector('.chat-history'); const r = list?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: Math.max(1, r.width), height: Math.max(1, Math.min(r.height, 400)) } : null; })()");
    if (box === null) return;
    const { data } = await browser.cdp("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 2 } });
    await writeFile(join(SHOTS, `web-${name}.png`), Buffer.from(data, "base64"));
  };

  // One chat working slowly; a second sent while it works, which finishes first.
  await newChat();
  await sleep(300);
  await sendInChat(`${SLOW_PROMPT}: take your time`);
  await browser.waitFor("window.adcode.ai.runs().then((runs) => runs.length === 1)", { timeoutMs: 15_000 });
  const slowId = await browser.evaluate("window.adcode.ai.runs().then((runs) => runs[0]?.sessionId ?? null)");
  await newChat();
  await sleep(300);
  await sendInChat(`${FAST_PROMPT}: quick one`);
  checks.twoChatsAtOnce = await browser.waitFor("window.adcode.ai.runs().then((runs) => runs.length === 2)", { timeoutMs: 10_000 });
  checks.fastChatAnswered = await browser.waitFor(bubbleSays("Fast chat done."), { timeoutMs: 20_000 });
  checks.slowChatStillWorking = await browser.evaluate(`window.adcode.ai.runs().then((runs) => runs.some((run) => run.sessionId === ${JSON.stringify(slowId)}))`);
  checks.slowChatMarkedWorking = await browser.waitFor(markDrawn(slowId, "working"), { timeoutMs: 5_000 });
  await shot("chats-at-once");
  await listShot("list-working");
  // Opening the working chat shows its turn so far, then its answer when it comes.
  await browser.evaluate(`(() => { document.querySelector('.chat-history-row[data-session-id=${JSON.stringify(slowId)}] .chat-history-open').click(); return true; })()`);
  checks.workingChatReplays = await browser.waitFor(`document.querySelector('.chat-turn[data-state="running"]') !== null || ${bubbleSays("Slow chat done.")}`, { timeoutMs: 10_000 });
  checks.slowChatAnswered = await browser.waitFor(bubbleSays("Slow chat done."), { timeoutMs: 20_000 });
  checks.fastAnswerNotInSlowChat = !(await browser.evaluate(bubbleSays("Fast chat done.")));
  await phase("failing chat");
  // A chat that fails while another is on screen is marked as needing the person, not as done.
  await newChat();
  await sleep(300);
  await sendInChat(`${FAIL_PROMPT}: this one will not work`);
  await browser.waitFor("window.adcode.ai.runs().then((runs) => runs.length === 1)", { timeoutMs: 15_000 });
  const failId = await browser.evaluate("window.adcode.ai.runs().then((runs) => runs[0]?.sessionId ?? null)");
  await newChat();
  await browser.waitFor("window.adcode.ai.runs().then((runs) => runs.length === 0)", { timeoutMs: 30_000 });
  checks.failedChatMarked = await browser.waitFor(markDrawn(failId, "attention"), { timeoutMs: 5_000 });
  await phase("left chat");
  // A chat left while it works, that finishes elsewhere: a dot, until it is opened.
  await sendInChat(`${SLOW_PROMPT}: and another one`);
  await browser.waitFor("window.adcode.ai.runs().then((runs) => runs.length === 1)", { timeoutMs: 15_000 });
  const leftId = await browser.evaluate("window.adcode.ai.runs().then((runs) => runs[0]?.sessionId ?? null)");
  await newChat();
  checks.leftChatSpinsThenDots = await browser.waitFor(markDrawn(leftId, "working"), { timeoutMs: 5_000 });
  await browser.waitFor("window.adcode.ai.runs().then((runs) => runs.length === 0)", { timeoutMs: 30_000 });
  checks.leftChatSpinsThenDots = checks.leftChatSpinsThenDots && await browser.waitFor(markDrawn(leftId, "finished"), { timeoutMs: 5_000 });
  await listShot("list-finished");
  await browser.evaluate(`(() => { document.querySelector('.chat-history-row[data-session-id=${JSON.stringify(leftId)}] .chat-history-open').click(); return true; })()`);
  checks.dotClearsWhenOpened = await browser.waitFor(`document.querySelector('.chat-history-row[data-session-id=${JSON.stringify(leftId)}] .chat-history-status')?.dataset.status !== 'finished'`, { timeoutMs: 5_000 });

  await phase("long job");
  // A long job past its step limit, with the page frozen solid: only the main process can
  // carry it on. The page comes back to the finished answer.
  await newChat();
  await sleep(300);
  await sendInChat(`${LONG_PROMPT}: list everything, over and over`);
  await browser.waitFor("window.adcode.ai.runs().then((runs) => runs.length === 1)", { timeoutMs: 15_000 });
  const longId = await browser.evaluate("window.adcode.ai.runs().then((runs) => runs[0]?.sessionId ?? null)");
  await browser.cdp("Page.setWebLifecycleState", { state: "frozen" });
  const frozenAt = Date.now();
  for (let waited = 0; keptGoingAt === 0 && waited < 120_000; waited += 250) await sleep(250);
  await sleep(1_000);
  await browser.cdp("Page.setWebLifecycleState", { state: "active" });
  checks.keptGoingWhilePageFrozen = keptGoingAt > frozenAt;
  await phase("coming back");
  // Coming back. The dev server reloads a page whose live-reload socket dropped while it was
  // frozen - which is the tab coming back after being away, so the job must be there either way.
  await sleep(1_500);
  if (await browser.evaluate("document.querySelector('.web-gate-card') !== null")) {
    await browser.evaluate(`(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.includes('dev mode'))?.click(); return true; })()`);
    await browser.waitFor("document.querySelector('.vibe-pages') && document.body.dataset.sessionReady === 'true'", { timeoutMs: 90_000 });
  }
  await browser.waitFor(`document.querySelector('.chat-history-row[data-session-id=${JSON.stringify(longId)}] .chat-history-open') !== null`, { timeoutMs: 20_000 });
  await browser.evaluate(`(() => { document.querySelector('.chat-history-row[data-session-id=${JSON.stringify(longId)}] .chat-history-open').click(); return true; })()`);
  checks.longJobFinished = await browser.waitFor(bubbleSays("Kept going and finished."), { timeoutMs: 30_000 });
  checks.noChatLeftWorking = await browser.waitFor("window.adcode.ai.runs().then((runs) => runs.length === 0)", { timeoutMs: 10_000 });
  await shot("kept-going");

  await phase("phone");
  await browser.viewport(390, 844, true);
  await sleep(1200);
  await shot("phone");
  checks.phoneOverflow = await browser.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
  checks.modelRequests = requests.length;
  checks.viewPageSawPage = viewPageReport.includes("Fresh bread daily") || viewPageReport.includes("Bakery smoke");
  if (!checks.viewPageSawPage) checks.viewPageReport = viewPageReport.slice(0, 400);
  checks.consoleErrors = browser.consoleErrors.filter((text) => !/127\.0\.0\.1:9|ERR_CONNECTION_REFUSED|Failed to load resource/.test(text));
} catch (error) {
  checks.threw = String(error?.stack ?? error);
  // What the page looked like when it went wrong: enough to tell a product bug from a test one.
  checks.consoleErrors = browser.consoleErrors;
  checks.pageAtFailure = await browser.evaluate(`({
    transcript: document.querySelector('.chat-transcript')?.innerText.slice(-1500) ?? null,
    history: [...document.querySelectorAll('.chat-history-row')].map((row) => row.dataset.sessionId + ' ' + (row.querySelector('.chat-history-status')?.dataset.status ?? '')),
    dialogs: [...document.querySelectorAll('dialog[open]')].map((dialog) => dialog.className),
  })`).catch((reason) => String(reason));
  checks.runsAtFailure = await browser.evaluate("window.adcode.ai.runs()").catch((reason) => String(reason));
} finally {
  await browser.close();
  stack.kill();
  fake.close();
  await sleep(500);
  await rm(home, { recursive: true, force: true }).catch(() => undefined);
}

/*
 * When the cloud refuses a tab - here, today's time is spent - the sandbox never says hello.
 * The page must still say why, not sit on "Waking your workspace…" for ever.
 */
if (checks.threw === undefined) {
  const { WebSocketServer } = require("ws");
  const refuser = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  refuser.on("connection", (socket) => {
    socket.send(JSON.stringify({ t: "cloud", status: { state: "spent", allowanceMs: 3_600_000, usedMs: 3_600_000, resetsAt: Date.now() + 3_600_000 } }));
    socket.close(4429, "spent");
  });
  await new Promise((resolve) => refuser.once("listening", resolve));
  const refusedPort = String(Number(WEB_PORT) + 1);
  const page = spawn(process.execPath, [vite, "--config", "apps/desktop/vite.web.config.ts", "--port", refusedPort, "--strictPort"], {
    env: { ...process.env, ADCODE_HOST_PORT: String(refuser.address().port) },
    stdio: "ignore",
  });
  const second = await launchBrowser({ port: Number(process.env["ADCODE_SMOKE_PORT"] ?? 9473) + 1 });
  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        if ((await fetch(`http://127.0.0.1:${refusedPort}/`)).ok) break;
      } catch {
        // starting
      }
      await sleep(500);
    }
    await second.goto(`http://localhost:${refusedPort}/`);
    await second.waitFor("document.querySelector('.web-gate-card')", { timeoutMs: 60_000 });
    await second.evaluate(`(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.includes('dev mode'))?.click(); return true; })()`);
    checks.refusalExplained = await second.waitFor("document.querySelector('#web-gate')?.textContent.includes(\"That's today's cloud time\")", { timeoutMs: 30_000 });
    if (SHOTS !== null) await second.screenshot(join(SHOTS, "web-refused.png"));
  } catch (error) {
    checks.refusalExplained = `THREW: ${error}`;
  } finally {
    await second.close();
    page.kill();
    refuser.close();
  }
}

console.log(JSON.stringify(checks, null, 2));
const passed = checks.threw === undefined && checks.gateShown && checks.gateDevMode && checks.vibeVisible && checks.onboardingAsks && checks.modelReady && checks.sidebarShowsProject &&
  checks.chatReply && checks.fileWritten && checks.previewServes && checks.changesShowsFile && checks.commitWorks &&
  checks.timelineWhileWorking && checks.liveHeading === "Working" && checks.spinnerAtFoot && checks.mascotsWhileWorking <= 1 &&
  checks.timeline?.heading === "Worked" && checks.timeline.folded && checks.timeline.answerOutsideFold && checks.timeline.textBetweenStepsInFold &&
  checks.timeline.thought === "Planning the bakery page" && checks.timeline.mascotsLeft === 0 && checks.unfolds &&
  checks.twoChatsAtOnce && checks.fastChatAnswered && checks.slowChatStillWorking && checks.slowChatMarkedWorking && checks.workingChatReplays &&
  checks.slowChatAnswered && checks.fastAnswerNotInSlowChat && checks.failedChatMarked && checks.leftChatSpinsThenDots && checks.dotClearsWhenOpened && checks.keptGoingWhilePageFrozen && checks.longJobFinished && checks.noChatLeftWorking &&
  checks.reconnectRestores && checks.uploadWorks && checks.downloadWorks && checks.viewPageSawPage && checks.refusalExplained === true && checks.phoneOverflow === 0 && checks.consoleErrors.length === 0;
if (!passed) {
  console.log("--- stack log (tail) ---");
  console.log(stackLog.slice(-4000));
}
process.exit(passed ? 0 : 1);
