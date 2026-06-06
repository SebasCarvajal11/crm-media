import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { pgConnectionConfig } from "./pg-config";

export const pool = new Pool(pgConnectionConfig);
export const db = drizzle(pool);
