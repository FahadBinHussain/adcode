/**
 * The web sandbox's identity: whoever is signed in, in the browser.
 *
 * The desktop signs in anonymously on first launch and keeps a refresh token on disk. The web
 * version must not make an account of its own: the person already signed in, in the browser,
 * with the same Firebase account the desktop links to, and their earnings belong on that uid.
 * So the browser sends its short-lived ID token over the socket (and a fresh one before it
 * expires), and every `/v1` call the main process makes carries the latest one. No refresh
 * token ever reaches the sandbox.
 *
 * The token was verified by the cloud Worker before it reached this container, and `/v1`
 * verifies it again on every call, so this module only reads its claims; it never trusts them
 * for anything `/v1` would not check itself.
 */
import type { AuthError, FirebaseAuth, LinkedProfile, Result } from "@adcode/ads";

export interface BrowserAccountOptions {
  readonly now: () => number;
  /** Ask the connected tabs for a fresh token; the answer arrives through `accept`. */
  readonly requestToken: () => void;
  /** How long `getToken` waits for a fresh token before it gives up. */
  readonly waitMs: number;
}

export interface BrowserAccount extends FirebaseAuth {
  /** A token the browser sent. Ignored when malformed or when it names a different person. */
  accept(token: string): void;
}

interface Claims {
  readonly sub: string;
  readonly exp: number;
  readonly email?: unknown;
  readonly name?: unknown;
  readonly picture?: unknown;
  readonly firebase?: { readonly sign_in_provider?: unknown };
}

/** Within this long of expiry a token is not handed out: the call it is for may outlive it. */
const EXPIRY_MARGIN_MS = 60_000;
const SIGNED_OUT: AuthError = { kind: "auth", detail: "Signed out: open ADCode in your browser to continue" };
const BROWSER_ONLY: AuthError = { kind: "auth", detail: "On the web, accounts are managed in the browser" };

function claimsOf(token: string): Claims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Partial<Claims>;
    if (typeof claims.sub !== "string" || claims.sub.length === 0 || typeof claims.exp !== "number") return null;
    return claims as Claims;
  } catch {
    return null;
  }
}

const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

export function createBrowserAccount(options: BrowserAccountOptions): BrowserAccount {
  let current: { token: string; claims: Claims } | null = null;
  let waiters: ((fresh: boolean) => void)[] = [];

  const usable = (): boolean => current !== null && current.claims.exp * 1000 - options.now() > EXPIRY_MARGIN_MS;

  const refused = <T>(): Promise<Result<T, AuthError>> => Promise.resolve({ ok: false, error: BROWSER_ONLY });

  return {
    accept(token: string): void {
      const claims = claimsOf(token);
      if (claims === null) return;
      if (current !== null && current.claims.sub !== claims.sub) return;
      current = { token, claims };
      const ready = waiters;
      waiters = [];
      for (const wake of ready) wake(true);
    },

    uid: () => current?.claims.sub ?? null,

    async getToken(): Promise<Result<string, AuthError>> {
      if (usable()) return { ok: true, value: current!.token };
      options.requestToken();
      const fresh = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          waiters = waiters.filter((waiter) => waiter !== wake);
          resolve(false);
        }, options.waitMs);
        const wake = (value: boolean): void => {
          clearTimeout(timer);
          resolve(value);
        };
        waiters.push(wake);
      });
      return fresh && usable() ? { ok: true, value: current!.token } : { ok: false, error: SIGNED_OUT };
    },

    invalidate(): void {
      if (current !== null) current = { token: current.token, claims: { ...current.claims, exp: 0 } };
    },

    load: async () => undefined,
    reset: async () => undefined,

    async profile(): Promise<Result<LinkedProfile | null, AuthError>> {
      if (current === null) return { ok: true, value: null };
      const { claims } = current;
      const provider = text(claims.firebase?.sign_in_provider);
      return {
        ok: true,
        value: {
          email: text(claims.email),
          displayName: text(claims.name),
          photoUrl: text(claims.picture),
          providers: provider === null || provider === "anonymous" ? [] : [provider],
        },
      };
    },

    linkPassword: () => refused(),
    linkGoogle: () => refused(),
    linkGitHub: () => refused(),
    signInGoogle: () => refused(),
    signInGitHub: () => refused(),
    signInPassword: () => refused(),
  };
}
