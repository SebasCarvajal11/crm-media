import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { env } from "../config/env";
import { documentService } from "../modules/media/document.service";
import { AppError } from "../shared/middlewares/error-handler.middleware";
import { getLogger } from "../shared/logger";
import { closeRedisConnections, getRedisConnection, getRedisSubscriber } from "../shared/redis";

const actorSchema = z.object({
  sub: z.string().uuid(),
  userId: z.string().min(1),
  role: z.enum(["admin", "worker", "client"]),
  email: z.string().email(),
});

const mediaCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("file.upload-url-requested"),
    correlationId: z.string().uuid(),
    requestedAt: z.string().optional(),
    objectKey: z.string().min(1),
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(120),
    sizeBytes: z.coerce.number().int().min(1).max(25 * 1024 * 1024),
    actor: actorSchema,
    signature: z.string().regex(/^[a-f0-9]{64}$/i),
  }),
  z.object({
    type: z.literal("file.metadata-requested"),
    correlationId: z.string().uuid(),
    requestedAt: z.string().optional(),
    objectKey: z.string().min(1),
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(120),
    sizeBytes: z.coerce.number().int().min(1).max(25 * 1024 * 1024),
    actor: actorSchema,
    signature: z.string().regex(/^[a-f0-9]{64}$/i),
  }),
  z.object({
    type: z.literal("file.access-requested"),
    correlationId: z.string().uuid(),
    requestedAt: z.string().optional(),
    objectKey: z.string().min(1),
    forceDownload: z.boolean().default(false),
    actor: actorSchema,
    signature: z.string().regex(/^[a-f0-9]{64}$/i),
  }),
  z.object({
    type: z.literal("file.delete-requested"),
    correlationId: z.string().uuid(),
    requestedAt: z.string().optional(),
    objectKey: z.string().min(1),
    actor: actorSchema,
    signature: z.string().regex(/^[a-f0-9]{64}$/i),
  }),
]);

type MediaCommand = z.infer<typeof mediaCommandSchema>;

const logger = getLogger();
let running = false;
let readLoopPromise: Promise<void> | null = null;

export async function startMediaCommandWorker(): Promise<void> {
  const redis = getRedisSubscriber();
  if (!redis) {
    logger.warn({ topic: "media-command-worker" }, "Redis no disponible; worker deshabilitado");
    return;
  }

  try {
    await redis.xgroup(
      "CREATE",
      env.MEDIA_COMMANDS_STREAM_KEY,
      env.MEDIA_COMMANDS_CONSUMER_GROUP,
      "0",
      "MKSTREAM",
    );
  } catch (err: any) {
    if (!err.message?.includes("already exists")) {
      throw err;
    }
  }

  running = true;
  readLoopPromise = readLoop(redis);
  logger.info(
    { topic: "media-command-worker", streamKey: env.MEDIA_COMMANDS_STREAM_KEY, consumerGroup: env.MEDIA_COMMANDS_CONSUMER_GROUP },
    "Consumidor activo",
  );
}

