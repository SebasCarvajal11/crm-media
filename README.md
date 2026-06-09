# CRM Media

> Servicio de almacenamiento de archivos y medios para CIMA CRM.

## Propósito

`crm-media` gestiona el almacenamiento de avatares y documentos privados en OCI Object Storage, validación antivirus con ClamAV, y generación de URLs pre-firmadas de acceso. Procesa comandos de `crm-collab` via Redis Streams, verificando la firma JWT de servicio antes de ejecutar cualquier operación. No tiene UI propia; toda interacción es via API o eventos asíncronos.

## Entorno

```bash
cp .env.example .env
# Completar: DATABASE_URL, REDIS_URL, JWKS_URI, OCI_*, CLAMAV_HOST
```

| Variable | Descripción | Requerida |
|----------|-------------|-----------|
| `DATABASE_URL` | Conexión PostgreSQL (`schema_media`) | ✅ |
| `REDIS_URL` | Redis para media-commands stream | ✅ |
| `JWKS_URI` | JWKS de `crm-auth` para validar JWTs de usuario | ✅ |
| `COLLAB_JWT_PUBLIC_KEY` | Clave pública RSA de `crm-collab` para verificar comandos | ✅ |
| `OCI_CONFIG_FILE_PATH` | Path al archivo de config OCI (fuera del repo) | ✅ |
| `OCI_NAMESPACE` | Namespace de OCI Object Storage | ✅ |
| `OCI_BUCKET_*` | Nombres de los buckets OCI | ✅ |
| `CLAMAV_HOST` | Host del servicio ClamAV | ✅ |
| `CLAMAV_PORT` | Puerto de ClamAV (default: 3310) | ✅ |
| `SERVICE_VERSION` | Versión semver del servicio | ✅ |

Ver [`.env.example`](./.env.example) y [`oci.config.example`](./oci.config.example) para referencia.

> **Importante**: Las credenciales OCI reales deben estar en un archivo externo al repo. Nunca commitear claves OCI.

## Local

```bash
pnpm install
pnpm db:bootstrap     # crear schema_media y rol en Postgres
pnpm db:push          # aplicar migraciones Drizzle
pnpm oci:verify       # verificar conectividad OCI (opcional en dev sin OCI real)
pnpm dev              # servidor con hot-reload en :3002
```

Endpoints útiles:

- Health: `http://localhost:3002/health` (incluye estado de OCI y ClamAV)
- Métricas: `http://localhost:3002/metrics`
- OpenAPI: `http://localhost:3002/openapi.json`

Workers (procesos separados):

```bash
pnpm worker:media-commands    # procesa comandos de crm-collab via Redis Stream
pnpm worker:quarantine-scan   # escaneo antivirus de archivos en cuarentena
```

Utilidades:

```bash
pnpm dlq:media:list           # listar entradas en DLQ de media-commands
pnpm dlq:media:replay         # reintentar entrada específica del DLQ
```

## Media Commands DLQ

Comandos de `crm-collab` que fallan tras `MEDIA_COMMANDS_MAX_RETRIES` se mueven a la DLQ con metadata completa. Se publica automáticamente una respuesta `file.command-failed` al stream de respuestas para que `crm-collab` pueda reaccionar.

## Deploy

```bash
# Desde crm-infra/
./deploy/remote/deploy-component.sh media
```

Ver [crm-infra/ONBOARDING.md](../crm-infra/ONBOARDING.md).

## Tests

```bash
pnpm test:unit      # unitarios Vitest
pnpm build          # verificación de tipos TypeScript
pnpm oci:verify     # conectividad OCI
```

## Contrato público

- OpenAPI: [`openapi/openapi.yaml`](./openapi/openapi.yaml)
- Gateway manifest: [`gateway/gateway.manifest.json`](./gateway/gateway.manifest.json)
