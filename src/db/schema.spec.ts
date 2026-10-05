import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { mediaAssets, fileReputation } from "./schema";

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

  it("configures file_reputation table with sha256 primary key", () => {
    const tableConfig = getTableConfig(fileReputation);
    expect(tableConfig.name).toBe("file_reputation");
    const columns = tableConfig.columns.map((c) => c.name);
    expect(columns).toContain("sha256");
    expect(columns).toContain("status");
    expect(columns).toContain("virus_name");
    expect(columns).toContain("size_bytes");
    expect(columns).toContain("scanned_by");
  });
});
