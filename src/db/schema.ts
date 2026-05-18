import { pgSchema, uuid, text, timestamp, integer, bigint, uniqueIndex } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";

export const mediaSchema = pgSchema("schema_media");
export const mediaKindEnum = mediaSchema.enum("media_kind", ["avatar", "document"]);

export const mediaAssets = mediaSchema.table("media_assets", {
  id: uuid("id").$defaultFn(() => uuidv7()).primaryKey(),
  userId: text("user_id").notNull(),
  kind: mediaKindEnum("kind").notNull(),
  avatarVersion: integer("avatar_version"),
  width: integer("width"),
  bucket: text("bucket").notNull(),
  objectKey: text("object_key").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("uq_user_kind_version_width").on(t.userId, t.kind, t.avatarVersion, t.width)
]);
