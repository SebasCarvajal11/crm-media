# AGENTS

## Purpose

`crm-media` is the media service for CIMA CRM. It owns avatar storage, private document storage, antivirus validation, and OCI Object Storage integration. It should stay focused on media concerns only and must not absorb collaboration, authentication, or frontend logic.

## System Boundaries

- Owns avatar upload, avatar lookup, document upload confirmation, and signed/private access generation.
- Delegates authorization for project files to `crm-collab`.
- Trusts identity only through the gateway trust contract and user headers established by the platform.
- Uses OCI Object Storage as the source of truth for file binaries and PostgreSQL for media metadata.

## Fronteras con otros servicios

- **Upstream**: `crm-auth` (para validar tokens JWT mediante JWKS) y `crm-collab` (para la validación y autorización del contexto de los archivos adjuntos a proyectos/tableros).
- **Downstream**: `crm-collab` (le reporta confirmación de almacenamiento y quarantine scans) y `crm-frontend` (vistas de recursos multimedia).
- **Pares**: `crm-collab` (procesa comandos recibidos en `stream:collab.media-commands` y publica respuestas en `stream:media.asset-responses`).
- **Recursos Compartidos**: PostgreSQL (`schema_media` schema), Redis (Streams `stream:collab.media-commands` y `stream:media.asset-responses`), OCI Object Storage y ClamAV.
- **Fuera de mi responsabilidad**: Lógica de tableros, proyectos, tareas, comentarios o mensajería de chat. Determinación de políticas de acceso a archivos basadas en relaciones de negocio (delegado en `crm-collab`).

## Architecture Rules

- Preserve a clean separation between transport, application logic, infrastructure, and cross-cutting concerns.
- Keep route handlers thin. Request parsing and HTTP concerns belong in routes/controllers; business rules belong in services.
- Infrastructure adapters such as OCI, ClamAV, or database access must remain isolated under shared or infra-oriented modules.
- Do not hardcode URLs, credentials, bucket names, limits, or secrets.
- Prefer additive extension over invasive rewrites. New media capabilities should fit the existing boundaries, not bypass them.

## Code Organization

- `src/modules/media`: media-facing HTTP routes, controller orchestration, and service logic.
- `src/shared`: reusable infrastructure and cross-cutting concerns such as storage, middleware, validation, and security helpers.
- `src/config`: environment parsing and runtime configuration.
- `src/db`: schema and connection ownership for this service only.
- `src/scripts`: operational scripts that are safe, explicit, and deterministic.

## Data and Storage Principles

- Metadata in PostgreSQL and binaries in OCI must remain consistent. Any workflow that stores a file must define how metadata is created, verified, and cleaned up.
- Treat OCI access as infrastructure, not domain logic. Keep provider-specific details out of controllers and route handlers.
- Schema bootstrap must stay deterministic for new environments. Do not introduce migration paths that require manual intervention to get a clean environment running.

## Security and Operational Rules

- Never commit real OCI configs, private keys, certificates, or secret material.
- Keep antivirus checks and file-type validation in the upload path for any user-controlled content.
- Preserve the gateway trust mechanism. Internal endpoints must not silently become public.
- Error handling should fail fast, return clear client errors for expected cases, and avoid leaking internals on unexpected failures.

## Development Rules

- Use `pnpm` only. Never add `npm` commands, lockfiles, or documentation.
- Keep documentation minimal: only `README.md` and this file.
- Avoid low-value operational notes, ad hoc text files, and leftover migration artifacts unless they are part of the active workflow.
- If you add a new subsystem, document its boundary and invariants here and in `README.md` without turning the repo into a knowledge dump.

## Workers and Background Processes

`crm-media` manages two background worker processes:

1. **Media Commands Worker** (`pnpm worker:media-commands`): Consumes media operations via Redis Streams.
   - *Dependencies*: PostgreSQL (`schema_media` schema), Redis (subscribes to `stream:collab.media-commands`, publishes responses to `stream:media.asset-responses`), ClamAV (`clamav-scanner`), and OCI storage client.
2. **Quarantine Scan Worker** (`pnpm worker:quarantine-scan`): Periodically scans quarantined objects in OCI Object Storage.
   - *Dependencies*: PostgreSQL (`schema_media` schema), OCI Object Storage, and ClamAV (`clamav-scanner`).

