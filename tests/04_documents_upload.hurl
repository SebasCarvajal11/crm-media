# ============================================================
# 04 — Subida de Documentos
# ============================================================
# Prueba los endpoints de documentos:
# - Worker solicita URL pre-firmada
# - Admin solicita URL pre-firmada
# - Client solicita URL pre-firmada
# - Validacion de tipo de archivo
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

# --- Worker: Solicita URL pre-firmada ---
POST {{base_url}}/api/v1/media/documents/upload-url
Authorization: Bearer {{worker_token}}
Content-Type: application/json
{
  "fileName": "documento_worker.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 100000
}
HTTP 200
[Captures]
worker_upload_url: jsonpath "$.data.uploadUrl"
worker_object_key: jsonpath "$.data.objectKey"
[Asserts]
jsonpath "$.data.uploadUrl" exists
jsonpath "$.data.objectKey" exists

# --- Admin: Solicita URL pre-firmada ---
POST {{base_url}}/api/v1/media/documents/upload-url
Authorization: Bearer {{admin_token}}
Content-Type: application/json
{
  "fileName": "documento_admin.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 200000
}
HTTP 200
[Captures]
admin_upload_url: jsonpath "$.data.uploadUrl"
admin_object_key: jsonpath "$.data.objectKey"

# --- Client: Solicita URL pre-firmada ---
POST {{base_url}}/api/v1/media/documents/upload-url
Authorization: Bearer {{client_token}}
Content-Type: application/json
{
  "fileName": "documento_client.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 50000
}
HTTP 200
[Captures]
client_upload_url: jsonpath "$.data.uploadUrl"
client_object_key: jsonpath "$.data.objectKey"

# --- Validacion de tamano excesivo ---
POST {{base_url}}/api/v1/media/documents/upload-url
Authorization: Bearer {{worker_token}}
Content-Type: application/json
{
  "fileName": "documento_grande.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 999999999
}
HTTP 400
[Asserts]
jsonpath "$.error" exists

# --- Validacion de tipo MIME invalido ---
POST {{base_url}}/api/v1/media/documents/upload-url
Authorization: Bearer {{worker_token}}
Content-Type: application/json
{
  "fileName": "virus.exe",
  "mimeType": "application/x-msdownload",
  "sizeBytes": 1000
}
HTTP 400
[Asserts]
jsonpath "$.error" exists
