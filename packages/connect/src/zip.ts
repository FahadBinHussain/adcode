/**
 * Reading zip archives without a zip dependency.
 *
 * Claude Desktop extensions (`.mcpb`) are zip files, and a Claude Code plugin can be
 * zipped too. The only thing this reader is used for is unpacking those, so it reads
 * exactly what such an archive contains - stored entries and deflate, no encryption, no
 * zip64 - and refuses the rest with a sentence that says what to do.
 *
 * The rejection rules are the point of the file, not an afterthought. An archive is
 * untrusted input and its entry names become file paths on the person's disk, so:
 *
 * - every path is checked against traversal, absolute paths, drive letters, Windows
 *   device names and NTFS alternate data streams (`:` in a segment) before anything else;
 * - sizes are capped per entry, in total, and at inflate time (`maxOutputLength`), so a
 *   zip bomb fails as a plain error rather than by filling the disk;
 * - every entry's CRC is verified after inflate, so a corrupted download never reaches
 *   the folder half-written.
 */
import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export interface ZipLimits {
  /** The most entries an archive may hold. */
  readonly maxEntries: number;
  /** The most bytes one entry may inflate to. */
  readonly maxEntryBytes: number;
  /** The most bytes the whole archive may inflate to. */
  readonly maxTotalBytes: number;
}

export const ZIP_LIMITS: ZipLimits = { maxEntries: 2_000, maxEntryBytes: 16 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024 };

export interface ZipEntry {
  /** The archive name, already validated and normalized to forward slashes. */
  readonly name: string;
  readonly directory: boolean;
  readonly method: 0 | 8;
  readonly size: number;
  readonly compressedSize: number;
  /** Offset of the entry's local header. */
  readonly headerOffset: number;
  readonly crc: number;
}

/* ── Path safety ───────────────────────────────────────────────────────────── */

const WINDOWS_DEVICES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * The archive name as a relative path, or an error naming the problem.
 *
 * Called before any write. `..`, absolute paths, backslashes (a second traversal
 * spelling on Windows), drive letters, `:` (an NTFS alternate data stream) and reserved
 * device names are all refused rather than sanitized - silently rewriting a path hides
 * that the archive is hostile, and the person should be told.
 */
export function safeEntryPath(name: string): string {
  if (name.length === 0) throw new Error("The zip contains an entry with an empty name.");
  if (name.length > 240) throw new Error(`The zip contains an entry name longer than 240 characters: ${name.slice(0, 60)}…`);
  if (name.includes("\0")) throw new Error("The zip contains a file name with a null byte.");
  if (name.includes("\\")) throw new Error(`The zip contains a file name with a backslash: ${name}`);
  if (name.startsWith("/")) throw new Error(`The zip contains an absolute path: ${name}`);
  if (/^[a-zA-Z]:/.test(name)) throw new Error(`The zip contains a path with a drive letter: ${name}`);
  const segments: string[] = [];
  for (const segment of name.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") throw new Error(`The zip contains a path that climbs out of its folder: ${name}`);
    if (segment.includes(":")) throw new Error(`The zip contains a file name with a colon: ${name}`);
    if (WINDOWS_DEVICES.test(segment)) throw new Error(`The zip contains a reserved file name: ${name}`);
    segments.push(segment);
  }
  if (segments.length === 0) throw new Error("The zip contains an entry with no usable name.");
  return segments.join("/");
}

/* ── Reading ───────────────────────────────────────────────────────────────── */

const view = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function u16(dv: DataView, at: number): number {
  if (at + 2 > dv.byteLength) throw new Error("The zip is truncated.");
  return dv.getUint16(at, true);
}
function u32(dv: DataView, at: number): number {
  if (at + 4 > dv.byteLength) throw new Error("The zip is truncated.");
  return dv.getUint32(at, true);
}

/** The offset of the end-of-central-directory record, or -1 when this is not a zip. */
function findEnd(bytes: Uint8Array): number {
  if (bytes.byteLength < 22) return -1;
  const dv = view(bytes);
  const floor = Math.max(0, bytes.byteLength - 22 - 65_535);
  for (let at = bytes.byteLength - 22; at >= floor; at--) {
    if (dv.getUint32(at, true) !== EOCD_SIGNATURE) continue;
    const comment = u16(dv, at + 20);
    if (at + 22 + comment === bytes.byteLength) return at;
  }
  return -1;
}

export function isZip(bytes: Uint8Array): boolean {
  return findEnd(bytes) !== -1;
}

/**
 * Every file in the archive, without inflating anything yet.
 *
 * Directory entries are returned but marked, because a bundle that only declares a
 * folder is not an error. Throws with a plain sentence when the archive cannot be
 * trusted: encrypted entries, zip64, more bytes than the caps allow, or a hostile name.
 */
