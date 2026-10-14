/**
 * Where IPC lands when the renderer is a browser tab.
 *
 * On the desktop, the main process registers handlers with `ipcMain` and Electron routes the
 * renderer's `invoke` and `send` to them. In adcode-host the same registrations land here (the
 * `electron` stand-in's `ipcMain` is this object), and the socket server routes each `call`
 * and `send` frame to them instead.
 *
 * The renderer is hostile by assumption (brief §1), and on the web it is a browser tab anyone
 * can script. Only channels the desktop defines in `CHANNELS` are routed at all; every handler
 * keeps the argument validation it already does for Electron. A handler that throws is
 * reported by its message only - never a stack, which would describe the server to a stranger.
 */
import { CHANNELS } from "../shared/api.ts";
import type { AskKind, ClientFrame, ServerFrame } from "../web/wire.ts";

/** One connected tab, as the host sees it. */
export interface HostConnection {
  readonly id: number;
  send(frame: ServerFrame): void;
  /** Asks the browser to do something only it can: open a link, pick a project, read the clipboard. */
  ask(kind: AskKind, payload: unknown): Promise<unknown>;
  focused: boolean;
}

/** The parts of Electron's `WebContents` that main-process code calls on `event.sender`. */
export interface ShimWebContents {
  readonly id: number;
  send(channel: string, ...args: unknown[]): void;
  getURL(): string;
  isDestroyed(): boolean;
  getZoomLevel(): number;
  setZoomLevel(level: number): void;
  setZoomFactor(factor: number): void;
  toggleDevTools(): void;
  on(event: string, listener: (...args: unknown[]) => void): ShimWebContents;
  once(event: string, listener: (...args: unknown[]) => void): ShimWebContents;
  readonly connection: HostConnection;
}

export interface ShimEvent {
  readonly sender: ShimWebContents;
  reply(channel: string, ...args: unknown[]): void;
}

type Handler = (event: ShimEvent, ...args: unknown[]) => unknown;
type Listener = (event: ShimEvent, ...args: unknown[]) => void;

const KNOWN_CHANNELS: ReadonlySet<string> = new Set(Object.values(CHANNELS));

/** The address a tab's renderer would report; one window role on the web. */
export const WEB_RENDERER_URL = "https://web.bluethenics.com/";

const contentsByConnection = new WeakMap<HostConnection, ShimWebContents>();
const markDestroyed = new WeakMap<HostConnection, () => void>();

/** The `WebContents` stand-in for one connection, the same object every time. */
export function webContentsFor(connection: HostConnection): ShimWebContents {
  const existing = contentsByConnection.get(connection);
  if (existing !== undefined) return existing;
  let destroyed = false;
  const contents: ShimWebContents = {
    id: connection.id,
    connection,
    send: (channel, ...args) => {
      if (!destroyed) connection.send({ t: "evt", ch: channel, args });
    },
    getURL: () => WEB_RENDERER_URL,
    isDestroyed: () => destroyed,
    getZoomLevel: () => 0,
    setZoomLevel: () => undefined,
    setZoomFactor: () => undefined,
    toggleDevTools: () => undefined,
    on: () => contents,
    once: () => contents,
  };
  contentsByConnection.set(connection, contents);
  markDestroyed.set(connection, () => {
    destroyed = true;
  });
  return contents;
}

/** After a tab disconnects, anything still holding its `WebContents` sees it as destroyed. */
export function destroyWebContents(connection: HostConnection): void {
  markDestroyed.get(connection)?.();
}

function eventFor(connection: HostConnection): ShimEvent {
  const sender = webContentsFor(connection);
  return { sender, reply: (channel, ...args) => sender.send(channel, ...args) };
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (typeof error === "string" && error.length > 0) return error;
  return "Something went wrong";
}

export class Dispatcher {
  private readonly handlers = new Map<string, Handler>();
  private readonly listeners = new Map<string, Set<Listener>>();

  handle(channel: string, handler: Handler): void {
    if (this.handlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`);
    this.handlers.set(channel, handler);
  }

  handleOnce(channel: string, handler: Handler): void {
    this.handle(channel, (event, ...args) => {
      this.removeHandler(channel);
      return handler(event, ...args);
    });
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  on(channel: string, listener: Listener): this {
    let set = this.listeners.get(channel);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(channel, set);
    }
    set.add(listener);
    return this;
  }

  once(channel: string, listener: Listener): this {
    const wrapped: Listener = (event, ...args) => {
      this.removeListener(channel, wrapped);
      listener(event, ...args);
    };
    return this.on(channel, wrapped);
  }

  removeListener(channel: string, listener: Listener): this {
    this.listeners.get(channel)?.delete(listener);
    return this;
  }

  off(channel: string, listener: Listener): this {
    return this.removeListener(channel, listener);
  }

  removeAllListeners(channel?: string): this {
    if (channel === undefined) this.listeners.clear();
    else this.listeners.delete(channel);
    return this;
  }

  /** Runs the handler for one `call` frame and returns the `ret` frame that answers it. */
  async call(connection: HostConnection, frame: Extract<ClientFrame, { t: "call" }>): Promise<ServerFrame> {
    if (!KNOWN_CHANNELS.has(frame.ch)) return { t: "ret", id: frame.id, ok: false, error: "Unknown channel" };
    const handler = this.handlers.get(frame.ch);
    if (handler === undefined) return { t: "ret", id: frame.id, ok: false, error: `No handler registered for '${frame.ch}'` };
    try {
      const value = await handler(eventFor(connection), ...frame.args);
      return { t: "ret", id: frame.id, ok: true, value };
    } catch (error) {
      return { t: "ret", id: frame.id, ok: false, error: messageOf(error) };
    }
  }

  /** Hands one fire-and-forget `send` frame to its listeners. A listener that throws is contained. */
  deliver(connection: HostConnection, frame: Extract<ClientFrame, { t: "send" }>): void {
    if (!KNOWN_CHANNELS.has(frame.ch)) return;
    const set = this.listeners.get(frame.ch);
    if (set === undefined) return;
    const event = eventFor(connection);
    for (const listener of [...set]) {
      try {
        listener(event, ...frame.args);
      } catch (error) {
        console.error(`[adcode-host] ${frame.ch} listener failed: ${messageOf(error)}`);
      }
    }
  }
}
