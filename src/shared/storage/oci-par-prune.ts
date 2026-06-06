import { client, getNamespace } from "./oci-client";
import { env } from "../../config/env";
import { getLogger } from "../../shared/logger";

type ParSummary = {
  id?: string;
  timeExpires?: Date;
};

type ListParsPage = {
  opcNextPage?: string;
  items?: ParSummary[];
  preauthenticatedRequestCollection?: { objects?: ParSummary[] };
};

const logger = getLogger();
const PAR_EXPIRY_GRACE_MS = 30_000;

export const pruneExpiredPars = async (bucketName: string): Promise<{ deleted: number }> => {
  if (env.OCI_PAR_PRUNE_MAX <= 0) return { deleted: 0 };
  const namespace = await getNamespace();
  let page: string | undefined;
  let deleted = 0;
  const now = Date.now();

  while (deleted < env.OCI_PAR_PRUNE_MAX) {
    const response = (await client.listPreauthenticatedRequests({
      namespaceName: namespace,
      bucketName,
      limit: 100,
      page,
    })) as ListParsPage;

    const items =
      response.items ?? response.preauthenticatedRequestCollection?.objects ?? [];

    for (const item of items) {
      if (!item.id) continue;
      const expiresAt = item.timeExpires ? new Date(item.timeExpires).getTime() : Number.NaN;
      if (!Number.isFinite(expiresAt) || expiresAt + PAR_EXPIRY_GRACE_MS >= now) continue;
      try {
        await client.deletePreauthenticatedRequest({
          namespaceName: namespace,
          bucketName,
          parId: item.id,
        });
        deleted += 1;
      } catch (err) {
        logger.warn({ err, parId: item.id, topic: "oci-par-prune" }, "no se pudo eliminar PAR expirado");
      }
      if (deleted >= env.OCI_PAR_PRUNE_MAX) break;
    }

    page = response.opcNextPage;
    if (!page) break;
  }

  return { deleted };
};

export const beforeParCreate = async (bucketName: string) => {
  try {
    await pruneExpiredPars(bucketName);
  } catch (err) {
    logger.warn({ err, topic: "oci-par-prune" }, "limpieza de PARs expirados falló (se continúa)");
  }
};
