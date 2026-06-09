import "dotenv/config";
import { documentService } from "../modules/media/document.service";

async function main() {
  const userSub = process.argv[2];
  if (!userSub) {
    console.error("Uso: pnpm tsx src/scripts/pii-clean.ts <userSub>");
    process.exit(1);
  }

  try {
    await documentService.anonymizeUserPII(userSub);
    console.log(`[pii-clean] Informacion PII para el usuario ${userSub} anonimizada/eliminada correctamente en crm-media.`);
    process.exit(0);
  } catch (err) {
    console.error("[pii-clean] Error al anonimizar PII:", err);
    process.exit(1);
  }
}

main();
