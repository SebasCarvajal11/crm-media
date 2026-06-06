import { Hono } from "hono";
import { mediaRoutes } from "./modules/media/media.routes";
import { createOpenApiRoutes } from "./openapi/openapi.routes";
import { onError } from "./shared/middlewares/error-handler.middleware";
import { checkPostgres, checkRedis, buildHealthResponse } from "./shared/health";
import { checkOci } from "./shared/health-oci";
import { checkClamav } from "./shared/health-clamav";
import { pool } from "./db/connection";
import { getRedisConnection } from "./shared/redis";
import { client as ociClient } from "./shared/storage/oci-client";
import { env } from "./config/env";
import { initLogger } from "./shared/logger";
import { requestLoggerMiddleware } from "./shared/middlewares/request-logger.middleware";

const logger = initLogger("mod-media");
const healthStartTime = Date.now();

export const createApp = () => {
  const app = new Hono();
  app.use("*", requestLoggerMiddleware());

  app.get("/health", async (c) => {
    const [pg, redis, oci, clamav] = await Promise.all([
      checkPostgres(pool),
      checkRedis(getRedisConnection()),
      checkOci(ociClient),
      checkClamav(env.CLAMAV_HOST, env.CLAMAV_PORT),
    ]);

    const { body, status } = buildHealthResponse("mod-media", healthStartTime, [pg, redis, oci, clamav]);
    return c.json(body, status);
  });

  app.route("/", createOpenApiRoutes());

  // --- API v1 routes ---
  const v1 = new Hono();
  v1.route("/media", mediaRoutes);
  app.route("/api/v1", v1);

  // --- Rutas legacy (backward compatibility) ---
  app.route("/media", mediaRoutes);

  app.onError(onError);
  app.notFound((c) => c.json({ error: "Ruta no encontrada" }, 404));
  return app;
};
