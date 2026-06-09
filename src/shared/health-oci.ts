import type { ObjectStorageClient } from "oci-objectstorage";
import type { HealthDependency } from "./health";

export async function checkOci(client: ObjectStorageClient): Promise<HealthDependency> {
  const start = Date.now();
  try {
    await client.getNamespace({});
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (error) {
    return {
      status: "down",
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

