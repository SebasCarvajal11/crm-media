import { describe, it, expect } from "vitest";
import {
  hasExecutableHeader,
  checkZipBomb,
  validateDocumentMagicBytes,
  isBlockedFileName,
  isBlockedMime,
  detectFileType,
} from "./file-validation";

describe("file-validation - in-process security layers", () => {
  describe("hasExecutableHeader", () => {
    it("detects Windows PE / DOS MZ headers", () => {
      const buffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]);
      expect(hasExecutableHeader(buffer)).toBe(true);
    });

    it("detects Linux ELF binary headers", () => {
      const buffer = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]);
      expect(hasExecutableHeader(buffer)).toBe(true);
    });

    it("detects shell scripts with shebang", () => {
      const buffer = Buffer.from("#!/bin/bash\nrm -rf /");
      expect(hasExecutableHeader(buffer)).toBe(true);
    });

    it("detects Java bytecode class files", () => {
      const buffer = Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00]);
      expect(hasExecutableHeader(buffer)).toBe(true);
    });

    it("detects macOS Mach-O executable binaries (32-bit, 64-bit and fat)", () => {
      const macho64Le = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x07, 0x00]);
      const macho32Be = Buffer.from([0xfe, 0xed, 0xfa, 0xce, 0x00, 0x00]);
      const machoFatLe = Buffer.from([0xbe, 0xba, 0xfe, 0xca, 0x00, 0x00]);
      expect(hasExecutableHeader(macho64Le)).toBe(true);
      expect(hasExecutableHeader(macho32Be)).toBe(true);
      expect(hasExecutableHeader(machoFatLe)).toBe(true);
    });

    it("allows harmless non-executable content", () => {
      const buffer = Buffer.from("%PDF-1.7 harmless document stream");
      expect(hasExecutableHeader(buffer)).toBe(false);
    });
  });

  describe("checkZipBomb", () => {
    it("returns safe: true for non-zip buffers", () => {
      const buffer = Buffer.from("plain text buffer");
      expect(checkZipBomb(buffer)).toEqual({ safe: true });
    });

    it("returns safe: false for malformed zip header lacking valid EOCD", () => {
      const malformedZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, ...new Array(30).fill(0)]);
      const result = checkZipBomb(malformedZip);
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("Estructura ZIP corrupta");
    });

    it("rejects ZIP with truncated or corrupt central directory entries", () => {
      // ZIP claiming 2 entries, but central directory has corrupt signature on second entry
      const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
      const validCdHeader = Buffer.alloc(46);
      validCdHeader.writeUInt32LE(0x02014b50, 0); // signature
      validCdHeader.writeUInt16LE(4, 28); // filename len = 4 ("a.txt")
      const cdEntry1 = Buffer.concat([validCdHeader, Buffer.from("a.txt")]);
      const corruptCdEntry2 = Buffer.alloc(20); // Not a valid central header signature

      const cdCombined = Buffer.concat([cdEntry1, corruptCdEntry2]);
      const cdOffset = zipHeader.length;
      const cdSize = cdCombined.length;

      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0);
      eocd.writeUInt16LE(2, 10); // claims 2 entries
      eocd.writeUInt32LE(cdSize, 12);
      eocd.writeUInt32LE(cdOffset, 16);

      const buffer = Buffer.concat([zipHeader, cdCombined, eocd]);
      const result = checkZipBomb(buffer);
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("Directorio central ZIP");
    });

    it("rejects ZIP archive containing embedded executable file", () => {
      const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
      const cdHeader = Buffer.alloc(46);
      cdHeader.writeUInt32LE(0x02014b50, 0);
      const blockedName = "malware.exe";
      cdHeader.writeUInt16LE(blockedName.length, 28);
      const cdCombined = Buffer.concat([cdHeader, Buffer.from(blockedName)]);
      const cdOffset = zipHeader.length;
      const cdSize = cdCombined.length;

      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0);
      eocd.writeUInt16LE(1, 10);
      eocd.writeUInt32LE(cdSize, 12);
      eocd.writeUInt32LE(cdOffset, 16);

      const buffer = Buffer.concat([zipHeader, cdCombined, eocd]);
      const result = checkZipBomb(buffer);
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("archivo ejecutable bloqueado");
    });
  });

  describe("validateDocumentMagicBytes", () => {
    it("accepts valid PDF starting with %PDF-", () => {
      const pdfBuffer = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj");
      const result = validateDocumentMagicBytes(pdfBuffer, "application/pdf", "sample.pdf");
      expect(result.valid).toBe(true);
      expect(result.detectedType).toBe("application/pdf");
    });

    it("rejects disguised PDF file containing executable binary", () => {
      const fakePdf = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
      const result = validateDocumentMagicBytes(fakePdf, "application/pdf", "invoice.pdf");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Contenido ejecutable detectado");
    });

    it("rejects file named .pdf lacking %PDF- magic bytes", () => {
      const fakePdf = Buffer.from("Not really a PDF document at all");
      const result = validateDocumentMagicBytes(fakePdf, "application/pdf", "invoice.pdf");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Encabezado PDF inválido");
    });

    it("accepts valid OpenXML document (docx) starting with PK\\x03\\x04", () => {
      const eocd = Buffer.from([
        0x50, 0x4b, 0x05, 0x06,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00,
      ]);
      const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
      const docxBuffer = Buffer.concat([zipHeader, Buffer.alloc(10), eocd]);
      const result = validateDocumentMagicBytes(
        docxBuffer,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "report.docx"
      );
      expect(result.valid).toBe(true);
    });

    it("accepts OpenXML via declared MIME even when filename has no extension", () => {
      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0);
      const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
      const buffer = Buffer.concat([zipHeader, eocd]);
      const result = validateDocumentMagicBytes(
        buffer,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "attachment_blob"
      );
      expect(result.valid).toBe(true);
      expect(result.detectedType).toBe("application/zip");
    });

    it("validates and accepts valid PNG, JPEG and WebP images", () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
      const webpBuffer = Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      ]);

      expect(validateDocumentMagicBytes(pngBuffer, "image/png", "photo.png").valid).toBe(true);
      expect(validateDocumentMagicBytes(jpegBuffer, "image/jpeg", "photo.jpg").valid).toBe(true);
      expect(validateDocumentMagicBytes(webpBuffer, "image/webp", "photo.webp").valid).toBe(true);
    });

    it("rejects spoofed image file with invalid magic bytes", () => {
      const fakePng = Buffer.from("Not a real png binary header");
      const result = validateDocumentMagicBytes(fakePng, "image/png", "fake.png");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Encabezado de imagen inválido");
    });
  });

  describe("isBlockedFileName & isBlockedMime", () => {
    it("blocks dangerous script and binary extensions", () => {
      expect(isBlockedFileName("payload.exe")).toBe(true);
      expect(isBlockedFileName("script.bat")).toBe(true);
      expect(isBlockedFileName("backdoor.sh")).toBe(true);
      expect(isBlockedFileName("exploit.ps1")).toBe(true);
      expect(isBlockedFileName("shell.php")).toBe(true);
      expect(isBlockedFileName("runner.py")).toBe(true);
      expect(isBlockedFileName("app.js")).toBe(true);
      expect(isBlockedFileName("service.ts")).toBe(true);
      expect(isBlockedFileName("component.tsx")).toBe(true);
    });

    it("allows standard document extensions", () => {
      expect(isBlockedFileName("document.pdf")).toBe(false);
      expect(isBlockedFileName("sheet.xlsx")).toBe(false);
      expect(isBlockedFileName("contract.docx")).toBe(false);
      expect(isBlockedFileName("data.csv")).toBe(false);
      expect(isBlockedFileName("photo.png")).toBe(false);
    });

    it("blocks dangerous MIME types", () => {
      expect(isBlockedMime("application/x-msdownload")).toBe(true);
      expect(isBlockedMime("application/x-executable")).toBe(true);
      expect(isBlockedMime("application/x-sh")).toBe(true);
      expect(isBlockedMime("application/javascript")).toBe(true);
      expect(isBlockedMime("text/html")).toBe(true);
    });

    it("allows safe MIME types", () => {
      expect(isBlockedMime("application/pdf")).toBe(false);
      expect(isBlockedMime("image/png")).toBe(false);
      expect(isBlockedMime("image/webp")).toBe(false);
    });
  });
});
