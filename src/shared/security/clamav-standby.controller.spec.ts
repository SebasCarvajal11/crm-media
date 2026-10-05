import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClamavStandbyController } from "./clamav-standby.controller";

const mockPublish = vi.fn().mockResolvedValue(1);

vi.mock("../redis", () => ({
  getRedisConnection: () => ({
    publish: mockPublish,
  }),
}));

vi.mock("node:net", () => ({
  createConnection: vi.fn().mockReturnValue({
    write: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
  }),
}));

describe("ClamavStandbyController", () => {
  let controller: ClamavStandbyController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new ClamavStandbyController({
      idleTimeoutMs: 15 * 60 * 1000,
    });
  });

  it("initializes in standby state with zero active scans", () => {
    expect(controller.getState()).toBe("standby");
    expect(controller.getActiveScans()).toBe(0);
  });

  it("transitions to warming_up on triggerWarmup and notifies redis", () => {
    controller.triggerWarmup("test_upload");
    expect(controller.getState()).toBe("warming_up");
    expect(mockPublish).toHaveBeenCalledWith(
      "cima:clamav:control",
      expect.stringContaining('"action":"wake"')
    );
  });

  it("tracks active scans correctly", () => {
    controller.notifyScanStarted();
    expect(controller.getActiveScans()).toBe(1);
    expect(controller.getState()).toBe("warming_up");

    controller.notifyScanCompleted();
    expect(controller.getActiveScans()).toBe(0);
  });

  it("does not suspend if active scans are still in progress", async () => {
    controller.triggerWarmup("unit_test");
    controller.notifyScanStarted();

    // Advance time beyond 15 minutes by overriding lastActivityAt
    (controller as any).lastActivityAt = Date.now() - 20 * 60 * 1000;

    const suspended = await controller.evaluateIdleTimeout();
    expect(suspended).toBe(false);
    expect(controller.getState()).toBe("warming_up");
  });

  it("does not suspend if idle time has not reached 15 minutes", async () => {
    controller.triggerWarmup("unit_test");
    (controller as any).lastActivityAt = Date.now() - 5 * 60 * 1000;

    const suspended = await controller.evaluateIdleTimeout();
    expect(suspended).toBe(false);
  });

  it("suspends to standby and triggers reset callback after 15 minutes of inactivity", async () => {
    controller.triggerWarmup("unit_test");
    const mockReset = vi.fn();
    controller.registerScannerReset(mockReset);

    // Simulate 16 minutes of idle time
    (controller as any).lastActivityAt = Date.now() - 16 * 60 * 1000;

    const suspended = await controller.evaluateIdleTimeout();
    expect(suspended).toBe(true);
    expect(controller.getState()).toBe("standby");
    expect(mockReset).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledWith(
      "cima:clamav:control",
      expect.stringContaining('"action":"suspend"')
    );
  });

  it("ensureReady waits and returns true when clamav responds during warmup", async () => {
    vi.spyOn(controller, "pingClamavTcp")
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const ready = await controller.ensureReady(2000);
    expect(ready).toBe(true);
    expect(controller.getState()).toBe("ready");
  });

  it("ensureReady returns false when clamav does not respond within timeout", async () => {
    vi.spyOn(controller, "pingClamavTcp").mockResolvedValue(false);

    const ready = await controller.ensureReady(400);
    expect(ready).toBe(false);
  });
});
