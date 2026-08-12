import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { env } from "./config/env";
import { getLogger } from "./shared/logger";
import { initRedis, closeRedisConnections } from "./shared/redis";

const logger = getLogger();

if (process.env.REDIS_URL) initRedis(process.env.REDIS_URL);

const serverRef = serve({
  fetch: createApp().fetch,
  port: env.PORT,
});

let isShuttingDown = false;
const shutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal, topic: "shutdown" }, "cerrando recursos de mod-media");

  await new Promise<void>((resolve, reject) => {
    serverRef.close((err) => (err ? reject(err) : resolve()));
  }).catch((err) => logger.error({ err, topic: "shutdown" }, "server.close"));

  await closeRedisConnections();
  logger.info({ topic: "shutdown" }, "mod-media finalizado");
};

const exitAfterShutdown = (signal: string) => {
  void shutdown(signal).finally(() => process.exit(0));
};

process.once("SIGINT", () => exitAfterShutdown("SIGINT"));
process.once("SIGTERM", () => exitAfterShutdown("SIGTERM"));

logger.info({ port: env.PORT }, "mod-media listening");
