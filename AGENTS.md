# Guía de Agentes: `crm-media`

Este archivo es el **enrutador principal para Agentes de Inteligencia Artificial**. La documentación técnica y de negocio completa y detallada está estructurada en la carpeta [`docs/`](./docs/README.md).

---

## Misión del Servicio

`crm-media` es el **custodio exclusivo de activos binarios en la nube (OCI Object Storage), escaneo antivirus (ClamAV) y motor centralizado de correo electrónico (BullMQ y Brevo SMTP)** en CIMA CRM. No gestiona la lógica de proyectos, tareas, membresías ni autentica credenciales de usuario.

---

## Enrutamiento Documental para Agentes

Antes de proponer o ejecutar cambios, consulta el documento especializado correspondiente a tu objetivo:

| Si tu tarea involucra... | Consulta este documento |
| :--- | :--- |
| Comprender la arquitectura en capas, módulos (`media`, `email`) y workers | [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) |
| Entender reglas de avatares (Sharp), documentos PAR y plantillas de correo | [`docs/DOMAIN.md`](./docs/DOMAIN.md) |
| Crear, modificar o auditar endpoints públicos (KrakenD) o internos de correo | [`docs/API.md`](./docs/API.md) |
| Modificar tablas en PostgreSQL (`schema_media`), modelos Drizzle o particiones | [`docs/DATABASE.md`](./docs/DATABASE.md) |
| Ajustar escaneo ClamAV, URLs prefirmadas PAR, cifrado AES-256 o firmas M2M | [`docs/SECURITY.md`](./docs/SECURITY.md) |
| Conectar con Redis Streams (`media-commands`), colas BullMQ, OCI o Brevo | [`docs/INTEGRATIONS.md`](./docs/INTEGRATIONS.md) |
| Ejecutar pruebas unitarias Vitest, pruebas de contrato o Hurl E2E | [`docs/TESTING.md`](./docs/TESTING.md) |
| Entender decisiones estructurales (PAR en OCI, ClamAV, BullMQ, bodyHash) | [`docs/DECISIONS/`](./docs/DECISIONS/README.md) |

---

## Reglas Inviolables para Agentes de IA

1. **Gestor Único**: Utiliza **exclusivamente `pnpm`**. Jamás uses `npm` ni generes archivos `package-lock.json`.
2. **Cero Secretos**: Nunca commitear credenciales OCI (`oci_api_key.pem`), claves privadas RSA ni contraseñas SMTP en el repositorio.
3. **Cero Tráfico Binario en Servidor**: Los archivos pesados deben cargarse y descargarse directamente hacia/desde OCI mediante Pre-Authenticated Requests (PAR).
4. **Desacoplamiento Estricto**: No absorber reglas de colaboración ni pertenencia a proyectos; la autorización sobre archivos de proyecto pertenece a `crm-collab`.
5. **Cifrado de PII en Cola**: Cualquier información personal destinada a correo electrónico debe cifrarse con AES-256-GCM antes de depositarse en Redis.
