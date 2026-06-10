import { z } from "zod";
import "dotenv/config";
import { getLogger } from "../shared/logger";
import { STREAM_CONVENTIONS } from "@sebascarvajal11/cima-contracts";

const envSchema = z.object({
  PORT: z.coerce.number().default(3002),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).optional(),
  SERVICE_NAME: z.string().optional(),
  DATABASE_URL: z.string().min(1),
  DB_SCHEMA: z.literal("schema_media"),
  SERVICE_VERSION: z.string().default("1.0.0"),
  OCI_CONFIG_FILE_PATH: z.string().min(1),
  OCI_CONFIG_PROFILE: z.string().default("DEFAULT"),
  OCI_REGION: z.string().min(1),
  OCI_NAMESPACE: z.string().min(1),
  OCI_BUCKET_AVATARS_PUBLIC: z.string().min(1),
  OCI_BUCKET_DOCS_PRIVATE: z.string().min(1),
  OCI_HEALTHCHECK_ENABLED: z
    .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
    .default("true")
    .transform((v) => v === "true" || v === "1"),
  CLAMAV_HOST: z.string().default("clamav-scanner"),
  CLAMAV_PORT: z.coerce.number().default(3310),
  /** Timeout de escaneo (ms); archivos hasta ~25 MB. */
  CLAMAV_SCAN_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(300_000).default(90_000),
  DOC_PAR_TTL_SECONDS: z.coerce.number().default(300),
  /** Máximo de PARs expirados a borrar por bucket en cada generación de PAR. */
  OCI_PAR_PRUNE_MAX: z.coerce.number().int().min(0).max(500).default(80),
  AVATAR_VERSIONS_TO_KEEP: z.coerce.number().int().min(1).default(3),
  /** Intervalo en ms del worker de escaneo de cuarentena. */
  OCI_QUARANTINE_SCAN_INTERVAL_MS: z.coerce.number().int().min(1000).default(30_000),
  /** Tiempo mínimo que un objeto debe estar en cuarentena antes de escanear (evita uploads incompletos). */
  OCI_QUARANTINE_GRACE_MS: z.coerce.number().int().min(0).default(30_000),
  REDIS_URL: z.string().url().optional(),
  MEDIA_COMMANDS_STREAM_KEY: z.string().default(STREAM_CONVENTIONS.streams.collab.mediaCommands),
  MEDIA_RESPONSES_STREAM_KEY: z.string().default(STREAM_CONVENTIONS.streams.media.assetResponses),
  MEDIA_COMMANDS_CONSUMER_GROUP: z.string().default(STREAM_CONVENTIONS.groups.media.commands),
  MEDIA_COMMANDS_DLQ_STREAM_KEY: z.string().default(STREAM_CONVENTIONS.streams.media.commandsDlq),
  AUDIT_EVENTS_STREAM_KEY: z.string().optional(),
  AUDIT_EVENTS_STREAM_MAXLEN: z.coerce.number().int().optional(),
  MEDIA_COMMANDS_MAX_RETRIES: z.coerce.number().int().min(1).max(20).default(3),
  MEDIA_COMMANDS_PENDING_IDLE_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(30_000),
  DLQ_AUTO_REPLAY_INTERVAL_MS: z.coerce.number().int().nonnegative().default(60000),
  RATE_LIMIT_MEDIA_AVATAR_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_MEDIA_AVATAR_WINDOW_MS: z.coerce.number().int().positive().default(60 * 60 * 1000),
  RATE_LIMIT_MEDIA_DOC_UPLOAD_MAX: z.coerce.number().int().positive().default(40),
  RATE_LIMIT_MEDIA_DOC_UPLOAD_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MEDIA_DOC_CONFIRM_MAX: z.coerce.number().int().positive().default(40),
  RATE_LIMIT_MEDIA_DOC_CONFIRM_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  /** URI del endpoint JWKS de crm-collab para verificar comandos de media. */
  COLLAB_JWKS_URI: z.string().url().optional(),
  /** SPKI PEM (RSA) para verificación local de comandos de crm-collab (sin JWKS). */
  COLLAB_JWT_PUBLIC_KEY: z.string().min(1).optional(),
  /** Issuer claim esperado en los comandos. */
  COLLAB_JWT_ISS: z.string().default("crm-collab"),
  /**
   * Si true, el servicio confía en los claims propagados (X-User-*) tras validación.
   * Si false, cada request debe incluir un Bearer JWT válido.
   */
  TRUST_GATEWAY_JWT_HEADERS: z
    .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  /** SPKI PEM (RSA) para verificación local de JWT (sin JWKS). */
  JWT_PUBLIC_KEY: z.string().min(1).optional(),
  /** URI del endpoint JWKS de crm-auth. Alternativa a JWT_PUBLIC_KEY. */
  JWKS_URI: z.string().url().optional(),
  /** TTL del caché de claves JWKS en milisegundos. Por defecto 5 minutos. */
  JWKS_CACHE_TTL_MS: z.coerce.number().int().min(10_000).default(5 * 60 * 1000),
  /** Issuer claim esperado en los tokens. Opcional. */
  JWT_ISS: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.REDIS_URL && !data.COLLAB_JWKS_URI && !data.COLLAB_JWT_PUBLIC_KEY) {
    ctx.addIssue({
      code: "custom",
      path: ["COLLAB_JWKS_URI"],
      message: "COLLAB_JWKS_URI o COLLAB_JWT_PUBLIC_KEY es requerido cuando REDIS_URL habilita comandos de media",
    });
  }
  if (!data.TRUST_GATEWAY_JWT_HEADERS && !data.JWT_PUBLIC_KEY && !data.JWKS_URI) {
    ctx.addIssue({
      code: "custom",
      path: ["JWT_PUBLIC_KEY"],
      message: "JWT_PUBLIC_KEY o JWKS_URI es requerida cuando TRUST_GATEWAY_JWT_HEADERS=false",
    });
  }
});

const logger = getLogger();
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  logger.error({ fields: parsed.error.flatten().fieldErrors }, "Invalid mod-media env vars");
  process.exit(1);
}

export const env = parsed.data;
