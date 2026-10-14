/**
 * Private preview hostnames and the cookie that opens them.
 *
 * A preview is the person's own app, running in their sandbox, at
 * `p-<port>-<previewId><PREVIEW_SUFFIX>`. The preview id is random and per person - never the uid
 * - and only a request carrying a cookie signed for that exact id is let through. The cookie is
 * issued once, against a single-use nonce, to the person's own tab. So what a preview serves can
 * only ever be seen by the person who made it: a phishing page with no victims.
 *
 * Web Crypto only, so this runs in the Worker and in tests alike.
 */

const PREVIEW_HOST = /^p-(\d{4,5})-([a-z0-9]{10})$/;
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export interface PreviewCookie {
  readonly previewId: string;
  /** Expiry, epoch milliseconds. */
  readonly exp: number;
}

export function parsePreviewHost(host: string, suffix: string): { port: number; previewId: string } | null {
  const lower = host.toLowerCase().replace(/:\d+$/, "");
  if (lower !== host.replace(/:\d+$/, "") || !lower.endsWith(suffix)) return null;
  const label = lower.slice(0, -suffix.length);
  const match = PREVIEW_HOST.exec(label);
  if (match === null) return null;
  const port = Number(match[1]);
  if (port < 1024 || port > 65535) return null;
  return { port, previewId: match[2]! };
}

export function previewHost(port: number, previewId: string, suffix: string): string {
  return `p-${port}-${previewId}${suffix}`;
}

export function newPreviewId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("");
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signCookie(cookie: PreviewCookie, secret: string): Promise<string> {
  const body = base64url(new TextEncoder().encode(JSON.stringify({ previewId: cookie.previewId, exp: cookie.exp })));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(body)));
  return `${body}.${base64url(signature)}`;
}

export async function readCookie(value: string, secret: string, now: number): Promise<PreviewCookie | null> {
  const [body, signature, extra] = value.split(".");
  if (body === undefined || signature === undefined || extra !== undefined || body.length === 0 || signature.length === 0) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromBase64url(signature), new TextEncoder().encode(body));
    if (!valid) return null;
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as Partial<PreviewCookie>;
    if (typeof parsed.previewId !== "string" || typeof parsed.exp !== "number" || parsed.exp <= now) return null;
    return { previewId: parsed.previewId, exp: parsed.exp };
  } catch {
    return null;
  }
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

/** `http://localhost:5173/x` in the sandbox, as the address the person's browser can open. */
export function rewriteLoopbackUrl(url: string, previewId: string, suffix: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!LOOPBACK.has(parsed.hostname) || parsed.port.length === 0) return null;
  const port = Number(parsed.port);
  if (port < 1024 || port > 65535) return null;
  return `https://${previewHost(port, previewId, suffix)}${parsed.pathname}${parsed.search}${parsed.hash}`;
}
