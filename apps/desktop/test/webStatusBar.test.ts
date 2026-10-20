import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostSocket, ConnectionState } from "../src/web/socket.ts";
import type { CloudStatus } from "../src/web/wire.ts";
import { showBlocked, showWaking } from "../src/web/gate.ts";
import { mountStatusBar } from "../src/web/statusBar.ts";

vi.mock("../src/web/gate.ts", () => ({ showBlocked: vi.fn(), hideGate: vi.fn(), showWaking: vi.fn() }));
vi.mock("../src/renderer/surface.ts", () => ({ openWebAccount: vi.fn(), DESKTOP_DOWNLOAD_URL: "https://example.test/download" }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

function fixture() {
  vi.useFakeTimers();
  const elements: { hidden: boolean; textContent: string }[] = [];
  vi.stubGlobal("document", {
    createElement: () => {
      const element = { setAttribute: vi.fn(), addEventListener: vi.fn(), dataset: {}, hidden: false, textContent: "" };
      elements.push(element);
      return element;
    },
    body: { append: vi.fn() },
  });
  let onCloud = (_status: CloudStatus): void => undefined;
  let onStatus = (_state: ConnectionState): void => undefined;
  let state: ConnectionState = "paused";
  const socket = {
    onCloud: (listener: typeof onCloud) => { onCloud = listener; },
    onStatus: (listener: typeof onStatus) => { onStatus = listener; },
    state: () => state,
  } as unknown as HostSocket;
  mountStatusBar(socket, { token: null, email: null, refresh: async () => null, signOut: async () => undefined });
  const connection = (next: ConnectionState): void => { state = next; onStatus(next); };
  return {
    cloud: (status: CloudStatus) => onCloud(status),
    connection,
    bar: elements[0]!,
    pause: (status: CloudStatus) => { onCloud(status); connection("paused"); },
  };
}

describe("cloud capacity waiting", () => {
  it("keeps the waiting screen steady across retries without promising a queue position", () => {
    const { cloud, connection, bar } = fixture();
    const busy: CloudStatus = { state: "busy", allowanceMs: 0, unlimited: true, usedMs: 0, resetsAt: 0 };
    cloud(busy);
    connection("reconnecting");
    cloud(busy);
    connection("reconnecting");
    expect(showWaking).toHaveBeenCalledTimes(1);
    expect(showWaking).toHaveBeenCalledWith("Waiting for a free sandbox…", "All sandboxes are in use. This page retries automatically.");
    expect(bar.hidden).toBe(true);

    cloud({ ...busy, state: "waking" });
    expect(showWaking).toHaveBeenLastCalledWith();
    expect(showWaking).toHaveBeenCalledTimes(2);
  });

  it("still reports reconnecting for an admitted workspace", () => {
    const { cloud, connection, bar } = fixture();
    cloud({ state: "ready", allowanceMs: 0, unlimited: true, usedMs: 0, resetsAt: 0 });
    connection("reconnecting");
    expect(bar.hidden).toBe(false);
    expect(bar.textContent).toBe("Reconnecting… your workspace keeps working");

    cloud({ state: "busy", allowanceMs: 0, unlimited: true, usedMs: 0, resetsAt: 0 });
    expect(bar.hidden).toBe(true);
  });
});

describe("cloud shutdown messages", () => {
  it.each(["full", "sleeping"] as const)("shows the server's save warning for a %s pause", (state) => {
    const { pause } = fixture();
    const message = "Saving your latest changes failed. Your previous saved copy is kept; recent changes may be missing.";
    pause({ state, allowanceMs: 0, unlimited: true, usedMs: 0, resetsAt: 0, message });
    expect(showBlocked).toHaveBeenLastCalledWith(expect.any(String), message, expect.any(Array));
  });

  it("explains the monthly budget when the final snapshot succeeds", () => {
    const { pause } = fixture();
    pause({ state: "full", allowanceMs: 0, unlimited: true, usedMs: 0, resetsAt: 0 });
    expect(showBlocked).toHaveBeenLastCalledWith("The web version is full this month", expect.stringContaining("this month's cloud budget is used up"), expect.any(Array));
  });
});
