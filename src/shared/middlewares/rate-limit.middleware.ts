import { createMiddleware } from "hono/factory";
import { AppError } from "./error-handler.middleware";

interface RateRecord {
  count: number;
  resetAt: number;
}

const attempts = new Map<string, RateRecord>();

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupExpired(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, record] of attempts) {
    if (record.resetAt <= now) {
      attempts.delete(key);
    }
  }
}

/** Rate limit por usuario autenticado (cabeceras del gateway) y ruta. */
export function userRateLimit(opts: { maxAttempts: number; windowMs: number }) {
  return createMiddleware(async (c, next) => {
    const userKey =
      c.req.header("x-user-id")?.trim() ||
      c.req.header("x-user-sub")?.trim() ||
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";
    const bucketKey = `${c.req.path}:${userKey}`;
    const now = Date.now();

    cleanupExpired(now);

    const record = attempts.get(bucketKey);
    if (record && record.resetAt > now) {
      if (record.count >= opts.maxAttempts) {
        throw new AppError(429, "Demasiadas solicitudes. Intenta más tarde.");
      }
      record.count++;
    } else {
      attempts.set(bucketKey, { count: 1, resetAt: now + opts.windowMs });
    }

    await next();
  });
}
