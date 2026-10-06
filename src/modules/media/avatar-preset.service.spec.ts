import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "../../shared/middlewares/error-handler.middleware";

const mockInsert = vi.fn();
const mockDelete = vi.fn();

vi.mock("../../db/connection", () => ({
  db: {
    insert: (...args: any[]) => mockInsert(...args),
    delete: (...args: any[]) => mockDelete(...args),
  },
}));

import { avatarPresetService, buildAvatarUrls } from "./avatar-preset.service";
import { mediaController } from "./media.controller";

describe("avatarPresetService & 410 Deprecation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("buildAvatarUrls generates correct 64/256/512 static webp urls with query param color", () => {
    const urls = buildAvatarUrls(5, "#86070c");
    expect(urls["64"]).toBe("/avatars/avatar-5.webp?c=86070c");
    expect(urls["256"]).toBe("/avatars/avatar-5.webp?c=86070c");
    expect(urls["512"]).toBe("/avatars/avatar-5.webp?c=86070c");
  });

  it("rejects invalid avatarId < 0 or > 83 with AppError 400", async () => {
    await expect(avatarPresetService.saveAvatarPreset("u1", { avatarId: -1, color: "#86070c" })).rejects.toThrow(AppError);
    await expect(avatarPresetService.saveAvatarPreset("u1", { avatarId: 84, color: "#86070c" })).rejects.toThrow(AppError);
  });

  it("rejects invalid hex color with AppError 400", async () => {
    await expect(avatarPresetService.saveAvatarPreset("u1", { avatarId: 5, color: "red" })).rejects.toThrow(AppError);
  });

  it("persists preset to userAvatars, purges residual mediaAssets, and returns metadata", async () => {
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    });
    mockDelete.mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });

    const result = await avatarPresetService.saveAvatarPreset("u123", {
      avatarId: 10,
      color: "#86070c",
    });

    expect(result.avatarId).toBe(10);
    expect(result.color).toBe("#86070c");
    expect(result.version).toBe(1);
    expect(result.urls["64"]).toBe("/avatars/avatar-10.webp?c=86070c");
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it("mediaController.uploadAvatar returns 410 Gone (manual upload deprecated)", async () => {
    await expect(mediaController.uploadAvatar(new Request("http://localhost"), {})).rejects.toMatchObject({
      statusCode: 410,
    });
  });
});
