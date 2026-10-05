import { createConnection } from "node:net";
import { getLogger } from "../logger";
import { getRedisConnection } from "../redis";
import { env } from "../../config/env";

const logger = getLogger();

export type ClamavState = "standby" | "warming_up" | "ready";

export interface ClamavControllerOptions {
  idleTimeoutMs?: number;
  checkIntervalMs?: number;
  host?: string;
  port?: number;
  managerUrl?: string;
}

export class ClamavStandbyController {
  private state: ClamavState = "standby";
  private lastActivityAt: number = Date.now();
  private activeScans = 0;
  private readonly idleTimeoutMs: number;
  private readonly host: string;
  private readonly port: number;
  private readonly managerUrl?: string;
  private checkTimer?: NodeJS.Timeout;
  private resetScannerCallback?: () => void;

  constructor(options: ClamavControllerOptions = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? 15 * 60 * 1000; // 15 minutos
    this.host = options.host ?? env.CLAMAV_HOST;
    this.port = options.port ?? env.CLAMAV_PORT;
    this.managerUrl = options.managerUrl ?? process.env.CLAMAV_MANAGER_URL;
  }

  public registerScannerReset(callback: () => void): void {
    this.resetScannerCallback = callback;
  }

  public getState(): ClamavState {
    return this.state;
  }

  public getActiveScans(): number {
    return this.activeScans;
  }

  public getLastActivityAt(): number {
    return this.lastActivityAt;
  }

  public startPeriodicIdleCheck(intervalMs = 30000): void {
    if (this.checkTimer) clearInterval(this.checkTimer);
    this.checkTimer = setInterval(() => {
      this.evaluateIdleTimeout();
    }, intervalMs);
    if (this.checkTimer.unref) this.checkTimer.unref();
  }

  public stopPeriodicIdleCheck(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
    }
  }

  public triggerWarmup(source = "unknown"): void {
    this.lastActivityAt = Date.now();
    if (this.state === "ready") return;

    this.state = "warming_up";
    logger.info({ source, topic: "clamav-standby" }, "Señal de calentamiento anticipado enviada para ClamAV");

    void this.publishControlEvent("wake", { source });
    void this.backgroundWarmupPoll();
  }

  public async ensureReady(timeoutMs = 8000): Promise<boolean> {
    this.lastActivityAt = Date.now();
    if (this.state === "ready") {
      const alive = await this.pingClamavTcp(1000);
      if (alive) return true;
    }

    this.triggerWarmup("ensure_ready");
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ok = await this.pingClamavTcp(1000);
      if (ok) {
        this.state = "ready";
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    logger.warn({ topic: "clamav-standby", timeoutMs }, "ClamAV no respondió dentro del plazo");
    return false;
  }

  private async backgroundWarmupPoll(maxAttempts = 10, delayMs = 500): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      if (this.state === "ready" || this.state === "standby") break;
      const ok = await this.pingClamavTcp(1500);
      if (ok) {
        this.state = "ready";
        logger.info({ topic: "clamav-standby" }, "ClamAV demonio listo tras calentamiento anticipado");
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  public notifyScanStarted(): void {
    this.activeScans += 1;
    this.lastActivityAt = Date.now();
    if (this.state !== "ready") {
      this.triggerWarmup("scan_started");
    }
  }

  public notifyScanCompleted(): void {
    this.activeScans = Math.max(0, this.activeScans - 1);
    this.lastActivityAt = Date.now();
  }

  public async evaluateIdleTimeout(): Promise<boolean> {
    if (this.activeScans > 0) return false;
    const idleTime = Date.now() - this.lastActivityAt;
    if (idleTime < this.idleTimeoutMs) return false;
    if (this.state === "standby") return false;

    this.state = "standby";
    logger.info({ idleTimeMs: idleTime, topic: "clamav-standby" }, "ClamAV suspendido por inactividad (> 15 min)");

    if (this.resetScannerCallback) {
      try {
        this.resetScannerCallback();
      } catch (err) {
        logger.warn({ err }, "Error reseteando socket scanner");
      }
    }

    await this.publishControlEvent("suspend", { idleTimeMs: idleTime });
    return true;
  }

  private async publishControlEvent(action: "wake" | "suspend", details: Record<string, unknown>): Promise<void> {
    const payload = JSON.stringify({ action, timestamp: Date.now(), ...details });

    try {
      const redis = getRedisConnection();
      if (redis) {
        await redis.publish("cima:clamav:control", payload);
      }
    } catch (err) {
      logger.warn({ err, action }, "No se pudo publicar evento ClamAV en Redis");
    }

    if (this.managerUrl) {
      try {
        const endpoint = `${this.managerUrl.replace(/\/$/, "")}/api/clamav/${action}`;
        await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal: AbortSignal.timeout(3000),
        });
      } catch (err) {
        logger.warn({ err, action, endpoint: this.managerUrl }, "Error comunicando con ClamAV manager sidecar");
      }
    }
  }

  public async pingClamavTcp(timeoutMs = 2000): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = createConnection({ host: this.host, port: this.port, timeout: timeoutMs }, () => {
        socket.write("PING\n");
      });

      socket.on("data", (data) => {
        socket.destroy();
        if (data.toString().includes("PONG")) {
          this.state = "ready";
          resolve(true);
        } else {
          resolve(false);
        }
      });

      socket.on("error", () => {
        socket.destroy();
        resolve(false);
      });

      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });
    });
  }
}

export const clamavStandbyController = new ClamavStandbyController();
clamavStandbyController.startPeriodicIdleCheck();
