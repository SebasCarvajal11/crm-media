import { and, eq } from "drizzle-orm";
import { db } from "../../db/connection";
import { mediaAssets } from "../../db/schema";
import { AppError } from "../../shared/middlewares/error-handler.middleware";
import { getLogger } from "../../shared/logger";
import { isBlockedFileName, isBlockedMime } from "../../shared/security/file-validation";
import { ociStorage } from "../../shared/storage/oci-storage";
import { sanitizeStoredFileName } from "../../shared/sanitize-filename";
import { env } from "../../config/env";
import { scanBufferForVirus } from "../../shared/security/clamav";

const logger = getLogger();

export const tryPromoteFromQuarantine = async (objectKey: string): Promise<boolean> => {
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
    logger.error({ err: error, objectKey, topic: "collab-document.service" }, "Error promoviendo desde cuarentena");
    return false;
  }
};

export function assertCollabObjectKey(objectKey: string): void {
  if (!objectKey.startsWith("projects/") && !objectKey.startsWith("clients/")) {
    throw new AppError(403, "El objectKey no pertenece a archivos de colaboracion");
  }
}

export async function deleteIfExists(bucket: string, objectKey: string): Promise<void> {
  if (await ociStorage.verifyObjectExists(bucket, objectKey)) {
    await ociStorage.deleteObject(bucket, objectKey);
  }
}

export const collabDocumentService = {
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
    actor?: { userId: string; sub: string; role: string; email: string },
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
};
