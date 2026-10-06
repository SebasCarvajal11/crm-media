import { and, eq } from "drizzle-orm";
import { db } from "../../db/connection";
import { auditLogs, mediaAssets, userAvatars } from "../../db/schema";
import { AppError } from "../../shared/middlewares/error-handler.middleware";
import { getLogger } from "../../shared/logger";

const logger = getLogger();

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export interface SaveAvatarPresetOptions {
  avatarId: number;
  color: string;
  actor?: { userId: string; sub: string; role: string; email: string };
  ipAddress?: string;
  userAgent?: string;
}

export function buildAvatarUrls(avatarId: number, color: string): Record<"64" | "256" | "512", string> {
  const cleanColor = color.replace("#", "");
  const base = `/avatars/avatar-${avatarId}.webp?c=${cleanColor}`;
  return {
    "64": base,
    "256": base,
    "512": base,
  };
}

export const avatarPresetService = {
  saveAvatarPreset: async (userId: string, options: SaveAvatarPresetOptions) => {
    const { avatarId, color, actor, ipAddress, userAgent } = options;

    if (!Number.isInteger(avatarId) || avatarId < 0 || avatarId > 83) {
      throw new AppError(400, "avatarId debe ser un entero entre 0 y 83");
    }

    if (!HEX_COLOR_REGEX.test(color)) {
      throw new AppError(400, "Color debe ser un código hexadecimal válido (ej: #86070c)");
    }

    const targetIds = Array.from(
      new Set([userId, actor?.sub, actor?.userId].filter(Boolean) as string[])
    );

    for (const id of targetIds) {
      await db
        .insert(userAvatars)
        .values({
          userId: id,
          avatarId,
          color,
          updatedAt: new Date(),
          createdAt: new Date(),
        })
        .onConflictDoUpdate({
          target: userAvatars.userId,
          set: {
            avatarId,
            color,
            updatedAt: new Date(),
          },
        });

      // Purgar residuos de media_assets si existían avatares previos en OCI/DB
      await db
        .delete(mediaAssets)
        .where(and(eq(mediaAssets.userId, id), eq(mediaAssets.kind, "avatar")))
        .catch((err) => {
          logger.warn({ topic: "avatar", err, userId: id }, "No se pudo purgar media_assets residual de avatar");
        });
    }

    if (actor) {
      await db
        .insert(auditLogs)
        .values({
          actorSub: actor.sub as any,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: "avatar.preset_selected",
          resourceType: "avatar",
          resourceId: userId,
          ipAddress,
          userAgent,
          details: { avatarId, color },
        })
        .catch((err) => {
          logger.warn({ topic: "avatar", err, userId }, "No se pudo registrar log de auditoría para avatar");
        });
    }

    const urls = buildAvatarUrls(avatarId, color);
    return { version: 1, avatarId, color, urls };
  },
};
