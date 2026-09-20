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
import { collabDocumentService, tryPromoteFromQuarantine } from "./collab-document.service";

const logger = getLogger();

export type DocumentAccessActor = {
  userId: string;
  sub: string;
  role: string;
  email: string;
};

export type ConfirmDocumentUploadPayload = {
  objectKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export type RequestMeta = {
  ipAddress?: string;
  userAgent?: string;
};

export const documentService = {
  generateDocumentUploadUrl: async (
    userId: string,
    fileName: string,
    mimeType: string,
    sizeBytes: number,
  ) => {
    const storedFileName = sanitizeStoredFileName(fileName);
    if (isBlockedFileName(storedFileName) || isBlockedMime(mimeType)) {
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

  confirmDocumentUpload: async (
    actor: DocumentAccessActor,
    payload: ConfirmDocumentUploadPayload,
    meta?: RequestMeta,
  ) => {
    const { objectKey, fileName, mimeType, sizeBytes } = payload;
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

    const ociMeta = await ociStorage.getObjectMetadata(env.OCI_BUCKET_DOCS_PRIVATE, objectKey);
    if (!ociMeta) {
      throw new AppError(422, "No se pudo leer metadata del archivo en producción");
    }

    if (ociMeta.sizeBytes !== sizeBytes) {
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
      sizeBytes: ociMeta.sizeBytes,
    });

    const { createAuditRepository } = await import("./repository/audit.repository");
    await createAuditRepository(db).createAuditLog({
      actorSub: actor.sub,
      actorEmail: actor.email,
      actorRole: actor.role as any,
      action: "file.uploaded",
      resourceType: "file",
      resourceId: objectKey,
      ipAddress: meta?.ipAddress || "",
      userAgent: meta?.userAgent || "",
      details: { originalName: storedFileName, mimeType, sizeBytes: ociMeta.sizeBytes },
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

  deleteDocument: async (
    actor: DocumentAccessActor,
    objectKey: string,
    meta?: RequestMeta,
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
      ipAddress: meta?.ipAddress || "",
      userAgent: meta?.userAgent || "",
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

  // Collab delegations
  generateDocumentUploadUrlForCollabCommand:
    collabDocumentService.generateDocumentUploadUrlForCollabCommand,
  resolveDocumentMetadataForCollabCommand:
    collabDocumentService.resolveDocumentMetadataForCollabCommand,
  getDocumentAccessUrlForCollabCommand:
    collabDocumentService.getDocumentAccessUrlForCollabCommand,
  deleteDocumentForCollabCommand:
    collabDocumentService.deleteDocumentForCollabCommand,
};
