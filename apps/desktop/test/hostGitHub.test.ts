/*
 * Pushing to GitHub from the web version's sandbox.
 *
 * The desktop leans on the computer's own git credentials. A sandbox has none, so the person
 * connects GitHub once (GitHub's device flow - a code typed at github.com/login/device), and the
 * token is kept sealed in the sandbox and handed to git only when git asks about github.com.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { askpassAnswer, createGitHubOps, pollForToken, readGitHubToken, saveGitHubToken, startDeviceFlow, writeAskpass } from "../src/host/githubConnect.ts";

function respond(...bodies: Record<string, unknown>[]): typeof fetch {
  let call = 0;
  return (async () => new Response(JSON.stringify(bodies[Math.min(call++, bodies.length - 1)]), { status: 200 })) as unknown as typeof fetch;
}

describe("device flow", () => {
  it("starts with a code for the person to type at GitHub", async () => {
    const flow = await startDeviceFlow(respond({ device_code: "dev-1", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", interval: 5, expires_in: 900 }), "client", 1_000);
    expect(flow).toEqual({ deviceCode: "dev-1", userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", interval: 5, expiresAt: 901_000 });
  });

  it("refuses a verification page that is not GitHub's", async () => {
    await expect(startDeviceFlow(respond({ device_code: "d", user_code: "u", verification_uri: "https://evil.example/login/device", interval: 5, expires_in: 900 }), "client", 0)).rejects.toThrow();
  });

  it("keeps polling while GitHub waits, slows down when asked, and returns the token", async () => {
    const waits: number[] = [];
    const result = await pollForToken(
      respond({ error: "authorization_pending" }, { error: "slow_down" }, { access_token: "gho_token" }),
      "client",
      { deviceCode: "d", userCode: "u", verificationUri: "https://github.com/login/device", interval: 5, expiresAt: Number.MAX_SAFE_INTEGER },
      async (ms) => { waits.push(ms); },
      () => 0,
    );
    expect(result).toEqual({ ok: true, token: "gho_token" });
    expect(waits).toEqual([5_000, 5_000, 10_000]);
  });

  it("says plainly when the person declined or the code ran out", async () => {
    const flow = { deviceCode: "d", userCode: "u", verificationUri: "https://github.com/login/device", interval: 1, expiresAt: Number.MAX_SAFE_INTEGER };
    expect(await pollForToken(respond({ error: "access_denied" }), "c", flow, async () => undefined, () => 0)).toEqual({ ok: false, reason: "GitHub sign-in was declined." });
    expect(await pollForToken(respond({ error: "expired_token" }), "c", flow, async () => undefined, () => 0)).toEqual({ ok: false, reason: "The code expired. Try again." });
  });
});

describe("askpass", () => {
  it("answers git's questions about github.com, and nothing else", () => {
    expect(askpassAnswer("Username for 'https://github.com': ", "gho_token")).toBe("x-access-token");
    expect(askpassAnswer("Password for 'https://x-access-token@github.com': ", "gho_token")).toBe("gho_token");
    expect(askpassAnswer("Password for 'https://gitlab.com': ", "gho_token")).toBe("");
    expect(askpassAnswer("Username for 'https://github.com.evil.example': ", "gho_token")).toBe("");
    expect(askpassAnswer("Username for 'https://github.com': ", null)).toBe("");
  });
});

describe("token store", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("keeps the token sealed and reads it back with the same key only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adcode-gh-"));
    dirs.push(dir);
    const key = Buffer.alloc(32, 9).toString("base64");
    await saveGitHubToken(dir, key, "gho_secret");
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(join(dir, "github-token.sealed")).includes(Buffer.from("gho_secret"))).toBe(false);
    expect(await readGitHubToken(dir, key)).toBe("gho_secret");
    expect(await readGitHubToken(dir, Buffer.alloc(32, 1).toString("base64"))).toBeNull();
  });

  it("is null when nothing was saved", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adcode-gh-"));
    dirs.push(dir);
    expect(await readGitHubToken(dir, Buffer.alloc(32, 9).toString("base64"))).toBeNull();
  });
});

describe("the askpass program git runs", () => {
  it("prints the token for GitHub's password prompt and nothing for anyone else", async () => {
    const { execFileSync } = await import("node:child_process");
    const dir = mkdtempSync(join(tmpdir(), "adcode-askpass-"));
    try {
      const key = Buffer.alloc(32, 4).toString("base64");
      await saveGitHubToken(dir, key, "gho_from_script");
      const script = await writeAskpass(dir);
      const ask = (prompt: string): string => execFileSync(process.execPath, [script, prompt], { env: { ...process.env, ADCODE_SEAL_KEY: key, ADCODE_USER_DATA_DIR: dir } }).toString();
      expect(ask("Password for 'https://x-access-token@github.com': ")).toBe("gho_from_script\n");
      expect(ask("Username for 'https://github.com': ")).toBe("x-access-token\n");
      expect(ask("Password for 'https://example.com': ")).toBe("\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("GitHub operations", () => {
  it("connects through the device flow, remembers who, and forgets on disconnect", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adcode-ghops-"));
    try {
      const key = Buffer.alloc(32, 5).toString("base64");
      const fetcher = (async (url: string) => {
        if (url.endsWith("/login/device/code")) return Response.json({ device_code: "d", user_code: "WXYZ-0000", verification_uri: "https://github.com/login/device", interval: 1, expires_in: 60 });
        if (url.endsWith("/login/oauth/access_token")) return Response.json({ access_token: "gho_ops" });
        if (url.endsWith("/user")) return Response.json({ login: "sinan", name: "Sinan", id: 42 });
        return new Response("", { status: 404 });
      }) as unknown as typeof fetch;
      const identities: string[][] = [];
      const ops = createGitHubOps({ userDataDir: dir, sealKey: () => key, fetcher, sleep: async () => undefined, setIdentity: async (name, email) => { identities.push([name, email]); } });
      expect(await ops["githubStatus"]!()).toEqual({ connected: false, login: null });
      expect(await ops["githubStart"]!()).toMatchObject({ userCode: "WXYZ-0000", verificationUri: "https://github.com/login/device" });
      expect(await ops["githubFinish"]!()).toEqual({ ok: true, login: "sinan" });
      expect(await ops["githubStatus"]!()).toEqual({ connected: true, login: "sinan" });
      expect(identities).toEqual([["Sinan", "42+sinan@users.noreply.github.com"]]);
      await ops["githubDisconnect"]!();
      expect(await ops["githubStatus"]!()).toEqual({ connected: false, login: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("says so when finishing without starting", async () => {
    const ops = createGitHubOps({ userDataDir: tmpdir(), sealKey: () => Buffer.alloc(32, 5).toString("base64"), fetcher: fetch, sleep: async () => undefined, setIdentity: async () => undefined });
    expect(await ops["githubFinish"]!()).toEqual({ ok: false, reason: "Start connecting GitHub first." });
  });
});
