/**
 * Connecting GitHub in the web version's sandbox, so Commit & Push works there too.
 *
 * The desktop leans on the computer's own git credentials. A sandbox has none, so the person
 * connects GitHub once with GitHub's device flow (a code typed at github.com/login/device, the
 * same OAuth app the desktop links accounts with), asking for the `repo` scope. The token is
 * sealed with the per-user key the cloud passes in and kept in the sandbox's user data, and an
 * askpass program hands it to git - only when git asks about github.com.
 */
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sealString, unsealString } from "./seal.ts";

export const GITHUB_CLIENT_ID = process.env["ADCODE_GITHUB_CLIENT_ID"] ?? "Ov23lienZUTAiNKAM0UV";
const TOKEN_FILE = "github-token.sealed";

export interface DeviceFlow {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  /** Seconds between polls, as GitHub asks. */
  readonly interval: number;
  /** Epoch milliseconds after which the code is no good. */
  readonly expiresAt: number;
}

export type TokenResult = { readonly ok: true; readonly token: string } | { readonly ok: false; readonly reason: string };

export async function startDeviceFlow(fetcher: typeof fetch, clientId: string, now: number): Promise<DeviceFlow> {
  const response = await fetcher("https://github.com/login/device/code", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, scope: "repo read:user user:email" }),
  });
  const body = (await response.json()) as Record<string, unknown>;
  const deviceCode = body["device_code"];
  const userCode = body["user_code"];
  const uri = body["verification_uri"];
  if (typeof deviceCode !== "string" || typeof userCode !== "string" || typeof uri !== "string") throw new Error("GitHub didn't start the sign-in. Try again.");
  const verification = new URL(uri);
  // The person is sent to this address to type the code; it must be GitHub's own page.
  if (verification.protocol !== "https:" || verification.hostname !== "github.com" || verification.pathname !== "/login/device") throw new Error("GitHub sent an unexpected sign-in page.");
  const interval = typeof body["interval"] === "number" ? body["interval"] : 5;
  const expiresIn = typeof body["expires_in"] === "number" ? body["expires_in"] : 900;
  return { deviceCode, userCode, verificationUri: verification.href, interval, expiresAt: now + expiresIn * 1000 };
}

export async function pollForToken(fetcher: typeof fetch, clientId: string, flow: DeviceFlow, sleep: (ms: number) => Promise<void>, now: () => number): Promise<TokenResult> {
  let interval = flow.interval;
  while (now() < flow.expiresAt) {
    await sleep(interval * 1000);
    let body: Record<string, unknown>;
    try {
      const response = await fetcher("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, device_code: flow.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
      });
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      // One failed poll is not a failed sign-in; keep waiting until the code expires.
      continue;
    }
    const token = body["access_token"];
    if (typeof token === "string" && token.length > 0) return { ok: true, token };
    const error = body["error"];
    if (error === "slow_down") interval += 5;
    else if (error === "access_denied") return { ok: false, reason: "GitHub sign-in was declined." };
    else if (error === "expired_token") return { ok: false, reason: "The code expired. Try again." };
    else if (error !== "authorization_pending") return { ok: false, reason: "GitHub refused the sign-in." };
  }
  return { ok: false, reason: "The code expired. Try again." };
}

const GITHUB_PROMPT = /^(Username|Password) for 'https:\/\/(?:[^@'/]*@)?github\.com':/;

/** What to answer when git asks for credentials: only ever for github.com. */
export function askpassAnswer(prompt: string, token: string | null): string {
  const match = GITHUB_PROMPT.exec(prompt);
  if (match === null || token === null) return "";
  return match[1] === "Username" ? "x-access-token" : token;
}

export async function saveGitHubToken(userDataDir: string, sealKey: string, token: string): Promise<void> {
  await mkdir(userDataDir, { recursive: true });
  await writeFile(join(userDataDir, TOKEN_FILE), sealString(token, sealKey), { mode: 0o600 });
}

export async function readGitHubToken(userDataDir: string, sealKey: string): Promise<string | null> {
  try {
    return unsealString(await readFile(join(userDataDir, TOKEN_FILE)), sealKey);
  } catch {
    return null;
  }
}

/*
 * The program git runs as GIT_ASKPASS: a plain CommonJS file, because git starts it on its own.
 * It repeats `askpassAnswer` and `unsealString` rather than importing them; the test runs the
 * written program to keep the two in step.
 */
