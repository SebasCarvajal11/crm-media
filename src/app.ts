import { Hono } from "hono";
import { logger } from "hono/logger";
import { mediaRoutes } from "./modules/media/media.routes";
import { onError } from "./shared/middlewares/error-handler.middleware";

export const createApp = () => {
  const app = new Hono();
  app.use("*", logger());

  app.get("/health", (c) => c.json({ status: "ok", service: "mod-media" }));
  app.route("/media", mediaRoutes);

  app.onError(onError);
  app.notFound((c) => c.json({ error: "Ruta no encontrada" }, 404));
  return app;
};