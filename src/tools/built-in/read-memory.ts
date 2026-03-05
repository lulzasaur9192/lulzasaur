import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { agentMemory } from "../../db/schema.js";
import { registerTool } from "../tool-registry.js";

interface ReadMemoryInput {
  key: string;
  namespace?: string;
}

registerTool({
  name: "read_memory",
  description: "Read a value from persistent agent memory. Memory survives context compaction.",
  capability: "read_memory",
  inputSchema: {
    type: "object",
    properties: {
      key: { type: "string", description: "The memory key to read" },
      namespace: { type: "string", description: "Namespace (default: 'default')" },
    },
    required: ["key"],
  },
  execute: async (agentId: string, input: unknown) => {
    const db = getDb();
    const { key, namespace } = input as ReadMemoryInput;
    const ns = namespace ?? "default";

    const results = await db
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

    if (results.length === 0) {
      return { found: false, key, namespace: ns };
    }

    return { found: true, key, namespace: ns, value: results[0]!.value };
  },
});
