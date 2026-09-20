import { env } from "../config/env";
import { getLogger, traceStorage } from "../shared/logger";
import { closeRedisConnections, createRedisStreamConsumerConnection, getRedisConnection, initRedis } from "../shared/redis";
import { appendMediaCommandToDlq, startMediaDlqReplayer, stopMediaDlqReplayer } from "./media-command-dlq";
import { startWorkerHealthcheck } from "../shared/worker-health";
import { pool } from "../db/connection";
import {
  mediaCommandSchema,
  type MediaCommand,
} from "@sebascarvajal11/cima-contracts/media-asset-events";
import {
  RedisStreamConsumer,
  type DlqContext,
} from "@sebascarvajal11/cima-contracts/event-consumer";
import { startIdentityEventConsumer, stopIdentityEventConsumer } from "./identity-event.worker";
import { serviceMetrics } from "../app";
import { verifyMediaCommandSignature } from "./media-command-signature";
import { processCommand, publishResponse } from "./media-command-processor";

export { verifyMediaCommandSignature } from "./media-command-signature";
export { processCommand, publishResponse } from "./media-command-processor";

const logger = getLogger();

// ── Versioned schemas ─────────────────────────────────────────────────────────
const versionedSchemas = new Map([[1, mediaCommandSchema]]);

// ── Consumer instance ─────────────────────────────────────────────────────────
let consumer: RedisStreamConsumer<MediaCommand> | null = null;
let consumerRedis: NonNullable<ReturnType<typeof createRedisStreamConsumerConnection>> | undefined;

export async function startMediaCommandWorker(): Promise<void> {
  const redis = createRedisStreamConsumerConnection();
  if (!redis) {
    logger.warn({ topic: "media-command-worker" }, "Redis no disponible; worker deshabilitado");
    return;
  }

  consumerRedis = redis;

  consumer = new RedisStreamConsumer<MediaCommand>({
    streamKey: env.MEDIA_COMMANDS_STREAM_KEY,
    groupName: env.MEDIA_COMMANDS_CONSUMER_GROUP,
    consumerId: `${env.NODE_ENV}-${process.pid}`,
    versionedSchemas,
    handler: handleMediaCommand,
    onDlq: handleDlq,
    maxRetries: env.MEDIA_COMMANDS_MAX_RETRIES,
    pendingIdleMs: env.MEDIA_COMMANDS_PENDING_IDLE_MS,
    batchSize: 25,
    blockMs: 5000,
    errorDelayMs: 1000,
  });

  await consumer.start(redis);
  logger.info(
    { topic: "media-command-worker", streamKey: env.MEDIA_COMMANDS_STREAM_KEY, consumerGroup: env.MEDIA_COMMANDS_CONSUMER_GROUP },
    "Consumidor activo",
  );
}

export async function stopMediaCommandWorker(): Promise<void> {
  const pub = getRedisConnection();
  if (consumer && pub) {
    await consumer.stop(pub);
    consumer = null;
  }
  await consumerRedis?.quit().catch(() => undefined);
  consumerRedis = undefined;
}

// ── DLQ handler ───────────────────────────────────────────────────────────────
async function handleDlq(ctx: DlqContext): Promise<void> {
  const redis = getRedisConnection();
  if (!redis) {
    logger.error({ ctx }, "[media-command-worker] Redis no disponible para escribir en DLQ");
    return;
  }

  // Attempt to publish a failure response back to collab if correlationId is present
  if (ctx.payload) {
    try {
      const cmdJson = JSON.parse(ctx.payload);
      if (cmdJson?.correlationId) {
        await publishResponse({
          type: "file.command-failed",
          correlationId: cmdJson.correlationId,
          objectKey: cmdJson.objectKey,
          statusCode: 500,
          message: ctx.errorMessage,
        });
      }
    } catch {
      // ignore — best effort
    }
  }

  try {
    const dlqId = await appendMediaCommandToDlq(redis, {
      sourceStream: ctx.sourceStream,
      sourceGroup: ctx.sourceGroup,
      sourceMessageId: ctx.sourceMessageId,
      consumerId: ctx.consumerId,
      failedAt: ctx.failedAt,
      deliveryCount: ctx.deliveryCount,
      reason: ctx.reason,
      errorName: ctx.errorName,
      errorMessage: ctx.errorMessage,
      errorStack: ctx.errorStack,
      payload: ctx.payload,
      rawFields: ctx.rawFields,
    });
    logger.error(
      { messageId: ctx.sourceMessageId, dlqId, reason: ctx.reason, deliveryCount: ctx.deliveryCount },
      "[media-command-worker] Comando movido a DLQ",
    );
  } catch (err) {
    logger.error({ err, messageId: ctx.sourceMessageId }, "[media-command-worker] Error crítico moviendo comando a DLQ");
  }
}

// ── Business handler ──────────────────────────────────────────────────────────
async function handleMediaCommand(command: MediaCommand): Promise<void> {
  const traceId = (command as any).traceId;
  const correlationId = (command as any).correlationId;

  const action = async () => {
    await verifyMediaCommandSignature(command);
    await processCommand(command);

    const conn = getRedisConnection();
    if (conn) {
      await conn
        .hincrby("metrics:commands:processed", `${command.type}:v${(command as any).version ?? 1}`, 1)
        .catch((err) => logger.warn({ err }, "No se pudo incrementar métrica de comando procesado en Redis"));
    }
    logger.info(
      { commandType: command.type, commandVersion: (command as any).version ?? 1, topic: "command-metrics", success: true },
      `Métrica de comando procesado: ${command.type}`,
    );
  };

  const finalTraceId = traceId || `cmd-${Date.now()}`;
  await traceStorage.run({ traceId: finalTraceId, correlationId }, action);
}

// ── Entrypoint ────────────────────────────────────────────────────────────────
const isEntrypoint = process.argv[1]
  ? import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`
  : false;

if (isEntrypoint) {
  if (process.env.REDIS_URL) initRedis(process.env.REDIS_URL);
  await startMediaCommandWorker();
  await startIdentityEventConsumer();
  startMediaDlqReplayer();

  const healthcheck = startWorkerHealthcheck("media-command-worker", {
    pool,
    redis: getRedisConnection(),
  });

  const streamDepthTimer = setInterval(async () => {
    try {
      const pub = getRedisConnection();
      if (!pub) return;
      const pending = await pub.xpending(
        env.MEDIA_COMMANDS_STREAM_KEY,
        env.MEDIA_COMMANDS_CONSUMER_GROUP,
      );
      const pendingCount = Array.isArray(pending) ? Number(pending[0]) : 0;
      serviceMetrics.streamConsumerGroupDepth.set(
        { stream: env.MEDIA_COMMANDS_STREAM_KEY, group: env.MEDIA_COMMANDS_CONSUMER_GROUP },
        pendingCount,
      );
    } catch {
      // Best-effort
    }
  }, 15_000);

  const shutdown = async () => {
    clearInterval(streamDepthTimer);
    healthcheck.stop();
    stopMediaDlqReplayer();
    await stopIdentityEventConsumer().catch(() => undefined);
    await stopMediaCommandWorker().catch((err) => logger.error({ err, topic: "media-command-worker" }, "stop"));
    await closeRedisConnections();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}
