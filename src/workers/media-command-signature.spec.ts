import { describe, it, expect } from "vitest";
import { verifyMediaCommandSignature } from "./media-command-signature";
import { NonRetryableStreamError } from "@sebascarvajal11/cima-contracts/event-consumer";

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
});
