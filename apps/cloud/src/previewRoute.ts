/**
 * One per preview id: whose sandbox a preview hostname belongs to, and its one-time nonces.
 *
 * A preview hostname carries a random id, never the uid. This small Durable Object maps the id
 * back to its owner with strong consistency - no eventually consistent lookup that could send
 * a preview to the wrong place - and without one shared object in the path of every preview.
 */
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env.ts";

const NONCE_TTL_MS = 60_000;

export class PreviewRoute extends DurableObject<Env> {
  async set(uid: string): Promise<void> {
    await this.ctx.storage.put("uid", uid);
  }

  async owner(): Promise<string | null> {
    return (await this.ctx.storage.get<string>("uid")) ?? null;
  }

  /** A single-use code the owner's tab trades for a preview cookie. */
  async mint(): Promise<string> {
    const nonce = [...crypto.getRandomValues(new Uint8Array(18))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    await this.ctx.storage.put(`nonce:${nonce}`, Date.now() + NONCE_TTL_MS);
    return nonce;
  }

  async consume(nonce: string): Promise<boolean> {
    if (!/^[0-9a-f]{36}$/.test(nonce)) return false;
    const key = `nonce:${nonce}`;
    const expires = await this.ctx.storage.get<number>(key);
    if (expires === undefined) return false;
    await this.ctx.storage.delete(key);
    return expires > Date.now();
  }
}
