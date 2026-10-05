import { describe, it, expect } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyMediaCommandSignature } from "./media-command-signature";
import { NonRetryableStreamError } from "@sebascarvajal11/cima-contracts/event-consumer";
import { env } from "../config/env";

describe("verifyMediaCommandSignature", () => {
  it("throws NonRetryableStreamError when signature token is malformed", async () => {
    const fakeCommand = {
      type: "file.access-requested" as const,
      version: 1 as const,
      contractVersion: 1 as const,
      correlationId: "corr-1",
      requestedAt: new Date().toISOString(),
      actor: { sub: "sub-1", userId: "usr-1", role: "worker" as const, email: "a@b.com" },
      objectKey: "projects/p1/t1/doc.pdf",
      forceDownload: false,
      signature: "invalid-token",
    };

    await expect(verifyMediaCommandSignature(fakeCommand)).rejects.toThrow(
      NonRetryableStreamError,
    );
  });

  it("verifies valid RSA-2048 command signature asynchronously without blocking", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const originalKey = env.COLLAB_JWT_PUBLIC_KEY;
    (env as any).COLLAB_JWT_PUBLIC_KEY = publicKey.export({ type: "spki", format: "pem" });

    try {
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: env.COLLAB_JWT_ISS,
        aud: "crm-media",
        purpose: "media.command",
        correlationId: "corr-test-rsa",
        commandType: "file.access-requested",
        objectKey: "projects/p1/doc.pdf",
        iat: now,
        exp: now + 60,
      };

      const header = { alg: "RS256", typ: "JWT" };
      const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const partial = `${headerB64}.${payloadB64}`;
      const sig = sign("sha256", Buffer.from(partial), privateKey);
      const signatureToken = `${partial}.${sig.toString("base64url")}`;

      const command = {
        type: "file.access-requested" as const,
        version: 1 as const,
        contractVersion: 1 as const,
        correlationId: "corr-test-rsa",
        requestedAt: new Date().toISOString(),
        actor: { sub: "sub-1", userId: "usr-1", role: "worker" as const, email: "a@b.com" },
        objectKey: "projects/p1/doc.pdf",
        forceDownload: false,
        signature: signatureToken,
      };

      await expect(verifyMediaCommandSignature(command)).resolves.toBeUndefined();
    } finally {
      (env as any).COLLAB_JWT_PUBLIC_KEY = originalKey;
    }
  });

  it("rejects tampered signature with NonRetryableStreamError", async () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const originalKey = env.COLLAB_JWT_PUBLIC_KEY;
    (env as any).COLLAB_JWT_PUBLIC_KEY = publicKey.export({ type: "spki", format: "pem" });

    try {
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: env.COLLAB_JWT_ISS,
        aud: "crm-media",
        purpose: "media.command",
        correlationId: "corr-tampered",
        commandType: "file.access-requested",
        objectKey: "projects/p1/doc.pdf",
        iat: now,
        exp: now + 60,
      };

      const header = { alg: "RS256", typ: "JWT" };
      const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const fakeSig = Buffer.from("invalid-tampered-signature-data").toString("base64url");
      const signatureToken = `${headerB64}.${payloadB64}.${fakeSig}`;

      const command = {
        type: "file.access-requested" as const,
        version: 1 as const,
        contractVersion: 1 as const,
        correlationId: "corr-tampered",
        requestedAt: new Date().toISOString(),
        actor: { sub: "sub-1", userId: "usr-1", role: "worker" as const, email: "a@b.com" },
        objectKey: "projects/p1/doc.pdf",
        forceDownload: false,
        signature: signatureToken,
      };

      await expect(verifyMediaCommandSignature(command)).rejects.toThrow(
        /Firma de JWT de servicio inválida/,
      );
    } finally {
      (env as any).COLLAB_JWT_PUBLIC_KEY = originalKey;
    }
  });
});
