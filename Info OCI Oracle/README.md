# Configuracion OCI segura para `mod-media`

Esta carpeta ya no debe contener secretos reales.

No se deben versionar aqui:

- `oci.config` reales
- llaves privadas `.pem`
- fingerprints sensibles
- OCIDs reales de usuario o tenancy

## Como configurar OCI en local

1. Crea un archivo `oci.config` en una ruta local fuera del repositorio.
2. Usa como base `oci.config.example` de esta carpeta.
3. Genera o usa tu llave privada local y referencia su ruta absoluta en `key_file`.
4. Configura en `mod-media/.env`:

```env
OCI_CONFIG_FILE_PATH=C:/ruta/privada/oci.config
OCI_CONFIG_PROFILE=DEFAULT
OCI_REGION=us-sanjose-1
OCI_NAMESPACE=<tu-namespace>
OCI_BUCKET_AVATARS_PUBLIC=crm-avatars-public
OCI_BUCKET_DOCS_PRIVATE=crm-docs-private
```

5. Verifica la integracion:

```powershell
cd mod-media
pnpm oci:verify
```

## Nota para `mod-collab`

`mod-collab` comparte la configuracion OCI para el acceso a documentos privados. Debe apuntar a su propio archivo local seguro mediante `OCI_CONFIG_FILE_PATH`; no debe depender de archivos versionados dentro del repo.
