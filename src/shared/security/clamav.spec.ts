import { describe, it, expect, vi, beforeEach } from "vitest";

const mockScanStream = vi.fn();
vi.mock("clamscan", () => {
  return {
    default: class {
      init() {
        return Promise.resolve({
          scanStream: mockScanStream,
        });
      }
    },
  };
});

const mockGetReputation = vi.fn();
const mockRecordReputation = vi.fn();
vi.mock("./sha256-reputation.service", () => ({
  Sha256ReputationService: {
    computeSha256: vi.fn().mockReturnValue("mocked-hash-123"),
    getReputation: (...args: any[]) => mockGetReputation(...args),
    recordReputation: (...args: any[]) => mockRecordReputation(...args),
  },
}));

const mockNotifyStarted = vi.fn();
const mockNotifyCompleted = vi.fn();
const mockEnsureReady = vi.fn().mockResolvedValue(true);
vi.mock("./clamav-standby.controller", () => ({
  clamavStandbyController: {
    registerScannerReset: vi.fn(),
    notifyScanStarted: () => mockNotifyStarted(),
    notifyScanCompleted: () => mockNotifyCompleted(),
    ensureReady: (...args: any[]) => mockEnsureReady(...args),
  },
}));

import { scanBufferForVirus } from "./clamav";

describe("scanBufferForVirus - multi-layer defense & reputation caching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects executable binaries in-process without invoking ClamAV", async () => {
    const exeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // MZ
    const result = await scanBufferForVirus(exeBuffer, { fileName: "invoice.pdf" });

    expect(result).toBe(false);
    expect(mockGetReputation).not.toHaveBeenCalled();
    expect(mockScanStream).not.toHaveBeenCalled();
    expect(mockNotifyStarted).not.toHaveBeenCalled();
  });

  it("rejects invalid PDF magic bytes in-process without invoking ClamAV", async () => {
    const invalidPdf = Buffer.from("NOT_A_VALID_PDF_HEADER");
    const result = await scanBufferForVirus(invalidPdf, { fileName: "report.pdf", mimeType: "application/pdf" });

    expect(result).toBe(false);
    expect(mockGetReputation).not.toHaveBeenCalled();
    expect(mockScanStream).not.toHaveBeenCalled();
  });

  it("returns clean immediately when SHA-256 reputation cache hits clean", async () => {
    mockGetReputation.mockResolvedValue({ status: "clean" });
    const cleanBuffer = Buffer.from("%PDF-1.4 valid content");

    const result = await scanBufferForVirus(cleanBuffer, { fileName: "clean.pdf", mimeType: "application/pdf" });

    expect(result).toBe(true);
    expect(mockGetReputation).toHaveBeenCalled();
    expect(mockScanStream).not.toHaveBeenCalled();
    expect(mockNotifyStarted).not.toHaveBeenCalled();
  });

  it("returns infected immediately when SHA-256 reputation cache hits infected", async () => {
    mockGetReputation.mockResolvedValue({ status: "infected", virusName: "Eicar-Test-Signature" });
    const infectedBuffer = Buffer.from("%PDF-1.4 infected content");

    const result = await scanBufferForVirus(infectedBuffer, { fileName: "bad.pdf", mimeType: "application/pdf" });

    expect(result).toBe(false);
    expect(mockGetReputation).toHaveBeenCalled();
    expect(mockScanStream).not.toHaveBeenCalled();
    expect(mockNotifyStarted).not.toHaveBeenCalled();
  });

  it("calls ClamAV, notifies standby controller, and records reputation on cache miss", async () => {
    mockGetReputation.mockResolvedValue({ status: "unknown" });
    mockScanStream.mockResolvedValue({ isInfected: false });

    const freshBuffer = Buffer.from("%PDF-1.4 new fresh file");
    const result = await scanBufferForVirus(freshBuffer, { fileName: "new.pdf", mimeType: "application/pdf" });

    expect(result).toBe(true);
    expect(mockNotifyStarted).toHaveBeenCalledTimes(1);
    expect(mockScanStream).toHaveBeenCalledTimes(1);
    expect(mockNotifyCompleted).toHaveBeenCalledTimes(1);
    expect(mockRecordReputation).toHaveBeenCalledWith(
      expect.objectContaining({
        sha256: "mocked-hash-123",
        status: "clean",
      })
    );
  });

  it("throws error and cleans up scan tracking if ensureReady fails", async () => {
    mockGetReputation.mockResolvedValue({ status: "unknown" });
    mockEnsureReady.mockResolvedValue(false);

    const freshBuffer = Buffer.from("%PDF-1.4 unready file");
    await expect(
      scanBufferForVirus(freshBuffer, { fileName: "new.pdf", mimeType: "application/pdf" })
    ).rejects.toThrow("El servicio antivirus ClamAV no está listo");

    expect(mockNotifyStarted).toHaveBeenCalledTimes(1);
    expect(mockNotifyCompleted).toHaveBeenCalledTimes(1);
    expect(mockScanStream).not.toHaveBeenCalled();
  });
});
