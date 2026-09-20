# ADR-002: Protección Antivirus Híbrida (Síncrona y Asíncrona con Cuarentena)

- **Estado**: Aceptado
- **Fecha**: 2026-06-12
- **Autores**: Equipo de Ciberseguridad CIMA

---

## Contexto y Planteamiento del Problema

CIMA CRM permite a empleados y clientes externos subir avatares e intercambiar documentos de trabajo (presentaciones, contratos, hojas de cálculo). Esto abre un vector de ataque crítico si usuarios malintencionados suben troyanos, ransomware o malware camuflado.

El escaneo antivirus presenta retos de arquitectura:
- Si se escanea todo de forma síncrona en el servidor web, archivos de gran tamaño (100 MB+) colapsarían los timeouts HTTP de los clientes.
- Si no se escanea en absoluto, se compromete la seguridad de todos los clientes que descarguen esos archivos.

---

## Alternativas Evaluadas

### Opción 1: Escaneo Síncrono Universal en el Servidor
- **Descripción**: Todo archivo debe pasar por el servidor web y ser escaneado antes de responder `200 OK`.
- **Desventajas**: Inviable con el modelo de subida directa a OCI (PAR) y provocaría fallos masivos por timeout en archivos de más de 50 MB.

### Opción 2: Escaneo Delegado en el Cliente Antivirus del Usuario Final
- **Descripción**: No realizar comprobación en la nube y confiar en el antivirus del sistema operativo del usuario.
- **Desventajas**: Inaceptable desde la postura de seguridad de CIMA; riesgo de distribución de malware dentro de la red corporativa.

### Opción 3 (Elegida): Pipeline Híbrido: Síncrono para Avatares y Asíncrono para Documentos
- **Descripción**:
  1. Los **avatares** ($\le 5$ MB) se escanean síncronamente en memoria contra ClamAV antes de ser recortados y guardados.
  2. Los **documentos** se suben a un bucket de cuarentena en OCI mediante PAR. Un worker en segundo plano (`worker:quarantine-scan`) analiza el objeto. Si está limpio, se confirma su estado activo; si está infectado, se elimina de inmediato y se genera una alerta.

---

## Decisión

Adoptar la **Opción 3**:
1. Desplegar un contenedor ClamAV daemon (`clamav-scanner`) accesible vía socket TCP interno (`CLAMAV_HOST:3310`).
2. Implementar verificación previa de *magic numbers* con `file-type` para rechazar ejecutables con extensiones falsificadas.
3. Para avatares: transmisión del buffer en memoria directamente hacia el socket ClamAV. Respuesta inmediata `400 File infected` si se detecta virus.
4. Para documentos: aislamiento en OCI y escaneo mediante `worker:quarantine-scan`. Registro de eventos en `schema_media.audit_logs`.

---

## Consecuencias

### Positivas
- **Defensa en Profundidad**: Cero ejecución o distribución inadvertida de malware en la plataforma.
- **Experiencia de Usuario Fluida**: Las cargas de archivos grandes no experimentan retrasos innecesarios en la interfaz.
- **Resiliencia Operativa**: Si el daemon de ClamAV experimenta latencia, los documentos se ponen en cola sin detener la plataforma.

### Negativas
- **Ventana de Disponibilidad**: Un documento recién subido puede tardar unos segundos en pasar el escaneo de cuarentena antes de permitir su lectura pública.
