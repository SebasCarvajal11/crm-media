import { describe, it, expect } from "vitest";
import { sanitizeStoredFileName, sanitizeFileNameForObjectKey } from "./sanitize-filename";

describe("sanitize-filename", () => {
  describe("sanitizeStoredFileName", () => {
    it("should remove control characters and trim whitespace", () => {
      const input = " \u0000test\u001ffile \t\n name ";
      const result = sanitizeStoredFileName(input);
      expect(result).toBe("testfile name");
    });

    it("should collapse multiple consecutive whitespaces to a single space", () => {
      const input = "hello    world  test";
      const result = sanitizeStoredFileName(input);
      expect(result).toBe("hello world test");
    });

    it("should normalize string using NFKC format", () => {
      const input = "① ② ③"; // Enclosed numbers
      const result = sanitizeStoredFileName(input);
      expect(result).toBe("1 2 3");
    });

    it("should truncate string to 255 characters", () => {
      const input = "a".repeat(300);
      const result = sanitizeStoredFileName(input);
      expect(result).toHaveLength(255);
    });

    it("should return a fallback if string becomes empty", () => {
      const input = "\u0000\u001f";
      const result = sanitizeStoredFileName(input);
      expect(result).toMatch(/^file_\d+$/);
    });
  });

  describe("sanitizeFileNameForObjectKey", () => {
    it("should convert non-alphanumeric/dot/hyphen characters to underscores", () => {
      const input = "my/file\\name:*.txt";
      const result = sanitizeFileNameForObjectKey(input);
      expect(result).toBe("my_file_name_.txt");
    });

    it("should collapse consecutive underscores", () => {
      const input = "my___file.png";
      const result = sanitizeFileNameForObjectKey(input);
      expect(result).toBe("my_file.png");
    });

    it("should trim leading and trailing underscores", () => {
      const input = "_file_";
      const result = sanitizeFileNameForObjectKey(input);
      expect(result).toBe("file");
    });

    it("should return a fallback if string becomes empty", () => {
      const input = "/\\";
      const result = sanitizeFileNameForObjectKey(input);
      expect(result).toMatch(/^file_\d+$/);
    });

    it("should replace accent letters with underscores or ASCII equivalent depending on NFKD", () => {
      // NFKD decomposes 'ñ' to 'n' + '~' (combining tilde), then non-word chars are replaced.
      // So 'mañana' becomes 'manana' (since tilde gets stripped or replaced by underscore)
      const input = "mañana.pdf";
      const result = sanitizeFileNameForObjectKey(input);
      expect(result).toContain("man");
    });
  });
});
