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

vi.mock("sharp", () => {
  return {
    default: vi.fn().mockReturnValue({
      resize: vi.fn().mockReturnThis(),
      composite: vi.fn().mockReturnThis(),
      webp: vi.fn().mockReturnThis(),
      metadata: vi.fn().mockResolvedValue({ width: 400, height: 500 }),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from("fake-composite-webp-bytes")),
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

import { avatarPresetService, resolveAvatarPresetPath } from "./avatar-preset.service";
import { mediaController } from "./media.controller";

describe("avatarPresetService & 410 Deprecation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid avatarId < 0 or > 83 with AppError 400", () => {
    expect(() => resolveAvatarPresetPath(-1)).toThrow(AppError);
    expect(() => resolveAvatarPresetPath(84)).toThrow(AppError);
  });

  it("resolves valid preset path for avatar 0", () => {
    const p = resolveAvatarPresetPath(0);
    expect(p).toContain("avatar-0.png");
  });

  it("composes preset and uploads variants to OCI", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ latest: 0 }]),
      }),
    });

    const mockTx = {
      execute: mockExecute.mockResolvedValue(undefined),
      insert: vi.fn().mockReturnValue({
        values: mockInsert.mockResolvedValue(undefined),
      }),
    };
    mockTransaction.mockImplementation(async (callback: any) => callback(mockTx));

    const result = await avatarPresetService.saveAvatarPreset("user-456", {
      avatarId: 10,
      color: "#86070c",
    });

    expect(result.version).toBe(1);
    expect(mockUploadPublicAvatar).toHaveBeenCalledTimes(3);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("triggers compensatory rollback purging OCI objects if SQL transaction fails during preset saving", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ latest: 0 }]),
      }),
    });

    mockTransaction.mockRejectedValue(new Error("Database connection severed"));

    await expect(
      avatarPresetService.saveAvatarPreset("user-err", {
        avatarId: 10,
        color: "#86070c",
      })
    ).rejects.toThrow("Database connection severed");

    expect(mockUploadPublicAvatar).toHaveBeenCalledTimes(3);
    expect(mockDeleteObject).toHaveBeenCalledTimes(3);
  });

  it("mediaController.uploadAvatar returns 410 Gone (manual upload deprecated)", async () => {
    await expect(mediaController.uploadAvatar(new Request("http://localhost"), {})).rejects.toMatchObject({
      statusCode: 410,
    });
  });
});
