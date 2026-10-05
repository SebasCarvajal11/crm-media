import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    server: "src/server.ts",
    "workers/media-command.worker": "src/workers/media-command.worker.ts",
    "workers/quarantine-scan.worker": "src/workers/quarantine-scan.worker.ts",
    "workers/email.worker": "src/workers/email.worker.ts",
    "scripts/ensure-db-schema": "src/scripts/ensure-db-schema.ts",
  },
  format: ["esm"],
  target: "node22",
  clean: true,
  sourcemap: true,
  noExternal: ["@sebascarvajal11/cima-contracts"],
});
