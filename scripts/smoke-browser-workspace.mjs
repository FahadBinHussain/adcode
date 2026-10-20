/** Real browser check: chat, GitHub proposals and recovery work with no runtime socket. */
import { createServer } from "vite";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { launchBrowser } from "./lib/headlessEdge.mjs";

const port = Number(process.env.ADCODE_BROWSER_WEB_PORT ?? 5188);
const output = resolve(".tmp/browser-workspace-check");
await mkdir(output, { recursive: true });
const chats = new Map();
const deleted = new Map();
const commit = "a".repeat(40);
let prRequests = 0;
const paths = [];
const fixture = {
  name: "browser-workspace-fixtures",
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, "http://localhost");
      if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/v1/")) return next();
      paths.push(url.pathname);
      const json = (body, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
      let text = "";
      for await (const chunk of req) text += chunk;
      const body = text ? JSON.parse(text) : {};
      if (url.pathname === "/v1/ai/tagflow/config") return json({ available: true, defaultModel: "qa", models: [{ id: "qa", name: "Included AI test", contextWindow: 64000, maxOutput: 4096 }] });
      if (url.pathname === "/v1/ai/tagflow/chat/completions") {
        const count = body.messages.filter(message => message.role === "tool").length;
        const delta = !body.tools ? { content: "Hello. Chat works without a cloud workspace." }
          : count === 0 ? { tool_calls: [{ index: 0, id: "read_1", function: { name: "read_file", arguments: JSON.stringify({ path: "src/greeting.ts" }) } }] }
          : count === 1 ? { tool_calls: [{ index: 0, id: "write_1", function: { name: "propose_file", arguments: JSON.stringify({ path: "src/greeting.ts", content: "export const greeting = 'Hello from GitHub';\n" }) } }] }
          : { content: "Prepared the greeting change. Review it before creating a pull request." };
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
        return;
      }
      if (url.pathname === "/api/chats") return json({ chats: [...chats.values()].map(({ messages, proposals, ...summary }) => summary) });
      const match = /^\/api\/chats\/([^/]+)(\/restore)?$/.exec(url.pathname);
      if (match) {
        const id = match[1];
        if (match[2]) { const chat = deleted.get(id); deleted.delete(id); chats.set(id, chat); return json(chat); }
        if (req.method === "PUT") { chats.set(id, body); return json(body); }
        if (req.method === "DELETE") { deleted.set(id, chats.get(id)); chats.delete(id); return json({ ok: true }); }
        return chats.has(id) ? json(chats.get(id)) : json({ error: "Chat not found" }, 404);
      }
      if (url.pathname === "/api/github/status") return json({ connected: true, login: "adcode-qa" });
      if (url.pathname === "/api/github/repos") return json({ repos: [{ fullName: "example/project", defaultBranch: "main", private: true, canPush: true, htmlUrl: "https://github.com/example/project" }], nextPage: null });
      if (url.pathname === "/api/github/tree") return json({ repo: "example/project", ref: url.searchParams.get("ref"), commit, files: [{ path: "src/greeting.ts", sha: "b".repeat(40), size: 40 }], truncated: false });
      if (url.pathname === "/api/github/file") return json({ path: "src/greeting.ts", sha: "b".repeat(40), content: "export const greeting = 'Hello';\n", bytes: 33 });
      if (url.pathname === "/api/github/pull-request") { prRequests++; return json({ url: "https://github.com/example/project/pull/1", branch: "adcode/qa", number: 1 }); }
      return json({ error: "Not found" }, 404);
    });
  },
};
const server = await createServer({ configFile: "apps/desktop/vite.web.config.ts", mode: "development", plugins: [fixture], server: { port, strictPort: true } });
let browser;
const results = {};
function requireCheck(value, label) { results[label] = value; if (!value) throw new Error(`Failed: ${label}`); }
try {
  await server.listen();
  browser = await launchBrowser({ port: 9492, width: 1440, height: 960 });
  await browser.cdp("Page.addScriptToEvaluateOnNewDocument", { source: `window.__qaRuntimeSockets=0;const NativeSocket=window.WebSocket;window.WebSocket=class extends NativeSocket{constructor(url,...args){if(new URL(url,location.href).pathname==='/socket')window.__qaRuntimeSockets++;super(url,...args)}};` });
  await browser.goto(`http://localhost:${port}/?browser=1`);
  requireCheck(await browser.waitFor(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('Continue in dev mode'))`, { timeoutMs: 90_000 }), "devSignInVisible");
  await browser.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Continue in dev mode')).click()`);
  requireCheck(await browser.waitFor(`document.querySelector('#web-workspace') && !document.querySelector('.bw-model').disabled`), "browserWorkspaceReady");
  requireCheck(await browser.evaluate(`window.__qaRuntimeSockets===0 && typeof window.adcode==='undefined'`), "noSandboxOnEntry");
  requireCheck(await browser.evaluate(`document.querySelector('.web-rail')?.getBoundingClientRect().width >= 40 && parseFloat(getComputedStyle(document.querySelector('.bw-sidebar')).borderRadius) >= 12 && !!document.querySelector('[role="tablist"]')`), "originalFrameRestored");
  requireCheck(await browser.evaluate(`document.querySelector('#web-workspace').dataset.project==='closed' && getComputedStyle(document.querySelector('.bw-project')).display==='none'`), "projectPanelClosedOnEntry");
  await browser.screenshot(resolve(output, "welcome.png"));
  await browser.evaluate(`Array.from(document.querySelectorAll('.bw-sidebar button')).find(b=>b.textContent.trim()==='Earnings').click()`);
  requireCheck(await browser.waitFor(`document.querySelector('.web-account-dialog')?.firstElementChild?.shadowRoot?.querySelector('main[aria-label="Earnings"]')`), "earningsUsesExistingAccountPanel");
  await browser.evaluate(`document.querySelector('.web-account-dialog').firstElementChild.shadowRoot.querySelector('.account-back').click()`);
  requireCheck(await browser.waitFor(`!document.querySelector('.web-account-dialog')`), "accountPanelCloses");
  const send = async text => browser.evaluate(`(()=>{const input=document.querySelector('.bw-input');input.value=${JSON.stringify(text)};input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.bw-send').click()})()`);
  await send("Say hello");
  requireCheck(await browser.waitFor(`document.querySelector('.bw-transcript').textContent.includes('Chat works without a cloud workspace') && document.querySelector('.bw-send').getAttribute('aria-label')==='Send message'`), "plainChatWorks");
  await browser.evaluate(`document.querySelector('.bw-sidebar-toggle').click()`);
  requireCheck(await browser.evaluate(`(()=>{const main=document.querySelector('.bw-main');const transcript=document.querySelector('.bw-transcript');const composer=document.querySelector('.bw-composer');const message=document.querySelector('.bw-message');const visible=el=>{const r=el.getBoundingClientRect();return r.width>320&&r.height>40};return document.querySelector('#web-workspace').dataset.history==='closed'&&getComputedStyle(main).gridColumnStart==='3'&&visible(main)&&visible(transcript)&&visible(composer)&&message.getBoundingClientRect().width>300})()`), "chatFillsCardAfterSidebarCloses");
  await browser.evaluate(`document.querySelector('.bw-sidebar-toggle').click()`);
  requireCheck(chats.size === 1, "conversationSaved");
  await browser.evaluate(`document.querySelector('.bw-project-toggle').click()`);
  requireCheck(await browser.waitFor(`getComputedStyle(document.querySelector('.bw-project')).display!=='none'`), "projectPanelOpens");
  await browser.evaluate(`(()=>{const select=document.querySelector('[aria-label="GitHub repository"]');select.value='example/project';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  requireCheck(await browser.waitFor(`document.querySelector('.bw-context').textContent.includes('example/project') && document.querySelector('.bw-file')`), "githubContextLoaded");
  await send("Update the greeting");
  requireCheck(await browser.waitFor(`document.querySelector('.bw-message-content') && Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Create pull request'&&!b.disabled)`), "proposedChangesReviewable");
  requireCheck(prRequests === 0, "noAutomaticGithubWrites");
  requireCheck(await browser.evaluate(`document.querySelector('.bw-diff-line[data-kind="removed"]').textContent.includes("'Hello'") && document.querySelector('.bw-diff-line[data-kind="added"]').textContent.includes('Hello from GitHub')`), "diffShowsOldAndNew");
  await browser.screenshot(resolve(output, "desktop.png"));
  await browser.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Create pull request').click()`);
  requireCheck(await browser.waitFor(`Array.from(document.querySelectorAll('a')).some(a=>a.textContent==='Open pull request #1')`), "explicitPullRequestWorks");
  requireCheck(prRequests === 1, "oneReviewedGithubWrite");
  await browser.evaluate(`document.querySelector('.bw-delete').click()`);
  requireCheck(await browser.waitFor(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Undo')`), "chatDeletionOffersUndo");
  await browser.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Undo').click()`);
  requireCheck(await browser.waitFor(`!document.querySelector('.bw-status').textContent.includes('Restoring')`), "chatUndoWorks");
  await browser.viewport(390, 844, true);
  await browser.screenshot(resolve(output, "mobile.png"));
  requireCheck(await browser.evaluate(`document.documentElement.scrollWidth<=innerWidth+1 && document.querySelector('.bw-input').getBoundingClientRect().right<=innerWidth`), "mobileFits");
  requireCheck(await browser.evaluate(`window.__qaRuntimeSockets===0`), "noSandboxForChatOrGithub");
  results.apiPaths = [...new Set(paths)];
  results.consoleErrors = browser.consoleErrors;
  requireCheck(browser.consoleErrors.length === 0, "noBrowserErrors");
  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  if (browser) await browser.screenshot(resolve(output, "failure.png")).catch(() => undefined);
  console.error(JSON.stringify({ ...results, error: String(error), consoleErrors: browser?.consoleErrors }, null, 2));
  process.exitCode = 1;
} finally { await browser?.close(); await server.close(); }
