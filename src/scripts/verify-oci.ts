import * as common from "oci-common";
import * as os from "oci-objectstorage";
import { env } from "../config/env";

const provider = new common.ConfigFileAuthenticationDetailsProvider(
  env.OCI_CONFIG_FILE_PATH,
  env.OCI_CONFIG_PROFILE
);
const client = new os.ObjectStorageClient({ authenticationDetailsProvider: provider });

const fail = (label: string, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[FAIL] ${label}: ${message}`);
  return false;
};

const ok = (msg: string) => console.log(`[OK] ${msg}`);

const run = async () => {
  let allOk = true;
  try {
    const namespace = (await client.getNamespace({})).value;
    ok(`Namespace runtime: ${namespace}`);
    if (namespace !== env.OCI_NAMESPACE) {
      console.warn(`[WARN] OCI_NAMESPACE env (${env.OCI_NAMESPACE}) != runtime (${namespace})`);
    }

    try {
      await client.headBucket({ namespaceName: namespace, bucketName: env.OCI_BUCKET_AVATARS_PUBLIC });
      ok(`HeadBucket avatars: ${env.OCI_BUCKET_AVATARS_PUBLIC}`);
    } catch (error) {
      allOk = fail(`HeadBucket avatars (${env.OCI_BUCKET_AVATARS_PUBLIC})`, error) && allOk;
    }

    try {
      await client.headBucket({ namespaceName: namespace, bucketName: env.OCI_BUCKET_DOCS_PRIVATE });
      ok(`HeadBucket docs: ${env.OCI_BUCKET_DOCS_PRIVATE}`);
    } catch (error) {
      allOk = fail(`HeadBucket docs (${env.OCI_BUCKET_DOCS_PRIVATE})`, error) && allOk;
    }

    const testKey = `health/oci-verify-${Date.now()}.txt`;
    const body = Buffer.from("oci verify", "utf8");

    try {
      await client.putObject({
        namespaceName: namespace,
        bucketName: env.OCI_BUCKET_DOCS_PRIVATE,
        objectName: testKey,
        putObjectBody: body,
        contentLength: body.length,
        contentType: "text/plain",
      });
      ok(`PutObject privado: ${testKey}`);
    } catch (error) {
      allOk = fail(`PutObject docs (${env.OCI_BUCKET_DOCS_PRIVATE})`, error) && allOk;
    }

    try {
      const par = await client.createPreauthenticatedRequest({
        namespaceName: namespace,
        bucketName: env.OCI_BUCKET_DOCS_PRIVATE,
        createPreauthenticatedRequestDetails: {
          name: `verify-par-${Date.now()}`,
          objectName: testKey,
          accessType: os.models.CreatePreauthenticatedRequestDetails.AccessType.ObjectRead,
          timeExpires: new Date(Date.now() + 5 * 60 * 1000),
        },
      });

      const accessUri = par.preauthenticatedRequest?.accessUri;
      if (!accessUri) throw new Error("PAR sin accessUri");

      ok("CreatePreauthenticatedRequest permitido");
      console.log(`PAR URL: https://objectstorage.${env.OCI_REGION}.oraclecloud.com${accessUri}`);
    } catch (error) {
      allOk = fail(`CreatePreauthenticatedRequest docs (${env.OCI_BUCKET_DOCS_PRIVATE})`, error) && allOk;
    }

    if (!allOk) {
      process.exitCode = 1;
    }
  } finally {
    client.close();
  }
};

void run();
