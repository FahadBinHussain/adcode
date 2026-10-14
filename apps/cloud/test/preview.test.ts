/*
 * Who can open a preview.
 *
 * Only the person whose sandbox it is: their tab trades a one-time code for a cookie signed for
 * that preview id, and every request must carry it. Anyone else gets a 404 - not a 401 - so a
 * stranger cannot even tell that the preview exists.
 */
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.ts";
import { previewRequest } from "../src/preview.ts";
import { signCookie } from "../src/previewAuth.ts";

const KEY = "preview-cookie-key-for-tests-only";
const ID = "abcdefghij";
const HOST = `https://p-5173-${ID}.web.bluethenics.com`;

function fakeEnv(owner: string | null = "user-123") {
  const nonces = new Set(["fresh-nonce"]);
  const userFetch = vi.fn(async (request: Request) => new Response(`from ${request.headers.get("x-adcode-preview-port")}`));
  const env = {
    PREVIEW_COOKIE_KEY: KEY,
    PREVIEW: { getByName: () => ({ owner: async () => owner, consume: async (nonce: string) => nonces.delete(nonce) }) },
    USER: { getByName: () => ({ fetch: userFetch }) },
  } as unknown as Env;
  return { env, userFetch };
}

async function cookieFor(previewId: string, exp = Date.now() + 60_000): Promise<string> {
  return `adcode_preview=${await signCookie({ previewId, exp }, KEY)}`;
}

describe("preview requests", () => {
  it("trades a fresh code for a host-only cookie and sends the tab on", async () => {
    const { env } = fakeEnv();
    const response = await previewRequest(new Request(`${HOST}/__adcode/auth?t=fresh-nonce&next=%2Fmenu`), env, 5173, ID);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/menu");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^adcode_preview=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200$/);
    expect(cookie).not.toContain("Domain=");
  });

  it("refuses a code that was already used", async () => {
    const { env } = fakeEnv();
    await previewRequest(new Request(`${HOST}/__adcode/auth?t=fresh-nonce`), env, 5173, ID);
    expect((await previewRequest(new Request(`${HOST}/__adcode/auth?t=fresh-nonce`), env, 5173, ID)).status).toBe(404);
  });

  it("never redirects off the preview's own host", async () => {
    const { env } = fakeEnv();
    const response = await previewRequest(new Request(`${HOST}/__adcode/auth?t=fresh-nonce&next=%2F%2Fevil.example`), env, 5173, ID);
    expect(response.headers.get("location")).toBe("/");
  });

  it("is a 404 without the cookie, or with another preview's", async () => {
    const { env, userFetch } = fakeEnv();
    expect((await previewRequest(new Request(`${HOST}/`), env, 5173, ID)).status).toBe(404);
    const foreign = await previewRequest(new Request(`${HOST}/`, { headers: { cookie: await cookieFor("zzzzzzzzzz") } }), env, 5173, ID);
    expect(foreign.status).toBe(404);
    const expired = await previewRequest(new Request(`${HOST}/`, { headers: { cookie: await cookieFor(ID, Date.now() - 1) } }), env, 5173, ID);
    expect(expired.status).toBe(404);
    expect(userFetch).not.toHaveBeenCalled();
  });

  it("hands a request with the right cookie to the owner's sandbox, naming the port", async () => {
    const { env, userFetch } = fakeEnv();
    const response = await previewRequest(new Request(`${HOST}/menu?x=1`, { headers: { cookie: await cookieFor(ID) } }), env, 5173, ID);
    expect(await response.text()).toBe("from 5173");
    expect(new URL((userFetch.mock.calls[0]![0] as Request).url).pathname).toBe("/menu");
  });

  it("is a 404 for a preview id nobody owns", async () => {
    const { env } = fakeEnv(null);
    expect((await previewRequest(new Request(`${HOST}/`, { headers: { cookie: await cookieFor(ID) } }), env, 5173, ID)).status).toBe(404);
  });
});
