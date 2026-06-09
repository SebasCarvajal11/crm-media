import { env } from "../config/env";
import { collabJwksClient } from "../config/jwks-client";
import { documentService } from "../modules/media/document.service";
import { AppError } from "../shared/middlewares/error-handler.middleware";
import { getLogger, traceStorage } from "../shared/logger";
import { closeRedisConnections, getRedisConnection, getRedisSubscriber } from "../shared/redis";
import { appendMediaCommandToDlq, streamFieldsToObject, startMediaDlqReplayer, stopMediaDlqReplayer } from "./media-command-dlq";
import { startWorkerHealthcheck } from "../shared/worker-health";
import { pool } from "../db/connection";
import {
  mediaCommandSchema,
  MEDIA_ASSET_CONTRACT_VERSION,
  type MediaCommand,
} from "@sebascarvajal11/cima-contracts/media-asset-events";
import {
  RedisStreamConsumer,
  NonRetryableStreamError,
  type DlqContext,
} from "@sebascarvajal11/cima-contracts/event-consumer";
import { startIdentityEventConsumer, stopIdentityEventConsumer } from "./identity-event.worker";
import { serviceMetrics } from "../app";

const logger = getLogger();

// ── Versioned schemas ─────────────────────────────────────────────────────────
//
// Media commands are currently version 1 only.
// Adding v2 requires only: bump this map + add a handler branch in processCommand.

const versionedSchemas = new Map([[1, mediaCommandSchema]]);

// ── Consumer instance ─────────────────────────────────────────────────────────

let consumer: RedisStreamConsumer<MediaCommand> | null = null;

