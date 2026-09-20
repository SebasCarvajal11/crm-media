# Seguridad, Criptografía y Protección de Activos: `crm-media`

Este documento describe los mecanismos de ciberseguridad, validación antivirus, control de acceso a archivos privados y autenticación criptográfica entre servicios.

---

## 1. Escaneo Antivirus y Validación de Archivos

Para evitar la introducción de malware, exploits o ejecutables maliciosos:

```text
[ Archivo Entrante ] ──► [ Validación de Magic Numbers ]
                                   │
                                   ├──► (Falla) ──► [ HTTP 400 Bad Request ]
                                   ▼
                         [ Escaneo ClamAV Daemon ]
                                   │
                                   ├──► (Infectado) ──► [ Rechazo / Cuarentena ]
                                   ▼
                         [ Almacenamiento Seguro ]
```

1. **Inspección de Magic Numbers**: Antes de confiar en el nombre o extensión del archivo (`.png`, `.pdf`), el servicio analiza los bytes de cabecera con la librería `file-type`. Cualquier discrepancia entre la extensión y el contenido binario real es rechazada.
2. **Escaneo Antivirus con ClamAV**:
   - **Avatares (Síncrono)**: El buffer en memoria se transmite por socket TCP hacia el daemon de ClamAV (`clamscan`). Si se detecta un virus, la petición se cancela de inmediato con `400 File infected`.
   - **Documentos (Asíncrono en Cuarentena)**: Para archivos de gran tamaño subidos directamente a OCI, el worker `quarantine-scan` descarga y analiza el archivo. Si está limpio, se confirma su disponibilidad; si está infectado, se elimina y se registra en auditoría.

---

## 2. Acceso a Archivos Privados mediante Pre-Authenticated Requests (PAR)

- **Cero Acceso Público**: Los buckets de OCI Object Storage son completamente privados. Ningún archivo es accesible sin autorización previa.
- **URLs Temporales de Lectura**: Al solicitar acceso a un documento (`GET /api/v1/media/documents/access`), se genera un enlace PAR con una vida útil de 15 minutos (900 segundos).
- **Control de Acceso Delegado**: `crm-media` delega la comprobación de si el usuario pertenece al proyecto o tarea correspondiente en `crm-collab` antes de autorizar la emisión de la URL prefirmada.

---

## 3. Autenticación M2M de Comandos de Medios (RS256)

Los comandos recibidos a través del stream `stream:collab.media-commands` son procesados únicamente si contienen una firma válida:

1. El comando incluye un Service JWT en el campo `signature`.
2. El worker de medios descarga la clave pública de `crm-collab` mediante su endpoint JWKS (`/.well-known/service-jwks.json`).
3. Se verifican estrictamente los claims:
   - `iss === "crm-collab"`
   - `aud === "crm-media"`
   - `purpose === "media.command"`
   - `correlationId === command.correlationId`
   - `commandType === command.type`

---

## 4. Despacho de Correo: Service JWT con Hash Criptográfico (`bodyHash`)

Para proteger el endpoint interno `POST /api/v1/emails/send`:

1. **Firma Asimétrica (RS256)**: El microservicio emisor firma un JWT con su clave privada.
2. **Hash de Cuerpo Inmutable (`bodyHash`)**: El claim `bodyHash` debe coincidir exactamente con el hash `SHA-256` del cuerpo JSON sin procesar. Esto previene ataques de manipulación en tránsito (*Man-in-the-Middle*).
3. **Resolución Segura de Claves**: El emisor se valida contra una lista blanca fija en configuración (`EMAIL_SERVICE_JWKS`). Jamás se descargan claves de URLs suministradas por el propio token.
4. **Cifrado AES-256-GCM en Cola**: La carga útil del correo (destinatario, asunto, cuerpo HTML) se cifra con AES-256-GCM antes de ser depositada en la cola de Redis. Si la memoria de Redis o sus volcados RDB fuesen inspeccionados, los datos sensibles permanecen inaccesibles.
