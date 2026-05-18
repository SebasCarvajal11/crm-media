/** Longitud máxima de `original_name` en DB (columna text; límite operativo). */
export const MAX_STORED_ORIGINAL_NAME = 255;

/** Nombre legible para UI/DB: sin controles, normalizado y truncado. */
export const sanitizeStoredFileName = (input: string) => {
  const withoutControls = input.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  const normalized = withoutControls.normalize("NFKC");
  const sliced = [...normalized].slice(0, MAX_STORED_ORIGINAL_NAME).join("");
  const collapsed = sliced.replace(/\s+/g, " ").trim();
  return collapsed || `file_${Date.now()}`;
};

/** Segmento seguro para rutas de objeto en OCI. */
export const sanitizeFileNameForObjectKey = (input: string) => {
  const base = sanitizeStoredFileName(input);
  const clean = base
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return clean || `file_${Date.now()}`;
};
