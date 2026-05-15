# mod-media

Microservicio de media para CRM: upload de avatares y documentos con validacion por magic numbers, procesamiento de imagenes, escaneo antivirus y almacenamiento en OCI Object Storage.

## Endpoints

- `POST /media/avatars` (multipart `file`)
  - Respuesta: `{ data: { version, urls: { "64", "256", "512" } } }`
- `POST /media/documents` (multipart `file`)
- `GET /media/documents/access?objectKey=...&download=true|false`
- `GET /health`

## Versionado de avatares

- Cada upload incrementa `avatarVersion` por usuario.
- Las keys quedan en `avatars/{userId}/v{n}/...`.
- Se conservan las ultimas `AVATAR_VERSIONS_TO_KEEP` versiones y se limpian versiones antiguas en OCI.

## Desarrollo

```bash
pnpm install
pnpm dev
pnpm oci:verify
```