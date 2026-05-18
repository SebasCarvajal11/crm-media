import { fileTypeFromBuffer } from "file-type";

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
]);

export const imageMimes = new Set(["image/jpeg", "image/png", "image/webp"]);

const blockedExtensions = new Set([
  "exe",
  "msi",
  "dll",
  "bat",
  "cmd",
  "com",
  "scr",
  "pif",
  "cpl",
  "jar",
  "js",
  "jse",
  "vbs",
  "vbe",
  "wsf",
  "wsh",
  "ps1",
  "psm1",
  "psd1",
  "sh",
  "bash",
  "zsh",
  "ksh",
  "php",
  "phar",
  "hta",
  "lnk",
  "reg",
  "iso",
  "img",
]);

export type DetectedType = { mime: string; ext: string };

export const detectFileType = async (buffer: Buffer): Promise<DetectedType | null> => {
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) return null;
  if (blockedMimes.has(detected.mime)) return null;
  return { mime: detected.mime, ext: detected.ext };
};

export const isBlockedFileName = (fileName: string): boolean => {
  const trimmed = fileName.trim();
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot < 0 || lastDot === trimmed.length - 1) return false;
  const ext = trimmed.slice(lastDot + 1).toLowerCase();
  return blockedExtensions.has(ext);
};

export const isBlockedMime = (mime: string): boolean => blockedMimes.has(mime.toLowerCase());

const normalizeMime = (mime: string) => mime.split(";")[0]?.trim().toLowerCase() ?? "";

const inferMimeFromFileName = (fileName: string): string | null => {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".pptx")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  if (lower.endsWith(".zip")) return "application/zip";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".xml")) return "application/xml";
  return null;
};

const OPENXML_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const LEGACY_OFFICE_MIMES = new Set([
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
]);

const TEXT_LIKE_MIMES = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  "application/xml",
]);

/**
 * Comprueba que el contenido real (magic bytes) coincide con el MIME declarado en el upload.
 */
export const assertDeclaredMimeMatchesBuffer = async (
  declaredMime: string,
  fileName: string,
  buffer: Buffer,
): Promise<void> => {
  const declared = normalizeMime(declaredMime);
  if (!declared || isBlockedMime(declared)) {
    throw new Error("MIME declarado no permitido");
  }

  const detected = await detectFileType(buffer);

  if (detected) {
    const actual = normalizeMime(detected.mime);
    if (actual === declared) return;
    if (actual === "application/zip" && OPENXML_MIMES.has(declared)) return;
    if (actual === "application/x-cfb" && LEGACY_OFFICE_MIMES.has(declared)) return;
    throw new Error(`MIME real (${actual}) no coincide con el declarado (${declared})`);
  }

  const fromName = inferMimeFromFileName(fileName);
  if (fromName && normalizeMime(fromName) === declared && TEXT_LIKE_MIMES.has(declared)) {
    return;
  }

  throw new Error(
    `No se pudo verificar el tipo de archivo; declarado: ${declared}`,
  );
};
