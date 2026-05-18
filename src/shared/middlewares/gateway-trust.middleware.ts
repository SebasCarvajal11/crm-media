import { createMiddleware } from "hono/factory";
import { env } from "../../config/env";
import { AppError } from "./error-handler.middleware";

/** Exige `X-Gateway-Trust` (KrakenD o mod-collab) cuando el secreto está configurado. */
export const gatewayTrustMiddleware = createMiddleware(async (c, next) => {
  if (!env.GATEWAY_TRUST_SECRET) {
    await next();
    return;
  }
  const trust = c.req.header("X-Gateway-Trust");
  if (trust !== env.GATEWAY_TRUST_SECRET) {
    throw new AppError(403, "Origen no autorizado");
  }
  await next();
});
