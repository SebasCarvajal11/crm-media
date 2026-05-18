## CRM Media

Servicio de media de CIMA CRM para avatares y documentos.

## Desarrollo

```bash
pnpm install
pnpm dev
pnpm oci:verify
```

Health check: `http://localhost:3002/health`

## Dependencias externas

Este repo depende de:

- Postgres compartido
- OCI Object Storage
- ClamAV
- `crm-collab` para validar acceso a documentos privados
- `GATEWAY_TRUST_SECRET` compartido cuando se valida acceso interno

## Variables de entorno

Parte de `.env.example` y define al menos:

- `DATABASE_URL`
- `PORT`
- `OCI_CONFIG_FILE_PATH`
- `OCI_CONFIG_PROFILE`
- `OCI_REGION`
- `OCI_NAMESPACE`
- `OCI_BUCKET_AVATARS_PUBLIC`
- `OCI_BUCKET_DOCS_PRIVATE`
- `CLAMAV_HOST`
- `CLAMAV_PORT`
- `CLAMAV_SCAN_TIMEOUT_MS`
- `DOC_PAR_TTL_SECONDS`
- `OCI_PAR_PRUNE_MAX`
- `AVATAR_VERSIONS_TO_KEEP`
- `MOD_COLLAB_URL`
- `GATEWAY_TRUST_SECRET`

## Endpoints relevantes

- `POST /media/avatars`
- `GET /media/avatars/current`
- `GET /media/avatars/users`
- `POST /media/documents/upload-url`
- `POST /media/documents/confirm`
- `GET /media/documents/access`
- `DELETE /media/documents`

## Verificacion operativa minima

1. `pnpm build`
2. `pnpm oci:verify`
3. Arranque local con `.env` real
4. Flujo de documento:
   - generar `upload-url`
   - subir archivo directo a OCI
   - confirmar upload
   - pedir URL de acceso

## Configuracion OCI segura

- No subas `oci.config`, llaves privadas `.pem` ni credenciales al repositorio.
- Usa un archivo local fuera del repo y apunta `OCI_CONFIG_FILE_PATH` a esa ruta en tu `.env`.
- Toma como referencia `Info OCI Oracle/README.md` y `Info OCI Oracle/oci.config.example`.
