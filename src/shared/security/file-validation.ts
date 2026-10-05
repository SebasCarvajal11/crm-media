import { fileTypeFromBuffer } from "file-type";

const MZ_HEADER = Buffer.from([0x4d, 0x5a]);
const ELF_HEADER = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const SHEBANG = Buffer.from([0x23, 0x21]);
const JAVA_CLASS = Buffer.from([0xca, 0xfe, 0xba, 0xbe]);

const MACHO_32_BE = Buffer.from([0xfe, 0xed, 0xfa, 0xce]);
const MACHO_32_LE = Buffer.from([0xce, 0xfa, 0xed, 0xfe]);
const MACHO_64_BE = Buffer.from([0xfe, 0xed, 0xfa, 0xcf]);
const MACHO_64_LE = Buffer.from([0xcf, 0xfa, 0xed, 0xfe]);
const MACHO_FAT_LE = Buffer.from([0xbe, 0xba, 0xfe, 0xca]);

const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const RIFF_HEADER = Buffer.from([0x52, 0x49, 0x46, 0x46]);
const WEBP_HEADER = Buffer.from([0x57, 0x45, 0x42, 0x50]);

const blockedMimes = new Set([
  "image/svg+xml",
  "text/html",
  "application/x-msdownload",
  "application/x-dosexec",
  "application/x-executable",
  "application/x-mach-binary",
  "application/x-elf",
  "application/x-sh",
  "application/x-bat",
  "application/x-msi",
  "application/x-ms-shortcut",
  "application/java-archive",
  "application/x-php",
  "text/x-php",
  "application/javascript",
  "text/javascript",
  "application/x-python",
  "text/x-python",
  "application/x-ruby",
  "text/x-ruby",
]);

export const imageMimes = new Set(["image/jpeg", "image/png", "image/webp"]);

const blockedExtensions = new Set([
  "exe", "msi", "dll", "bat", "cmd", "com", "scr", "pif", "cpl", "jar",
  "js", "jse", "ts", "jsx", "tsx", "vbs", "vbe", "wsf", "wsh", "ps1",
  "psm1", "psd1", "sh", "bash", "zsh", "ksh", "php", "phar", "phtml",
  "py", "rb", "pl", "cgi", "jsp", "jspx", "asp", "aspx", "hta", "lnk",
  "reg", "iso", "img", "dmg", "app", "apk", "bin", "sys", "drv",
]);

export type DetectedType = { mime: string; ext: string };

export const getFileExtension = (fileName: string): string => {
  const trimmed = fileName.trim();
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot < 0 || lastDot === trimmed.length - 1) return "";
  return trimmed.slice(lastDot + 1).toLowerCase();
};

export const detectFileType = async (buffer: Buffer): Promise<DetectedType | null> => {
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) return null;
  if (blockedMimes.has(detected.mime)) return null;
  return { mime: detected.mime, ext: detected.ext };
};

export const isBlockedFileName = (fileName: string): boolean => {
  const ext = getFileExtension(fileName);
  if (!ext) return false;
  return blockedExtensions.has(ext);
};

export const isBlockedMime = (mime: string): boolean => blockedMimes.has(mime.toLowerCase());

export function hasExecutableHeader(buffer: Buffer): boolean {
  if (buffer.length < 2) return false;
  if (buffer.subarray(0, 2).equals(MZ_HEADER) || buffer.subarray(0, 2).equals(SHEBANG)) {
    return true;
  }
  if (buffer.length < 4) return false;
  const h4 = buffer.subarray(0, 4);
  return (
    h4.equals(ELF_HEADER) ||
    h4.equals(JAVA_CLASS) ||
    h4.equals(MACHO_32_BE) ||
    h4.equals(MACHO_32_LE) ||
    h4.equals(MACHO_64_BE) ||
    h4.equals(MACHO_64_LE) ||
    h4.equals(MACHO_FAT_LE)
  );
}

export interface ZipBombCheckResult {
  safe: boolean;
  reason?: string;
  totalUncompressedBytes?: number;
  entryCount?: number;
}

function findEocdOffset(buffer: Buffer): number {
  const maxSearch = Math.min(buffer.length, 65535 + 22);
  let fallback = -1;
  for (let i = buffer.length - 22; i >= buffer.length - maxSearch; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      const commentLen = buffer.readUInt16LE(i + 20);
      if (i + 22 + commentLen === buffer.length) {
        return i;
      }
      if (fallback === -1) fallback = i;
    }
  }
  return fallback;
}

