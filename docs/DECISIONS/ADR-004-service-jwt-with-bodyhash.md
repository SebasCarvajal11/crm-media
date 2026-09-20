# ADR-004: Autenticación Máquina a Máquina (M2M) con RS256 e Integridad por `bodyHash`

- **Estado**: Aceptado
- **Fecha**: 2026-07-15
- **Autores**: Equipo de Seguridad y Plataforma CIMA

---

## Contexto y Planteamiento del Problema

El endpoint interno de despacho de correo `POST /api/v1/emails/send` permite emitir comunicaciones oficiales de la empresa, incluyendo enlaces de recuperación de contraseña y contratos de clientes.

Si la autenticación entre microservicios dependiera únicamente de:
1. Red local no autenticada: Cualquier contenedor comprometido en la red Docker podría forjar correos fraudulentos (*email spoofing*).
2. Tokens JWT de servicio convencionales sin enlace al cuerpo: Un atacante intermedio o un proxy interno podría interceptar un token válido y reutilizarlo con un cuerpo alterado (ej. cambiar el destinatario o inyectar enlaces de phishing).

---

## Alternativas Evaluadas

### Opción 1: Clave API Estática en Cabecera (`X-Service-Token`)
- **Descripción**: Compartir una clave secreta estática entre microservicios.
- **Desventajas**: Susceptible a filtraciones, no ofrece no-repudio y carece de protección contra manipulación de cuerpo.

### Opción 2: Service JWT Estándar sin Hash de Contenido
- **Descripción**: Emitir un JWT con `iss: crm-auth`, `aud: crm-media` y vigencia corta.
- **Desventajas**: Aunque autentica al emisor, no vincula criptográficamente el token con el contenido JSON específico que viaja en la petición HTTP.

### Opción 3 (Elegida): Service JWT Asimétrico (RS256) con `bodyHash` (SHA-256)
- **Descripción**: El servicio emisor firma un JWT RS256 que incluye el claim `bodyHash: sha256(rawBody)` y un tiempo de vida ultracorto ($\le 60$ segundos). `crm-media` descarga la clave pública desde el JWKS del emisor y verifica que el hash coincida con el payload exacto recibido.

---

## Decisión

Adoptar la **Opción 3**:
1. En cada petición a `POST /api/v1/emails/send`, el cliente genera un JWT con cabeceras `alg: RS256` y `kid`.
2. El payload del token contiene los claims obligatorios:
   - `iss === sub` (nombre del microservicio emisor).
   - `aud: "crm-media:email"` y `purpose: "email:dispatch"`.
   - `iat` y `exp` (con ventana máxima de expiración de 60 segundos).
   - `bodyHash`: Hash hexadecimal `SHA-256` del cuerpo JSON sin alterar.
3. `crm-media` valida el token contra la URL JWKS declarada en `EMAIL_SERVICE_JWKS[claims.iss]`.
4. Si el hash del cuerpo recibido difiere en un solo carácter del `bodyHash` del token, la petición es rechazada de inmediato con `401 Unauthorized`.

---

## Consecuencias

### Positivas
- **Inmutabilidad de Mensajes**: Imposible alterar destinatarios, enlaces o contenidos sin invalidar la firma criptográfica.
- **Cero Confianza (*Zero Trust*)**: Ningún microservicio puede enviar correos a nombre de otro.
- **Ventana de Ataque Despreciable**: La expiración de 60 segundos neutraliza riesgos de ataques de repetición (*replay attacks*).

### Negativas
- **Sensibilidad al Espaciado JSON**: El cliente emisor debe calcular el hash sobre el mismo string exacto que envía en la cabecera del transporte HTTP.
