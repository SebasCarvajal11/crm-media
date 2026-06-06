import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import { and, eq, sql, inArray } from "drizzle-orm";
import { db } from "../../db/connection";
import { mediaAssets } from "../../db/schema";
import { AppError } from "../../shared/middlewares/error-handler.middleware";
import { detectFileType, imageMimes } from "../../shared/security/file-validation";
import { scanBufferForVirus } from "../../shared/security/clamav";
import { ociStorage } from "../../shared/storage/oci-storage";
import { sanitizeStoredFileName } from "../../shared/sanitize-filename";
import { env } from "../../config/env";

const avatarSizes = [512, 256, 64] as const;

const extractVersionFromAvatarKey = (key: string) => {
  const match = key.match(/\/v(\d+)\//);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
};

const assertBufferIsClean = async (buffer: Buffer) => {
  const isClean = await scanBufferForVirus(buffer);
  if (!isClean) {
    throw new AppError(400, "El archivo fue rechazado por el escaneo antivirus");
  }
};

const cleanupOldAvatarVersions = async (userId: string, currentVersion: number) => {
  const keepFromVersion = Math.max(1, currentVersion - env.AVATAR_VERSIONS_TO_KEEP + 1);
  const prefix = `avatars/${userId}/`;
  const keys = await ociStorage.listObjects(env.OCI_BUCKET_AVATARS_PUBLIC, prefix);
  const staleKeys = keys.filter((key) => {
    const version = extractVersionFromAvatarKey(key);
    return version !== null && version < keepFromVersion;
  });
  for (const key of staleKeys) {
    await ociStorage.deleteObject(env.OCI_BUCKET_AVATARS_PUBLIC, key);
  }
  await db
    .delete(mediaAssets)
    .where(
      and(
        eq(mediaAssets.userId, userId),
        eq(mediaAssets.kind, "avatar"),
        sql`${mediaAssets.avatarVersion} < ${keepFromVersion}`
      )
    );
};

export const avatarService = {
  uploadAvatar: async (userId: string, originalName: string, rawBuffer: Buffer) => {
    const storedOriginalName = sanitizeStoredFileName(originalName);
    const detected = await detectFileType(rawBuffer);
    if (!detected || !imageMimes.has(detected.mime)) throw new AppError(400, "Archivo de imagen invalido");

    await assertBufferIsClean(rawBuffer);

    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId} || 'avatar_upload'))`);

      const latestVersion = await tx
        .select({ latest: sql<number>`coalesce(max(${mediaAssets.avatarVersion}), 0)` })
        .from(mediaAssets)
        .where(and(eq(mediaAssets.userId, userId), eq(mediaAssets.kind, "avatar")));

      const avatarVersion = (latestVersion[0]?.latest ?? 0) + 1;
      const baseId = uuidv4();
      const urls: Record<string, string> = {};

      for (const px of avatarSizes) {
        const processed = await sharp(rawBuffer).resize(px, px, { fit: "cover" }).webp({ quality: 84 }).toBuffer();
        const key = `avatars/${userId}/v${avatarVersion}/${baseId}_${px}.webp`;
        const url = await ociStorage.uploadPublicAvatar(key, processed, "image/webp");
        urls[String(px)] = url;

        await tx.insert(mediaAssets).values({
          userId,
          kind: "avatar",
          avatarVersion,
          width: px,
          bucket: "public",
          objectKey: key,
          originalName: storedOriginalName,
          mimeType: "image/webp",
          sizeBytes: processed.length,
        });
      }

      await cleanupOldAvatarVersions(userId, avatarVersion);
      return { version: avatarVersion, urls };
    });
  },

  getCurrentAvatar: async (userId: string) => {
    const latestVersion = await db
      .select({ latest: sql<number>`coalesce(max(${mediaAssets.avatarVersion}), 0)` })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.userId, userId), eq(mediaAssets.kind, "avatar")));

    const version = latestVersion[0]?.latest ?? 0;
    if (version <= 0) throw new AppError(404, "El usuario no tiene avatar");

    const rows = await db
      .select({ objectKey: mediaAssets.objectKey })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.userId, userId),
          eq(mediaAssets.kind, "avatar"),
          eq(mediaAssets.avatarVersion, version)
        )
      );

    const urls: Record<string, string> = {};
    for (const row of rows) {
      const size = row.objectKey.match(/_(64|256|512)\.webp$/)?.[1] ?? null;
      if (!size) continue;
      urls[size] = await ociStorage.getPublicObjectUrl(env.OCI_BUCKET_AVATARS_PUBLIC, row.objectKey);
    }

    return { version, urls };
  },

  getCurrentAvatarsByUsers: async (userIds: string[]) => {
    const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
    if (uniqueUserIds.length === 0) {
      return { items: {} as Record<string, { version: number; urls: Record<string, string> }> };
    }

    const rows = await db
      .select({
        userId: mediaAssets.userId,
        avatarVersion: mediaAssets.avatarVersion,
        objectKey: mediaAssets.objectKey,
      })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.kind, "avatar"),
          inArray(mediaAssets.userId, uniqueUserIds),
          sql`${mediaAssets.avatarVersion} = (
            SELECT MAX(sub.avatar_version)
            FROM schema_media.media_assets sub
            WHERE sub.user_id = ${mediaAssets.userId}
              AND sub.kind = 'avatar'
          )`
        )
      );

    const latestRows = rows;

    const items: Record<string, { version: number; urls: Record<string, string> }> = {};
    const grouped = new Map<string, typeof latestRows>();
    for (const row of latestRows) {
      const list = grouped.get(row.userId) ?? [];
      list.push(row);
      grouped.set(row.userId, list);
    }

    for (const [userId, userRows] of grouped) {
      const version = userRows[0]?.avatarVersion ?? 0;
      const urls: Record<string, string> = {};
      for (const row of userRows) {
        const size = row.objectKey.match(/_(64|256|512)\.webp$/)?.[1] ?? null;
        if (!size) continue;
        urls[size] = await ociStorage.getPublicObjectUrl(env.OCI_BUCKET_AVATARS_PUBLIC, row.objectKey);
      }
      items[userId] = { version, urls };
    }

    return { items };
  },
};
