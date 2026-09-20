# Integraciones y Plataforma: `crm-media`

Este documento define la interacción de `crm-media` con los componentes del ecosistema CIMA, canales de mensajería en Redis Streams, colas BullMQ, el almacenamiento OCI y el API Gateway.

---

## 1. Topología de Integración

```text
               ┌───────────────────────┐
               │    KrakenD Gateway    │
               └───────────┬───────────┘
                           │ (HTTP REST / Headers de Usuario)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                          crm-media                          │
│  (Gestor de binarios OCI, Antivirus ClamAV y Motor Email)   │
└──────────────┬───────────────┬──────────────────────────────┘
               │               │
               │ (Comandos)    │ (Trabajos Cifrados)
               ▼               ▼
      ┌──────────────────┐   ┌──────────────────┐
      │  Redis Streams   │   │   BullMQ Queue   │
      │ collab.media-... │   │ mod-media-email  │
      └────────┬─────────┘   └────────┬─────────┘
               │                      │
               ▼                      ▼
         [ crm-collab ]       [ Email Worker ] ──► [ Brevo SMTP Relay ]
       (Recibe respuestas)
```

---

## 2. Mensajería Asíncrona en Redis Streams

`crm-media` procesa solicitudes de almacenamiento colaborativo de forma asíncrona mediante Redis Streams:

### A. Consumo de Comandos de Medios (`stream:collab.media-commands`)
- **Grupo de Consumo**: `media-commands-group`.
- **Tipos de Comandos Procesados**:
  - `file.upload-url-requested`: Emisión de URL prefirmada (PAR) para subida directa.
  - `file.metadata-requested`: Consulta de dimensiones, peso y tipo de un activo existente.
  - `file.access-requested`: Emisión de URL prefirmada temporal para visualización o descarga.
  - `file.delete-requested`: Eliminación definitiva del archivo en OCI y de sus registros asociados.
- **Gestión de Respuestas**: Todo comando procesado emite un evento correlacionado en `stream:media.asset-responses` con el mismo `correlationId` para que `crm-collab` actualice su estado.
- **Dead Letter Queue (DLQ)**: Comandos con errores no recuperables o firmas inválidas se aíslan en la DLQ para diagnóstico manual con el script `pnpm dlq:media:list`.

### B. Consumo de Eventos de Identidad (`stream:auth.identity`)
- **Grupo de Consumo**: `media-auth-identity`.
- **Propósito**: Escuchar eventos de eliminación de usuarios (`auth.user.deleted`) para purgar o anonimizar los avatares huérfanos asociados.

---

## 3. Motor de Correo Electrónico con BullMQ y Brevo SMTP

- **Cola de Mensajes**: `mod-media-email` gestionada mediante BullMQ en Redis.
- **Worker Dedicado**: `pnpm worker:email` ejecuta el procesamiento concurrente de trabajos:
  - Extrae el trabajo de la cola.
  - Descifra la carga útil mediante la clave simétrica `EMAIL_ENCRYPTION_KEY` (AES-256-GCM).
  - Ensambla el mensaje (procesando plantillas o inyectando HTML directo).
  - Transmite vía SMTP hacia Brevo (`smtp-relay.brevo.com:587`) con TLS estricto y verificación de certificado.
- **Manejo de Reintentos**: Ante fallos temporales de red o límite de tasa del proveedor SMTP, BullMQ aplica reintentos automáticos con retroceso exponencial (*exponential backoff*).

---

## 4. Almacenamiento en Oracle Cloud Infrastructure (OCI)

- **SDK Oficial**: `@oracle/oci-objectstorage` y `@oracle/oci-common`.
- **Autenticación**: Basada en par de claves RSA (`OCI_PRIVATE_KEY_PATH`) vinculadas al perfil de usuario en el tenancy de OCI.
- **Buckets Aislados**:
  - `OCI_BUCKET_AVATARS`: Imágenes de perfil públicas optimizadas.
  - `OCI_BUCKET_DOCUMENTS`: Documentos privados protegidos con URLs prefirmadas.
  - `OCI_BUCKET_QUARANTINE`: Archivos sospechosos aislados durante el escaneo antivirus.

---

## 5. Integración con KrakenD Gateway y Observabilidad

- **Manifiesto**: [`gateway/gateway.manifest.json`](file:///d:/BACKUP%20CELULAR%20OLIMPO/crm-media/gateway/gateway.manifest.json).
- **Health Check (`GET /api/v1/health`)**: Verifica el estado y latencia de PostgreSQL, Redis, OCI Object Storage y el socket de ClamAV.
- **Métricas Prometheus (`GET /api/v1/metrics`)**: Expone contadores de peticiones HTTP, trabajos de correo en cola y latencia de llamadas a OCI.
- **Logs Estructurados**: Formato JSON mediante **Pino**, propagando automáticamente `traceId` y `correlationId`.
