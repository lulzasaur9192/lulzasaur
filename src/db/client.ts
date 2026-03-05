import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getConfig } from "../config/index.js";
import * as schema from "./schema.js";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sql: ReturnType<typeof postgres> | null = null;

export function getDb() {
  if (_db) return _db;
  const config = getConfig();
  _sql = postgres(config.DATABASE_URL, { max: 20 });
  _db = drizzle(_sql, { schema });
  return _db;
}

export function getRawSql() {
  if (!_sql) getDb();
  return _sql!;
}

export async function closeDb() {
  if (_sql) {
    await _sql.end();
    _sql = null;
    _db = null;
  }
}

export type Db = ReturnType<typeof getDb>;
