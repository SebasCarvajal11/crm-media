# AGENTS

## Purpose

`crm-media` is the media service for CIMA CRM. It owns avatar storage, private document storage, antivirus validation, and OCI Object Storage integration. It should stay focused on media concerns only and must not absorb collaboration, authentication, or frontend logic.

## System Boundaries

- Owns avatar upload, avatar lookup, document upload confirmation, and signed/private access generation.
- Delegates authorization for project files to `crm-collab`.
- Trusts identity only through the gateway trust contract and user headers established by the platform.
- Uses OCI Object Storage as the source of truth for file binaries and PostgreSQL for media metadata.

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
