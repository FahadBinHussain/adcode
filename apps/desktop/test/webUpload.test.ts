/*
 * Bringing a project into the web version: a folder or a .zip from the person's computer.
 *
 * What goes up is the project, not its rebuildable clutter: `node_modules` and `.git` are left
 * behind, and so is anything whose path tries to climb out of the project. A .zip is opened in
 * the browser, so only the files it holds travel - and a zip that is not one, or uses features
 * this reader does not handle, says so instead of half-arriving.
 */
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { planUpload, UPLOAD_LIMIT_BYTES } from "../src/web/upload.ts";
import { readZip } from "../src/web/unzip.ts";

describe("planUpload", () => {
  it("takes the picked folder's name as the project and paths inside it", () => {
    const plan = planUpload([
      { path: "bakery/index.html", size: 10 },
      { path: "bakery/css/site.css", size: 20 },
    ]);
    expect(plan.project).toBe("bakery");
    expect(plan.files.map((file) => file.path)).toEqual(["index.html", "css/site.css"]);
    expect(plan.tooLarge).toBe(false);
  });

  it("leaves node_modules, .git and system clutter behind", () => {
    const plan = planUpload([
      { path: "app/src/main.js", size: 1 },
      { path: "app/node_modules/react/index.js", size: 1 },
      { path: "app/.git/config", size: 1 },
      { path: "app/.DS_Store", size: 1 },
      { path: "app/sub/Thumbs.db", size: 1 },
    ]);
    expect(plan.files.map((file) => file.path)).toEqual(["src/main.js"]);
    expect(plan.skipped).toBe(4);
  });

  it("refuses paths that climb out of the project", () => {
    const plan = planUpload([{ path: "app/../../etc/passwd", size: 1 }, { path: "app/ok.txt", size: 1 }]);
    expect(plan.files.map((file) => file.path)).toEqual(["ok.txt"]);
    expect(plan.skipped).toBe(1);
  });

  it("names loose files' project 'upload'", () => {
    expect(planUpload([{ path: "notes.txt", size: 1 }, { path: "logo.png", size: 1 }]).project).toBe("upload");
  });

  it("says when the whole is too big", () => {
    expect(planUpload([{ path: "a/big.bin", size: UPLOAD_LIMIT_BYTES + 1 }]).tooLarge).toBe(true);
  });
});

/* ── A minimal zip writer, for the tests only ───────────────────────────── */

function zip(entries: { name: string; data: string; method: 0 | 8 }[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = Buffer.from(entry.data);
    const body = entry.method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(entry.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(entry.method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(entry.method, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

describe("readZip", () => {
  it("reads stored and deflated files, skipping folders", async () => {
    const files = await readZip(zip([
      { name: "site/", data: "", method: 0 },
      { name: "site/index.html", data: "<h1>Bakery</h1>", method: 8 },
      { name: "site/notes.txt", data: "plain", method: 0 },
    ]));
    expect(files.map((file) => [file.path, new TextDecoder().decode(file.data)])).toEqual([
      ["site/index.html", "<h1>Bakery</h1>"],
      ["site/notes.txt", "plain"],
    ]);
  });

  it("refuses something that is not a zip", async () => {
    await expect(readZip(new TextEncoder().encode("not a zip at all"))).rejects.toThrow("isn't a .zip");
  });
});
