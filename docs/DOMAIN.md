# Modelo de Dominio: `crm-media`

Este documento describe las entidades de negocio, el ciclo de vida de los activos digitales, las políticas de versionado y las reglas del motor unificado de mensajería electrónica.

---

## 1. Dominio de Medios: Avatares

El avatar representa la imagen pública oficial de perfil del usuario dentro de la plataforma.

```text
[ Selección Catálogo (0-83) + Color ] ──► [ Carga Asset Oficial ] ──► [ Composición Sharp (512x512) ]
                                                                                  │
[ Entrega URLs Variantes ] ◄── [ Inserción Metadatos ] ◄── [ Carga OCI (64, 256, 512) ]
```

### Reglas de Negocio para Avatares
1. **Catálogo Oficial CIMA y Marca Unificada**: La plataforma utiliza un catálogo curado de 84 avatares institucionales con selección de color de fondo corporativo mediante `POST /api/v1/media/avatars/preset`. La subida manual libre de archivos binarios queda permanentemente deshabilitada (410 Gone) para salvaguardar la coherencia de marca, prevenir cuellos de botella de red y erradicar vectores de ataque por carga de binarios.
2. **Unicidad y Versionado**: Cada usuario posee un único avatar activo. Al asignar un nuevo preset, se incrementa `avatarVersion` para invalidar de forma determinista el caché en los navegadores cliente.
3. **Composición y Optimización de Imagen**: El avatar seleccionado se compone server-side con Sharp sobre un fondo con el color corporativo elegido, exportándose a tres variantes WebP optimizadas: 64px, 256px y 512px.
4. **Resiliencia de Dos Fases y Rollback Compensatorio**: Las variantes se suben a OCI antes de abrir la transacción SQL ultra-corta. Si la base de datos falla, se activa una compensación automática que purga los objetos en OCI.
5. **Consulta Masiva**: El endpoint `GET /api/v1/media/avatars/users?ids=u1,u2` permite a las vistas de equipo y tableros resolver múltiples avatares en un solo viaje HTTP.

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
