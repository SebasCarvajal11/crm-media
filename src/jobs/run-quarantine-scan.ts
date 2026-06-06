import { getNamespace, client } from "../shared/storage/oci-client";
import { env } from "../config/env";
import { getLogger } from "../shared/logger";
import { scanBufferForVirus } from "../shared/security/clamav";
import { ociStorage } from "../shared/storage/oci-storage";

const logger = getLogger();
const Q_PREFIX = "quarantine/documents/";

export async function runQuarantineScan(): Promise<{ scanned: number; moved: number; infected: number }> {
  const namespace = await getNamespace();
  const bucket = env.OCI_BUCKET_DOCS_PRIVATE;
  const graceMs = env.OCI_QUARANTINE_GRACE_MS;
  const now = Date.now();

  let scanned = 0;
  let moved = 0;
  let infected = 0;

  let start: string | undefined;
  do {
    const response = await client.listObjects({
      namespaceName: namespace,
      bucketName: bucket,
      prefix: Q_PREFIX,
      limit: 50,
      start,
    });

    const objects = response.listObjects?.objects ?? [];
    for (const item of objects) {
      if (!item.name) continue;
      const quarantineKey = item.name;
      scanned += 1;

      const ageMs = item.timeModified ? now - item.timeModified.getTime() : graceMs + 1;
      
      const maxQuarantineAgeMs = 2 * 60 * 60 * 1000;
      if (ageMs > maxQuarantineAgeMs) {
        logger.warn({ quarantineKey, topic: "quarantine-scan" }, "Objeto en cuarentena demasiado antiguo o corrupto. Eliminando");
        await ociStorage.deleteObject(bucket, quarantineKey);
        continue;
      }

      if (ageMs < graceMs) continue;

      try {
        const buffer = await ociStorage.getObjectBuffer(bucket, quarantineKey);
        const isClean = await scanBufferForVirus(buffer);
        if (!isClean) {
          await ociStorage.deleteObject(bucket, quarantineKey);
          infected += 1;
          logger.warn({ quarantineKey, topic: "quarantine-scan" }, "INFECTADO eliminado");
          continue;
        }
        const objectKey = quarantineKey.slice("quarantine/".length);
        const meta = await ociStorage.getObjectMetadata(bucket, quarantineKey);
        const mimeType = meta?.mimeType ?? "application/octet-stream";
        await ociStorage.uploadPrivateDocument(objectKey, buffer, mimeType);
        await ociStorage.deleteObject(bucket, quarantineKey);
        moved += 1;
        logger.info({ objectKey, topic: "quarantine-scan" }, "movido a producción");
      } catch (err) {
        logger.error({ err, quarantineKey, topic: "quarantine-scan" }, "error procesando");
      }
    }

    start = response.listObjects?.nextStartWith ?? undefined;
  } while (start);

  return { scanned, moved, infected };
}
