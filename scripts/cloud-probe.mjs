#!/usr/bin/env node
/**
 * Check a deployed adcode-cloud Worker from outside, the way a browser reaches it.
 *
 *   node scripts/cloud-probe.mjs https://web.bluethenics.com
 *       Production: the page and its CSP, and every door refusing a visitor with no token
 *       or the development token.
 *
 *   node scripts/cloud-probe.mjs https://adcode-cloud-staging.<you>.workers.dev --staging
 *       A staging Worker (`wrangler deploy --env staging`, which accepts the development
 *       token): wake a sandbox, run a call and a host op, make a project. Add `--restore` to
 *       then wait for the sandbox to sleep and check the project came back from R2, and
 *       `--delete` to finish with "Delete my cloud workspace". Delete the staging Worker after.
 *
 * Prints every value it checked; read them rather than the exit code.
 */
import WebSocket from "ws";

const args = process.argv.slice(2);
const base = (args.find((arg) => /^https?:\/\//.test(arg)) ?? "").replace(/\/$/, "");
const staging = args.includes("--staging");
if (base.length === 0) {
  console.error("Usage: node scripts/cloud-probe.mjs <https://host> [--staging [--restore] [--delete]]");
  process.exit(2);
}
const origin = staging ? "https://staging.invalid" : base;
const wsUrl = `${base.replace(/^http/, "ws")}/socket`;
const results = {};

function connect(protocols, headerOrigin = origin) {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl, protocols, { headers: { origin: headerOrigin } });
    ws.on("close", (code) => resolve({ code }));
    ws.on("unexpected-response", (_request, response) => resolve({ http: response.statusCode }));
    ws.on("error", (error) => resolve({ error: String(error) }));
  });
}

async function session(token) {
  const response = await fetch(`${base}/api/session`, token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } });
  return response.headers.get("content-type")?.includes("json") ? { status: response.status, body: await response.json() } : { status: response.status };
}

/** Open a sandbox with the development token, run `work` once it says hello, then close. */
function withSandbox(work) {
  const started = Date.now();
  return new Promise((resolve) => {
    const result = { states: [] };
    const ws = new WebSocket(wsUrl, ["adcode.v1", "auth.dev"], { headers: { origin } });
    let next = 1;
    const pending = new Map();
    const send = (frame) => new Promise((done) => {
      const id = next++;
      pending.set(id, done);
      ws.send(JSON.stringify({ ...frame, id }));
    });
    const timer = setTimeout(() => {
      result.timedOut = true;
      ws.close();
      resolve(result);
    }, 240_000);
    ws.on("message", async (data) => {
      const frame = JSON.parse(String(data));
      if (frame.t === "cloud") result.states.push(`${frame.status.state} @${Date.now() - started}ms`);
      if ((frame.t === "ret" || frame.t === "opRet") && pending.has(frame.id)) {
        pending.get(frame.id)(frame);
        pending.delete(frame.id);
      }
      if (frame.t !== "ready") return;
      result.readyAfterMs = Date.now() - started;
      result.host = frame.host;
      Object.assign(result, await work({
        call: async (ch, callArgs = []) => (await send({ t: "call", ch, args: callArgs })).value,
        op: async (op, opArgs = []) => (await send({ t: "op", op, args: opArgs })).value,
      }));
      clearTimeout(timer);
      ws.close(1000);
      resolve(result);
    });
    ws.on("close", (code) => {
      result.closeCode = code;
      resolve(result);
    });
    ws.on("error", (error) => {
      result.error = String(error);
      resolve(result);
    });
  });
}

const page = await fetch(`${base}/`);
const html = await page.text();
results.page = page.status;
results.pageHasCsp = (page.headers.get("content-security-policy") ?? "").includes("default-src 'none'");
results.pageIsTheApp = html.includes("web-gate") || html.includes("/assets/");
results.pageHasNoDevButton = !html.includes("Continue in dev mode");
results.apiWithoutToken = (await session()).status;
results.socketWithoutToken = await connect(["adcode.v1"]);
results.socketFromAnotherSite = await connect(["adcode.v1", "auth.dev"], "https://example.com");

if (!staging) {
  // Production must never accept the development token.
  results.apiWithDevToken = (await session("dev")).status;
  results.socketWithDevToken = await connect(["adcode.v1", "auth.dev"]);
} else {
  results.sessionBefore = (await session("dev")).body?.status;
  results.wake = await withSandbox(async ({ call, op }) => ({
    appInfo: await call("app:info"),
    created: await call("workspace:create-project", ["probe project"]),
    projects: (await op("projects"))?.map((project) => project.name),
  }));
  if (args.includes("--restore")) {
    // The sandbox sleeps IDLE_SLEEP_MIN after the last tab leaves, archiving to R2 first.
    const deadline = Date.now() + 15 * 60_000;
    let state = "";
    while (Date.now() < deadline && state !== "sleeping") {
      await new Promise((resolve) => setTimeout(resolve, 30_000));
      state = (await session("dev")).body?.status?.state ?? "";
    }
    results.slept = state === "sleeping";
    results.archivedBytes = (await session("dev")).body?.status?.storageBytes;
    results.restore = await withSandbox(async ({ op }) => ({ projects: (await op("projects"))?.map((project) => project.name) }));
  }
  if (args.includes("--delete")) {
    results.deleted = await (await fetch(`${base}/api/delete`, { method: "POST", headers: { authorization: "Bearer dev" } })).json();
    // The day's time stays spent: deleting must not hand back a fresh allowance.
    results.sessionAfterDelete = (await session("dev")).body?.status;
  }
}

console.log(JSON.stringify(results, null, 2));
