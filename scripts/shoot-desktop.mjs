/**
 * Screenshots of the built desktop app's Vibe window, for design review.
 *
 * Launches `apps/desktop` (run `npm run desktop:build` first) against the mock backend, with a
 * fake included-AI relay that offers two free models, and captures each surface a person opens
 * first: the home, Connect a model, Settings, AI usage, the account and the feature library.
 * Prints any console error and whether anything spills sideways.
 *
 *   node scripts/shoot-desktop.mjs <out-dir> [width] [height]
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSmokeBackend } from "./smoke-backend.mjs";

const root = process.cwd();
const out = process.argv[2] ?? join(tmpdir(), "adcode-shots");
const width = Number(process.argv[3] ?? 1440);
const height = Number(process.argv[4] ?? 900);
mkdirSync(out, { recursive: true });
const electron = createRequire(join(root, "package.json"))("electron");
const backend = await startSmokeBackend();
const catalog = {
  available: true, defaultModel: "tagflow-code-27b", requiresVerifiedAccount: true,
  models: [
    { id: "tagflow-code-27b", name: "Tagflow Code 27B", providerName: "Tagflow AI", contextWindow: 131072, maxOutput: 8192 },
    { id: "heabsy-qwen38", name: "Heabsy Qwen 3.8", providerName: "Heabsy", contextWindow: 131072, maxOutput: 8192 },
  ],
};
const relay = createServer(async (request, response) => {
  try {
    if (request.url === "/v1/ai/tagflow/config") { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(catalog)); return; }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const result = await fetch(`${backend.server.url}${request.url}`, { method: request.method, headers: request.headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
    response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer()));
  } catch { response.writeHead(503); response.end(); }
});
await new Promise((resolve) => relay.listen(0, "127.0.0.1", resolve));
const port = Number(process.env.ADCODE_SMOKE_PORT ?? 9561);
const env = { ...process.env, ...backend.env, ADCODE_AD_SERVER: `http://127.0.0.1:${relay.address().port}` };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ["apps/desktop", `--user-data-dir=${mkdtempSync(join(tmpdir(), "adcode-shots-"))}`, `--remote-debugging-port=${port}`, "--disable-renderer-backgrounding", "--disable-background-timer-throttling"], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let logs = ""; child.stdout.on("data", (c) => { logs += c; }); child.stderr.on("data", (c) => { logs += c; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
let socket;
try {
  let target;
  for (let i = 0; i < 100 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page" && !t.url.includes("#/ide")); } catch {} if (!target) await sleep(300); }
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { socket.addEventListener("open", r, { once: true }); socket.addEventListener("error", j, { once: true }); });
  let seq = 0; const pending = new Map();
  socket.addEventListener("message", ({ data }) => { const m = JSON.parse(data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } else if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 300)); else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300)); });
  const cdp = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? `THREW ${r.result.exceptionDetails.exception?.description}` : r.result?.result?.value; };
  const waitFor = async (expression, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await evaluate(expression)) return true; await sleep(250); } return false; };
  const shot = async (name) => { await sleep(450); const { result } = await cdp("Page.captureScreenshot", { format: "png" }); writeFileSync(join(out, `${name}.png`), Buffer.from(result.data, "base64")); };
  await cdp("Runtime.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  const ready = await waitFor("document.body.dataset.sessionReady === 'true'", 60000);
  await sleep(2500);
  await evaluate("document.querySelector('dialog.onboarding[open]')?.close(); document.querySelectorAll('dialog[open]').forEach((d) => d.close())");
  await shot("1-home");
  const facts = await evaluate(`JSON.stringify({ frame: document.documentElement.dataset.frame, rail: !!document.querySelector('.web-rail'), tabs: !!document.querySelector('.web-tabs'), overflow: document.documentElement.scrollWidth - innerWidth, font: getComputedStyle(document.body).fontFamily.slice(0, 30), provider: null })`);
  const status = await evaluate("window.adcode.ai.status().then((s) => JSON.stringify({ active: s.activeProvider, model: s.activeModel, ready: s.ready, included: s.providers.find((p) => p.id === 'tagflow')?.models?.map((m) => m.id) ?? null }))");
  // Connect a model: the composer's model pill.
  await evaluate("(document.querySelector('.chat-model-pill') ?? document.querySelector('[class*=model-pill]'))?.click()");
  await sleep(900);
  await shot("2-model-menu");
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await evaluate("document.querySelector('.web-rail-item[data-tip=\"Settings\"], .vibe-settings-button')?.click()");
  await sleep(900);
  await shot("3-settings");
  await evaluate("document.querySelectorAll('dialog[open]').forEach((d) => d.close()); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await evaluate("document.querySelector('.web-credits-row')?.click()");
  await sleep(900);
  await shot("4-usage");
  await evaluate("document.querySelectorAll('dialog[open]').forEach((d) => d.close())");
  await evaluate("document.querySelector('.vibe-page-item.vibe-page-agents, .web-rail-item[data-rail=\"agents\"]')?.click()");
  await sleep(900);
  await shot("5-agents");
  await evaluate("document.querySelector('.web-rail-item[data-rail=\"tools\"]')?.click()");
  await sleep(900);
  await shot("6-tools");
  await evaluate("[...document.querySelectorAll('[role=tab], button')].find((b) => /^Connectors/.test(b.textContent.trim()))?.click()");
  await sleep(900);
  await shot("7-connectors");
  await evaluate("document.querySelector('.web-rail-item[data-rail=\"chat\"]')?.click()");
  await sleep(500);
  await evaluate("(document.querySelector('.chat-model-pill') ?? document.querySelector('[class*=model-pill]'))?.click()");
  await sleep(700);
  await evaluate("[...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('More models'))?.click()");
  await sleep(1200);
  await shot("8-connect");
  await evaluate("[...document.querySelectorAll('button, [role=tab]')].find((b) => /Your API key/i.test(b.textContent))?.click()");
  await sleep(900);
  await shot("9-connect-byok");
  console.log(JSON.stringify({ ready, facts: JSON.parse(facts), status: JSON.parse(status), errors: errors.slice(0, 10) }, null, 1));
} finally {
  socket?.close(); child.kill();
  await Promise.race([new Promise((r) => child.once("exit", r)), sleep(2000)]);
  relay.closeAllConnections(); await new Promise((r) => relay.close(r)); await backend.server.close();
}
