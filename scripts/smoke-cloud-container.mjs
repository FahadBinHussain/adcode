#!/usr/bin/env node
/**
 * Exercise the actual Linux sandbox image, without deploying or contacting production.
 *
 *   npm run cloud:build
 *   node scripts/smoke-cloud-container.mjs             build linux/amd64, then check it
 *   node scripts/smoke-cloud-container.mjs --no-build  check the existing launch-check image
 *
 * Two disposable homes prove archive restoration; the host's own socket handlers exercise
 * filesystem/Git, Linux Chromium and native node-pty. Runtime networking is confined to a
 * unique internal Docker bridge. HTTP and socket traffic travel through Docker exec to
 * container loopback, so no host ports or runtime internet access are needed. The build may
 * download the base image and its locked system/npm dependencies. Nothing is published.
 * Only resources created by this invocation are removed. Test artifacts contain no secrets.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Agent, request as httpRequest } from "node:http";
import { dirname, join, posix, resolve } from "node:path";
import { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import WebSocket from "ws";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IMAGE = "adcode-sandbox:launch-check";
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: node scripts/smoke-cloud-container.mjs [--no-build]\nBuild the cloud host first with npm run cloud:build. Uses only a local Linux Docker engine.");
  process.exit(0);
}
assert(args.every((arg) => arg === "--no-build"), "Only --no-build is supported");

const runId = `${Date.now().toString(36)}-${randomBytes(5).toString("hex")}`;
const networkName = `adcode-image-check-${runId}`;
const secret = randomBytes(32).toString("hex");
const sealKey = randomBytes(32).toString("base64");
const marker = `IMAGE_ACCEPTANCE_${randomBytes(8).toString("hex")}`;
const terminalMarker = `PTY_ACCEPTANCE_${randomBytes(8).toString("hex")}`;
const artifacts = join(ROOT, ".tmp", `cloud-container-check-${runId}`);
const expectedVersion = JSON.parse(await readFile(join(ROOT, "apps/desktop/package.json"), "utf8")).version;
const expectedHostHash = createHash("sha256").update(await readFile(join(ROOT, "apps/cloud/container/host/index.js"))).digest("hex");
const created = [];
const clients = new Set();
const children = new Set();
const checks = {};
let networkId;
let imageId;
let interrupted = false;
let cleaning = false;
let failure;

const redact = (text) => String(text).replaceAll(secret, "[test secret]").replaceAll(sealKey, "[test seal key]");
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const signal = () => {
  interrupted = true;
  for (const child of children) child.kill();
  for (const client of clients) client.socket.terminate();
};
process.once("SIGINT", signal);
process.once("SIGTERM", signal);

function run(command, commandArgs, { input, timeoutMs = 60_000, progress = false, allowFailure = false, env = process.env } = {}) {
  if (interrupted && !cleaning) return Promise.reject(new Error("Image check interrupted"));
  return new Promise((done, reject) => {
    const child = spawn(command, commandArgs, { cwd: ROOT, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    children.add(child);
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    const capture = (kind, data) => {
      const text = redact(data.toString());
      if (kind === "stdout") stdout = (stdout + text).slice(-8 * 1024 * 1024);
      else stderr = (stderr + text).slice(-8 * 1024 * 1024);
      if (progress) process.stdout.write(text);
    };
    child.stdout.on("data", (data) => capture("stdout", data));
    child.stderr.on("data", (data) => capture("stderr", data));
    child.stdin.on("error", () => {}); // A failed Docker command may close stdin first.
    child.once("error", (error) => { clearTimeout(timer); children.delete(child); reject(new Error(redact(error.message))); });
    child.once("close", (code) => {
      clearTimeout(timer);
      children.delete(child);
      if ((!allowFailure && code !== 0) || timedOut) {
        reject(new Error(`${command} ${commandArgs[0]} ${timedOut ? "timed out" : `exited ${code}`}: ${stderr.slice(-1800) || stdout.slice(-1800)}`));
      } else done({ stdout, stderr, code });
    });
    child.stdin.end(input);
  });
}
const docker = (commandArgs, options) => run("docker", commandArgs, options);
const inspect = async (id, expression) => JSON.parse((await docker(["inspect", "--format", `{{json ${expression}}}`, id])).stdout);

async function responseBytes(response, maxBytes = 64 * 1024 * 1024) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body ?? []) {
    bytes += chunk.length;
    assert(bytes <= maxBytes, "HTTP response exceeded the fixture size limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** A raw TCP connection over exec stdio: works even when internal bridges publish no ports. */
