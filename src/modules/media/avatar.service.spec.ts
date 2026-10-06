import { describe, it, expect, vi, beforeEach } from "vitest";

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
      webp: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from("fake-webp-image-bytes")),
    }),
  };
});

const mockSelect = vi.fn();
const mockDelete = vi.fn();
const mockTransaction = vi.fn();

vi.mock("../../db/connection", () => ({
  db: {
    select: (...args: any[]) => mockSelect(...args),
    delete: (...args: any[]) => mockDelete(...args),
    transaction: (...args: any[]) => mockTransaction(...args),
  },
}));

import {
  avatarService,
  processAvatarVariants,
  uploadVariantsToOci,
} from "./avatar.service";

describe("avatarService - consultas de avatares y procesamiento de variantes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getCurrentAvatar", () => {
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

    it("returns active version and mapped urls when user has avatar", async () => {
      mockSelect
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ latest: 3 }]),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { objectKey: "avatars/u1/v3/uuid_64.webp" },
              { objectKey: "avatars/u1/v3/uuid_256.webp" },
              { objectKey: "avatars/u1/v3/uuid_512.webp" },
            ]),
          }),
        });

      const result = await avatarService.getCurrentAvatar("u1");
      expect(result.version).toBe(3);
      expect(result.urls["64"]).toBe("https://cdn.cima.dev/avatars/u1/v3/uuid_64.webp");
      expect(result.urls["256"]).toBe("https://cdn.cima.dev/avatars/u1/v3/uuid_256.webp");
      expect(result.urls["512"]).toBe("https://cdn.cima.dev/avatars/u1/v3/uuid_512.webp");
    });
  });

  describe("getCurrentAvatarsByUsers", () => {
    it("returns empty items when given empty userIds", async () => {
      const result = await avatarService.getCurrentAvatarsByUsers([]);
      expect(result).toEqual({ items: {} });
    });

    it("returns avatars grouped by userId for multiple users", async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { userId: "u1", avatarVersion: 2, objectKey: "avatars/u1/v2/a_64.webp" },
            { userId: "u1", avatarVersion: 2, objectKey: "avatars/u1/v2/a_512.webp" },
            { userId: "u2", avatarVersion: 1, objectKey: "avatars/u2/v1/b_256.webp" },
          ]),
        }),
      });

      const result = await avatarService.getCurrentAvatarsByUsers(["u1", "u2"]);
      expect(result.items["u1"]).toBeDefined();
      expect(result.items["u1"].version).toBe(2);
      expect(result.items["u1"].urls["64"]).toBe("https://cdn.cima.dev/avatars/u1/v2/a_64.webp");
      expect(result.items["u1"].urls["512"]).toBe("https://cdn.cima.dev/avatars/u1/v2/a_512.webp");

      expect(result.items["u2"]).toBeDefined();
      expect(result.items["u2"].version).toBe(1);
      expect(result.items["u2"].urls["256"]).toBe("https://cdn.cima.dev/avatars/u2/v1/b_256.webp");
    });
  });

  describe("variant processing helpers", () => {
    it("processes 3 variants with correct dimensions and keys", async () => {
      const variants = await processAvatarVariants(
        Buffer.from("raw-bytes"),
        "user-1",
        2,
        "uuid-base"
      );
      expect(variants).toHaveLength(3);
      expect(variants.map((v) => v.px)).toEqual([512, 256, 64]);
      expect(variants[0].key).toBe("avatars/user-1/v2/uuid-base_512.webp");
    });

    it("uploads variants to OCI and returns mapped urls", async () => {
      const variants = [
        { px: 512, buffer: Buffer.from("v512"), key: "key_512.webp" },
        { px: 64, buffer: Buffer.from("v64"), key: "key_64.webp" },
      ];
      const res = await uploadVariantsToOci(variants);
      expect(mockUploadPublicAvatar).toHaveBeenCalledTimes(2);
      expect(res.urls["512"]).toBe("https://cdn.cima.dev/key_512.webp");
      expect(res.urls["64"]).toBe("https://cdn.cima.dev/key_64.webp");
    });
  });
});
