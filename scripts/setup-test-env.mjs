import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const ociDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cima-oci-'));
const keyPath = path.join(ociDir, 'oci_api_key.pem');
const configPath = path.join(ociDir, 'oci.config');

fs.writeFileSync(keyPath, privateKey);
fs.writeFileSync(
  configPath,
  [
    '[DEFAULT]',
    'user=ocid1.user.oc1..placeholder',
    'fingerprint=aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99',
    'tenancy=ocid1.tenancy.oc1..placeholder',
    'region=us-sanjose-1',
    `key_file=${keyPath}`,
  ].join('\n') + '\n'
);

const lines = [
  'DATABASE_URL=postgres://root:rootpassword@127.0.0.1:5432/crm_database',
  'DB_SCHEMA=schema_media',
  'NODE_ENV=test',
  'PORT=3002',
  'TRUST_GATEWAY_JWT_HEADERS=true',
  `OCI_CONFIG_FILE_PATH=${configPath}`,
  'OCI_CONFIG_PROFILE=DEFAULT',
  'OCI_REGION=us-sanjose-1',
  'OCI_NAMESPACE=placeholder',
  'OCI_BUCKET_DOCS_PRIVATE=crm-docs-private',
  'CLAMAV_HOST=127.0.0.1',
  'CLAMAV_PORT=3310',
  'MOD_COLLAB_URL=http://127.0.0.1:3001',
];

fs.writeFileSync('.env', lines.join('\n') + '\n');
console.log('[setup-test-env] .env successfully generated for crm-media.');
