import * as common from "oci-common";
import * as os from "oci-objectstorage";
import { env } from "../../config/env";

let cachedProvider: common.ConfigFileAuthenticationDetailsProvider | null = null;
let cachedClient: os.ObjectStorageClient | null = null;

export const getProvider = (): common.ConfigFileAuthenticationDetailsProvider => {
  if (!cachedProvider) {
    cachedProvider = new common.ConfigFileAuthenticationDetailsProvider(
      env.OCI_CONFIG_FILE_PATH,
      env.OCI_CONFIG_PROFILE
    );
  }
  return cachedProvider;
};

export const getClient = (): os.ObjectStorageClient => {
  if (!cachedClient) {
    cachedClient = new os.ObjectStorageClient({ authenticationDetailsProvider: getProvider() });
  }
  return cachedClient;
};

export const provider = new Proxy({} as common.ConfigFileAuthenticationDetailsProvider, {
  get(_target, prop, receiver) {
    return Reflect.get(getProvider(), prop, receiver);
  },
});

export const client = new Proxy({} as os.ObjectStorageClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
});

export const objectStorageEndpoint = `https://objectstorage.${env.OCI_REGION}.oraclecloud.com`;

let cachedNamespace: string | null = null;

export const getNamespace = async () => {
  if (cachedNamespace) return cachedNamespace;
  const namespaceResponse = await client.getNamespace({});
  cachedNamespace = namespaceResponse.value;
  if (!cachedNamespace) throw new Error("OCI getNamespace sin valor");
  return cachedNamespace;
};