export async function startMediaCommandWorker(): Promise<void> {
  const redis = getRedisSubscriber();
  if (!redis) {
    logger.warn({ topic: "media-command-worker" }, "Redis no disponible; worker deshabilitado");
    return;
  }

  consumer = new RedisStreamConsumer<MediaCommand>({
    streamKey:        env.MEDIA_COMMANDS_STREAM_KEY,
    groupName:        env.MEDIA_COMMANDS_CONSUMER_GROUP,
    consumerId:       `${env.NODE_ENV}-${process.pid}`,
    versionedSchemas,
    handler:          handleMediaCommand,
    onDlq:            handleDlq,
    maxRetries:       env.MEDIA_COMMANDS_MAX_RETRIES,
    pendingIdleMs:    env.MEDIA_COMMANDS_PENDING_IDLE_MS,
    batchSize:        25,
    blockMs:          5000,
    errorDelayMs:     1000,
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
          type:          "file.command-failed",
          correlationId: cmdJson.correlationId,
          objectKey:     cmdJson.objectKey,
          statusCode:    500,
          message:       ctx.errorMessage,
        });
      }
    } catch {
      // ignore — best effort
    }
  }

  try {
    const dlqId = await appendMediaCommandToDlq(redis, {
      sourceStream:    ctx.sourceStream,
      sourceGroup:     ctx.sourceGroup,
      sourceMessageId: ctx.sourceMessageId,
      consumerId:      ctx.consumerId,
      failedAt:        ctx.failedAt,
      deliveryCount:   ctx.deliveryCount,
      reason:          ctx.reason,
      errorName:       ctx.errorName,
      errorMessage:    ctx.errorMessage,
      errorStack:      ctx.errorStack,
      payload:         ctx.payload,
      rawFields:       ctx.rawFields,
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

/**
 * Handler principal para los media commands.
 * El payload ya está parseado y validado como MediaCommand (v1) por RedisStreamConsumer.
 * Lanza NonRetryableStreamError para bypass inmediato a DLQ.
 */
async function handleMediaCommand(command: MediaCommand): Promise<void> {
  const traceId       = (command as any).traceId;
  const correlationId = (command as any).correlationId;

  const action = async () => {
    await verifyMediaCommandSignature(command);
    await processCommand(command);

    // Record success metric
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

async function processCommand(command: MediaCommand): Promise<void> {
  if (command.type === "file.upload-url-requested") {
    const upload = await documentService.generateDocumentUploadUrlForCollabCommand(
      command.objectKey, command.fileName, command.mimeType, command.sizeBytes,
    );
    await publishResponse({
      type: "file.upload-url-created",
      correlationId: command.correlationId,
      objectKey: command.objectKey,
      uploadUrl: upload.uploadUrl,
      expiresInSeconds: upload.expiresInSeconds,
    });
    return;
  }

  if (command.type === "file.metadata-requested") {
    const metadata = await documentService.resolveDocumentMetadataForCollabCommand(
      command.objectKey, command.fileName, command.mimeType, command.sizeBytes,
    );
    await publishResponse({
      type: "file.metadata-resolved",
      correlationId: command.correlationId,
      objectKey: command.objectKey,
      sizeBytes: metadata.sizeBytes,
      mimeType: metadata.mimeType,
    });
    return;
  }

  if (command.type === "file.access-requested") {
    const access = await documentService.getDocumentAccessUrlForCollabCommand(
      command.objectKey, command.forceDownload,
    );
    await publishResponse({
      type: "file.access-granted",
      correlationId: command.correlationId,
      objectKey: command.objectKey,
      url: access.url,
      expiresInSeconds: access.expiresInSeconds,
    });
    return;
  }

  // file.delete-requested
  await documentService.deleteDocumentForCollabCommand(command.objectKey, command.actor);
  await publishResponse({
    type: "file.deleted",
    correlationId: command.correlationId,
    objectKey: command.objectKey,
  });
}

async function verifyMediaCommandSignature(command: MediaCommand): Promise<void> {
  const token = command.signature;

  let publicKeyPem: string;
  if (env.COLLAB_JWT_PUBLIC_KEY) {
    publicKeyPem = env.COLLAB_JWT_PUBLIC_KEY;
  } else if (collabJwksClient) {
    const [headerB64] = token.split(".");
    if (!headerB64) {
      throw new NonRetryableStreamError("Token JWT de servicio malformado", "invalid_signature");
    }
    let kid: string | undefined;
    try {
      kid = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8")).kid;
    } catch {
      throw new NonRetryableStreamError("Header de JWT de servicio inválido", "invalid_signature");
    }
    if (!kid) throw new NonRetryableStreamError("JWT sin kid en el header", "invalid_signature");
    publicKeyPem = await collabJwksClient.getPublicKeyPem(kid);
  } else {
    throw new AppError(500, "Configuración de verificación de servicio incompleta");
  }

  const { createVerify, createPublicKey } = await import("node:crypto");
  const [headerB64, payloadB64, signatureB64] = token.split(".");
  if (!headerB64 || !payloadB64 || !signatureB64) {
    throw new NonRetryableStreamError("Token JWT de servicio malformado", "invalid_signature");
  }

  let payload: any;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    throw new NonRetryableStreamError("Payload de JWT de servicio inválido", "invalid_signature");
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now)
    throw new NonRetryableStreamError("Token de servicio expirado", "invalid_signature");
  if (payload.iss !== env.COLLAB_JWT_ISS)
    throw new NonRetryableStreamError(`Issuer no coincide (esperado: ${env.COLLAB_JWT_ISS})`, "invalid_signature");
  if (payload.aud !== "crm-media")
    throw new NonRetryableStreamError("Audience no coincide", "invalid_signature");
  if (payload.purpose !== "media.command")
    throw new NonRetryableStreamError("Propósito de token inválido", "invalid_signature");
  if (payload.correlationId !== command.correlationId)
    throw new NonRetryableStreamError("correlationId no coincide con el comando", "invalid_signature");
  if (payload.commandType !== command.type)
    throw new NonRetryableStreamError("commandType no coincide con el comando", "invalid_signature");
  if (payload.objectKey !== command.objectKey)
    throw new NonRetryableStreamError("objectKey no coincide con el comando", "invalid_signature");

  const key = createPublicKey(publicKeyPem);
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  if (!verifier.verify(key, Buffer.from(signatureB64, "base64url"))) {
    throw new NonRetryableStreamError("Firma de JWT de servicio inválida", "invalid_signature");
  }
}

async function publishResponse(response: Record<string, unknown>): Promise<void> {
  response.version = 1;
  response.contractVersion = MEDIA_ASSET_CONTRACT_VERSION;

  const store = traceStorage.getStore();
  if (store) {
    response.traceId       = response.traceId       ?? store.traceId;
    response.correlationId = response.correlationId ?? store.correlationId;
  }
  const redis = getRedisConnection();
  if (!redis) {
    logger.error({ topic: "media-command-worker" }, "Redis no disponible para publicar respuesta");
    return;
  }
  await redis.xadd(env.MEDIA_RESPONSES_STREAM_KEY, "*", "payload", JSON.stringify(response));

  const responseType    = String(response.type || "unknown");
  const responseVersion = Number(response.version ?? 1);
  await redis
    .hincrby("metrics:events:published", `${responseType}:v${responseVersion}`, 1)
    .catch((err) => logger.warn({ err }, "No se pudo incrementar métrica de respuesta publicada en Redis"));
  logger.info(
    { responseType, responseVersion, topic: "event-metrics" },
    `Métrica de respuesta publicada: ${responseType} v${responseVersion}`,
  );
}

// ── Entrypoint ────────────────────────────────────────────────────────────────

const isEntrypoint = process.argv[1]
  ? import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`
  : false;

if (isEntrypoint) {
  await startMediaCommandWorker();
  await startIdentityEventConsumer();
  startMediaDlqReplayer();

  const healthcheck = startWorkerHealthcheck("media-command-worker", {
    pool,
    redis: getRedisConnection(),
  });

  // Actualizar gauge de profundidad del consumer group cada 15 s (XPENDING)
  const streamDepthTimer = setInterval(async () => {
    try {
      const pub = getRedisConnection();
      if (!pub) return;
      const pending = await pub.xpending(
        env.MEDIA_COMMANDS_STREAM_KEY,
        env.MEDIA_COMMANDS_CONSUMER_GROUP
      );
      const pendingCount = Array.isArray(pending) ? Number(pending[0]) : 0;
      serviceMetrics.streamConsumerGroupDepth.set(
        { stream: env.MEDIA_COMMANDS_STREAM_KEY, group: env.MEDIA_COMMANDS_CONSUMER_GROUP },
        pendingCount
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

  process.once("SIGINT",  () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}
