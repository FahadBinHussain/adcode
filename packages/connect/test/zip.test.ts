import { describe, expect, it } from "vitest";
import { crc32, isZip, readZipDirectory, readZipEntry, safeEntryPath, ZIP_LIMITS } from "../src/zip.ts";
import { claimZip64, forceMethod, makeZip } from "./zipFixture.ts";

const decoder = new TextDecoder();
const readText = (zip: Uint8Array, name: string): string => {
  const entry = readZipDirectory(zip).find(candidate => candidate.name === name);
  if (entry === undefined) throw new Error(`no entry ${name}`);
  return decoder.decode(readZipEntry(zip, entry));
};

describe("safeEntryPath", () => {
  it("accepts ordinary relative paths and normalizes them", () => {
    expect(safeEntryPath("server/index.js")).toBe("server/index.js");
    expect(safeEntryPath("./server/index.js")).toBe("server/index.js");
    expect(safeEntryPath("a//b///c.txt")).toBe("a/b/c.txt");
    expect(safeEntryPath("README.md")).toBe("README.md");
  });
  it("refuses traversal, absolutes, drive letters, alternate data streams and device names", () => {
    expect(() => safeEntryPath("../evil.txt")).toThrow(/climbs out/);
    expect(() => safeEntryPath("a/../../evil.txt")).toThrow(/climbs out/);
    expect(() => safeEntryPath("..\\evil.txt")).toThrow(/backslash/);
    expect(() => safeEntryPath("/etc/passwd")).toThrow(/absolute/);
    expect(() => safeEntryPath("C:/Windows/system32")).toThrow(/drive letter/);
    expect(() => safeEntryPath("file.txt:stream")).toThrow(/colon/);
    expect(() => safeEntryPath("NUL")).toThrow(/reserved/);
    expect(() => safeEntryPath("server/CON.txt")).toThrow(/reserved/);
    expect(() => safeEntryPath("")).toThrow(/empty/);
  });
});

describe("readZipDirectory and readZipEntry", () => {
  it("reads stored and deflated entries back byte for byte", () => {
    const text = "The quick brown fox jumps over the lazy dog. ".repeat(40);
    const zip = makeZip([
      { name: "manifest.json", data: JSON.stringify({ hello: "world" }) },
      { name: "server/index.js", data: text, deflate: true },
      { name: "server/", data: "" },
    ]);
    expect(isZip(zip)).toBe(true);
    const entries = readZipDirectory(zip);
    expect(entries.map(entry => entry.name)).toEqual(["manifest.json", "server/index.js", "server"]);
    expect(entries[2]?.directory).toBe(true);
    expect(readText(zip, "manifest.json")).toBe('{"hello":"world"}');
    expect(readText(zip, "server/index.js")).toBe(text);
  });

  it("reports a not-a-zip file and a truncated one plainly", () => {
    expect(isZip(new TextEncoder().encode("plain text"))).toBe(false);
    expect(() => readZipDirectory(new TextEncoder().encode("plain text"))).toThrow(/not a zip/);
    const zip = makeZip([{ name: "a.txt", data: "hello" }]);
    expect(() => readZipDirectory(zip.slice(0, zip.byteLength - 30))).toThrow();
  });

  it("refuses encrypted archives, unsupported methods and zip64", () => {
    expect(() => readZipDirectory(makeZip([{ name: "a.txt", data: "x", encrypted: true }]))).toThrow(/password-protected/);
    expect(() => readZipDirectory(forceMethod(makeZip([{ name: "a.txt", data: "x" }]), 12))).toThrow(/compression/);
    expect(() => readZipDirectory(claimZip64(makeZip([{ name: "a.txt", data: "x" }])))).toThrow(/larger than the importer/);
  });

  it("refuses hostile names before any bytes are inflated", () => {
    expect(() => readZipDirectory(makeZip([{ name: "../evil.txt", data: "x" }]))).toThrow(/climbs out/);
    expect(() => readZipDirectory(makeZip([{ name: "C:/x", data: "x" }]))).toThrow(/drive letter/);
  });

  it("verifies the checksum and the recorded size", () => {
    const zip = makeZip([{ name: "a.txt", data: "hello" }]);
    const entry = readZipDirectory(zip)[0]!;
    const manipulated = makeZip([{ name: "a.txt", data: "hello", crc: entry.crc ^ 0xffffffff }]);
    expect(() => readZipEntry(manipulated, readZipDirectory(manipulated)[0]!)).toThrow(/damaged|checksum/);
  });

  it("enforces the entry and total size caps", () => {
    const zip = makeZip([{ name: "big.bin", data: new Uint8Array(64), deflate: true }]);
    expect(() => readZipDirectory(zip, { ...ZIP_LIMITS, maxEntryBytes: 32 })).toThrow(/larger than/);
    expect(() => readZipDirectory(zip, { ...ZIP_LIMITS, maxTotalBytes: 32 })).toThrow(/unpacks to more than/);
    expect(() => readZipDirectory(makeZip([{ name: "a", data: "x" }, { name: "b", data: "y" }]), { ...ZIP_LIMITS, maxEntries: 1 })).toThrow(/more than 1/);
  });

  it("refuses duplicates and directory inflation", () => {
    const zip = makeZip([{ name: "a.txt", data: "x" }, { name: "a.txt", data: "y" }]);
    expect(() => readZipDirectory(zip)).toThrow(/two entries named/);
    const folder = makeZip([{ name: "empty/", data: "" }]);
    expect(() => readZipEntry(folder, readZipDirectory(folder)[0]!)).toThrow(/folder/);
  });
});

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});
