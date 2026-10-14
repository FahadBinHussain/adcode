/*
 * Whose earnings the web sandbox credits.
 *
 * The desktop signs in anonymously on first launch and keeps that identity on disk. The web
 * version must not: its person is already signed in, in the browser, with the same Firebase
 * account the desktop links to - so the sandbox borrows the browser's short-lived ID token for
 * every `/v1` call and never holds a refresh token of its own. These tests pin that the uid and
 * profile come from the token, that an expiring token is not used, and that a missing one ends
 * in an error rather than a hang.
 */
import { describe, expect, it } from "vitest";
import { createBrowserAccount } from "../src/host/browserAccount.ts";

function token(claims: Record<string, unknown>): string {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", kid: "k" })}.${encode(claims)}.signature`;
}

const NOW = 1_800_000_000_000;
const valid = (extra: Record<string, unknown> = {}): string => token({
  sub: "user-123",
  exp: NOW / 1000 + 3600,
  email: "sinan@example.com",
  name: "Sinan",
  picture: "https://example.com/p.png",
  firebase: { sign_in_provider: "google.com" },
  ...extra,
});

describe("browser-backed account", () => {
  it("has no uid until the browser sends a token", () => {
    const account = createBrowserAccount({ now: () => NOW, requestToken: () => undefined, waitMs: 10 });
    expect(account.uid()).toBeNull();
  });

  it("takes its uid and token from what the browser sent", async () => {
    const account = createBrowserAccount({ now: () => NOW, requestToken: () => undefined, waitMs: 10 });
    const sent = valid();
    account.accept(sent);
    expect(account.uid()).toBe("user-123");
    expect(await account.getToken()).toEqual({ ok: true, value: sent });
  });

  it("reads the profile from the token's claims", async () => {
    const account = createBrowserAccount({ now: () => NOW, requestToken: () => undefined, waitMs: 10 });
    account.accept(valid());
    expect(await account.profile()).toEqual({
      ok: true,
      value: { email: "sinan@example.com", displayName: "Sinan", photoUrl: "https://example.com/p.png", providers: ["google.com"] },
    });
  });

  it("asks for a fresh token instead of using one about to expire, and uses the new one", async () => {
    let asked = 0;
    const account = createBrowserAccount({
      now: () => NOW,
      requestToken: () => {
        asked += 1;
        setTimeout(() => account.accept(valid({ exp: NOW / 1000 + 3600, iat: 2 })), 5);
      },
      waitMs: 1_000,
    });
    account.accept(valid({ exp: NOW / 1000 + 30 }));
    const result = await account.getToken();
    expect(asked).toBe(1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(Buffer.from(result.value.split(".")[1]!, "base64url").toString())["iat"]).toBe(2);
  });

  it("gives up with an auth error when no tab answers", async () => {
    const account = createBrowserAccount({ now: () => NOW, requestToken: () => undefined, waitMs: 20 });
    const result = await account.getToken();
    expect(result).toEqual({ ok: false, error: { kind: "auth", detail: "Signed out: open ADCode in your browser to continue" } });
  });

  it("ignores a token for a different person once one is known", () => {
    const account = createBrowserAccount({ now: () => NOW, requestToken: () => undefined, waitMs: 10 });
    account.accept(valid());
    account.accept(valid({ sub: "someone-else" }));
    expect(account.uid()).toBe("user-123");
  });

  it("refuses garbage without changing who is signed in", () => {
    const account = createBrowserAccount({ now: () => NOW, requestToken: () => undefined, waitMs: 10 });
    account.accept("not.a.token");
    expect(account.uid()).toBeNull();
  });

  it("does not offer linking, which happens in the browser on the web", async () => {
    const account = createBrowserAccount({ now: () => NOW, requestToken: () => undefined, waitMs: 10 });
    const result = await account.linkGoogle("x");
    expect(result.ok).toBe(false);
  });
});
