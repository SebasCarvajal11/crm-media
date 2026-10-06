import { Hono } from "hono";
import { AppError } from "../../shared/middlewares/error-handler.middleware";
import { userRateLimit } from "../../shared/middlewares/rate-limit.middleware";
import { authMiddleware, requireRole, AppEnv } from "../../shared/middlewares/auth.middleware";
import { mediaController } from "./media.controller";
import { buildAvatarUrls } from "./avatar-preset.service";
import { resolveDeterministicAvatar } from "@sebascarvajal11/cima-contracts";
import { env } from "../../config/env";

const MAX_AVATAR_LOOKUP_IDS = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const mediaRoutes = new Hono<AppEnv>();

mediaRoutes.use("*", authMiddleware);

// ─── Avatares (catálogo predeterminado con color corporativo) ────────────────
mediaRoutes.post(
  "/avatars/preset",
  userRateLimit({ maxAttempts: env.RATE_LIMIT_MEDIA_AVATAR_MAX, windowMs: env.RATE_LIMIT_MEDIA_AVATAR_WINDOW_MS }),
  async (c) => {
    const user = c.get("user");
    const body = await c.req.json();
    const payload = await mediaController.saveAvatarPreset(body, user, c.req.raw);
    return c.json(payload, 201);
  },
);

mediaRoutes.get("/avatars/current", async (c) => {
  const { userId, sub } = c.get("user");
  const payload = await mediaController.getCurrentAvatar(sub || userId, userId);
  return c.json(payload);
});

mediaRoutes.get("/avatars/users", async (c) => {
  const queryList = c.req.queries("ids") ?? [];
  const singleQuery = c.req.query("ids");
  const rawList = queryList.length > 0 ? queryList : (singleQuery ? [singleQuery] : []);
  const tokens = rawList
    .flatMap((item) => item.split(","))
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && id !== "null" && id !== "undefined");

  const uniqueTokens = Array.from(new Set(tokens));
  if (uniqueTokens.length > MAX_AVATAR_LOOKUP_IDS) {
    throw new AppError(400, `Se permiten máximo ${MAX_AVATAR_LOOKUP_IDS} usuarios por consulta`);
  }

  if (uniqueTokens.length === 0) {
    return c.json({ data: { items: {} } });
  }

  const validUuids = uniqueTokens.filter((id) => UUID_PATTERN.test(id));
  const nonUuids = uniqueTokens.filter((id) => !UUID_PATTERN.test(id));

  const { data } = await mediaController.getCurrentAvatarsByUsers(validUuids);
  const items = data.items;

  for (const token of nonUuids) {
    const fallback = resolveDeterministicAvatar(token);
    items[token] = {
      version: 1,
      avatarId: fallback.avatarId,
      color: fallback.color,
      urls: buildAvatarUrls(fallback.avatarId, fallback.color),
    };
  }

  return c.json({ data: { items } });
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

mediaRoutes.get(
  "/storage/stats",
  requireRole("admin"),
  async (c) => {
    const forceRefresh = c.req.query("refresh") === "true";
    const payload = await mediaController.getStorageStats(forceRefresh);
    return c.json(payload);
  },
);

