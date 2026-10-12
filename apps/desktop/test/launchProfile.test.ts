import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { initializeLaunchProfile } from "../src/main/launchProfile.ts";

it("isolates application and browser storage before a test window reads it", () => {
  const base = mkdtempSync(join(tmpdir(), "adcode-profile-test-"));
  try {
    const directory = join(base, "separate profile");
    const setPath = vi.fn();
    expect(initializeLaunchProfile({ setPath }, ["ADCode", `--user-data-dir=${directory}`])).toBe(resolve(directory));
    expect(existsSync(directory)).toBe(true);
    expect(setPath.mock.calls).toEqual([["userData", resolve(directory)], ["sessionData", resolve(directory)]]);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
it("supports a separate absolute directory argument", () => {
  const directory = mkdtempSync(join(tmpdir(), "adcode-profile-test-"));
  try { expect(initializeLaunchProfile({ setPath: vi.fn() }, ["ADCode", "--user-data-dir", directory])).toBe(resolve(directory)); }
  finally { rmSync(directory, { recursive: true, force: true }); }
});
it("preserves the installed profile unless a directory was explicitly supplied", () => {
  const setPath = vi.fn();
  expect(initializeLaunchProfile({ setPath }, ["ADCode", "--new-window"])).toBeNull();
  expect(setPath).not.toHaveBeenCalled();
});
it("refuses invalid overrides instead of falling back to the real account", () => {
  const setPath = vi.fn();
  for (const args of [["ADCode", "--user-data-dir"], ["ADCode", "--user-data-dir="], ["ADCode", "--user-data-dir=relative"]]) expect(() => initializeLaunchProfile({ setPath }, args)).toThrow("absolute profile directory");
  expect(setPath).not.toHaveBeenCalled();
});
it("inherits the isolated profile when a child launch omits the Chromium argument", () => {
  const directory = mkdtempSync(join(tmpdir(), "adcode-profile-test-"));
  try {
    const setPath = vi.fn();
    expect(initializeLaunchProfile({ setPath }, ["ADCode"], { ADCODE_USER_DATA_DIR: directory })).toBe(resolve(directory));
    expect(setPath.mock.calls).toEqual([["userData", resolve(directory)], ["sessionData", resolve(directory)]]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
it("gives an explicit profile argument priority over the inherited profile", () => {
  const directory = mkdtempSync(join(tmpdir(), "adcode-profile-test-"));
  try {
    expect(initializeLaunchProfile({ setPath: vi.fn() }, ["ADCode", `--user-data-dir=${directory}`], { ADCODE_USER_DATA_DIR: "invalid" })).toBe(resolve(directory));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
it("refuses an invalid inherited profile instead of writing the normal account", () => {
  const setPath = vi.fn();
  expect(() => initializeLaunchProfile({ setPath }, ["ADCode"], { ADCODE_USER_DATA_DIR: "relative" })).toThrow("absolute profile directory");
  expect(setPath).not.toHaveBeenCalled();
});
