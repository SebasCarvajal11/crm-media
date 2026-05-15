import { z } from "zod";
import "dotenv/config";

const envSchema = z.object({
  PORT: z.coerce.number().default(3002),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1),
  OCI_CONFIG_FILE_PATH: z.string().min(1),
  OCI_CONFIG_PROFILE: z.string().default("DEFAULT"),
  OCI_REGION: z.string().min(1),
  OCI_NAMESPACE: z.string().min(1),
  OCI_BUCKET_AVATARS_PUBLIC: z.string().min(1),
  OCI_BUCKET_DOCS_PRIVATE: z.string().min(1),
  CLAMAV_HOST: z.string().default("clamav-scanner"),
  CLAMAV_PORT: z.coerce.number().default(3310),
  DOC_PAR_TTL_SECONDS: z.coerce.number().default(300),
  AVATAR_VERSIONS_TO_KEEP: z.coerce.number().int().min(1).default(3),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid mod-media env vars", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
