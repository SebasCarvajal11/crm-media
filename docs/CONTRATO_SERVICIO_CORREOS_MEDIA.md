# Contrato de Integración: Servicio Centralizado de Correos CIMA (`crm-media`)

Este documento especifica el contrato de API para que el módulo de **Marketing** (Java Spring Boot) y cualquier otro microservicio de la plataforma CIMA puedan despachar correos electrónicos (campañas, boletines, notificaciones y correos transaccionales) a través del motor centralizado en **`crm-media`**.

---

## 1. Información General del Servicio

- **Proveedor**: `crm-media` (Gestor unificado de activos y mensajería digital).
- **Protocolo**: HTTP REST / JSON.
- **URLs de Acceso**:
  - **Red Interna Docker (Recomendada para microservicios)**: `http://crm-media:3002/api/v1/emails/send`
  - **A través de KrakenD API Gateway**: `http://api-gateway:8080/api/v1/emails/send` (o `http://localhost:28080/api/v1/emails/send` en host)
- **Transporte Subyacente**: Relay SMTP de **Brevo** (`smtp-relay.brevo.com`) en producción / modo `log` en desarrollo local.
- **Modos de Despacho**:
  - **Asíncrono (`sync: false`, predeterminado)**: El mensaje se valida, se encola en BullMQ (`mod-media-email`) y responde de inmediato con `HTTP 202 Accepted` y el identificador de trabajo. Recomendado para alto volumen y campañas.
  - **Sincrónico (`sync: true`)**: El servicio aguarda la confirmación de transmisión del servidor SMTP y responde con `HTTP 200 OK`.

---

## 2. Endpoints Disponibles

### `POST /api/v1/emails/send`

Endpoint universal para despacho de correos con contenido directo (HTML / texto) o por plantilla de sistema.

#### Headers Requeridos
| Header | Valor | Obligatorio | Descripción |
| :--- | :--- | :--- | :--- |
| `Content-Type` | `application/json` | Sí | Formato de datos JSON |
| `x-trace-id` | `UUID / String` | No | ID de traza para observabilidad distribuida |
| `x-correlation-id` | `UUID / String` | No | ID de correlación de la solicitud |

---

## 3. Estructura de la Petición (`Payload`)

### Esquema de Campos

```json
{
  "to": "destinatario@empresa.com",
  "subject": "Asunto del correo (opcional si se usa plantilla)",
  "from": "Nombre Remitente <remitente@cima.dev>",
  "replyTo": "respuestas@cima.dev",
  "cc": ["copia@cima.dev"],
  "bcc": ["copia.oculta@cima.dev"],
  "content": {
    "subject": "Título principal del correo",
    "html": "<h1>Hola</h1><p>Contenido HTML aquí</p>",
    "text": "Versión en texto plano (opcional; si se omite, se deriva del HTML)"
  },
  "template": {
    "name": "password_reset | client_invite | worker_invite | email_verify",
    "variables": {
      "token": "token-seguridad-123",
      "to": "destinatario@empresa.com",
      "role": "diseñador"
    }
  },
  "sync": false,
  "metadata": {
    "campaignId": "campana-otoño-2026",
    "segmentId": "clientes-vip"
  }
}
```

> [!NOTE]
> Se debe suministrar el objeto **`content`** (para correos personalizados o de marketing) **O** el objeto **`template`** (para plantillas preconfiguradas del sistema).
> El campo `to` acepta tanto una dirección única en string (`"usuario@empresa.com"`) como un arreglo de correos (`["u1@cima.dev", "u2@cima.dev"]`).

---

## 4. Ejemplos de Uso

### Ejemplo A: Envío de Campaña de Marketing (HTML Personalizado)

