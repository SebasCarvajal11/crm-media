/**
 * Script de migración: asigna a usuarios existentes sin avatar un avatar y color diferente.
 * Uso: pnpm --filter crm-media migrate:avatars
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db/connection";
import { mediaAssets } from "../db/schema";
import { avatarPresetService } from "../modules/media/avatar-preset.service";
import { getLogger } from "../shared/logger";

const logger = getLogger();

const CIMA_CORPORATE_PALETTE = [
  "#86070c", // Rojo Corporativo CIMA
  "#a8131a", // Rubí CIMA
  "#680609", // Borgoña Oscuro
  "#bd2f35", // Coral Intenso CIMA
  "#1e3a8a", // Azul Marino Ejecutivo
  "#1d4ed8", // Azul Cobalto
  "#065f46", // Verde Bosque
  "#047857", // Esmeralda CIMA
  "#d97706", // Ámbar Cálido
  "#5b21b6", // Violeta Real
  "#475569", // Pizarra Neutro
  "#282829", // Grafito CIMA
] as const;

interface UserRecord extends Record<string, unknown> {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

export async function migrateUserAvatars(): Promise<{ totalMigrated: number; failed: number }> {
  console.log("Iniciando migración de avatares predeterminados para usuarios existentes...");

  // 1. Obtener usuarios de schema_auth que no tienen avatar en schema_media
  const queryResult = await db.execute<UserRecord>(sql`
    SELECT u.id, u.email, u.first_name, u.last_name
    FROM schema_auth.users u
    WHERE NOT EXISTS (
      SELECT 1 FROM schema_media.media_assets m
      WHERE m.user_id = u.id AND m.kind = 'avatar'
    )
    ORDER BY u.created_at ASC
  `);

  const pendingUsers = (queryResult.rows ?? []) as UserRecord[];
  console.log(`Usuarios encontrados sin avatar: ${pendingUsers.length}`);

  if (pendingUsers.length === 0) {
    console.log("Todos los usuarios ya cuentan con un avatar asignado.");
    return { totalMigrated: 0, failed: 0 };
  }

  let totalMigrated = 0;
  let failed = 0;

  // Asignar combinaciones únicas (avatarId, color)
  for (let i = 0; i < pendingUsers.length; i++) {
    const user = pendingUsers[i];
    const avatarId = i % 84;
    const colorIndex = (Math.floor(i / 84) + i) % CIMA_CORPORATE_PALETTE.length;
    const color = CIMA_CORPORATE_PALETTE[colorIndex];

    try {
      console.log(`Asignando a ${user.email} -> Avatar #${avatarId}, Color: ${color}`);
      await avatarPresetService.saveAvatarPreset(user.id, {
        avatarId,
        color,
        actor: {
          userId: user.id,
          sub: user.id,
          role: "admin",
          email: "migration-system@cima.dev",
        },
        userAgent: "crm-migration-script/1.0",
      });
      totalMigrated++;
    } catch (err) {
      console.error(`Error al migrar avatar para ${user.email}:`, err);
      logger.error({ topic: "avatar-migration", userId: user.id, err }, "Fallo migración avatar");
      failed++;
    }
  }

  console.log(`Migración finalizada: ${totalMigrated} completados, ${failed} fallidos.`);
  return { totalMigrated, failed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrateUserAvatars()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Fallo crítico en migración:", err);
      process.exit(1);
    });
}
