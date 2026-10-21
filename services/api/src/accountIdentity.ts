/**
 * An account's live state at Firebase, read with the person's own ID token.
 *
 * Why the API asks Firebase rather than trusting the token alone: an ID token's
 * `email_verified` claim is a snapshot from when the token was minted, and desktops refresh
 * theirs about once an hour. Someone who opens the verification link would otherwise stay
 * refused for up to an hour after doing exactly what they were told. `accounts:lookup` with
 * their own token reads the account as it is now, from Google, so it is as trustworthy as the
 * token itself - and it can only ever describe the account the token belongs to.
 *
 * `sendVerification` asks Firebase to send its own verification email (from the project's
 * Firebase sender, with Firebase's link) to the address on that account. Nothing here chooses an
 * address: it is always the one Firebase holds for the token's account.
 *
 * Both calls use the project's public web API key, the same one every browser holds.
 */
export interface AccountIdentity {
  lookup(idToken: string): Promise<{ email: string | null; emailVerified: boolean } | null>;
  sendVerification(idToken: string): Promise<boolean>;
}

const IDENTITY_TOOLKIT = "https://identitytoolkit.googleapis.com/v1/accounts:";

export function createFirebaseIdentity(apiKey: () => string, fetchImpl: typeof fetch = fetch): AccountIdentity {
  const post = (method: "lookup" | "sendOobCode", body: Record<string, unknown>): Promise<Response> =>
    fetchImpl(`${IDENTITY_TOOLKIT}${method}?key=${encodeURIComponent(apiKey())}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
  return {
    async lookup(idToken) {
      if (apiKey().length === 0) return null;
      try {
        const response = await post("lookup", { idToken });
        if (!response.ok) return null;
        const data = await response.json() as { users?: { email?: unknown; emailVerified?: unknown }[] };
        const user = data.users?.[0];
        if (user === undefined) return null;
        return { email: typeof user.email === "string" && user.email.length > 0 ? user.email.toLowerCase() : null, emailVerified: user.emailVerified === true };
      } catch {
        return null;
      }
    },
    async sendVerification(idToken) {
      if (apiKey().length === 0) return false;
      try {
        return (await post("sendOobCode", { requestType: "VERIFY_EMAIL", idToken })).ok;
      } catch {
        return false;
      }
    },
  };
}
