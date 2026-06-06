import { AppError } from "../../shared/middlewares/error-handler.middleware";
import { avatarService } from "./avatar.service";
import { documentService } from "./document.service";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const assertAvatarRequestWithinSizeLimit = (request: Request, file?: File) => {
  if (file && file.size > MAX_AVATAR_BYTES) {
    throw new AppError(413, "Avatar excede 5MB");
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const len = Number.parseInt(contentLength, 10);
    if (Number.isFinite(len) && len > MAX_AVATAR_BYTES) {
      throw new AppError(413, "Avatar excede 5MB");
    }
  }
};

export const mediaController = {
  // ─── Avatares (mantiene flujo buffer — son pequeños y requieren sharp resize) ───
  uploadAvatar: async (request: Request, userId: string) => {
    assertAvatarRequestWithinSizeLimit(request);

    const form = await request.formData();
    const uploaded = form.get("file");
    if (!(uploaded instanceof File)) throw new AppError(400, "Campo file es requerido");

    assertAvatarRequestWithinSizeLimit(request, uploaded);

    const bytes = await uploaded.arrayBuffer();
    const buffer = Buffer.from(bytes);
    if (buffer.length > MAX_AVATAR_BYTES) throw new AppError(413, "Avatar excede 5MB");
    const data = await avatarService.uploadAvatar(userId, uploaded.name, buffer);
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
    const data = await documentService.generateDocumentUploadUrl(
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
    const data = await documentService.confirmDocumentUpload(
      userId,
      body.objectKey,
      body.fileName,
      body.mimeType,
      body.sizeBytes,
    );
    return { data };
  },

  // ─── Acceso y gestión ───────────────────────────────────────────────────────────
  createDocumentAccess: async (
    actor: { userId: string; sub: string; role: string; email: string },
    objectKey: string,
    forceDownload: boolean,
  ) => {
    const data = await documentService.getDocumentAccessUrl(actor, objectKey, forceDownload);
    return { data };
  },
  deleteDocument: async (userId: string, userSub: string, userRole: string, objectKey: string) => {
    const data = await documentService.deleteDocument(userId, userSub, userRole, objectKey);
    return { data };
  },
  getCurrentAvatar: async (userId: string) => {
    const data = await avatarService.getCurrentAvatar(userId);
    return { data };
  },
  getCurrentAvatarsByUsers: async (userIds: string[]) => {
    const data = await avatarService.getCurrentAvatarsByUsers(userIds);
    return { data };
  },
};
