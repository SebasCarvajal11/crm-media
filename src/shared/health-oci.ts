import type { ObjectStorageClient } from "oci-objectstorage";
import type { HealthDependency } from "./health";

export async function checkOci(client: ObjectStorageClient): Promise<HealthDependency> {
  const start = Date.now();
  try {
    await client.getNamespace({});
    return { name: "oci", status: "ok", latencyMs: Date.now() - start };
  } catch (error) {
    return {
      name: "oci",
      status: "down",
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
