#!/bin/sh
set -eu

if [ -n "${OCI_CONFIG_SOURCE_FILE:-}" ] && [ -n "${OCI_CONFIG_FILE_PATH:-}" ]; then
  if [ ! -f "$OCI_CONFIG_SOURCE_FILE" ]; then
    echo "OCI_CONFIG_SOURCE_FILE no existe: $OCI_CONFIG_SOURCE_FILE" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$OCI_CONFIG_FILE_PATH")"
  key_file="$(sed -n 's/^key_file=//p' "$OCI_CONFIG_SOURCE_FILE" | head -n 1)"
  key_name="$(basename "$key_file")"
  if [ -z "$key_name" ] || [ ! -f "/opt/cima/secrets/oci/$key_name" ]; then
    echo "OCI key_file no existe en /opt/cima/secrets/oci: $key_name" >&2
    exit 1
  fi

  sed "s#^key_file=.*#key_file=/opt/cima/secrets/oci/$key_name#" "$OCI_CONFIG_SOURCE_FILE" > "$OCI_CONFIG_FILE_PATH"
fi

# Detect if the container is running as a worker
is_worker=false
if [ "${CONTAINER_MODE:-}" = "worker" ]; then
  is_worker=true
fi

for arg in "$@"; do
  case "$arg" in
    *worker*|*cleanup*)
      is_worker=true
      ;;
  esac
done

if [ "$is_worker" = "false" ] && [ -n "${DATABASE_URL:-}" ]; then
  echo "Ejecutando aprovisionamiento de base de datos..."
  pnpm db:push
fi

exec "$@"
