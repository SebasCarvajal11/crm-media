import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelect = vi.fn();

vi.mock("../../db/connection", () => ({
  db: {
    select: (...args: any[]) => mockSelect(...args),
  },
}));

import { avatarService } from "./avatar.service";

describe("avatarService - consultas de avatares desde user_avatars", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getCurrentAvatar", () => {
    it("returns version 0 when user has no avatar", async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      const result = await avatarService.getCurrentAvatar("user-empty");
      expect(result.version).toBe(0);
      expect(result.avatarId).toBeNull();
      expect(result.color).toBeNull();
      expect(result.urls).toEqual({});
    });

    it("returns active version and mapped urls when user has avatar in user_avatars", async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { avatarId: 7, color: "#86070c" },
          ]),
        }),
      });

      const result = await avatarService.getCurrentAvatar("u1");
      expect(result.version).toBe(1);
      expect(result.avatarId).toBe(7);
      expect(result.color).toBe("#86070c");
      expect(result.urls["64"]).toBe("/avatars/avatar-7.webp?c=86070c");
      expect(result.urls["256"]).toBe("/avatars/avatar-7.webp?c=86070c");
      expect(result.urls["512"]).toBe("/avatars/avatar-7.webp?c=86070c");
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
            { userId: "u1", avatarId: 3, color: "#86070c" },
            { userId: "u2", avatarId: 15, color: "#1e3a8a" },
          ]),
        }),
      });

      const result = await avatarService.getCurrentAvatarsByUsers(["u1", "u2"]);
      expect(result.items["u1"]).toBeDefined();
      expect(result.items["u1"].avatarId).toBe(3);
      expect(result.items["u1"].color).toBe("#86070c");
      expect(result.items["u1"].urls["64"]).toBe("/avatars/avatar-3.webp?c=86070c");

      expect(result.items["u2"]).toBeDefined();
      expect(result.items["u2"].avatarId).toBe(15);
      expect(result.items["u2"].color).toBe("#1e3a8a");
      expect(result.items["u2"].urls["256"]).toBe("/avatars/avatar-15.webp?c=1e3a8a");
    });
  });
});
