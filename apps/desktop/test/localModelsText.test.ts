/*
 * What Connect AI says about local models (Ollama).
 *
 * On the desktop it describes this computer: not installed, installed but stopped, running. On
 * the web the "computer" would be the cloud sandbox, which is never the person's own - so the
 * row says plainly that local models need the desktop app, instead of asking them to start an
 * Ollama they cannot reach.
 */
import { describe, expect, it } from "vitest";
import { localDescription, localLabel } from "../src/renderer/ai/localModelsText.ts";

const stopped = { installed: true, running: false, models: [] };
const running = { installed: true, running: true, models: ["qwen2.5-coder:7b"] };

describe("desktop", () => {
  it("describes this computer", () => {
    expect(localLabel(stopped, false)).toBe("Installed · not running");
    expect(localLabel(running, false)).toBe("Running · 1 model");
    expect(localDescription(stopped, false)).toContain("installed but not running");
  });
});

describe("web", () => {
  it("says local models need the desktop app, whatever the sandbox reports", () => {
    expect(localLabel(stopped, true)).toBe("Desktop app only");
    expect(localLabel(running, true)).toBe("Desktop app only");
    expect(localDescription(running, true)).toBe("Local models run on your own computer, so they need the ADCode desktop app. Here, use the included AI or paste a key.");
  });
});
