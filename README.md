# CRM Media Service

> Servicio de almacenamiento en la nube, protección antivirus y despacho centralizado de correos para CIMA CRM.

[![Status](https://img.shields.io/badge/status-active-success.svg)]()
[![Platform](https://img.shields.io/badge/platform-CIMA%20CRM-blue.svg)]()
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-green.svg)]()
[![License](https://img.shields.io/badge/license-MIT-blue.svg)]()

---

## Propósito

`crm-media` gestiona el almacenamiento seguro de avatares y documentos privados en Oracle Cloud Infrastructure (OCI Object Storage), la validación antivirus en tiempo real con ClamAV, la generación de URLs prefirmadas (PAR) y el motor unificado de despacho de correos electrónicos transaccionales y de marketing mediante BullMQ y Brevo SMTP.

---

## Documentación Detallada (`docs/`)

Para consultar las especificaciones técnicas completas y guías de arquitectura, visita la suite documental:

- [**Guía de Arquitectura (`docs/ARCHITECTURE.md`)**](./docs/ARCHITECTURE.md): Diseño modular (`media` y `email`), OCI, ClamAV y workers en background.
- [**Modelo de Dominio (`docs/DOMAIN.md`)**](./docs/DOMAIN.md): Avatares (Sharp), documentos PAR y despacho de correos (plantillas vs contenido libre).
- [**Contratos de API (`docs/API.md`)**](./docs/API.md): Endpoints públicos en KrakenD y endpoint interno protegido `POST /api/v1/emails/send`.
- [**Base de Datos y Persistencia (`docs/DATABASE.md`)**](./docs/DATABASE.md): Esquema PostgreSQL `schema_media`, tabla `media_assets` y particiones de `audit_logs`.
- [**Seguridad y Protección (`docs/SECURITY.md`)**](./docs/SECURITY.md): Antivirus ClamAV, magic numbers, Service JWT (RS256) con `bodyHash` y cifrado AES-256-GCM.
- [**Integraciones y Plataforma (`docs/INTEGRATIONS.md`)**](./docs/INTEGRATIONS.md): Redis Streams (`media-commands`, `asset-responses`), colas BullMQ, Brevo SMTP y OCI.
- [**Estrategia de Pruebas (`docs/TESTING.md`)**](./docs/TESTING.md): Pruebas unitarias Vitest, pruebas de contrato OpenAPI y suites Hurl E2E.
- [**Decisiones Arquitectónicas (`docs/DECISIONS/`)**](./docs/DECISIONS/README.md): Registros formales de decisiones (ADRs).

---

## Inicio Rápido Local

### 1. Configuración de Entorno
```bash
cp .env.example .env
# Configurar variables locales o ejecutar pnpm setup:env desde crm-infra
```

### 2. Instalación y Puesta en Marcha
```bash
pnpm install
pnpm db:push                  # sincronizar esquema schema_media
pnpm dev                      # servidor con hot-reload en http://localhost:3002
```

### 3. Workers de Background (Procesos Independientes)
```bash
pnpm worker:media-commands    # procesa comandos de crm-collab vía Redis Streams
pnpm worker:quarantine-scan   # escaneo antivirus periódico en OCI
pnpm worker:email             # procesador de cola BullMQ y despacho vía Brevo SMTP
```

---

## Pruebas y Validación de Calidad

```bash
pnpm test:unit                # pruebas unitarias aisladas (Vitest)
pnpm test:contract            # pruebas de contrato Hurl contra el API Gateway
pnpm openapi:check            # validación de sintaxis en openapi.yaml
pnpm gateway:validate         # verificación de paridad entre OpenAPI y Gateway Manifest
pnpm oci:verify               # prueba de conectividad y buckets en OCI
pnpm build                    # verificación estricta de tipos TypeScript
```

---

## Despliegue en Producción

El despliegue está automatizado mediante GitHub Actions y orquestado por el script canónico de slots Blue/Green:

```bash
# Desde crm-infra/
./deploy/remote/deploy-component.sh media
```