function tunnel(container) {
  const child = spawn("docker", ["exec", "-i", container.id, "node", "--input-type=module", "-e", `
    import { connect } from 'node:net';
    const socket = connect(7300, '127.0.0.1');
    process.stdin.pipe(socket); socket.pipe(process.stdout);
    socket.on('error', error => { process.stderr.write(error.code || 'Loopback connection failed'); process.exitCode = 1; });
    socket.on('close', () => process.stdin.destroy());
    process.stdin.on('error', () => socket.destroy());
    process.stdout.on('error', () => socket.destroy());
  `], { cwd: ROOT, env: process.env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  children.add(child);
  const stream = Duplex.from({ readable: child.stdout, writable: child.stdin });
  // HTTP/ws use these Socket conveniences; the request/handshake owns the real timeout.
  stream.setTimeout = stream.setNoDelay = stream.setKeepAlive = () => stream;
  let stderr = "";
  child.stderr.on("data", data => { stderr = (stderr + data.toString()).slice(-1000); });
  child.once("error", error => stream.destroy(new Error(redact(error.message))));
  child.once("close", code => {
    children.delete(child);
    if (code !== 0 && !stream.destroyed) stream.destroy(new Error(`Container loopback tunnel exited ${code}: ${redact(stderr)}`));
  });
  stream.once("close", () => { if (child.exitCode === null) child.kill(); });
  return stream;
}

function request(container, path, { authorized = true, ...options } = {}) {
  return new Promise((done, reject) => {
    const agent = new Agent({ keepAlive: false });
    agent.createConnection = () => tunnel(container);
    const request = httpRequest(`${container.base}${path}`, {
      method: options.method ?? "GET", agent,
      headers: { ...(authorized ? { "x-adcode-host-secret": secret } : {}), ...options.headers, connection: "close" },
      signal: AbortSignal.timeout(30_000),
    }, response => {
      const chunks = [];
      let size = 0;
      response.on("data", chunk => {
        size += chunk.length;
        if (size > 64 * 1024 * 1024) request.destroy(new Error("HTTP fixture response exceeded 64MB"));
        else chunks.push(chunk);
      });
      response.once("error", error => { agent.destroy(); reject(error); });
      response.once("end", () => {
        const body = Buffer.concat(chunks);
        agent.destroy();
        done({ status: response.statusCode, body: [body],
          headers: { get: name => response.headers[name.toLowerCase()] ?? null },
          json: async () => JSON.parse(body.toString("utf8")) });
      });
    });
    request.once("error", error => { agent.destroy(); reject(error); });
    request.end(options.body);
  });
}

async function waitUntil(work, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (interrupted) throw new Error("Image check interrupted");
    try { const result = await work(); if (result) return result; } catch (error) { lastError = error; }
    await pause(200);
  }
  throw new Error(`${label} did not become ready${lastError ? `: ${redact(lastError.message)}` : ""}`);
}

async function createContainer(suffix) {
  const env = { ...process.env, ADCODE_HOST_SECRET: secret, ADCODE_SEAL_KEY: sealKey };
  const { stdout } = await docker([
    "create", "--pull", "never", "--platform", "linux/amd64",
    "--name", `adcode-image-${runId}-${suffix}`, "--label", `adcode.launch-check=${runId}`,
    "--network", networkId, "--dns", "127.0.0.1",
    "--env", "ADCODE_HOST_SECRET", "--env", "ADCODE_SEAL_KEY",
    "--env", "ADCODE_AD_SERVER=http://127.0.0.1:9", imageId,
  ], { env });
  const id = stdout.trim();
  assert.match(id, /^[a-f0-9]{64}$/, "Docker did not return a created container ID");
  const container = { id, suffix };
  created.push(container); // Record ownership before start: failed starts still need cleanup.
  await docker(["start", id]);
  const ports = await inspect(id, ".NetworkSettings.Ports");
  assert(Object.values(ports ?? {}).every(bindings => bindings === null || bindings.length === 0), "The check must publish no host ports");
  container.base = "http://127.0.0.1:7300"; // Reached only inside this container via exec.
  await waitUntil(async () => {
    const health = await request(container, "/__adcode/health", { authorized: false });
    if (health.status !== 200) return false;
    const body = await health.json();
    return body.ok === true && body.version === expectedVersion;
  }, `Container ${suffix} health`, 45_000);
  return container;
}

function connect(container, givenSecret = secret) {
  return new Promise((done, reject) => {
    const socket = new WebSocket(`${container.base.replace(/^http/, "ws")}/socket`, {
      headers: givenSecret === null ? {} : { "x-adcode-host-secret": givenSecret },
      createConnection: () => tunnel(container),
      handshakeTimeout: 10_000,
      maxPayload: 64 * 1024 * 1024,
    });
    const pending = new Map();
    const events = [];
    let nextId = 1, ready = false;
    const timer = setTimeout(() => { socket.terminate(); reject(new Error("Host socket did not send ready")); }, 15_000);
    const client = {
      socket, events,
      send: (ch, callArgs) => socket.send(JSON.stringify({ t: "send", ch, args: callArgs })),
      call: (ch, callArgs = []) => exchange("call", "ch", ch, callArgs),
      op: (op, opArgs = []) => exchange("op", "op", op, opArgs),
      async close() {
        if (socket.readyState === WebSocket.CLOSED) return;
        await new Promise((resolveClose) => {
          const timeout = setTimeout(() => { socket.terminate(); resolveClose(); }, 2000);
          socket.once("close", () => { clearTimeout(timeout); resolveClose(); });
          socket.close(1000);
        });
      },
    };
    function exchange(t, key, name, callArgs) {
      const id = nextId++;
      return new Promise((resolveCall, rejectCall) => {
        const timeout = setTimeout(() => { pending.delete(id); rejectCall(new Error(`${name} timed out`)); }, 60_000);
        pending.set(id, { resolveCall, rejectCall, timeout });
        socket.send(JSON.stringify({ t, id, [key]: name, args: callArgs }));
      });
    }
    const failed = (error) => {
      clearTimeout(timer);
      if (!ready) reject(error);
      for (const item of pending.values()) { clearTimeout(item.timeout); item.rejectCall(error); }
      pending.clear();
    };
    socket.on("error", failed);
    socket.on("unexpected-response", (_request, response) => {
      response.resume(); socket.terminate(); failed(new Error(`Host socket refused HTTP ${response.statusCode}`));
    });
    socket.on("close", () => { clients.delete(client); failed(new Error("Host socket closed")); });
    socket.on("message", (data) => {
      let frame;
      try { frame = JSON.parse(String(data)); } catch { failed(new Error("Host sent invalid JSON")); return; }
      if (frame.t === "ready") {
        clearTimeout(timer);
        client.hello = frame.host;
        ready = true; clients.add(client); done(client);
      } else if (frame.t === "ret" || frame.t === "opRet") {
        const item = pending.get(frame.id);
        if (!item) return;
        clearTimeout(item.timeout); pending.delete(frame.id);
        if (frame.ok) item.resolveCall(frame.value);
        else item.rejectCall(new Error(`${frame.error ?? "Host operation failed"}`));
      } else if (frame.t === "ask") {
        socket.send(JSON.stringify({ t: "answer", id: frame.id, ok: false }));
      } else if (frame.t === "evt") events.push(frame);
    });
  });
}

/** Read fixture tar members using built-ins, so the host computer needs no tar install. */
function tarFiles(gzip) {
  const tar = gunzipSync(gzip, { maxOutputLength: 128 * 1024 * 1024 });
  const files = new Map();
  for (let at = 0; at + 512 <= tar.length;) {
    const header = tar.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) break;
    const text = (start, length) => header.subarray(start, start + length).toString("utf8").split("\0", 1)[0];
    const name = [text(345, 155), text(0, 100)].filter(Boolean).join("/").replace(/^\.\//, "");
    const size = Number.parseInt(text(124, 12).trim() || "0", 8);
    assert(Number.isSafeInteger(size) && size >= 0 && at + 512 + size <= tar.length, "Invalid tar member size");
    const type = text(156, 1);
    if (type === "" || type === "0") files.set(name, tar.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  assert(files.size > 0, "Archive contains no regular files");
  return files;
}

async function stopContainer(container) {
  await docker(["stop", "--time", "20", container.id], { timeoutMs: 30_000 });
  const state = await inspect(container.id, ".State");
  assert.equal(state.Running, false, "Host was still running after stop");
  assert.equal(state.OOMKilled, false, "Image was killed for memory usage");
  assert.equal(state.ExitCode, 0, "Host did not exit cleanly on SIGTERM");
}

try {
  await mkdir(artifacts, { recursive: true });
  // Docker's context override takes precedence over DOCKER_HOST, just as the CLI does.
  const endpoint = process.env.DOCKER_CONTEXT
    ? JSON.parse((await docker(["context", "inspect", process.env.DOCKER_CONTEXT, "--format", "{{json .Endpoints.docker.Host}}"])).stdout)
    : process.env.DOCKER_HOST || JSON.parse((await docker(["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"])).stdout);
  assert(/^(?:unix:\/\/\/|npipe:\/\/\/\/\.\/pipe\/|tcp:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):)/.test(endpoint), "Use a local Docker endpoint for this image check");
  assert.equal((await docker(["info", "--format", "{{.OSType}}"])).stdout.trim(), "linux", "Docker must be running its Linux engine");
  if (!args.includes("--no-build")) {
    console.log("Building the Linux sandbox image from the prepared cloud bundle…");
    await docker(["build", "--platform", "linux/amd64", "--progress", "plain", "--tag", IMAGE, "apps/cloud/container"], { timeoutMs: 30 * 60_000, progress: true });
  }
  const image = JSON.parse((await docker(["image", "inspect", "--format", "{{json .}}", IMAGE])).stdout);
  assert.equal(image.Os, "linux"); assert.equal(image.Architecture, "amd64"); assert.equal(image.Config.User, "adcode");
  assert.match(image.Id, /^sha256:[a-f0-9]{64}$/); imageId = image.Id;
  checks.linuxImageAsUnprivilegedUser = true;
  const newNetworkId = (await docker(["network", "create", "--driver", "bridge", "--internal", "--label", `adcode.launch-check=${runId}`, networkName])).stdout.trim();
  assert.match(newNetworkId, /^[a-f0-9]{64}$/);
  networkId = newNetworkId;
  const network = JSON.parse((await docker(["network", "inspect", networkId])).stdout)[0];
  assert.equal(network.Internal, true);
  assert.equal(network.Name, networkName); assert.equal(network.Labels["adcode.launch-check"], runId);
  checks.runtimeNetworkIsInternal = true;

  console.log("Checking the bundled host, native terminal and Chromium in fresh Linux homes…");
  const a = await createContainer("a");
  checks.healthVersion = true;
  const runtime = await docker(["exec", a.id, "node", "--input-type=module", "-e", `
    import { execFileSync } from 'node:child_process';
    import { createHash } from 'node:crypto';
    import { readFileSync } from 'node:fs';
    import { homedir } from 'node:os';
    const version = command => execFileSync(command, ['--version'], { encoding: 'utf8' }).trim().split('\\n')[0];
    const hostHash = createHash('sha256').update(readFileSync('/opt/adcode/host/index.js')).digest('hex');
    console.log(JSON.stringify({ uid: process.getuid(), home: homedir(), node: process.version, arch: process.arch, hostHash, git: version('git'), tar: version('tar'), chromium: version(process.env.CHROMIUM_PATH) }));
  `]);
  const tools = JSON.parse(runtime.stdout);
  assert.notEqual(tools.uid, 0); assert.equal(tools.home, "/home/adcode"); assert.match(tools.node, /^v24\./); assert.equal(tools.arch, "x64");
  assert.equal(tools.hostHash, expectedHostHash, "Image host bundle differs from the prepared launch bundle");
  assert.match(tools.git, /git version/); assert.match(tools.tar, /tar/); assert.match(tools.chromium, /Chromium/);
  checks.runtimeTools = tools;
  assert.equal((await request(a, "/__adcode/state", { authorized: false })).status, 401);
  assert.equal((await request(a, "/__adcode/home-archive", { authorized: false })).status, 401);
  await assert.rejects(connect(a, null), /HTTP 401/);
  await assert.rejects(connect(a, "incorrect-test-secret"), /HTTP 401/);
  checks.hostSecretRequired = true;
  const client = await connect(a);
  assert.equal(client.hello.surface, "web"); assert.equal(client.hello.version, expectedVersion); assert.equal(client.hello.projectsHome, "/home/adcode/projects");
  assert.equal((await client.call("app:info")).version, expectedVersion);
  const state = await (await request(a, "/__adcode/state")).json();
  assert.equal(state.connections, 1); assert.equal(state.busy, false);
  checks.authenticatedSocket = true;

  const workspace = await client.call("workspace:create-project", ["Image acceptance"]);
  const root = workspace?.root;
  assert.equal(typeof root, "string");
  assert(root.startsWith("/home/adcode/projects/") && !root.includes(".."), "Project must live in the disposable home");
  const project = posix.basename(root);
  const html = `<!doctype html><html lang="en"><head><title>Image acceptance</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;margin:16px}h1{overflow-wrap:anywhere}</style></head><body><h1>${marker}</h1><button onclick="this.textContent='Clicked'">Image test</button></body></html>`;
  assert.equal((await client.call("fs:write", [`${root}/index.html`, html])).ok, true);
  assert.equal((await client.call("fs:read", [`${root}/index.html`])).text, html);
  assert((await client.op("projects")).some((entry) => entry.path === root));
  const git = await client.call("git:status");
  assert.equal(git.isRepo, true); assert(git.entries.some((entry) => entry.path === "index.html"));
  checks.projectFilesystemAndGit = true;

  for (const [label, width, height] of [["desktop", 1280, 800], ["phone", 390, 844]]) {
    const view = await client.call("browser:view", [{ path: "index.html", width, height, screenshot: true }]);
    assert.equal(view.error, false); assert(view.report.includes(marker), `Chromium ${label} did not render the marker`);
    assert.match(view.url, /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+\//);
    assert.equal(view.width, width); assert.equal(view.height, height);
    assert.match(view.image ?? "", /^data:image\/jpeg;base64,/);
    const jpeg = Buffer.from(view.image.split(",", 2)[1], "base64");
    assert(jpeg.length > 1000 && jpeg[0] === 0xff && jpeg[1] === 0xd8, "Chromium screenshot is not a JPEG");
    await writeFile(join(artifacts, `chromium-${label}.jpg`), jpeg);
    checks[`chromium${label === "phone" ? "Phone" : "Desktop"}`] = true;
  }

  const terminal = await client.call("terminal:create", [{ profileId: "sh", cols: 80, rows: 24, cwd: root }]);
  assert.equal(typeof terminal, "string");
  // Split the marker in the command: an echoed input line alone cannot satisfy the check.
  const half = Math.floor(terminalMarker.length / 2);
  client.send("terminal:write", [terminal, `printf '%s%s\\n' '${terminalMarker.slice(0, half)}' '${terminalMarker.slice(half)}'; exit 0\n`]);
  await waitUntil(() => client.events.some((event) => event.ch === "terminal:exit" && event.args[0] === terminal), "Native terminal exit", 15_000);
  const output = client.events.filter((event) => event.ch === "terminal:data" && event.args[0] === terminal).map((event) => event.args[1]).join("");
  assert(output.includes(terminalMarker), "node-pty did not execute the command");
  assert.equal(client.events.find((event) => event.ch === "terminal:exit" && event.args[0] === terminal).args[1], 0);
  checks.nativePtyCommand = true;

  await docker(["exec", a.id, "node", "--input-type=module", "-e", `
    import { mkdir, writeFile } from 'node:fs/promises';
    for (const directory of ['.cache', '.npm', '.adcode/logs', '.adcode/trash', ${JSON.stringify(`projects/${project}/node_modules`)}]) {
      await mkdir('/home/adcode/' + directory, { recursive: true });
      await writeFile('/home/adcode/' + directory + '/image-check-excluded', 'excluded cache');
    }
    await writeFile('/home/adcode/.adcode/image-check-persisted', ${JSON.stringify(marker)});
  `]);
  const download = await request(a, `/__adcode/download?project=${encodeURIComponent(project)}`);
  assert.equal(download.status, 200); assert.match(download.headers.get("content-type") ?? "", /gzip/);
  const projectBytes = await responseBytes(download);
  const projectFiles = tarFiles(projectBytes);
  assert.equal(projectFiles.get(`${project}/index.html`)?.toString(), html);
  assert(![...projectFiles.keys()].some((path) => path.split("/").some((part) => part === ".git" || part === "node_modules")));
  checks.projectDownloadExcludesCachesAndGit = true;
  await client.close();
  const archive = await request(a, "/__adcode/home-archive");
  assert.equal(archive.status, 200); assert.match(archive.headers.get("content-type") ?? "", /gzip/);
  const archiveBytes = await responseBytes(archive);
  const homeFiles = tarFiles(archiveBytes);
  assert.equal(homeFiles.get(`projects/${project}/index.html`)?.toString(), html);
  assert(homeFiles.has(`projects/${project}/.git/HEAD`));
  assert.equal(homeFiles.get(".adcode/image-check-persisted")?.toString(), marker);
  assert(![...homeFiles.keys()].some((path) => [".cache/", ".npm/", ".adcode/logs/", ".adcode/trash/"].some((prefix) => path.startsWith(prefix))));
  checks.homeArchivePreservesWorkAndExcludesCaches = true;
  checks.archiveBytes = archiveBytes.length;
  await writeFile(join(artifacts, "home.tar.gz"), archiveBytes);
  await writeFile(join(artifacts, "project.tar.gz"), projectBytes);
  await stopContainer(a);
  checks.firstHostStoppedCleanly = true;

  const b = await createContainer("b");
  // Match the cloud startup order: restore before any browser socket opens the home.
  const fresh = await docker(["exec", b.id, "node", "--input-type=module", "-e", "import { readdirSync, existsSync } from 'node:fs'; console.log(JSON.stringify({ projects: readdirSync('/home/adcode/projects'), persisted: existsSync('/home/adcode/.adcode/image-check-persisted') }));"]);
  const freshHome = JSON.parse(fresh.stdout);
  assert.deepEqual(freshHome.projects, [], "Restore target was not a fresh home"); assert.equal(freshHome.persisted, false);
  const restored = await request(b, "/__adcode/home-archive", { method: "PUT", headers: { "content-type": "application/gzip" }, body: archiveBytes });
  assert.equal(restored.status, 204);
  const restoredClient = await connect(b);
  assert((await restoredClient.op("projects")).some((entry) => entry.path === root));
  assert.equal((await restoredClient.call("workspace:open-path", [root])).root, root);
  assert.equal((await restoredClient.call("fs:read", [`${root}/index.html`])).text, html);
  assert.equal((await restoredClient.call("git:status")).isRepo, true);
  const persisted = await docker(["exec", b.id, "node", "--input-type=module", "-e", "import { readFileSync } from 'node:fs'; process.stdout.write(readFileSync('/home/adcode/.adcode/image-check-persisted')); "]);
  assert.equal(persisted.stdout, marker);
  checks.freshHomeRestoredThroughHost = true;
  await restoredClient.close();
  await stopContainer(b);
  checks.restoredHostStoppedCleanly = true;
} catch (error) {
  failure = redact(error?.stack ?? error);
} finally {
  cleaning = true;
  if (interrupted && !failure) failure = "Image check interrupted";
  for (const client of clients) await client.close().catch(() => {});
  const cleanupErrors = [];
  const logErrors = [];
  for (const container of created) {
    try {
      const logs = await docker(["logs", container.id], { allowFailure: true });
      await writeFile(join(artifacts, `host-${container.suffix}.log`), redact(logs.stdout + logs.stderr));
      if (/ERR_MODULE_NOT_FOUND|Cannot find module|UnhandledPromiseRejection|uncaughtException/.test(logs.stdout + logs.stderr)) {
        logErrors.push(`Container ${container.suffix} logged an unhandled/runtime dependency error`);
      }
    } catch (error) { logErrors.push(redact(error.message)); }
    try {
      const labels = await inspect(container.id, ".Config.Labels");
      assert.equal(labels?.["adcode.launch-check"], runId, "Refusing to remove a container without this invocation's ownership label");
      await docker(["rm", "--force", container.id]);
    } catch (error) { cleanupErrors.push(redact(error.message)); }
  }
  if (networkId) {
    try {
      const network = JSON.parse((await docker(["network", "inspect", networkId])).stdout)[0];
      assert.equal(network.Name, networkName); assert.equal(network.Labels?.["adcode.launch-check"], runId, "Refusing to remove a network without this invocation's ownership label");
      await docker(["network", "rm", networkId]);
    } catch (error) { cleanupErrors.push(redact(error.message)); }
  }
  if (cleanupErrors.length || logErrors.length) failure = [failure, ...cleanupErrors, ...logErrors].filter(Boolean).join("\n");
  checks.createdResourcesRemoved = cleanupErrors.length === 0;
  const result = { passed: !failure, image: IMAGE, imageId, version: expectedVersion, checks, artifacts, ...(failure ? { failure } : {}) };
  await writeFile(join(artifacts, "results.json"), JSON.stringify(result, null, 2)).catch(() => {});
  console.log(JSON.stringify(result, null, 2));
  process.removeListener("SIGINT", signal);
  process.removeListener("SIGTERM", signal);
  process.exitCode = failure ? 1 : 0;
}
