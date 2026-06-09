import { env } from "../config/env";
import {
  listMediaCommandDlqEntries,
  replayMediaCommandDlqEntry,
} from "../workers/media-command-dlq";
import { closeRedisConnections, getRedisConnection } from "../shared/redis";

type Command = "list" | "replay";

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1];
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function printUsage(): void {
  console.error(`
Uso:
  pnpm dlq:media:list [--limit 25]
  pnpm dlq:media:replay --id <dlq-entry-id> [--keep]

Variables:
  REDIS_URL
  MEDIA_COMMANDS_DLQ_STREAM_KEY=${env.MEDIA_COMMANDS_DLQ_STREAM_KEY}
  MEDIA_COMMANDS_STREAM_KEY=${env.MEDIA_COMMANDS_STREAM_KEY}
`);
}

async function main(): Promise<void> {
  const command = process.argv[2] as Command | undefined;
  const redis = getRedisConnection();

  if (!redis) {
    throw new Error("REDIS_URL es requerida para operar la DLQ");
  }

  if (command === "list") {
    const limit = Number(getArg("limit") ?? 25);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("--limit debe ser un entero entre 1 y 500");
    }

    const entries = await listMediaCommandDlqEntries(redis, limit);
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  if (command === "replay") {
    const id = getArg("id");
    if (!id) {
      throw new Error("--id es requerido para reinyectar una entrada DLQ");
    }

    const result = await replayMediaCommandDlqEntry(redis, id, {
      removeAfterReplay: !hasFlag("keep"),
    });

    console.log(JSON.stringify({ id, ...result }, null, 2));
    return;
  }

  printUsage();
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("[media-commands-dlq] Error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedisConnections();
  });
