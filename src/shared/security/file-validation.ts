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
