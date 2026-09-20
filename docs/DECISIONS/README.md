# Architecture Decision Records (ADRs): `crm-media`

Este directorio contiene los registros de decisiones arquitectónicas que fundamentan el diseño de almacenamiento en la nube, protección antivirus y mensajería en `crm-media`.

---

## Índice de Decisiones

| ADR | Título | Estado | Fecha |
| :--- | :--- | :--- | :--- |
| [**ADR-001**](./ADR-001-oci-object-storage-and-par.md) | Transferencia Directa de Archivos mediante Pre-Authenticated Requests (PAR) en OCI | Aceptado | 2026-05-25 |
| [**ADR-002**](./ADR-002-clamav-antivirus-pipeline.md) | Protección Antivirus Híbrida (Síncrona y Asíncrona con Cuarentena) | Aceptado | 2026-06-12 |
| [**ADR-003**](./ADR-003-centralized-email-bullmq-and-aes.md) | Motor Centralizado de Correo con Cifrado en Reposo AES-256-GCM | Aceptado | 2026-06-28 |
| [**ADR-004**](./ADR-004-service-jwt-with-bodyhash.md) | Autenticación Máquina a Máquina (M2M) con RS256 e Integridad por `bodyHash` | Aceptado | 2026-07-15 |
