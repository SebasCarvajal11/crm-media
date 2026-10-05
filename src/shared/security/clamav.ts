import NodeClam from "clamscan";
import { Readable } from "node:stream";
import { env } from "../../config/env";
import { getLogger } from "../logger";
import { validateDocumentMagicBytes } from "./file-validation";
import { Sha256ReputationService } from "./sha256-reputation.service";
import { clamavStandbyController } from "./clamav-standby.controller";

const logger = getLogger();

type ClamScanner = {
  scanStream(stream: Readable): Promise<{ isInfected: boolean; viruses?: string[] }>;
};

let scanner: ClamScanner | null = null;

clamavStandbyController.registerScannerReset(() => {
  scanner = null;
});

const getScanner = async (): Promise<ClamScanner> => {
  if (scanner) return scanner;
  const clamscan = await new NodeClam().init({
    clamdscan: {
      host: env.CLAMAV_HOST,
      port: env.CLAMAV_PORT,
      timeout: env.CLAMAV_SCAN_TIMEOUT_MS,
      localFallback: false,
    },
  });
  scanner = clamscan as unknown as ClamScanner;
  return scanner;
};

export interface ScanBufferOptions {
  fileName?: string;
  mimeType?: string;
}

export const scanBufferForVirus = async (
  buffer: Buffer,
  options?: ScanBufferOptions
): Promise<boolean> => {
  const magicValidation = validateDocumentMagicBytes(buffer, options?.mimeType, options?.fileName);
  if (!magicValidation.valid) {
    logger.warn({ error: magicValidation.error, topic: "clamav" }, "Archivo rechazado por validación in-process");
    return false;
  }

  const sha256 = Sha256ReputationService.computeSha256(buffer);
  const reputation = await Sha256ReputationService.getReputation(sha256);

  if (reputation.status === "clean") {
    logger.info({ sha256, topic: "clamav" }, "Archivo limpio verificado vía reputación SHA-256");
    return true;
  }
  if (reputation.status === "infected") {
    logger.warn({ sha256, virus: reputation.virusName, topic: "clamav" }, "Archivo infectado detectado vía reputación");
    return false;
  }

  clamavStandbyController.notifyScanStarted();
  try {
    const isReady = clamavStandbyController.ensureReady
      ? await clamavStandbyController.ensureReady()
      : true;
    if (!isReady) {
      throw new Error("El servicio antivirus ClamAV no está listo o no responde");
    }
    const clamd = await getScanner();
    const { isInfected, viruses } = await clamd.scanStream(Readable.from(buffer));
    const virusName = isInfected ? (viruses?.[0] ?? "Infected") : null;

    await Sha256ReputationService.recordReputation({
      sha256,
      status: isInfected ? "infected" : "clean",
      virusName,
      sizeBytes: buffer.length,
      mimeType: options?.mimeType,
      scannedBy: "clamav",
    });

    return !isInfected;
  } finally {
    clamavStandbyController.notifyScanCompleted();
  }
};
