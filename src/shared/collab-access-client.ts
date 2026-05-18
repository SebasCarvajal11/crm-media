import { env } from "../config/env";
import { AppError } from "./middlewares/error-handler.middleware";

export type DocumentAccessActor = {
  userId: string;
  sub: string;
  role: string;
  email: string;
};

export const assertCollabStorageAccess = async (
  actor: DocumentAccessActor,
  objectKey: string,
): Promise<boolean> => {
  if (!env.MOD_COLLAB_URL) return false;

  const qs = new URLSearchParams({ objectKey });
  const url = `${env.MOD_COLLAB_URL.replace(/\/$/, "")}/collab/internal/storage-access?${qs.toString()}`;

  let res: Response;
  try {
    const headers: Record<string, string> = {
      "X-User-Sub": actor.sub,
      "X-User-Id": actor.userId,
      "X-User-Role": actor.role,
      "X-User-Email": actor.email,
    };
    if (env.GATEWAY_TRUST_SECRET) {
      headers["X-Gateway-Trust"] = env.GATEWAY_TRUST_SECRET;
    }

    res = await fetch(url, {
      method: "GET",
      headers,
    });
  } catch {
    throw new AppError(502, "No hay conectividad entre mod-media y mod-collab");
  }

  if (res.status === 204) return true;
  if (res.status === 403 || res.status === 404) return false;
  throw new AppError(502, "No se pudo validar acceso al documento en mod-collab");
};
