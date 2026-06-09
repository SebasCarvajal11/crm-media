import { Hono } from "hono";
import { AppError } from "../../shared/middlewares/error-handler.middleware";
import { userRateLimit } from "../../shared/middlewares/rate-limit.middleware";
import { authMiddleware, requireRole, AppEnv } from "../../shared/middlewares/auth.middleware";
import { mediaController } from "./media.controller";
import { env } from "../../config/env";

export const mediaRoutes = new Hono<AppEnv>();

mediaRoutes.use("*", authMiddleware);

// ─── Avatares (buffer: necesitan resize con sharp) ─────────────────────────
mediaRoutes.post(
  "/avatars",
  userRateLimit({ maxAttempts: env.RATE_LIMIT_MEDIA_AVATAR_MAX, windowMs: env.RATE_LIMIT_MEDIA_AVATAR_WINDOW_MS }),
  async (c) => {
    const user = c.get("user");
    const payload = await mediaController.uploadAvatar(c.req.raw, user);
    return c.json(payload, 201);
  },
);

mediaRoutes.get("/avatars/current", async (c) => {
  const { userId } = c.get("user");
  const payload = await mediaController.getCurrentAvatar(userId);
  return c.json(payload);
});

mediaRoutes.get("/avatars/users", async (c) => {
  const idsRaw = c.req.query("ids") ?? "";
  const ids = idsRaw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const payload = await mediaController.getCurrentAvatarsByUsers(ids);
  return c.json(payload);
});

// ─── Documentos: flujo Pre-Signed URL ─────────────────────────────────────

/**
 * POST /media/documents/upload-url
 * Body: { fileName, mimeType, sizeBytes }
 * Retorna: { data: { uploadUrl, objectKey, expiresInSeconds } }
 *
 * El frontend hace PUT uploadUrl con el binario del archivo directamente
 * a OCI sin pasar por KrakenD ni Node.js.
 */
mediaRoutes.post(
  "/documents/upload-url",
  userRateLimit({ maxAttempts: env.RATE_LIMIT_MEDIA_DOC_UPLOAD_MAX, windowMs: env.RATE_LIMIT_MEDIA_DOC_UPLOAD_WINDOW_MS }),
  async (c) => {
    const user = c.get("user");
    const payload = await mediaController.generateDocumentUploadUrl(c.req.raw, user);
    return c.json(payload, 200);
  },
);

/**
 * POST /media/documents/confirm
 * Body: { objectKey, fileName, mimeType, sizeBytes }
 * Retorna: { data: { objectKey } }
 *
 * Llamar después de que el PUT a OCI completó exitosamente.
 * Verifica existencia con HeadObject y registra en DB.
 */
mediaRoutes.post(
  "/documents/confirm",
  userRateLimit({ maxAttempts: env.RATE_LIMIT_MEDIA_DOC_CONFIRM_MAX, windowMs: env.RATE_LIMIT_MEDIA_DOC_CONFIRM_WINDOW_MS }),
  async (c) => {
    const user = c.get("user");
    const payload = await mediaController.confirmDocumentUpload(c.req.raw, user);
    return c.json(payload, 201);
  },
);

// ─── Documentos: acceso y gestión ─────────────────────────────────────────
mediaRoutes.get("/documents/access", async (c) => {
  const { userId, sub, role, email } = c.get("user");
  const objectKey = c.req.query("objectKey");
  if (!objectKey) throw new AppError(400, "objectKey es requerido");
  const forceDownload = c.req.query("download") === "true";
  const payload = await mediaController.createDocumentAccess(
    { userId, sub, role, email },
    objectKey,
    forceDownload,
  );
  return c.json(payload);
});

mediaRoutes.delete(
  "/documents",
  requireRole("admin", "worker"),
  async (c) => {
    const user = c.get("user");
    const objectKey = c.req.query("objectKey");
    if (!objectKey) throw new AppError(400, "objectKey es requerido");
    const payload = await mediaController.deleteDocument(c.req.raw, user, objectKey);
    return c.json(payload);
  },
);
