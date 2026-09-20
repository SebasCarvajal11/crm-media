# Contratos de API: `crm-media`

Este documento cataloga los endpoints expuestos a través del API Gateway KrakenD y las rutas internas protegidas para comunicación de servicio a servicio.

---

## 1. Endpoints Públicos en KrakenD API Gateway

Todos los endpoints que interactúan con usuarios finales requieren autenticación a través del Gateway, el cual inyecta los encabezados de identidad de confianza (`X-User-Id`, `X-User-Role`).

| Método | Ruta en Gateway / Servicio | Resumen | Roles Permitidos |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/health` | Diagnóstico de salud (DB, Redis, OCI, ClamAV) | Público |
| `GET` | `/api/v1/metrics` | Métricas operativas Prometheus | Monitoreo interno |
| `GET` | `/api/v1/docs/media/openapi.yaml` | Especificación OpenAPI v3 del servicio | Público |
| `POST` | `/api/v1/media/avatars` | Sube y procesa la imagen de perfil del usuario | Todos (autenticados) |
| `GET` | `/api/v1/media/avatars/current` | Retorna la URL vigente del avatar del usuario | Todos (autenticados) |
| `GET` | `/api/v1/media/avatars/users?ids=...` | Consulta masiva de avatares por lista de IDs | Todos (autenticados) |
| `POST` | `/api/v1/media/documents/upload-url` | Genera URL prefirmada (PAR) para subir archivo a OCI | Workers y Administradores |
| `POST` | `/api/v1/media/documents/confirm` | Confirma la carga exitosa del archivo en OCI | Workers y Administradores |
| `GET` | `/api/v1/media/documents/access` | Genera URL prefirmada temporal para visualizar o descargar | Sujeto a permisos de proyecto |
| `DELETE`| `/api/v1/media/documents` | Elimina archivo de OCI y sus metadatos | Propietario o Administrador |
| `GET` | `/api/v1/media/storage/stats` | Estadísticas de cuota OCI y uso de disco | Solo Administradores |

---

## 2. Endpoint Interno de Despacho de Correo: `POST /api/v1/emails/send`

Este endpoint es **estrictamente de servicio a servicio (M2M)** y **no está expuesto en el Gateway**. Solo puede ser invocado en la red interna de Docker por servicios autorizados (`crm-auth`, `crm-marketing`, `crm-collab`).

### Encabezados Requeridos
- `Authorization: Bearer <ServiceJWT>`: Token firmado con algoritmo `RS256` por la clave privada del microservicio emisor.
- `Content-Type: application/json`

### Esquema de Petición (`Payload`)

#### Opción 1: Despacho por Plantilla (Exclusivo para `crm-auth`)
```json
{
  "version": 1,
  "id": "c1f7a28e-5b12-4c22-901b-9f0e1a2b3c4d",
  "expiresAt": "2026-09-22T21:00:00.000Z",
  "to": "usuario@empresa.com",
  "template": {
    "name": "password_reset",
    "variables": {
      "token": "token_opaco_seguro"
    }
  }
}
```

#### Opción 2: Despacho con Contenido Directo (Marketing / Colaboración)
```json
{
  "version": 1,
  "id": "e4d3c2b1-0a9f-4b3c-8d7e-6f5e4d3c2b1a",
  "expiresAt": "2026-09-22T21:00:00.000Z",
  "to": "cliente@empresa.com",
  "replyTo": "soporte@cima.dev",
  "content": {
    "subject": "Nueva actualización en su proyecto CIMA",
    "html": "<h1>Estimado cliente</h1><p>Su entregable ha sido aprobado.</p>",
    "text": "Estimado cliente: Su entregable ha sido aprobado."
  }
}
```

### Respuestas HTTP
- `202 Accepted`: El comando fue validado, cifrado y depositado en la cola BullMQ (`{"success": true, "messageId": "...", "status": "queued"}`).
- `400 Bad Request`: Payload malformado o fecha de expiración inválida.
- `401 Unauthorized`: Token de servicio ausente, expirado, con firma inválida o con `bodyHash` no coincidente.
- `403 Forbidden`: El servicio emisor no tiene autorización para enviar la plantilla solicitada.
- `409 Conflict`: El `id` de mensaje ya fue registrado previamente con un contenido diferente.
- `503 Service Unavailable`: Falla temporal de conectividad con Redis o el almacén de claves.

---

## 3. Estructura de Envoltorio de Respuestas (`DataEnvelope`)

Las respuestas de la API de medios siguen el estándar unificado:

```json
{
  "data": {
    "url": "https://objectstorage.us-ashburn-1.oraclecloud.com/p/.../o/document.pdf",
    "expiresInSeconds": 900
  }
}
```