export function checkZipBomb(buffer: Buffer): ZipBombCheckResult {
  if (buffer.length < 22 || !buffer.subarray(0, 4).equals(ZIP_MAGIC)) {
    return { safe: true };
  }

  const eocd = findEocdOffset(buffer);
  if (eocd === -1) {
    return { safe: false, reason: "Estructura ZIP corrupta o incompleta" };
  }

  const entryCount = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);

  if (entryCount > 10000) {
    return { safe: false, reason: `Exceso de entradas en archivo comprimido (${entryCount} > 10000)` };
  }
  if (cdOffset + cdSize > buffer.length) {
    return { safe: false, reason: "Directorio central excede el límite del archivo" };
  }

  let totalUncompressed = 0;
  let offset = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > cdOffset + cdSize || offset + 46 > buffer.length) {
      return { safe: false, reason: "Directorio central ZIP truncado o fuera de límites" };
    }
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      return { safe: false, reason: "Cabecera de entrada de directorio central ZIP inválida" };
    }
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);

    if (offset + 46 + fileNameLen <= buffer.length) {
      const entryName = buffer.subarray(offset + 46, offset + 46 + fileNameLen).toString("utf8");
      if (isBlockedFileName(entryName)) {
        return {
          safe: false,
          reason: `Archivo comprimido contiene archivo ejecutable bloqueado (${entryName})`,
        };
      }
    }

    totalUncompressed += uncompressedSize;
    offset += 46 + fileNameLen + extraLen + commentLen;
  }

  if (totalUncompressed > 250 * 1024 * 1024) {
    return { safe: false, reason: "Tamaño descomprimido excede 250MB" };
  }
  if (totalUncompressed / Math.max(buffer.length, 1) > 100) {
    return { safe: false, reason: "Ratio de compresión anómalo (> 100:1)" };
  }

  return { safe: true, totalUncompressedBytes: totalUncompressed, entryCount };
}

export interface DocumentValidationResult {
  valid: boolean;
  detectedType?: string;
  error?: string;
}

function validateImageMagicBytes(buffer: Buffer, ext: string, declaredMime?: string): boolean {
  if (ext === "png" || declaredMime === "image/png") {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_MAGIC);
  }
  if (ext === "jpg" || ext === "jpeg" || declaredMime === "image/jpeg") {
    return buffer.length >= 3 && buffer.subarray(0, 3).equals(JPEG_MAGIC);
  }
  if (ext === "webp" || declaredMime === "image/webp") {
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).equals(RIFF_HEADER) &&
      buffer.subarray(8, 12).equals(WEBP_HEADER)
    );
  }
  return true;
}

export function validateDocumentMagicBytes(
  buffer: Buffer,
  declaredMime?: string,
  fileName?: string
): DocumentValidationResult {
  if (hasExecutableHeader(buffer)) {
    return { valid: false, error: "Contenido ejecutable detectado en archivo" };
  }

  const zipCheck = checkZipBomb(buffer);
  if (!zipCheck.safe) {
    return { valid: false, error: zipCheck.reason ?? "Archivo ZIP sospechoso" };
  }

  const ext = fileName ? getFileExtension(fileName) : "";

  if (ext === "pdf" || declaredMime === "application/pdf") {
    if (buffer.length < 5 || !buffer.subarray(0, 5).equals(PDF_MAGIC)) {
      return { valid: false, error: "Encabezado PDF inválido (magic bytes ausentes)" };
    }
    return { valid: true, detectedType: "application/pdf" };
  }

  const openXmlExts = new Set(["docx", "xlsx", "pptx", "zip"]);
  const isOpenXmlMime = Boolean(
    declaredMime &&
      (declaredMime === "application/zip" ||
        declaredMime === "application/x-zip-compressed" ||
        declaredMime.startsWith("application/vnd.openxmlformats-officedocument."))
  );
  if (openXmlExts.has(ext) || isOpenXmlMime) {
    if (buffer.length < 4 || !buffer.subarray(0, 4).equals(ZIP_MAGIC)) {
      const typeLabel = ext ? ext.toUpperCase() : "ZIP/OpenXML";
      return { valid: false, error: `Encabezado ${typeLabel} inválido (magic bytes ausentes)` };
    }
    return { valid: true, detectedType: "application/zip" };
  }

  const legacyOfficeExts = new Set(["doc", "xls", "ppt"]);
  const isLegacyOfficeMime = Boolean(
    declaredMime &&
      (declaredMime === "application/msword" ||
        declaredMime === "application/vnd.ms-excel" ||
        declaredMime === "application/vnd.ms-powerpoint")
  );
  if (legacyOfficeExts.has(ext) || isLegacyOfficeMime) {
    if (buffer.length < 8 || !buffer.subarray(0, 8).equals(OLE2_MAGIC)) {
      const typeLabel = ext ? ext.toUpperCase() : "Office OLE2";
      return { valid: false, error: `Encabezado ${typeLabel} inválido (magic bytes ausentes)` };
    }
    return { valid: true, detectedType: "application/x-ole-storage" };
  }

  if (imageMimes.has(declaredMime ?? "") || ["png", "jpg", "jpeg", "webp"].includes(ext)) {
    if (!validateImageMagicBytes(buffer, ext, declaredMime)) {
      return { valid: false, error: "Encabezado de imagen inválido o corrupto" };
    }
  }

  return { valid: true };
}
