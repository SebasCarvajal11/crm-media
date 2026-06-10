# ============================================================
# 03 — Obtencion de Avatares
# ============================================================
# Prueba los endpoints de obtencion de avatares:
# - Obtiene avatar del usuario actual
# - Obtiene avatar de otro usuario
# - Avatar inexistente (404)
# - Batch de avatares (multiples IDs)
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
admin_id: jsonpath "$.data.user.id"

POST {{base_url}}/api/v1/auth/login
Content-Type: application/json
{
  "email": "ana.martinez@cima.dev",
  "password": "Demo123!"
}
HTTP 200
[Captures]
worker_token: jsonpath "$.data.access_token"
worker_id: jsonpath "$.data.user.id"

# Primero subir avatares para tener datos
POST {{base_url}}/api/v1/media/avatars
Authorization: Bearer {{admin_token}}
Content-Type: multipart/form-data; boundary=----FormBoundary
------FormBoundary
Content-Disposition: form-data; name="file"; filename="avatar_admin.png"
Content-Type: image/png

<test-files/test-image.png
------FormBoundary--
HTTP 201

POST {{base_url}}/api/v1/media/avatars
Authorization: Bearer {{worker_token}}
Content-Type: multipart/form-data; boundary=----FormBoundary2
------FormBoundary2
Content-Disposition: form-data; name="file"; filename="avatar_worker.png"
Content-Type: image/png

<test-files/test-image.png
------FormBoundary2--
HTTP 201

# --- Admin: Obtiene su propio avatar ---
GET {{base_url}}/api/v1/media/avatars/current
Authorization: Bearer {{admin_token}}
HTTP 200
[Asserts]
jsonpath "$.data" exists

# --- Worker: Obtiene su propio avatar ---
GET {{base_url}}/api/v1/media/avatars/current
Authorization: Bearer {{worker_token}}
HTTP 200
[Asserts]
jsonpath "$.data" exists

# --- Batch: Obtiene avatares de multiples usuarios ---
GET {{base_url}}/api/v1/media/avatars/users?ids={{admin_id}}&ids={{worker_id}}
Authorization: Bearer {{worker_token}}
HTTP 200
[Asserts]
jsonpath "$.data" isCollection

# --- Avatar de usuario sin avatar (404 para nuevo usuario) ---
# Login como client que no ha subido avatar
POST {{base_url}}/api/v1/auth/login
Content-Type: application/json
{
  "email": "contacto@restauranteelbuensabor.com",
  "password": "Demo123!"
}
HTTP 200
[Captures]
client_token: jsonpath "$.data.access_token"

GET {{base_url}}/api/v1/media/avatars/current
Authorization: Bearer {{client_token}}
HTTP 404
[Asserts]
jsonpath "$.code" == "NOT_FOUND"
