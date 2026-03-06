import { and, ne, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { tasks } from "../db/schema.js";

/**
 * Resolve a task ID prefix to a full UUID.
 * Agents frequently see truncated task IDs (first 8 chars) in context
 * and pass those instead of full UUIDs.
 */
export async function resolveTaskId(idOrPrefix: string): Promise<string> {
  // If it looks like a full UUID already, return as-is
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(idOrPrefix)) return idOrPrefix;

  const db = getDb();

  // Try prefix match against non-terminal tasks first, then all tasks
  const rows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(sql`${tasks.id}::text LIKE ${idOrPrefix + "%"}`)
    .limit(2);

  if (rows.length === 1) return rows[0]!.id;
  if (rows.length > 1) {
    throw new Error(`Ambiguous task ID prefix "${idOrPrefix}" — matches ${rows.length} tasks. Provide more characters.`);
  }

  throw new Error(`Task not found with ID or prefix: "${idOrPrefix}"`);
}
