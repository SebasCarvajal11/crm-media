import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../shared/middlewares/auth.middleware", () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set("user", {
      userId: "u-test",
      sub: "00000000-0000-4000-8000-000000000001",
      role: "admin",
      email: "test@cima.dev",
    });
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

vi.mock("../../shared/middlewares/rate-limit.middleware", () => ({
  userRateLimit: () => async (_c: any, next: any) => next(),
}));

const mockSelect = vi.fn();
vi.mock("../../db/connection", () => ({
  db: {
    select: (...args: any[]) => mockSelect(...args),
  },
}));

import { mediaRoutes } from "./media.routes";
import { onError } from "../../shared/middlewares/error-handler.middleware";

mediaRoutes.onError(onError);

describe("mediaRoutes - Avatars routing & sanitization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /avatars/users handles heterogeneous token list without throwing 400 Bad Request", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          {
            userId: "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d",
            avatarId: 12,
            color: "#86070c",
          },
        ]),
      }),
    });

    const query = "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d,system,bot_user,null,,undefined";
    const res = await mediaRoutes.request(`/avatars/users?ids=${encodeURIComponent(query)}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    const items = body.data.items;
    expect(items).toBeDefined();

    // Persisted UUID from DB
    expect(items["a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d"].avatarId).toBe(12);

    // Heterogeneous non-UUID tokens resolved via deterministic fallback
    expect(items["system"]).toBeDefined();
    expect(typeof items["system"].avatarId).toBe("number");
    expect(items["bot_user"]).toBeDefined();
    expect(typeof items["bot_user"].avatarId).toBe("number");
  });

  it("GET /avatars/users with empty or sentinels-only query returns empty items with 200", async () => {
    const res = await mediaRoutes.request("/avatars/users?ids=undefined,null,,%20");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toEqual({ items: {} });
  });

  it("GET /avatars/users throws 400 when exceeding MAX_AVATAR_LOOKUP_IDS", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `u-${i}`).join(",");
    const res = await mediaRoutes.request(`/avatars/users?ids=${ids}`);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.message).toContain("Se permiten máximo 100 usuarios");
  });

  it("POST /avatars route is purged and returns 404 Not Found", async () => {
    const res = await mediaRoutes.request("/avatars", { method: "POST" });
    expect(res.status).toBe(404);
  });
});
