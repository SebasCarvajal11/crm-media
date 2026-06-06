import { createConnection } from "net";
import type { HealthDependency } from "./health";

export async function checkClamav(host: string, port: number): Promise<HealthDependency> {
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: 5000 }, () => {
      socket.write("PING\n");
    });

    socket.on("data", (data) => {
      socket.destroy();
      if (data.toString().includes("PONG")) {
        resolve({ name: "clamav", status: "ok", latencyMs: Date.now() - start });
      } else {
        resolve({ name: "clamav", status: "down", latencyMs: Date.now() - start, error: `Unexpected: ${data}` });
      }
    });

    socket.on("error", (error) => {
      socket.destroy();
      resolve({ name: "clamav", status: "down", latencyMs: Date.now() - start, error: error.message });
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve({ name: "clamav", status: "timeout", latencyMs: Date.now() - start, error: "Connection timeout" });
    });
  });
}
