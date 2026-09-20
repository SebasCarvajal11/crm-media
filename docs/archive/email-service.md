# Servicio Centralizado de Correo Electrónico (`crm-media`)

## 1. Visión General

El módulo `crm-media` centraliza el despacho y entrega de correos electrónicos para todo el ecosistema CIMA CRM. Proporciona una capa desacoplada del proveedor de transporte (Brevo SMTP), garantizando resiliencia mediante colas distribuidas (BullMQ en Redis), cifrado de datos sensibles en tránsito y reposo (AES-256-GCM), y autenticación estricta servicio-a-servicio mediante JWT RS256 con verificación JWKS.

---

## 2. Arquitectura del Flujo de Despacho

```
[ Microservicio Emisor ] (ej. crm-auth, crm-marketing, crm-collab)
          │
          │ 1. Evento transaccional en Outbox local
          ▼
   [ Outbox Worker ] ── (Firma JWT RS256 + sha256(body)) ──┐
                                                            ▼
                                        [ POST /api/v1/emails/send ]
                                                    │ (crm-media HTTP)
                                                    ▼
                                            [ Validar JWT / JWKS ]
                                                    │
                                                    ▼
                                        [ Encriptar AES-256-GCM ]
                                                    │
                                                    ▼
                                            [ Cola BullMQ Redis ]
                                                    │
                                                    ▼
                                        [ crm-media-email-worker ]
                                                    │ (Descifra & Conecta)
                                                    ▼
                                            [ Brevo SMTP (TLS) ]
                                                    │
                                                    ▼
                                            [ Destinatario Final ]
```

---

## 3. Contrato de Integración (`cima-contracts`)

El contrato canónico está definido en `@sebascarvajal11/cima-contracts/email-dispatch`.

### Especificación de Petición (`POST /api/v1/emails/send`)

#### Opción A: Plantillas de Identidad (Exclusivo `crm-auth`)
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

Plantillas disponibles:
- `password_reset`: Recuperación de acceso (`/reset-password?token=...`).
- `client_invite`: Invitación para clientes al portal (`/accept-invite/:token`).
- `worker_invite`: Invitación para colaboradores (`/accept-invite/:token`).
- `admin_invite`: Invitación para nuevos administradores (`/accept-invite/:token`).
- `email_verify`: Verificación de dirección de correo (`/verify-email?token=...`).

#### Opción B: Contenido Dinámico (Otros Microservicios: Marketing, Colaboración)
```json
{
  "version": 1,
  "id": "8a2f1b0e-3c4d-4e5f-a6b7-8c9d0e1f2a3b",
  "expiresAt": "2026-09-22T21:00:00.000Z",
  "to": "cliente@prospecto.com",
  "replyTo": "ventas@cima.dev",
  "content": {
    "subject": "Nueva Propuesta Comercial - CIMA",
    "html": "<p>Estimado cliente, adjuntamos su propuesta...</p>",
    "text": "Estimado cliente, adjuntamos su propuesta..."
  }
}
```

---

## 4. Seguridad y Autenticación Entre Servicios

Cada petición a `/api/v1/emails/send` debe incluir un header `Authorization: Bearer <JWT>` firmado con la clave privada RS256 del microservicio emisor:

- **Header**: `{"alg": "RS256", "kid": "<identificador-llave>"}`
- **Claims Requeridos**:
  - `iss`: Identificador del emisor (ej. `"crm-auth"`, `"crm-marketing"`).
  - `sub`: Mismo valor que `iss`.
  - `aud`: `"crm-media:email"` (audiencia estricta).
  - `purpose`: `"email:dispatch"`.
  - `iat`: Timestamp actual en segundos.
  - `exp`: `iat + 60` (vigencia máxima 60 segundos).
  - `bodyHash`: `sha256(JSON.stringify(requestBody))` (integridad del payload).

`crm-media` valida la firma consultando el endpoint JWKS del emisor configurado en `EMAIL_SERVICE_JWKS`:
```env
EMAIL_SERVICE_JWKS='{"crm-auth":"http://crm-auth:3000/api/v1/.well-known/jwks.json","crm-marketing":"http://crm-marketing:3003/api/v1/.well-known/jwks.json"}'
```

---

## 5. Configuración de Transporte Brevo SMTP

En el archivo de entorno `.env` de `crm-media`:

```env
MAIL_TRANSPORT='smtp'
SMTP_HOST='smtp-relay.brevo.com'
SMTP_PORT='587'
SMTP_USER='<usuario-smtp-brevo>'
SMTP_PASS='<clave-smtp-brevo>'
SMTP_SECURE='false'
SMTP_REQUIRE_TLS='true'
SMTP_TLS_SERVERNAME='smtp-relay.brevo.com'
MAIL_FROM='CIMA CRM <appsfacilitan2025@gmail.com>'
APP_PUBLIC_URL='http://localhost:5173'
EMAIL_QUEUE_ENCRYPTION_KEY='<clave-base64-32bytes>'
```

> **Nota Crítica sobre TLS**: Los certificados de Brevo presentan `*.brevo.com`. `SMTP_TLS_SERVERNAME=smtp-relay.brevo.com` asegura la validación SNI sin relajar las restricciones de seguridad TLS (`rejectUnauthorized: true`).
