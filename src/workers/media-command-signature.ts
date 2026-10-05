import { createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { promisify } from "node:util";
import { env } from "../config/env";
import { collabJwksClient } from "../config/jwks-client";
import { AppError } from "../shared/middlewares/error-handler.middleware";
import type { MediaCommand } from "@sebascarvajal11/cima-contracts/media-asset-events";
import { NonRetryableStreamError } from "@sebascarvajal11/cima-contracts/event-consumer";

const asyncVerify = promisify(cryptoVerify);
const publicKeyCache = new Map<string, KeyObject>();

const getOrCreatePublicKey = (pem: string): KeyObject => {
  const cached = publicKeyCache.get(pem);
  if (cached) return cached;
  const key = createPublicKey(pem);
  publicKeyCache.set(pem, key);
  return key;
};

export async function verifyMediaCommandSignature(command: MediaCommand): Promise<void> {
  const token = command.signature;

  let publicKeyPem: string;
  if (env.COLLAB_JWT_PUBLIC_KEY) {
    publicKeyPem = env.COLLAB_JWT_PUBLIC_KEY;
  } else if (collabJwksClient) {
    const [headerB64] = token.split(".");
    if (!headerB64) {
      throw new NonRetryableStreamError("Token JWT de servicio malformado", "invalid_signature");
    }
    let kid: string | undefined;
    try {
      kid = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8")).kid;
    } catch {
      throw new NonRetryableStreamError("Header de JWT de servicio inválido", "invalid_signature");
    }
    if (!kid) throw new NonRetryableStreamError("JWT sin kid en el header", "invalid_signature");
    publicKeyPem = await collabJwksClient.getPublicKeyPem(kid);
  } else {
    throw new AppError(500, "Configuración de verificación de servicio incompleta");
  }

  const [headerB64, payloadB64, signatureB64] = token.split(".");
  if (!headerB64 || !payloadB64 || !signatureB64) {
    throw new NonRetryableStreamError("Token JWT de servicio malformado", "invalid_signature");
  }

  let payload: any;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    throw new NonRetryableStreamError("Payload de JWT de servicio inválido", "invalid_signature");
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new NonRetryableStreamError("Token de servicio expirado", "invalid_signature");
  }
  if (payload.iss !== env.COLLAB_JWT_ISS) {
    throw new NonRetryableStreamError(`Issuer no coincide (esperado: ${env.COLLAB_JWT_ISS})`, "invalid_signature");
  }
  if (payload.aud !== "crm-media") {
    throw new NonRetryableStreamError("Audience no coincide", "invalid_signature");
  }
  if (payload.purpose !== "media.command") {
    throw new NonRetryableStreamError("Propósito de token inválido", "invalid_signature");
  }
  if (payload.correlationId !== command.correlationId) {
    throw new NonRetryableStreamError("correlationId no coincide con el comando", "invalid_signature");
  }
  if (payload.commandType !== command.type) {
    throw new NonRetryableStreamError("commandType no coincide con el comando", "invalid_signature");
  }
  if (payload.objectKey !== command.objectKey) {
    throw new NonRetryableStreamError("objectKey no coincide con el comando", "invalid_signature");
  }

  const key = getOrCreatePublicKey(publicKeyPem);
  const data = Buffer.from(`${headerB64}.${payloadB64}`);
  const signature = Buffer.from(signatureB64, "base64url");
  const isValid = await asyncVerify("sha256", data, key, signature);
  if (!isValid) {
    throw new NonRetryableStreamError("Firma de JWT de servicio inválida", "invalid_signature");
  }
}
