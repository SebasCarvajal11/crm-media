# ============================================================
# 02 — Asignacion de Avatares Oficiales (Presets) y Deprecacion
# ============================================================
# Prueba los endpoints de avatares:
# - Admin asigna avatar oficial con color corporativo
# - Worker asigna avatar oficial con color corporativo
# - Client asigna avatar oficial con color corporativo
# - Guest NO puede asignar avatar (401)
# - Validacion: avatarId fuera de rango (0..83) -> 400
# - Validacion: color hexadecimal invalido -> 400
# - Deprecacion: POST /api/v1/media/avatars retorna 410 Gone
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

# --- Guest: NO puede asignar avatar (401) ---
POST {{base_url}}/api/v1/media/avatars/preset
Content-Type: application/json
{
  "avatarId": 0,
  "color": "#86070c"
}
HTTP 401

# --- Admin: Asigna avatar preset ---
POST {{base_url}}/api/v1/media/avatars/preset
Authorization: Bearer {{admin_token}}
Content-Type: application/json
{
  "avatarId": 0,
  "color": "#86070c"
}
HTTP 201
[Asserts]
jsonpath "$.data.version" exists
jsonpath "$.data.urls.64" exists
jsonpath "$.data.urls.256" exists
jsonpath "$.data.urls.512" exists

# --- Worker: Asigna avatar preset ---
POST {{base_url}}/api/v1/media/avatars/preset
Authorization: Bearer {{worker_token}}
Content-Type: application/json
{
  "avatarId": 17,
  "color": "#047857"
}
HTTP 201
[Asserts]
jsonpath "$.data.version" exists
jsonpath "$.data.urls.64" exists
jsonpath "$.data.urls.256" exists
jsonpath "$.data.urls.512" exists

# --- Client: Asigna avatar preset ---
POST {{base_url}}/api/v1/media/avatars/preset
Authorization: Bearer {{client_token}}
Content-Type: application/json
{
  "avatarId": 34,
  "color": "#1e3a8a"
}
HTTP 201
[Asserts]
jsonpath "$.data.version" exists
jsonpath "$.data.urls.64" exists
jsonpath "$.data.urls.256" exists
jsonpath "$.data.urls.512" exists

# --- Validacion: avatarId invalido (fuera de rango) ---
POST {{base_url}}/api/v1/media/avatars/preset
Authorization: Bearer {{admin_token}}
Content-Type: application/json
{
  "avatarId": 99,
  "color": "#86070c"
}
HTTP 400

# --- Validacion: color hexadecimal invalido ---
POST {{base_url}}/api/v1/media/avatars/preset
Authorization: Bearer {{admin_token}}
Content-Type: application/json
{
  "avatarId": 5,
  "color": "invalido"
}
HTTP 400

# --- Deprecacion: subida manual retorna 410 Gone ---
POST {{base_url}}/api/v1/media/avatars
Authorization: Bearer {{admin_token}}
HTTP 410
