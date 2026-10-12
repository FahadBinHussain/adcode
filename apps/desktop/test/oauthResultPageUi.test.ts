import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("renders account results accessibly in both themes and on a narrow screen", () => {
  const require = createRequire(import.meta.url);
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const run = spawnSync(require("electron") as string, [fileURLToPath(new URL("./fixtures/oauthResultPage.cjs", import.meta.url))], { env, encoding: "utf8", timeout: 35_000, windowsHide: true });
  expect(run.status, run.stdout + run.stderr + String(run.error ?? "")).toBe(0);
  expect(run.stdout).toContain("OAUTH_PAGE_RESULTS=passed");
}, 40_000);
