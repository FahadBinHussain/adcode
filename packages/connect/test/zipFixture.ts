/**
 * A minimal zip writer, for tests only.
 *
 * Writing zips is not something the app does; this exists so the reader's tests run
 * against real archives - real local headers, real central directory, real CRCs -
 * without shipping a zip dependency just to build fixtures. Both compression methods
 * the reader accepts are available, and flags, method and sizes can be overridden so
 * hostile archives can be built on purpose.
 */
import { deflateRawSync } from "node:zlib";
import { crc32 } from "../src/zip.ts";

export interface FixtureEntry {
  readonly name: string;
  readonly data: string | Uint8Array;
  /** Deflate the entry's bytes instead of storing them. */
  readonly deflate?: boolean;
  /** Override the method byte written into the headers (to fake formats the reader must refuse). */
  readonly method?: number;
  /** Set the encrypted flag. */
  readonly encrypted?: boolean;
  /** Override the recorded CRC (to fake corruption). */
  readonly crc?: number;
  /** Override the recorded uncompressed size (to fake a bomb's outward claim). */
  readonly size?: number;
}

const encoder = new TextEncoder();

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}
function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}
function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}
const latin = (text: string): Uint8Array => Uint8Array.from(text, character => character.charCodeAt(0) & 0xff);

export function makeZip(entries: readonly FixtureEntry[]): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    const method = entry.method ?? (entry.deflate === true ? 8 : 0);
    const body = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
    const crc = entry.crc ?? crc32(raw);
    const size = entry.size ?? raw.byteLength;
    const flags = entry.encrypted === true ? 0x1 : 0;
    const name = latin(entry.name);
    local.push(u32(0x04034b50), u16(20), u16(flags), u16(method), u16(0), u16(0), u32(crc), u32(body.byteLength), u32(size), u16(name.byteLength), u16(0), name, body);
    central.push(u32(0x02014b50), u16(20), u16(20), u16(flags), u16(method), u16(0), u16(0), u32(crc), u32(body.byteLength), u32(size), u16(name.byteLength), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name);
    offset += 30 + name.byteLength + body.byteLength;
  }
  const localBytes = concat(local);
  const centralBytes = concat(central);
  const end = concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralBytes.byteLength), u32(localBytes.byteLength), u16(0),
  ]);
  return concat([localBytes, centralBytes, end]);
}

/** Replace the central directory's entry counts with the zip64 sentinel. */
export function claimZip64(zip: Uint8Array): Uint8Array {
  const copy = zip.slice();
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  view.setUint16(copy.byteLength - 14, 0xffff, true);
  view.setUint16(copy.byteLength - 12, 0xffff, true);
  return copy;
}

/** Replace one entry's method byte (at its local and central headers). */
export function forceMethod(zip: Uint8Array, method: number): Uint8Array {
  const copy = zip.slice();
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  for (let at = 0; at + 4 <= copy.byteLength; at++) {
    const signature = view.getUint32(at, true);
    if (signature === 0x04034b50 || signature === 0x02014b50) view.setUint16(at + (signature === 0x04034b50 ? 8 : 10), method, true);
  }
  return copy;
}
