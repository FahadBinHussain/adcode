/**
 * The frames that cross the socket between the browser, the cloud and adcode-host.
 *
 * Plain TypeScript with no DOM and no Node, because all three ends import it: the browser
 * bridge, the host's server, and the Worker that sits between them.
 *
 * Electron's IPC uses structured clone, so main-process code hands the renderer `Uint8Array`s,
 * `Date`s and the occasional `Map` without a second thought. JSON would turn each of those into
 * something else and the screen reading them would break quietly, so the codec walks every
 * value and tags those types: `{"$u8": base64}`, `{"$ab": base64}`, `{"$date": iso}`,
 * `{"$map": [[k, v]...]}`, `{"$set": [...]}` and `{"$undef": 1}`. An ordinary object key that
 * starts with `$` is escaped by doubling the dollar, so data can never be mistaken for a tag.
 */

export type AskKind = "openExternal" | "pickFolder" | "pickFile" | "confirm" | "clipboardRead" | "clipboardWrite";

/** What adcode-host says about itself the moment a tab connects. */
export interface HostHello {
  readonly version: string;
  readonly surface: "web";
  readonly projectsHome: string;
}

/** What the cloud says about this person's sandbox: whether it runs, and how much time is left today. */
export interface CloudStatus {
  readonly state: "waking" | "ready" | "sleeping" | "spent" | "full" | "busy" | "restarted";
  readonly allowanceMs: number;
  readonly usedMs: number;
  /** When today's allowance starts again, epoch milliseconds. */
  readonly resetsAt: number;
  readonly storageBytes?: number;
  readonly message?: string;
}

export type ClientFrame =
  | { readonly t: "call"; readonly id: number; readonly ch: string; readonly args: readonly unknown[] }
  | { readonly t: "send"; readonly ch: string; readonly args: readonly unknown[] }
  | { readonly t: "answer"; readonly id: number; readonly ok: boolean; readonly value?: unknown; readonly error?: string }
  | { readonly t: "auth"; readonly token: string }
  | { readonly t: "focus"; readonly focused: boolean }
  | { readonly t: "input" }
  | { readonly t: "previewUrl"; readonly id: number; readonly url: string };

export type ServerFrame =
  | { readonly t: "ready"; readonly host: HostHello }
  | { readonly t: "ret"; readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly t: "ret"; readonly id: number; readonly ok: false; readonly error: string }
  | { readonly t: "evt"; readonly ch: string; readonly args: readonly unknown[] }
  | { readonly t: "ask"; readonly id: number; readonly kind: AskKind; readonly payload: unknown }
  | { readonly t: "cloud"; readonly status: CloudStatus }
  | { readonly t: "previewUrl"; readonly id: number; readonly url: string };

export type Frame = ClientFrame | ServerFrame;

/* ── Bytes ─────────────────────────────────────────────────────────────── */

const CHUNK = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(start, start + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/* ── Walking values ────────────────────────────────────────────────────── */

function toWire(value: unknown): unknown {
  if (value === undefined) return { $undef: 1 };
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Uint8Array) return { $u8: bytesToBase64(value) };
  if (value instanceof ArrayBuffer) return { $ab: bytesToBase64(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value)) return { $u8: bytesToBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
  if (value instanceof Date) return { $date: Number.isNaN(value.getTime()) ? null : value.toISOString() };
  if (value instanceof Map) return { $map: [...value].map(([key, entry]) => [toWire(key), toWire(entry)]) };
  if (value instanceof Set) return { $set: [...value].map(toWire) };
  if (Array.isArray(value)) return value.map(toWire);
  if (value instanceof Error) return { message: value.message, name: value.name };
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "function" || typeof entry === "symbol") continue;
    out[key.startsWith("$") ? `$${key}` : key] = toWire(entry);
  }
  return out;
}

function fromWire(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(fromWire);
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 1) {
    const [key] = keys;
    const tagged = record[key!];
    if (key === "$undef") return undefined;
    if (key === "$u8" && typeof tagged === "string") return base64ToBytes(tagged);
    if (key === "$ab" && typeof tagged === "string") {
      const bytes = base64ToBytes(tagged);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    if (key === "$date" && (typeof tagged === "string" || tagged === null)) return new Date(tagged ?? Number.NaN);
    if (key === "$map" && Array.isArray(tagged)) {
      return new Map(tagged.map((pair) => {
        const [mapKey, mapValue] = Array.isArray(pair) ? pair : [];
        return [fromWire(mapKey), fromWire(mapValue)];
      }));
    }
    if (key === "$set" && Array.isArray(tagged)) return new Set(tagged.map(fromWire));
  }
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key.startsWith("$$") ? key.slice(1) : key] = fromWire(record[key]);
  return out;
}

/* ── Frames ────────────────────────────────────────────────────────────── */

export function encodeFrame(frame: Frame): string {
  return JSON.stringify(toWire(frame));
}

const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);
const isString = (value: unknown): value is string => typeof value === "string";

/** Checks the shape of a frame; anything else is dropped rather than half-handled. */
function wellFormed(frame: Record<string, unknown>): boolean {
  switch (frame["t"]) {
    case "call": return isInteger(frame["id"]) && isString(frame["ch"]) && Array.isArray(frame["args"]);
    case "send": return isString(frame["ch"]) && Array.isArray(frame["args"]);
    case "evt": return isString(frame["ch"]) && Array.isArray(frame["args"]);
    case "answer": return isInteger(frame["id"]) && typeof frame["ok"] === "boolean";
    case "ret": return isInteger(frame["id"]) && typeof frame["ok"] === "boolean" && (frame["ok"] === true || isString(frame["error"]));
    case "auth": return isString(frame["token"]);
    case "focus": return typeof frame["focused"] === "boolean";
    case "input": return true;
    case "previewUrl": return isInteger(frame["id"]) && isString(frame["url"]);
    case "ready": return typeof frame["host"] === "object" && frame["host"] !== null;
    case "ask": return isInteger(frame["id"]) && isString(frame["kind"]);
    case "cloud": return typeof frame["status"] === "object" && frame["status"] !== null;
    default: return false;
  }
}

/** The frame, or `null` for anything that is not JSON or not a frame this protocol knows. */
export function decodeFrame(text: string): Frame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const frame = fromWire(parsed) as Record<string, unknown>;
  return wellFormed(frame) ? (frame as unknown as Frame) : null;
}
