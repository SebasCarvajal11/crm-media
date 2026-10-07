import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  OFFICIAL_AVATARS_COUNT,
  CIMA_CORPORATE_PALETTE,
  resolveDeterministicAvatar,
} from "@sebascarvajal11/cima-contracts";

vi.mock("../../shared/middlewares/auth.middleware", () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set("user", {
      userId: "u-adversarial-tester",
      sub: "00000000-0000-4000-8000-000000000001",
      role: "admin",
      email: "challenger@cima.dev",
    });
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

vi.mock("../../shared/middlewares/rate-limit.middleware", () => ({
  userRateLimit: () => async (_c: any, next: any) => next(),
}));

const mockDbRows: Record<string, { userId: string; avatarId: number; color: string }> = {};

vi.mock("../../db/connection", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: vi.fn().mockImplementation(async () => {
          return Object.values(mockDbRows);
        }),
      }),
    }),
  },
  pool: {},
}));

vi.mock("../../shared/redis", () => ({
  getRedisConnection: () => null,
  initRedis: () => {},
  closeRedisConnections: async () => {},
}));

vi.mock("../../shared/storage/oci-client", () => ({
  client: {},
}));

import { mediaRoutes } from "./media.routes";
import { onError } from "../../shared/middlewares/error-handler.middleware";
import { createApp } from "../../app";

mediaRoutes.onError(onError);

