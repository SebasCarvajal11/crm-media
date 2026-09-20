# Estrategia de Pruebas: `crm-media`

Este documento describe la pirámide de pruebas, el aislamiento de componentes y los comandos de verificación para `crm-media`.

---

## 1. Niveles de Pruebas y Aislamiento

```text
       ▲
      / \     Nivel 3: Pruebas E2E / Hurl vía KrakenD (`test:contract`)
     /   \
    /─────\   Nivel 2: Integración de Correo y Validación de Contratos OpenAPI
   /       \
  /─────────\ Nivel 1: Pruebas Unitarias Aisladas (Vitest: Plantillas, Criptografía, Zod)
```

### Nivel 1: Pruebas Unitarias (`pnpm test:unit`)
- **Herramienta**: Vitest.
- **Alcance**:
  - Sanitización de nombres de archivo y prevención de Path Traversal (`sanitize-filename.spec.ts`).
  - Renderizado y validación de variables en plantillas de correo (`email.templates.spec.ts`).
  - Validación de Service JWT y comprobación del `bodyHash` SHA-256 (`email.authorization.spec.ts`).
  - Cálculo de cuotas y estadísticas de disco local (`storage.service.spec.ts`).
  - Lógica de encolado e idempotencia del servicio de correo (`email.service.spec.ts`).
- **Aislamiento**: Se ejecutan en milisegundos en memoria sin requerir conexión a OCI, ClamAV ni PostgreSQL.

### Nivel 2: Pruebas de Integración y Contrato OpenAPI
- **Pruebas de Integración de Correo**: Verifica el flujo completo desde el cifrado AES-256-GCM hasta el despacho simulado por Nodemailer.
- **Validación de Sintaxis OpenAPI (`pnpm openapi:check`)**: Asegura que el archivo `openapi/openapi.yaml` cumpla estrictamente el estándar OpenAPI 3.0.3.
- **Paridad con Gateway Manifest (`pnpm gateway:validate`)**: Comprueba que los 11 endpoints expuestos al usuario final coincidan unívocamente con la configuración de KrakenD.

### Nivel 3: Pruebas de Contrato E2E vía Gateway (`pnpm test:contract`)
- **Herramienta**: Hurl.
- **Alcance**: Ejecuta escenarios reales simulando clientes web hacia KrakenD (puerto 28080):
  - Solicitud de avatar con token de usuario válido.
  - Generación de URLs prefirmadas de subida y lectura.
  - Validación de rechazo para usuarios sin permisos adecuados.

---

## 2. Catálogo de Comandos de Validación

| Comando | Propósito | Requisitos de Entorno |
| :--- | :--- | :--- |
| `pnpm test:unit` | Ejecuta la suite de pruebas unitarias Vitest. | Ninguno (autocontenido) |
| `pnpm openapi:check` | Comprueba validez de sintaxis en `openapi.yaml`. | Ninguno |
| `pnpm gateway:validate` | Verifica paridad entre OpenAPI y Gateway Manifest. | Ninguno |
| `pnpm test:contract` | Ejecuta pruebas Hurl a través de KrakenD. | Stack Docker activo |
| `pnpm oci:verify` | Comprueba credenciales y conectividad con OCI. | Variables OCI configuradas |
| `pnpm pii:clean` | Ejecuta script de anonimización de datos de auditoría. | Postgres activo |
| `pnpm build` | Comprueba tipos TypeScript y genera build de producción. | Ninguno |
