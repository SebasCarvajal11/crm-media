import { defineConfig } from "drizzle-kit";
import "dotenv/config";

const dbSchema = process.env.DB_SCHEMA;
if (dbSchema !== "schema_media") {
  throw new Error("DB_SCHEMA debe ser schema_media para crm-media");
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL es requerida para crm-media");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
  schemaFilter: [dbSchema],
  migrations: {
    schema: dbSchema,
  },
});
