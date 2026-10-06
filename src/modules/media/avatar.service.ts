import { inArray } from "drizzle-orm";
import { db } from "../../db/connection";
import { userAvatars } from "../../db/schema";
import { buildAvatarUrls } from "./avatar-preset.service";
import { resolveDeterministicAvatar } from "@sebascarvajal11/cima-contracts";

export interface AvatarDto {
  version: number;
  avatarId: number;
  color: string;
  urls: Record<"64" | "256" | "512", string> | Record<string, string>;
}

export const avatarService = {
  getCurrentAvatar: async (userId: string, fallbackId?: string): Promise<AvatarDto> => {
    const ids = Array.from(new Set([userId, fallbackId].filter(Boolean) as string[]));
    const rows = ids.length > 0
      ? await db
          .select({
            avatarId: userAvatars.avatarId,
            color: userAvatars.color,
          })
          .from(userAvatars)
          .where(inArray(userAvatars.userId, ids))
      : [];

    const row = rows[0];
    if (!row) {
      const targetId = userId || fallbackId || "anonymous";
      const fallback = resolveDeterministicAvatar(targetId);
      return {
        version: 1,
        avatarId: fallback.avatarId,
        color: fallback.color,
        urls: buildAvatarUrls(fallback.avatarId, fallback.color),
      };
    }

    const urls = buildAvatarUrls(row.avatarId, row.color);
    return {
      version: 1,
      avatarId: row.avatarId,
      color: row.color,
      urls,
    };
  },

  getCurrentAvatarsByUsers: async (
    userIds: string[]
  ): Promise<{ items: Record<string, AvatarDto> }> => {
    const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
    if (uniqueUserIds.length === 0) {
      return { items: {} };
    }

    const items: Record<string, AvatarDto> = {};
    const rows = await db
      .select({
        userId: userAvatars.userId,
        avatarId: userAvatars.avatarId,
        color: userAvatars.color,
      })
      .from(userAvatars)
      .where(inArray(userAvatars.userId, uniqueUserIds));

    for (const row of rows) {
      items[row.userId] = {
        version: 1,
        avatarId: row.avatarId,
        color: row.color,
        urls: buildAvatarUrls(row.avatarId, row.color),
      };
    }

    for (const id of uniqueUserIds) {
      if (!items[id]) {
        const fallback = resolveDeterministicAvatar(id);
        items[id] = {
          version: 1,
          avatarId: fallback.avatarId,
          color: fallback.color,
          urls: buildAvatarUrls(fallback.avatarId, fallback.color),
        };
      }
    }

    return { items };
  },
};
