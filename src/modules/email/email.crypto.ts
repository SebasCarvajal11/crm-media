import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../../config/env";
import type { RawEmailPayload } from "./email.mailer";
const key = () => {
  if (!env.EMAIL_QUEUE_ENCRYPTION_KEY) throw new Error("EMAIL_QUEUE_ENCRYPTION_KEY is required");
  return Buffer.from(env.EMAIL_QUEUE_ENCRYPTION_KEY, "base64");
};
export function encryptEmail(payload: RawEmailPayload): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
export function decryptEmail(ciphertext: string): RawEmailPayload {
  const data = Buffer.from(ciphertext, "base64");
  const cipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString("utf8"));
}
