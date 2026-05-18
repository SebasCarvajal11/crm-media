# CRM Media

`crm-media` is the CIMA CRM media service. It owns avatar storage, private document storage, antivirus validation, and OCI Object Storage integration.

## Scope

- Avatar upload and retrieval
- Private document upload confirmation and access URL generation
- File validation and antivirus scanning
- Media metadata persistence in PostgreSQL

This service depends on PostgreSQL, OCI Object Storage, ClamAV, and `crm-collab` for project-file authorization checks.

## Local Development

```bash
pnpm install
pnpm db:push
pnpm dev
```

Useful commands:

- `pnpm build`
- `pnpm oci:verify`
- `pnpm db:generate`

Health check: `http://localhost:3002/health`

## Environment

Start from [.env.example](D:\BACKUP CELULAR OLIMPO\crm-media\.env.example).

Required runtime areas:

- database connectivity
- OCI config path, region, namespace, and bucket names
- ClamAV host and port
- `MOD_COLLAB_URL`
- `GATEWAY_TRUST_SECRET`

Real OCI credentials must stay outside the repository. Use [oci.config.example](D:\BACKUP CELULAR OLIMPO\crm-media\oci.config.example) only as a shape reference and point `OCI_CONFIG_FILE_PATH` to a private local file.

## API Surface

- `POST /media/avatars`
- `GET /media/avatars/current`
- `GET /media/avatars/users`
- `POST /media/documents/upload-url`
- `POST /media/documents/confirm`
- `GET /media/documents/access`
- `DELETE /media/documents`

## Verification

Minimum repo validation:

1. `pnpm build`
2. `pnpm db:push`
3. `pnpm oci:verify`
