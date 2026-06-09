import { env } from "../config/env";
import { getRedisConnection } from "../shared/redis";
import { getLogger } from "../shared/logger";

const logger = getLogger();

type RedisClient = {
  xadd: (...args: any[]) => Promise<string | null>;
  xrange: (...args: any[]) => Promise<[string, string[]][]>;
  xrevrange: (...args: any[]) => Promise<[string, string[]][]>;
  xdel: (...args: any[]) => Promise<number>;
};

export interface MediaCommandDlqRecord {
  sourceStream: string;
  sourceGroup: string;
  sourceMessageId: string;
  consumerId: string;
  failedAt: string;
  deliveryCount: number;
  reason: string;
  errorName: string;
  errorMessage: string;
  errorStack?: string;
  payload?: string;
  rawFields: Record<string, string>;
}

export interface MediaCommandDlqEntry extends MediaCommandDlqRecord {
  id: string;
}

export async function appendMediaCommandToDlq(
  redis: RedisClient,
  record: MediaCommandDlqRecord,
): Promise<string> {
  const fields = [
    "sourceStream",
    record.sourceStream,
    "sourceGroup",
    record.sourceGroup,
    "sourceMessageId",
    record.sourceMessageId,
    "consumerId",
    record.consumerId,
    "failedAt",
    record.failedAt,
    "deliveryCount",
    String(record.deliveryCount),
    "reason",
    record.reason,
    "errorName",
    record.errorName,
    "errorMessage",
    record.errorMessage,
    "rawFields",
    JSON.stringify(record.rawFields),
  ];

  if (record.errorStack) {
    fields.push("errorStack", record.errorStack);
  }

  if (record.payload) {
    fields.push("payload", record.payload);
  }

  const dlqId = await redis.xadd(env.MEDIA_COMMANDS_DLQ_STREAM_KEY, "*", ...fields);
  if (!dlqId) {
    throw new Error("Redis no devolvio id al escribir la entrada DLQ de media");
  }

  return dlqId;
}

export async function listMediaCommandDlqEntries(
  redis: RedisClient,
  limit = 25,
): Promise<MediaCommandDlqEntry[]> {
  const messages = await redis.xrevrange(
    env.MEDIA_COMMANDS_DLQ_STREAM_KEY,
    "+",
    "-",
    "COUNT",
    limit,
  );

  return messages.map(([id, fields]) => parseDlqEntry(id, fields));
}

export async function replayMediaCommandDlqEntry(
  redis: RedisClient,
  id: string,
  options: { removeAfterReplay?: boolean } = {},
): Promise<{ replayedMessageId: string; removed: boolean }> {
  const messages = await redis.xrange(env.MEDIA_COMMANDS_DLQ_STREAM_KEY, id, id);
  if (!messages.length) {
    throw new Error(`No existe entrada DLQ con id ${id}`);
  }

  const entry = parseDlqEntry(messages[0][0], messages[0][1]);
  if (!entry.payload) {
    throw new Error(`La entrada DLQ ${id} no contiene payload reinyectable`);
  }

  const replayedMessageId = await redis.xadd(
    entry.sourceStream || env.MEDIA_COMMANDS_STREAM_KEY,
    "*",
    "payload",
    entry.payload,
  );
  if (!replayedMessageId) {
    throw new Error(`Redis no devolvio id al reinyectar la entrada DLQ ${id}`);
  }

  let removed = false;
  if (options.removeAfterReplay !== false) {
    removed = (await redis.xdel(env.MEDIA_COMMANDS_DLQ_STREAM_KEY, id)) > 0;
  }

  return { replayedMessageId, removed };
}

export function streamFieldsToObject(fields: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < fields.length - 1; i += 2) {
    result[fields[i]] = fields[i + 1];
  }
  return result;
}

function parseDlqEntry(id: string, fields: string[]): MediaCommandDlqEntry {
  const map = streamFieldsToObject(fields);
  let rawFields: Record<string, string> = {};

  try {
    rawFields = map.rawFields ? JSON.parse(map.rawFields) : {};
  } catch {
    rawFields = {};
  }

  return {
    id,
    sourceStream: map.sourceStream ?? env.MEDIA_COMMANDS_STREAM_KEY,
    sourceGroup: map.sourceGroup ?? env.MEDIA_COMMANDS_CONSUMER_GROUP,
    sourceMessageId: map.sourceMessageId ?? "",
    consumerId: map.consumerId ?? "",
    failedAt: map.failedAt ?? "",
    deliveryCount: Number(map.deliveryCount ?? 0),
    reason: map.reason ?? "unknown",
    errorName: map.errorName ?? "Error",
    errorMessage: map.errorMessage ?? "",
    errorStack: map.errorStack,
    payload: map.payload,
    rawFields,
  };
}

let replayerInterval: NodeJS.Timeout | null = null;

export function startMediaDlqReplayer(): void {
  const intervalMs = env.DLQ_AUTO_REPLAY_INTERVAL_MS;
  if (!intervalMs || intervalMs <= 0) {
    logger.info("[media-dlq-replayer] Auto-replay deshabilitado");
    return;
  }

  logger.info({ intervalMs }, "[media-dlq-replayer] Iniciando auto-replay de DLQ");

  replayerInterval = setInterval(async () => {
    const redis = getRedisConnection();
    if (!redis) return;

    try {
      const entries = await listMediaCommandDlqEntries(redis, 10);
      if (entries.length === 0) return;

      logger.info({ count: entries.length }, "[media-dlq-replayer] Reintentando entradas DLQ");

      for (const entry of entries) {
        try {
          await replayMediaCommandDlqEntry(redis, entry.id);
          logger.info({ dlqId: entry.id }, "[media-dlq-replayer] Entrada DLQ reinyectada y removida con exito");
        } catch (err) {
          logger.error({ dlqId: entry.id, err }, "[media-dlq-replayer] Error reinyectando entrada DLQ");
        }
      }
    } catch (err) {
      logger.error({ err }, "[media-dlq-replayer] Error en ciclo de auto-replay");
    }
  }, intervalMs);
}

export function stopMediaDlqReplayer(): void {
  if (replayerInterval) {
    clearInterval(replayerInterval);
    replayerInterval = null;
    logger.info("[media-dlq-replayer] Auto-replay detenido");
  }
}
