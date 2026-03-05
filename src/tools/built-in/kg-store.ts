import { eq, and, or, isNull } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { knowledgeEntities, knowledgeRelations, agents } from "../../db/schema.js";
import { registerTool } from "../tool-registry.js";

// ── kg_store — create/update entity + optional relations ──────────

registerTool({
  name: "kg_store",
  description:
    "Store or update a knowledge entity in your knowledge graph. " +
    "Upserts by name — if you already have an entity with this name, it updates it. " +
    "Optionally link to other entities via relations. " +
    "Suggested relation_types: caused_by, depends_on, relates_to, part_of, " +
    "led_to, contradicts, supports, implements, supersedes, learned_from.",
  capability: "knowledge_graph",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Canonical name for this entity (e.g. 'auth-module', 'use-redis-decision')",
      },
      entity_type: {
        type: "string",
        enum: ["project", "decision", "research", "lesson", "preference", "person", "system", "concept"],
        description: "Type of knowledge entity",
      },
      content: {
        type: "string",
        description: "Prose knowledge payload — what you know about this entity",
      },
      confidence: {
        type: "number",
        description: "How confident you are (0-100, default: 80)",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Tags for discovery",
      },
      relations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            target: { type: "string", description: "Name of the target entity" },
            relation_type: { type: "string", description: "Type of relationship" },
            strength: { type: "number", description: "Relationship strength 0-100 (default: 50)" },
            context: { type: "string", description: "Why this relationship exists" },
          },
          required: ["target", "relation_type"],
        },
        description: "Optional relations to other entities (targets that don't exist are silently skipped)",
      },
    },
    required: ["name", "entity_type", "content"],
  },
  execute: async (agentId: string, input: any) => {
    const db = getDb();

    // Auto-detect projectId from agent
    let projectId: string | null = null;
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
    if (agent?.projectId) projectId = agent.projectId;

    // Upsert entity by name + agentId + projectId
    const nameConditions = [
      eq(knowledgeEntities.name, input.name),
      eq(knowledgeEntities.agentId, agentId),
    ];
    if (projectId) {
      nameConditions.push(eq(knowledgeEntities.projectId, projectId));
    } else {
      nameConditions.push(isNull(knowledgeEntities.projectId));
    }

    const [existing] = await db
      .select()
      .from(knowledgeEntities)
      .where(and(...nameConditions))
      .limit(1);

    let entityId: string;
    let updated = false;

    if (existing) {
      await db
        .update(knowledgeEntities)
        .set({
          entityType: input.entity_type,
          content: input.content,
          confidence: input.confidence ?? existing.confidence,
          tags: input.tags ?? existing.tags,
          updatedAt: new Date(),
        })
        .where(eq(knowledgeEntities.id, existing.id));
      entityId = existing.id;
      updated = true;
    } else {
      const [inserted] = await db
        .insert(knowledgeEntities)
        .values({
          name: input.name,
          entityType: input.entity_type,
          content: input.content,
          agentId,
          projectId,
          confidence: input.confidence ?? 80,
          tags: input.tags ?? [],
        })
        .returning();
      entityId = inserted!.id;
    }

    // Handle relations
    let relationsCreated = 0;
    if (input.relations && Array.isArray(input.relations)) {
      for (const rel of input.relations) {
        // Find target entity — look in same project scope
        const targetConditions = [eq(knowledgeEntities.name, rel.target)];
        if (projectId) {
          targetConditions.push(
            or(eq(knowledgeEntities.projectId, projectId), isNull(knowledgeEntities.projectId))!,
          );
        }

        const [targetEntity] = await db
          .select()
          .from(knowledgeEntities)
          .where(and(...targetConditions))
          .limit(1);

        if (!targetEntity) continue; // silently skip missing targets

        // Upsert relation by source + target + type + agent
        const [existingRel] = await db
          .select()
          .from(knowledgeRelations)
          .where(and(
            eq(knowledgeRelations.sourceEntityId, entityId),
            eq(knowledgeRelations.targetEntityId, targetEntity.id),
            eq(knowledgeRelations.relationType, rel.relation_type),
            eq(knowledgeRelations.agentId, agentId),
          ))
          .limit(1);

        if (existingRel) {
          await db
            .update(knowledgeRelations)
            .set({
              strength: rel.strength ?? existingRel.strength,
              context: rel.context ?? existingRel.context,
            })
            .where(eq(knowledgeRelations.id, existingRel.id));
        } else {
          await db.insert(knowledgeRelations).values({
            sourceEntityId: entityId,
            targetEntityId: targetEntity.id,
            relationType: rel.relation_type,
            strength: rel.strength ?? 50,
            context: rel.context ?? null,
            agentId,
          });
        }
        relationsCreated++;
      }
    }

    return {
      entity_id: entityId,
      name: input.name,
      updated,
      relations_created: relationsCreated,
    };
  },
});