export function readZipDirectory(bytes: Uint8Array, limits: ZipLimits = ZIP_LIMITS): ZipEntry[] {
  const eocd = findEnd(bytes);
  if (eocd === -1) throw new Error("This file is not a zip archive, or it is truncated.");
  const dv = view(bytes);
  const disk = u16(dv, eocd + 4);
  const directoryDisk = u16(dv, eocd + 6);
  const onDisk = u16(dv, eocd + 8);
  const total = u16(dv, eocd + 10);
  const directorySize = u32(dv, eocd + 12);
  const directoryOffset = u32(dv, eocd + 16);
  if (disk !== 0 || directoryDisk !== 0 || onDisk !== total) throw new Error("Split zip archives are not supported.");
  if (total === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) throw new Error("This zip is larger than the importer accepts.");
  if (total > limits.maxEntries) throw new Error(`This zip holds more than ${limits.maxEntries.toLocaleString()} files.`);
  if (directoryOffset + directorySize > bytes.byteLength) throw new Error("The zip's table of contents runs past the end of the file.");

  const entries: ZipEntry[] = [];
  let at = directoryOffset;
  let totalBytes = 0;
  const seen = new Set<string>();
  for (let index = 0; index < total; index++) {
    if (u32(dv, at) !== CENTRAL_SIGNATURE) throw new Error("The zip's table of contents is damaged.");
    const flags = u16(dv, at + 8);
    const method = u16(dv, at + 10);
    const crc = u32(dv, at + 16);
    const compressedSize = u32(dv, at + 20);
    const size = u32(dv, at + 24);
    const nameLength = u16(dv, at + 28);
    const extraLength = u16(dv, at + 30);
    const commentLength = u16(dv, at + 32);
    const headerOffset = u32(dv, at + 42);
    if (flags & 0x1) throw new Error("This zip is password-protected, and ADCode cannot read encrypted archives.");
    if (method !== 0 && method !== 8) throw new Error("This zip uses a compression ADCode cannot read. Re-pack it as a plain zip.");
    const rawName = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const directory = rawName.endsWith("/");
    const name = safeEntryPath(directory ? rawName.slice(0, -1) : rawName);
    if (seen.has(name)) throw new Error(`The zip contains two entries named ${name}.`);
    seen.add(name);
    if (size > limits.maxEntryBytes) throw new Error(`The zip contains a file larger than ${Math.round(limits.maxEntryBytes / 1024 / 1024)} MB: ${name}`);
    totalBytes += size;
    if (totalBytes > limits.maxTotalBytes) throw new Error(`The zip unpacks to more than ${Math.round(limits.maxTotalBytes / 1024 / 1024)} MB.`);
    if (headerOffset + 30 > bytes.byteLength) throw new Error("The zip's file data runs past the end of the file.");
    entries.push({ name, directory, method: method as 0 | 8, size, compressedSize, headerOffset, crc });
    at += 46 + nameLength + extraLength + commentLength;
    if (at > directoryOffset + directorySize) throw new Error("The zip's table of contents is damaged.");
  }
  return entries;
}

/* CRC-32, the same polynomial zips use. Small enough to keep the reader dependency-free. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let byte = 0; byte < 256; byte++) {
    let value = byte;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[byte] = value >>> 0;
  }
  return table;
})();
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]!;
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * One entry's bytes, inflated and verified against its CRC.
 *
 * Throws on a size that does not match the directory, which is what a truncated or
 * tampered download looks like. `maxOutputLength` stops a bomb during inflate rather
 * than after it.
 */
export function readZipEntry(bytes: Uint8Array, entry: ZipEntry, limits: ZipLimits = ZIP_LIMITS): Uint8Array {
  const dv = view(bytes);
  if (entry.directory) throw new Error(`${entry.name} is a folder.`);
  if (u32(dv, entry.headerOffset) !== LOCAL_SIGNATURE) throw new Error(`The zip's data for ${entry.name} is damaged.`);
  const nameLength = u16(dv, entry.headerOffset + 26);
  const extraLength = u16(dv, entry.headerOffset + 28);
  const start = entry.headerOffset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > bytes.byteLength) throw new Error(`The zip's data for ${entry.name} runs past the end of the file.`);
  const compressed = bytes.subarray(start, end);
  let data: Uint8Array;
  if (entry.method === 0) {
    data = compressed.slice();
  } else {
    const limit = Math.min(entry.size, limits.maxEntryBytes);
    data = new Uint8Array(inflateRawSync(compressed, { maxOutputLength: limit }));
  }
  if (data.byteLength !== entry.size) throw new Error(`${entry.name} unpacked to ${data.byteLength.toLocaleString()} bytes where ${entry.size.toLocaleString()} were expected.`);
  if (crc32(data) !== entry.crc) throw new Error(`${entry.name} is damaged - its checksum does not match.`);
  return data;
}
