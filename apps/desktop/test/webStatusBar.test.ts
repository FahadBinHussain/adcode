import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostSocket, ConnectionState } from "../src/web/socket.ts";
import type { CloudStatus } from "../src/web/wire.ts";
import { showBlocked } from "../src/web/gate.ts";
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
  vi.stubGlobal("document", {
    createElement: () => ({ setAttribute: vi.fn(), addEventListener: vi.fn(), dataset: {} }),
    body: { append: vi.fn() },
  });
  let onCloud = (_status: CloudStatus): void => undefined;
  let onStatus = (_state: ConnectionState): void => undefined;
  const socket = {
    onCloud: (listener: typeof onCloud) => { onCloud = listener; },
    onStatus: (listener: typeof onStatus) => { onStatus = listener; },
    state: () => "paused",
  } as unknown as HostSocket;
  mountStatusBar(socket, { token: null, email: null, refresh: async () => null, signOut: async () => undefined });
  return { pause: (status: CloudStatus) => { onCloud(status); onStatus("paused"); } };
}

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
