import NodeClam from "clamscan";
import { Readable } from "node:stream";
import { env } from "../../config/env";

type ClamScanner = { scanStream(stream: Readable): Promise<{ isInfected: boolean }> };

let scanner: ClamScanner | null = null;

const getScanner = async (): Promise<ClamScanner> => {
  if (scanner) return scanner;
  const clamscan = await new NodeClam().init({
    clamdscan: {
      host: env.CLAMAV_HOST,
      port: env.CLAMAV_PORT,
      timeout: 30000,
      localFallback: false,
    },
  });
  scanner = clamscan as unknown as ClamScanner;
  return scanner;
};

export const scanBufferForVirus = async (buffer: Buffer) => {
  const clamd = await getScanner();
  const { isInfected } = await clamd.scanStream(Readable.from(buffer));
  return !isInfected;
};
