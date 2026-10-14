/*
 * The web bridge forwards exactly what the preload forwards.
 *
 * The preload is the desktop's security boundary and is never generated or rewritten for the
 * web. The browser build gets its own table instead, and this test is what keeps the two from
 * drifting: it reads the preload's source and checks every forwarding line against the table,
 * in both directions. A new IPC method added to the preload and forgotten here fails this test.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CHANNELS } from "../src/shared/api.ts";
import { BRIDGE, type BridgeEntry } from "../src/web/bridgeTable.ts";

const PRELOAD = readFileSync(resolve(import.meta.dirname, "../src/preload/index.ts"), "utf8");

interface Forward {
  readonly kind: "invoke" | "send" | "subscribe";
  readonly channel: string;
  readonly fixed: readonly string[];
}

function channelValue(name: string): string {
  const value = (CHANNELS as Record<string, string>)[name];
  if (value === undefined) throw new Error(`CHANNELS.${name} does not exist`);
  return value;
}

/** Every `name: (...) => ipcRenderer.x(CHANNELS.y, ...)` and `subscribe(CHANNELS.y, ...)` line, by "namespace.name". */
function preloadForwards(): Map<string, Forward> {
  const body = PRELOAD.slice(PRELOAD.indexOf("const api: AdcodeApi = {"));
  // An arrow whose body starts on the next line is joined to it, so one regex sees both.
  const lines = body.split(/\r?\n/).reduce<string[]>((joined, line) => {
    const previous = joined[joined.length - 1];
    if (previous !== undefined && previous.trimEnd().endsWith("=>")) joined[joined.length - 1] = `${previous} ${line.trim()}`;
    else joined.push(line);
    return joined;
  }, []);
  const out = new Map<string, Forward>();
  let namespace = "";
  for (const line of lines) {
    const open = /^ {2}(\w+): \{$/.exec(line);
    if (open !== null) {
      namespace = open[1]!;
      continue;
    }
    const call = /^\s+(\w+): \([^)]*\) =>\s*ipcRenderer\.(invoke|send)\(CHANNELS\.(\w+)((?:, "[^"]+")*)/.exec(line);
    if (call !== null) {
      const fixed = [...(call[4] ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
      out.set(`${namespace}.${call[1]}`, { kind: call[2] as "invoke" | "send", channel: channelValue(call[3]!), fixed });
      continue;
    }
    const sub = /^\s+(\w+): \(listener\) => subscribe\(CHANNELS\.(\w+)/.exec(line);
    if (sub !== null) out.set(`${namespace}.${sub[1]}`, { kind: "subscribe", channel: channelValue(sub[2]!), fixed: [] });
  }
  return out;
}

describe("web bridge table", () => {
  const forwards = preloadForwards();

  it("finds the preload's forwarding lines", () => {
    expect(forwards.size).toBeGreaterThan(200);
  });

  it("has an identical entry for every method the preload forwards", () => {
    const mismatches: string[] = [];
    for (const [path, expected] of forwards) {
      const entry: BridgeEntry | undefined = BRIDGE.find((candidate) => candidate.path === path);
      const actual = entry === undefined ? undefined : { kind: entry.kind, channel: entry.channel, fixed: entry.fixed ?? [] };
      if (JSON.stringify(actual) !== JSON.stringify(expected)) mismatches.push(`${path}: preload ${JSON.stringify(expected)}, table ${JSON.stringify(actual)}`);
    }
    expect(mismatches).toEqual([]);
  });

  it("forwards nothing the preload does not, apart from methods the browser answers itself", () => {
    const extra = BRIDGE.filter((entry) => entry.kind !== "local" && !forwards.has(entry.path)).map((entry) => entry.path);
    expect(extra).toEqual([]);
    expect(BRIDGE.filter((entry) => entry.kind === "local").map((entry) => entry.path)).toEqual(["files.pathForDropped"]);
  });

  it("lists each method once", () => {
    const paths = BRIDGE.map((entry) => entry.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
