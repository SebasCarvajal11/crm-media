import { describe, it, expect, vi } from "vitest";

vi.mock("../../shared/storage/oci-storage", () => ({
  ociStorage: {
    verifyObjectExists: vi.fn(),
    getObjectMetadata: vi.fn(),
    createUploadPar: vi.fn().mockResolvedValue("https://objectstorage.test/upload-url"),
    createPrivateDocumentUrl: vi.fn().mockResolvedValue("https://objectstorage.test/access-url"),
    deleteObject: vi.fn().mockResolvedValue(undefined),
  },
}));

import { assertCollabObjectKey } from "./collab-document.service";
import { documentService } from "./document.service";
import { AppError } from "../../shared/middlewares/error-handler.middleware";

describe("collabDocumentService", () => {
  it("allows object keys starting with projects/", () => {
    expect(() => assertCollabObjectKey("projects/proj-123/task-456/file.pdf")).not.toThrow();
  });

  it("throws AppError 403 when object key does not start with projects/", () => {
    expect(() => assertCollabObjectKey("documents/user-123/file.pdf")).toThrow(AppError);
    try {
      assertCollabObjectKey("documents/user-123/file.pdf");
    } catch (err: any) {
      expect(err.statusCode).toBe(403);
    }
  });

  it("rejects file exceeding 25MB in generateDocumentUploadUrl", async () => {
    await expect(
      documentService.generateDocumentUploadUrl(
        "user-1",
        "test.pdf",
        "application/pdf",
        26 * 1024 * 1024,
      ),
    ).rejects.toThrow("Archivo excede 25MB");
  });

  it("rejects blocked file extensions", async () => {
    await expect(
      documentService.generateDocumentUploadUrl(
        "user-1",
        "malware.exe",
        "application/x-msdownload",
        1000,
      ),
    ).rejects.toThrow("Tipo de archivo bloqueado por seguridad");
  });

  it("generates upload URL for valid document", async () => {
    const res = await documentService.generateDocumentUploadUrl(
      "user-1",
      "valid.pdf",
      "application/pdf",
      1024,
    );
    expect(res.uploadUrl).toBe("https://objectstorage.test/upload-url");
    expect(res.objectKey).toContain("documents/user-1/");
  });
});
