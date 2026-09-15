import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
const keys = vi.hoisted(() => ({ pem: "" }));
vi.mock("../../config/env", () => ({ env: { EMAIL_SERVICE_JWKS: { "crm-auth": "https://auth.test/jwks" } } }));
vi.mock("@sebascarvajal11/cima-contracts/jwks", () => ({ JwksClient: class { getPublicKeyPem() { return keys.pem; } } }));
import { authorizeEmail, emailBodyHash } from "./email.authorization";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
keys.pem = pair.publicKey.export({ format: "pem", type: "spki" }).toString();
const body = '{"id":"a"}';
function token(overrides: object = {}, alg = "RS256") {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg, kid: "test" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: "crm-auth", sub: "crm-auth",
    aud: "crm-media:email", purpose: "email:dispatch", iat: now, exp: now + 60,
    bodyHash: emailBodyHash(body), ...overrides })).toString("base64url");
  const signer = createSign("RSA-SHA256"); signer.update(header + "." + payload);
  return "Bearer " + header + "." + payload + "." + signer.sign(pair.privateKey).toString("base64url");
}
describe("email service authorization", () => {
  it("accepts a signed short-lived command", async () => expect(await authorizeEmail(token(), body)).toBe("crm-auth"));
  it.each([
    { aud: "crm-frontend" }, { purpose: "login" }, { exp: 1 },
    { iss: "unknown", sub: "unknown" }, { iat: 9999999999 },
  ])("rejects invalid identity claims %j", async (claims) => {
    await expect(authorizeEmail(token(claims), body)).rejects.toBeInstanceOf(Error);
  });
  it("rejects missing signatures, algorithm substitution and tampered bodies", async () => {
    await expect(authorizeEmail(undefined, body)).rejects.toMatchObject({ statusCode: 401 });
    await expect(authorizeEmail(token({}, "HS256"), body)).rejects.toMatchObject({ statusCode: 401 });
    await expect(authorizeEmail(token(), body + " ")).rejects.toMatchObject({ statusCode: 401 });
  });
});
