import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db/connection";
import { fileReputation } from "../../db/schema";
import { getLogger } from "../logger";

const logger = getLogger();

export type ReputationStatus = "clean" | "infected" | "unknown";

export interface FileReputationRecord {
  sha256: string;
  status: "clean" | "infected";
  virusName?: string | null;
  sizeBytes?: number;
  mimeType?: string;
  scannedBy?: string;
}

export interface ReputationResult {
  status: ReputationStatus;
  virusName?: string | null;
  scannedBy?: string;
}

export class Sha256ReputationService {
  public static computeSha256(buffer: Buffer): string {
    return createHash("sha256").update(buffer).digest("hex");
  }

  public static async getReputation(sha256: string): Promise<ReputationResult> {
    try {
      const rows = await db
        .select({
          status: fileReputation.status,
          virusName: fileReputation.virusName,
          scannedBy: fileReputation.scannedBy,
        })
        .from(fileReputation)
        .where(eq(fileReputation.sha256, sha256))
        .limit(1);

      if (rows.length === 0) {
        return { status: "unknown" };
      }

      const row = rows[0];
      const status: ReputationStatus =
        row.status === "clean" || row.status === "infected" ? row.status : "unknown";

      return {
        status,
        virusName: row.virusName,
        scannedBy: row.scannedBy,
      };
    } catch (err) {
      logger.warn({ err, sha256 }, "Error consultando reputación sha256; procediendo con escaneo normal");
      return { status: "unknown" };
    }
  }

  public static async recordReputation(params: FileReputationRecord): Promise<void> {
    try {
      const { sha256, status, virusName, sizeBytes, mimeType, scannedBy } = params;
      await db
        .insert(fileReputation)
        .values({
          sha256,
          status,
          virusName: virusName ?? null,
          sizeBytes: sizeBytes ?? null,
          mimeType: mimeType ?? null,
          scannedBy: scannedBy ?? "clamav",
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: fileReputation.sha256,
          set: {
            status,
            virusName: virusName ?? null,
            scannedBy: scannedBy ?? "clamav",
            updatedAt: new Date(),
          },
        });
    } catch (err) {
      logger.error({ err, sha256: params.sha256 }, "Error registrando reputación sha256");
    }
  }
}
