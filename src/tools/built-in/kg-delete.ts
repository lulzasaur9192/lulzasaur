import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { knowledgeEntities, agents } from "../../db/schema.js";
import { registerTool } from "../tool-registry.js";

// ── kg_delete — remove own entities ───────────────────────────────

registerTool({
  name: "kg_delete",
  description:
    "Delete a knowledge entity you own. All associated relations are " +
    "automatically removed (cascade). You can only delete your own entities.",
  capability: "knowledge_graph",
  inputSchema: {
    type: "object",
    properties: {
      entity_name: {
        type: "string",
        description: "Name of the entity to delete",
      },
      entity_id: {
        type: "string",
        description: "ID of the entity to delete (alternative to name)",
      },
    },
  },
  execute: async (agentId: string, input: any) => {
    const db = getDb();

    let entity;
    if (input.entity_id) {
      const [found] = await db
        .select()
        .from(knowledgeEntities)
        .where(and(
          eq(knowledgeEntities.id, input.entity_id),
          eq(knowledgeEntities.agentId, agentId),
        ))
        .limit(1);
      entity = found;
    } else if (input.entity_name) {
      // Auto-detect projectId
      const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
      const conditions = [
        eq(knowledgeEntities.name, input.entity_name),
        eq(knowledgeEntities.agentId, agentId),
      ];
      if (agent?.projectId) {
        conditions.push(eq(knowledgeEntities.projectId, agent.projectId));
      }
      const [found] = await db
        .select()
        .from(knowledgeEntities)
        .where(and(...conditions))
        .limit(1);
      entity = found;
    }

    if (!entity) {
      return {
        deleted: false,
        error: "Entity not found or you don't own it",
        entity_name: input.entity_name,
        entity_id: input.entity_id,
      };
    }

    // CASCADE on FK handles relation cleanup
    await db.delete(knowledgeEntities).where(eq(knowledgeEntities.id, entity.id));

    return {
      deleted: true,
      entity_id: entity.id,
      name: entity.name,
    };
  },
});
