import { ne } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { agents } from "../db/schema.js";

/**
 * Resolve an agent name, ID prefix, or "me" to a full UUID.
 * Agents frequently pass names instead of UUIDs — this handles all cases.
 */
export async function resolveAgentId(nameOrId: string, callerAgentId?: string): Promise<string> {
  // Handle "me" / "self"
  if ((nameOrId === "me" || nameOrId === "self") && callerAgentId) {
    return callerAgentId;
  }

  // If it looks like a full UUID already, return as-is
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(nameOrId)) return nameOrId;

  const db = getDb();
  const allAgents = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(ne(agents.status, "terminated"));

  // Try exact name match first
  const byName = allAgents.find((a) => a.name === nameOrId);
  if (byName) return byName.id;

  // Try ID prefix match
  const byPrefix = allAgents.find((a) => a.id.startsWith(nameOrId));
  if (byPrefix) return byPrefix.id;

  // Try case-insensitive name match
  const lower = nameOrId.toLowerCase();
  const byLower = allAgents.find((a) => a.name.toLowerCase() === lower);
  if (byLower) return byLower.id;

  throw new Error(`Agent not found: "${nameOrId}". Available: ${allAgents.map((a) => a.name).join(", ")}`);
}
