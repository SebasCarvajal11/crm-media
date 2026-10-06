import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CIMA_CORPORATE_PALETTE,
  getDeterministicAvatarAssignment,
  generateMigrationPlan,
  migrateUserAvatars,
  type UserRecord,
} from "./migrate-user-avatars";

vi.mock("../modules/media/avatar-preset.service", () => ({
  avatarPresetService: {
    saveAvatarPreset: vi.fn(),
  },
}));

import { avatarPresetService } from "../modules/media/avatar-preset.service";

describe("migrate-user-avatars", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getDeterministicAvatarAssignment", () => {
    it("assigns valid avatar IDs between 0 and 83", () => {
      for (let i = 0; i < 200; i++) {
        const { avatarId } = getDeterministicAvatarAssignment(i);
        expect(avatarId).toBeGreaterThanOrEqual(0);
        expect(avatarId).toBeLessThanOrEqual(83);
      }
    });

    it("assigns valid CIMA corporate palette colors", () => {
      const paletteSet = new Set<string>(CIMA_CORPORATE_PALETTE);
      for (let i = 0; i < 200; i++) {
        const { color } = getDeterministicAvatarAssignment(i);
        expect(paletteSet.has(color)).toBe(true);
      }
    });

    it("assigns 84 distinct avatars to the first 84 users", () => {
      const avatars = new Set<number>();
      for (let i = 0; i < 84; i++) {
        const { avatarId } = getDeterministicAvatarAssignment(i);
        avatars.add(avatarId);
      }
      expect(avatars.size).toBe(84);
    });

    it("guarantees 1,008 unique (avatarId, color) pairs across full cycle", () => {
      const pairs = new Set<string>();
      const totalCombinations = 84 * CIMA_CORPORATE_PALETTE.length;
      for (let i = 0; i < totalCombinations; i++) {
        const { avatarId, color } = getDeterministicAvatarAssignment(i);
        const key = `${avatarId}:${color}`;
        expect(pairs.has(key)).toBe(false);
        pairs.add(key);
      }
      expect(pairs.size).toBe(totalCombinations);
    });

    it("assigns different colors between consecutive users", () => {
      for (let i = 0; i < 50; i++) {
        const u1 = getDeterministicAvatarAssignment(i);
        const u2 = getDeterministicAvatarAssignment(i + 1);
        expect(u1.color).not.toBe(u2.color);
      }
    });
  });

  describe("generateMigrationPlan", () => {
    it("creates plan matching user records", () => {
      const mockUsers: UserRecord[] = [
        { id: "u-1", email: "user1@cima.dev", first_name: "Ana", last_name: "G" },
        { id: "u-2", email: "user2@cima.dev", first_name: "Carlos", last_name: "R" },
      ];

      const plan = generateMigrationPlan(mockUsers);
      expect(plan).toHaveLength(2);
      expect(plan[0].userId).toBe("u-1");
      expect(plan[0].email).toBe("user1@cima.dev");
      expect(plan[1].userId).toBe("u-2");
      expect(plan[1].email).toBe("user2@cima.dev");
      expect(plan[0].avatarId).not.toBe(plan[1].avatarId);
    });
  });

  describe("migrateUserAvatars execution", () => {
    it("supports dryRun without executing mutations", async () => {
      const mockUsers: UserRecord[] = [
        { id: "u-1", email: "user1@cima.dev", first_name: "Ana", last_name: null },
      ];

      const result = await migrateUserAvatars({ dryRun: true, users: mockUsers });
      expect(result.totalMigrated).toBe(1);
      expect(result.failed).toBe(0);
      expect(avatarPresetService.saveAvatarPreset).not.toHaveBeenCalled();
    });

    it("calls saveAvatarPreset for each user in non-dry-run mode", async () => {
      vi.mocked(avatarPresetService.saveAvatarPreset).mockResolvedValue({
        version: 1,
        avatarId: 0,
        color: "#86070c",
        urls: { "512": "url-512", "256": "url-256", "64": "url-64" },
      });

      const mockUsers: UserRecord[] = [
        { id: "u-1", email: "u1@cima.dev", first_name: "A", last_name: "B" },
        { id: "u-2", email: "u2@cima.dev", first_name: "C", last_name: "D" },
      ];

      const result = await migrateUserAvatars({ dryRun: false, users: mockUsers });
      expect(result.totalMigrated).toBe(2);
      expect(result.failed).toBe(0);
      expect(avatarPresetService.saveAvatarPreset).toHaveBeenCalledTimes(2);
    });

    it("handles partial failure without throwing unhandled error", async () => {
      vi.mocked(avatarPresetService.saveAvatarPreset)
        .mockResolvedValueOnce({
          version: 1,
          avatarId: 0,
          color: "#86070c",
          urls: { "512": "url-512", "256": "url-256", "64": "url-64" },
        })
        .mockRejectedValueOnce(new Error("OCI network error"));

      const mockUsers: UserRecord[] = [
        { id: "u-1", email: "u1@cima.dev", first_name: "A", last_name: "B" },
        { id: "u-2", email: "u2@cima.dev", first_name: "C", last_name: "D" },
      ];

      const result = await migrateUserAvatars({ dryRun: false, users: mockUsers });
      expect(result.totalMigrated).toBe(1);
      expect(result.failed).toBe(1);
    });
  });
});
