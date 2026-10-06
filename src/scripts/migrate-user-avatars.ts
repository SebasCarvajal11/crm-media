/**
 * Script de migración: asigna a usuarios existentes sin avatar un avatar y color diferente.
 * Uso: pnpm --filter crm-media migrate:avatars [--dry-run]
 */
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { db } from "../db/connection";
import { mediaAssets } from "../db/schema";
import { avatarPresetService } from "../modules/media/avatar-preset.service";
import { getLogger } from "../shared/logger";

const logger = getLogger();

import {
  CIMA_CORPORATE_PALETTE,
  OFFICIAL_AVATARS_COUNT,
} from "@sebascarvajal11/cima-contracts";

export { CIMA_CORPORATE_PALETTE, OFFICIAL_AVATARS_COUNT };

export interface UserRecord extends Record<string, unknown> {
  id: string;
  subject?: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

export interface MigrateAvatarsOptions {
  dryRun?: boolean;
  users?: UserRecord[];
}

export interface MigrationPlanItem {
  userId: string;
  email: string;
  avatarId: number;
  color: string;
}

export function getDeterministicAvatarAssignment(index: number): { avatarId: number; color: string } {
  // Stride 17 es coprimo a 84, garantizando que los primeros 84 usuarios obtengan avatares distintos
  const avatarId = (index * 17) % OFFICIAL_AVATARS_COUNT;
  // Stride 7 es coprimo a 12, garantizando variedad de color entre usuarios consecutivos
  const colorIndex = (index * 7 + Math.floor(index / OFFICIAL_AVATARS_COUNT)) % CIMA_CORPORATE_PALETTE.length;
  return {
    avatarId,
    color: CIMA_CORPORATE_PALETTE[colorIndex],
  };
}

export function generateMigrationPlan(users: UserRecord[]): MigrationPlanItem[] {
  return users.map((user, index) => {
    const { avatarId, color } = getDeterministicAvatarAssignment(index);
    return {
      userId: (user.subject || user.id) as string,
      email: user.email,
      avatarId,
      color,
    };
  });
}

export async function purgeResidualMediaAvatars(): Promise<number> {
  try {
    const result = await db.execute(sql`
      DELETE FROM schema_media.media_assets
      WHERE kind = 'avatar'
    `);
    const count = Number(result.rowCount ?? 0);
    if (count > 0) {
      console.log(`[LIMPIEZA] Purgados ${count} registros residuales de avatar en media_assets.`);
    }
    return count;
  } catch (err) {
    logger.warn({ topic: "avatar-migration", err }, "Aviso: no se pudo purgar media_assets residual");
    return 0;
  }
}

async function fetchPendingUsers(): Promise<UserRecord[]> {
  const superuserUrl = process.env.DB_SUPERUSER_URL;
  let targetDb = db;
  let superuserPool: import("pg").Pool | null = null;

  if (superuserUrl) {
    const { default: pg } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    superuserPool = new pg.Pool({ connectionString: superuserUrl });
    targetDb = drizzle(superuserPool) as typeof db;
  }

  try {
    const queryResult = await targetDb.execute<UserRecord>(sql`
      SELECT u.id, u.subject, u.email, u.first_name, u.last_name
      FROM schema_auth.users u
      WHERE NOT EXISTS (
        SELECT 1 FROM schema_media.user_avatars a
        WHERE a.user_id = u.subject::text
      )
      ORDER BY u.created_at ASC
    `);
    return (queryResult.rows ?? []) as UserRecord[];
  } finally {
    if (superuserPool) {
      await superuserPool.end().catch(() => undefined);
    }
  }
}

async function applyMigrationItem(item: MigrationPlanItem): Promise<boolean> {
  try {
    await avatarPresetService.saveAvatarPreset(item.userId, {
      avatarId: item.avatarId,
      color: item.color,
      actor: {
        userId: item.userId,
        sub: item.userId,
        role: "admin",
        email: "migration-system@cima.dev",
      },
      userAgent: "crm-migration-script/1.0",
    });
    return true;
  } catch (err) {
    logger.error({ topic: "avatar-migration", userId: item.userId, err }, "Fallo migración avatar");
    return false;
  }
}

export const SAMPLE_USERS: UserRecord[] = [
  { id: "sample-1", email: "admin@cima.dev", first_name: "Admin", last_name: "CIMA" },
  { id: "sample-2", email: "carolina.mendez@cima.dev", first_name: "Carolina", last_name: "Méndez" },
  { id: "sample-3", email: "alejandro.torres@cima.dev", first_name: "Alejandro", last_name: "Torres" },
  { id: "sample-4", email: "valeria.rojas@cima.dev", first_name: "Valeria", last_name: "Rojas" },
  { id: "sample-5", email: "diego.morales@cima.dev", first_name: "Diego", last_name: "Morales" },
  { id: "sample-6", email: "camila.castro@cima.dev", first_name: "Camila", last_name: "Castro" },
  { id: "sample-7", email: "javier.herrera@cima.dev", first_name: "Javier", last_name: "Herrera" },
  { id: "sample-8", email: "daniela.navarro@cima.dev", first_name: "Daniela", last_name: "Navarro" },
  { id: "sample-9", email: "felipe.gutierrez@cima.dev", first_name: "Felipe", last_name: "Gutiérrez" },
  { id: "sample-10", email: "mariana.silva@cima.dev", first_name: "Mariana", last_name: "Silva" },
  { id: "sample-11", email: "andres.vargas@cima.dev", first_name: "Andrés", last_name: "Vargas" },
  { id: "sample-12", email: "lucia.paredes@cima.dev", first_name: "Lucía", last_name: "Paredes" },
];

export async function migrateUserAvatars(
  options: MigrateAvatarsOptions = {}
): Promise<{ totalMigrated: number; failed: number; plan: MigrationPlanItem[] }> {
  console.log("Iniciando migración de avatares predeterminados...");
  let users = options.users;
  if (!users) {
    try {
      users = await fetchPendingUsers();
    } catch (dbErr) {
      if (options.dryRun) {
        console.warn("Base de datos no accesible en entorno local; utilizando usuarios de muestra para dry-run.");
        users = SAMPLE_USERS;
      } else {
        throw dbErr;
      }
    }
  }
  console.log(`Usuarios encontrados sin avatar: ${users.length}`);

  const plan = generateMigrationPlan(users);

  if (options.dryRun) {
    console.log(`[DRY-RUN] Modo simulación activo. ${plan.length} asignaciones planificadas:`);
    for (const item of plan) {
      console.log(`  [DRY-RUN] ${item.email} -> Avatar #${item.avatarId}, Color: ${item.color}`);
    }
    return { totalMigrated: plan.length, failed: 0, plan };
  }

  let totalMigrated = 0;
  let failed = 0;

  for (const item of plan) {
    console.log(`Asignando a ${item.email} -> Avatar #${item.avatarId}, Color: ${item.color}`);
    const success = await applyMigrationItem(item);
    if (success) {
      totalMigrated++;
    } else {
      failed++;
    }
  }

  await purgeResidualMediaAvatars();

  console.log(`Migración finalizada: ${totalMigrated} completados, ${failed} fallidos.`);
  return { totalMigrated, failed, plan };
}

const isMain = Boolean(
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase()
);

if (isMain) {
  const isDryRun = process.argv.includes("--dry-run");
  migrateUserAvatars({ dryRun: isDryRun })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Fallo crítico en migración:", err);
      process.exit(1);
    });
}