export async function stopMediaCommandWorker(): Promise<void> {
  running = false;
  const redis = getRedisConnection();
  if (redis) {
    await redis.xadd(env.MEDIA_COMMANDS_STREAM_KEY, "*", "__shutdown__", "1").catch(() => undefined);
  }

  if (readLoopPromise) {
    await Promise.race([
      readLoopPromise,
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);
  }
}

async function readLoop(redis: NonNullable<ReturnType<typeof getRedisSubscriber>>) {
  const consumerId = `${env.NODE_ENV}-${process.pid}`;

  while (running) {
    try {
      const results = (await redis.xreadgroup(
        "GROUP",
        env.MEDIA_COMMANDS_CONSUMER_GROUP,
        consumerId,
        "COUNT",
        25,
        "BLOCK",
        5000,
        "STREAMS",
        env.MEDIA_COMMANDS_STREAM_KEY,
        ">",
      )) as any[] | null;

      if (!results?.length) continue;

      for (const [, messages] of results) {
        for (const [messageId, fields] of messages ?? []) {
          const fieldMap = streamFieldsToMap(fields as string[]);
          if (fieldMap.get("__shutdown__") === "1") {
            await redis.xack(env.MEDIA_COMMANDS_STREAM_KEY, env.MEDIA_COMMANDS_CONSUMER_GROUP, messageId);
            continue;
          }

          const payload = fieldMap.get("payload");
          if (!payload) {
            await redis.xack(env.MEDIA_COMMANDS_STREAM_KEY, env.MEDIA_COMMANDS_CONSUMER_GROUP, messageId);
            continue;
          }

          await handlePayload(payload);
          await redis.xack(env.MEDIA_COMMANDS_STREAM_KEY, env.MEDIA_COMMANDS_CONSUMER_GROUP, messageId);
        }
      }
    } catch (err) {
      if (!running) break;
      logger.error({ err, topic: "media-command-worker" }, "Error leyendo comandos");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function handlePayload(payload: string) {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(payload);
  } catch {
    logger.warn({ topic: "media-command-worker" }, "Comando con JSON invalido");
    return;
  }

  const parsed = mediaCommandSchema.safeParse(parsedJson);
  if (!parsed.success) {
    logger.warn({
      topic: "media-command-worker",
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    }, "Comando invalido");
    return;
  }

  await processCommand(parsed.data);
}

async function processCommand(command: MediaCommand) {
  try {
    verifyMediaCommandSignature(command);

    if (command.type === "file.upload-url-requested") {
      const upload = await documentService.generateDocumentUploadUrlForCollabCommand(
        command.objectKey,
        command.fileName,
        command.mimeType,
        command.sizeBytes,
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
        command.objectKey,
        command.fileName,
        command.mimeType,
        command.sizeBytes,
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
        command.objectKey,
        command.forceDownload,
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

    await documentService.deleteDocumentForCollabCommand(command.objectKey);
    await publishResponse({
      type: "file.deleted",
      correlationId: command.correlationId,
      objectKey: command.objectKey,
    });
  } catch (err) {
    const statusCode = err instanceof AppError ? err.statusCode : 500;
    const message = err instanceof Error ? err.message : "Error procesando comando de media";
    await publishResponse({
      type: "file.command-failed",
      correlationId: command.correlationId,
      objectKey: command.objectKey,
      statusCode,
      message,
    });
  }
}

function verifyMediaCommandSignature(command: MediaCommand): void {
  if (!env.GATEWAY_TRUST_SECRET) {
    throw new AppError(500, "GATEWAY_TRUST_SECRET requerido para comandos de media");
  }

  const expected = createHmac("sha256", env.GATEWAY_TRUST_SECRET)
    .update(mediaCommandSigningPayload(command))
    .digest("hex");

  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(command.signature, "hex");
  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    throw new AppError(403, "Firma de comando de media invalida");
  }
}

function mediaCommandSigningPayload(command: MediaCommand): string {
  return JSON.stringify({
    type: command.type,
    correlationId: command.correlationId,
    requestedAt: command.requestedAt,
    objectKey: command.objectKey,
    forceDownload: command.type === "file.access-requested" ? command.forceDownload : undefined,
    fileName:
      command.type === "file.upload-url-requested" || command.type === "file.metadata-requested"
        ? command.fileName
        : undefined,
    mimeType:
      command.type === "file.upload-url-requested" || command.type === "file.metadata-requested"
        ? command.mimeType
        : undefined,
    sizeBytes:
      command.type === "file.upload-url-requested" || command.type === "file.metadata-requested"
        ? command.sizeBytes
        : undefined,
    actor: {
      sub: command.actor.sub,
      userId: command.actor.userId,
      role: command.actor.role,
      email: command.actor.email,
    },
  });
}

async function publishResponse(response: Record<string, unknown>) {
  const redis = getRedisConnection();
  if (!redis) {
    logger.error({ topic: "media-command-worker" }, "Redis no disponible para publicar respuesta");
    return;
  }
  await redis.xadd(env.MEDIA_RESPONSES_STREAM_KEY, "*", "payload", JSON.stringify(response));
}

function streamFieldsToMap(fields: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < fields.length - 1; i += 2) {
    map.set(fields[i], fields[i + 1]);
  }
  return map;
}

const isEntrypoint = process.argv[1]
  ? import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`
  : false;

if (isEntrypoint) {
  await startMediaCommandWorker();

  const shutdown = async () => {
    await stopMediaCommandWorker().catch((err) => logger.error({ err, topic: "media-command-worker" }, "stop"));
    await closeRedisConnections();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}
