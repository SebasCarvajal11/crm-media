import { env } from "../config/env";
import { collabDocumentService } from "../modules/media/collab-document.service";
import { getLogger, traceStorage } from "../shared/logger";
import { getRedisConnection } from "../shared/redis";
import {
  MEDIA_ASSET_CONTRACT_VERSION,
  type MediaCommand,
} from "@sebascarvajal11/cima-contracts/media-asset-events";

const logger = getLogger();

export async function publishResponse(response: Record<string, unknown>): Promise<void> {
  response.version = 1;
  response.contractVersion = MEDIA_ASSET_CONTRACT_VERSION;

  const store = traceStorage.getStore();
  if (store) {
    response.traceId = response.traceId ?? store.traceId;
    response.correlationId = response.correlationId ?? store.correlationId;
  }
  const redis = getRedisConnection();
  if (!redis) {
    logger.error({ topic: "media-command-processor" }, "Redis no disponible para publicar respuesta");
    return;
  }
  await redis.xadd(env.MEDIA_RESPONSES_STREAM_KEY, "*", "payload", JSON.stringify(response));

  const responseType = String(response.type || "unknown");
  const responseVersion = Number(response.version ?? 1);
  await redis
    .hincrby("metrics:events:published", `${responseType}:v${responseVersion}`, 1)
    .catch((err) => logger.warn({ err }, "No se pudo incrementar métrica de respuesta publicada en Redis"));
  logger.info(
    { responseType, responseVersion, topic: "event-metrics" },
    `Métrica de respuesta publicada: ${responseType} v${responseVersion}`,
  );
}

export async function processCommand(command: MediaCommand): Promise<void> {
  if (command.type === "file.upload-url-requested") {
    const upload = await collabDocumentService.generateDocumentUploadUrlForCollabCommand(
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
    const metadata = await collabDocumentService.resolveDocumentMetadataForCollabCommand(
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
    const access = await collabDocumentService.getDocumentAccessUrlForCollabCommand(
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

  // file.delete-requested
  await collabDocumentService.deleteDocumentForCollabCommand(command.objectKey, command.actor);
  await publishResponse({
    type: "file.deleted",
    correlationId: command.correlationId,
    objectKey: command.objectKey,
  });
}
