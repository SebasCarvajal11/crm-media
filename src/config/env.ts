import { z } from "zod";
import "dotenv/config";
import { getLogger } from "../shared/logger";

const envSchema = z.object({
  PORT: z.coerce.number().default(3002),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1),
  DB_SCHEMA: z.literal("schema_media"),
  OCI_CONFIG_FILE_PATH: z.string().min(1),
  OCI_CONFIG_PROFILE: z.string().default("DEFAULT"),
  OCI_REGION: z.string().min(1),
  OCI_NAMESPACE: z.string().min(1),
  OCI_BUCKET_AVATARS_PUBLIC: z.string().min(1),
  OCI_BUCKET_DOCS_PRIVATE: z.string().min(1),
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
  MEDIA_COMMANDS_STREAM_KEY: z.string().default("media:commands"),
  MEDIA_RESPONSES_STREAM_KEY: z.string().default("media:responses"),
  MEDIA_COMMANDS_CONSUMER_GROUP: z.string().default("media-command-consumers"),
  /** Mismo valor que KrakenD/mod-auth/mod-collab; obligatorio en producción. */
  GATEWAY_TRUST_SECRET: z.string().min(32).optional(),
}).superRefine((data, ctx) => {
  if (data.REDIS_URL && !data.GATEWAY_TRUST_SECRET) {
    ctx.addIssue({
      code: "custom",
      path: ["GATEWAY_TRUST_SECRET"],
      message: "GATEWAY_TRUST_SECRET es requerido cuando REDIS_URL habilita comandos de media",
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
