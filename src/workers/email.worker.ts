import { Worker } from "bullmq";
import Redis from "ioredis";
import { env } from "../config/env";
import { EMAIL_QUEUE_NAME } from "../modules/email/email.queue";
import { processEmailJob } from "../modules/email/email.processor";
import { getLogger } from "../shared/logger";
import { startWorkerHealthcheck } from "../shared/worker-health";

const logger = getLogger();

if (!env.REDIS_URL) {
  logger.error({ topic: "worker:email" }, "REDIS_URL es requerido para el worker de correo");
  process.exit(1);
}

const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

const worker = new Worker(EMAIL_QUEUE_NAME, processEmailJob, {
  connection: connection as any,
  prefix: "media",
  concurrency: 5,
});

const healthcheck = startWorkerHealthcheck("media-email-worker", { redis: connection });

worker.on("failed", (job, err) => {
  logger.error({ err, topic: "worker:email", jobId: job?.id }, "Email job failed");
});

worker.on("error", (err) => {
  logger.error({ err, topic: "worker:email" }, "Worker connection error");
});

worker.on("completed", (job) => {
  logger.info({ topic: "worker:email", jobId: job.id }, "Email successfully dispatched");
});

logger.info({ topic: "worker:email", queue: EMAIL_QUEUE_NAME }, "Email worker listening");

const shutdown = async () => {
  logger.info({ topic: "worker:email" }, "Shutting down email worker");
  healthcheck.stop();
  await worker.close();
  await connection.quit();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);