import { createHash, createVerify } from "node:crypto";
import { JwksClient } from "@sebascarvajal11/cima-contracts/jwks";
import { env } from "../../config/env";
import { AppError, UnauthorizedError, ForbiddenError } from "../../shared/middlewares/error-handler.middleware";

const clients = new Map<string, JwksClient>();
export const emailBodyHash = (body: string) => createHash("sha256").update(body).digest("hex");

/** An untrusted issuer selects only a configured key source, never a token-supplied URL. */
export async function authorizeEmail(authorization: string | undefined, body: string): Promise<string> {
  const token = authorization?.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/)?.[1];
  if (!token) throw new UnauthorizedError("Se requiere un JWT de servicio");
  const [head, data, signature] = token.split(".");
  let header: Record<string, unknown>, claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(head, "base64url").toString());
    claims = JSON.parse(Buffer.from(data, "base64url").toString());
    if (!header || !claims) throw new Error();
  } catch { throw new UnauthorizedError("JWT inválido"); }
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== "RS256" || typeof header.kid !== "string" ||
      typeof claims.iss !== "string" || claims.sub !== claims.iss ||
      claims.aud !== "crm-media:email" || claims.purpose !== "email:dispatch" ||
      typeof claims.exp !== "number" || typeof claims.iat !== "number" ||
      claims.exp <= now || claims.iat > now + 5 || claims.exp - claims.iat > 60 ||
      claims.bodyHash !== emailBodyHash(body)) {
    throw new UnauthorizedError("JWT de correo inválido o expirado");
  }
  const source = env.EMAIL_SERVICE_JWKS[claims.iss];
  if (!source) throw new ForbiddenError("Servicio no autorizado para enviar correo");
  let client = clients.get(source);
  if (!client) { client = new JwksClient(source); clients.set(source, client); }
  let pem: string;
  try { pem = await client.getPublicKeyPem(header.kid); }
  catch { throw new AppError(503, "No se pudo verificar la identidad del servicio", "DEPENDENCY_FAILED"); }
  const verifier = createVerify("RSA-SHA256");
  verifier.update(head + "." + data);
  if (!verifier.verify(pem, Buffer.from(signature, "base64url"))) throw new UnauthorizedError("Firma inválida");
  return claims.iss;
}
