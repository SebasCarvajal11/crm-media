import { describe, it, expect, vi, beforeEach } from "vitest";
import { Sha256ReputationService } from "./sha256-reputation.service";

const mockSelect = vi.fn();
const mockInsert = vi.fn();

vi.mock("../../db/connection", () => ({
  db: {
    select: (...args: any[]) => mockSelect(...args),
    insert: (...args: any[]) => mockInsert(...args),
  },
}));

describe("Sha256ReputationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("computes deterministic sha256 hash for buffer", () => {
    const buffer = Buffer.from("test-content");
    const hash1 = Sha256ReputationService.computeSha256(buffer);
    const hash2 = Sha256ReputationService.computeSha256(buffer);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it("returns clean reputation on db match", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            { status: "clean", virusName: null, scannedBy: "clamav" },
          ]),
        }),
      }),
    });

    const result = await Sha256ReputationService.getReputation("abc123hash");
    expect(result.status).toBe("clean");
    expect(result.virusName).toBeNull();
  });

  it("returns infected reputation with virus name on infection match", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            { status: "infected", virusName: "Win.Trojan.Generic", scannedBy: "clamav" },
          ]),
        }),
      }),
    });

    const result = await Sha256ReputationService.getReputation("malicioushash");
    expect(result.status).toBe("infected");
    expect(result.virusName).toBe("Win.Trojan.Generic");
  });

  it("returns unknown when hash not found in reputation table", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const result = await Sha256ReputationService.getReputation("unknownhash");
    expect(result.status).toBe("unknown");
  });

  it("returns unknown gracefully if database throws an exception", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockRejectedValue(new Error("DB connection failure")),
        }),
      }),
    });

    const result = await Sha256ReputationService.getReputation("failhash");
    expect(result.status).toBe("unknown");
  });

  it("records reputation via upsert without crashing", async () => {
    const mockOnConflict = vi.fn().mockResolvedValue(undefined);
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: mockOnConflict,
      }),
    });

    await expect(
      Sha256ReputationService.recordReputation({
        sha256: "somehash",
        status: "clean",
        sizeBytes: 1024,
        mimeType: "application/pdf",
        scannedBy: "clamav",
      })
    ).resolves.not.toThrow();

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockOnConflict).toHaveBeenCalledTimes(1);
  });
});
