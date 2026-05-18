import { Hono } from "hono";
import { AppError } from "../../shared/middlewares/error-handler.middleware";
import { userRateLimit } from "../../shared/middlewares/rate-limit.middleware";
import { gatewayTrustMiddleware } from "../../shared/middlewares/gateway-trust.middleware";
import { mediaController } from "./media.controller";

export const mediaRoutes = new Hono();

mediaRoutes.use("*", gatewayTrustMiddleware);

const getUserId = (req: Request) => {
  const userId = req.headers.get("x-user-id") ?? req.headers.get("x-user-sub");
  if (!userId) throw new AppError(401, "Header X-User-ID requerido");
  return userId;
};

// ─── Avatares (buffer: necesitan resize con sharp) ─────────────────────────
mediaRoutes.post(
  "/avatars",
  userRateLimit({ maxAttempts: 10, windowMs: 60 * 60 * 1000 }),
  async (c) => {
  const userId = getUserId(c.req.raw);
  const payload = await mediaController.uploadAvatar(c.req.raw, userId);
  return c.json(payload, 201);
  },
);

mediaRoutes.get("/avatars/current", async (c) => {
  const userId = getUserId(c.req.raw);
  const payload = await mediaController.getCurrentAvatar(userId);
  return c.json(payload);
});

mediaRoutes.get("/avatars/users", async (c) => {
  getUserId(c.req.raw);
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
  userRateLimit({ maxAttempts: 40, windowMs: 15 * 60 * 1000 }),
  async (c) => {
  const userId = getUserId(c.req.raw);
  const payload = await mediaController.generateDocumentUploadUrl(c.req.raw, userId);
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
  userRateLimit({ maxAttempts: 40, windowMs: 15 * 60 * 1000 }),
  async (c) => {
  const userId = getUserId(c.req.raw);
  const payload = await mediaController.confirmDocumentUpload(c.req.raw, userId);
  return c.json(payload, 201);
  },
);

// ─── Documentos: acceso y gestión ─────────────────────────────────────────
mediaRoutes.get("/documents/access", async (c) => {
  const userId = getUserId(c.req.raw);
  const sub = c.req.header("x-user-sub") ?? userId;
  const role = c.req.header("x-user-role") ?? "client";
  const email = c.req.header("x-user-email") ?? "";
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

mediaRoutes.delete("/documents", async (c) => {
  const userId = getUserId(c.req.raw);
  const objectKey = c.req.query("objectKey");
  if (!objectKey) throw new AppError(400, "objectKey es requerido");
  const payload = await mediaController.deleteDocument(userId, objectKey);
  return c.json(payload);
});
