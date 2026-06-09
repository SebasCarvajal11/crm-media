import { and, eq } from "drizzle-orm";
import { db } from "../../db/connection";
import { mediaAssets } from "../../db/schema";
import { AppError } from "../../shared/middlewares/error-handler.middleware";
import { getLogger } from "../../shared/logger";
import { isBlockedFileName, isBlockedMime } from "../../shared/security/file-validation";
import { ociStorage } from "../../shared/storage/oci-storage";
import { sanitizeFileNameForObjectKey, sanitizeStoredFileName } from "../../shared/sanitize-filename";
import { env } from "../../config/env";
import { v4 as uuidv4 } from "uuid";
import { scanBufferForVirus } from "../../shared/security/clamav";

const logger = getLogger();

export type DocumentAccessActor = {
  userId: string;
  sub: string;
  role: string;
  email: string;
};

const tryPromoteFromQuarantine = async (objectKey: string): Promise<boolean> => {
  const quarantineKey = `quarantine/${objectKey}`;
  const bucket = env.OCI_BUCKET_DOCS_PRIVATE;
  if (!(await ociStorage.verifyObjectExists(bucket, quarantineKey))) {
    return false;
  }
  try {
    const buffer = await ociStorage.getObjectBuffer(bucket, quarantineKey);
    const isClean = await scanBufferForVirus(buffer);
    if (!isClean) {
      await ociStorage.deleteObject(bucket, quarantineKey);
      throw new AppError(400, "El archivo fue rechazado por la validación antivirus.");
    }
    const meta = await ociStorage.getObjectMetadata(bucket, quarantineKey);
    const mimeType = meta?.mimeType ?? "application/octet-stream";
    await ociStorage.uploadPrivateDocument(objectKey, buffer, mimeType);
    await ociStorage.deleteObject(bucket, quarantineKey);
    return true;
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error({ err: error, objectKey, topic: "document.service" }, "Error promoviendo desde cuarentena");
    return false;
  }
};

function assertCollabObjectKey(objectKey: string): void {
  if (!objectKey.startsWith("projects/")) {
    throw new AppError(403, "El objectKey no pertenece a archivos de colaboracion");
  }
}

async function deleteIfExists(bucket: string, objectKey: string): Promise<void> {
  if (await ociStorage.verifyObjectExists(bucket, objectKey)) {
    await ociStorage.deleteObject(bucket, objectKey);
  }
}

