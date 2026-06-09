import { db } from "../../../db/connection";
import { auditLogs } from "../../../db/schema";
import { traceStorage, getLogger } from "../../../shared/logger";
import { getRedisConnection } from "../../../shared/redis";
import { env } from "../../../config/env";
import { auditEventSchema, type AuditEvent } from "@sebascarvajal11/cima-contracts/audit-events";
import { STREAM_CONVENTIONS } from "@sebascarvajal11/cima-contracts/stream-conventions";

const logger = getLogger();

export type DB = typeof db;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type DbOrTx = DB | Tx;

export async function publishAuditEvent(
  event: Omit<AuditEvent, "version" | "contractVersion" | "type" | "timestamp" | "traceId"> & {
    timestamp?: string;
  }
): Promise<void> {
  const store = traceStorage.getStore();
  const fullEvent: AuditEvent = {
    version: 1,
    contractVersion: 1,
    type: "audit.event-published",
    actorSub: event.actorSub,
    actorEmail: event.actorEmail,
    actorRole: event.actorRole,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    ipAddress: event.ipAddress,
    userAgent: event.userAgent,
    correlationId: event.correlationId ?? store?.correlationId,
    details: event.details,
    timestamp: event.timestamp ?? new Date().toISOString(),
    traceId: store?.traceId,
  };

  const parsed = auditEventSchema.safeParse(fullEvent);
  if (!parsed.success) {
    logger.error({
      topic: "event-publisher:audit",
      issues: parsed.error.issues.map((issue: any) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    }, "Audit event invalido");
    throw new Error("Audit event no cumple el contrato compartido");
  }

  const redis = getRedisConnection();
  if (!redis) {
    logger.warn({ topic: "event-publisher:audit" }, "Redis no disponible; omitiendo publicacion de audit event");
    return;
  }

  try {
    const streamKey = env.AUDIT_EVENTS_STREAM_KEY ?? STREAM_CONVENTIONS.streams.audit.events;
    const maxLen = env.AUDIT_EVENTS_STREAM_MAXLEN ?? 10000;
    await redis.xadd(
      streamKey,
      "MAXLEN",
      "~",
      maxLen,
      "*",
      "payload",
      JSON.stringify(parsed.data)
    );
  } catch (err) {
    logger.error({ err, topic: "event-publisher:audit" }, "Fallo al publicar audit event");
  }
}

export interface CreateMediaAuditParams {
  actorSub: string | null;
  actorEmail?: string | null;
  actorRole?: "admin" | "worker" | "client" | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  ipAddress: string;
  userAgent: string;
  correlationId?: string | null;
  details?: Record<string, unknown> | null;
}

export const createAuditRepository = (conn: DbOrTx = db) => ({
  createAuditLog: async (
    params: CreateMediaAuditParams
  ): Promise<void> => {
    const store = traceStorage.getStore();
    const correlationId = params.correlationId ?? store?.correlationId ?? null;

    await conn.insert(auditLogs).values({
      actorSub: params.actorSub,
      actorEmail: params.actorEmail ?? null,
      actorRole: params.actorRole ?? null,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId ?? null,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      correlationId,
      details: params.details ?? null,
    });

    const sensitiveActions = [
      "file.uploaded",
      "file.deleted",
      "avatar.updated",
      "virus.detected",
    ];

    if (sensitiveActions.includes(params.action)) {
      try {
        await publishAuditEvent({
          actorSub: params.actorSub,
          actorEmail: params.actorEmail ?? null,
          actorRole: params.actorRole ?? null,
          action: params.action,
          resourceType: params.resourceType,
          resourceId: params.resourceId ?? null,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
          correlationId,
          details: params.details ?? null,
        });
      } catch (err) {
        logger.warn({ err, action: params.action }, "No se pudo publicar evento de auditoria");
      }
    }
  },
});
