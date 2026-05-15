import * as common from "oci-common";
import * as os from "oci-objectstorage";
import { env } from "../../config/env";

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
    const expiresAt = new Date(Date.now() + env.DOC_PAR_TTL_SECONDS * 1000);
    const par = await client.createPreauthenticatedRequest({
      namespaceName: namespace,
      bucketName: env.OCI_BUCKET_DOCS_PRIVATE,
      createPreauthenticatedRequestDetails: {
        name: `doc-read-${Date.now()}`,
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
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const par = await client.createPreauthenticatedRequest({
      namespaceName: namespace,
      bucketName: bucket,
      createPreauthenticatedRequestDetails: {
        name: `upload-${Date.now()}`,
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
