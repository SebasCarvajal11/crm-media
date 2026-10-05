import { describe, it, expect, vi } from "vitest";
import { checkClamav } from "./health-clamav";
import { buildHealthResponse } from "@sebascarvajal11/cima-contracts/health";
import { EventEmitter } from "node:events";

vi.mock("net", () => ({
  createConnection: vi.fn().mockImplementation((options: any, callback: () => void) => {
    const emitter = new EventEmitter() as any;
    emitter.write = vi.fn();
    emitter.destroy = vi.fn();

    process.nextTick(() => {
      if (options.host === "unreachable-host") {
        emitter.emit("error", new Error("connect ECONNREFUSED 127.0.0.1:3310"));
      } else if (options.host === "timeout-host") {
        emitter.emit("timeout");
      } else {
        if (callback) callback();
        emitter.emit("data", Buffer.from("PONG\n"));
      }
    });

    return emitter;
  }),
}));

describe("checkClamav & buildHealthResponse decoupled health checks", () => {
  it("returns status: standby with critical: false when ClamAV is sleeping or unreachable", async () => {
    const result = await checkClamav("unreachable-host", 3310, 500);
    expect(result.status).toBe("standby");
    expect(result.critical).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("returns status: ok with critical: false when ClamAV responds with PONG", async () => {
    const result = await checkClamav("clamav-scanner", 3310, 500);
    expect(result.status).toBe("ok");
    expect(result.critical).toBe(false);
  });

  it("does not degrade service health to 503 when ClamAV is standby or down", () => {
    const dependencies = {
      db: { status: "ok" as const, latencyMs: 2 },
      redis: { status: "ok" as const, latencyMs: 1 },
      clamav: { status: "standby" as const, critical: false, error: "ECONNREFUSED" },
    };

    const { body, status } = buildHealthResponse("1.0.0", Date.now(), dependencies);

    expect(status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.dependencies.clamav.status).toBe("standby");
  });

  it("returns 503 down when a critical dependency (e.g. postgres) fails", () => {
    const dependencies = {
      db: { status: "down" as const, latencyMs: 50, error: "connection terminated" },
      clamav: { status: "standby" as const, critical: false },
    };

    const { body, status } = buildHealthResponse("1.0.0", Date.now(), dependencies);

    expect(status).toBe(503);
    expect(body.status).toBe("down");
  });

  it("returns 503 down when a critical dependency encounters a timeout", () => {
    const dependencies = {
      db: { status: "timeout" as const, latencyMs: 2000, error: "Connection timeout" },
      clamav: { status: "ok" as const, latencyMs: 5, critical: false },
    };

    const { body, status } = buildHealthResponse("1.0.0", Date.now(), dependencies);

    expect(status).toBe(503);
    expect(body.status).toBe("down");
  });

  it("returns 200 degraded when an auxiliary dependency encounters a timeout", () => {
    const dependencies = {
      db: { status: "ok" as const, latencyMs: 5 },
      clamav: { status: "timeout" as const, latencyMs: 2000, critical: false },
    };

    const { body, status } = buildHealthResponse("1.0.0", Date.now(), dependencies);

    expect(status).toBe(200);
    expect(body.status).toBe("degraded");
  });
});
