/**
 * Who is asking: a Firebase ID token, checked before anything that costs money happens.
 *
 * The same Firebase project as the desktop app and the site, so the uid here is the uid the
 * person's earnings and included-AI allowance are kept under. Verification follows Firebase's
 * published rules for ID tokens: RS256, signed by one of Google's securetoken keys, audience
 * the project id, issuer `https://securetoken.google.com/<project>`, unexpired, with a non-empty
 * subject of at most 128 characters and a sign-in time that is not in the future.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface Verified {
  readonly uid: string;
  readonly email: string | null;
  /** Expiry, epoch seconds. */
  readonly exp: number;
}

const GOOGLE_KEYS = new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");

let remoteKeys: JWTVerifyGetKey | null = null;

function googleKeys(): JWTVerifyGetKey {
  remoteKeys ??= createRemoteJWKSet(GOOGLE_KEYS, { cacheMaxAge: 60 * 60_000 });
  return remoteKeys;
}

/** The verified person, or null for anything that is not a valid token for this project. */
export async function verifyIdToken(token: string, projectId: string, keys: JWTVerifyGetKey = googleKeys()): Promise<Verified | null> {
  if (projectId.length === 0 || token.length === 0 || token.length > 8192) return null;
  try {
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ["RS256"],
      audience: projectId,
      issuer: `https://securetoken.google.com/${projectId}`,
    });
    const uid = payload.sub;
    if (typeof uid !== "string" || uid.length === 0 || uid.length > 128) return null;
    const authTime = payload["auth_time"];
    if (typeof authTime === "number" && authTime > Math.floor(Date.now() / 1000) + 60) return null;
    if (typeof payload.exp !== "number") return null;
    const email = typeof payload["email"] === "string" ? payload["email"] : null;
    return { uid, email, exp: payload.exp };
  } catch {
    return null;
  }
}

/**
 * The token a browser offered in `Sec-WebSocket-Protocol`, as `auth.<token>`.
 *
 * A request header rather than a query string, so the token never lands in a URL - not in
 * history, not in a referrer, not in an access log.
 */
export function tokenFromProtocols(header: string | null): string | null {
  if (header === null) return null;
  for (const offered of header.split(",")) {
    const value = offered.trim();
    if (value.startsWith("auth.") && value.length > "auth.".length) return value.slice("auth.".length);
  }
  return null;
}
