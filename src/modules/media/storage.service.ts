import { statfs } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { db } from "../../db/connection";
import { mediaAssets } from "../../db/schema";

export interface DiskStats {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPercentage: number;
}

export interface AssetStats {
  totalAssetsCount: number;
  totalAssetsBytes: number;
  documentsCount: number;
  documentsBytes: number;
  avatarsCount: number;
  avatarsBytes: number;
}

export interface StorageStats {
  disk: DiskStats;
  assets: AssetStats;
  cachedAt: string;
}

let cachedStats: StorageStats | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 30_000;

export const storageService = {
  async getDiskStats(targetPath = "/"): Promise<DiskStats> {
    try {
      const stats = await statfs(targetPath);
      const bsize = Number(stats.bsize);
      const totalBytes = Number(stats.blocks) * bsize;
      const availableBytes = Number(stats.bavail) * bsize;
      const usedBytes = Math.max(0, totalBytes - availableBytes);
      const usedPercentage = totalBytes > 0
        ? Math.min(100, Math.max(0, Math.round((usedBytes / totalBytes) * 100)))
        : 0;

      return { totalBytes, usedBytes, availableBytes, usedPercentage };
    } catch {
      return { totalBytes: 0, usedBytes: 0, availableBytes: 0, usedPercentage: 0 };
    }
  },

  async getAssetStats(): Promise<AssetStats> {
    const rows = await db
      .select({
        kind: mediaAssets.kind,
        count: sql<number>`count(*)::int`,
        bytes: sql<number>`coalesce(sum(${mediaAssets.sizeBytes}), 0)::bigint`,
      })
      .from(mediaAssets)
      .groupBy(mediaAssets.kind);

    let documentsCount = 0;
    let documentsBytes = 0;
    let avatarsCount = 0;
    let avatarsBytes = 0;

    for (const row of rows) {
      const count = Number(row.count) || 0;
      const bytes = Number(row.bytes) || 0;
      if (row.kind === "document") {
        documentsCount = count;
        documentsBytes = bytes;
      } else if (row.kind === "avatar") {
        avatarsCount = count;
        avatarsBytes = bytes;
      }
    }

    return {
      totalAssetsCount: documentsCount + avatarsCount,
      totalAssetsBytes: documentsBytes + avatarsBytes,
      documentsCount,
      documentsBytes,
      avatarsCount,
      avatarsBytes,
    };
  },

  async getStorageStats(forceRefresh = false): Promise<StorageStats> {
    const now = Date.now();
    if (!forceRefresh && cachedStats && now < cacheExpiresAt) {
      return cachedStats;
    }

    const [disk, assets] = await Promise.all([
      this.getDiskStats(),
      this.getAssetStats(),
    ]);

    cachedStats = {
      disk,
      assets,
      cachedAt: new Date(now).toISOString(),
    };
    cacheExpiresAt = now + CACHE_TTL_MS;

    return cachedStats;
  },

  clearCache(): void {
    cachedStats = null;
    cacheExpiresAt = 0;
  },
};