```http
POST http://crm-media:3002/api/v1/emails/send HTTP/1.1
Content-Type: application/json

{
  "to": ["cliente1@empresa.com", "cliente2@empresa.com"],
  "subject": "Descubre las novedades de Septiembre en CIMA",
  "content": {
    "subject": "Descubre las novedades de Septiembre en CIMA",
    "html": "<div style=\"font-family: Arial, sans-serif; padding: 20px;\"><h2>¡Hola!</h2><p>Te presentamos las nuevas funciones disponibles en tu plan.</p><a href=\"https://cima.dev/promocion\" style=\"background:#8F2B2E;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;\">Ver Novedades</a></div>",
    "text": "Hola! Te presentamos las nuevas funciones disponibles en tu plan: https://cima.dev/promocion"
  },
  "sync": false,
  "metadata": {
    "campaignId": "camp_2026_09",
    "source": "crm-marketing"
  }
}
```

**Respuesta Exitosa (`HTTP 202 Accepted`)**:
```json
{
  "success": true,
  "messageId": "email-1789447833950-f3rb514",
  "status": "queued"
}
```

---

### Ejemplo B: Envío de Invitación a Usuario

```http
POST http://crm-media:3002/api/v1/emails/send HTTP/1.1
Content-Type: application/json

{
  "to": "nuevo.colaborador@empresa.com",
  "template": {
    "name": "worker_invite",
    "variables": {
      "token": "tok_inv_887123",
      "role": "Especialista de Marketing"
    }
  },
  "sync": false
}
```

---

## 5. Código de Ejemplo para Java 21 / Spring Boot (`crm-marketing`)

### DTOs de Solicitud y Respuesta

```java
package com.cima.marketing.client.email;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record SendEmailRequest(
    Object to,                      // String o List<String>
    String subject,
    String from,
    String replyTo,
    EmailContent content,
    EmailTemplate template,
    Boolean sync,
    Map<String, Object> metadata
) {
    public static SendEmailRequest marketingEmail(
            List<String> recipients,
            String subject,
            String html,
            String text,
            Map<String, Object> metadata) {
        return new SendEmailRequest(
            recipients,
            subject,
            null,
            null,
            new EmailContent(subject, html, text),
            null,
            false,
            metadata
        );
    }
}

public record EmailContent(String subject, String html, String text) {}

public record EmailTemplate(String name, Map<String, Object> variables) {}

public record EmailResponse(boolean success, String messageId, String status) {}
```

### Servicio Cliente Spring Boot (`RestClient`)

```java
package com.cima.marketing.client.email;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import java.util.List;
import java.util.Map;

@Service
public class MediaEmailClient {

    private final RestClient restClient;

    public MediaEmailClient(@Value("${services.media.url:http://crm-media:3002}") String mediaServiceUrl) {
        this.restClient = RestClient.builder()
                .baseUrl(mediaServiceUrl)
                .build();
    }

    public EmailResponse sendMarketingCampaign(
            List<String> recipients,
            String subject,
            String htmlContent,
            String plainText,
            String campaignId) {

        SendEmailRequest request = SendEmailRequest.marketingEmail(
                recipients,
                subject,
                htmlContent,
                plainText,
                Map.of("campaignId", campaignId, "module", "crm-marketing")
        );

        return this.restClient.post()
                .uri("/api/v1/emails/send")
                .contentType(MediaType.APPLICATION_JSON)
                .body(request)
                .retrieve()
                .body(EmailResponse.class);
    }
}
```

---

## 6. Códigos de Estado y Manejo de Errores

| Código HTTP | Descripción | Estructura de Respuesta |
| :--- | :--- | :--- |
| **`200 OK`** | Correo enviado y confirmado por el servidor SMTP (modo `sync: true`). | `{"success": true, "messageId": "...", "status": "sent"}` |
| **`202 Accepted`** | Correo recibido, validado y encolado para despacho asíncrono. | `{"success": true, "messageId": "...", "status": "queued"}` |
| **`400 Bad Request`** | Parámetros inválidos (ej. correo mal formado, falta de `content`/`template`). | `{"error": "Parámetros de correo inválidos", "details": {...}}` |
| **`500 Internal Server Error`** | Error interno durante el despacho o conexión con Brevo/Redis. | `{"error": "Error al despachar el correo", "message": "..."}` |