export const documentService = {
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
    const quarantineKey = `quarantine/${objectKey}`;
    const uploadUrl = await ociStorage.createUploadPar(
      env.OCI_BUCKET_DOCS_PRIVATE,
      quarantineKey,
      env.DOC_PAR_TTL_SECONDS,
    );

    return { uploadUrl, objectKey, expiresInSeconds: env.DOC_PAR_TTL_SECONDS };
  },

  generateDocumentUploadUrlForCollabCommand: async (
    objectKey: string,
    fileName: string,
    mimeType: string,
    sizeBytes: number,
  ) => {
    assertCollabObjectKey(objectKey);
    const storedFileName = sanitizeStoredFileName(fileName);
    if (isBlockedFileName(storedFileName) || isBlockedMime(mimeType)) {
      throw new AppError(400, "Tipo de archivo bloqueado por seguridad");
    }
    const MAX_BYTES = 25 * 1024 * 1024;
    if (sizeBytes > MAX_BYTES) throw new AppError(413, "Archivo excede 25MB");

    const quarantineKey = `quarantine/${objectKey}`;
    const uploadUrl = await ociStorage.createUploadPar(
      env.OCI_BUCKET_DOCS_PRIVATE,
      quarantineKey,
      env.DOC_PAR_TTL_SECONDS,
    );

    return { uploadUrl, objectKey, expiresInSeconds: env.DOC_PAR_TTL_SECONDS };
  },

  resolveDocumentMetadataForCollabCommand: async (
    objectKey: string,
    fileName: string,
    mimeType: string,
    sizeBytes: number,
  ) => {
    assertCollabObjectKey(objectKey);
    const storedFileName = sanitizeStoredFileName(fileName);
    if (isBlockedFileName(storedFileName) || isBlockedMime(mimeType)) {
      throw new AppError(400, "Tipo de archivo bloqueado por seguridad");
    }

    let meta = await ociStorage.getObjectMetadata(env.OCI_BUCKET_DOCS_PRIVATE, objectKey);
    if (!meta) {
      const promoted = await tryPromoteFromQuarantine(objectKey);
      if (promoted) {
        meta = await ociStorage.getObjectMetadata(env.OCI_BUCKET_DOCS_PRIVATE, objectKey);
      }
    }

    if (!meta) {
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        meta = await ociStorage.getObjectMetadata(env.OCI_BUCKET_DOCS_PRIVATE, objectKey);
        if (meta) break;

        const promoted = await tryPromoteFromQuarantine(objectKey);
        if (promoted) {
          meta = await ociStorage.getObjectMetadata(env.OCI_BUCKET_DOCS_PRIVATE, objectKey);
          if (meta) break;
        }
      }
    }

    if (!meta) {
      const quarantineKey = `quarantine/${objectKey}`;
      const inQuarantine = await ociStorage.verifyObjectExists(env.OCI_BUCKET_DOCS_PRIVATE, quarantineKey);
      if (inQuarantine) {
        throw new AppError(422, "El archivo sigue en validacion antivirus y aun no pasa a produccion. Reintente en unos segundos.");
      }
      throw new AppError(422, "El archivo subido aun no esta disponible para registro. Reintente en unos segundos.");
    }

    if (meta.sizeBytes !== sizeBytes) {
      throw new AppError(400, "El tamano del archivo no coincide con el declarado");
    }

    return meta;
  },

  confirmDocumentUpload: async (
    actor: { userId: string; sub: string; role: string; email: string },
    objectKey: string,
    fileName: string,
    mimeType: string,
    sizeBytes: number,
    ipAddress?: string,
    userAgent?: string,
  ) => {
    if (!objectKey.startsWith(`documents/${actor.userId}/`)) {
      throw new AppError(403, "El objectKey no pertenece a este usuario");
    }
    const storedFileName = sanitizeStoredFileName(fileName);
    if (isBlockedFileName(storedFileName) || isBlockedMime(mimeType)) {
      throw new AppError(400, "Tipo de archivo bloqueado por seguridad");
    }

    let exists = await ociStorage.verifyObjectExists(env.OCI_BUCKET_DOCS_PRIVATE, objectKey);
    if (!exists) {
      const promoted = await tryPromoteFromQuarantine(objectKey);
      if (promoted) {
        exists = true;
      }
    }

    if (!exists) {
      const maxWait = 4000;
      const poll = 500;
      const deadline = Date.now() + maxWait;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, poll));
        exists = await ociStorage.verifyObjectExists(env.OCI_BUCKET_DOCS_PRIVATE, objectKey);
        if (exists) break;

        const promoted = await tryPromoteFromQuarantine(objectKey);
        if (promoted) {
          exists = true;
          break;
        }
      }
    }

    if (!exists) {
      const quarantineKey = `quarantine/${objectKey}`;
      const inQuarantine = await ociStorage.verifyObjectExists(env.OCI_BUCKET_DOCS_PRIVATE, quarantineKey);
      if (inQuarantine) {
        throw new AppError(422, "El archivo sigue en validacion antivirus y aun no pasa a produccion. Reintente en unos segundos.");
      }
      throw new AppError(422, "El archivo subido aun no esta disponible para registro. Reintente en unos segundos.");
    }

    const meta = await ociStorage.getObjectMetadata(env.OCI_BUCKET_DOCS_PRIVATE, objectKey);
    if (!meta) {
      throw new AppError(422, "No se pudo leer metadata del archivo en producción");
    }

    if (meta.sizeBytes !== sizeBytes) {
      throw new AppError(400, "El tamaño del archivo no coincide con el declarado");
    }

    await db.insert(mediaAssets).values({
      userId: actor.userId,
      kind: "document",
      avatarVersion: null,
      bucket: "private",
      objectKey,
      originalName: storedFileName,
      mimeType,
      sizeBytes: meta.sizeBytes,
    });

    const { createAuditRepository } = await import("./repository/audit.repository");
    await createAuditRepository(db).createAuditLog({
      actorSub: actor.sub,
      actorEmail: actor.email,
      actorRole: actor.role as any,
      action: "file.uploaded",
      resourceType: "file",
      resourceId: objectKey,
      ipAddress: ipAddress || "",
      userAgent: userAgent || "",
      details: { originalName: storedFileName, mimeType, sizeBytes: meta.sizeBytes },
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

    const isOwner = asset && (asset.userId === actor.userId || asset.userId === actor.sub);
    const ownsPathPrefix =
      objectKey.startsWith(`documents/${actor.userId}/`) ||
      objectKey.startsWith(`documents/${actor.sub}/`);

    const allowed = Boolean(isOwner || (!asset && ownsPathPrefix));

    if (!allowed) {
      throw new AppError(403, "No autorizado para acceder a este documento");
    }

    const url = await ociStorage.createPrivateDocumentUrl(objectKey, forceDownload);
    return { url, expiresInSeconds: 300 };
  },

  getDocumentAccessUrlForCollabCommand: async (
    objectKey: string,
    forceDownload = false,
  ) => {
    const exists = await ociStorage.verifyObjectExists(env.OCI_BUCKET_DOCS_PRIVATE, objectKey);
    if (!exists) {
      throw new AppError(404, "Documento no encontrado");
    }

    const url = await ociStorage.createPrivateDocumentUrl(objectKey, forceDownload);
    return { url, expiresInSeconds: 300 };
  },

  deleteDocumentForCollabCommand: async (
    objectKey: string,
    actor?: { userId: string; sub: string; role: string; email: string }
  ) => {
    assertCollabObjectKey(objectKey);
    const [asset] = await db
      .select({ id: mediaAssets.id, originalName: mediaAssets.originalName })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.objectKey, objectKey), eq(mediaAssets.kind, "document")))
      .limit(1);

    const exists = await ociStorage.verifyObjectExists(env.OCI_BUCKET_DOCS_PRIVATE, objectKey);
    const quarantineKey = `quarantine/${objectKey}`;
    const existsInQuarantine = await ociStorage.verifyObjectExists(env.OCI_BUCKET_DOCS_PRIVATE, quarantineKey);
    if (!asset && !exists && !existsInQuarantine) {
      throw new AppError(404, "Documento no encontrado");
    }

    await deleteIfExists(env.OCI_BUCKET_DOCS_PRIVATE, objectKey);
    await deleteIfExists(env.OCI_BUCKET_DOCS_PRIVATE, quarantineKey);
    if (asset) {
      await db.delete(mediaAssets).where(eq(mediaAssets.id, asset.id));
    }

    if (actor) {
      const { createAuditRepository } = await import("./repository/audit.repository");
      await createAuditRepository(db).createAuditLog({
        actorSub: actor.sub,
        actorEmail: actor.email,
        actorRole: actor.role as any,
        action: "file.deleted",
        resourceType: "file",
        resourceId: objectKey,
        ipAddress: "",
        userAgent: "",
        details: { originalName: asset?.originalName || objectKey, trigger: "collab_command" },
      });
    }

    return { deleted: true };
  },

  deleteDocument: async (
    actor: { userId: string; sub: string; role: string; email: string },
    objectKey: string,
    ipAddress?: string,
    userAgent?: string,
  ) => {
    const [asset] = await db
      .select({ id: mediaAssets.id, userId: mediaAssets.userId, originalName: mediaAssets.originalName })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.objectKey, objectKey), eq(mediaAssets.kind, "document")))
      .limit(1);

    if (!asset) {
      throw new AppError(404, "Documento no encontrado");
    }
    
    const isOwner = asset.userId === actor.userId || asset.userId === actor.sub;
    const isAdmin = actor.role === "admin";
    const allowed = isOwner || isAdmin;

    if (!allowed) {
      throw new AppError(403, "No autorizado para eliminar este documento");
    }

    await ociStorage.deleteObject(env.OCI_BUCKET_DOCS_PRIVATE, objectKey);
    await db.delete(mediaAssets).where(eq(mediaAssets.id, asset.id));

    const { createAuditRepository } = await import("./repository/audit.repository");
    await createAuditRepository(db).createAuditLog({
      actorSub: actor.sub,
      actorEmail: actor.email,
      actorRole: actor.role as any,
      action: "file.deleted",
      resourceType: "file",
      resourceId: objectKey,
      ipAddress: ipAddress || "",
      userAgent: userAgent || "",
      details: { originalName: asset.originalName },
    });

    return { deleted: true };
  },

  anonymizeUserPII: async (userSub: string) => {
    const assets = await db
      .select({ id: mediaAssets.id, bucket: mediaAssets.bucket, objectKey: mediaAssets.objectKey })
      .from(mediaAssets)
      .where(eq(mediaAssets.userId, userSub));

    for (const asset of assets) {
      try {
        const bucketName =
          asset.bucket === "public"
            ? env.OCI_BUCKET_AVATARS_PUBLIC
            : env.OCI_BUCKET_DOCS_PRIVATE;
        await ociStorage.deleteObject(bucketName, asset.objectKey);
      } catch (err) {
        logger.error({ err, assetId: asset.id, objectKey: asset.objectKey }, "Error deleting object from OCI during PII clean");
      }
    }

    if (assets.length > 0) {
      await db.delete(mediaAssets).where(eq(mediaAssets.userId, userSub));
    }

    const { auditLogs } = await import("../../db/schema");
    const anonEmail = `anon-${userSub}@cima.internal`;
    await db
      .update(auditLogs)
      .set({ actorEmail: anonEmail })
      .where(eq(auditLogs.actorSub, userSub));

    logger.info({ userSub }, "[documentService] PII cleanup complete for crm-media");
  },
};
