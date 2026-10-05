import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startMediaCommandWorker: vi.fn(),
  stopMediaCommandWorker: vi.fn(),
  startIdentityEventConsumer: vi.fn(),
  stopIdentityEventConsumer: vi.fn(),
  startMediaDlqReplayer: vi.fn(),
  stopMediaDlqReplayer: vi.fn(),
  runQuarantineScan: vi.fn(),
  startWorkerHealthcheck: vi.fn(),
  healthcheckStop: vi.fn(),
  initRedis: vi.fn(),
  getRedisConnection: vi.fn(),
  closeRedisConnections: vi.fn(),
  poolEnd: vi.fn(),
  bullWorkerClose: vi.fn(),
  bullRedisQuit: vi.fn(),
}));

vi.mock("../config/env", () => ({
  env: {
    REDIS_URL: "redis://localhost:6379",
    EMAIL_QUEUE_ENCRYPTION_KEY: "dummy-key",
    EMAIL_QUEUE_PREFIX: "bull",
    EMAIL_RATE_MAX: 10,
    EMAIL_RATE_DURATION_MS: 1000,
    DLQ_AUTO_REPLAY_INTERVAL_MS: 60000,
    OCI_QUARANTINE_SCAN_INTERVAL_MS: 30000,
    MEDIA_COMMANDS_STREAM_KEY: "stream:collab.media-commands",
    MEDIA_COMMANDS_CONSUMER_GROUP: "group:media.commands",
  },
}));

vi.mock("./media-command.worker", () => ({
  startMediaCommandWorker: mocks.startMediaCommandWorker,
  stopMediaCommandWorker: mocks.stopMediaCommandWorker,
}));

vi.mock("./identity-event.worker", () => ({
  startIdentityEventConsumer: mocks.startIdentityEventConsumer,
  stopIdentityEventConsumer: mocks.stopIdentityEventConsumer,
}));

vi.mock("./media-command-dlq", () => ({
  startMediaDlqReplayer: mocks.startMediaDlqReplayer,
  stopMediaDlqReplayer: mocks.stopMediaDlqReplayer,
}));

vi.mock("../jobs/run-quarantine-scan", () => ({
  runQuarantineScan: mocks.runQuarantineScan,
}));

vi.mock("../shared/worker-health", () => ({
  startWorkerHealthcheck: mocks.startWorkerHealthcheck.mockReturnValue({
    stop: mocks.healthcheckStop,
  }),
}));

vi.mock("../db/connection", () => ({
  pool: { end: mocks.poolEnd },
}));

vi.mock("../shared/redis", () => ({
  initRedis: mocks.initRedis,
  getRedisConnection: mocks.getRedisConnection,
  closeRedisConnections: mocks.closeRedisConnections,
}));

vi.mock("bullmq", () => ({
  Worker: class MockWorker {
    on = vi.fn();
    close = mocks.bullWorkerClose;
  },
}));

vi.mock("ioredis", () => {
  return {
    default: class MockRedis {
      quit = mocks.bullRedisQuit;
    },
  };
});

vi.mock("../app", () => ({
  serviceMetrics: {
    streamConsumerGroupDepth: { set: vi.fn() },
  },
}));

import { startMediaWorker, stopMediaWorker } from "./media.worker";

describe("media.worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startMediaCommandWorker.mockResolvedValue(undefined);
    mocks.stopMediaCommandWorker.mockResolvedValue(undefined);
    mocks.startIdentityEventConsumer.mockResolvedValue(undefined);
    mocks.stopIdentityEventConsumer.mockResolvedValue(undefined);
    mocks.runQuarantineScan.mockResolvedValue({ scanned: 0, moved: 0, infected: 0 });
    mocks.closeRedisConnections.mockResolvedValue(undefined);
    mocks.poolEnd.mockResolvedValue(undefined);
    mocks.bullWorkerClose.mockResolvedValue(undefined);
    mocks.bullRedisQuit.mockResolvedValue(undefined);
  });

  it("inicia concurrentemente comando, identidad, replayer, cuarentena, email y healthcheck", async () => {
    await startMediaWorker();

    expect(mocks.startMediaCommandWorker).toHaveBeenCalled();
    expect(mocks.startIdentityEventConsumer).toHaveBeenCalled();
    expect(mocks.startMediaDlqReplayer).toHaveBeenCalled();
    expect(mocks.startWorkerHealthcheck).toHaveBeenCalledWith(
      "media-worker",
      expect.any(Object),
    );
    expect(mocks.runQuarantineScan).toHaveBeenCalled();

    await stopMediaWorker();
    expect(mocks.healthcheckStop).toHaveBeenCalled();
    expect(mocks.stopMediaDlqReplayer).toHaveBeenCalled();
    expect(mocks.stopIdentityEventConsumer).toHaveBeenCalled();
    expect(mocks.stopMediaCommandWorker).toHaveBeenCalled();
    expect(mocks.bullWorkerClose).toHaveBeenCalled();
    expect(mocks.bullRedisQuit).toHaveBeenCalled();
    expect(mocks.closeRedisConnections).toHaveBeenCalled();
    expect(mocks.poolEnd).toHaveBeenCalled();
  });
});
