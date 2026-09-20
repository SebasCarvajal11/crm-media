# Base de Datos y Persistencia: `crm-media`

Este documento detalla el esquema relacional en PostgreSQL, los modelos Drizzle ORM, la política de particionamiento mensual y el procedimiento de migraciones sin tiempo de inactividad.

---

## 1. Esquema Relacional: `schema_media`

`crm-media` opera en un esquema aislado dentro de la base de datos PostgreSQL compartida de la plataforma CIMA.

```text
┌─────────────────────────────────────────────────────────────┐
│                        schema_media                         │
├──────────────────────────────┬──────────────────────────────┤
│         media_assets         │          audit_logs          │
├──────────────────────────────┼──────────────────────────────┤
│ • id (UUIDv7, PK)            │ • id (BIGSERIAL)             │
│ • user_id (TEXT)             │ • created_at (TIMESTAMPTZ)   │
│ • kind (avatar | document)   │   (PK compuesta por rango)   │
│ • avatar_version (INT)       │ • actor_sub (UUID)           │
│ • width (INT)                │ • actor_email / actor_role   │
│ • bucket / object_key (TEXT) │ • action / resource_type     │
│ • original_name / mime_type  │ • ip_address / user_agent    │
│ • size_bytes (BIGINT)        │ • correlation_id (UUID)      │
│ • created_at (TIMESTAMPTZ)   │ • details (JSONB)            │
└──────────────────────────────┴──────────────────────────────┘
```

---

## 2. Definición de Tablas

### A. Tabla `media_assets`
Custodia los metadatos de los archivos físicos almacenados en Oracle Cloud Infrastructure (OCI). Los binarios reales residen en los buckets de OCI, nunca en la base de datos relacional.

- **Identificador**: UUID versión 7 (`$defaultFn(() => uuidv7())`), ordenable cronológicamente para evitar fragmentación de índices B-Tree.
- **Índice de Unicidad**:
  ```sql
  CREATE UNIQUE INDEX uq_user_kind_version_width 
  ON schema_media.media_assets (user_id, kind, avatar_version, width);
  ```
  Asegura que no existan duplicados para la misma versión y dimensión de avatar de un usuario.

### B. Tabla Particionada `audit_logs`
Registra eventos críticos de seguridad y acceso a archivos (subida de avatar, confirmación de documento, eliminación, acceso a datos sensibles).

- **Estrategia de Particionamiento**: Particionamiento por rango mensual basado en `created_at` (`PARTITION BY RANGE (created_at)`).
- **Mantenimiento Automático**: El script `ensure-audit-log-partitions.ts` asegura la creación anticipada de las particiones del mes en curso y del siguiente, facilitando archivado o purga eficiente (`DROP TABLE` en lugar de costosos `DELETE`).

---

## 3. Procedimiento de Migración Expand & Contract

Para permitir despliegues Blue/Green sin interrupción del servicio:

1. **Fase Expand**:
   - Nuevas columnas deben crearse como opcionales (`nullable`) o con valores por defecto deterministas.
   - Si se requiere renombrar o transformar una columna, se crea una nueva y el código escribe temporalmente en ambas.
2. **Fase Transición**:
   - Se ejecuta el despliegue de la nueva versión del servicio que lee del nuevo campo.
3. **Fase Contract**:
   - Una vez retirado el código anterior y verificado el funcionamiento, se ejecuta una migración de limpieza para retirar las columnas o índices obsoletos.
