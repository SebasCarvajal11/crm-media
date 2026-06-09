import { pgSchema, uuid, text, timestamp, integer, bigint, uniqueIndex, bigserial, varchar, jsonb, primaryKey } from "drizzle-orm/pg-core";
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

export const auditLogs = mediaSchema.table(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).notNull(),
    actorSub: uuid("actor_sub"),
    actorEmail: varchar("actor_email", { length: 255 }),
    actorRole: varchar("actor_role", { length: 20 }),
    action: varchar("action", { length: 120 }).notNull(),
    resourceType: varchar("resource_type", { length: 80 }).notNull(),
    resourceId: varchar("resource_id", { length: 255 }),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: varchar("user_agent", { length: 500 }),
    correlationId: uuid("correlation_id"),
    details: jsonb("details"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.id, t.createdAt] })]
);
