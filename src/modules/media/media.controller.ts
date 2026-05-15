import { AppError } from "../../shared/middlewares/error-handler.middleware";
import { mediaService } from "./media.service";

export const mediaController = {
  // ─── Avatares (mantiene flujo buffer — son pequeños y requieren sharp resize) ───
  uploadAvatar: async (request: Request, userId: string) => {
    const form = await request.formData();
    const uploaded = form.get("file");
    if (!(uploaded instanceof File)) throw new AppError(400, "Campo file es requerido");
    const bytes = await uploaded.arrayBuffer();
    const buffer = Buffer.from(bytes);
    if (buffer.length > 1 * 1024 * 1024 * 5) throw new AppError(413, "Avatar excede 5MB");
    const data = await mediaService.uploadAvatar(userId, uploaded.name, buffer);
    return { data };
  },

  // ─── Documentos: flujo Pre-Signed URL ──────────────────────────────────────────

  /**
   * Paso 1: Genera un PAR de escritura OCI.
   * El frontend recibe uploadUrl y objectKey, luego hace PUT directo a OCI.
   * Body JSON: { fileName, mimeType, sizeBytes }
   */
  generateDocumentUploadUrl: async (request: Request, userId: string) => {
    const body = (await request.json()) as {
      fileName?: string;
      mimeType?: string;
      sizeBytes?: number;
    };
    if (!body.fileName || !body.mimeType || typeof body.sizeBytes !== "number") {
      throw new AppError(400, "Se requieren fileName, mimeType y sizeBytes");
    }
    const data = await mediaService.generateDocumentUploadUrl(
      userId,
      body.fileName,
      body.mimeType,
      body.sizeBytes,
    );
    return { data };
  },

  /**
   * Paso 2: El frontend ya subió el archivo a OCI. Confirmamos la existencia
   * (HeadObject) y registramos en DB.
   * Body JSON: { objectKey, fileName, mimeType, sizeBytes }
   */
  confirmDocumentUpload: async (request: Request, userId: string) => {
    const body = (await request.json()) as {
      objectKey?: string;
      fileName?: string;
      mimeType?: string;
      sizeBytes?: number;
    };
    if (!body.objectKey || !body.fileName || !body.mimeType || typeof body.sizeBytes !== "number") {
      throw new AppError(400, "Se requieren objectKey, fileName, mimeType y sizeBytes");
    }
    const data = await mediaService.confirmDocumentUpload(
      userId,
      body.objectKey,
      body.fileName,
      body.mimeType,
      body.sizeBytes,
    );
    return { data };
  },

  // ─── Acceso y gestión ───────────────────────────────────────────────────────────
  createDocumentAccess: async (objectKey: string, forceDownload: boolean) => {
    const data = await mediaService.getDocumentAccessUrl(objectKey, forceDownload);
    return { data };
  },
  deleteDocument: async (objectKey: string) => {
    const data = await mediaService.deleteDocument(objectKey);
    return { data };
  },
  getCurrentAvatar: async (userId: string) => {
    const data = await mediaService.getCurrentAvatar(userId);
    return { data };
  },
  getCurrentAvatarsByUsers: async (userIds: string[]) => {
    const data = await mediaService.getCurrentAvatarsByUsers(userIds);
    return { data };
  },
};
