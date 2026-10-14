/*
 * adcode-host's socket server.
 *
 * In the cloud, only the user's own Durable Object can reach the container, and it proves it
 * with a secret it generated when it started the container. Locally (`npm run web:vibe`) there
 * is no secret and the server listens on localhost. These tests run the real server on a
 * random port with a real WebSocket client.
 */
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { CHANNELS } from "../src/shared/api.ts";
import { ipcMain } from "../src/host/electronShim.ts";
import { startHostServer } from "../src/host/server.ts";
import { decodeFrame, encodeFrame, type ServerFrame } from "../src/web/wire.ts";

const HELLO = { version: "9.9.9", surface: "web" as const, projectsHome: "/home/adcode/projects" };
const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  ipcMain.removeHandler(CHANNELS.appInfo);
});

async function server(secret: string | null, busy = false) {
  const started = await startHostServer({ port: 0, host: "127.0.0.1", secret, hello: () => HELLO, busy: () => busy });
  closers.push(started.close);
  return started;
}

function connect(port: number, headers: Record<string, string> = {}): Promise<{ socket: WebSocket; frames: ServerFrame[]; next: () => Promise<ServerFrame> }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/socket`, { headers });
    const frames: ServerFrame[] = [];
    const waiters: ((frame: ServerFrame) => void)[] = [];
    socket.on("message", (data) => {
      const frame = decodeFrame(String(data)) as ServerFrame;
      const waiter = waiters.shift();
      if (waiter !== undefined) waiter(frame);
      else frames.push(frame);
    });
    socket.on("open", () => resolve({
      socket,
      frames,
      next: () => frames.length > 0 ? Promise.resolve(frames.shift()!) : new Promise((done) => waiters.push(done)),
    }));
    socket.on("unexpected-response", (_request, response) => reject(new Error(`HTTP ${response.statusCode}`)));
    socket.on("error", reject);
  });
}

describe("host server", () => {
  it("greets a tab and answers its calls", async () => {
    ipcMain.handle(CHANNELS.appInfo, () => ({ version: "9.9.9" }));
    const { port } = await server(null);
    const tab = await connect(port);
    expect(await tab.next()).toEqual({ t: "ready", host: HELLO });
    tab.socket.send(encodeFrame({ t: "call", id: 1, ch: CHANNELS.appInfo, args: [] }));
    expect(await tab.next()).toEqual({ t: "ret", id: 1, ok: true, value: { version: "9.9.9" } });
    tab.socket.close();
  });

  it("refuses a socket without the secret when one is set", async () => {
    const { port } = await server("s3cret");
    await expect(connect(port)).rejects.toThrow("HTTP 401");
  });

  it("accepts a socket that carries the secret", async () => {
    const { port } = await server("s3cret");
    const tab = await connect(port, { "x-adcode-host-secret": "s3cret" });
    expect((await tab.next()).t).toBe("ready");
    tab.socket.close();
  });

  it("guards its HTTP routes with the same secret", async () => {
    const { port } = await server("s3cret");
    expect((await fetch(`http://127.0.0.1:${port}/__adcode/state`)).status).toBe(401);
    const allowed = await fetch(`http://127.0.0.1:${port}/__adcode/state`, { headers: { "x-adcode-host-secret": "s3cret" } });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ busy: false, connections: 0 });
  });

  it("reports busy, connections and the last input", async () => {
    const { port } = await server(null, true);
    const tab = await connect(port);
    await tab.next();
    tab.socket.send(encodeFrame({ t: "input" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const state = await (await fetch(`http://127.0.0.1:${port}/__adcode/state`)).json() as { busy: boolean; connections: number; lastInputAt: number };
    expect(state.busy).toBe(true);
    expect(state.connections).toBe(1);
    expect(Date.now() - state.lastInputAt).toBeLessThan(5_000);
    tab.socket.close();
  });

  it("answers health without a secret check leaking anything", async () => {
    const { port } = await server(null);
    const response = await fetch(`http://127.0.0.1:${port}/__adcode/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, version: "9.9.9" });
  });

  it("drops frames it cannot read without closing the tab", async () => {
    ipcMain.handle(CHANNELS.appInfo, () => "still here");
    const { port } = await server(null);
    const tab = await connect(port);
    await tab.next();
    tab.socket.send("not json");
    tab.socket.send(encodeFrame({ t: "call", id: 7, ch: CHANNELS.appInfo, args: [] }));
    expect(await tab.next()).toEqual({ t: "ret", id: 7, ok: true, value: "still here" });
    tab.socket.close();
  });
});
