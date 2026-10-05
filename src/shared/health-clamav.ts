import { createConnection } from "net";
import type { HealthDependency } from "./health";

export async function checkClamav(
  host: string,
  port: number,
  timeoutMs = 2000
): Promise<HealthDependency> {
  const start = Date.now();
  return new Promise((resolve) => {
    let resolved = false;

    const safeResolve = (dep: HealthDependency) => {
      if (resolved) return;
      resolved = true;
      resolve(dep);
    };

    const socket = createConnection({ host, port, timeout: timeoutMs }, () => {
      socket.write("PING\n");
    });

    socket.on("data", (data) => {
      socket.destroy();
      if (data.toString().includes("PONG")) {
        safeResolve({ status: "ok", latencyMs: Date.now() - start, critical: false });
      } else {
        safeResolve({
          status: "standby",
          latencyMs: Date.now() - start,
          critical: false,
          error: `Unexpected: ${data}`,
        });
      }
    });

    socket.on("error", (error) => {
      socket.destroy();
      safeResolve({
        status: "standby",
        latencyMs: Date.now() - start,
        critical: false,
        error: error.message,
      });
    });

    socket.on("timeout", () => {
      socket.destroy();
      safeResolve({
        status: "timeout",
        latencyMs: Date.now() - start,
        critical: false,
        error: "Connection timeout",
      });
    });
  });
}
