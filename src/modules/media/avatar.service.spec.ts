import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "../../shared/middlewares/error-handler.middleware";

const mockUploadPublicAvatar = vi.fn().mockImplementation((key: string) => Promise.resolve(`https://cdn.cima.dev/${key}`));
const mockDeleteObject = vi.fn().mockResolvedValue(undefined);
const mockListObjects = vi.fn().mockResolvedValue([]);
const mockGetPublicObjectUrl = vi.fn().mockImplementation((_bucket: string, key: string) => Promise.resolve(`https://cdn.cima.dev/${key}`));

vi.mock("../../shared/storage/oci-storage", () => ({
  ociStorage: {
    uploadPublicAvatar: (...args: any[]) => mockUploadPublicAvatar(...args),
    deleteObject: (...args: any[]) => mockDeleteObject(...args),
    listObjects: (...args: any[]) => mockListObjects(...args),
    getPublicObjectUrl: (...args: any[]) => mockGetPublicObjectUrl(...args),
  },
}));

vi.mock("../../shared/security/clamav", () => ({
  scanBufferForVirus: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../shared/security/file-validation", () => ({
  detectFileType: vi.fn().mockResolvedValue({ mime: "image/png" }),
  imageMimes: new Set(["image/jpeg", "image/png", "image/webp"]),
}));

vi.mock("sharp", () => {
  return {
    default: vi.fn().mockReturnValue({
      resize: vi.fn().mockReturnThis(),
      webp: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from("fake-webp-image-bytes")),
    }),
  };
});

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockDelete = vi.fn();
const mockExecute = vi.fn();
const mockTransaction = vi.fn();

vi.mock("../../db/connection", () => ({
  db: {
    select: (...args: any[]) => mockSelect(...args),
    delete: (...args: any[]) => mockDelete(...args),
    transaction: (...args: any[]) => mockTransaction(...args),
  },
}));

import { avatarService } from "./avatar.service";

describe("avatarService - two-phase persistence & resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects non-image mime types with AppError 400", async () => {
    const { detectFileType } = await import("../../shared/security/file-validation");
    vi.mocked(detectFileType).mockResolvedValueOnce({ mime: "application/pdf" } as any);

    await expect(
      avatarService.uploadAvatar("user-1", {
        originalName: "doc.pdf",
        rawBuffer: Buffer.from("pdf-data"),
      })
    ).rejects.toThrow(AppError);
  });

  it("uploads variants to OCI before DB and commits without holding long transaction", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ latest: 1 }]),
      }),
    });

    const mockTx = {
      execute: mockExecute.mockResolvedValue(undefined),
      insert: vi.fn().mockReturnValue({
        values: mockInsert.mockResolvedValue(undefined),
      }),
    };
    mockTransaction.mockImplementation(async (callback: any) => callback(mockTx));

    const result = await avatarService.uploadAvatar("user-123", {
      originalName: "avatar.png",
      rawBuffer: Buffer.from("valid-png-bytes"),
    });

    expect(result.version).toBe(2);
    expect(mockUploadPublicAvatar).toHaveBeenCalledTimes(3);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it("triggers compensatory rollback purging OCI objects if SQL transaction fails", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ latest: 0 }]),
      }),
    });

    mockTransaction.mockRejectedValue(new Error("Database connection severed"));

    await expect(
      avatarService.uploadAvatar("user-err", {
        originalName: "avatar.png",
        rawBuffer: Buffer.from("valid-png-bytes"),
      })
    ).rejects.toThrow("Database connection severed");

    expect(mockUploadPublicAvatar).toHaveBeenCalledTimes(3);
    expect(mockDeleteObject).toHaveBeenCalledTimes(3);
  });

  it("returns version 0 when user has no avatar", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ latest: 0 }]),
      }),
    });

    const result = await avatarService.getCurrentAvatar("user-empty");
    expect(result.version).toBe(0);
    expect(result.urls).toEqual({});
  });
});
