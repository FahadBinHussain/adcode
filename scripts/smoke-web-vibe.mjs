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
import { mkdtemp, rm } from "node:fs/promises";
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
const requests = [];
let viewPageReport = "";
const fake = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body || "{}");
  requests.push(request);
  const messages = request.messages ?? [];
  const start = messages.findLastIndex((message) => message.role === "user" && String(message.content).includes(PROMPT));
  const answered = start === -1 ? 0 : messages.slice(start + 1).filter((message) => message.role === "tool").length;
  // Write the page, then look at it with the agent's own browser, then answer.
  const lastTool = start === -1 ? "" : String(messages.filter((message) => message.role === "tool").at(-1)?.content ?? "");
  if (start !== -1 && answered === 2) viewPageReport = lastTool;
  const delta = start !== -1 && answered === 0
    ? { tool_calls: [{ index: 0, id: "write-1", function: { name: "propose_edit", arguments: JSON.stringify({ path: "index.html", contents: PAGE, summary: "Add the bakery page" }) } }] }
    : start !== -1 && answered === 1
      ? { tool_calls: [{ index: 0, id: "look-1", function: { name: "view_page", arguments: JSON.stringify({ path: "index.html", width: 390, height: 844, screenshot: true }) } }] }
      : { content: "Done - your bakery page is ready." };
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
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
  checks.chatReply = await browser.waitFor("[...document.querySelectorAll('.chat-bubble-assistant')].some((bubble) => bubble.textContent.includes('bakery page is ready'))", { timeoutMs: 90_000 });
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
} finally {
  await browser.close();
  stack.kill();
  fake.close();
  await sleep(500);
  await rm(home, { recursive: true, force: true }).catch(() => undefined);
}

console.log(JSON.stringify(checks, null, 2));
const passed = checks.threw === undefined && checks.gateShown && checks.gateDevMode && checks.vibeVisible && checks.onboardingAsks && checks.modelReady && checks.sidebarShowsProject &&
  checks.chatReply && checks.fileWritten && checks.previewServes && checks.changesShowsFile && checks.commitWorks &&
  checks.reconnectRestores && checks.uploadWorks && checks.downloadWorks && checks.viewPageSawPage && checks.phoneOverflow === 0 && checks.consoleErrors.length === 0;
if (!passed) {
  console.log("--- stack log (tail) ---");
  console.log(stackLog.slice(-4000));
}
process.exit(passed ? 0 : 1);
