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

  it("calculates and caches getStorageStats results with cloudStorage", async () => {
    vi.spyOn(storageService, "getCloudStorageStats").mockResolvedValue({
      quotaBytes: 10 * 1024 * 1024 * 1024,
      usedBytes: 5 * 1024 * 1024,
      availableBytes: 10 * 1024 * 1024 * 1024 - 5 * 1024 * 1024,
      usedPercentage: 0.05,
      totalFilesCount: 25,
      projectFilesCount: 16,
      projectFilesBytes: 4 * 1024 * 1024,
      avatarsCount: 9,
      avatarsBytes: 1 * 1024 * 1024,
      documentsCount: 0,
      documentsBytes: 0,
    });

    const first = await storageService.getStorageStats();
    const second = await storageService.getStorageStats();

    expect(first.cachedAt).toBe(second.cachedAt);
    expect(first.cloudStorage.totalFilesCount).toBe(25);
    expect(first.cloudStorage.projectFilesCount).toBe(16);
    expect(first.assets.totalAssetsCount).toBe(25);

    storageService.clearCache();
    const third = await storageService.getStorageStats(true);
    expect(third).toBeDefined();
    expect(third.cloudStorage.quotaBytes).toBe(10 * 1024 * 1024 * 1024);
  });
});
