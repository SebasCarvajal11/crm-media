import { statfs } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { db } from "../../db/connection";
import { mediaAssets } from "../../db/schema";
import { env } from "../../config/env";

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

export interface CloudStorageStats {
  quotaBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPercentage: number;
  totalFilesCount: number;
  projectFilesCount: number;
  projectFilesBytes: number;
  avatarsCount: number;
  avatarsBytes: number;
  documentsCount: number;
  documentsBytes: number;
}

export interface StorageStats {
  cloudStorage: CloudStorageStats;
  disk: DiskStats;
  assets: AssetStats;
  cachedAt: string;
}

let cachedStats: StorageStats | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 30_000;
const DEFAULT_OCI_QUOTA_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB (Oracle Cloud Always Free)

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

  async getCloudStorageStats(): Promise<CloudStorageStats> {
    const quotaBytes = Number(process.env.OCI_OBJECT_STORAGE_QUOTA_BYTES) || DEFAULT_OCI_QUOTA_BYTES;

    const fetchCollabMetrics = async (): Promise<{ count: number; bytes: number }> => {
      try {
        const collabBase = (env.COLLAB_SERVICE_URL || "http://crm-collab:3001").replace(/\/$/, "");
        const res = await fetch(`${collabBase}/api/v1/internal/storage/metrics`, {
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          const data = (await res.json()) as { count?: number; bytes?: number };
          return {
            count: Number(data?.count) || 0,
            bytes: Number(data?.bytes) || 0,
          };
        }
      } catch {
        // Fallback defensivo si collab no está accesible
      }
      return { count: 0, bytes: 0 };
    };

    const [mediaRows, collabRes] = await Promise.all([
      db
        .select({
          kind: mediaAssets.kind,
          count: sql<number>`count(*)::int`,
          bytes: sql<number>`coalesce(sum(${mediaAssets.sizeBytes}), 0)::bigint`,
        })
        .from(mediaAssets)
        .groupBy(mediaAssets.kind)
        .catch(() => []),
      fetchCollabMetrics(),
    ]);

    let documentsCount = 0;
    let documentsBytes = 0;
    let avatarsCount = 0;
    let avatarsBytes = 0;

    for (const row of mediaRows) {
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

    const projectFilesCount = Number(collabRes.count) || 0;
    const projectFilesBytes = Number(collabRes.bytes) || 0;

    const usedBytes = documentsBytes + avatarsBytes + projectFilesBytes;
    const availableBytes = Math.max(0, quotaBytes - usedBytes);
    const usedPercentage = quotaBytes > 0
      ? Number(((usedBytes / quotaBytes) * 100).toFixed(2))
      : 0;

    return {
      quotaBytes,
      usedBytes,
      availableBytes,
      usedPercentage,
      totalFilesCount: documentsCount + avatarsCount + projectFilesCount,
      projectFilesCount,
      projectFilesBytes,
      avatarsCount,
      avatarsBytes,
      documentsCount,
      documentsBytes,
    };
  },

  async getStorageStats(forceRefresh = false): Promise<StorageStats> {
    const now = Date.now();
    if (!forceRefresh && cachedStats && now < cacheExpiresAt) {
      return cachedStats;
    }

    const [disk, cloudStorage] = await Promise.all([
      this.getDiskStats(),
      this.getCloudStorageStats(),
    ]);

    const assets: AssetStats = {
      totalAssetsCount: cloudStorage.totalFilesCount,
      totalAssetsBytes: cloudStorage.usedBytes,
      documentsCount: cloudStorage.documentsCount + cloudStorage.projectFilesCount,
      documentsBytes: cloudStorage.documentsBytes + cloudStorage.projectFilesBytes,
      avatarsCount: cloudStorage.avatarsCount,
      avatarsBytes: cloudStorage.avatarsBytes,
    };

    cachedStats = {
      cloudStorage,
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
