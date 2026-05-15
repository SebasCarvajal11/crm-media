import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/connection";
import { mediaAssets } from "../../db/schema";
import { AppError } from "../../shared/middlewares/error-handler.middleware";
import { detectFileType, imageMimes, isBlockedFileName, isBlockedMime } from "../../shared/security/file-validation";
import { ociStorage } from "../../shared/storage/oci-storage";
import { env } from "../../config/env";

const avatarSizes = [512, 256, 64] as const;

const inferMimeFromFileName = (fileName: string): string | null => {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  if (lower.endsWith(".zip")) return "application/zip";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".xml")) return "application/xml";
  return null;
};

const extractVersionFromAvatarKey = (key: string) => {
  const match = key.match(/\/v(\d+)\//);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
};

const extractSizeFromAvatarKey = (key: string) => {
  const match = key.match(/_(64|256|512)\.webp$/);
  return match?.[1] ?? null;
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
};

export const mediaService = {
  uploadAvatar: async (userId: string, originalName: string, rawBuffer: Buffer) => {
    const detected = await detectFileType(rawBuffer);
    if (!detected || !imageMimes.has(detected.mime)) throw new AppError(400, "Archivo de imagen invalido");

    return db.transaction(async (tx) => {
      // Advisory lock por usuario para evitar TOCTOU en el cálculo de la versión
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
          originalName,
          mimeType: "image/webp",
          sizeBytes: processed.length,
        });
      }

      await cleanupOldAvatarVersions(userId, avatarVersion);
      return { version: avatarVersion, urls };
    });
  },


  /**
   * Paso 1 del flujo pre-signed: genera un PAR de escritura OCI y lo retorna
   * al frontend. El archivo nunca toca el servidor Node.js.
   */
  generateDocumentUploadUrl: async (
    userId: string,
    fileName: string,
    mimeType: string,
    sizeBytes: number,
  ) => {
    if (isBlockedFileName(fileName)) {
      throw new AppError(400, "Tipo de archivo bloqueado por seguridad");
    }
    if (isBlockedMime(mimeType)) {
      throw new AppError(400, "Tipo de archivo bloqueado por seguridad");
    }
    const MAX_BYTES = 25 * 1024 * 1024;
    if (sizeBytes > MAX_BYTES) throw new AppError(413, "Archivo excede 25MB");

    const safeFileName = fileName.replace(/\s+/g, "_");
    const objectKey = `documents/${userId}/${uuidv4()}-${safeFileName}`;
    const uploadUrl = await ociStorage.createUploadPar(
      env.OCI_BUCKET_DOCS_PRIVATE,
      objectKey,
      env.DOC_PAR_TTL_SECONDS,
    );

    return { uploadUrl, objectKey, expiresInSeconds: env.DOC_PAR_TTL_SECONDS };
  },

  /**
   * Paso 2 del flujo pre-signed: el frontend ya subió el archivo a OCI.
   * Verificamos su existencia (HeadObject) y registramos en DB.
   */
  confirmDocumentUpload: async (
    userId: string,
    objectKey: string,
    fileName: string,
    mimeType: string,
    sizeBytes: number,
  ) => {
    // Seguridad: el objectKey debe pertenecer al usuario
    if (!objectKey.startsWith(`documents/${userId}/`)) {
      throw new AppError(403, "El objectKey no pertenece a este usuario");
    }
    if (isBlockedFileName(fileName) || isBlockedMime(mimeType)) {
      throw new AppError(400, "Tipo de archivo bloqueado por seguridad");
    }

    const exists = await ociStorage.verifyObjectExists(env.OCI_BUCKET_DOCS_PRIVATE, objectKey);
    if (!exists) {
      throw new AppError(422, "El archivo aun no llegó a OCI. Reintenta el upload.");
    }

    await db.insert(mediaAssets).values({
      userId,
      kind: "document",
      avatarVersion: null,
      bucket: "private",
      objectKey,
      originalName: fileName,
      mimeType,
      sizeBytes,
    });

    return { objectKey };
  },

  getDocumentAccessUrl: async (objectKey: string, forceDownload = false) => {
    const url = await ociStorage.createPrivateDocumentUrl(objectKey, forceDownload);
    return { url, expiresInSeconds: 300 };
  },
  deleteDocument: async (objectKey: string) => {
    await ociStorage.deleteObject(env.OCI_BUCKET_DOCS_PRIVATE, objectKey);
    return { deleted: true };
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
      const size = extractSizeFromAvatarKey(row.objectKey);
      if (!size) continue;
      urls[size] = await ociStorage.getPublicObjectUrl(env.OCI_BUCKET_AVATARS_PUBLIC, row.objectKey);
    }

    return { version, urls };
  },
  getCurrentAvatarsByUsers: async (userIds: string[]) => {
    const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
    const results = await Promise.all(
      uniqueUserIds.map(async (userId) => {
        try {
          const avatar = await mediaService.getCurrentAvatar(userId);
          return [userId, avatar] as const;
        } catch (error) {
          if (error instanceof AppError && error.status === 404) return null;
          throw error;
        }
      })
    );

    const items: Record<string, { version: number; urls: Record<string, string> }> = {};
    for (const entry of results) {
      if (!entry) continue;
      const [userId, avatar] = entry;
      items[userId] = avatar;
    }
    return { items };
  },
};
