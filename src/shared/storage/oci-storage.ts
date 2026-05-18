import { Readable } from "node:stream";
import { buffer as streamToBuffer } from "node:stream/consumers";
import { randomUUID } from "node:crypto";
import * as common from "oci-common";
import * as os from "oci-objectstorage";
import { env } from "../../config/env";

type ParSummary = {
  id?: string;
  timeExpires?: Date;
};

type ListParsPage = {
  opcNextPage?: string;
  items?: ParSummary[];
  preauthenticatedRequestCollection?: { objects?: ParSummary[] };
};

const PAR_EXPIRY_GRACE_MS = 30_000;

const pruneExpiredPars = async (bucketName: string) => {
  if (env.OCI_PAR_PRUNE_MAX <= 0) return;

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
        console.warn("[oci-storage] no se pudo eliminar PAR expirado:", item.id, err);
      }
      if (deleted >= env.OCI_PAR_PRUNE_MAX) break;
    }

    page = response.opcNextPage;
    if (!page) break;
  }
};

const beforeParCreate = async (bucketName: string) => {
  try {
    await pruneExpiredPars(bucketName);
  } catch (err) {
    console.warn("[oci-storage] limpieza de PARs expirados falló (se continúa):", err);
  }
};

const provider = new common.ConfigFileAuthenticationDetailsProvider(
  env.OCI_CONFIG_FILE_PATH,
  env.OCI_CONFIG_PROFILE
);
const client = new os.ObjectStorageClient({ authenticationDetailsProvider: provider });

const objectStorageEndpoint = `https://objectstorage.${env.OCI_REGION}.oraclecloud.com`;
let cachedNamespace: string | null = null;

const getNamespace = async () => {
  if (cachedNamespace) return cachedNamespace;
  const namespaceResponse = await client.getNamespace({});
  cachedNamespace = namespaceResponse.value;
  return cachedNamespace;
};

export const ociStorage = {
  uploadPublicAvatar: async (key: string, body: Buffer, contentType: string) => {
    const namespace = await getNamespace();
    await client.putObject({
      namespaceName: namespace,
      bucketName: env.OCI_BUCKET_AVATARS_PUBLIC,
      objectName: key,
      putObjectBody: body,
      contentType,
      contentLength: body.length,
    });

    return `${objectStorageEndpoint}/n/${namespace}/b/${env.OCI_BUCKET_AVATARS_PUBLIC}/o/${encodeURIComponent(key)}`;
  },
  getPublicObjectUrl: async (bucketName: string, key: string) => {
    const namespace = await getNamespace();
    return `${objectStorageEndpoint}/n/${namespace}/b/${bucketName}/o/${encodeURIComponent(key)}`;
  },

  uploadPrivateDocument: async (key: string, body: Buffer, contentType: string) => {
    const namespace = await getNamespace();
    await client.putObject({
      namespaceName: namespace,
      bucketName: env.OCI_BUCKET_DOCS_PRIVATE,
      objectName: key,
      putObjectBody: body,
      contentType,
      contentLength: body.length,
    });
    return key;
  },
  listObjects: async (bucketName: string, prefix: string) => {
    const namespace = await getNamespace();
    const objects: string[] = [];
    let start: string | undefined;

    do {
      const response = await client.listObjects({
        namespaceName: namespace,
        bucketName,
        prefix,
        start,
      });
      for (const item of response.listObjects?.objects ?? []) {
        if (item.name) objects.push(item.name);
      }
      start = response.listObjects?.nextStartWith ?? undefined;
    } while (start);

    return objects;
  },
  deleteObject: async (bucketName: string, key: string) => {
    const namespace = await getNamespace();
    await client.deleteObject({
      namespaceName: namespace,
      bucketName,
      objectName: key,
    });
  },

  createPrivateDocumentUrl: async (key: string, forceDownload = false) => {
    const namespace = await getNamespace();
    await beforeParCreate(env.OCI_BUCKET_DOCS_PRIVATE);
    const expiresAt = new Date(Date.now() + env.DOC_PAR_TTL_SECONDS * 1000);
    const par = await client.createPreauthenticatedRequest({
      namespaceName: namespace,
      bucketName: env.OCI_BUCKET_DOCS_PRIVATE,
      createPreauthenticatedRequestDetails: {
        name: `doc-read-${randomUUID()}`,
        objectName: key,
        accessType: os.models.CreatePreauthenticatedRequestDetails.AccessType.ObjectRead,
        timeExpires: expiresAt,
      },
    });

    const accessUri = par.preauthenticatedRequest?.accessUri;
    if (!accessUri) {
      throw new Error("OCI no retorno accessUri para PAR");
    }

    const filename = key.split("/").at(-1) ?? "document";
    const base = `${objectStorageEndpoint}${accessUri}`;
    return forceDownload
      ? `${base}?response-content-disposition=${encodeURIComponent(`attachment; filename="${filename}"`)}`
      : base;
  },

  /**
   * Genera un PAR de ESCRITURA para que el frontend suba un objeto directamente
   * a OCI sin pasar por el servidor Node.js.
   */
  createUploadPar: async (bucket: string, key: string, ttlSeconds: number) => {
    const namespace = await getNamespace();
    await beforeParCreate(bucket);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const par = await client.createPreauthenticatedRequest({
      namespaceName: namespace,
      bucketName: bucket,
      createPreauthenticatedRequestDetails: {
        name: `upload-${randomUUID()}`,
        objectName: key,
        accessType: os.models.CreatePreauthenticatedRequestDetails.AccessType.ObjectWrite,
        timeExpires: expiresAt,
      },
    });
    const accessUri = par.preauthenticatedRequest?.accessUri;
    if (!accessUri) throw new Error("OCI no retorno accessUri para PAR de escritura");
    return `${objectStorageEndpoint}${accessUri}`;
  },

  /**
   * Verifica que un objeto existe en OCI (HeadObject) para confirmar que
   * el frontend completó el upload antes de registrar en DB.
   */
  getObjectBuffer: async (bucketName: string, key: string): Promise<Buffer> => {
    const namespace = await getNamespace();
    const response = await client.getObject({
      namespaceName: namespace,
      bucketName,
      objectName: key,
    });
    const body = response.value;
    if (!body) {
      throw new Error("OCI getObject sin cuerpo");
    }
    const stream =
      body instanceof Readable ? body : Readable.from(body as AsyncIterable<Uint8Array>);
    return streamToBuffer(stream);
  },

  verifyObjectExists: async (bucket: string, key: string): Promise<boolean> => {
    const namespace = await getNamespace();
    try {
      await client.headObject({
        namespaceName: namespace,
        bucketName: bucket,
        objectName: key,
      });
      return true;
    } catch {
      return false;
    }
  },

  getRuntimeNamespace: getNamespace,
};
