/** GitHub-backed projects without a running sandbox. Credentials never leave the user's DO. */
const DEFAULT_CLIENT_ID = "Ov23lienZUTAiNKAM0UV";
const MAX_FILE_BYTES = 256_000;
const MAX_BODY_BYTES = 1_500_000;
const MAX_CHANGED_BYTES = 1_000_000;
const MAX_TREE_FILES = 5_000;
const encoder = new TextEncoder();
type JsonObject = Record<string, unknown>;
interface StoredToken { iv: string; ciphertext: string; login: string }
interface Flow { id: string; deviceCode: string; expiresAt: number; intervalMs: number; nextPollAt: number }
interface Options { uid: string; sealKey: string; clientId?: string; fetcher?: typeof fetch; now?: () => number }
class Failure extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const invalid = (message = "Check the repository, branch and file details."): never => { throw new Failure(400, "invalid-request", message); };
const record = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{40}$/i.test(value);
const json = (value: unknown, status = 200): Response => Response.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
function base64(bytes: Uint8Array): string { let text = ""; for (const byte of bytes) text += String.fromCharCode(byte); return btoa(text); }
function unbase64(text: string): Uint8Array { return Uint8Array.from(atob(text), (character) => character.charCodeAt(0)); }
async function boundedText(response: Response | Request, limit: number): Promise<string> {
  if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new Failure(413, "too-large", "This request or file is too large. Choose smaller text files."); }
  const reader = response.body?.getReader();
  if (reader === undefined) return "";
  const decoder = new TextDecoder(); let size = 0; let text = "";
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Failure(413, "too-large", "This request or file is too large. Choose smaller text files."); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}
function repository(value: unknown): string {
  if (!string(value, 200) || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})\/[a-zA-Z0-9_.-]{1,100}$/.test(value) || value.split("/")[1] === "." || value.split("/")[1] === "..") return invalid("Choose a GitHub repository in owner/name format.");
  return value;
}
function branch(value: unknown): string {
  if (!string(value, 200) || !/^[a-zA-Z0-9_][a-zA-Z0-9_.\/-]*$/.test(value) || value.includes("..") || value.includes("//") || value.endsWith("/") || value.endsWith(".") || value.split("/").some(part => part.startsWith(".") || part.endsWith(".lock"))) return invalid("Choose a valid GitHub branch.");
  return value;
}
function safePath(value: unknown, writing = false): string {
  if (!string(value, 512) || value.includes("\\") || /[\x00-\x1f\x7f]/.test(value) || value.split("/").some(part => part === "" || part === "." || part === ".." || part.toLowerCase() === ".git")) return invalid("Choose a file inside the repository.");
  const parts = value.toLowerCase().split("/"); const name = parts.at(-1)!;
  if (parts.some(part => [".ssh", ".aws", ".gnupg"].includes(part)) || [".npmrc", ".pypirc", ".netrc", ".git-credentials", ".envrc"].includes(name) || /^(?:\.env|\.dev\.vars)(?:\.|$)/.test(name) && !/\.(?:example|sample|template)$/.test(name) || /\.(?:pem|p12|pfx|key|jks)$/.test(name) || /^(?:id_rsa|id_ed25519|credentials|credentials\.json|service-account[^/]*\.json)$/.test(name)) throw new Failure(403, "sensitive-file", "Credential files are excluded from repository context and changes.");
  if (writing && parts[0] === ".github" && parts[1] === "workflows") throw new Failure(403, "workflow-change", "Workflow changes need separate GitHub permissions. Edit this file on GitHub.");
  return value;
}
function githubUrl(value: unknown, repo: string): string {
  if (typeof value !== "string") throw new Failure(502, "github-unavailable", "GitHub returned an unexpected response.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || !url.pathname.toLowerCase().startsWith(`/${repo.toLowerCase()}/`)) throw new Failure(502, "github-unavailable", "GitHub returned an unexpected response.");
  return url.href;
}

export async function handleGitHubWorkspace(request: Request, storage: DurableObjectStorage, options: Options): Promise<Response> {
  const now = options.now ?? Date.now; const fetcher = options.fetcher ?? fetch;
  const prefix = `github:${options.uid}:`; const tokenKey = `${prefix}token`; const flowKey = `${prefix}flow`;
  const clientId = options.clientId ?? DEFAULT_CLIENT_ID;
  const key = async (): Promise<CryptoKey> => crypto.subtle.importKey("raw", unbase64(options.sealKey), "AES-GCM", false, ["encrypt", "decrypt"]);
  const associatedData = encoder.encode(`adcode-github:${options.uid}`);
  async function seal(token: string, login: string): Promise<StoredToken> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: associatedData }, await key(), encoder.encode(token));
    return { iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)), login };
  }
  async function connected(): Promise<{ token: string; login: string } | null> {
    const saved = await storage.get<StoredToken>(tokenKey); if (saved === undefined) return null;
    try {
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64(saved.iv), additionalData: associatedData }, await key(), unbase64(saved.ciphertext));
      return { token: new TextDecoder().decode(plaintext), login: saved.login };
    } catch { return null; }
  }
  async function call(path: string, token: string | null, method = "GET", body?: unknown, limit = 2_000_000): Promise<{ data: unknown; response: Response }> {
    const oauth = path.startsWith("/login/");
    const response = await fetcher(`${oauth ? "https://github.com" : "https://api.github.com"}${path}`, {
      method, redirect: "manual", signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
      headers: { accept: oauth ? "application/json" : "application/vnd.github+json", "user-agent": "ADCode", ...(!oauth ? { "x-github-api-version": "2026-03-10" } : {}), ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...(body === undefined ? {} : { "content-type": oauth ? "application/x-www-form-urlencoded" : "application/json" }) },
      ...(body === undefined ? {} : { body: oauth ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body) }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401) throw new Failure(401, "github-not-connected", "Reconnect GitHub to continue.");
      if (response.status === 429 || response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") throw new Failure(429, "rate-limit", "GitHub's request limit was reached. Try again later.");
      if (response.status === 403) throw new Failure(403, "github-permission", "GitHub did not grant permission for this repository or action.");
      if (response.status === 404) throw new Failure(404, "not-found", "That repository, branch or file was not found.");
      if (response.status === 409 || response.status === 422) throw new Failure(409, "github-conflict", "The repository changed or GitHub could not accept this change. Refresh and try again.");
      throw new Failure(502, "github-unavailable", "GitHub could not complete this request. Try again.");
    }
    let data: unknown;
    try { data = JSON.parse(await boundedText(response, limit)); } catch (error) { if (error instanceof Failure) throw error; throw new Failure(502, "github-unavailable", "GitHub returned an unreadable response."); }
    return { data, response };
  }
  async function object(path: string, token: string, method = "GET", body?: unknown): Promise<JsonObject> {
    const { data } = await call(path, token, method, body); if (!record(data)) throw new Failure(502, "github-unavailable", "GitHub returned an unexpected response."); return data;
  }
  try {
    if (!string(options.uid, 128)) throw new Failure(401, "unauthenticated", "Sign in first.");
    const url = new URL(request.url); const route = url.pathname;
    const methods: Record<string, string> = { "/github/status": "GET", "/github/start": "POST", "/github/poll": "POST", "/github/disconnect": "POST", "/github/repos": "GET", "/github/tree": "GET", "/github/file": "GET", "/github/pull-request": "POST" };
    if (!Object.hasOwn(methods, route)) return json({ error: { code: "not-found", message: "Not found." } }, 404);
    if (request.method !== methods[route]) return json({ error: { code: "method", message: `Use ${methods[route]}.` } }, 405);
    if (route === "/github/status") { const account = await connected(); return json({ connected: account !== null, login: account?.login ?? null }); }
    if (route === "/github/disconnect") { await storage.delete([tokenKey, flowKey]); return json({ ok: true }); }
    if (route === "/github/start") {
      const id = crypto.randomUUID(); const startedAt = now();
      await storage.transaction(async transaction => {
        const last = await transaction.get<number>(`${prefix}lastStart`);
        if (last !== undefined && startedAt - last < 10_000) throw new Failure(429, "rate-limit", "Wait a few seconds before requesting another GitHub code.");
        await transaction.put({ [`${prefix}lastStart`]: startedAt, [flowKey]: { id } });
      });
      const { data } = await call("/login/device/code", null, "POST", { client_id: clientId, scope: "repo read:user user:email" });
      if (!record(data) || !string(data.device_code, 2000) || !string(data.user_code, 100) || data.verification_uri !== "https://github.com/login/device") throw new Failure(502, "github-unavailable", "GitHub did not start sign-in. Try again.");
      const intervalMs = Math.max(5, typeof data.interval === "number" && Number.isFinite(data.interval) ? data.interval : 5) * 1000;
      const expiresAt = startedAt + Math.max(1, Math.min(900, typeof data.expires_in === "number" && Number.isFinite(data.expires_in) ? data.expires_in : 900)) * 1000;
      const flow: Flow = { id, deviceCode: data.device_code, expiresAt, intervalMs, nextPollAt: startedAt + intervalMs };
      await storage.transaction(async transaction => { if ((await transaction.get<Partial<Flow>>(flowKey))?.id === id) await transaction.put(flowKey, flow); });
      return json({ userCode: data.user_code, verificationUri: data.verification_uri, expiresAt, intervalMs });
    }
    if (route === "/github/poll") {
      const claimed = await storage.transaction(async transaction => {
        const flow = await transaction.get<Flow>(flowKey);
        if (flow === undefined || !string(flow.deviceCode, 2000) || flow.expiresAt <= now()) { await transaction.delete(flowKey); return { state: "expired" as const }; }
        if (flow.nextPollAt > now()) return { state: "pending" as const, retryAfterMs: flow.nextPollAt - now() };
        await transaction.put(flowKey, { ...flow, nextPollAt: now() + flow.intervalMs });
        return { flow };
      });
      if (!("flow" in claimed) || claimed.flow === undefined) return json(claimed);
      const flow = claimed.flow;
      const { data } = await call("/login/oauth/access_token", null, "POST", { client_id: clientId, device_code: flow.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
      if (!record(data)) throw new Failure(502, "github-unavailable", "GitHub returned an unexpected response.");
      if (string(data.access_token, 4096)) {
        const user = await object("/user", data.access_token);
        if (!string(user.login, 39) || !/^[a-zA-Z0-9-]+$/.test(user.login)) throw new Failure(502, "github-unavailable", "GitHub did not identify this account.");
        const saved = await seal(data.access_token, user.login);
        const accepted = await storage.transaction(async transaction => {
          if ((await transaction.get<Flow>(flowKey))?.id !== flow.id) return false;
          await transaction.put(tokenKey, saved); await transaction.delete(flowKey); return true;
        });
        return json(accepted ? { state: "connected", login: user.login } : { state: "expired" });
      }
      if (data.error === "authorization_pending" || data.error === "slow_down") {
        const intervalMs = flow.intervalMs + (data.error === "slow_down" ? 5000 : 0);
        await storage.transaction(async transaction => { if ((await transaction.get<Flow>(flowKey))?.id === flow.id) await transaction.put(flowKey, { ...flow, intervalMs, nextPollAt: now() + intervalMs }); });
        return json({ state: "pending", retryAfterMs: intervalMs });
      }
      await storage.transaction(async transaction => { if ((await transaction.get<Flow>(flowKey))?.id === flow.id) await transaction.delete(flowKey); });
      return json({ state: data.error === "expired_token" ? "expired" : "denied" });
    }
    const account = await connected(); if (account === null) throw new Failure(401, "github-not-connected", "Connect GitHub to open a repository.");
    const token = account.token;
    if (route === "/github/repos") {
      const pageText = url.searchParams.get("page") ?? "1"; if (!/^[1-9]\d{0,3}$/.test(pageText)) return invalid("Choose a valid repository page."); const page = Number(pageText);
      const { data, response } = await call(`/user/repos?per_page=50&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`, token);
      if (!Array.isArray(data)) throw new Failure(502, "github-unavailable", "GitHub returned an unexpected response.");
      const repos = data.filter(record).filter(repo => string(repo.full_name, 200) && string(repo.default_branch, 200)).map(repo => ({ fullName: repository(repo.full_name), defaultBranch: repo.default_branch, private: repo.private === true, canPush: record(repo.permissions) && repo.permissions.push === true, htmlUrl: `https://github.com/${repository(repo.full_name)}` }));
      return json({ repos, nextPage: /rel="next"/.test(response.headers.get("link") ?? "") ? page + 1 : null });
    }
    if (route === "/github/tree") {
      const repo = repository(url.searchParams.get("repo")); const ref = branch(url.searchParams.get("ref"));
      const latest = await object(`/repos/${repo}/commits/${encodeURIComponent(ref)}`, token); if (!sha(latest.sha) || !record(latest.commit) || !record(latest.commit.tree) || !sha(latest.commit.tree.sha)) throw new Failure(502, "github-unavailable", "GitHub returned an unexpected commit.");
      const { data } = await call(`/repos/${repo}/git/trees/${latest.commit.tree.sha}?recursive=1`, token, "GET", undefined, 8_000_000);
      if (!record(data) || !Array.isArray(data.tree)) throw new Failure(502, "github-unavailable", "GitHub returned an unexpected file tree.");
      const files: { path: string; sha: string; size: number }[] = [];
      for (const entry of data.tree) {
        if (!record(entry) || entry.type !== "blob" || !sha(entry.sha) || typeof entry.size !== "number" || entry.size > MAX_FILE_BYTES || entry.mode === "120000") continue;
        try { files.push({ path: safePath(entry.path), sha: entry.sha, size: entry.size }); } catch { /* Omit credential files and unsupported paths from model context. */ }
      }
      return json({ repo, ref, commit: latest.sha, files: files.slice(0, MAX_TREE_FILES), truncated: data.truncated === true || files.length > MAX_TREE_FILES });
    }
    if (route === "/github/file") {
      const repo = repository(url.searchParams.get("repo")); const ref = url.searchParams.get("ref"); if (!sha(ref)) return invalid("Read files from a selected commit.");
      const path = safePath(url.searchParams.get("path")); const value = await object(`/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`, token);
      if (value.type !== "file" || value.encoding !== "base64" || typeof value.content !== "string" || !sha(value.sha) || typeof value.size !== "number" || value.size > MAX_FILE_BYTES) throw new Failure(413, "too-large", "Choose a text file smaller than 256 KB.");
      const bytes = unbase64(value.content.replace(/\s/g, "")); if (bytes.byteLength > MAX_FILE_BYTES || bytes.includes(0)) throw new Failure(413, "too-large", "Choose a text file smaller than 256 KB.");
      let content: string; try { content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes); } catch { throw new Failure(400, "binary-file", "This file is not UTF-8 text."); }
      return json({ path, sha: value.sha, content, bytes: bytes.byteLength });
    }
    let raw: unknown; try { raw = JSON.parse(await boundedText(request, MAX_BODY_BYTES)); } catch (error) { if (error instanceof Failure) throw error; return invalid("Send a valid change request."); }
    if (!record(raw)) return invalid();
    const repo = repository(raw.repo); const baseBranch = branch(raw.baseBranch); const baseCommit = raw.baseCommit;
    if (!sha(baseCommit) || !string(raw.title, 200) || !raw.title.trim() || typeof raw.body !== "string" || raw.body.length > 10_000 || !Array.isArray(raw.files) || raw.files.length < 1 || raw.files.length > 50) return invalid("Choose 1–50 changed files and a pull request title.");
    const seen = new Set<string>(); let totalBytes = 0;
    const files = raw.files.map(file => {
      if (!record(file)) return invalid(); const path = safePath(file.path, true);
      if (seen.has(path) || file.content !== null && typeof file.content !== "string") return invalid("Each changed file must appear once with text content or a deletion."); seen.add(path);
      const content = file.content as string | null; const bytes = content === null ? 0 : encoder.encode(content).byteLength;
      totalBytes += bytes; if (bytes > MAX_FILE_BYTES || totalBytes > MAX_CHANGED_BYTES || content?.includes("\0")) throw new Failure(413, "too-large", "Changes exceed the text file limit. Split this into smaller changes.");
      return { path, content };
    });
    const latest = await object(`/repos/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`, token);
    if (!record(latest.object) || latest.object.sha !== baseCommit) throw new Failure(409, "base-moved", "The branch changed since you opened it. Refresh the repository and review your changes again.");
    const commit = await object(`/repos/${repo}/git/commits/${baseCommit}`, token); if (!record(commit.tree) || !sha(commit.tree.sha)) throw new Failure(502, "github-unavailable", "GitHub returned an unexpected commit.");
    const baseTree = await call(`/repos/${repo}/git/trees/${commit.tree.sha}?recursive=1`, token, "GET", undefined, 8_000_000);
    if (!record(baseTree.data) || !Array.isArray(baseTree.data.tree) || baseTree.data.truncated === true) throw new Failure(413, "too-large", "This repository is too large to safely prepare these changes. Use a smaller repository or the coding workspace.");
    const existing = new Map<string, JsonObject>();
    for (const item of baseTree.data.tree) if (record(item) && typeof item.path === "string") existing.set(item.path, item);
    const treeEntries: JsonObject[] = [];
    for (const file of files) {
      const previous = existing.get(file.path);
      if (previous !== undefined && (previous.type !== "blob" || !["100644", "100755"].includes(String(previous.mode)))) return invalid("Only regular text files can be changed.");
      if (file.content === null && previous === undefined) return invalid("A deleted file no longer exists in the selected commit.");
      const mode = previous?.mode ?? "100644";
      if (file.content === null) treeEntries.push({ path: file.path, mode, type: "blob", sha: null });
      else { const blob = await object(`/repos/${repo}/git/blobs`, token, "POST", { content: file.content, encoding: "utf-8" }); if (!sha(blob.sha)) throw new Failure(502, "github-unavailable", "GitHub could not save a file."); treeEntries.push({ path: file.path, mode, type: "blob", sha: blob.sha }); }
    }
    const tree = await object(`/repos/${repo}/git/trees`, token, "POST", { base_tree: commit.tree.sha, tree: treeEntries }); if (!sha(tree.sha)) throw new Failure(502, "github-unavailable", "GitHub could not prepare these changes.");
    const created = await object(`/repos/${repo}/git/commits`, token, "POST", { message: raw.title.trim(), tree: tree.sha, parents: [baseCommit] }); if (!sha(created.sha)) throw new Failure(502, "github-unavailable", "GitHub could not prepare this commit.");
    // Check again after preparing objects. Never overwrite a branch that moved during generation.
    const checked = await object(`/repos/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`, token);
    if (!record(checked.object) || checked.object.sha !== baseCommit) throw new Failure(409, "base-moved", "The branch changed while preparing the pull request. Refresh and review your changes again.");
    const newBranch = `adcode/${now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    await object(`/repos/${repo}/git/refs`, token, "POST", { ref: `refs/heads/${newBranch}`, sha: created.sha });
    const pull = await object(`/repos/${repo}/pulls`, token, "POST", { title: raw.title.trim(), body: raw.body, head: newBranch, base: baseBranch });
    if (typeof pull.number !== "number") throw new Failure(502, "github-unavailable", "GitHub created the branch but could not return the pull request. Check your repository on GitHub.");
    return json({ url: githubUrl(pull.html_url, repo), branch: newBranch, number: pull.number });
  } catch (error) {
    if (error instanceof Failure) return json({ error: { code: error.code, message: error.message } }, error.status);
    return json({ error: { code: "github-unavailable", message: "GitHub could not complete this request. Try again." } }, 502);
  }
}
