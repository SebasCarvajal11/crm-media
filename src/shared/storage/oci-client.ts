import * as common from "oci-common";
import * as os from "oci-objectstorage";
import { env } from "../../config/env";

export const provider = new common.ConfigFileAuthenticationDetailsProvider(
  env.OCI_CONFIG_FILE_PATH,
  env.OCI_CONFIG_PROFILE
);

export const client = new os.ObjectStorageClient({ authenticationDetailsProvider: provider });

export const objectStorageEndpoint = `https://objectstorage.${env.OCI_REGION}.oraclecloud.com`;

let cachedNamespace: string | null = null;

export const getNamespace = async () => {
  if (cachedNamespace) return cachedNamespace;
  const namespaceResponse = await client.getNamespace({});
  cachedNamespace = namespaceResponse.value;
  if (!cachedNamespace) throw new Error("OCI getNamespace sin valor");
  return cachedNamespace;
};
