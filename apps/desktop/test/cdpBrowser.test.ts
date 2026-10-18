/*
 * The agent's browser inside the web version's sandbox.
 *
 * On the desktop, `view_page` drives an offscreen Electron window. A sandbox has no Electron, so
 * it drives headless Chromium over the same DevTools protocol - and keeps the desktop's rule that
 * the agent's page goes nowhere but this machine: any top-level page load off loopback is
 * refused before it leaves.
 */
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { connectCdpPage, devtoolsPortFrom } from "../src/host/cdpBrowser.ts";

let server: WebSocketServer | null = null;
afterEach(async () => {
  await new Promise<void>((resolve) => (server === null ? resolve() : server.close(() => resolve())));
  server = null;
});

/** A stand-in Chromium page: answers commands, records them, and lets the test push events. */
async function fakePage(): Promise<{ url: string; received: { id: number; method: string; params?: unknown }[]; push: (message: unknown) => void }> {
  const received: { id: number; method: string; params?: unknown }[] = [];
  let socket: WebSocket | null = null;
  server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  server.on("connection", (ws) => {
    socket = ws;
    ws.on("message", (data) => {
      const message = JSON.parse(String(data)) as { id: number; method: string; params?: unknown };
      received.push(message);
      if (message.method === "Broken.method") ws.send(JSON.stringify({ id: message.id, error: { code: -32601, message: "'Broken.method' wasn't found" } }));
      else ws.send(JSON.stringify({ id: message.id, result: { echoed: message.method } }));
    });
  });
  await new Promise((resolve) => server!.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  return { url: `ws://127.0.0.1:${port}/devtools/page/1`, received, push: (message) => socket?.send(JSON.stringify(message)) };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

describe("cdp page transport", () => {
  it("sends commands and returns their results", async () => {
    const page = await fakePage();
    const transport = await connectCdpPage(page.url);
    expect(await transport.send("Page.enable")).toEqual({ echoed: "Page.enable" });
    await expect(transport.send("Broken.method")).rejects.toThrow("wasn't found");
    transport.close();
  });

  it("passes events on, and follows the top document's address", async () => {
    const page = await fakePage();
    const transport = await connectCdpPage(page.url);
    const events: string[] = [];
    transport.onEvent((method) => events.push(method));
    page.push({ method: "Page.frameNavigated", params: { frame: { id: "main", url: "http://127.0.0.1:5173/about" } } });
    page.push({ method: "Page.frameNavigated", params: { frame: { id: "child", parentId: "main", url: "http://127.0.0.1:5173/ad" } } });
    page.push({ method: "Runtime.consoleAPICalled", params: { type: "log", args: [] } });
    await tick();
    expect(events).toContain("Runtime.consoleAPICalled");
    expect(transport.url()).toBe("http://127.0.0.1:5173/about");
    transport.close();
    expect(transport.closed()).toBe(true);
  });

  it("refuses private-network documents and permits public sites and local projects", async () => {
    const page = await fakePage();
    const transport = await connectCdpPage(page.url);
    page.push({ method: "Fetch.requestPaused", params: { requestId: "away", resourceType: "Document", request: { url: "http://192.168.1.1/" } } });
    page.push({ method: "Fetch.requestPaused", params: { requestId: "home", resourceType: "Document", request: { url: "http://localhost:5173/" } } });
    page.push({ method: "Fetch.requestPaused", params: { requestId: "public", resourceType: "Document", request: { url: "https://example.com/" } } });
    await tick();
    expect(page.received.filter(message => message.method === "Fetch.continueRequest").map(message => message.params)).toContainEqual({ requestId: "public" });
    expect(page.received.find((message) => message.method === "Fetch.failRequest")?.params).toEqual({ requestId: "away", errorReason: "BlockedByClient" });
    expect(page.received.find((message) => message.method === "Fetch.continueRequest")?.params).toEqual({ requestId: "home" });
    expect(page.received.some((message) => message.method === "Fetch.enable")).toBe(true);
    transport.close();
  });
});

describe("devtoolsPortFrom", () => {
  it("reads the port Chromium chose from its startup line", () => {
    expect(devtoolsPortFrom("[1014/1:ERROR] something\nDevTools listening on ws://127.0.0.1:41733/devtools/browser/0a-b\n")).toBe(41733);
    expect(devtoolsPortFrom("nothing yet")).toBeNull();
  });
});
