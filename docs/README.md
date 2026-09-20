# Documentación Técnica: `crm-media`

Bienvenido a la documentación oficial del microservicio de almacenamiento de medios y despacho unificado de correos electrónicos de **CIMA CRM** (`crm-media`). Este servicio actúa como el **custodio de activos binarios** en la nube (OCI Object Storage), escáner antivirus (ClamAV) y **motor centralizado de mensajería electrónica** (BullMQ y Brevo SMTP) para toda la plataforma.

---

## Índice de Documentación

| Documento | Audiencia Principal | Descripción |
| :--- | :--- | :--- |
| [**ARCHITECTURE.md**](./ARCHITECTURE.md) | Arquitectos / Backend | Diseño modular (`media` y `email`), OCI Object Storage, ClamAV, BullMQ y workers. |
| [**DOMAIN.md**](./DOMAIN.md) | Negocio / Backend | Ciclo de vida de avatares (Sharp), documentos privados y despacho de correos (plantillas/marketing). |
| [**API.md**](./API.md) | Frontend / Integraciones | Catálogo de endpoints públicos (KrakenD) e internos (`/api/v1/emails/send` con Service JWT). |
| [**DATABASE.md**](./DATABASE.md) | DBA / Backend | Esquema PostgreSQL `schema_media` (`media_assets`, particiones de `audit_logs`), Drizzle ORM. |
| [**SECURITY.md**](./SECURITY.md) | Seguridad / DevOps | Antivirus ClamAV, magic numbers, URLs prefirmadas (PAR), cifrado AES-256-GCM y bodyHash. |
| [**INTEGRATIONS.md**](./INTEGRATIONS.md) | Plataforma / DevOps | Redis Streams (`media-commands`, `asset-responses`, `identity`), BullMQ, OCI y Brevo SMTP. |
| [**TESTING.md**](./TESTING.md) | QA / Desarrolladores | Pruebas unitarias Vitest, pruebas de integración de correo, OpenAPI check y Hurl E2E. |
| [**DECISIONS/**](./DECISIONS/README.md) | Todo el equipo | Architecture Decision Records (ADRs) que justifican el diseño de almacenamiento y mensajería. |

---

## Guía Rápida de Navegación para Agentes de IA

Si eres un **agente autónomo**, consulta directamente el archivo correspondiente a tu objetivo:

- **Modificar o agregar endpoints de medios o correos**: Consulta [`API.md`](./API.md) y [`ARCHITECTURE.md`](./ARCHITECTURE.md).
- **Alterar el modelo de datos o tablas en `schema_media`**: Consulta [`DATABASE.md`](./DATABASE.md).
- **Comprender reglas de avatares, cuotas o plantillas de correo**: Consulta [`DOMAIN.md`](./DOMAIN.md).
- **Trabajar con OCI Object Storage, ClamAV o Redis Streams**: Consulta [`INTEGRATIONS.md`](./INTEGRATIONS.md).
- **Ajustar seguridad de firmas M2M, verificación JWKS o AES-256**: Consulta [`SECURITY.md`](./SECURITY.md) y los [ADRs](./DECISIONS/README.md).
- **Ejecutar o ampliar la suite de pruebas**: Consulta [`TESTING.md`](./TESTING.md).

---

## Reglas Inviolables del Repositorio

1. **Gestor Único**: Únicamente `pnpm`. Prohibido usar `npm` o generar archivos `package-lock.json`.
2. **Cero Secretos en el Repo**: Jamás commitear claves OCI (`oci_api_key.pem`), credenciales SMTP de Brevo ni claves privadas de servicio.
3. **No Absorber Lógica de Negocio**: `crm-media` **no define permisos de proyecto, tableros ni membresías**. La autorización de archivos colaborativos pertenece estrictamente a `crm-collab`.
4. **Desacoplamiento de Identidad**: `crm-media` **no autentica usuarios ni emite JWTs**. Valida identidad confiable mediante encabezados de KrakenD o Service JWT inter-servicio.
