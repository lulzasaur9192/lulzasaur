import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { agentMemory } from "../../db/schema.js";
import { registerTool } from "../tool-registry.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("tool-write-memory");

interface WriteMemoryInput {
  key: string;
  value: unknown;
  namespace?: string;
}

registerTool({
  name: "write_memory",
  description: "Write a value to persistent agent memory. Memory survives context compaction.",
  capability: "write_memory",
  inputSchema: {
    type: "object",
    properties: {
      key: { type: "string", description: "The memory key to write" },
      value: { description: "The value to store (any JSON-serializable value)" },
      namespace: { type: "string", description: "Namespace (default: 'default')" },
    },
    required: ["key", "value"],
  },
  execute: async (agentId: string, input: unknown) => {
    const db = getDb();
    const { key, value, namespace } = input as WriteMemoryInput;
    const ns = namespace ?? "default";

    // Upsert
    const existing = await db
      .select()
      .from(agentMemory)
      .where(
        and(
          eq(agentMemory.agentId, agentId),
          eq(agentMemory.namespace, ns),
          eq(agentMemory.key, key),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(agentMemory)
        .set({ value, updatedAt: new Date() })
        .where(eq(agentMemory.id, existing[0]!.id));
    } else {
      await db.insert(agentMemory).values({
        agentId,
        namespace: ns,
        key,
        value,
      });
    }

    log.debug({ agentId, key, namespace: ns }, "Memory written");
    return { success: true, key, namespace: ns };
  },
});
