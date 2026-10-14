/**
 * adcode-host's door: one WebSocket per browser tab, plus a few HTTP routes for the cloud.
 *
 * In the cloud the only caller is the user's own Durable Object, which proves itself with the
 * secret it generated when it started this container (`x-adcode-host-secret`). Locally,
 * `npm run web:vibe` runs without a secret on localhost.
 *
 * The socket speaks the frames in `web/wire.ts`. `call` and `send` go to the dispatcher - the
 * same handlers the desktop registers with `ipcMain` - and everything the main process
 * broadcasts comes back as `evt`. `ask` is the other direction: a dialog or a link the main
 * process wants opened, which only the browser can do.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import type { HostConnection } from "./dispatcher.ts";
import { attachConnection, detachConnection, dispatcher } from "./electronShim.ts";
import { restoreHomeArchive, safeProjectName, streamHomeArchive, streamProjectDownload } from "./homeArchive.ts";
import { decodeFrame, encodeFrame, type AskKind, type HostHello, type ServerFrame } from "../web/wire.ts";

export interface HostState {
  readonly busy: boolean;
  readonly lastInputAt: number;
  readonly connections: number;
}

export interface HostServerOptions {
  readonly port: number;
  readonly host?: string;
  readonly secret: string | null;
  readonly hello: () => HostHello;
  /** True while an agent turn, a team or an automation is running. */
  readonly busy?: () => boolean | Promise<boolean>;
  readonly onAuth?: (token: string) => void;
  /** Whether any tab has focus; ads count attention only while one does. */
  readonly onFocusChange?: (anyFocused: boolean) => void;
  readonly home?: string;
  readonly projectsHome?: string;
  /** Web-only operations a tab may ask for by name; anything else is refused. */
  readonly ops?: Readonly<Record<string, (...args: unknown[]) => Promise<unknown>>>;
}

/** How long a question to the browser waits; a project picker can stay open a while. */
const ASK_TIMEOUT_MS = 10 * 60_000;
const SECRET_HEADER = "x-adcode-host-secret";

function secretMatches(expected: string | null, given: string | string[] | undefined): boolean {
  if (expected === null) return true;
  if (typeof given !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
}

export async function startHostServer(options: HostServerOptions): Promise<{ close(): Promise<void>; port: number; state(): Promise<HostState> }> {
  const live = new Map<number, { connection: HostConnection; socket: WebSocket }>();
  let nextConnectionId = 1;
  let lastInputAt = Date.now();

  const state = async (): Promise<HostState> => {
    let busy = false;
    try {
      busy = (await options.busy?.()) ?? false;
    } catch {
      busy = false;
    }
    return { busy, lastInputAt, connections: live.size };
  };

  const reportFocus = (): void => {
    options.onFocusChange?.([...live.values()].some(({ connection }) => connection.focused));
  };

  const http = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://host");
    if (url.pathname === "/__adcode/health") {
      json(response, 200, { ok: true, version: options.hello().version });
      return;
    }
    if (!secretMatches(options.secret, request.headers[SECRET_HEADER])) {
      json(response, 401, { ok: false });
      return;
    }
    handleHttp(url, request, response);
  });

  function handleHttp(url: URL, request: IncomingMessage, response: ServerResponse): void {
    const home = options.home ?? process.env["ADCODE_HOME"] ?? "";
    const projectsHome = options.projectsHome ?? process.env["ADCODE_PROJECTS_HOME"] ?? "";
    if (url.pathname === "/__adcode/state" && request.method === "GET") {
      void state().then((current) => json(response, 200, current));
      return;
    }
    if (url.pathname === "/__adcode/home-archive" && home.length > 0) {
      if (request.method === "GET") return streamHomeArchive(home, response);
      if (request.method === "PUT") return restoreHomeArchive(home, request, response);
    }
    if (url.pathname === "/__adcode/download" && request.method === "GET") {
      const name = safeProjectName(url.searchParams.get("project"), projectsHome);
      if (name === null) {
        json(response, 404, { ok: false, error: "No such project" });
        return;
      }
      streamProjectDownload(projectsHome, name, response);
      return;
    }
    json(response, 404, { ok: false });
  }

  const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });

  http.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://host");
    if (url.pathname !== "/socket" || !secretMatches(options.secret, request.headers[SECRET_HEADER])) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => accept(ws));
  });

  function accept(ws: WebSocket): void {
    const id = nextConnectionId++;
    const pendingAsks = new Map<number, { resolve: (value: unknown) => void; timer: NodeJS.Timeout }>();
    let nextAskId = 1;
    const send = (frame: ServerFrame): void => {
      if (ws.readyState === ws.OPEN) ws.send(encodeFrame(frame));
    };
    const connection: HostConnection = {
      id,
      focused: false,
      send,
      ask: (kind: AskKind, payload: unknown) => new Promise((resolve) => {
        const askId = nextAskId++;
        const timer = setTimeout(() => {
          pendingAsks.delete(askId);
          resolve(null);
        }, ASK_TIMEOUT_MS);
        pendingAsks.set(askId, { resolve, timer });
        send({ t: "ask", id: askId, kind, payload });
      }),
    };
    live.set(id, { connection, socket: ws });
    attachConnection(connection);
    send({ t: "ready", host: options.hello() });

    ws.on("message", (data) => {
      const frame = decodeFrame(String(data));
      if (frame === null) return;
      switch (frame.t) {
        case "call":
          void dispatcher.call(connection, frame).then(send);
          return;
        case "send":
          dispatcher.deliver(connection, frame);
          return;
        case "answer": {
          const pending = pendingAsks.get(frame.id);
          if (pending === undefined) return;
          pendingAsks.delete(frame.id);
          clearTimeout(pending.timer);
          pending.resolve(frame.ok ? frame.value ?? null : null);
          return;
        }
        case "auth":
          options.onAuth?.(frame.token);
          return;
        case "focus":
          connection.focused = frame.focused;
          reportFocus();
          send({ t: "evt", ch: "window:focus", args: [frame.focused] });
          return;
        case "input":
          lastInputAt = Date.now();
          return;
        case "op": {
          const operation = Object.hasOwn(options.ops ?? {}, frame.op) ? options.ops![frame.op] : undefined;
          if (operation === undefined) {
            send({ t: "opRet", id: frame.id, ok: false, error: "Unknown operation" });
            return;
          }
          void operation(...frame.args)
            .then((value) => send({ t: "opRet", id: frame.id, ok: true, value }))
            .catch((error: unknown) => send({ t: "opRet", id: frame.id, ok: false, error: error instanceof Error ? error.message : "Something went wrong" }));
          return;
        }
        case "previewUrl":
          // Without the cloud in front (local development), a preview is already reachable as is.
          send({ t: "previewUrl", id: frame.id, url: frame.url });
          return;
        default:
          return;
      }
    });

    ws.on("close", () => {
      for (const pending of pendingAsks.values()) {
        clearTimeout(pending.timer);
        pending.resolve(null);
      }
      pendingAsks.clear();
      live.delete(id);
      detachConnection(id);
      reportFocus();
    });
  }

  await new Promise<void>((resolve) => http.listen(options.port, options.host ?? "0.0.0.0", resolve));
  const address = http.address();
  const port = typeof address === "object" && address !== null ? address.port : options.port;

  return {
    port,
    state,
    close: () => new Promise((resolve) => {
      for (const { socket } of live.values()) socket.terminate();
      sockets.close();
      http.close(() => resolve());
    }),
  };
}
