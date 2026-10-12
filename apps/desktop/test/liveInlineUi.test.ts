import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, it } from "vitest";
it("keeps live agents inside scrolling messages without covering the composer", () => {
  const env = { ...process.env }; delete env["ELECTRON_RUN_AS_NODE"];
  const run = spawnSync(createRequire(import.meta.url)("electron") as string, [resolve(import.meta.dirname, "fixtures/liveInline.cjs")], { env, encoding: "utf8", timeout: 40_000, windowsHide: true });
  expect(run.status, run.stderr || String(run.error)).toBe(0);
  const line = /^LIVE_INLINE_RESULTS=(.+)$/m.exec(run.stdout);
  expect(line, run.stdout).not.toBeNull();
  expect(JSON.parse(line![1]!)).toEqual({mountedInline: true, compactSolo: true, scrollsWithMessages: true, stopStillWorks: true, remountsAfterNewChat: true});
}, 45_000);
