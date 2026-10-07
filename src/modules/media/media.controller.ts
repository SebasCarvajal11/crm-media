import { AppError } from "../../shared/middlewares/error-handler.middleware";
import { avatarService } from "./avatar.service";
import { avatarPresetService } from "./avatar-preset.service";
import { documentService } from "./document.service";
import { storageService } from "./storage.service";
import { getTrustedClientIp } from "@sebascarvajal11/cima-contracts/hono-security-middleware";
import { z } from "zod";

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const avatarPresetSchema = z.object({
  avatarId: z.coerce.number().int().min(0).max(83),
  color: z.string().regex(HEX_COLOR_REGEX, "Color debe ser un código hexadecimal válido (ej: #86070c)"),
});

const getContextFromRequest = (request: Request) => {
  const ipAddress = getTrustedClientIp(request.headers);
  const userAgent = request.headers.get("user-agent") || "";
  return { ipAddress, userAgent };
};

export const mediaController = {
  // ─── Avatares: Preset oficial con color corporativo CIMA ───
  saveAvatarPreset: async (body: unknown, user: any, request: Request) => {
    const parseResult = avatarPresetSchema.safeParse(body);
    if (!parseResult.success) {
      const issue = parseResult.error.issues[0]?.message ?? "Parámetros inválidos";
      throw new AppError(400, `Parámetros de avatar preset inválidos: ${issue}`);
    }
    const { ipAddress, userAgent } = getContextFromRequest(request);
    const primaryId = user.sub || user.userId;
    const data = await avatarPresetService.saveAvatarPreset(primaryId, {
      avatarId: parseResult.data.avatarId,
      color: parseResult.data.color,
      actor: user,
      ipAddress,
      userAgent,
    });
    return { data };
  },

  // ─── Documentos: flujo Pre-Signed URL ──────────────────────────────────────────

  /**
   * Paso 1: Genera un PAR de escritura OCI.
   * El frontend recibe uploadUrl y objectKey, luego hace PUT directo a OCI.
   * Body JSON: { fileName, mimeType, sizeBytes }
   */
  generateDocumentUploadUrl: async (request: Request, user: any) => {
    const body = (await request.json()) as {
      fileName?: string;
      mimeType?: string;
      sizeBytes?: number;
    };
    if (!body.fileName || !body.mimeType || typeof body.sizeBytes !== "number") {
      throw new AppError(400, "Se requieren fileName, mimeType y sizeBytes");
    }
    const data = await documentService.generateDocumentUploadUrl(
      user.userId,
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
  confirmDocumentUpload: async (request: Request, user: any) => {
    const body = (await request.json()) as {
      objectKey?: string;
      fileName?: string;
      mimeType?: string;
      sizeBytes?: number;
    };
    if (!body.objectKey || !body.fileName || !body.mimeType || typeof body.sizeBytes !== "number") {
      throw new AppError(400, "Se requieren objectKey, fileName, mimeType y sizeBytes");
    }
    
    const { ipAddress, userAgent } = getContextFromRequest(request);
    const data = await documentService.confirmDocumentUpload(
      user,
      {
        objectKey: body.objectKey,
        fileName: body.fileName,
        mimeType: body.mimeType,
        sizeBytes: body.sizeBytes,
      },
      { ipAddress, userAgent },
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
  deleteDocument: async (request: Request, user: any, objectKey: string) => {
    const { ipAddress, userAgent } = getContextFromRequest(request);
    const data = await documentService.deleteDocument(user, objectKey, { ipAddress, userAgent });
    return { data };
  },
  getCurrentAvatar: async (
    userId: string,
    fallbackId?: string,
    options?: { tiered?: boolean }
  ) => {
    const data = await avatarService.getCurrentAvatar(userId, fallbackId, options);
    return { data };
  },
  getCurrentAvatarsByUsers: async (
    userIds: string[],
    options?: { tiered?: boolean }
  ) => {
    const data = await avatarService.getCurrentAvatarsByUsers(userIds, options);
    return { data };
  },
  getStorageStats: async (forceRefresh = false) => {
    const data = await storageService.getStorageStats(forceRefresh);
    return { data };
  },
};
