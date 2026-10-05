import { fileURLToPath } from "node:url";
import path from "node:path";
import { Worker } from "bullmq";
import Redis from "ioredis";
import { env } from "../config/env";
import { getLogger } from "../shared/logger";
import {
  closeRedisConnections,
  getRedisConnection,
  initRedis,
} from "../shared/redis";
import { pool } from "../db/connection";
import { startWorkerHealthcheck } from "../shared/worker-health";
import { serviceMetrics } from "../app";
import {
  startMediaCommandWorker,
  stopMediaCommandWorker,
} from "./media-command.worker";
import {
  startIdentityEventConsumer,
  stopIdentityEventConsumer,
} from "./identity-event.worker";
import {
  startMediaDlqReplayer,
  stopMediaDlqReplayer,
} from "./media-command-dlq";
import { runQuarantineScan } from "../jobs/run-quarantine-scan";
import { EMAIL_QUEUE_NAME } from "../modules/email/email.queue";
import { processEmailJob } from "../modules/email/email.processor";

const logger = getLogger();

interface MediaWorkerState {
  emailWorker?: Worker;
  emailRedis?: Redis;
  quarantineTimer?: NodeJS.Timeout;
  streamDepthTimer?: NodeJS.Timeout;
  healthcheck?: ReturnType<typeof startWorkerHealthcheck>;
  isQuarantineTicking: boolean;
  isShuttingDown: boolean;
}

const state: MediaWorkerState = {
  isQuarantineTicking: false,
  isShuttingDown: false,
};

async function tickQuarantine(): Promise<void> {
  if (state.isQuarantineTicking || state.isShuttingDown) return;
  state.isQuarantineTicking = true;
  try {
    const { scanned, moved, infected } = await runQuarantineScan();
    if (scanned > 0) {
      logger.info(
        { scanned, moved, infected, topic: "worker:quarantine-scan" },
        "ciclo completado",
      );
    }
  } catch (err) {
    logger.error({ err, topic: "worker:quarantine-scan" }, "error en ciclo");
  } finally {
    state.isQuarantineTicking = false;
  }
}

async function checkStreamDepth(): Promise<void> {
  try {
    const pub = getRedisConnection();
    if (!pub) return;
    const pending = await pub.xpending(
      env.MEDIA_COMMANDS_STREAM_KEY,
      env.MEDIA_COMMANDS_CONSUMER_GROUP,
    );
    const pendingCount = Array.isArray(pending) ? Number(pending[0]) : 0;
    serviceMetrics.streamConsumerGroupDepth.set(
      {
        stream: env.MEDIA_COMMANDS_STREAM_KEY,
        group: env.MEDIA_COMMANDS_CONSUMER_GROUP,
      },
      pendingCount,
    );
  } catch {
    // Best-effort metrics collection
  }
}

function initEmailWorker(): void {
  if (!env.REDIS_URL || !env.EMAIL_QUEUE_ENCRYPTION_KEY) {
    logger.warn(
      { topic: "worker:email" },
      "REDIS_URL o EMAIL_QUEUE_ENCRYPTION_KEY ausente; worker email omitido",
    );
    return;
  }

  const connection = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });

  connection.on?.("error", (err) => {
    logger.error({ err, topic: "worker:email" }, "Redis connection error");
  });

  const worker = new Worker(EMAIL_QUEUE_NAME, processEmailJob, {
    connection: connection as any,
    prefix: env.EMAIL_QUEUE_PREFIX,
    concurrency: 5,
    limiter: {
      max: env.EMAIL_RATE_MAX,
      duration: env.EMAIL_RATE_DURATION_MS,
    },
  });

  worker.on("failed", (job, err) => {
    logger.error({ err, topic: "worker:email", jobId: job?.id }, "Email job failed");
  });
  worker.on("error", (err) => {
    logger.error({ err, topic: "worker:email" }, "Worker connection error");
  });
  worker.on("completed", (job) => {
    logger.info({ topic: "worker:email", jobId: job.id }, "Email dispatched");
  });

  state.emailWorker = worker;
  state.emailRedis = connection;
}

export async function startMediaWorker(): Promise<void> {
  state.isShuttingDown = false;
  if (!env.REDIS_URL) {
    throw new Error("REDIS_URL es requerida para el media worker consolidado");
  }

  initRedis(env.REDIS_URL);

  await startMediaCommandWorker();
  await startIdentityEventConsumer();

  if (env.DLQ_AUTO_REPLAY_INTERVAL_MS > 0) {
    startMediaDlqReplayer();
  }

  initEmailWorker();

  state.healthcheck = startWorkerHealthcheck("media-worker", {
    pool,
    redis: getRedisConnection(),
  });

  await tickQuarantine();
  state.quarantineTimer = setInterval(
    tickQuarantine,
    env.OCI_QUARANTINE_SCAN_INTERVAL_MS,
  );
  state.streamDepthTimer = setInterval(checkStreamDepth, 15_000);

  logger.info({ topic: "worker:media" }, "Media worker consolidado iniciado");
}

export async function stopMediaWorker(): Promise<void> {
  state.isShuttingDown = true;

  if (state.streamDepthTimer) clearInterval(state.streamDepthTimer);
  if (state.quarantineTimer) clearInterval(state.quarantineTimer);

  const deadline = Date.now() + 5000;
  while (state.isQuarantineTicking && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (state.healthcheck) {
    state.healthcheck.stop();
  }

  stopMediaDlqReplayer();
  await stopIdentityEventConsumer().catch(() => undefined);
  await stopMediaCommandWorker().catch((err) =>
    logger.error({ err, topic: "worker:media" }, "Error al detener comando worker"),
  );

  if (state.emailWorker) {
    await state.emailWorker.close().catch(() => undefined);
  }
  if (state.emailRedis) {
    await state.emailRedis.quit().catch(() => undefined);
  }

  await closeRedisConnections();
  await pool.end().catch(() => undefined);
  logger.info({ topic: "worker:media" }, "Media worker consolidado detenido");
}

const isDirectRun = Boolean(
  process.argv[1] &&
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1]),
);

if (isDirectRun) {
  const shutdown = async () => {
    await stopMediaWorker();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  await startMediaWorker();
}
