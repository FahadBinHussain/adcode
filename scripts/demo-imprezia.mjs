/**
 * Shows an Imprezia Chat Ads delivery in the real desktop app, and saves a screenshot of it.
 *
 * What runs is ADCode's own API request handler (in memory, on this machine) with an
 * Imprezia Chat Ads connection, so the ad goes through exactly the production path: the
 * server asks Imprezia's `/v1/ads/chat`, records the delivery, proxies the artwork, and when
 * the desktop reports the card was seen, reports the impression to Imprezia. Only the sign-in
 * is the mock server's, so no production account is created.
 *
 * Run after `npm run desktop:build`, with the publisher key in the environment - never in a file:
 *   IMPREZIA_API_KEY=api_pub_sandbox_... node scripts/demo-imprezia.mjs
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { createMockServer } from "../mock-server/src/server.ts";
import { createRequestHandler } from "../services/api/src/server.ts";
import { createMemoryStore } from "../services/api/src/memoryStore.ts";
import { encryptAdNetworkKey } from "../services/api/src/adNetworkCrypto.ts";

const key = process.env["IMPREZIA_API_KEY"];
if (!key) { console.error("Set IMPREZIA_API_KEY to the Imprezia publisher key."); process.exit(2); }
const REPO = process.cwd();
const require = createRequire(join(REPO, "package.json"));
const OUT = join(REPO, "output", `imprezia-delivery-${new Date().toISOString().slice(0, 10)}`);
const PORT = 9335;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ── ADCode's API, with an Imprezia Chat Ads connection ─────────────────── */

const encryption = randomBytes(32).toString("base64");
const store = createMemoryStore();
await store.adNetworks.put({ id: "imprezia", name: "Imprezia", provider: "imprezia", enabled: true, priority: 10, viewPayoutMicros: "0", clickPayoutMicros: "0", imprezia: { kind: "chat", id: "" } }, "demo", Date.now());
await store.adNetworks.putKey("imprezia", encryptAdNetworkKey("imprezia", key, encryption));

/** Every call ADCode's server makes to Imprezia, for the record (never the key). */
const calls = [];
const fetchImpl = async (input, init) => {
  const response = await fetch(input, init);
  const url = String(input);
  if (url.includes("imprezia")) calls.push({ at: new Date().toISOString(), method: init?.method ?? "GET", url: url.split("?")[0], status: response.status });
  return response;
};

const identity = await createMockServer();
const handle = createRequestHandler({
  store,
  verifier: { async verify(token) { return token.startsWith("mock-id-") ? { uid: `demo-${token.slice(8, 20)}`, claims: { email: "demo@adcode.test", email_verified: true } } : null; } },
  adNetworks: { encryptionKeys: () => [encryption], fetchImpl },
});
// The desktop accepts artwork only from one https host; against a dev server that is the
// fake `cdn.adcode.test`, which its transport rewrites to this server.
const api = createServer((req, res) => { req.headers.host = "cdn.adcode.test"; req.headers["x-forwarded-proto"] = "https"; void handle(req, res); });
await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
const apiUrl = `http://127.0.0.1:${api.address().port}`;

/* ── The desktop app ───────────────────────────────────────────────────── */

const userData = await mkdtemp(join(tmpdir(), "adcode-imprezia-"));
await mkdir(userData, { recursive: true });
const openFile = join(REPO, "apps", "desktop", "src", "renderer", "ai", "limitPause.ts");
await writeFile(join(userData, "session.json"), JSON.stringify({ state: { root: REPO, openFiles: [openFile], activeFile: openFile } }), "utf8");
const longAgo = Date.now() - 86_400_000;
await writeFile(join(userData, "milestones.json"), JSON.stringify({ firstLaunchAt: longAgo, firstValueAt: longAgo, pending: [] }), "utf8");
await writeFile(join(userData, "onboarding.json"), JSON.stringify({ completed: true, at: longAgo }), "utf8");

const child = spawn(require("electron"), ["apps/desktop", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], {
  cwd: REPO,
  env: { ...process.env, IMPREZIA_API_KEY: "", ADCODE_AD_SERVER: apiUrl, ADCODE_AUTH_EMULATOR: identity.url, ADCODE_SETTLE_MS: "1500", ADCODE_AD_TICK_MS: "2000", ADCODE_ADS_DISABLED: "0", ADCODE_AD_DEBUG: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => (output += chunk));
child.stderr.on("data", (chunk) => (output += chunk));

async function target() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* not listening yet */ }
    await sleep(500);
  }
  throw new Error("no renderer target appeared");
}
const socket = new WebSocket((await target()).webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let nextId = 1; const pending = new Map();
socket.addEventListener("message", (event) => { const message = JSON.parse(event.data); pending.get(message.id)?.(message); pending.delete(message.id); });
const send = (method, params = {}) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;

const result = { api: apiUrl, toast: null, impressionReported: false, screenshots: [], imprezia: calls };
try {
  await sleep(5000);
  await send("Page.bringToFront");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let attempt = 0; attempt < 30 && !result.toast; attempt++) {
    result.toast = await evaluate(`(() => { const card = document.querySelector('.toast-sponsored'); if (!card) return null;
      return { label: card.querySelector('.toast-sponsored-label')?.textContent ?? '', title: card.querySelector('.toast-title')?.textContent ?? '',
        body: card.querySelector('.toast-body')?.textContent ?? '', logo: (card.querySelector('.toast-logo img')?.src ?? '').slice(0, 30) }; })()`);
    if (!result.toast) { await evaluate("window.adcode.ads.refreshEarnings()"); await sleep(1500); }
  }
  if (result.toast) {
    await sleep(1200);
    await mkdir(OUT, { recursive: true });
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(OUT, "desktop-sponsored-card.png"), Buffer.from(shot.result.data, "base64"));
    result.screenshots.push(join(OUT, "desktop-sponsored-card.png"));
    const box = await evaluate(`(() => { const r = document.querySelector('.toast-sponsored').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
    const pad = 24;
    const close = await send("Page.captureScreenshot", { format: "png", clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2, scale: 2 } });
    await writeFile(join(OUT, "desktop-sponsored-card-closeup.png"), Buffer.from(close.result.data, "base64"));
    result.screenshots.push(join(OUT, "desktop-sponsored-card-closeup.png"));
    // The card has been on screen; the next ticks upload its view receipt, and the server reports it to Imprezia.
    for (let attempt = 0; attempt < 20 && !result.impressionReported; attempt++) {
      await evaluate("window.adcode.ads.refreshEarnings()");
      await sleep(1500);
      result.impressionReported = calls.some((call) => call.url.endsWith("/v1/events/sdk-impression"));
    }
  }
} finally {
  if (OUT) { await mkdir(OUT, { recursive: true }); await writeFile(join(OUT, "delivery-log.json"), JSON.stringify(result, null, 2)); }
  console.log(JSON.stringify(result, null, 2));
  if (!result.toast) console.log(output.split("\n").filter((line) => /ads?\b|serve|imprezia/i.test(line)).slice(-30).join("\n"));
  socket.close(); child.kill(); api.close(); await identity.close();
}
process.exit(result.toast ? 0 : 1);
