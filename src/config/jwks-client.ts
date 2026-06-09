import { JwksClient } from "@sebascarvajal11/cima-contracts/jwks";
import { env } from "./env";

export const collabJwksClient =
  !env.COLLAB_JWT_PUBLIC_KEY && env.COLLAB_JWKS_URI
    ? new JwksClient(env.COLLAB_JWKS_URI, env.JWKS_CACHE_TTL_MS)
    : null;
