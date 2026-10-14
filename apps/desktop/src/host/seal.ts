/**
 * `safeStorage` for the cloud sandbox.
 *
 * On the desktop, keys a person saves (OpenAI, Anthropic, a GitHub token) are encrypted with
 * the operating system's keychain. A container has no keychain, so they are sealed with
 * AES-256-GCM under a per-user key that the cloud generates once, keeps in that user's Durable
 * Object, and passes to the container when it starts. The sandbox's home folder is archived to
 * R2 when it sleeps; without this key, an archive on its own does not give up anyone's keys.
 *
 * Layout: 12-byte IV, ciphertext, 16-byte authentication tag.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;

function keyFrom(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) throw new Error("The seal key must be 32 bytes");
  return key;
}

export function sealString(plain: string, keyB64: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(keyB64), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]);
}

export function unsealString(sealed: Buffer, keyB64: string): string {
  if (sealed.length < IV_BYTES + TAG_BYTES) throw new Error("Sealed data is too short");
  const iv = sealed.subarray(0, IV_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  const body = sealed.subarray(IV_BYTES, sealed.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(keyB64), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
