import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { mediaRoutes } from "./modules/media/media.routes";
import { createGatewayRoutes } from "./gateway/gateway.routes";
import { createOpenApiRoutes } from "./openapi/openapi.routes";
import { onError } from "./shared/middlewares/error-handler.middleware";
import type { AppEnv } from "./shared/middlewares/auth.middleware";
import { authMiddleware } from "./shared/middlewares/auth.middleware";
import { securityHeadersMiddleware } from "./shared/middlewares/security.middleware";
import { checkPostgres, checkRedis } from "./shared/health";
import { buildHealthResponse } from "@sebascarvajal11/cima-contracts/health";
import {
  createServiceMetrics,
  metricsEndpointHandler,
  httpMetricsMiddleware,
  type ServiceMetrics,
} from "@sebascarvajal11/cima-contracts/metrics";
import { checkOci } from "./shared/health-oci";
import { checkClamav } from "./shared/health-clamav";
import { pool } from "./db/connection";
import { getRedisConnection } from "./shared/redis";
import { client as ociClient } from "./shared/storage/oci-client";
import { env } from "./config/env";
import { initLogger } from "./shared/logger";
import { requestLoggerMiddleware } from "./shared/middlewares/request-logger.middleware";
import { listMediaCommandDlqEntries, replayMediaCommandDlqEntry } from "./workers/media-command-dlq";

const logger = initLogger("mod-media");
const healthStartTime = Date.now();

/** Instancia de métricas compartida con los workers de este proceso. */
export const serviceMetrics: ServiceMetrics = createServiceMetrics("crm-media");

export const createApp = () => {
  const app = new Hono<AppEnv>();

  // --- Middlewares Globales ---
  app.use("*", requestLoggerMiddleware());
  app.use("*", securityHeadersMiddleware);
  app.use("*", httpMetricsMiddleware(serviceMetrics));
  app.use(
    "*",
    bodyLimit({
      maxSize: 10 * 1024 * 1024, // 10MB payload limit for Media service (to support avatar uploads)
      onError: (c) => {
        return c.json({ error: "El tamaño del payload excede el límite de 10MB" }, 413);
      },
    })
  );

  // --- (a) Grupo de Rutas Públicas ---
  const publicRoutes = new Hono<AppEnv>();

  publicRoutes.get("/api/v1/health", async (c) => {
    const [pg, redis, oci, clamav] = await Promise.all([
      checkPostgres(pool),
      checkRedis(getRedisConnection()),
      checkOci(ociClient),
      checkClamav(env.CLAMAV_HOST, env.CLAMAV_PORT),
    ]);

    const { body, status } = buildHealthResponse(env.SERVICE_VERSION, healthStartTime, {
      db: pg,
      redis,
      oci,
      clamav,
    });
    return c.json(body, status);
  });

  publicRoutes.get("/api/v1/metrics", metricsEndpointHandler(serviceMetrics.registry));

  publicRoutes.route("/api/v1", createOpenApiRoutes());
  app.route("/", publicRoutes);

  // --- (b) Grupo de Rutas Internas ---
  const internalRoutes = new Hono<AppEnv>();
  internalRoutes.route("/api/v1", createGatewayRoutes());

  // Ops / DLQ routes (internal only)
  const ops = new Hono<AppEnv>();

  ops.get("/dlq/media-commands", async (c) => {
    const limit = c.req.query("limit") ? Number(c.req.query("limit")) : 25;
    const redis = getRedisConnection();
    if (!redis) {
      return c.json({ error: "Redis no disponible" }, 503);
    }
    const entries = await listMediaCommandDlqEntries(redis, limit);
    return c.json(entries);
  });

  ops.post("/dlq/media-commands/replay", async (c) => {
    const redis = getRedisConnection();
    if (!redis) {
      return c.json({ error: "Redis no disponible" }, 503);
    }

    let body: any = {};
    try {
      body = await c.req.json();
    } catch {
      // Empty or invalid body is fine
    }

    const id = body?.id || c.req.query("id");
    if (id) {
      const result = await replayMediaCommandDlqEntry(redis, id);
      return c.json({ id, ...result });
    } else {
      const entries = await listMediaCommandDlqEntries(redis, 100);
      const results = [];
      for (const entry of entries) {
        try {
          const res = await replayMediaCommandDlqEntry(redis, entry.id);
          results.push({ id: entry.id, success: true, ...res });
        } catch (err: any) {
          results.push({ id: entry.id, success: false, error: err.message });
        }
      }
      return c.json({ replayed: results });
    }
  });

  internalRoutes.route("/api/v1/_ops", ops);
  app.route("/", internalRoutes);

  // --- (c) Grupo de Rutas Autenticadas (requieren JWT válido) ---
  const authenticatedRoutes = new Hono<AppEnv>();
  authenticatedRoutes.use("*", authMiddleware);
  authenticatedRoutes.route("/api/v1/media", mediaRoutes);
  
  app.route("/", authenticatedRoutes);

  // --- Manejador Global de Errores ---
  app.onError(onError);

  // --- 404 ---
  app.notFound((c) => c.json({ error: "Ruta no encontrada" }, 404));

  return app;
};
