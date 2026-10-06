import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/connection";
import { mediaAssets } from "../../db/schema";
import { AppError } from "../../shared/middlewares/error-handler.middleware";
import { getLogger } from "../../shared/logger";
import {
  processAvatarVariants,
  uploadVariantsToOci,
  recordAvatarInDatabase,
  cleanupOldAvatarVersions,
  compensateUploadedVariants,
} from "./avatar.service";

const logger = getLogger();

export interface SaveAvatarPresetOptions {
  avatarId: number;
  color: string;
  actor?: { userId: string; sub: string; role: string; email: string };
  ipAddress?: string;
  userAgent?: string;
}

export const resolveAvatarPresetPath = (avatarId: number): string => {
  if (!Number.isInteger(avatarId) || avatarId < 0 || avatarId > 83) {
    throw new AppError(400, "avatarId debe ser un entero entre 0 y 83");
  }

  const candidates = [
    path.resolve(process.cwd(), "assets", "avatars", `avatar-${avatarId}.png`),
    path.resolve(process.cwd(), "..", "crm-media", "assets", "avatars", `avatar-${avatarId}.png`),
    path.resolve(__dirname, "../../../assets/avatars", `avatar-${avatarId}.png`),
    path.resolve(__dirname, "../../assets/avatars", `avatar-${avatarId}.png`),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new AppError(404, `Avatar preset ${avatarId} no encontrado en catálogo`);
};

export const composePresetAvatarBuffer = async (avatarId: number, color: string): Promise<Buffer> => {
  const avatarPath = resolveAvatarPresetPath(avatarId);
  const avatarBuffer = await fs.promises.readFile(avatarPath);

  const resizedAvatar = await sharp(avatarBuffer)
    .resize({ height: 500, fit: "inside" })
    .toBuffer();

  const avatarMeta = await sharp(resizedAvatar).metadata();
  const left = Math.round((512 - (avatarMeta.width ?? 0)) / 2);
  const top = 512 - (avatarMeta.height ?? 0);

  return sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: color,
    },
  })
    .composite([{ input: resizedAvatar, left, top }])
    .webp({ quality: 84 })
    .toBuffer();
};

export const avatarPresetService = {
  saveAvatarPreset: async (userId: string, options: SaveAvatarPresetOptions) => {
    const { avatarId, color, actor, ipAddress, userAgent } = options;

    const composedBuffer = await composePresetAvatarBuffer(avatarId, color);

    const latestVersion = await db
      .select({ latest: sql<number>`coalesce(max(${mediaAssets.avatarVersion}), 0)` })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.userId, userId), eq(mediaAssets.kind, "avatar")));

    const avatarVersion = (latestVersion[0]?.latest ?? 0) + 1;
    const baseId = uuidv4();

    const variants = await processAvatarVariants(composedBuffer, userId, avatarVersion, baseId);
    const { uploaded, urls } = await uploadVariantsToOci(variants);

    const storedOriginalName = `preset-${avatarId}-${color.replace("#", "")}.webp`;

    try {
      await recordAvatarInDatabase({
        userId,
        avatarVersion,
        storedOriginalName,
        uploaded,
        actor,
        ipAddress,
        userAgent,
      });
    } catch (err) {
      logger.error({ topic: "avatar", err, userId }, "Fallo persistencia avatar preset SQL; purgando OCI");
      await compensateUploadedVariants(uploaded);
      throw err;
    }

    try {
      await cleanupOldAvatarVersions(userId, avatarVersion);
    } catch (cleanupErr) {
      logger.warn({ topic: "avatar", err: cleanupErr, userId }, "Limpieza asíncrona de avatares antiguos falló");
    }

    return { version: avatarVersion, urls };
  },
};
