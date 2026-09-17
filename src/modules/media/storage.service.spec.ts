import { describe, it, expect, vi, beforeEach } from "vitest";
import { storageService } from "./storage.service";

describe("storageService", () => {
  beforeEach(() => {
    storageService.clearCache();
    vi.restoreAllMocks();
  });

  it("calculates disk stats correctly", async () => {
    const disk = await storageService.getDiskStats();
    expect(disk).toBeDefined();
    expect(typeof disk.totalBytes).toBe("number");
    expect(typeof disk.usedBytes).toBe("number");
    expect(typeof disk.availableBytes).toBe("number");
    expect(typeof disk.usedPercentage).toBe("number");
    expect(disk.usedPercentage).toBeGreaterThanOrEqual(0);
    expect(disk.usedPercentage).toBeLessThanOrEqual(100);
  });

  it("caches getStorageStats results", async () => {
    vi.spyOn(storageService, "getAssetStats").mockResolvedValue({
      totalAssetsCount: 5,
      totalAssetsBytes: 1024,
      documentsCount: 3,
      documentsBytes: 800,
      avatarsCount: 2,
      avatarsBytes: 224,
    });

    const first = await storageService.getStorageStats();
    const second = await storageService.getStorageStats();

    expect(first.cachedAt).toBe(second.cachedAt);
    expect(first.assets.totalAssetsCount).toBe(5);

    storageService.clearCache();
    const third = await storageService.getStorageStats(true);
    expect(third).toBeDefined();
  });
});
