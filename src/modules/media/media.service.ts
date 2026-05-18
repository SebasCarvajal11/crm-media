import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/connection";
import { mediaAssets } from "../../db/schema";
import { AppError } from "../../shared/middlewares/error-handler.middleware";
import {
  assertDeclaredMimeMatchesBuffer,
  detectFileType,
  imageMimes,
  isBlockedFileName,
  isBlockedMime,
} from "../../shared/security/file-validation";
import { scanBufferForVirus } from "../../shared/security/clamav";
import { assertCollabStorageAccess, type DocumentAccessActor } from "../../shared/collab-access-client";
import { ociStorage } from "../../shared/storage/oci-storage";
import { sanitizeFileNameForObjectKey, sanitizeStoredFileName } from "../../shared/sanitize-filename";
import { env } from "../../config/env";

const avatarSizes = [512, 256, 64] as const;

const extractVersionFromAvatarKey = (key: string) => {
  const match = key.match(/\/v(\d+)\//);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
};

const extractSizeFromAvatarKey = (key: string) => {
  const match = key.match(/_(64|256|512)\.webp$/);
  return match?.[1] ?? null;
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
};

export const mediaService = {
  uploadAvatar: async (userId: string, originalName: string, rawBuffer: Buffer) => {
    const storedOriginalName = sanitizeStoredFileName(originalName);
    const detected = await detectFileType(rawBuffer);
    if (!detected || !imageMimes.has(detected.mime)) throw new AppError(400, "Archivo de imagen invalido");

    await assertBufferIsClean(rawBuffer);

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
          originalName: storedOriginalName,
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
    const storedFileName = sanitizeStoredFileName(fileName);
    if (isBlockedFileName(storedFileName)) {
      throw new AppError(400, "Tipo de archivo bloqueado por seguridad");
    }
    if (isBlockedMime(mimeType)) {
      throw new AppError(400, "Tipo de archivo bloqueado por seguridad");
    }
    const MAX_BYTES = 25 * 1024 * 1024;
    if (sizeBytes > MAX_BYTES) throw new AppError(413, "Archivo excede 25MB");

    const safeFileName = sanitizeFileNameForObjectKey(storedFileName);
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
    const storedFileName = sanitizeStoredFileName(fileName);
    if (isBlockedFileName(storedFileName) || isBlockedMime(mimeType)) {
      throw new AppError(400, "Tipo de archivo bloqueado por seguridad");
    }

    const exists = await ociStorage.verifyObjectExists(env.OCI_BUCKET_DOCS_PRIVATE, objectKey);
    if (!exists) {
      throw new AppError(422, "El archivo aun no llegó a OCI. Reintenta el upload.");
    }

    const objectBuffer = await ociStorage.getObjectBuffer(
      env.OCI_BUCKET_DOCS_PRIVATE,
      objectKey,
    );
    try {
      await assertBufferIsClean(objectBuffer);
      await assertDeclaredMimeMatchesBuffer(mimeType, storedFileName, objectBuffer);
    } catch (err) {
      await ociStorage.deleteObject(env.OCI_BUCKET_DOCS_PRIVATE, objectKey);
      if (err instanceof AppError) throw err;
      throw new AppError(
        400,
        err instanceof Error ? err.message : "El archivo no coincide con el tipo declarado",
      );
    }

    if (objectBuffer.length !== sizeBytes) {
      await ociStorage.deleteObject(env.OCI_BUCKET_DOCS_PRIVATE, objectKey);
      throw new AppError(400, "El tamaño del archivo no coincide con el declarado");
    }

    const storedMime = mimeType;

    await db.insert(mediaAssets).values({
      userId,
      kind: "document",
      avatarVersion: null,
      bucket: "private",
      objectKey,
      originalName: storedFileName,
      mimeType: storedMime,
      sizeBytes: objectBuffer.length,
    });

    return { objectKey };
  },

  getDocumentAccessUrl: async (
    actor: DocumentAccessActor,
    objectKey: string,
    forceDownload = false,
  ) => {
    const [asset] = await db
      .select({ userId: mediaAssets.userId })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.objectKey, objectKey), eq(mediaAssets.kind, "document")))
      .limit(1);

    const isOwner =
      asset &&
      (asset.userId === actor.userId || asset.userId === actor.sub);
    const ownsPathPrefix =
      objectKey.startsWith(`documents/${actor.userId}/`) ||
      objectKey.startsWith(`documents/${actor.sub}/`);

    let allowed = Boolean(isOwner || (!asset && ownsPathPrefix));

    if (!allowed) {
      allowed = await assertCollabStorageAccess(actor, objectKey);
    }

    if (!allowed) {
      throw new AppError(403, "No autorizado para acceder a este documento");
    }

    const url = await ociStorage.createPrivateDocumentUrl(objectKey, forceDownload);
    return { url, expiresInSeconds: 300 };
  },
  deleteDocument: async (userId: string, objectKey: string) => {
    const [asset] = await db
      .select({ id: mediaAssets.id, userId: mediaAssets.userId })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.objectKey, objectKey), eq(mediaAssets.kind, "document")))
      .limit(1);

    if (!asset) {
      throw new AppError(404, "Documento no encontrado");
    }
    if (asset.userId !== userId) {
      throw new AppError(403, "No autorizado para eliminar este documento");
    }

    await ociStorage.deleteObject(env.OCI_BUCKET_DOCS_PRIVATE, objectKey);
    await db.delete(mediaAssets).where(eq(mediaAssets.id, asset.id));
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
      .where(and(eq(mediaAssets.kind, "avatar"), inArray(mediaAssets.userId, uniqueUserIds)));

    const maxVersionByUser = new Map<string, number>();
    for (const row of rows) {
      const version = row.avatarVersion ?? 0;
      const prev = maxVersionByUser.get(row.userId) ?? 0;
      if (version > prev) maxVersionByUser.set(row.userId, version);
    }

    const latestRows = rows.filter((row) => {
      const max = maxVersionByUser.get(row.userId) ?? 0;
      return max > 0 && row.avatarVersion === max;
    });

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
        const size = extractSizeFromAvatarKey(row.objectKey);
        if (!size) continue;
        urls[size] = await ociStorage.getPublicObjectUrl(
          env.OCI_BUCKET_AVATARS_PUBLIC,
          row.objectKey,
        );
      }
      items[userId] = { version, urls };
    }

    return { items };
  },
};
