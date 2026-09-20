# Modelo de Dominio: `crm-media`

Este documento describe las entidades de negocio, el ciclo de vida de los activos digitales, las políticas de versionado y las reglas del motor unificado de mensajería electrónica.

---

## 1. Dominio de Medios: Avatares

El avatar representa la imagen pública de perfil del usuario dentro de la plataforma.

```text
[ Subida Multipart ] ──► [ Validación Magic Number ] ──► [ Escaneo ClamAV ]
                                                                 │
[ Entrega URL ] ◄── [ Inserción Metadata ] ◄── [ Redimensionamiento Sharp ]
```

### Reglas de Negocio para Avatares
1. **Unicidad y Versionado**: Cada usuario posee un único avatar activo. Al subir uno nuevo, se incrementa `avatarVersion` para romper de forma determinista el caché en los navegadores cliente.
2. **Validación Antivirus Síncrona**: Al ser un archivo de bajo peso ($\le 5$ MB), el flujo HTTP valida los *magic numbers* reales con `file-type` y ejecuta un escaneo síncrono con ClamAV antes de procesarlo.
3. **Procesamiento de Imagen**: Se recorta al centro en relación de aspecto 1:1, se redimensiona a dimensiones estándar y se optimiza para entrega web rápida.
4. **Consulta Masiva**: El endpoint `GET /api/v1/media/avatars/users?ids=u1,u2` permite a las vistas de equipo y tableros resolver múltiples avatares en un solo viaje HTTP.

---

## 2. Dominio de Medios: Documentos y Archivos de Proyecto

Los documentos corresponden a entregables, contratos, briefs, manuales y archivos adjuntos a tareas o chats.

### Ciclo de Vida del Documento
1. **Solicitud de Carga (`upload-url`)**: El cliente envía nombre, tipo MIME y tamaño en bytes. El servicio valida que no exceda el límite permitido y genera una URL prefirmada (PAR) de OCI con vigencia de 15 minutos.
2. **Transferencia Directa**: El cliente sube el archivo directamente a OCI Object Storage. Cero impacto en CPU o memoria del microservicio.
3. **Confirmación (`confirm`)**: El cliente notifica que la carga ha concluido. El servicio verifica la existencia física del objeto en OCI, registra sus metadatos en `schema_media.media_assets` y lo encola para escaneo en segundo plano.
4. **Generación de Acceso (`access`)**: Para consultar o descargar, el servicio emite una URL prefirmada de lectura con expiración corta, agregando cabeceras `Content-Disposition` si se requiere descarga forzada.
5. **Eliminación (`delete`)**: Elimina el objeto en OCI y purga sus metadatos en PostgreSQL.

---

## 3. Dominio de Correo Electrónico: Despacho Unificado

Centraliza la emisión de correos transaccionales y de marketing a través de una API estandarizada.

### Clasificación de Mensajes

#### A. Correos Transaccionales con Plantilla del Sistema
- **Emisor Exclusivo**: `crm-auth`.
- **Plantillas Disponibles**:
  - `password_reset`: Recuperación de contraseña con enlace de un solo uso.
  - `client_invite`: Invitación a clientes externos para acceder a su portal.
  - `worker_invite`: Invitación a colaboradores internos para unirse al equipo.
  - `admin_invite`: Invitación a administradores de la plataforma.
  - `email_verify`: Verificación de correo electrónico.
- **Variables Estrictas**: Validadas por esquema Zod en tiempo de ejecución.

#### B. Correos de Negocio con Contenido Libre
- **Emisores Autorizados**: `crm-marketing`, `crm-collab`.
- **Estructura Requerida**: `subject` (máx. 250 caracteres), `html` y `text` (versión texto plano para clientes de correo sin soporte HTML).

### Invariantes del Motor de Correo
1. **Idempotencia Absoluta**: Todo mensaje incluye un UUID `id` y una fecha límite `expiresAt`. Si el emisor reintenta el comando por pérdida de red, el sistema reconoce el `id` y evita duplicar el envío.
2. **Respuesta Asíncrona Inmediata**: La llamada HTTP responde `202 Accepted` confirmando la persistencia segura en la cola. La entrega física la realiza el worker en segundo plano.
3. **Protección Criptográfica en Reposo**: Antes de depositarse en Redis, el cuerpo del correo se cifra con AES-256-GCM.
