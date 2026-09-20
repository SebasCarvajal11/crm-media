# Arquitectura del Sistema: `crm-media`

Este documento describe la arquitectura modular, los subsistemas de almacenamiento y mensajería digital, el ciclo de vida de los workers en segundo plano y las garantías de resiliencia en `crm-media`.

---

## 1. Visión General y Topología

`crm-media` opera como un microservicio híbrido que combina almacenamiento binario en la nube con un motor de despacho de correos electrónicos de alta disponibilidad:

```text
       ┌────────────────────────┐         ┌────────────────────────┐
       │    KrakenD Gateway     │         │ Microservicios (Auth / │
       │  (Peticiones Usuarios) │         │  Collab / Marketing)   │
       └───────────┬────────────┘         └───────────┬────────────┘
                   │                                  │ (M2M Service JWT)
                   ▼                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│                            crm-media                             │
│ ┌─────────────────────────────┐  ┌─────────────────────────────┐ │
│ │        Módulo Media         │  │        Módulo Email         │ │
│ │  (Avatares, Documentos PAR, │  │   (Validación JWT bodyHash, │ │
│ │   Metadatos, Cuotas Cloud)  │  │    Cifrado AES-256 en cola) │ │
│ └──────────────┬──────────────┘  └──────────────┬──────────────┘ │
└────────────────┼────────────────────────────────┼────────────────┘
                 │                                │
     ┌───────────┴───────────┐        ┌───────────┴───────────┐
     ▼                       ▼        ▼                       ▼
┌──────────────┐      ┌────────────┐ ┌──────────────┐  ┌─────────────┐
│  OCI Object  │      │   ClamAV   │ │    Redis     │  │ Brevo SMTP  │
│   Storage    │      │ (Antivirus)│ │ (BullMQ Queue│  │   (Relay)   │
│  (Binarios)  │      │            │ │   y Streams) │  │             │
└──────────────┘      └────────────┘ └──────────────┘  └─────────────┘
```

---

## 2. Organización Modular de Código

El código fuente en `src/modules` está estrictamente desacoplado en dos subdominios:

### A. Subdominio Media (`src/modules/media`)
- **`avatar.service.ts`**: Procesamiento de imágenes de perfil con `sharp` (redimensionamiento cuadrado, compresión WebP/PNG, múltiples resoluciones y versionado incremental).
- **`document.service.ts`**: Gestión del ciclo de vida de documentos: generación de URLs prefirmadas para subida y lectura, confirmación de carga y borrado seguro.
- **`storage.service.ts`**: Abstracción del almacenamiento en OCI Object Storage, cálculo de estadísticas de disco local y cuotas en la nube.
- **`media.controller.ts` & `media.routes.ts`**: Controladores HTTP expuestos hacia el API Gateway.

### B. Subdominio Email (`src/modules/email`)
- **`email.authorization.ts`**: Validador de seguridad máquina a máquina (M2M). Verifica Service JWT (RS256) contra el JWKS del emisor y comprueba el `bodyHash` SHA-256.
- **`email.crypto.ts`**: Cifrado simétrico AES-256-GCM para proteger los datos de los correos en reposo mientras esperan en la cola de Redis.
- **`email.queue.ts`**: Productor de trabajos en la cola BullMQ (`mod-media-email`) con backoff exponencial.
- **`email.processor.ts`**: Consumidor de BullMQ que descifra el payload y despacha a través de Nodemailer.
- **`email.mailer.ts`**: Cliente Nodemailer conectado a Brevo SMTP (o modo `log` en desarrollo local).
- **`email.templates.ts`**: Plantillas tipadas para flujos de identidad (`password_reset`, `client_invite`, etc.).

---

## 3. Procesos y Workers en Segundo Plano

`crm-media` ejecuta tres workers independientes para garantizar que las tareas pesadas no bloqueen el servidor HTTP:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        Procesos en Background                          │
├──────────────────────────┬─────────────────────────┬───────────────────┤
│   worker:media-commands  │  worker:quarantine-scan │   worker:email    │
├──────────────────────────┼─────────────────────────┼───────────────────┤
│ • Consume Redis Stream   │ • Tarea periódica cron. │ • Consumidor      │
│   stream:collab.media-   │ • Descarga archivos en  │   BullMQ.         │
│   commands.              │   cuarentena de OCI.    │ • Descifra datos  │
│ • Verifica Service JWT.  │ • Ejecuta escaneo con   │   AES-256-GCM.    │
│ • Ejecuta operaciones de │   ClamAV sobre socket   │ • Envía vía Brevo │
│   archivos y responde a  │   TCP.                  │   SMTP con TLS.   │
│   stream:media.asset-    │ • Elimina archivos      │ • Gestiona fallos │
│   responses.             │   infectados y notifica.│   y reintentos.   │
└──────────────────────────┴─────────────────────────┴───────────────────┘
```

---

## 4. Estrategia de Almacenamiento Cero-Tráfico en Servidor

Para maximizar el rendimiento y minimizar el consumo de ancho de banda y memoria RAM:

1. **Pre-Authenticated Requests (PAR)**: El servidor Node.js nunca recibe ni sirve directamente los archivos binarios pesados (documentos, contratos, videos).
2. **Subida Directa**: El cliente solicita una URL prefirmada (`POST /api/v1/media/documents/upload-url`) y envía el archivo directamente a OCI Object Storage mediante `PUT`.
3. **Lectura Directa**: El cliente solicita acceso (`GET /api/v1/media/documents/access`) y recibe una URL prefirmada temporal de lectura generada por OCI con expiración configurable (por defecto 15 minutos).
4. **Excepción de Avatares**: Los avatares pasan por el servidor únicamente para permitir el escaneo antivirus inmediato y el recorte/redimensionamiento automático con Sharp.