describe("Adversarial Empirical Stress Harness - Media Avatars", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockDbRows)) {
      delete mockDbRows[key];
    }
  });

  describe("1. Adversarial Test on GET /avatars/users hostile inputs", () => {
    it("handles empty query strings without throwing 400 Bad Request", async () => {
      const hostileQueries = ["", "ids=", "ids=&ids=", "ids=,,,,,,", "ids=%20%20%20", "ids=%09%0A"];
      for (const q of hostileQueries) {
        const path = q ? `/avatars/users?${q}` : "/avatars/users";
        const res = await mediaRoutes.request(path);
        expect(res.status, `Failed for query: "${q}"`).toBe(200);
        const json = await res.json();
        expect(json.data).toBeDefined();
        expect(json.data.items).toEqual({});
      }
    });

    it("handles standalone sentinel tokens ('null', 'undefined') returning 200 and empty items", async () => {
      const sentinels = ["ids=null", "ids=undefined", "ids=null,undefined", "ids=null,,undefined,%20"];
      for (const q of sentinels) {
        const res = await mediaRoutes.request(`/avatars/users?${q}`);
        expect(res.status, `Failed for query: "${q}"`).toBe(200);
        const json = await res.json();
        expect(json.data.items).toEqual({});
      }
    });

    it("handles non-UUID tokens ('bot', 'system-bot', 'admin') returning 200 with deterministic items", async () => {
      const nonUuids = ["bot", "system-bot", "custom-agent", "guest_1234"];
      const res = await mediaRoutes.request(`/avatars/users?ids=${nonUuids.join(",")}`);
      expect(res.status).toBe(200);
      const json = await res.json();
      const items = json.data.items;

      for (const token of nonUuids) {
        expect(items[token], `Missing item for token: ${token}`).toBeDefined();
        expect(items[token].version).toBe(1);
        expect(Number.isInteger(items[token].avatarId)).toBe(true);
        expect(items[token].avatarId).toBeGreaterThanOrEqual(0);
        expect(items[token].avatarId).toBeLessThan(OFFICIAL_AVATARS_COUNT);
        expect(CIMA_CORPORATE_PALETTE).toContain(items[token].color);
        expect(items[token].urls["64"]).toContain(`/avatars/avatar-${items[token].avatarId}.webp?c=`);
      }
    });

    it("handles heterogeneous array of 5 valid UUIDs + 5 arbitrary non-UUID tokens with zero nulls and 200 OK", async () => {
      // 2 UUIDs exist in DB, 3 UUIDs are not in DB, 5 tokens are non-UUIDs
      const dbUuid1 = "11111111-1111-4111-8111-111111111111";
      const dbUuid2 = "22222222-2222-4222-8222-222222222222";
      mockDbRows[dbUuid1] = { userId: dbUuid1, avatarId: 7, color: "#86070c" };
      mockDbRows[dbUuid2] = { userId: dbUuid2, avatarId: 42, color: "#1d4ed8" };

      const missingUuid1 = "33333333-3333-4333-8333-333333333333";
      const missingUuid2 = "44444444-4444-4444-8444-444444444444";
      const missingUuid3 = "55555555-5555-4555-8555-555555555555";

      const validUuids = [dbUuid1, dbUuid2, missingUuid1, missingUuid2, missingUuid3];
      const nonUuids = ["bot", "system-bot", "ops-monitor", "cli-runner", "external-webhook"];
      const hostileQuery = [...validUuids, ...nonUuids, "null", "undefined", ""].join(",");

      const res = await mediaRoutes.request(`/avatars/users?ids=${encodeURIComponent(hostileQuery)}`);
      expect(res.status).toBe(200);

      const json = await res.json();
      const items = json.data.items;

      // DB-persisted items
      expect(items[dbUuid1].avatarId).toBe(7);
      expect(items[dbUuid1].color).toBe("#86070c");
      expect(items[dbUuid2].avatarId).toBe(42);
      expect(items[dbUuid2].color).toBe("#1d4ed8");

      // Non-persisted UUIDs resolved deterministically
      for (const u of [missingUuid1, missingUuid2, missingUuid3]) {
        expect(items[u]).toBeDefined();
        expect(items[u].avatarId).toBeGreaterThanOrEqual(0);
        expect(items[u].avatarId).toBeLessThan(84);
        expect(CIMA_CORPORATE_PALETTE).toContain(items[u].color);
      }

      // Non-UUIDs resolved deterministically
      for (const t of nonUuids) {
        expect(items[t]).toBeDefined();
        expect(items[t].avatarId).toBeGreaterThanOrEqual(0);
        expect(items[t].avatarId).toBeLessThan(84);
        expect(CIMA_CORPORATE_PALETTE).toContain(items[t].color);
      }

      // Filtered tokens must not appear as keys
      expect(items["null"]).toBeUndefined();
      expect(items["undefined"]).toBeUndefined();
      expect(items[""]).toBeUndefined();
    });

    it("enforces MAX_AVATAR_LOOKUP_IDS boundary: exactly 100 succeeds (200), 101 fails (400)", async () => {
      const exactly100 = Array.from({ length: 100 }, (_, i) => `user-id-${i}`).join(",");
      const res100 = await mediaRoutes.request(`/avatars/users?ids=${exactly100}`);
      expect(res100.status).toBe(200);
      const json100 = await res100.json();
      expect(Object.keys(json100.data.items).length).toBe(100);

      const exactly101 = Array.from({ length: 101 }, (_, i) => `user-id-${i}`).join(",");
      const res101 = await mediaRoutes.request(`/avatars/users?ids=${exactly101}`);
      expect(res101.status).toBe(400);
      const json101 = await res101.json();
      expect(json101.message).toContain("Se permiten máximo 100 usuarios");
    });
  });

  describe("2. Deterministic Fallback Invariance & Oracle Validation", () => {
    it("guarantees avatarId in [0, 83] and color in CIMA_CORPORATE_PALETTE for extreme inputs", () => {
      const hostileValues = [
        "",
        "   ",
        "\t\r\n",
        "0",
        "-1",
        "NaN",
        "undefined",
        "null",
        "false",
        "true",
        "SELECT * FROM users; DROP TABLE user_avatars;",
        "<script>alert('xss')</script>",
        "🚀🔥💻",
        "日本語テスト",
        "العربية",
        "A".repeat(5000),
      ];

      for (const val of hostileValues) {
        const { avatarId, color } = resolveDeterministicAvatar(val);
        expect(Number.isInteger(avatarId)).toBe(true);
        expect(avatarId).toBeGreaterThanOrEqual(0);
        expect(avatarId).toBeLessThan(OFFICIAL_AVATARS_COUNT);
        expect(CIMA_CORPORATE_PALETTE).toContain(color);

        // Deterministic invariance: identical inputs must yield identical output
        const again = resolveDeterministicAvatar(val);
        expect(again.avatarId).toBe(avatarId);
        expect(again.color).toBe(color);
      }
    });
  });

  describe("3. Purge Completeness: POST /api/v1/media/avatars returns 404", () => {
    it("POST /avatars on mediaRoutes returns 404 (not 410, not 200)", async () => {
      const res = await mediaRoutes.request("/avatars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
    });

    it("POST /api/v1/media/avatars on full application returns 404 (not 410, not 200)", async () => {
      const app = createApp();
      const res = await app.request("/api/v1/media/avatars", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer mocked-token",
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("Ruta no encontrada");
    });
  });
});
