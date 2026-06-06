import { env } from "../config/env";
import { getLogger } from "../shared/logger";
import { runQuarantineScan } from "../jobs/run-quarantine-scan";

const logger = getLogger();

logger.info(
  { intervalMs: env.OCI_QUARANTINE_SCAN_INTERVAL_MS, graceMs: env.OCI_QUARANTINE_GRACE_MS, topic: "worker:quarantine-scan" },
  "inicio",
);

const tick = async () => {
  try {
    const { scanned, moved, infected } = await runQuarantineScan();
    if (scanned > 0) {
      logger.info({ scanned, moved, infected, topic: "worker:quarantine-scan" }, "ciclo completado");
    }
  } catch (err) {
    logger.error({ err, topic: "worker:quarantine-scan" }, "error en ciclo");
  }
};

await tick();
const timer = setInterval(tick, env.OCI_QUARANTINE_SCAN_INTERVAL_MS);

const shutdown = () => {
  clearInterval(timer);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
