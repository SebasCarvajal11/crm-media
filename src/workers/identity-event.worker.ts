import { z } from "zod";
import { getRedisSubscriber, getRedisConnection } from "../shared/redis";
import { env } from "../config/env";
import { getLogger, traceStorage } from "../shared/logger";
import { documentService } from "../modules/media/document.service";
import { STREAM_CONVENTIONS } from "@sebascarvajal11/cima-contracts";
import {
  authIdentityEventV1Schema,
  authIdentityEventV2Schema,
  type AuthIdentityEvent,
} from "@sebascarvajal11/cima-contracts/auth-identity-events";
import {
  RedisStreamConsumer,
  NonRetryableStreamError,
  type DlqContext,
} from "@sebascarvajal11/cima-contracts/event-consumer";

const logger = getLogger();

const STREAM_KEY = STREAM_CONVENTIONS.streams.identity.events;
const CONSUMER_GROUP = STREAM_CONVENTIONS.groups.media.authIdentity;

const versionedSchemas = new Map([
  [1, authIdentityEventV1Schema as z.ZodType<AuthIdentityEvent>],
  [2, authIdentityEventV2Schema as z.ZodType<AuthIdentityEvent>],
]);

let consumer: RedisStreamConsumer<AuthIdentityEvent> | null = null;

export async function startIdentityEventConsumer(): Promise<void> {
  const redis = getRedisSubscriber();
  if (!redis) {
    logger.info("[identity-event-consumer] Redis no disponible; consumer desactivado");
    return;
  }

  consumer = new RedisStreamConsumer<AuthIdentityEvent>({
    streamKey:     STREAM_KEY,
    groupName:     CONSUMER_GROUP,
    consumerId:    `media-${env.SERVICE_VERSION}-${process.pid}`,
    versionedSchemas,
    handler:       handleIdentityEvent,
    onDlq:         handleDlq,
    maxRetries:    3,
    pendingIdleMs: 30_000,
    batchSize:     25,
    blockMs:       5000,
    errorDelayMs:  1000,
  });

  await consumer.start(redis);
  logger.info(
    { consumerGroup: CONSUMER_GROUP, streamKey: STREAM_KEY },
    "[identity-event-consumer] Conectado como consumer",
  );
}

export async function stopIdentityEventConsumer(): Promise<void> {
  const pub = getRedisConnection();
  if (consumer && pub) {
    await consumer.stop(pub);
    consumer = null;
  }
}

async function handleIdentityEvent(event: AuthIdentityEvent): Promise<void> {
  if (event.type !== "user.deleted") {
    return;
  }

  const userSub = event.userSub;
  if (!userSub) {
    throw new NonRetryableStreamError(
      "Evento user.deleted sin userSub",
      "invalid_schema",
    );
  }

  await documentService.anonymizeUserPII(userSub);

  const conn = getRedisConnection();
  if (conn) {
    await conn
      .hincrby("metrics:events:processed", `user.deleted:v${event.version ?? 1}`, 1)
      .catch(() => undefined);
  }
  logger.info(
    { eventType: "user.deleted", topic: "event-metrics" },
    `Métrica de evento procesado: user.deleted v${event.version ?? 1}`,
  );
}

async function handleDlq(ctx: DlqContext): Promise<void> {
  logger.error(
    {
      messageId: ctx.sourceMessageId,
      reason: ctx.reason,
      deliveryCount: ctx.deliveryCount,
    },
    "[identity-event-consumer] Evento movido a DLQ",
  );
}
