import Redis from "ioredis";
import { env } from "../config/env";

let sharedConnection: Redis | undefined;
let subscriberConnection: Redis | undefined;

export function getRedisConnection(): Redis | undefined {
  if (!env.REDIS_URL) return undefined;
  if (!sharedConnection) {
    sharedConnection = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
    });
  }
  return sharedConnection;
}

export function getRedisSubscriber(): Redis | undefined {
  if (!env.REDIS_URL) return undefined;
  if (!subscriberConnection) {
    subscriberConnection = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
    });
  }
  return subscriberConnection;
}

export async function closeRedisConnections(): Promise<void> {
  await Promise.all([
    sharedConnection?.quit().catch(() => undefined),
    subscriberConnection?.quit().catch(() => undefined),
  ]);
  sharedConnection = undefined;
  subscriberConnection = undefined;
}
