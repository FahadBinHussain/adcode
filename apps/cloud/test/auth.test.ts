/*
 * Who may open a sandbox.
 *
 * Starting a container costs money, so the Worker checks the Firebase ID token before anything
 * else happens. These tests sign real RS256 tokens with a throwaway key and pin every way one
 * can be wrong: another project's token, an expired one, an unsigned one, one without a subject.
 */
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { tokenFromProtocols, verifyIdToken } from "../src/auth.ts";

const PROJECT = "adcode-test";
let privateKey: CryptoKey;
let keys: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  const publicJwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  keys = createLocalJWKSet({ keys: [publicJwk] });
});

async function token(overrides: { sub?: string; aud?: string; iss?: string; exp?: number; authTime?: number } = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: "sinan@example.com", auth_time: overrides.authTime ?? now - 60 })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setSubject(overrides.sub ?? "user-123")
    .setAudience(overrides.aud ?? PROJECT)
    .setIssuer(overrides.iss ?? `https://securetoken.google.com/${PROJECT}`)
    .setIssuedAt(now - 60)
    .setExpirationTime(overrides.exp ?? now + 3600)
    .sign(privateKey);
}

describe("verifyIdToken", () => {
  it("accepts a valid token and returns who it is", async () => {
    const verified = await verifyIdToken(await token(), PROJECT, keys);
    expect(verified).toMatchObject({ uid: "user-123", email: "sinan@example.com" });
  });

  it("refuses another project's token", async () => {
    expect(await verifyIdToken(await token({ aud: "someone-else" }), PROJECT, keys)).toBeNull();
    expect(await verifyIdToken(await token({ iss: "https://securetoken.google.com/someone-else" }), PROJECT, keys)).toBeNull();
  });

  it("refuses an expired token", async () => {
    expect(await verifyIdToken(await token({ exp: Math.floor(Date.now() / 1000) - 10 }), PROJECT, keys)).toBeNull();
  });

  it("refuses an unsigned token", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ sub: "user-123", aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, exp: 9999999999 })).toString("base64url");
    expect(await verifyIdToken(`${header}.${body}.`, PROJECT, keys)).toBeNull();
  });

  it("refuses a token without a usable subject", async () => {
    expect(await verifyIdToken(await token({ sub: "" }), PROJECT, keys)).toBeNull();
    expect(await verifyIdToken(await token({ sub: "x".repeat(129) }), PROJECT, keys)).toBeNull();
  });

  it("refuses a token signed in at a time still to come", async () => {
    expect(await verifyIdToken(await token({ authTime: Math.floor(Date.now() / 1000) + 600 }), PROJECT, keys)).toBeNull();
  });

  it("refuses garbage", async () => {
    expect(await verifyIdToken("not a token", PROJECT, keys)).toBeNull();
  });
});

describe("tokenFromProtocols", () => {
  it("finds the token among the offered subprotocols", () => {
    expect(tokenFromProtocols("adcode.v1, auth.eyJhbGciOi.abc.def")).toBe("eyJhbGciOi.abc.def");
  });

  it("is null when no token is offered", () => {
    expect(tokenFromProtocols("adcode.v1")).toBeNull();
    expect(tokenFromProtocols(null)).toBeNull();
    expect(tokenFromProtocols("adcode.v1, auth.")).toBeNull();
  });
});
