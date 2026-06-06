import { Readable } from "node:stream";
import { buffer as streamToBuffer } from "node:stream/consumers";
import { randomUUID } from "node:crypto";
import * as os from "oci-objectstorage";
import { getNamespace, objectStorageEndpoint, client } from "./oci-client";
import { beforeParCreate } from "./oci-par-prune";
import { env } from "../../config/env";

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
    if (!accessUri) throw new Error("OCI no retorno accessUri para PAR");
    const filename = key.split("/").at(-1) ?? "document";
    const base = `${objectStorageEndpoint}${accessUri}`;
    return forceDownload
      ? `${base}?response-content-disposition=${encodeURIComponent(`attachment; filename="${filename}"`)}`
      : base;
  },

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

  getObjectBuffer: async (bucketName: string, key: string): Promise<Buffer> => {
    const namespace = await getNamespace();
    const response = await client.getObject({
      namespaceName: namespace,
      bucketName,
      objectName: key,
    });
    const body = response.value;
    if (!body) throw new Error("OCI getObject sin cuerpo");
    const stream = body instanceof Readable ? body : Readable.from(body as AsyncIterable<Uint8Array>);
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

  getObjectMetadata: async (bucket: string, key: string): Promise<{ sizeBytes: number; mimeType: string } | null> => {
    const namespace = await getNamespace();
    try {
      const response = await client.headObject({
        namespaceName: namespace,
        bucketName: bucket,
        objectName: key,
      });
      return {
        sizeBytes: response.contentLength ?? 0,
        mimeType: response.contentType ?? "application/octet-stream",
      };
    } catch {
      return null;
    }
  },

  copyObject: async (sourceBucket: string, targetBucket: string, sourceKey: string, targetKey: string) => {
    const namespace = await getNamespace();
    await client.copyObject({
      namespaceName: namespace,
      bucketName: sourceBucket,
      copyObjectDetails: {
        sourceObjectName: sourceKey,
        destinationRegion: env.OCI_REGION,
        destinationNamespace: namespace,
        destinationBucket: targetBucket,
        destinationObjectName: targetKey,
      },
    });
  },

  getRuntimeNamespace: getNamespace,
};
