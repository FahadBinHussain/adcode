/*
 * The Worker's front door.
 *
 * Every request lands here first. A sandbox costs money from the moment it starts, so nothing
 * reaches a person's Durable Object without a verified sign-in from an allowed page. These tests
 * run the router against stand-in bindings and check who gets through, and what a refused
 * socket is told (a WebSocket close code is the only thing a browser can read from a refused
 * upgrade).
 */
import { describe, expect, it, vi } from "vitest";
import { route, type RouterDeps } from "../src/router.ts";
import type { Env } from "../src/env.ts";

function fakeEnv(): { env: Env; userFetch: ReturnType<typeof vi.fn>; assetsFetch: ReturnType<typeof vi.fn>; names: string[] } {
  const names: string[] = [];
  const userFetch = vi.fn(async (request: Request) => new Response(`user:${request.headers.get("x-adcode-uid")}`));
  const assetsFetch = vi.fn(async () => new Response("<!doctype html><title>ADCode</title>", { headers: { "content-type": "text/html; charset=utf-8" } }));
  const env = {
    APP_HOST: "web.bluethenics.com",
    PREVIEW_SUFFIX: ".web.bluethenics.com",
    FIREBASE_PROJECT_ID: "adcode-test",
    FIREBASE_AUTH_DOMAIN: "adcode-test.firebaseapp.com",
    ALLOWED_ORIGINS: "https://web.bluethenics.com",
    ADMIN_UIDS: "admin-1",
    USER: { getByName: (name: string) => { names.push(name); return { fetch: userFetch }; } },
    PREVIEW: { getByName: () => ({ owner: async () => null }) },
    BUDGET: { getByName: () => ({ stats: async () => ({ spentUsd: 1 }) }) },
    ASSETS: { fetch: assetsFetch },
  } as unknown as Env;
  return { env, userFetch, assetsFetch, names };
}

const deps: RouterDeps = {
  verify: async (token) => (token === "good-token" ? { uid: "user-123", email: "sinan@example.com", exp: 0 } : null),
  refuseSocket: (code, reason) => new Response(`refused ${code} ${reason}`, { status: 299 }),
};

function socketRequest(headers: Record<string, string>): Request {
  return new Request("https://web.bluethenics.com/socket", { headers: { upgrade: "websocket", ...headers } });
}

describe("socket", () => {
  it("refuses a page from somewhere else", async () => {
    const { env, names } = fakeEnv();
    const response = await route(socketRequest({ origin: "https://evil.example", "sec-websocket-protocol": "adcode.v1, auth.good-token" }), env, deps);
    expect(response.status).toBe(403);
    expect(names).toEqual([]);
  });

  it("tells a tab without a valid sign-in to sign in again, without waking anything", async () => {
    const { env, names } = fakeEnv();
    for (const protocols of ["adcode.v1", "adcode.v1, auth.bad-token"]) {
      const response = await route(socketRequest({ origin: "https://web.bluethenics.com", "sec-websocket-protocol": protocols }), env, deps);
      expect(await response.text()).toBe("refused 4401 Signed out");
    }
    expect(names).toEqual([]);
  });

  it("sends a signed-in tab to that person's own sandbox", async () => {
    const { env, names, userFetch } = fakeEnv();
    const response = await route(socketRequest({ origin: "https://web.bluethenics.com", "sec-websocket-protocol": "adcode.v1, auth.good-token" }), env, deps);
    expect(names).toEqual(["user-123"]);
    expect(await response.text()).toBe("user:user-123");
    const forwarded = userFetch.mock.calls[0]![0] as Request;
    expect(new URL(forwarded.url).pathname).toBe("/socket");
    expect(forwarded.headers.get("x-adcode-email")).toBe("sinan@example.com");
  });

  it("needs an upgrade", async () => {
    const { env } = fakeEnv();
    expect((await route(new Request("https://web.bluethenics.com/socket"), env, deps)).status).toBe(426);
  });
});

describe("api", () => {
  it("needs a bearer token", async () => {
    const { env, names } = fakeEnv();
    expect((await route(new Request("https://web.bluethenics.com/api/session"), env, deps)).status).toBe(401);
    expect(names).toEqual([]);
  });

  it("reads the session status for the signed-in person", async () => {
    const { env, userFetch } = fakeEnv();
    const response = await route(new Request("https://web.bluethenics.com/api/session", { headers: { authorization: "Bearer good-token" } }), env, deps);
    expect(response.status).toBe(200);
    expect(new URL((userFetch.mock.calls[0]![0] as Request).url).pathname).toBe("/status");
  });

  it("never passes on the headers only the Worker may set", async () => {
    const { env, userFetch } = fakeEnv();
    await route(new Request("https://web.bluethenics.com/api/session", {
      headers: { authorization: "Bearer good-token", "x-adcode-preview-port": "5173", "x-adcode-uid": "someone-else" },
    }), env, deps);
    const forwarded = userFetch.mock.calls[0]![0] as Request;
    expect(forwarded.headers.has("x-adcode-preview-port")).toBe(false);
    expect(forwarded.headers.get("x-adcode-uid")).toBe("user-123");
  });

  it("deletes only with POST", async () => {
    const { env } = fakeEnv();
    expect((await route(new Request("https://web.bluethenics.com/api/delete", { headers: { authorization: "Bearer good-token" } }), env, deps)).status).toBe(405);
  });

  it("shows spend only to admins", async () => {
    const { env } = fakeEnv();
    const stranger = await route(new Request("https://web.bluethenics.com/admin/stats", { headers: { authorization: "Bearer good-token" } }), env, deps);
    expect(stranger.status).toBe(403);
    const admin = await route(new Request("https://web.bluethenics.com/admin/stats", { headers: { authorization: "Bearer admin-token" } }), env, {
      ...deps,
      verify: async () => ({ uid: "admin-1", email: null, exp: 0 }),
    });
    expect(await admin.json()).toEqual({ spentUsd: 1 });
  });
});

describe("the page", () => {
  it("serves the app with a strict content security policy", async () => {
    const { env } = fakeEnv();
    const response = await route(new Request("https://web.bluethenics.com/"), env, deps);
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-src https://*.web.bluethenics.com https://adcode-test.firebaseapp.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("does not serve the app on a preview hostname", async () => {
    const { env, assetsFetch } = fakeEnv();
    const response = await route(new Request("https://p-5173-abcdefghij.web.bluethenics.com/index.html"), env, deps);
    expect(response.status).toBe(404);
    expect(assetsFetch).not.toHaveBeenCalled();
  });
});
