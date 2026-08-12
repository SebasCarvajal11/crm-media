# ============================================================
# 05 — Acceso a Documentos
# ============================================================
# Prueba los endpoints de acceso a documentos:
# - Worker obtiene URL de acceso
# - Client obtiene URL de descarga
# - Documento inexistente (404)
# - Parametros invalidos (400)
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

# Primero crear un documento para tener objectKey
POST {{base_url}}/api/v1/media/documents/upload-url
Authorization: Bearer {{worker_token}}
Content-Type: application/json
{
  "fileName": "test_acceso.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 50000
}
HTTP 200
[Captures]
access_object_key: jsonpath "$.data.objectKey"

# --- Worker: Obtiene URL de acceso ---
GET {{base_url}}/api/v1/media/documents/access?objectKey={{access_object_key}}
Authorization: Bearer {{worker_token}}
HTTP 200
[Asserts]
jsonpath "$.data.url" exists

# --- Admin no puede acceder a un documento ajeno ---
GET {{base_url}}/api/v1/media/documents/access?objectKey={{access_object_key}}
Authorization: Bearer {{admin_token}}
HTTP 403

# --- Client no puede acceder a un documento ajeno ---
GET {{base_url}}/api/v1/media/documents/access?objectKey={{access_object_key}}&download=true
Authorization: Bearer {{client_token}}
HTTP 403

# --- Un documento ajeno no es accesible aunque no exista ---
GET {{base_url}}/api/v1/media/documents/access?objectKey=inexistente/999999.pdf
Authorization: Bearer {{admin_token}}
HTTP 403

# --- Parametros invalidos: falta objectKey ---
GET {{base_url}}/api/v1/media/documents/access
Authorization: Bearer {{admin_token}}
HTTP 400
[Asserts]
jsonpath "$.message" exists
