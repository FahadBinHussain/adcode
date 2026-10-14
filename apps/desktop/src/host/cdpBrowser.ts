/**
 * The agent's browser in the web version's sandbox: headless Chromium over the DevTools protocol.
 *
 * On the desktop `view_page` drives an offscreen Electron window through `webContents.debugger`.
 * The sandbox has no Electron, so this starts the image's Chromium headless and speaks the same
 * protocol to it over a WebSocket; `main/agentBrowser.ts` cannot tell the difference. The
 * desktop's rule carries over: the agent's page loads nothing but this machine, enforced here
 * by pausing every top-level document request and refusing any that leaves loopback.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import type { PageTransport, PageTransportFactory } from "../main/agentBrowser.ts";
import { isLoopbackUrl } from "../main/agentBrowserModel.ts";

const COMMAND_TIMEOUT_MS = 30_000;
const LAUNCH_TIMEOUT_MS = 20_000;

/** The port in Chromium's "DevTools listening on ws://127.0.0.1:PORT/..." line, once it has printed it. */
export function devtoolsPortFrom(stderr: string): number | null {
  const match = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(stderr);
  return match === null ? null : Number(match[1]);
}

/** A page's DevTools socket as the `PageTransport` the agent browser drives. */
export async function connectCdpPage(wsUrl: string, onClose?: () => void): Promise<PageTransport> {
  const socket = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });

  let nextId = 1;
  let currentUrl = "about:blank";
  let mainFrameId: string | null = null;
  let closed = false;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  const listeners: ((method: string, params: Record<string, any>) => void)[] = [];

  const raw = (method: string, params: Record<string, unknown> = {}): Promise<any> => new Promise((resolve, reject) => {
    if (closed) {
      reject(new Error("The page is closed"));
      return;
    }
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} took longer than ${COMMAND_TIMEOUT_MS / 1000}s.`));
    }, COMMAND_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });

  socket.on("message", (data) => {
    const message = JSON.parse(String(data)) as { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: Record<string, any> };
    if (typeof message.id === "number") {
      const waiter = pending.get(message.id);
      if (waiter === undefined) return;
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error !== undefined) waiter.reject(new Error(message.error.message ?? "The browser refused the command"));
      else waiter.resolve(message.result ?? {});
      return;
    }
    const method = message.method ?? "";
    const params = message.params ?? {};
    if (method === "Fetch.requestPaused") {
      // Only top-level documents are paused; anything off this machine is refused before it leaves.
      const url = String(params["request"]?.url ?? "");
      void (url === "about:blank" || isLoopbackUrl(url)
        ? raw("Fetch.continueRequest", { requestId: params["requestId"] })
        : raw("Fetch.failRequest", { requestId: params["requestId"], errorReason: "BlockedByClient" })).catch(() => undefined);
      return;
    }
    if (method === "Page.frameNavigated" && params["frame"]?.parentId === undefined) {
      mainFrameId = String(params["frame"]?.id ?? mainFrameId);
      currentUrl = String(params["frame"]?.url ?? currentUrl);
    }
    if (method === "Page.navigatedWithinDocument" && (mainFrameId === null || params["frameId"] === mainFrameId)) {
      currentUrl = String(params["url"] ?? currentUrl);
    }
    for (const listener of listeners) listener(method, params);
  });

  const shut = (): void => {
    if (closed) return;
    closed = true;
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("The page closed"));
    }
    pending.clear();
    onClose?.();
  };
  socket.on("close", shut);

  await raw("Fetch.enable", { patterns: [{ urlPattern: "*", resourceType: "Document", requestStage: "Request" }] });

  return {
    send: (method, params) => raw(method, params),
    onEvent: (listener) => {
      listeners.push(listener);
    },
    url: () => currentUrl,
    closed: () => closed,
    close: () => {
      if (closed) return;
      socket.close();
      shut();
    },
  };
}

/** Starts headless Chromium and returns its first page's DevTools address. */
async function launchChromium(executable: string): Promise<{ wsUrl: string; stop: () => void }> {
  const profile = mkdtempSync(join(tmpdir(), "adcode-agent-browser-"));
  const child = spawn(executable, [
    "--headless=new",
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profile}`,
    // The sandbox already isolates this process; Chromium's own sandbox needs privileges a container does not grant.
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--mute-audio",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const stop = (): void => {
    if (child.exitCode === null) child.kill();
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 1_000).unref();
  };

  const port = await new Promise<number>((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => reject(new Error("Chromium did not start in time")), LAUNCH_TIMEOUT_MS);
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      const found = devtoolsPortFrom(stderr);
      if (found !== null) {
        clearTimeout(timer);
        resolve(found);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chromium exited (${code}): ${stderr.slice(-300)}`));
    });
  }).catch((error: unknown) => {
    stop();
    throw error;
  });

  const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl?: string }[];
  const page = targets.find((target) => target.type === "page" && typeof target.webSocketDebuggerUrl === "string");
  if (page?.webSocketDebuggerUrl === undefined) {
    stop();
    throw new Error("Chromium opened no page");
  }
  return { wsUrl: page.webSocketDebuggerUrl, stop };
}

/** The factory adcode-host gives the agent browser: one Chromium per page, gone when the page closes. */
export function chromiumTransportFactory(executable: string): PageTransportFactory {
  return async () => {
    const browser = await launchChromium(executable);
    try {
      return await connectCdpPage(browser.wsUrl, browser.stop);
    } catch (error) {
      browser.stop();
      throw error;
    }
  };
}
