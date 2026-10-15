/**
 * Built-app check for free AI credits: what the window shows when the relay meters credits.
 *
 * A fake relay answers the two included-AI reads - the model list with credit rates, and an
 * account that has used 81% of its 5-hour window - and passes everything else to the mock
 * backend. The checks read the real window: the composer's two rings say Session and Weekly
 * with the right numbers, the model note gives the partner rate, and the usage dialog draws
 * both windows with their refill times. Run `npm run desktop:build` first.
 *
 *   node scripts/smoke-credits.mjs
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSmokeBackend } from "./smoke-backend.mjs";

const root = process.cwd();
const electron = createRequire(join(root, "package.json"))("electron");
const backend = await startSmokeBackend();
const now = Date.now();
const catalog = {
  available: true, defaultModel: "tagflow-code-27b", requiresVerifiedAccount: true,
  credits: { sessionCredits: 2000, weeklyCredits: 20000, sessionHours: 5 },
  models: [
    { id: "tagflow-code-27b", name: "Tagflow Code 27B", providerName: "Tagflow AI", contextWindow: 32768, maxOutput: 4096, creditRate: 1 },
    { id: "heabsy-qwen38", name: "Heabsy Qwen", providerName: "Heabsy", contextWindow: 32768, maxOutput: 4096, creditRate: 0.2 },
  ],
};
const day = new Date(now).toISOString().slice(0, 10);
const usage = {
  available: true, blocked: false, policy: null, resetsAt: now + 4 * 3_600_000,
  limits: { dailyRequests: 1_000_000, dailyTokens: 2_000_000, dailyCostMicros: 1_000_000, requestsPerMinute: 1000 },
  usage: { uid: "smoke", day, requests: 40, inputTokens: 1_500_000, outputTokens: 0, costMicros: 0, estimatedRequests: 0, reservedTokens: 120_000, reservedCostMicros: 0 },
  credits: {
    plan: catalog.credits,
    session: { limit: 2000, used: 1500, held: 120, remaining: 380, startedAt: now - 3_600_000, resetsAt: now + 4 * 3_600_000 },
    weekly: { limit: 20000, used: 4200, held: 120, remaining: 15680, startedAt: now - 2 * 86_400_000, resetsAt: now + 5 * 86_400_000 },
    rates: { "tagflow-code-27b": 1, "heabsy-qwen38": 0.2 },
  },
};
const server = createServer(async (request, response) => {
  try {
    if (request.url === "/v1/ai/tagflow/config" || request.url === "/v1/ai/tagflow/usage") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(request.url.endsWith("config") ? catalog : usage));
      return;
    }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const result = await fetch(`${backend.server.url}${request.url}`, { method: request.method, headers: request.headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
    response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer()));
  } catch { response.writeHead(503); response.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const port = Number(process.env.ADCODE_SMOKE_PORT ?? 9541);
const checks = {};

const directory = await mkdtemp(join(tmpdir(), "adcode-credits-"));
const env = { ...process.env, ...backend.env, ADCODE_AD_SERVER: origin };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ["apps/desktop", `--user-data-dir=${directory}`, `--remote-debugging-port=${port}`, "--disable-renderer-backgrounding", "--disable-background-timer-throttling"], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let logs = ""; child.stdout.on("data", (chunk) => { logs += chunk; }); child.stderr.on("data", (chunk) => { logs += chunk; });
let socket;
try {
  let target;
  for (let attempt = 0; attempt < 100 && !target; attempt++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl); } catch {}
    if (!target) await sleep(300);
  }
  if (!target) throw new Error("No renderer");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let sequence = 0; const pending = new Map();
  socket.addEventListener("message", ({ data }) => { const message = JSON.parse(data); pending.get(message.id)?.(message); pending.delete(message.id); });
  const evaluate = async (expression) => {
    const id = ++sequence;
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("Evaluation timed out")); }, 30_000);
      pending.set(id, (message) => { clearTimeout(timer); resolve(message); });
      socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    return result.result?.exceptionDetails ? `THREW: ${result.result.exceptionDetails.exception?.description ?? "?"}` : result.result?.result?.value;
  };
  let status;
  for (let attempt = 0; attempt < 90; attempt++) {
    status = await evaluate("window.adcode?.ai?.status()");
    if (status?.activeProvider === "tagflow" && status.ready === true) break;
    await sleep(300);
  }
  checks.includedReady = status?.activeProvider === "tagflow" && status?.ready === true;
  checks.partnerRateNoted = /fewer credits \(0\.2× the standard rate\)/.test(JSON.stringify(status?.providers?.find((provider) => provider.id === "tagflow") ?? {}));
  const window = await evaluate(`(async () => {
    const wait = async (test, tries = 100) => { for (let i = 0; i < tries && !test(); i++) await new Promise((r) => setTimeout(r, 150)); };
    const meter = (name) => document.querySelector('.composer-meter[data-meter="' + name + '"]');
    await wait(() => meter('usage')?.querySelector('.composer-meter-label')?.textContent === 'Session');
    const read = (name) => ({ label: meter(name)?.querySelector('.composer-meter-label')?.textContent, value: meter(name)?.querySelector('.composer-meter-value')?.textContent, detail: meter(name)?.querySelector('.composer-meter-detail')?.textContent, title: meter(name)?.title ?? '' });
    const session = read('usage');
    const weekly = read('requests');
    meter('usage')?.click();
    await wait(() => document.querySelectorAll('.ai-usage-dialog .usage-credit-row').length === 2);
    const rows = [...document.querySelectorAll('.ai-usage-dialog .usage-credit-row')].map((row) => row.innerText.replace(/\\s+/g, ' '));
    const help = document.querySelector('.ai-usage-dialog .usage-allowance-help summary')?.textContent;
    document.querySelector('.ai-usage-dialog')?.close?.();
    return { session, weekly, rows, help };
  })()`);
  checks.sessionRing = window?.session?.label === "Session" && window.session.value === "81%" && window.session.detail === "380 left";
  checks.sessionTooltip = /380 of 2,000 left, 120 held/.test(window?.session?.title ?? "") && /Refills in [34] hr/.test(window?.session?.title ?? "");
  checks.weeklyRing = window?.weekly?.label === "Weekly" && window.weekly.value === "22%" && window.weekly.detail === "15,680 left";
  checks.dialogRows = Array.isArray(window?.rows) && window.rows.length === 2 && /Current session/.test(window.rows[0]) && /81% used/.test(window.rows[0]) && /This week/.test(window.rows[1]) && /Refills in 5 days/.test(window.rows[1]);
  checks.dialogExplains = window?.help === "How credits work";
  checks.noStartupException = !/UnhandledPromiseRejection|TypeError:|ReferenceError:/.test(logs);
  console.log(JSON.stringify({ checks, window }, null, 2));
  if (Object.values(checks).some((passed) => passed !== true)) process.exitCode = 1;
} finally {
  socket?.close(); child.kill();
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(2000)]);
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await backend.server.close();
}