const ASKPASS_SOURCE = String.raw`#!/usr/bin/env node
"use strict";
const { createDecipheriv } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const prompt = process.argv[2] || "";
const match = /^(Username|Password) for 'https:\/\/(?:[^@'/]*@)?github\.com':/.exec(prompt);
let answer = "";
if (match !== null) {
  try {
    const key = Buffer.from(process.env.ADCODE_SEAL_KEY || "", "base64");
    const sealed = readFileSync(join(process.env.ADCODE_USER_DATA_DIR || "", "github-token.sealed"));
    const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12));
    decipher.setAuthTag(sealed.subarray(sealed.length - 16));
    const token = Buffer.concat([decipher.update(sealed.subarray(12, sealed.length - 16)), decipher.final()]).toString("utf8");
    answer = match[1] === "Username" ? "x-access-token" : token;
  } catch (error) {
    answer = "";
  }
}
process.stdout.write(answer + "\n");
`;

/** Writes the askpass program into the user data folder and returns its path. */
export async function writeAskpass(userDataDir: string): Promise<string> {
  const dir = join(userDataDir, "bin");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "github-askpass.cjs");
  await writeFile(path, ASKPASS_SOURCE, { mode: 0o755 });
  await chmod(path, 0o755).catch(() => undefined);
  return path;
}

/** Who the token belongs to, for the "Connected as …" line and a commit identity. */
export async function gitHubUser(fetcher: typeof fetch, token: string): Promise<{ login: string; name: string | null; id: number } | null> {
  try {
    const response = await fetcher("https://api.github.com/user", { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "ADCode" } });
    if (!response.ok) return null;
    const body = (await response.json()) as Record<string, unknown>;
    return typeof body["login"] === "string" && typeof body["id"] === "number"
      ? { login: body["login"], name: typeof body["name"] === "string" && body["name"].length > 0 ? body["name"] : null, id: body["id"] }
      : null;
  } catch {
    return null;
  }
}

export interface GitHubOpsOptions {
  readonly userDataDir: string;
  readonly sealKey: () => string;
  readonly fetcher: typeof fetch;
  readonly sleep: (ms: number) => Promise<void>;
  /** Records commits under the person's GitHub name when no identity is set yet. */
  readonly setIdentity: (name: string, email: string) => Promise<void>;
}

/** The web-only operations behind "Connect GitHub". */
export function createGitHubOps(options: GitHubOpsOptions): Record<string, (...args: unknown[]) => Promise<unknown>> {
  let flow: DeviceFlow | null = null;
  const loginFile = join(options.userDataDir, "github-login.json");

  return {
    async githubStatus(): Promise<{ connected: boolean; login: string | null }> {
      const token = await readGitHubToken(options.userDataDir, options.sealKey());
      if (token === null) return { connected: false, login: null };
      const login = await readFile(loginFile, "utf8").then((text) => (JSON.parse(text) as { login?: string }).login ?? null, () => null);
      return { connected: true, login };
    },

    async githubStart(): Promise<{ userCode: string; verificationUri: string; expiresAt: number }> {
      flow = await startDeviceFlow(options.fetcher, GITHUB_CLIENT_ID, Date.now());
      return { userCode: flow.userCode, verificationUri: flow.verificationUri, expiresAt: flow.expiresAt };
    },

    async githubFinish(): Promise<{ ok: true; login: string | null } | { ok: false; reason: string }> {
      if (flow === null) return { ok: false, reason: "Start connecting GitHub first." };
      const current = flow;
      flow = null;
      const result = await pollForToken(options.fetcher, GITHUB_CLIENT_ID, current, options.sleep, Date.now);
      if (!result.ok) return result;
      await saveGitHubToken(options.userDataDir, options.sealKey(), result.token);
      const user = await gitHubUser(options.fetcher, result.token);
      if (user !== null) {
        await writeFile(loginFile, JSON.stringify({ login: user.login }));
        await options.setIdentity(user.name ?? user.login, `${user.id}+${user.login}@users.noreply.github.com`).catch(() => undefined);
      }
      return { ok: true, login: user?.login ?? null };
    },

    async githubDisconnect(): Promise<void> {
      const { rm } = await import("node:fs/promises");
      await rm(join(options.userDataDir, TOKEN_FILE), { force: true });
      await rm(loginFile, { force: true });
    },
  };
}
