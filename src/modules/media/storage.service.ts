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
      db
        .execute(sql`
          SELECT count(*)::int as count, coalesce(sum(size_bytes), 0)::bigint as bytes 
          FROM schema_collab.project_files
          WHERE coalesce(is_purged, false) = false
        `)
        .catch(() => ({ rows: [{ count: 0, bytes: 0 }] })),
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

    const firstCollab = (collabRes as any)?.rows?.[0];
    const projectFilesCount = Number(firstCollab?.count) || 0;
    const projectFilesBytes = Number(firstCollab?.bytes) || 0;

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
