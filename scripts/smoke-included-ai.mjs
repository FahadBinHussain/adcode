/** Built-app regression: default discovery and migration, using only a local mock backend. */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSmokeBackend } from "./smoke-backend.mjs";

const root = process.cwd();
const electron = createRequire(join(root, "package.json"))("electron");
const backend = await startSmokeBackend();
const catalog = { available: true, defaultModel: "tagflow-code-27b", models: [{ id: "tagflow-code-27b", name: "Tagflow Code 27B", providerName: "Tagflow AI", contextWindow: 32768, maxOutput: 4096 }], requiresVerifiedAccount: true };
const server = createServer(async (request, response) => {
  try {
    if (request.url === "/v1/ai/tagflow/config") {
      response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(catalog)); return;
    }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const result = await fetch(`${backend.server.url}${request.url}`, { method: request.method, headers: request.headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
    response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer()));
  } catch { response.writeHead(503); response.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const checks = {};

async function profile(name, values, existingKey = false) {
  const directory = await mkdtemp(join(tmpdir(), `adcode-included-${name}-`));
  if (values) await writeFile(join(directory, "settings.json"), JSON.stringify({ version: 2, values }));
  // A fixture ciphertext is sufficient to represent a saved key: discovery must preserve it.
  if (existingKey) await writeFile(join(directory, "provider-keys.json"), JSON.stringify({ anthropic: "fixture-ciphertext" }));
  const port = 9531;
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
    if (!target) throw new Error(`No renderer for ${name}`);
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    let sequence = 0; const pending = new Map();
    socket.addEventListener("message", ({ data }) => { const message = JSON.parse(data); pending.get(message.id)?.(message); pending.delete(message.id); });
    async function evaluate(expression) {
      const id = ++sequence;
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Evaluation timed out for ${name}`)); }, 15000);
        pending.set(id, (message) => { clearTimeout(timer); resolve(message); });
        socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
      });
      if (result.result?.exceptionDetails) return null;
      return result.result?.result?.value;
    }
    const expected = name === "explicit" ? "openai" : name === "connected" ? "anthropic" : "tagflow";
    let status;
    for (let attempt = 0; attempt < 90; attempt++) {
      status = await evaluate("window.adcode?.ai?.status()");
      // Catalogue discovery can precede the asynchronous settings migration. Check the
      // settled route as well, while retaining the timeout and all readiness assertions.
      if (status?.providers?.some((provider) => provider.id === "tagflow") && status.activeProvider === expected &&
          (expected !== "tagflow" || (status.activeModel === "tagflow-code-27b" && status.ready === true))) break;
      await sleep(300);
    }
    checks[`${name}Discovered`] = status?.providers?.some((provider) => provider.id === "tagflow") === true;
    checks[`${name}Provider`] = status?.activeProvider === expected;
    if (expected === "tagflow") {
      checks[`${name}Model`] = status?.activeModel === "tagflow-code-27b";
      checks[`${name}Ready`] = status?.ready === true;
    }
    checks[`${name}NoStartupException`] = !/UnhandledPromiseRejection|TypeError:|ReferenceError:/.test(logs);
  } finally {
    socket?.close(); child.kill();
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(2000)]);
  }
}

try {
  await profile("fresh");
  await profile("legacy", { "adcode.ai.provider": "anthropic", "adcode.ai.model": "claude-opus-5-5" });
  await profile("connected", { "adcode.ai.provider": "anthropic", "adcode.ai.model": "claude-opus-5-5" }, true);
  await profile("explicit", { "adcode.ai.provider": "openai", "adcode.ai.model": "chosen-model" });
  console.log(JSON.stringify(checks, null, 2));
  if (Object.values(checks).some((passed) => passed !== true)) process.exitCode = 1;
} finally {
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await backend.server.close();
}
