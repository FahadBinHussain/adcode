/**
 * Writes provider keys into this Worker's own Cloudflare secrets, so an administrator can add a
 * key from the admin panel instead of a terminal.
 *
 * It needs one Cloudflare API token with "Workers Scripts: Edit", stored as the secret
 * CLOUDFLARE_SECRETS_TOKEN. That name is deliberately not wrangler's CLOUDFLARE_API_TOKEN, so a
 * developer's deploy token in a local environment never lets a local server write production
 * secrets. Values go to api.cloudflare.com only and are never logged, stored or returned.
 */
export interface WorkerSecretsEnv {
  CLOUDFLARE_SECRETS_TOKEN?: string | undefined;
  /** Optional when the token can see exactly one account. */
  CLOUDFLARE_ACCOUNT_ID?: string | undefined;
  /** The Worker to update; defaults to this site's Worker. */
  CLOUDFLARE_WORKER_NAME?: string | undefined;
}

export type SecretWriteResult = { ok: true } | { ok: false; reason: "not-configured" | "rejected" | "unreachable"; message: string };

export interface WorkerSecrets {
  configured(): boolean;
  put(name: string, value: string): Promise<SecretWriteResult>;
  remove(name: string): Promise<SecretWriteResult>;
}

const API = "https://api.cloudflare.com/client/v4";
const ACCOUNT_ID = /^[0-9a-f]{32}$/;
const WORKER_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;

export function createWorkerSecrets(env: () => WorkerSecretsEnv = () => process.env as WorkerSecretsEnv, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): WorkerSecrets {
  let discovered: string | null = null;
  const token = (): string => (env().CLOUDFLARE_SECRETS_TOKEN ?? "").trim();
  const worker = (): string => (env().CLOUDFLARE_WORKER_NAME ?? "adcode").trim();
  const notConfigured: SecretWriteResult = { ok: false, reason: "not-configured", message: "Key saving is not set up yet. Add the CLOUDFLARE_SECRETS_TOKEN server secret once, then try again." };
  const call = async (path: string, init: RequestInit = {}): Promise<{ status: number; body: unknown } | null> => {
    try {
      const response = await fetchImpl(`${API}${path}`, { ...init, redirect: "manual", headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" } });
      let body: unknown = null;
      try { body = await response.json(); } catch { /* An empty or non-JSON body is judged by its status alone. */ }
      return { status: response.status, body };
    } catch { return null; }
  };
  const accountId = async (): Promise<string | null> => {
    const configuredId = (env().CLOUDFLARE_ACCOUNT_ID ?? "").trim();
    if (configuredId) return ACCOUNT_ID.test(configuredId) ? configuredId : null;
    if (discovered !== null) return discovered;
    const found = await call("/accounts?per_page=2");
    const accounts = (found?.body as { result?: { id?: unknown }[] } | null)?.result;
    if (!Array.isArray(accounts) || accounts.length !== 1 || typeof accounts[0]?.id !== "string" || !ACCOUNT_ID.test(accounts[0].id)) return null;
    return discovered = accounts[0].id;
  };
  const write = async (name: string, method: "PUT" | "DELETE", value?: string): Promise<SecretWriteResult> => {
    if (!token()) return notConfigured;
    if (!SECRET_NAME.test(name) || !WORKER_NAME.test(worker())) return { ok: false, reason: "rejected", message: "That secret name is not allowed." };
    const account = await accountId();
    if (account === null) return { ok: false, reason: "rejected", message: "Cloudflare did not identify one account for the key-saving token. Set CLOUDFLARE_ACCOUNT_ID too." };
    const base = `/accounts/${account}/workers/scripts/${worker()}/secrets`;
    const result = method === "PUT"
      ? await call(base, { method, body: JSON.stringify({ name, text: value, type: "secret_text" }) })
      : await call(`${base}/${name}`, { method });
    if (result === null) return { ok: false, reason: "unreachable", message: "Cloudflare could not be reached. Try again shortly." };
    // Removing a key that was never set is already the state asked for.
    if (result.status >= 200 && result.status < 300 || method === "DELETE" && result.status === 404) return { ok: true };
    return { ok: false, reason: "rejected", message: result.status === 401 || result.status === 403
      ? "Cloudflare refused the key-saving token. It needs the Workers Scripts: Edit permission on this account."
      : `Cloudflare did not save the key (HTTP ${result.status}). Try again, or add it in the Cloudflare dashboard.` };
  };
  return {
    configured: () => token().length > 0,
    put: (name, value) => write(name, "PUT", value),
    remove: (name) => write(name, "DELETE"),
  };
}
