# ADR-001: Transferencia Directa de Archivos mediante Pre-Authenticated Requests (PAR) en OCI

- **Estado**: Aceptado
- **Fecha**: 2026-05-25
- **Autores**: Equipo de Infraestructura y Plataforma CIMA

---

## Contexto y Planteamiento del Problema

`crm-media` gestiona la carga y descarga de documentos de proyecto (PDFs de contratos, entregables multimedia de diseño, archivos ZIP de varios gigabytes).

Canalizar la subida y descarga de estos binarios pesados a través del servidor Node.js provocaría:
1. Saturación del bucle de eventos (*event loop*) de Node.js al manipular buffers de red continuos.
2. Agotamiento de la memoria RAM del contenedor y bloqueos durante picos concurrentes.
3. Doble consumo de ancho de banda (cliente $\rightarrow$ servidor y servidor $\rightarrow$ OCI).

---

## Alternativas Evaluadas

### Opción 1: Servidor Node.js como Proxy de Flujo (Streaming Proxy)
- **Descripción**: Recibir el flujo HTTP del cliente y transmitirlo por piping directo hacia OCI Object Storage.
- **Desventajas**: Aunque mitiga el uso de memoria si se usa streaming, el servidor sigue absorbiendo todo el ancho de banda y conexiones de socket abiertas por largos períodos.

### Opción 2: Almacenamiento en Disco Local o Volumen Compartido (NFS)
- **Descripción**: Guardar los archivos en el sistema de archivos del servidor montado en red.
- **Desventajas**: Dificulta el escalamiento horizontal sin balanceadores complejos, requiere aprovisionamiento de discos grandes y complica las copias de seguridad.

### Opción 3 (Elegida): Pre-Authenticated Requests (PAR) Directas a OCI Object Storage
- **Descripción**: `crm-media` actúa exclusivamente como coordinador de metadatos y seguridad. Solicita al SDK de OCI la creación de URLs prefirmadas (PAR) temporales con permisos estrictos de lectura o escritura. El navegador cliente transfiere el binario directamente hacia y desde OCI.

---

## Decisión

Adoptar la **Opción 3**:
1. Para cargas de documentos, el endpoint `POST /api/v1/media/documents/upload-url` genera una PAR de subida con vigencia de 15 minutos.
2. El cliente sube el archivo directamente al bucket privado de OCI mediante `PUT`.
3. Tras la subida, el cliente notifica a `crm-media` mediante `POST /api/v1/media/documents/confirm` para registrar los metadatos en `schema_media.media_assets`.
4. Para descargas, `GET /api/v1/media/documents/access` emite una PAR de lectura temporal con expiración de 15 minutos.
5. El job `oci-par-prune` purga periódicamente las solicitudes prefirmadas vencidas en el bucket de OCI.

---

## Consecuencias

### Positivas
- **Cero Impacto en el Servidor**: El servidor Node.js consume cantidades despreciables de CPU y memoria al manejar solo metadatos JSON.
- **Máximo Ancho de Banda**: La transferencia de datos aprovecha la infraestructura global de alta velocidad de Oracle Cloud.
- **Escalabilidad Inmediata**: Sube de forma ilimitada sin necesidad de dimensionar réplicas adicionales para ancho de banda.

### Negativas
- **Confirmación en Dos Pasos**: Requiere que los clientes web realicen la llamada de solicitud de URL y posteriormente la confirmación de subida.
