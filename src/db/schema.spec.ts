import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { mediaAssets } from "./schema";

describe("schema_media.media_assets table configuration", () => {
  it("defines unique index on object_key for O(1) document lookups (FIND-DB-03)", () => {
    const tableConfig = getTableConfig(mediaAssets);
    const objectKeyIndex = tableConfig.indexes.find(
      (idx) => idx.config.name === "uq_media_assets_object_key"
    );

    expect(objectKeyIndex).toBeDefined();
    expect(objectKeyIndex?.config.unique).toBe(true);
  });

  it("retains composite unique index on user_id, kind, avatar_version, width", () => {
    const tableConfig = getTableConfig(mediaAssets);
    const avatarIndex = tableConfig.indexes.find(
      (idx) => idx.config.name === "uq_user_kind_version_width"
    );

    expect(avatarIndex).toBeDefined();
    expect(avatarIndex?.config.unique).toBe(true);
  });
});
