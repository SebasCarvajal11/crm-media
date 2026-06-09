# ============================================================
# crm-media - Smoke/Contract Tests via KrakenD
# ============================================================

# 1. Login as Worker
POST {{base_url}}/api/v1/auth/login
Content-Type: application/json
{
  "email": "{{WORKER_EMAIL}}",
  "password": "{{WORKER_PASSWORD}}"
}
HTTP 200
[Captures]
worker_token: jsonpath "$.data.access_token"

# 2. Get Media OpenAPI Specification
GET {{base_url}}/docs/media/openapi.yaml
HTTP 200

# 3. Get Current Avatar (Should return 404 since the worker has no avatar yet)
GET {{base_url}}/api/v1/media/avatars/current
Authorization: Bearer {{worker_token}}
HTTP 404
[Asserts]
jsonpath "$.code" == "NOT_FOUND"
jsonpath "$.message" == "El usuario no tiene avatar"

# 4. Generate Document Upload URL
POST {{base_url}}/api/v1/media/documents/upload-url
Authorization: Bearer {{worker_token}}
Content-Type: application/json
{
  "fileName": "contrato_prueba.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 50000
}
HTTP 200
[Asserts]
jsonpath "$.data.uploadUrl" exists
jsonpath "$.data.objectKey" exists
