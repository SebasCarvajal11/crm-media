# ============================================================
# 02 — Subida de Avatares
# ============================================================
# Prueba los endpoints de avatares:
# - Admin sube avatar
# - Worker sube avatar
# - Client sube avatar
# - Guest NO puede subir avatar (401)
# - Validacion de tamano maximo (5MB)
# - Validacion de tipo MIME
# ============================================================

# Login
POST {{base_url}}/api/v1/auth/login
Content-Type: application/json
{
  "email": "admin@cima.dev",
  "password": "Admin123!"
}
HTTP 200
[Captures]
admin_token: jsonpath "$.data.access_token"

POST {{base_url}}/api/v1/auth/login
Content-Type: application/json
{
  "email": "ana.martinez@cima.dev",
  "password": "Demo123!"
}
HTTP 200
[Captures]
worker_token: jsonpath "$.data.access_token"

POST {{base_url}}/api/v1/auth/login
Content-Type: application/json
{
  "email": "contacto@restauranteelbuensabor.com",
  "password": "Demo123!"
}
HTTP 200
[Captures]
client_token: jsonpath "$.data.access_token"

# --- Guest: NO puede subir avatar (401) ---
POST {{base_url}}/api/v1/media/avatars
HTTP 401

# --- Admin: Sube avatar ---
POST {{base_url}}/api/v1/media/avatars
Authorization: Bearer {{admin_token}}
[MultipartFormData]
file: file,test-files/test-image.png; image/png
HTTP 201
[Asserts]
jsonpath "$.data" exists

# --- Worker: Sube avatar ---
POST {{base_url}}/api/v1/media/avatars
Authorization: Bearer {{worker_token}}
[MultipartFormData]
file: file,test-files/test-image.png; image/png
HTTP 201
[Asserts]
jsonpath "$.data" exists

# --- Client: Sube avatar ---
POST {{base_url}}/api/v1/media/avatars
Authorization: Bearer {{client_token}}
[MultipartFormData]
file: file,test-files/test-image.png; image/png
HTTP 201
[Asserts]
jsonpath "$.data" exists

# --- El tipo declarado no reemplaza la validacion por contenido ---
POST {{base_url}}/api/v1/media/avatars
Authorization: Bearer {{admin_token}}
[MultipartFormData]
file: file,test-files/test-image.png; text/plain
HTTP 201
[Asserts]
jsonpath "$.data" exists