### Healthcheck and Graceful Shutdown
- **Healthcheck**: Workers write their status and dependencies health report to `/tmp/worker-healthy` every 15 seconds. Checked inside Docker using `docker-healthcheck.sh`.
- **Graceful Shutdown (Draining)**: Workers catch `SIGINT` and `SIGTERM` signals. The Media Commands Worker stops reading from the stream (by publishing a shutdown message, stopping stream loop, closing replayer), releases connection resources, and exits. The Quarantine Scan worker clears its tick interval and releases resources.

## Configuration and Environment Variables

- **Contract Source of Truth**: The sole source of truth for the service configuration contract is [.env.example](file:///D:/BACKUP CELULAR OLIMPO/crm-media/.env.example). No production secrets or specific environment parameters should be committed.
- **Fail-Fast Validation**: All environment variables are parsed and validated at startup using `src/config/env.ts`. The process will exit immediately with code 1 if any required environment variable is missing or malformed.
- **Deployment Injection**: Production variables are injected dynamically from a secure orchestrator into `.env` or the container environment at deployment time.

## Testing Levels and Isolation

- **Nivel 1: Pruebas Unitarias** (`pnpm test:unit`): Pruebas aisladas para el cargador de archivos, antivirus y metadatos sin necesidad de levantar servicios de OCI, ClamAV o base de datos. Se ejecutan en el pipeline del repositorio de medios.
- **Nivel 2: Pruebas de Contrato Local**: Pruebas que validan la interacción con la base de datos (esquema `schema_media`) y el procesamiento local de comandos mediante Redis sin requerir `crm-auth` ni `crm-collab`.
- **Nivel 3: Pruebas de Integración Cruzada**: Pruebas de extremo a extremo que involucran la API Gateway, la hidratación de usuarios en el BFF y la descarga/subida de archivos. Son orquestadas a nivel de plataforma por `crm-infra` en la suite global de pruebas de contrato.


## Database Schema Migration Procedure (Expand & Contract)

To ensure zero-downtime deployments where old and new versions of a service run concurrently (such as during Blue/Green deployments), database migrations must never contain breaking changes:

1. **Non-Breaking Changes Only**: Every migration must be backward-compatible. Do not rename columns, remove columns, or add non-nullable columns without default values.
2. **Adding a Column (Expand)**:
   - Add the column as nullable or with a default value.
   - Deploy the new service version to write to both the old and new columns, or migrate data in the background.
3. **Changing a Column/Type**:
   - Create a new column with the target type.
   - Update the code to read/write to both columns.
   - Run a background script to backfill data from the old column to the new column.
   - Update the code to read from the new column only.
4. **Removing/Renaming a Column (Contract)**:
   - Mark the column as deprecated in the schema code (e.g., comments).
   - Deploy code that does not reference the old column name.
   - Once the old code is completely retired, run a cleanup migration to drop/rename the column.

## Observabilidad

- **Health**: `GET /api/v1/health` — estado de DB, Redis, OCI y ClamAV. Devuelve `{ status, version, uptimeSec, dependencies }`.
- **Métricas**: `GET /api/v1/metrics` — Prometheus text/plain (prom-client). Incluye:
  - `http_requests_total`, `http_request_duration_seconds`, `http_errors_5xx_total`
  - `stream_consumer_group_depth{stream, group}` — PEL del consumer group de `stream:collab.media-commands` (actualizado cada 15 s via XPENDING)
  - Métricas de Node.js por defecto (heap, event loop lag, GC)
- **Logs**: pino → Loki via promtail (label `service=crm-media`)
- **Dashboard**: Grafana http://localhost:13000 → "CIMA CRM — Overview"

## Patrones retirados

| Patrón | Retirado | Motivo |
|--------|----------|--------|
| `GATEWAY_TRUST_SECRET` / `gatewayTrustMiddleware` | 2026-05-15 | Eliminado; validación JWKS directa |
| `MEDIA_COMMAND_SECRET` (HMAC) | 2026-06-01 | Reemplazado por JWT de servicio firmado con RSA desde `crm-collab` |
| `crm-bff` como downstream | 2026-06-01 | `crm-bff` fue eliminado del stack |
