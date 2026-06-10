# ============================================================
# 06 — Eliminacion de Documentos
# ============================================================
# Prueba los endpoints de eliminacion de documentos:
# - Admin elimina documento
# - Worker elimina documento
# - Client NO puede eliminar (403)
# - Documento inexistente (404)
# - Guest NO puede eliminar (401)
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

# Crear documento para admin
POST {{base_url}}/api/v1/media/documents/upload-url
Authorization: Bearer {{admin_token}}
Content-Type: application/json
{
  "fileName": "admin_delete.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 10000
}
HTTP 200
[Captures]
admin_del_key: jsonpath "$.data.objectKey"

# Crear documento para worker
POST {{base_url}}/api/v1/media/documents/upload-url
Authorization: Bearer {{worker_token}}
Content-Type: application/json
{
  "fileName": "worker_delete.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 10000
}
HTTP 200
[Captures]
worker_del_key: jsonpath "$.data.objectKey"

# --- Guest: NO puede eliminar (401) ---
DELETE {{base_url}}/api/v1/media/documents?objectKey={{admin_del_key}}
HTTP 401

# --- Client: NO puede eliminar (403) ---
DELETE {{base_url}}/api/v1/media/documents?objectKey={{admin_del_key}}
Authorization: Bearer {{client_token}}
HTTP 403

# --- Worker: Elimina documento ---
DELETE {{base_url}}/api/v1/media/documents?objectKey={{worker_del_key}}
Authorization: Bearer {{worker_token}}
HTTP 200

# --- Admin: Elimina documento ---
DELETE {{base_url}}/api/v1/media/documents?objectKey={{admin_del_key}}
Authorization: Bearer {{admin_token}}
HTTP 200

# --- Documento inexistente (404) ---
DELETE {{base_url}}/api/v1/media/documents?objectKey=inexistente/999999.pdf
Authorization: Bearer {{admin_token}}
HTTP 404
[Asserts]
jsonpath "$.error" exists
