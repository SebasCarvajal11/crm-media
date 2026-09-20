# ADR-003: Motor Centralizado de Correo con Cifrado en Reposo AES-256-GCM

- **Estado**: Aceptado
- **Fecha**: 2026-06-28
- **Autores**: Equipo de Arquitectura y Privacidad CIMA

---

## Contexto y Planteamiento del Problema

Múltiples microservicios en la plataforma CIMA requieren despachar correos electrónicos:
- `crm-auth`: Restablecimiento de contraseñas, invitaciones a clientes y trabajadores.
- `crm-collab`: Notificaciones de asignación de tareas, menciones y cambios de contrato.
- `crm-marketing`: Campañas por correo y boletines informativos.

Permitir que cada microservicio configure su propio cliente SMTP generaba:
1. Dispersión de credenciales SMTP en múltiples repositorios y entornos.
2. Comportamientos dispares ante fallos de red o límites de tasa (*rate limits*) del proveedor de correo.
3. Riesgo de fuga de Información Personal Identificable (PII) si los mensajes pendientes en colas de Redis se almacenaban en texto plano.

---

## Alternativas Evaluadas

### Opción 1: Cliente SMTP Descentralizado en Cada Microservicio
- **Descripción**: Cada servicio incluye `nodemailer` y sus propias variables de entorno SMTP.
- **Desventajas**: Duplicación de código, gestión dispersa de secretos y saturación de conexiones SMTP hacia el proveedor.

### Opción 2: Motor Centralizado con Mensajes en Texto Plano en Redis
- **Descripción**: Unificar el despacho en `crm-media`, encolando los payloads directamente en JSON dentro de BullMQ.
- **Desventajas**: Los correos electrónicos contienen datos sensibles (tokens de reseteo, correos, nombres) que quedarían expuestos en memoria y copias de seguridad de Redis.

### Opción 3 (Elegida): Motor Centralizado con Cola BullMQ y Cifrado AES-256-GCM
- **Descripción**: Centralizar el despacho en `crm-media` (`POST /api/v1/emails/send`). Al recibir el comando, se valida el esquema, se cifra el payload con AES-256-GCM y se encola en BullMQ (`mod-media-email`). El worker `email.worker.ts` descifra en el momento del envío hacia Brevo SMTP.

---

## Decisión

Adoptar la **Opción 3**:
1. `crm-media` aloja la única integración con Brevo SMTP (`smtp-relay.brevo.com:587`), configurada con TLS estricto y verificación SNI.
2. Todos los microservicios envían sus peticiones de correo a `POST /api/v1/emails/send`.
3. El módulo cifra la carga útil completa mediante `email.crypto.ts` usando la clave simétrica `EMAIL_ENCRYPTION_KEY` antes de escribir en Redis.
4. El worker `email.worker.ts` extrae el trabajo, descifra en memoria, compila plantillas y transmite el correo.
5. Se aplican políticas de reintento con *exponential backoff* para manejar caídas temporales del relay SMTP sin perder mensajes.

---

## Consecuencias

### Positivas
- **Punto Único de Control**: Rotación centralizada de credenciales SMTP y monitoreo unificado de entregabilidad.
- **Privacidad y Cumplimiento (GDPR/Habeas Data)**: Cero exposición de PII en memoria o discos de Redis ante auditorías o brechas.
- **Alta Disponibilidad**: Respuesta inmediata `202 Accepted` a los microservicios emisores; la plataforma no se detiene si Brevo experimenta lentitud.

### Negativas
- **Gestión de Clave Criptográfica**: Requiere la custodia segura de `EMAIL_ENCRYPTION_KEY` en todos los entornos.
